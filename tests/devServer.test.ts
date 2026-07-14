import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { devServer, type DevServer } from "../dev/dev"
import { Component79, enableHotReload, hotUpdate } from "../src/jq79"

// ---------------------------------------------------------------------------
// jq79/dev - the dev server for the no-bundle path
//
// Two halves, tested apart: the server (a real one, on a real port, watching a
// real directory) and the hot swap it drives (in jsdom, where components can
// actually mount). A browser is the only thing that joins them, so the seam
// between the two - the { url, src } an SSE "update" carries - is asserted on
// both sides.
// ---------------------------------------------------------------------------

describe("dev server", () => {
  let root: string
  let server: DevServer

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jq79-dev-"))
    await writeFile(join(root, "index.html"), "<html><head><title>app</title></head><body></body></html>")
    await writeFile(join(root, "card.html"), "<p>before</p>")
    server = await devServer({ rootDir: root, port: 0 })
  })

  afterEach(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })

  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${server.url}${path}`, { headers })

  // what a browser sends for a navigation, and what the runtime's fetch() sends
  // for a component - the header the server injects (or doesn't) on
  const asDocument = { "sec-fetch-dest": "document" }
  const asFetch = { "sec-fetch-dest": "empty" }

  it("serves a page with the hot-reload client injected into its head", async () => {
    const html = await get("/index.html", asDocument).then(res => res.text())

    expect(html).toContain(`<script src="/__jq79/client.js"></script>`)
    // in the head, ahead of the page's own scripts: it is a classic script, so
    // it runs before any deferred module script imports the runtime, which is
    // what lets it set the flag in time
    expect(html.indexOf("/__jq79/client.js")).toBeLessThan(html.indexOf("</head>"))
  })

  it("serves a directory as its index.html", async () => {
    const res = await get("/", asDocument)
    expect(res.headers.get("content-type")).toContain("text/html")
    expect(await res.text()).toContain("<title>app</title>")
  })

  it("serves a component verbatim - it is fetched by the runtime, not rendered", async () => {
    // the same .html extension, and it must NOT get the client injected: the
    // runtime parses whatever comes back, so an injected <script> would become
    // part of the component
    const html = await get("/card.html", asFetch).then(res => res.text())

    expect(html).toBe("<p>before</p>")
    expect(html).not.toContain("__jq79")
  })

  it("pushes the new source when a component changes", async () => {
    const events = await sse(`${server.url}/__jq79/events`)

    await writeFile(join(root, "card.html"), "<p>after</p>")

    const update = await events.next("update", "/card.html")
    expect(update).toEqual({ url: "/card.html", src: "<p>after</p>" })
    // the url is the one the component was served from, because that is what
    // the runtime matches its live instances against
    expect(await get(update.url, asFetch).then(res => res.text())).toBe("<p>after</p>")

    events.close()
  })

  it("pushes the source of a component in a subdirectory, under its served url", async () => {
    await mkdir(join(root, "parts"))
    await writeFile(join(root, "parts", "row.html"), "<li>one</li>")
    const events = await sse(`${server.url}/__jq79/events`)

    await writeFile(join(root, "parts", "row.html"), "<li>two</li>")

    expect(await events.next("update", "/parts/row.html")).toEqual({
      url: "/parts/row.html",
      src: "<li>two</li>",
    })
    // the directory it lives in changed too, and that is not a page reload:
    // every save inside a folder touches the folder
    expect(events.seen("reload")).toEqual([])
    events.close()
  })

  it("asks for a reload when something that is not a component changes", async () => {
    await writeFile(join(root, "app.css"), "p { color: red }")
    const events = await sse(`${server.url}/__jq79/events`)

    await writeFile(join(root, "app.css"), "p { color: blue }")

    expect(await events.next("reload", "/app.css")).toEqual({ url: "/app.css" })
    events.close()
  })

  it("does not serve files outside the directory it was given", async () => {
    // the traversal a static server has to refuse; encoded, so it survives the
    // trip through the URL rather than being collapsed by fetch()
    const res = await get("/%2e%2e/%2e%2e/etc/passwd", asDocument)
    expect([403, 404]).toContain(res.status)
  })

  it("404s a file it does not have", async () => {
    expect((await get("/nope.html", asFetch)).status).toBe(404)
  })
})

// a minimal SSE client: node's fetch streams, so the frames can be read off the
// body as they arrive. Frames are buffered rather than dispatched, so a test
// that asks for one after it already landed still sees it.
//
// next() waits for an event *about a given url*: macOS replays filesystem
// events from just before the watch started, so the fixtures written to set a
// test up can turn up as an update once the server is listening
const sse = async (url: string) => {
  const res = await fetch(url)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const frames: { event: string; data: any }[] = []
  let buffer = ""
  let done = false

  void (async () => {
    while (!done) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined }))
      if (chunk.done) break
      buffer += decoder.decode(chunk.value as Uint8Array, { stream: true })
      const parts = buffer.split("\n\n")
      buffer = parts.pop() ?? ""
      for (const part of parts) {
        const event = /^event: (.+)$/m.exec(part)
        const data = /^data: (.+)$/m.exec(part)
        if (event && data) frames.push({ event: event[1], data: JSON.parse(data[1]) })
      }
    }
  })()

  const matching = (name: string, forUrl?: string) =>
    frames.filter(frame => frame.event === name && (!forUrl || frame.data.url === forUrl)).map(frame => frame.data)

  return {
    next: async (name: string, forUrl?: string) => {
      await vi.waitFor(() => expect(matching(name, forUrl).length).toBeGreaterThan(0), { timeout: 3000 })
      return matching(name, forUrl)[0]
    },
    seen: (name: string) => matching(name),
    close: () => {
      done = true
      void reader.cancel()
    },
  }
}

// ---------------------------------------------------------------------------

describe("the client the server injects", () => {
  let root: string
  let server: DevServer
  let reload: ReturnType<typeof vi.fn>
  let listeners: Map<string, (event: { data: string }) => void>

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jq79-client-"))
    server = await devServer({ rootDir: root, port: 0 })

    listeners = new Map()
    // jsdom has no EventSource, and this is the seam being tested: what the
    // client does with a frame, not that a browser can carry one
    vi.stubGlobal("EventSource", class {
      addEventListener(name: string, listener: (event: { data: string }) => void) {
        listeners.set(name, listener)
      }
    })
    reload = vi.fn()
    vi.stubGlobal("location", { reload })

    document.head.innerHTML = ""
    document.body.innerHTML = `<div id="app"></div>`
    enableHotReload()

    // the real client, fetched from the real server, run as a browser would run
    // it - the one piece of this feature that no other test executes
    const client = await fetch(`${server.url}/__jq79/client.js`).then(res => res.text())
    ;(0, eval)(client)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await server.close()
    await rm(root, { recursive: true, force: true })
  })

  const emit = (event: string, data: unknown) => listeners.get(event)!({ data: JSON.stringify(data) })

  it("flags the page before the runtime loads, so instances get tracked", () => {
    // a classic script, so it runs before the page's deferred module scripts:
    // the runtime reads this on the way in and starts registering
    expect((globalThis as any).__JQ79_HMR_ENABLED__).toBe(true)
  })

  it("hands the runtime to the client through the flag alone", async () => {
    // the handshake, which is the whole production path: every other test here
    // calls enableHotReload() by hand, but a real page never does - it loads the
    // client (which sets the flag above), and the runtime picks it up on import.
    // The client cannot import the runtime itself: the page's copy may come from
    // a CDN or an import map, and a second copy would have a second, empty registry
    delete (globalThis as any).__JQ79_HMR__
    vi.resetModules() // so the runtime evaluates again, with the flag already set

    const runtime = await import("../src/jq79")
    const hmr = (globalThis as any).__JQ79_HMR__
    expect(hmr).toBeTruthy()

    new runtime.Component79(`<p class="hs">before</p>`, { filename: "/hs.html" }).mount(
      document.querySelector("#app") as HTMLElement, {}
    )
    // the instance registered itself off the back of the flag, with nothing else
    // switching it on
    expect(hmr.update("/hs.html", `<p class="hs">after</p>`)).toBe(1)
    expect(document.querySelector(".hs")?.textContent).toBe("after")
  })

  it("swaps an update into the live component, without reloading", () => {
    new Component79(`<p class="live">before</p>`, { filename: "/live.html" }).mount(
      document.querySelector("#app") as HTMLElement, {}
    )

    emit("update", { url: "/live.html", src: `<p class="live">after</p>` })

    expect(document.querySelector(".live")?.textContent).toBe("after")
    expect(reload).not.toHaveBeenCalled()
  })

  it("reloads when the update reaches nothing on the page", () => {
    emit("update", { url: "/index.html", src: "<html></html>" })
    expect(reload).toHaveBeenCalled()
  })

  it("reloads when the server asks it to", () => {
    emit("reload", { url: "/app.css" })
    expect(reload).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------

describe("hot reload", () => {
  beforeEach(() => {
    enableHotReload()
    document.head.innerHTML = ""
    document.body.innerHTML = `<div id="app"></div>`
  })

  const host = () => document.querySelector("#app") as HTMLElement

  // the registry outlives a test (it is the runtime module's, and a WeakRef to a
  // component the test dropped stays until the GC runs), so each test works on a
  // file of its own rather than on instances the last one left behind
  let n = 0
  const file = () => `/fixture-${++n}.html`

  it("re-renders a mounted component in place, keeping its data", () => {
    const url = file()
    const card = new Component79(`<p class="card">{{ name }} — before</p>`, { filename: url })
    card.mount(host(), { name: "ada" })
    expect(document.querySelector(".card")?.textContent).toBe("ada — before")

    expect(hotUpdate(url, `<p class="card">{{ name }} — after</p>`)).toBe(1)

    // the new template, still driven by the data the old one had
    expect(document.querySelector(".card")?.textContent).toBe("ada — after")
    // and still live afterwards
    card.data!.name = "grace"
    expect(document.querySelector(".card")?.textContent).toBe("grace — after")
  })

  it("stays where it was mounted, among its siblings", () => {
    const url = file()
    host().innerHTML = `<b class="before"></b><span id="slot"></span><b class="after"></b>`
    new Component79(`<i class="c">one</i>`, { filename: url }).mount(
      document.querySelector("#slot") as HTMLElement, {}
    )

    hotUpdate(url, `<i class="c">two</i>`)

    expect(document.querySelector("#slot .c")?.textContent).toBe("two")
    expect([...host().children].map(el => el.className || el.id)).toEqual(["before", "slot", "after"])
  })

  it("matches a file by the url it was served from, however it was named", () => {
    // the runtime knows this component as "./card.html" (an import() in a setup
    // script) while the server watched "card.html". Resolved against the page,
    // they are the same file - and they have to be, or nothing would ever match
    new Component79(`<p class="rel">before</p>`, { filename: "./nested/card.html" }).mount(host(), {})

    expect(hotUpdate("/nested/card.html", `<p class="rel">after</p>`)).toBe(1)
    expect(document.querySelector(".rel")?.textContent).toBe("after")
  })

  it("re-renders the nested clones of a definition, not just a direct mount", () => {
    // the case the Vite plugin can only answer with a full page reload: the
    // definition is mounted nowhere, and its clones are reachable from nothing
    // but the DOM. The registry finds them, because a clone inherits its
    // definition's filename
    const url = file()
    const Row = new Component79(`<li class="row">{{ label }} (v1)</li>`, { filename: url })
    new Component79(`<ul><li :each="label in labels"><Row :label /></li></ul>`).mount(host(), {
      Row,
      labels: ["one", "two"],
    })
    expect([...document.querySelectorAll(".row")].map(el => el.textContent)).toEqual(["one (v1)", "two (v1)"])

    // the two clones re-rendered; the definition itself is on no page, so it is
    // patched but not counted
    expect(hotUpdate(url, `<li class="row">{{ label }} (v2)</li>`)).toBe(2)

    expect([...document.querySelectorAll(".row")].map(el => el.textContent)).toEqual(["one (v2)", "two (v2)"])
  })

  it("keeps a re-rendered clone reactive to its parent's props", () => {
    const url = file()
    const Row = new Component79(`<li class="row">{{ label }}</li>`, { filename: url })
    const app = new Component79(`<ul><li :each="label in labels"><Row :label /></li></ul>`)
    app.mount(host(), { Row, labels: ["one"] })

    hotUpdate(url, `<li class="row">[{{ label }}]</li>`)
    expect(document.querySelector(".row")?.textContent).toBe("[one]")

    // the parent still drives the clone that replaced the one it made
    app.data!.labels[0] = "uno"
    expect(document.querySelector(".row")?.textContent).toBe("[uno]")
  })

  it("swaps a component's styles, dropping the ones it replaced", () => {
    const url = file()
    new Component79(`<p class="s">hi</p><style>.s { color: red }</style>`, { filename: url }).mount(host(), {})
    expect(document.head.textContent).toContain("color: red")

    hotUpdate(url, `<p class="s">hi</p><style>.s { color: blue }</style>`)

    expect(document.head.textContent).toContain("color: blue")
    // the old stylesheet is released, not left behind to keep styling the page
    expect(document.head.textContent).not.toContain("color: red")
  })

  it("reports nothing re-rendered when the file is on no page", () => {
    // what makes the client fall back to a full reload: a page, a stylesheet, a
    // component nothing has mounted yet
    expect(hotUpdate("/index.html", "<html></html>")).toBe(0)
  })

  it("patches a definition that was never rendered, so its next clone is current", () => {
    const url = file()
    const Row = new Component79(`<li class="row">v1</li>`, { filename: url })

    // nothing on screen came from it, so the client reloads - but the definition
    // is patched all the same, and a clone made before the reload lands is current
    expect(hotUpdate(url, `<li class="row">v2</li>`)).toBe(0)

    new Component79(`<ul><Row /></ul>`).mount(host(), { Row })
    expect(document.querySelector(".row")?.textContent).toBe("v2")
  })
})
