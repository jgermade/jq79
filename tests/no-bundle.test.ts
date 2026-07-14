import { createServer, type Server } from "node:http"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"

// ---------------------------------------------------------------------------
// Using jq79 with no build step at all
//
// There is no compiler, so a component needs nothing done to it before a
// browser can use it: drop the .html files and the single-file library on any
// static host and the page works. These tests exercise that path for real -
// the published dist/ artifacts, fixture components served over a real HTTP
// server, real fetch, no bundler anywhere. The rest of the suite imports from
// src/ and so never touches the artifacts a CDN actually serves.
// ---------------------------------------------------------------------------

const dist = (file: string) => resolve("dist", file)
const fixtures = resolve("tests/fixtures/no-bundle")

// dist/ is gitignored and `npm test` runs before `npm run build`, so the
// artifacts may be missing or stale here (~0.5s to rebuild)
const buildIfStale = () => {
  const artifacts = [dist("jq79.js"), dist("jq79.global.js")]
  const newestSrc = readdirSync("src").reduce(
    (newest, file) => Math.max(newest, statSync(resolve("src", file)).mtimeMs), 0
  )
  const fresh = artifacts.every(file => existsSync(file) && statSync(file).mtimeMs > newestSrc)
  if (!fresh) execFileSync("npx", ["tsup"], { stdio: "ignore" })
}

const CONTENT_TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript" }

// a plain static file server - the "any static host" of the claim above
const serve = (root: string): Promise<Server> => {
  const server = createServer((req, res) => {
    const file = join(root, decodeURIComponent((req.url ?? "/").split("?")[0]))
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end("not found")
      return
    }
    res.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "text/plain" })
    res.end(readFileSync(file))
  })
  return new Promise(done => server.listen(0, () => done(server)))
}

describe("no bundle", () => {
  let server: Server
  let origin: string
  let pageDir: string | null = null

  beforeAll(async () => {
    buildIfStale()
    server = await serve(fixtures)
    origin = `http://localhost:${(server.address() as any).port}`

    // a browser resolves a relative URL against the document; Node's fetch
    // only takes absolute ones, so give it the page's origin to resolve from.
    // This is the only stand-in for a browser in the whole file
    const nodeFetch = globalThis.fetch
    vi.stubGlobal("fetch", (url: any, init?: any) => nodeFetch(new URL(String(url), origin), init))
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    server.close()
    if (pageDir) await rm(pageDir, { recursive: true, force: true })
  })

  const host = () => {
    document.head.innerHTML = ""
    document.body.innerHTML = `<div id="app"></div>`
    return document.querySelector("#app") as HTMLElement
  }

  it("loads from a classic <script> tag, exposing the library as window.jq79", () => {
    // what `<script src="https://cdn.jsdelivr.net/npm/jq79/dist/jq79.global.js">`
    // does: an IIFE that leaves the API on a global. Indirect eval gives the
    // bundle's top-level `var jq79` the same global scope a classic script has
    ;(0, eval)(readFileSync(dist("jq79.global.js"), "utf8"))

    const jq79 = (globalThis as any).jq79
    expect(Object.keys(jq79)).toEqual(expect.arrayContaining(["Component79", "$reactive", "$", "$$", "$create"]))

    new jq79.Component79(`<p class="hi">{{ greeting }}</p>`).mount(host(), { greeting: "hola" })
    expect(document.querySelector(".hi")?.textContent).toBe("hola")
  })

  it("imports natively as an ES module, with no bundler resolving anything", async () => {
    // what `import { Component79 } from "https://esm.sh/jq79"` does in a
    // <script type="module">: a plain module import, from a URL
    const { Component79 } = await import(pathToFileURL(dist("jq79.js")).href)

    new Component79(`<p class="hi">{{ greeting }}</p>`).mount(host(), { greeting: "hola" })
    expect(document.querySelector(".hi")?.textContent).toBe("hola")
  })

  it("ships as a single file with no dependencies", () => {
    for (const file of ["jq79.js", "jq79.global.js"]) {
      const source = readFileSync(dist(file), "utf8").replace(/\/\/# source.*$/gm, "")
      expect(source).not.toMatch(/\bfrom\s*["']|\brequire\s*\(|\bimport\s*["']/)
    }
  })

  it("fetches a component from a static host and mounts it", async () => {
    const { Component79 } = await import(pathToFileURL(dist("jq79.js")).href)

    const app = await Component79.fetch("/todo-app.html")
    app.mount(host(), { title: "Today" })

    // <TodoItem> came from an `await import("./todo-item.html")` in the setup
    // script: with no bundler to pre-resolve the specifier, the runtime fetches
    // it over the network and parses it, so the children arrive a round trip
    // after the parent mounts
    await vi.waitFor(() => expect(document.querySelectorAll(".todos .todo")).toHaveLength(2))

    // the :setup prop, and a `$:` value derived from it and from the fetched
    // component's own state
    expect(document.querySelector(".heading")?.textContent).toBe("Today — 2 left")

    const items = [...document.querySelectorAll(".todos .todo")]
    expect(items.map(el => el.textContent)).toEqual(["water the plants", "read the source"])
    expect(items[0].getAttribute("title")).toBe("WATER THE PLANTS")

    // both components' <style> blocks made it into the head, the child's scoped
    expect(document.head.textContent).toContain("list-style: none")
    expect(items[0].getAttributeNames()).toContain("data-jq79")

    // and it is live: the store drives the same fine-grained updates it would
    // under a bundler
    app.data.items.push("ship it")
    expect(document.querySelectorAll(".todos .todo")).toHaveLength(3)
    expect(document.querySelector(".heading")?.textContent).toBe("Today — 3 left")
  })

  it("runs the page a static host would serve, verbatim", async () => {
    // tests/fixtures/no-bundle/index.html is a deployable page: a #app div and
    // a module script that imports jq79 from a CDN and mounts a fetched
    // component. Run it as written, with the CDN URL pointed at the local build
    // (which is what the CDN serves) - nothing else about the page changes
    const page = await fetch("/index.html").then(res => res.text())
    const doc = new DOMParser().parseFromString(page, "text/html")
    const script = doc.querySelector("script[type=module]")!

    expect(script.textContent).toContain("https://esm.sh/jq79")
    const source = script.textContent!.replace("https://esm.sh/jq79", pathToFileURL(dist("jq79.js")).href)

    document.head.innerHTML = ""
    document.body.innerHTML = doc.body.innerHTML

    // vitest only resolves imports from inside the project, so the page's
    // script goes in a temp dir under node_modules rather than the system one
    pageDir = await mkdtemp(resolve("node_modules/.jq79-page-"))
    const module = join(pageDir, "page.js")
    await writeFile(module, source)
    await import(pathToFileURL(module).href)

    await vi.waitFor(() => expect(document.querySelectorAll("#app .todos .todo")).toHaveLength(2))
    expect(document.querySelector("#app .heading")?.textContent).toBe("Today — 2 left")
  })
})
