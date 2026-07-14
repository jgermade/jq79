import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile, realpath, stat } from "node:fs/promises"
import { watch, type FSWatcher } from "node:fs"
import { basename, extname, join, relative, resolve, sep } from "node:path"

// A dev server for the no-bundle path: serve a directory of .html components
// over HTTP, watch it, and hot-reload the components that changed.
//
//   npx jq79 dev                                  // the CLI
//   import { devServer } from "jq79/dev"          // or from a script
//   await devServer({ rootDir: "." })
//
// It is a static file server and nothing else - no transforms, no bundling, no
// module graph. Which is the point: the files it serves are the files you would
// deploy, so what you develop against and what a static host serves are the same
// bytes. The one thing it adds is the hot-reload channel, and it adds it to
// *documents* only (a component fetched by the runtime is served verbatim).
//
// The reload is fine-grained. On a change the server pushes the new source down
// an SSE channel and the runtime swaps it into every live instance of that file,
// keeping its data - see hotUpdate in jq79.ts. Anything the runtime can't place
// (a page, a stylesheet, a component nothing has mounted yet) falls back to a
// full page reload.

export interface DevServerOptions {
  // the directory to serve, and to watch (default: the current directory)
  rootDir?: string
  // default: 4179, or the first free port after it
  port?: number
  // default: localhost
  host?: string
}

export interface DevServer {
  url: string
  port: number
  close: () => Promise<void>
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
}

const CLIENT_URL = "/__jq79/client.js"
const EVENTS_URL = "/__jq79/events"

// Served as a *classic* script, and injected into the <head>: classic scripts
// run at parse time and module scripts are deferred, so the flag is set before
// the page's `import ... from "jq79"` evaluates - which is what the runtime
// waits for before it starts tracking instances. The client can't import the
// runtime itself: the page's copy may come from a CDN or an import map, and a
// second copy would have a second, empty registry.
const CLIENT = `(() => {
  window.__JQ79_HMR_ENABLED__ = true

  const events = new EventSource(${JSON.stringify(EVENTS_URL)})

  events.addEventListener("update", event => {
    const { url, src } = JSON.parse(event.data)
    const runtime = window.__JQ79_HMR__
    // no runtime (the page doesn't use jq79), or no live instance from this
    // file (it isn't mounted, or it *is* the page) - nothing to swap into
    const patched = runtime ? runtime.update(url, src) : 0
    if (patched) console.log("[jq79] hot-updated " + url + " (" + patched + (patched === 1 ? " instance)" : " instances)"))
    else location.reload()
  })

  events.addEventListener("reload", () => location.reload())
})()`

const posix = (path: string) => path.split(sep).join("/")

const isDocument = (req: IncomingMessage) => req.headers["sec-fetch-dest"] === "document"

// the client goes in the <head> so it is the first thing the page runs. A file
// with neither <head> nor <body> is still a document a browser will render, so
// fall back to the top of it rather than skipping the injection
const injectClient = (html: string): string => {
  const tag = `<script src="${CLIENT_URL}"></script>`
  const open = /<head[^>]*>/i.exec(html) ?? /<body[^>]*>/i.exec(html)
  if (!open) return tag + html
  const at = open.index + open[0].length
  return html.slice(0, at) + tag + html.slice(at)
}

export const devServer = async (options: DevServerOptions = {}): Promise<DevServer> => {
  // the *real* path: the watcher reports what changed relative to the directory
  // it actually opened, so a root reached through a symlink (/tmp and /var are
  // symlinks on macOS) would hand back paths that don't line up with it
  const root = await realpath(resolve(options.rootDir ?? "."))
  const host = options.host ?? "localhost"

  const clients = new Set<ServerResponse>()

  const send = (event: string, data: unknown) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    clients.forEach(client => client.write(frame))
  }

  // --- serving ---------------------------------------------------------------

  const serveStatic = async (req: IncomingMessage, res: ServerResponse, pathname: string) => {
    // a URL path is not a file path: decode it, then keep the result inside the
    // root (".." in a request must not walk out of the served directory)
    let file: string
    try {
      file = resolve(join(root, decodeURIComponent(pathname)))
    } catch {
      res.writeHead(400).end("bad request")
      return
    }
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end("forbidden")
      return
    }

    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html")
      const body = await readFile(file)
      const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream"

      // only a navigation gets the hot-reload client. A component is fetched by
      // the runtime (sec-fetch-dest: empty), and it must arrive as written -
      // injecting a <script> into it would make the runtime parse and run it
      const html = type.startsWith("text/html") && isDocument(req)
      const payload = html ? Buffer.from(injectClient(body.toString("utf8"))) : body

      res.writeHead(200, {
        "content-type": type,
        "content-length": payload.byteLength,
        "cache-control": "no-store", // the file on disk is always the truth here
      })
      res.end(payload)
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found")
    }
  }

  const server: Server = createServer((req, res) => {
    const pathname = (req.url ?? "/").split(/[?#]/)[0]

    if (pathname === CLIENT_URL) {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" })
      res.end(CLIENT)
      return
    }

    if (pathname === EVENTS_URL) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      })
      res.write(": jq79\n\n") // opens the stream, so the browser fires onopen
      clients.add(res)
      req.on("close", () => clients.delete(res))
      return
    }

    void serveStatic(req, res, pathname)
  })

  // --- watching --------------------------------------------------------------

  const ignored = (rel: string) =>
    rel.split(sep).some(part => part.startsWith(".") || part === "node_modules")

  // one save can arrive as several events (a rename plus a change, an editor's
  // atomic write); collapsing per file keeps that down to one push
  const pending = new Map<string, NodeJS.Timeout>()

  const changed = async (rel: string) => {
    const file = join(root, rel)

    let src: string | null = null
    try {
      // a directory changes whenever anything inside it does, and the event for
      // the file itself is already on its way - acting on both would reload the
      // page every time a component is saved
      if ((await stat(file)).isDirectory()) return
      if (rel.endsWith(".html")) src = await readFile(file, "utf8")
    } catch {
      // gone: deleted, or renamed away - and there is nothing to swap in, so the
      // page has to reload. Unless it was never there: macOS reports a change to
      // the watched directory *itself* under its own basename, which resolves to
      // a path inside it that does not exist
      if (rel === basename(root)) return
    }

    // the url is the one the component was served from, because that is what the
    // runtime resolves its instances' filenames against
    const url = "/" + posix(rel)
    if (src === null) send("reload", { url })
    else send("update", { url, src })
  }

  const watcher: FSWatcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const rel = relative(root, resolve(root, filename.toString()))
    if (!rel || rel.startsWith("..") || ignored(rel)) return

    clearTimeout(pending.get(rel))
    pending.set(rel, setTimeout(() => {
      pending.delete(rel)
      void changed(rel)
    }, 30))
  })

  // proxies and load balancers cut an idle stream; a comment every 30s is the
  // conventional way to keep it open. unref'd, so it never holds the process up
  const heartbeat = setInterval(() => clients.forEach(client => client.write(": ping\n\n")), 30_000)
  heartbeat.unref()

  // --- go --------------------------------------------------------------------

  await new Promise<void>((done, fail) => {
    server.once("error", fail)
    server.listen(options.port ?? 4179, host, done)
  })
  const { port } = server.address() as { port: number }

  return {
    url: `http://${host}:${port}`,
    port,
    close: () =>
      new Promise(done => {
        clearInterval(heartbeat)
        watcher.close()
        pending.forEach(clearTimeout)
        clients.forEach(client => client.end())
        clients.clear()
        server.close(() => done())
      }),
  }
}

export default devServer
