import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile, realpath, stat } from "node:fs/promises"
import { watch, type FSWatcher } from "node:fs"
import { basename, dirname, extname, isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path"

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
  // response headers to send on everything - a static host is configured, and
  // these are that configuration (default: none)
  headers?: Record<string, string>
  // the same thing per request: a hook gets the request and its response before
  // anything has been written to it (default: none)
  beforeResponse?: ResponseHook[]
  // what to watch on top of rootDir, and what to do about it (default: none)
  watch?: WatchEntry[]
}

// runs on every response the server makes - a page, a component, the client,
// the event stream, a 404 - with nothing written yet, so `res.setHeader` still
// applies. A hook that answers the request itself (`res.end`) is left alone
export type ResponseHook = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

// the handler gets every file of the burst that woke it, absolute, so a save
// that touches three of them is one build rather than three
export type WatchHandler = (files: string[]) => void | Promise<void>

export interface WatchEntry {
  // glob(s) resolved against the cwd, like rootDir: "styles/**/*.scss". A bare
  // directory means everything under it
  pattern: string | string[]
  // what a match runs. Without one, a match outside the served root reloads the
  // page - which is the only other thing a file served from nowhere can do
  fn?: WatchHandler
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
  // the streaming WebAssembly APIs reject every other type, including the
  // default below - a module served as octet-stream still runs, but it is
  // buffered whole instead of compiling as it downloads
  ".wasm": "application/wasm",
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
  // (\s[^>]*)? rather than [^>]*, or <header> would pass for <head>
  const open = /<head(\s[^>]*)?>/i.exec(html) ?? /<body(\s[^>]*)?>/i.exec(html)
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

  // a configured header goes on every response, which is the one thing
  // content-type and content-length cannot do - each describes the bytes of a
  // single response. Dropped here rather than at write time, so that either of
  // them still standing by then can only have come from a hook, which saw the
  // request and is entitled to say
  const headers = Object.entries(options.headers ?? {}).filter(
    ([name]) => !["content-type", "content-length"].includes(name.toLowerCase()),
  )
  const hooks = options.beforeResponse ?? []

  const clients = new Set<ServerResponse>()

  const send = (event: string, data: unknown) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    clients.forEach(client => client.write(frame))
  }

  // --- serving ---------------------------------------------------------------

  // what the response says about its own bytes, written last so the layers
  // below can't contradict it. A hook is the one exception: it saw the request,
  // so it is entitled to an opinion about what these bytes *are* - never about
  // how many there are, since a wrong content-length truncates the body or
  // hangs the socket
  const head = (res: ServerResponse, status: number, own: Record<string, string | number> = {}) => {
    res.removeHeader("content-length")
    const write = { ...own }
    if (res.hasHeader("content-type")) delete write["content-type"]
    return res.writeHead(status, write)
  }

  const serveStatic = async (req: IncomingMessage, res: ServerResponse, pathname: string) => {
    // a URL path is not a file path: decode it, then keep the result inside the
    // root (".." in a request must not walk out of the served directory)
    let file: string
    try {
      file = resolve(join(root, decodeURIComponent(pathname)))
    } catch {
      head(res, 400).end("bad request")
      return
    }
    if (file !== root && !file.startsWith(root + sep)) {
      head(res, 403).end("forbidden")
      return
    }

    try {
      if ((await stat(file)).isDirectory()) {
        // a directory is served through its trailing-slash URL, like every
        // static host: /docs rendered as-is would resolve its relative links
        // against the parent ("img.png" -> /img.png instead of /docs/img.png)
        if (!pathname.endsWith("/")) {
          head(res, 301, { location: pathname + "/" }).end()
          return
        }
        file = join(file, "index.html")
      }
      const body = await readFile(file)
      const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream"

      // only a navigation gets the hot-reload client. A component is fetched by
      // the runtime (sec-fetch-dest: empty), and it must arrive as written -
      // injecting a <script> into it would make the runtime parse and run it
      const html = type.startsWith("text/html") && isDocument(req)
      const payload = html ? Buffer.from(injectClient(body.toString("utf8"))) : body

      head(res, 200, { "content-type": type, "content-length": payload.byteLength })
      res.end(payload)
    } catch {
      head(res, 404, { "content-type": "text/plain; charset=utf-8" }).end("not found")
    }
  }

  // three layers, general to specific, each one free to replace the last: the
  // server's own defaults, the configured headers over them, and a hook - which
  // saw the request - over those. They go on with setHeader rather than into an
  // object, because setHeader is case-insensitive where an object is not: a
  // "Cache-Control" replaces the cache-control below it instead of arriving
  // beside it, and the same goes for whatever a hook names
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("cache-control", "no-store") // the file on disk is always the truth here
    for (const [name, value] of headers) res.setHeader(name, value)
    for (const hook of hooks) await hook(req, res)

    // a hook can answer the request itself, and one that did needs nothing else
    if (res.headersSent || res.writableEnded) return

    const pathname = (req.url ?? "/").split(/[?#]/)[0]

    if (pathname === CLIENT_URL) {
      head(res, 200, { "content-type": "text/javascript; charset=utf-8" })
      res.end(CLIENT)
      return
    }

    if (pathname === EVENTS_URL) {
      head(res, 200, { "content-type": "text/event-stream", connection: "keep-alive" })
      res.write(": jq79\n\n") // opens the stream, so the browser fires onopen
      clients.add(res)
      req.on("close", () => clients.delete(res))
      return
    }

    await serveStatic(req, res, pathname)
  }

  const server: Server = createServer((req, res) => {
    // a hook is someone's code, and the watch handlers already settled what that
    // means around here: report it and stay up. This one owes the browser a
    // reply as well, because a socket nobody answers hangs the page
    void handle(req, res).catch(error => {
      console.error(`jq79 dev: failed to respond to ${req.url}\n`, error)
      if (!res.headersSent) {
        // whatever the hook had said about the bytes, it is not what is being
        // sent now - and a content-length it set before throwing would hang this
        res.removeHeader("content-length")
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
      }
      if (!res.writableEnded) res.end("internal error")
    })
  })

  // --- watching --------------------------------------------------------------

  const ignored = (rel: string) =>
    rel.split(sep).some(part => part.startsWith(".") || part === "node_modules")

  // one save can arrive as several events (a rename plus a change, an editor's
  // atomic write); collapsing per file keeps that down to one push
  const pending = new Map<string, NodeJS.Timeout>()

  // a pattern is written against the cwd (`resolve` reads it the same way), and
  // captured here so a later chdir can't move what the globs mean
  const cwd = process.cwd()

  type Entry = {
    patterns: string[]
    fn?: WatchHandler
    batch: Set<string>
    timer?: NodeJS.Timeout
    running: boolean
  }

  const entries: Entry[] = (options.watch ?? []).map(entry => ({
    patterns: [entry.pattern].flat(),
    fn: entry.fn,
    batch: new Set(),
    running: false,
  }))

  const claims = (entry: Entry, file: string) =>
    entry.patterns.some(pattern =>
      matchesGlob(isAbsolute(pattern) ? posix(file) : posix(relative(cwd, file)), pattern),
    )

  // a burst is one call: the handler is a build step, and building once per file
  // of a save that touched four is three builds nobody asked for
  const collect = (entry: Entry, file: string) => {
    entry.batch.add(file)
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void fire(entry), 30)
  }

  const fire = async (entry: Entry) => {
    if (entry.running || !entry.batch.size) return
    const files = [...entry.batch]
    entry.batch.clear()
    entry.running = true
    try {
      await entry.fn?.(files)
    } catch (error) {
      // a handler is someone's build script, and a build that fails is a normal
      // morning. Reporting it and staying up beats taking the server with it
      console.error(`jq79 dev: watch handler for ${entry.patterns.join(", ")} failed\n`, error)
    } finally {
      entry.running = false
      if (entry.batch.size) void fire(entry) // saved again while it ran
    }
  }

  // `dir` is the directory whose watcher reported this - only needed for the
  // macOS quirk below, and only when the file turns out not to exist
  const changed = async (file: string, dir: string) => {
    // where the browser knows the file from, which only exists for a file under
    // the served root: a watched path outside it is served from nowhere, so
    // there is no url for the runtime to match an instance against
    const rel = relative(root, file)
    const served = !!rel && !rel.startsWith("..")

    let src: string | null = null
    try {
      // a directory changes whenever anything inside it does, and the event for
      // the file itself is already on its way - acting on both would reload the
      // page every time a component is saved
      if ((await stat(file)).isDirectory()) return
      if (served && file.endsWith(".html")) src = await readFile(file, "utf8")
    } catch {
      // gone: deleted, or renamed away - and there is nothing to swap in, so the
      // page has to reload. Unless it was never there: macOS reports a change to
      // a watched directory *itself* under its own basename, which resolves to a
      // path inside it that does not exist
      if (file === join(dir, basename(dir))) return
    }

    // every entry that names this file gets it, wherever the file lives. What
    // the root does with its own files is not up for negotiation: no pattern can
    // switch hot reload off, so a handler can never cost you the thing you came
    // for by matching more than its author meant it to
    const claimed = entries.filter(entry => claims(entry, file))
    claimed.forEach(entry => entry.fn && collect(entry, file))

    if (served) {
      // the url is the one the component was served from, because that is what
      // the runtime resolves its instances' filenames against
      const url = "/" + posix(rel)
      if (src === null) send("reload", { url })
      else send("update", { url, src })
      return
    }

    // outside the root a handler *is* the answer: it ran, and whatever it writes
    // into the served directory comes back round as a change of its own, with a
    // url. An entry with no handler is asking for the page, and gets a path
    // relative to the root - the client only logs it, and an absolute one would
    // publish the machine's layout to the page
    if (claimed.some(entry => !entry.fn)) send("reload", { url: posix(rel) })
  }

  const queue = (file: string, dir: string) => {
    clearTimeout(pending.get(file))
    pending.set(file, setTimeout(() => {
      pending.delete(file)
      void changed(file, dir)
    }, 30))
  }

  const watchers: FSWatcher[] = []

  // a directory is watched whole. A single file is watched through the directory
  // it sits in (`only` filtering the rest back out), because a watcher on a file
  // holds its inode, and an editor's atomic save renames a new one over it - the
  // watcher survives as a handle on a file nothing will ever write to again
  const watchTree = (dir: string, only?: string) => {
    watchers.push(watch(dir, { recursive: !only }, (_event, filename) => {
      if (!filename) return
      const file = resolve(dir, filename.toString())
      const rel = relative(dir, file)
      if (!rel || rel.startsWith("..")) return
      if (only ? rel !== only : ignored(rel)) return
      queue(file, dir)
    }))
  }

  // a glob is a filter and a watcher needs a directory to open, so the watch
  // starts at the literal head of the pattern - everything before the first
  // magic character. "styles/**/*.scss" opens styles/, "**/*.scss" opens the cwd
  const literalHead = (pattern: string) => {
    const parts = pattern.split("/")
    const magic = parts.findIndex(part => /[*?[\]{}!]/.test(part))
    return resolve(magic === -1 ? pattern : parts.slice(0, magic).join("/") || ".")
  }

  // the patterns are resolved like rootDir, against the cwd, and all checked
  // before anything is watched: a path that isn't there is a typo, and a watcher
  // that silently isn't running is worse than a server that won't start
  const extra = new Map<string, { dir: string; only?: string }>()
  for (const entry of entries) {
    for (const [i, pattern] of entry.patterns.entries()) {
      const head = literalHead(pattern)
      const info = await stat(head).catch(() => null)
      if (!info) throw new Error(`jq79 dev: nothing to watch at ${head}`)

      // a bare directory means everything under it, which is what it looks like
      // it means - as a pattern it would watch the directory and match nothing
      // in it, and the mistake is invisible until a save doesn't fire
      if (info.isDirectory() && head === resolve(pattern)) {
        entry.patterns[i] = pattern.replace(/\/+$/, "") + "/**"
      }

      // real paths on both sides, so a symlink pointing out of the root reads as
      // what it is - outside, and not covered by the recursive watch below
      const real = await realpath(head)
      if (real === root || real.startsWith(root + sep)) continue // already watched
      const watched = info.isDirectory() ? { dir: real } : { dir: dirname(real), only: basename(real) }
      extra.set(`${watched.dir}\0${watched.only ?? ""}`, watched) // two patterns can share a head
    }
  }

  watchTree(root)
  extra.forEach(({ dir, only }) => watchTree(dir, only))

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
        watchers.forEach(watcher => watcher.close())
        pending.forEach(clearTimeout)
        entries.forEach(entry => clearTimeout(entry.timer))
        clients.forEach(client => client.end())
        clients.clear()
        server.close(() => done())
      }),
  }
}

export default devServer
