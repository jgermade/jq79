
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { $, $$, Component79, $reactive } from "../src/jq79"

describe("Component79", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    host.remove()
  })

  it("exposes the package version", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"))
    expect(Component79.version).toBe(pkg.version)
  })

  it("constructs from a source string or from a parts object", () => {
    const fromString = new Component79(`<div class="a">hi</div>`)
    expect(fromString.template).toHaveLength(1)

    const fromParts = new Component79({ template: fromString.template, scripts: [], styles: [] })
    expect(fromParts.template).toBe(fromString.template)
  })

  it("chains render().mount() and keeps the content reactive", () => {
    const jq79 = new Component79(`<div class="greet">{{ msg }}</div>`)

    expect(jq79.render({ msg: "hola" }).mount(host)).toBe(jq79)
    expect($(host, ".greet")?.textContent).toBe("hola")

    jq79.data!.msg = "adios"
    expect($(host, ".greet")?.textContent).toBe("adios")

    jq79.destroy()
  })

  it("mount(el, data) renders and attaches in one call, so on().mount() chains work", () => {
    const seen: any[] = []
    const jq79 = new Component79(
      `<script :setup>const fire = p => $emit("submit", p)</script><div class="one">{{ msg }}</div>`
    )
      .on("submit", (_e, payload) => seen.push(payload))
      .mount(host, { msg: "hi" })

    expect($(host, ".one")?.textContent).toBe("hi")

    ;(jq79.data as any).fire("x")
    expect(seen).toEqual(["x"])
    jq79.destroy()
  })

  it("mount(el) without data re-attaches an already-rendered component, keeping state", () => {
    const jq79 = new Component79(`<div class="keep">{{ n }}</div>`).mount(host, { n: 1 })
    jq79.data!.n = 2

    jq79.detach().mount(host)
    expect($(host, ".keep")?.textContent).toBe("2")
    jq79.destroy()
  })

  it("mount(el, data) on an already-rendered component re-renders fresh with that data", () => {
    const jq79 = new Component79(`<div class="fresh">{{ n }}</div>`).mount(host, { n: 1 })
    jq79.data!.n = 5

    jq79.mount(host, { n: 2 })
    expect($(host, ".fresh")?.textContent).toBe("2")
    jq79.destroy()
  })

  it("mountShadow(el, data) renders into a shadow root in one call", () => {
    const stylesBefore = document.head.querySelectorAll("style").length
    const jq79 = new Component79(`<div class="sh">{{ v }}</div><style>.sh { color: blue; }</style>`)
      .mountShadow(host, { v: "shadowed" })

    expect(document.head.querySelectorAll("style").length).toBe(stylesBefore)
    expect(host.shadowRoot!.querySelector(".sh")?.textContent).toBe("shadowed")
    jq79.destroy()
  })

  it("mounts into a selector string", () => {
    host.id = "jq79-host"
    const jq79 = new Component79(`<div class="sel">ok</div>`).render().mount("#jq79-host")

    expect($(host, ".sel")).not.toBeNull()
    jq79.destroy()
  })

  it("mount() on a second target detaches from the first one", () => {
    const other = document.createElement("div")
    document.body.appendChild(other)
    const jq79 = new Component79(`<div class="moved">{{ n }}</div>`).mount(host, { n: 1 })

    jq79.mount(other)

    expect($(host, ".moved")).toBeNull()
    expect($(other, ".moved")?.textContent).toBe("1")
    jq79.destroy()
    other.remove()
  })

  it("mountShadow() takes a selector string too", () => {
    host.id = "jq79-shadow-host"
    const jq79 = new Component79(`<div class="sh">ok</div>`).mountShadow("#jq79-shadow-host")

    expect(host.shadowRoot!.querySelector(".sh")).not.toBeNull()
    jq79.destroy()
  })

  it("throws when the mount selector matches nothing", () => {
    const jq79 = new Component79(`<div>x</div>`)

    expect(() => jq79.render().mount("#nope")).toThrow(/mount target not found: #nope/)
    expect(() => jq79.mountShadow("#nope")).toThrow(/mount target not found: #nope/)
  })

  it("injects styles into document.head on render and removes them on destroy", () => {
    const jq79 = new Component79(`<div class="styled">x</div><style>.styled { color: red; }</style>`)
    const stylesBefore = document.head.querySelectorAll("style").length

    jq79.render().mount(host)
    expect(document.head.querySelectorAll("style").length).toBe(stylesBefore + 1)

    jq79.detach().destroy()
    expect(document.head.querySelectorAll("style").length).toBe(stylesBefore)
  })

  it("renderShadow mounts content and styles into a shadow root instead of document.head", () => {
    const jq79 = new Component79(`<div class="s">shadowed</div><style>.s { color: blue; }</style>`)
    const stylesBefore = document.head.querySelectorAll("style").length

    jq79.renderShadow().mount(host)

    expect(document.head.querySelectorAll("style").length).toBe(stylesBefore)
    expect(host.shadowRoot).not.toBeNull()
    expect(host.shadowRoot!.querySelector(".s")?.textContent).toBe("shadowed")
    expect(host.shadowRoot!.querySelector("style")).not.toBeNull()

    jq79.destroy()
  })

  it("keeps a nested component's styles inside the shadow root its parent rendered into", () => {
    const child = new Component79(`<b class="c">child</b><style>.c { color: green; }</style>`)
    const parent = new Component79(
      `<div class="p"><Child /></div><style>.p { color: blue; }</style>`,
      { modules: {} }
    )
    const stylesBefore = document.head.querySelectorAll("style").length

    parent.mountShadow(host, { Child: child })

    // document.head can't reach into a shadow root: a child's <style> left there
    // would never style the child, and would restyle the page around it instead
    expect(document.head.querySelectorAll("style").length).toBe(stylesBefore)

    const shadowStyles = [...host.shadowRoot!.querySelectorAll("style")].map(el => el.textContent)
    expect(shadowStyles.some(css => css?.includes(".c { color: green; }"))).toBe(true)
    expect(host.shadowRoot!.querySelector(".c")?.textContent).toBe("child")

    parent.destroy()
    expect(host.shadowRoot!.querySelector("style")).toBeNull()
  })

  it("detach() detaches but keeps state, and mount() re-attaches with pending updates applied", () => {
    const jq79 = new Component79(`<div class="m">{{ n }}</div>`).render({ n: 1 }).mount(host)

    jq79.detach()
    expect($(host, ".m")).toBeNull()

    jq79.data!.n = 2
    jq79.mount(host)
    expect($(host, ".m")?.textContent).toBe("2")

    jq79.destroy()
  })

  it("detach() also collects nodes that :if inserted after mounting", () => {
    const jq79 = new Component79(`<div :if="show" class="cond">yes</div>`).render({ show: false }).mount(host)
    jq79.data!.show = true
    expect($(host, ".cond")).not.toBeNull()

    jq79.detach()
    expect(host.childNodes.length).toBe(0)

    jq79.mount(host)
    expect($(host, ".cond")).not.toBeNull()
    jq79.destroy()
  })

  it("destroy() disposes effects so later data changes stop touching the DOM", () => {
    const jq79 = new Component79(`<div class="d">{{ n }}</div>`).render({ n: 1 }).mount(host)
    const el = $(host, ".d")!
    const data = jq79.data!

    jq79.destroy()
    data.n = 99

    expect(el.textContent).toBe("1")
  })

  it("fetch() downloads and parses a component", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => `<div class="f">fetched</div>` })))

    const jq79 = await Component79.fetch("/component.html")
    jq79.render().mount(host)

    expect(globalThis.fetch).toHaveBeenCalledWith("/component.html")
    expect($(host, ".f")?.textContent).toBe("fetched")
    jq79.destroy()
  })

  it("fetch() mounts without an await", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => `<div class="f">fetched</div>` })))

    const pending = Component79.fetch("/component.html")
    expect(pending.mount(host)).toBe(pending) // chainable: no component to hand back yet

    const jq79 = await pending
    expect($(host, ".f")?.textContent).toBe("fetched")
    jq79.destroy()
  })

  it("fetch() runs queued calls in the order they were written", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => `<button @click="$emit('picked', 7)">go</button>`,
    })))

    const seen: any[] = []
    // on() before mount(): the listener has to be registered by the time the
    // render it precedes wires the template up
    const jq79 = await Component79.fetch("/component.html")
      .on("picked", (_event, payload) => seen.push(payload))
      .mount(host)

    $(host, "button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))

    expect(seen).toEqual([7])
    jq79.destroy()
  })

  it("fetch() rejects the chain when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, text: async () => "" })))

    await expect(Component79.fetch("/missing.html").mount(host)).rejects.toThrow("404")
    expect(host.innerHTML).toBe("")
  })

  it("fetch() refuses an array, naming fetchAll", () => {
    expect(() => Component79.fetch(["/a.html", "/b.html"] as any)).toThrow("fetchAll")
  })

  it("fetchAll() takes an array of URLs and resolves to the components in order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({ ok: true, text: async () => `<div class="f">${url}</div>` }))
    )

    const [a, b] = await Component79.fetchAll(["/a.html", "/b.html"])

    a.render().mount(host)
    expect($(host, ".f")?.textContent).toBe("/a.html")
    a.destroy()

    b.render().mount(host)
    expect($(host, ".f")?.textContent).toBe("/b.html")
    b.destroy()
  })

  it("fetchAll() rejects if any URL fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({ ok: url !== "/missing.html", status: 404, text: async () => "<p/>" }))
    )

    await expect(Component79.fetchAll(["/component.html", "/missing.html"])).rejects.toThrow("404")
  })

  it("fetch() rejects on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, text: async () => "" })))

    await expect(Component79.fetch("/missing.html")).rejects.toThrow("404")
  })

  describe(":setup scripts", () => {
    it("logs an error thrown by the script without breaking the render", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      const jq79 = new Component79(
        `<script :setup>throw new Error("boom")</script><div class="t">rendered</div>`
      ).render().mount(host)

      await new Promise(resolve => setTimeout(resolve))

      expect($(host, ".t")?.textContent).toBe("rendered")
      expect(spy).toHaveBeenCalledWith("jq79: error in :setup script", expect.any(Error))
      jq79.destroy()
      spy.mockRestore()
    })

    it("exposes top-level const values to the template", () => {
      const jq79 = new Component79(
        `<script :setup="{ fname, lname }">const fullName = fname + " " + lname</script>` +
        `<div class="full-name">{{ fullName }}</div>`
      ).render({ fname: "Ada", lname: "Lovelace" }).mount(host)

      expect($(host, ".full-name")?.textContent).toBe("Ada Lovelace")
      jq79.destroy()
    })

    it("a top-level destructuring declaration is reactive, like any other declaration", () => {
      // the pattern is rewritten to an assignment pattern inside `with`, so
      // both bindings land on the store - renamed ones under their *bound*
      // name (see TODOS/2026-07-15.setup-destructuring.md)
      const jq79 = new Component79(
        `<script :setup>let { a, b: renamed } = { a: 1, b: 2 }</script>` +
        `<div class="out">{{ a }}-{{ renamed }}</div>`
      ).render().mount(host)

      expect($(host, ".out")?.textContent).toBe("1-2")

      jq79.data!.a = 9
      expect($(host, ".out")?.textContent).toBe("9-2")
      jq79.destroy()
    })

    it("a </script> inside a script string truncates the block and the mount throws", () => {
      // the HTML parser (and RAW_BLOCK_RE with it) closes the script at the
      // first </script>, exactly like a browser would with an inline script.
      // The leftover `const s = "` is a SyntaxError at compile time - loud,
      // synchronous, and pinned here so the failure mode stays known
      const jq79 = new Component79(
        `<script :setup>const s = "</script>"; let x = 1</script><div class="t">{{ x }}</div>`
      )

      expect(jq79.scripts[0].content).toBe(`const s = "`)
      expect(() => jq79.mount(host)).toThrow(SyntaxError)
    })

    it("makes top-level let variables reactive scope properties", () => {
      const jq79 = new Component79(
        `<script :setup>let count = 0</script><div class="count">{{ count }}</div>`
      ).render().mount(host)

      expect($(host, ".count")?.textContent).toBe("0")

      jq79.data!.count = 5
      expect($(host, ".count")?.textContent).toBe("5")
      jq79.destroy()
    })

    it("re-runs $: reactive declarations when their dependencies change", () => {
      const src = "<script :setup>\nlet a = 2\n$: doubled = `${ a * 2 }`\n</script><div class='dbl'>{{ doubled }}</div>"
      const jq79 = new Component79(src).render().mount(host)

      expect($(host, ".dbl")?.textContent).toBe("4")

      jq79.data!.a = 10
      expect($(host, ".dbl")?.textContent).toBe("20")
      jq79.destroy()
    })

    it("re-runs a $: declaration written as a multi-line chain", () => {
      const src = [
        "<script :setup>",
        "let items = [1, 2, 3]",
        "$: doubled = items",
        "  .map(n => n * 2)",
        "  .join(',')",
        "</script>",
        "<p class='chain'>{{ doubled }}</p>",
      ].join("\n")
      const jq79 = new Component79(src).render().mount(host)

      expect($(host, ".chain")?.textContent).toBe("2,4,6")

      jq79.data!.items = [5]
      expect($(host, ".chain")?.textContent).toBe("10")
      jq79.destroy()
    })

    it("updates the DOM from async assignments in setup code (the fetch-user example)", async () => {
      vi.stubGlobal("loadUser", () => Promise.resolve({ firstName: "Ada", lastName: "Lovelace" }))

      const src = [
        "<script :setup>",
        "let firstName = null",
        "let lastName = null",
        "$: fullName = firstName && lastName ? `${ firstName } ${ lastName }` : ''",
        "",
        "loadUser()",
        "  .then(user => {",
        "    firstName = user.firstName",
        "    lastName = user.lastName",
        "  })",
        "</script>",
        "",
        "<div :if='fullName' class='user-info'>",
        "  <span>{{ fullName }} from {{ firstName }} and {{ lastName }}</span>",
        "</div>",
      ].join("\n")

      const jq79 = new Component79(src).render().mount(host)
      expect($(host, ".user-info")).toBeNull()

      await Promise.resolve()
      await Promise.resolve()

      expect($(host, ".user-info span")?.textContent).toBe("Ada Lovelace from Ada and Lovelace")
      jq79.destroy()
    })

    it("keeps bare assignments on the component scope instead of leaking to globalThis", () => {
      const jq79 = new Component79(
        `<script :setup>leakCheck = "scoped"</script><div class="leak">{{ leakCheck }}</div>`
      ).render().mount(host)

      expect($(host, ".leak")?.textContent).toBe("scoped")
      expect((globalThis as any).leakCheck).toBeUndefined()
      jq79.destroy()
    })

    it("still resolves real globals inside setup scripts", () => {
      const jq79 = new Component79(
        `<script :setup>const upper = String("ok").toUpperCase()</script><div class="g">{{ upper }}</div>`
      ).render().mount(host)

      expect($(host, ".g")?.textContent).toBe("OK")
      jq79.destroy()
    })

    it("exposes the $, $$ and $create DOM helpers to setup scripts without declaring them", () => {
      document.body.insertAdjacentHTML("beforeend", `<div class="probe">one</div><div class="probe">two</div>`)

      const jq79 = new Component79(
        `<script :setup>` +
        `const first = $(".probe").textContent\n` +
        `const total = $$(".probe").length\n` +
        `const made = $create("span", { className: "made" }).className\n` +
        `</script>` +
        `<div class="helpers">{{ first }} {{ total }} {{ made }}</div>`
      ).render().mount(host)

      expect($(host, ".helpers")?.textContent).toBe("one 2 made")

      $$(".probe").forEach(el => el.remove())
      jq79.destroy()
    })

    it("exposes $reactive to setup scripts", () => {
      const jq79 = new Component79(
        `<script :setup>` +
        `const local = $reactive({ n: 1 })\n` +
        `let seen = local.n\n` +
        `local.$on("n", value => { seen = value })\n` +
        `local.n = 7\n` +
        `</script>` +
        `<div class="rx">{{ seen }}</div>`
      ).render().mount(host)

      expect($(host, ".rx")?.textContent).toBe("7")
      jq79.destroy()
    })

    it("exposes $toRaw to setup scripts", () => {
      const user = { name: "Jesús" }
      const jq79 = new Component79(
        `<script :setup="{ user }">` +
        // `user` reads back as a proxy; $toRaw hands the very object the
        // component was rendered with, wrapping and all removed
        `const unwrapped = $toRaw(user) !== user\n` +
        `const name = $toRaw(user).name\n` +
        `</script>` +
        `<div class="raw">{{ unwrapped }} {{ name }}</div>`
      ).render({ user }).mount(host)

      expect($(host, ".raw")?.textContent).toBe("true Jesús")
      jq79.destroy()
    })

    it("exposes $emit, dispatching a bubbling CustomEvent with the payload as detail", () => {
      const src =
        `<script :setup>const fire = payload => $emit("child-event", payload)</script>` +
        `<button class="btn" @click="fire('hello')">go</button>`
      const jq79 = new Component79(src).render().mount(host)

      const seen: any[] = []
      host.addEventListener("child-event", event => seen.push((event as CustomEvent).detail))

      $(host, ".btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))

      expect(seen).toEqual(["hello"])
      jq79.destroy()
    })

    it("lets a parent component catch a child's $emit via @event on a wrapping element", () => {
      const child = new Component79(
        `<script :setup>const notify = () => $emit("child-saved", 42)</script>` +
        `<button class="child-btn" @click="notify">save</button>`
      )
      const jq79 = new Component79(
        `<div class="wrap" @child-saved="got = $event.detail"><ChildComp></ChildComp></div>` +
        `<span class="got">{{ got }}</span>`
      ).render({ got: "", ChildComp: child }).mount(host)

      $(host, ".child-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))

      expect($(host, ".got")?.textContent).toBe("42")
      jq79.destroy()
    })

    it("lets scope properties shadow same-named DOM helpers", () => {
      const jq79 = new Component79(
        `<script :setup>const picked = $("ignored")</script><div class="shadow">{{ picked }}</div>`
      ).render({ $: () => "from scope" }).mount(host)

      expect($(host, ".shadow")?.textContent).toBe("from scope")
      jq79.destroy()
    })

    it("resumes `await $mounted()` once the component's DOM is in the document", async () => {
      const src = [
        "<script :setup>",
        "let found = 'pending'",
        "await $mounted()",
        "found = $('.probe').tagName   // plain document querySelector",
        "</script>",
        `<span class="probe">{{ found }}</span>`,
      ].join("\n")
      const jq79 = new Component79(src).render().mount(host)

      // template rendered with the pre-await value
      expect($(host, ".probe")?.textContent).toBe("pending")

      await new Promise(resolve => setTimeout(resolve, 0))

      expect($(host, ".probe")?.textContent).toBe("SPAN")
      jq79.destroy()
    })

    it("keeps let declarations after `await $mounted()` reactive", async () => {
      const src = [
        "<script :setup>",
        "await $mounted()",
        "let label = 'ready'",
        "</script>",
        `<div class="late">{{ label }}</div>`,
      ].join("\n")
      const jq79 = new Component79(src).render().mount(host)

      expect($(host, ".late")?.textContent).toBe("")

      await new Promise(resolve => setTimeout(resolve, 0))
      expect($(host, ".late")?.textContent).toBe("ready")

      jq79.data!.label = "changed"
      expect($(host, ".late")?.textContent).toBe("changed")
      jq79.destroy()
    })

    it("does not run the script tail until mount() is actually called", async () => {
      const jq79 = new Component79(
        `<script :setup>let state = "before"\nawait $mounted()\nstate = "after"</script>` +
        `<div class="st">{{ state }}</div>`
      ).render()

      await new Promise(resolve => setTimeout(resolve, 0))
      expect(jq79.data!.state).toBe("before")

      jq79.mount(host)
      await new Promise(resolve => setTimeout(resolve, 0))

      expect($(host, ".st")?.textContent).toBe("after")
      jq79.destroy()
    })

    it("scopes $self/$$self to the component's own nodes, ignoring outside DOM", async () => {
      document.body.insertAdjacentHTML("beforeend", `<div class="scoped-probe">decoy</div>`)

      const src = [
        "<script :setup>",
        "await $mounted()",
        "let first = $self('.scoped-probe').textContent",
        "let count = $$self('.scoped-probe').length",
        "let missing = $self('.nope')",
        "</script>",
        `<div class="scoped-probe">mine</div>`,
        `<section><span class="scoped-probe">deep</span></section>`,
        `<div class="scoped-out">{{ first }} {{ count }}</div>`,
      ].join("\n")
      const jq79 = new Component79(src).render().mount(host)

      await new Promise(resolve => setTimeout(resolve, 0))

      // top-level match first, nested match counted, decoy outside ignored
      expect($(host, ".scoped-out")?.textContent).toBe("mine 2")
      expect(jq79.data!.missing).toBeNull()

      $$(".scoped-probe").forEach(el => { if (!host.contains(el)) el.remove() })
      jq79.destroy()
    })

    it("$self works while the component is rendered but not yet mounted", () => {
      const jq79 = new Component79(
        `<script :setup>const probe = () => $self(".detached-probe")</script>` +
        `<i class="detached-probe">x</i>`
      ).render()

      expect((jq79.data as any).probe()?.textContent).toBe("x")
      jq79.destroy()
    })

    it("defers a <script :setup :mounted> block entirely until mount", async () => {
      const jq79 = new Component79(
        `<script :setup :mounted>let tag = $self(".target").tagName</script>` +
        `<b class="target">{{ tag }}</b>`
      ).render().mount(host)

      // rendered before the deferred script ran
      expect($(host, ".target")?.textContent).toBe("")

      await new Promise(resolve => setTimeout(resolve, 0))

      expect($(host, ".target")?.textContent).toBe("B")
      jq79.destroy()
    })

    it("resumes `await $mounted()` in nested components after the whole tree is attached", async () => {
      const child = new Component79(
        `<script :setup>let tag = ""\nawait $mounted()\ntag = $(".m-outer .m-inner").tagName</script>` +
        `<em class="m-inner">{{ tag }}</em>`
      )
      const jq79 = new Component79(
        `<div class="m-outer"><NestedChild></NestedChild></div>`
      ).render({ NestedChild: child }).mount(host)

      await new Promise(resolve => setTimeout(resolve, 0))

      // the child found itself through a document-level selector that
      // requires its ancestors to be attached too
      expect($(host, ".m-inner")?.textContent).toBe("EM")
      jq79.destroy()
    })
  })

  describe("the first render waits for the setup script", () => {
    const flush = () => new Promise(resolve => setTimeout(resolve, 0))
    // a promise the test decides when to settle, standing in for a fetch
    const deferred = () => {
      let settle!: (value?: any) => void
      return { promise: new Promise(resolve => { settle = resolve }), settle }
    }

    it("renders nothing until an awaited value lands, then renders once, complete", async () => {
      const rows = deferred()
      vi.stubGlobal("loadRows", () => rows.promise)
      const jq79 = new Component79(
        `<script :setup>let rows = await loadRows()</script>` +
        `<h1 class="chrome">Rows</h1><p class="row" :each="r in rows">{{ r }}</p>`
      ).render().mount(host)

      // the static heading waits too: the unit that is held back is the
      // template, and there is no finer one
      expect($(host, ".chrome")).toBeNull()
      expect($$(host, ".row")).toHaveLength(0)

      rows.settle(["a", "b"])
      await flush()

      expect($(host, ".chrome")?.textContent).toBe("Rows")
      expect($$(host, ".row").map(el => el.textContent)).toEqual(["a", "b"])
      jq79.destroy()
    })

    it("paints immediately when the script yields with $mounted() first", async () => {
      const rows = deferred()
      vi.stubGlobal("loadRows", () => rows.promise)
      const jq79 = new Component79(
        `<script :setup>await $mounted()\nlet rows = await loadRows()</script>` +
        `<h1 class="chrome">Rows</h1><p class="row" :each="r in rows">{{ r }}</p>`
      ).render().mount(host)

      // yielding is synchronous, so this is the same stack render() has always
      // painted on - no await needed to see the chrome
      expect($(host, ".chrome")?.textContent).toBe("Rows")
      expect($$(host, ".row")).toHaveLength(0)

      rows.settle(["a"])
      await flush()

      expect($$(host, ".row").map(el => el.textContent)).toEqual(["a"])
      jq79.destroy()
    })

    it("waits for a script that is still running even when a later one yields", async () => {
      const slow = deferred()
      vi.stubGlobal("slowThing", () => slow.promise)
      const jq79 = new Component79(
        `<script :setup>let first = await slowThing()</script>` +
        `<script :setup>await $mounted()\nlet second = "b"</script>` +
        `<div class="both">{{ first }}{{ second }}</div>`
      ).render().mount(host)

      // the gate is per script: the second yielding must not speak for the first
      expect($(host, ".both")).toBeNull()

      slow.settle("a")
      await flush()

      expect($(host, ".both")?.textContent).toBe("ab")
      jq79.destroy()
    })

    it("paints nothing and throws nothing when destroyed before the gate opens", async () => {
      const held = deferred()
      vi.stubGlobal("held", () => held.promise)
      const jq79 = new Component79(
        `<script :setup>let value = await held()</script><div class="late">{{ value }}</div>`
      ).render().mount(host)

      jq79.destroy()
      held.settle("too late")
      await flush()

      expect($(host, ".late")).toBeNull()
      expect(host.innerHTML).toBe("")
    })

    it("mounts a parent whose child is still waiting, and fills the child in after", async () => {
      const label = deferred()
      vi.stubGlobal("loadLabel", () => label.promise)
      const child = new Component79(
        `<script :setup>let label = await loadLabel()</script><em class="kid">{{ label }}</em>`
      )
      const jq79 = new Component79(
        `<div class="parent"><Kid /></div>`
      ).render({ Kid: child }).mount(host)

      // renderNodes is synchronous, so the parent does not wait for the child:
      // it mounts around the child's markers and the child arrives later
      expect($(host, ".parent")).not.toBeNull()
      expect($(host, ".kid")).toBeNull()

      label.settle("here")
      await flush()

      expect($(host, ".kid")?.textContent).toBe("here")
      jq79.destroy()
    })

    it("warns when :mounted is put on a factory script", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const jq79 = new Component79(
        `<script :setup :mounted>export default () => ({ count: 0 })</script><p>{{ count }}</p>`
      ).render().mount(host)

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("none of its bindings exist yet"))
      warn.mockRestore()
      jq79.destroy()
    })

    it("warns, and keeps waiting, when a script never settles", async () => {
      vi.useFakeTimers()
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const stuck = deferred()
      vi.stubGlobal("never", () => stuck.promise)
      const jq79 = new Component79(
        `<script :setup>let value = await never()</script><div class="never">hi</div>`
      ).render().mount(host)

      expect(warn).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(3000)

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("await $mounted()"))
      // the warning is a diagnosis, not a fallback: nothing was rendered on the
      // strength of a timer
      expect($(host, ".never")).toBeNull()

      warn.mockRestore()
      vi.useRealTimers()
      jq79.destroy()
      // let the script finish after all. An unsettled one keeps trackScript's
      // pendingScripts counter above zero for the life of the module, and that
      // counter gates the missing-name flush for *every* component - so a test
      // that walked away from a hanging script would silence the reporting
      // tests further down this file
      stuck.settle()
      await flush()
    })
  })

  describe("instance events: on() / off()", () => {
    const src =
      `<script :setup>const fire = payload => $emit("submit", payload)</script>` +
      `<button class="btn" @click="fire('sent')">go</button>`

    it("delivers $emit events to on() listeners with (event, payload), chainable before render", () => {
      const seen: any[] = []
      const jq79 = new Component79(src)
        .on("submit", (e, payload) => seen.push([e.detail, payload]))
        .render()
        .mount(host)

      $(host, ".btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))

      expect(seen).toEqual([["sent", "sent"]])
      jq79.destroy()
    })

    it("off() unsubscribes a listener", () => {
      const seen: any[] = []
      const listener = (_e: CustomEvent, payload: any) => seen.push(payload)
      const jq79 = new Component79(src).on("submit", listener).render().mount(host)

      $(host, ".btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      jq79.off("submit", listener)
      $(host, ".btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))

      expect(seen).toEqual(["sent"])
      jq79.destroy()
    })

    it("hears emits while the component is detached, where nothing bubbles", () => {
      const seen: any[] = []
      const jq79 = new Component79(src).on("submit", (_e, payload) => seen.push(payload)).render()

      ;(jq79.data as any).fire("early")

      expect(seen).toEqual(["early"])
      jq79.destroy()
    })

    it("survives re-render, and ignores emits from a stale render generation", () => {
      const seen: any[] = []
      const jq79 = new Component79(src).on("submit", (_e, payload) => seen.push(payload)).render().mount(host)
      const staleFire = (jq79.data as any).fire

      jq79.render().mount(host)

      staleFire("stale")
      ;(jq79.data as any).fire("current")

      expect(seen).toEqual(["current"])
      jq79.destroy()
    })

    // the template's root scope answers $emit too (see templateScope in
    // renderWith) - inline handlers can emit without a setup function
    it("makes $emit callable inline from template expressions", () => {
      const seen: any[] = []
      const jq79 = new Component79(`<button class="btn" @click="$emit('submit', 'inline')">go</button>`)
        .on("submit", (_e, payload) => seen.push(payload))
        .render()
        .mount(host)

      $(host, ".btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))

      expect(seen).toEqual(["inline"])
      jq79.destroy()
    })

    it("lets a store key named $emit shadow the template helper", () => {
      const jq79 = new Component79(`<p class="shadow">{{ $emit }}</p>`).render({ $emit: "mine" }).mount(host)

      expect($(host, ".shadow")?.textContent).toBe("mine")
      jq79.destroy()
    })
  })

  describe("nested components", () => {
    it("renders a component passed via data, with shorthand and literal props", () => {
      const child = new Component79(`<span class="child">{{ title }} / {{ user.name }}</span>`)
      const jq79 = new Component79(
        `<div><NestedChild :user :title="'Hardcoded title'"></NestedChild></div>`
      ).render({ user: { name: "Ada" }, NestedChild: child }).mount(host)

      expect($(host, ".child")?.textContent).toBe("Hardcoded title / Ada")
      jq79.destroy()
    })

    // a `$reactive` handed to several components is the shared-state case: each
    // one wraps it in its own store, and a write from any of them - or from
    // outside - has to reach all of them. Before the stores bridged what they
    // nest, a child's write updated the child alone and the parent's DOM went
    // stale, leaving $emit as the only way back up
    it("shares a `$reactive` store between parent and children, in both directions", () => {
      const cart = $reactive({ items: [] as string[] })
      const child = new Component79(
        `<button class="child" @click="cart.items = [...cart.items, 'from child']">{{ cart.items.length }}</button>`
      )
      const jq79 = new Component79(
        `<div><p class="parent">{{ cart.items.length }}</p><CartChild :cart /><CartChild :cart /></div>`
      ).render({ cart, CartChild: child }).mount(host)

      const [first, second] = $$(host, ".child")
      expect($(host, ".parent")?.textContent).toBe("0")

      first.dispatchEvent(new MouseEvent("click", { bubbles: true }))

      expect($(host, ".parent")?.textContent).toBe("1")
      expect(second.textContent).toBe("1")

      // and the store drives them from outside the component tree too
      cart.items = ["a", "b", "c"]

      expect($(host, ".parent")?.textContent).toBe("3")
      expect(first.textContent).toBe("3")

      // once the tree is gone, the store it was handed keeps none of its listeners
      jq79.destroy()
      expect(() => { cart.items = [] }).not.toThrow()
    })

    it("passes a plain (non-`:`) attribute to the child as a literal string prop", () => {
      const child = new Component79(`<span class="child">{{ title }}</span>`)
      const jq79 = new Component79(
        `<div><NestedChild title="Hardcoded title"></NestedChild></div>`
      ).render({ title: "outer", NestedChild: child }).mount(host)

      // the literal wins over the same-named property in the parent scope
      expect($(host, ".child")?.textContent).toBe("Hardcoded title")
      jq79.destroy()
    })

    it("upgrades a late-arriving component tag exactly once, ignoring later new keys", () => {
      const child = new Component79(`<span class="child">child</span>`)
      const jq79 = new Component79(`<div><late-child></late-child></div>`).render({}).mount(host)

      expect($(host, ".child")).toBeNull() // an unknown element placeholder for now

      jq79.data!.LateChild = child
      expect($$(host, ".child")).toHaveLength(1)
      const upgraded = $(host, ".child")

      // a later new key sweeps the store again: the placeholder is already gone,
      // so the upgrade effect must not render a second child
      jq79.data!.somethingElse = 1
      expect($$(host, ".child")).toHaveLength(1)
      expect($(host, ".child")).toBe(upgraded)

      jq79.destroy()
    })

    it("tears the child down when its definition is replaced by a non-component", () => {
      const child = new Component79(`<span class="child">{{ user.name }}</span>`)
      const jq79 = new Component79(
        `<div><NestedChild :user></NestedChild></div>`
      ).render({ user: { name: "Ada" }, NestedChild: child as any }).mount(host)

      expect($(host, ".child")).not.toBeNull()

      jq79.data!.NestedChild = null

      expect($(host, ".child")).toBeNull()
      jq79.destroy()
    })

    it("does not pass control attrs or @event handlers to the child as props", () => {
      const child = new Component79(`<span class="child">{{ user.name }}|{{ show }}|{{ click }}</span>`)
      const jq79 = new Component79(
        `<div><NestedChild :if="show" :user @click="noop()"></NestedChild></div>`
      ).render({ show: true, user: { name: "Ada" }, noop: () => {}, NestedChild: child }).mount(host)

      // only `user` came through as a prop: `:if` and `@click` stay with the parent
      expect($(host, ".child")?.textContent).toBe("Ada||")
      jq79.destroy()
    })

    it("keeps props live: deep parent mutations update the child", () => {
      const child = new Component79(`<span class="child">{{ user.name }}</span>`)
      const jq79 = new Component79(
        `<div><NestedChild :user></NestedChild></div>`
      ).render({ user: { name: "Ada" }, NestedChild: child }).mount(host)

      expect($(host, ".child")?.textContent).toBe("Ada")

      jq79.data!.user.name = "Grace"
      expect($(host, ".child")?.textContent).toBe("Grace")

      jq79.destroy()
    })

    it("matches kebab-case tags and props against PascalCase/camelCase names", () => {
      const child = new Component79(`<span class="child">{{ userName }}</span>`)
      const jq79 = new Component79(
        `<div><nested-child :user-name="'Ada'"></nested-child></div>`
      ).render({ NestedChild: child }).mount(host)

      expect($(host, ".child")?.textContent).toBe("Ada")
      jq79.destroy()
    })

    it("supports await import('/x.html') in setup scripts, rendering when it resolves", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        text: async () => `<span class="imported">User: {{ user.name }}</span>`,
      })))

      const src = [
        "<script :setup>",
        "const ImportedComponent = await import('/components/foobar.html')",
        "</script>",
        `<div><ImportedComponent :user></ImportedComponent></div>`,
      ].join("\n")

      const jq79 = new Component79(src).render({ user: { name: "Ada" } }).mount(host)
      // still loading: nothing rendered yet
      expect($(host, ".imported")).toBeNull()

      await new Promise(resolve => setTimeout(resolve, 0))

      expect(globalThis.fetch).toHaveBeenCalledWith(new URL("/components/foobar.html", document.baseURI).href)
      expect($(host, ".imported")?.textContent).toBe("User: Ada")
      jq79.destroy()
    })

    it("destroys nested instances when the parent is destroyed", () => {
      const child = new Component79(`<span class="child">{{ label }}</span>`)
      const jq79 = new Component79(
        `<div><NestedChild :label="label"></NestedChild></div>`
      ).render({ label: "x", NestedChild: child }).mount(host)

      const childEl = $(host, ".child")!
      const data = jq79.data!
      jq79.destroy()

      data.label = "y"
      expect(childEl.textContent).toBe("x") // child effects disposed with the parent
    })

    // a component renders as a fragment (two anchors with the instance's DOM
    // between them), and a fragment empties itself on insertion - :each and :if
    // used to hold the fragment as their handle to the entry/branch, so keyed
    // reorders moved nothing and removals left the anchors behind
    it("reorders a keyed :each of components, keeping unchanged instances", () => {
      const child = new Component79(`<span class="card">{{ item.label }}</span>`)
      const jq79 = new Component79(
        `<div class="list"><Card :each="item in items" :key="item.id" :item></Card><b class="tail">tail</b></div>`
      ).render({
        Card: child,
        items: [
          { id: 1, label: "one" },
          { id: 2, label: "two" },
          { id: 3, label: "three" },
        ],
      }).mount(host)

      const labels = () => $$(host, ".card").map(el => el.textContent)
      expect(labels()).toEqual(["one", "two", "three"])
      const [firstCard] = $$(host, ".card")

      const data = jq79.data!
      data.items = [data.items[2], data.items[0], data.items[1]]

      expect(labels()).toEqual(["three", "one", "two"])
      // same key, same item: the instance's DOM moved rather than being rebuilt
      expect($$(host, ".card")[1]).toBe(firstCard)
      // and repositioning didn't push the list's following sibling around
      expect($(host, ".list")?.lastElementChild?.className).toBe("tail")

      jq79.destroy()
    })

    it("removes :each component entries whole - anchors included, churn after churn", () => {
      const child = new Component79(`<span class="card">{{ item.label }}</span>`)
      const jq79 = new Component79(
        `<div class="list"><Card :each="item in items" :key="item.id" :item></Card></div>`
      ).render({
        Card: child,
        items: [{ id: 1, label: "one" }, { id: 2, label: "two" }],
      }).mount(host)

      const list = $(host, ".list")!
      const data = jq79.data!

      data.items = [data.items[0]]
      expect($$(host, ".card").map(el => el.textContent)).toEqual(["one"])
      const settled = list.childNodes.length

      data.items = [data.items[0], { id: 3, label: "three" }]
      data.items = [data.items[0]]

      expect($$(host, ".card").map(el => el.textContent)).toEqual(["one"])
      expect(list.childNodes.length).toBe(settled) // nothing accumulates
      jq79.destroy()
    })

    it("switches :if away from a component without leaving its anchors behind", () => {
      const child = new Component79(`<span class="card">on</span>`)
      const jq79 = new Component79(
        `<div class="box"><Card :if="show"></Card><p :else class="off">off</p></div>`
      ).render({ Card: child, show: true }).mount(host)

      const box = $(host, ".box")!
      const data = jq79.data!

      data.show = false
      const settled = box.childNodes.length
      for (let i = 0; i < 5; i++) {
        data.show = true
        data.show = false
      }

      expect(box.childNodes.length).toBe(settled) // nothing accumulates
      expect($(host, ".off")).not.toBeNull()
      data.show = true
      expect($(host, ".card")).not.toBeNull()
      jq79.destroy()
    })

    it("cleans up an upgraded late component when its :if branch goes away", () => {
      const child = new Component79(`<span class="card">late</span>`)
      const jq79 = new Component79(
        `<div class="box"><late-card :if="show"></late-card><p :else class="off">off</p></div>`
      ).render({ show: true }).mount(host)

      jq79.data!.LateCard = child
      expect($(host, ".card")).not.toBeNull()

      jq79.data!.show = false

      expect($(host, ".card")).toBeNull()
      expect($(host, ".off")).not.toBeNull()
      // the branch took the upgrade's anchors with it: only :if's own remains
      const comments = Array.from($(host, ".box")!.childNodes).filter(node => node.nodeType === Node.COMMENT_NODE)
      expect(comments.map(node => node.textContent)).toEqual(["if"])
      jq79.destroy()
    })

    it("expands self-closing component tags, keeping siblings intact", () => {
      const First = new Component79(`<span class="first">{{ user.name }}</span>`)
      const Second = new Component79(`<span class="second">{{ user.name }}</span>`)
      const jq79 = new Component79(
        `<div>
          <First :user />
          <Second :user="user" />
        </div>`
      ).render({ user: { name: "Ada" }, First, Second }).mount(host)

      expect($(host, ".first")?.textContent).toBe("Ada")
      expect($(host, ".second")?.textContent).toBe("Ada")
      jq79.destroy()
    })

    it("expands self-closing regular elements too, but leaves void elements and quoted '/>' alone", () => {
      const jq79 = new Component79(
        `<div class="a" /><img class="void" src="x.png" /><div class="b">{{ label }}</div>`
      ).render({ label: "a/> weird" }).mount(host)

      // .a did not swallow its siblings
      expect($(host, ".a")?.childNodes.length).toBe(0)
      expect($(host, ".void")).not.toBeNull()
      expect($(host, ".b")?.textContent).toBe("a/> weird")

      jq79.destroy()
    })

    it("does not rewrite '/>' inside setup script code", () => {
      const jq79 = new Component79(
        `<script :setup>const arrow = "looks like /> inside a string"</script><div class="code">{{ arrow }}</div>`
      ).render().mount(host)

      expect($(host, ".code")?.textContent).toBe("looks like /> inside a string")
      jq79.destroy()
    })

    it("leaves `...` alone outside attribute-name position (text, values, script)", () => {
      const captured: any[] = []
      const jq79 = new Component79(
        `<script :setup>const [first, ...rest] = [1, 2, 3]; recordRest(rest)</script>` +
          `<p class="txt">carga...espera</p>` +
          `<button class="btn" @click="capture([...items])">go</button>`,
      ).render({
        items: [1, 2],
        recordRest: (r: number[]) => captured.push(r),
        capture: (r: number[]) => captured.push(r),
      }).mount(host)

      // text with a literal ellipsis is not an attribute - untouched
      expect($(host, ".txt")?.textContent).toBe("carga...espera")
      // the script's rest-destructuring ran as written
      expect(captured[0]).toEqual([2, 3])
      // a genuine JS spread inside a handler value still evaluates
      ;($(host, ".btn") as HTMLButtonElement).click()
      expect(captured[1]).toEqual([1, 2])
      jq79.destroy()
    })

    it("deduplicates identical head styles across instances via refcounting", () => {
      const parts = new Component79(`<span class="s">x</span><style>.s { color: red; }</style>`)
      const stylesBefore = document.head.querySelectorAll("style").length

      const a = new Component79(parts).render().mount(host)
      const b = new Component79(parts).render().mount(host)
      expect(document.head.querySelectorAll("style").length).toBe(stylesBefore + 1)

      a.destroy()
      expect(document.head.querySelectorAll("style").length).toBe(stylesBefore + 1)

      b.destroy()
      expect(document.head.querySelectorAll("style").length).toBe(stylesBefore)
    })
  })

  // a relative specifier means "next to the file that wrote it". Neither branch
  // of importResource would land there on its own: native import() resolves
  // against the library module (dist/jq79.js) and fetch() against the page, so
  // the same `./x` meant two different places depending on the extension, and
  // neither was the component
  describe("relative imports in a script", () => {
    // runs a setup script and reports both of the places its import() could
    // show up: the URL fetch was handed (the .html branch) and whatever the
    // native import() rejected with (every other branch)
    const runImport = async (source: string, filename?: string) => {
      const fetched = vi.fn(async () => ({ ok: true, text: async () => `<i class="child"></i>` }))
      vi.stubGlobal("fetch", fetched)
      const failed: string[] = []
      const consoleError = vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
        failed.push(String(args[1]))
      })

      const src = `<script :setup>\n${source}\n</script>\n<p>x</p>`
      const jq79 = new Component79(src, filename === undefined ? {} : { filename }).render({}).mount(host)
      // a fetch lands next tick; a native import() that finds nothing takes
      // the module loader a few more, so wait for whichever arrives
      await vi.waitFor(() => {
        if (!fetched.mock.calls.length && !failed.length) throw new Error("the import is still in flight")
      })
      consoleError.mockRestore()
      jq79.destroy()

      return {
        fetched: fetched.mock.calls.length ? String((fetched.mock.calls[0] as any[])[0]) : null,
        error: failed.join("\n"),
      }
    }

    // where a .html specifier was fetched from - the one branch that says out
    // loud what it resolved to
    const fetchedFrom = async (spec: string, filename?: string): Promise<string | null> =>
      (await runImport(`const Row = await import(${JSON.stringify(spec)})`, filename)).fetched

    // a resolved specifier is fully absolute, because a path would send the
    // native import() branch to the *library's* origin - see resolveSpecifier
    const onPage = (path: string) => new URL(path, document.baseURI).href

    it("resolves a .html component against its own directory, not the page", async () => {
      expect(await fetchedFrom("./row.html", "/components/app.html")).toBe(onPage("/components/row.html"))
    })

    it("walks up out of the component's directory with ../", async () => {
      expect(await fetchedFrom("../shared/row.html", "/components/app.html")).toBe(onPage("/shared/row.html"))
    })

    it("resolves a filename that is itself relative, by way of the page", async () => {
      // what an import() in a *parent* records: fetchComponent stores the URL
      // it was handed, and a relative URL cannot be a base
      expect(await fetchedFrom("./row.html", "./components/app.html")).toBe(onPage("/components/row.html"))
    })

    it("keeps a component served from another origin on that origin", async () => {
      expect(await fetchedFrom("./row.html", "https://cdn.example.com/pkg/app.html"))
        .toBe("https://cdn.example.com/pkg/row.html")
    })

    it("falls back to the page for a component with no filename", async () => {
      // an inline component came from a string, so it has nowhere else to be
      expect(await fetchedFrom("./row.html")).toBe(onPage("/row.html"))
    })

    it("leaves a full URL as written", async () => {
      expect(await fetchedFrom("https://cdn.example.com/row.html", "/components/app.html"))
        .toBe("https://cdn.example.com/row.html")
    })

    // the .js branch cannot say where it went - node's loader refuses an http
    // URL before naming it ("Received protocol 'http:'") - but that refusal is
    // itself the assertion: it only happens to an *absolute* specifier. A path
    // or a bare name gets the loader's other error, naming the specifier
    // unresolved. Which is the whole bug: a path handed to the native import()
    // is resolved against the library module's origin, and the library is the
    // one file on the page most likely to sit on a CDN
    describe("a .js module, which the native import() takes", () => {
      it("is absolutized when relative, so it can't drift to the library's origin", async () => {
        const { error } = await runImport(
          `const mod = await import("./services/opfs.service.js")`, "/components/app.html"
        )
        expect(error).toContain("protocol 'http:'")
      })

      it("is absolutized when root-absolute too", async () => {
        // `/x.js` means the page's root to whoever wrote it. Passed through, the
        // native import() would resolve it against the library's origin - which
        // is a CDN often enough that this is the CORS error users actually hit
        const { error } = await runImport(
          `const mod = await import("/craft/services/opfs.service.js")`, "/craft/app.html"
        )
        expect(error).toContain("protocol 'http:'")
      })

      it("is left alone when bare, for the import map or the bundler to answer", async () => {
        // resolving a bare specifier would quietly turn it into a path
        const { error } = await runImport(`await import("lodash-es")`, "/components/app.html")
        expect(error).toContain("'lodash-es'")
        expect(error).not.toContain("protocol 'http:'")
      })
    })

    it("consults the bundler's modules map before resolving anything", async () => {
      // the map is keyed by the literal specifier the script wrote, so a
      // bundled component must never see the resolved form
      const row = new Component79(`<i class="row">bundled</i>`)
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("should not fetch") }))

      const src = [
        `<script :setup>`,
        `const Row = await import("./row.html")`,
        `</script>`,
        `<div><Row></Row></div>`,
      ].join("\n")
      const jq79 = new Component79(src, { filename: "/components/app.html", modules: { "./row.html": row } })
        .render({}).mount(host)
      await new Promise(resolve => setTimeout(resolve, 0))

      expect($(host, ".row")?.textContent).toBe("bundled")
      jq79.destroy()
    })
  })

  describe(":model on component tags", () => {
    it("binds the default model both ways: prop down as `model`, $updateModel back up", () => {
      const field = new Component79(
        `<input class="field" :value="model" @input="$updateModel($event.target.value)">`
      )
      const jq79 = new Component79(
        `<div><EmailField :model="email" /><p class="echo">{{ email }}</p></div>`
      ).render({ email: "ada@lovelace.dev", EmailField: field }).mount(host)

      const input = $(host, ".field") as HTMLInputElement
      expect(input.value).toBe("ada@lovelace.dev") // the prop came down

      input.value = "grace@hopper.dev"
      input.dispatchEvent(new Event("input"))

      // ...and the edit came back up, through the echo the wiring looks like
      // it creates (parent assign -> prop sync -> same-value skip) and out
      expect($(host, ".echo")?.textContent).toBe("grace@hopper.dev")

      // down again: a parent reset reaches the child's input
      jq79.data!.email = ""
      expect(input.value).toBe("")
      jq79.destroy()
    })

    it("routes named models by name, multi-line update expressions included", () => {
      const form = new Component79(
        `<form>` +
          `<input class="u" :value="uname" @input="
            $updateModel('uname', $event.target.value)
          ">` +
          `<input class="p" :value="password" @input="$updateModel('password', $event.target.value)">` +
          `</form>`
      )
      const jq79 = new Component79(
        `<div><LoginForm :model.uname="uname" :model.password="password" /></div>`
      ).render({ uname: "", password: "", LoginForm: form }).mount(host)

      const user = $(host, ".u") as HTMLInputElement
      user.value = "ada"
      user.dispatchEvent(new Event("input"))

      expect(jq79.data!.uname).toBe("ada")
      expect(jq79.data!.password).toBe("")
      jq79.destroy()
    })

    it("matches an explicit 'default' name to the bare :model", () => {
      const field = new Component79(
        `<button class="go" @click="$updateModel('default', 'yes')">go</button>`
      )
      const jq79 = new Component79(`<div><Field :model="flag" /></div>`)
        .render({ flag: "no", Field: field }).mount(host)

      ;($(host, ".go") as HTMLButtonElement).click()

      expect(jq79.data!.flag).toBe("yes")
      jq79.destroy()
    })

    it("normalizes kebab-case model names to camelCase, update names included", () => {
      const field = new Component79(
        `<button class="go" @click="$updateModel('userName', 'grace')">{{ userName }}</button>`
      )
      const jq79 = new Component79(`<div><Field :model.user-name="who" /></div>`)
        .render({ who: "ada", Field: field }).mount(host)

      expect($(host, ".go")?.textContent).toBe("ada") // the prop landed under the camel name

      ;($(host, ".go") as HTMLButtonElement).click()

      expect(jq79.data!.who).toBe("grace")
      jq79.destroy()
    })

    it("assigns through a member path, reactively", () => {
      const field = new Component79(
        `<button class="set" @click="$updateModel('Grace')">set</button>`
      )
      const jq79 = new Component79(
        `<div><Field :model="user.name" /><p class="who">{{ user.name }}</p></div>`
      ).render({ user: { name: "Ada" }, Field: field }).mount(host)

      expect($(host, ".who")?.textContent).toBe("Ada")

      ;($(host, ".set") as HTMLButtonElement).click()

      expect($(host, ".who")?.textContent).toBe("Grace")
      jq79.destroy()
    })

    it("expands the shorthand like props do: :model.uname alone binds the variable uname", () => {
      const field = new Component79(
        `<button class="got" @click="$updateModel('uname', 'turing')">{{ uname }}</button>`
      )
      const jq79 = new Component79(`<div><Field :model.uname /></div>`)
        .render({ uname: "ada", Field: field }).mount(host)

      expect($(host, ".got")?.textContent).toBe("ada")

      ;($(host, ".got") as HTMLButtonElement).click()

      expect(jq79.data!.uname).toBe("turing")
      jq79.destroy()
    })

    it("warns on an update whose name nothing on the tag binds, assigning nothing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const field = new Component79(
        `<button class="go" @click="$updateModel('passwrod', 'x')">go</button>`
      )
      const jq79 = new Component79(`<div><Field :model.password="password" /></div>`)
        .render({ password: "keep", Field: field }).mount(host)

      ;($(host, ".go") as HTMLButtonElement).click()
      ;($(host, ".go") as HTMLButtonElement).click()

      // the typo'd name must not type into the void silently - said once,
      // not once per keystroke
      expect(jq79.data!.password).toBe("keep")
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(":model.passwrod"))
      expect(warn).toHaveBeenCalledTimes(1)
      warn.mockRestore()
      jq79.destroy()
    })

    it("warns at wiring time when the expression is not assignable, and drops updates", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const field = new Component79(
        `<button class="go" @click="$updateModel('x')">{{ model }}</button>`
      )
      const jq79 = new Component79(`<div><Field :model="a + b" /></div>`)
        .render({ a: 1, b: 2, Field: field }).mount(host)

      // said before any update happens, not on the first one that vanishes
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("not assignable"))
      expect($(host, ".go")?.textContent).toBe("3") // the prop still flows down

      ;($(host, ".go") as HTMLButtonElement).click() // dropped, without throwing

      expect(jq79.data!.a).toBe(1)
      warn.mockRestore()
      jq79.destroy()
    })

    it("treats a one-argument object as the value, not as a payload", () => {
      // the whole reason this is a call and not an emit: arity decides, so a
      // value that happens to look like the old { name, value } payload is
      // just a value. The shape can no longer be misread
      const field = new Component79(
        `<button class="go" @click="$updateModel({ name: 'nope', value: 'inner' })">go</button>`
      )
      const jq79 = new Component79(`<div><Field :model="sel" /></div>`)
        .render({ sel: null, Field: field }).mount(host)

      ;($(host, ".go") as HTMLButtonElement).click()

      expect(jq79.data!.sel).toEqual({ name: "nope", value: "inner" })
      jq79.destroy()
    })

    it("returns whether a bound model took the update", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const taken: any[] = []
      const field = new Component79(
        `<script :setup="{ report, model, ok }">report([$updateModel('x'), $updateModel('nope', 'x'), $updateModel('ok', 'y')])</script><i class="c"></i>`
      )
      const jq79 = new Component79(`<div><Field :model="a + b" :model.ok="landed" :report /></div>`)
        .render({ a: 1, b: 2, landed: "", report: (r: any[]) => taken.push(...r), Field: field })
        .mount(host)

      // the unassignable default model and the name nothing binds both report
      // false - and only the third actually wrote
      expect(taken).toEqual([false, false, true])
      expect(jq79.data!.landed).toBe("y")
      warn.mockRestore()
      jq79.destroy()
    })

    it("is a silent no-op when the usage site binds no :model at all", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const took: boolean[] = []
      const field = new Component79(
        `<script :setup="{ report }">report($updateModel('anything'))</script><i class="c"></i>`
      )
      // a child may be designed to work bound or unbound: unbound is a
      // legitimate usage, so it returns false without a lecture
      const jq79 = new Component79(`<div><Field :report /></div>`)
        .render({ report: (r: boolean) => took.push(r), Field: field }).mount(host)

      expect(took).toEqual([false])
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
      jq79.destroy()
    })

    it("warns once when a child still emits the old model:update event, and writes nothing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const field = new Component79(
        `<button class="go" @click="$emit('model:update', { value: 'x' })">go</button>`
      )
      const jq79 = new Component79(`<div><Field :model="flag" /></div>`)
        .render({ flag: "keep", Field: field }).mount(host)

      ;($(host, ".go") as HTMLButtonElement).click()
      ;($(host, ".go") as HTMLButtonElement).click()

      // the event feeds nothing now - which must not be silent, or a component
      // written against the old contract just stops updating its parent
      expect(jq79.data!.flag).toBe("keep")
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("$updateModel"))
      expect(warn).toHaveBeenCalledTimes(1) // per instance, not per emit
      warn.mockRestore()
      jq79.destroy()
    })

    it("warns when :model and an explicit prop bind the same name - the model wins", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const field = new Component79(`<span class="got">{{ uname }}</span>`)
      const jq79 = new Component79(`<div><Field :uname="'explicit'" :model.uname="bound" /></div>`)
        .render({ bound: "model-side", Field: field }).mount(host)

      expect($(host, ".got")?.textContent).toBe("model-side")
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`binds prop "uname"`))
      warn.mockRestore()
      jq79.destroy()
    })

    it("warns that :model does nothing on a plain element - components only, for now", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const jq79 = new Component79(`<div><input :model="email"></div>`)
        .render({ email: "x" }).mount(host)

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("component tags only"))
      // and the attribute never landed literally on the element
      expect(($(host, "input") as HTMLInputElement).hasAttribute(":model")).toBe(false)
      warn.mockRestore()
      jq79.destroy()
    })

    it("routes default and named models independently on the same tag", () => {
      const field = new Component79(
        `<button class="d" @click="$updateModel('D')">{{ model }}</button>` +
          `<button class="n" @click="$updateModel('extra', 'N')">{{ extra }}</button>`
      )
      const jq79 = new Component79(`<div><Field :model="main" :model.extra="extra" /></div>`)
        .render({ main: "m", extra: "e", Field: field }).mount(host)

      expect($(host, ".d")?.textContent).toBe("m")
      expect($(host, ".n")?.textContent).toBe("e")

      ;($(host, ".d") as HTMLButtonElement).click()
      ;($(host, ".n") as HTMLButtonElement).click()

      expect(jq79.data!.main).toBe("D")
      expect(jq79.data!.extra).toBe("N")
      jq79.destroy()
    })

    it("accepts the update name in kebab-case too", () => {
      const field = new Component79(
        `<button class="go" @click="$updateModel('user-name', 'grace')">go</button>`
      )
      const jq79 = new Component79(`<div><Field :model.user-name="who" /></div>`)
        .render({ who: "ada", Field: field }).mount(host)

      ;($(host, ".go") as HTMLButtonElement).click()

      expect(jq79.data!.who).toBe("grace")
      jq79.destroy()
    })

    it("assigns undefined when the update carries no value - one rule, no special case", () => {
      const field = new Component79(
        `<button class="go" @click="$updateModel('uname', undefined)">go</button>`
      )
      const jq79 = new Component79(`<div><Field :model.uname /></div>`)
        .render({ uname: "ada", Field: field }).mount(host)

      ;($(host, ".go") as HTMLButtonElement).click()

      expect(jq79.data!.uname).toBeUndefined()
      jq79.destroy()
    })

    it("round-trips object values, both directions", () => {
      const field = new Component79(
        `<button class="go" @click="$updateModel({ id: model.id + 1 })">{{ model.id }}</button>`
      )
      const jq79 = new Component79(`<div><Field :model="sel" /></div>`)
        .render({ sel: { id: 1 }, Field: field }).mount(host)

      expect($(host, ".go")?.textContent).toBe("1")

      ;($(host, ".go") as HTMLButtonElement).click()

      // the fresh object landed on the parent, and came back down as the prop
      expect(jq79.data!.sel.id).toBe(2)
      expect($(host, ".go")?.textContent).toBe("2")
      jq79.destroy()
    })

    it("keeps every tag bound to the same variable in sync", () => {
      const viewer = new Component79(`<span class="view">{{ model }}</span>`)
      const editor = new Component79(
        `<button class="edit" @click="$updateModel('edited')">go</button>`
      )
      const jq79 = new Component79(`<div><Viewer :model="shared" /><Editor :model="shared" /></div>`)
        .render({ shared: "start", Viewer: viewer, Editor: editor }).mount(host)

      expect($(host, ".view")?.textContent).toBe("start")

      ;($(host, ".edit") as HTMLButtonElement).click()

      // the editor's writeback reached the parent, and the parent's prop sync
      // reached the *other* instance - the actual two-way promise
      expect($(host, ".view")?.textContent).toBe("edited")
      jq79.destroy()
    })

    it("follows the item, not the position, through a keyed :each reorder", () => {
      const field = new Component79(
        `<button class="f" @click="$updateModel(model + '!')">{{ model }}</button>`
      )
      const jq79 = new Component79(
        `<div><Field :each="item in items" :key="item.id" :model="item.text" /></div>`
      ).render({
        Field: field,
        items: [
          { id: 1, text: "a" },
          { id: 2, text: "b" },
          { id: 3, text: "c" },
        ],
      }).mount(host)

      const texts = () => $$(host, ".f").map(el => el.textContent)

      ;($$(host, ".f")[1] as HTMLButtonElement).click()

      const data = jq79.data!
      expect(data.items.map((item: any) => item.text)).toEqual(["a", "b!", "c"])
      expect(texts()).toEqual(["a", "b!", "c"]) // and the prop followed back down

      // reorder, then write through the instance now sitting where another was
      data.items = [data.items[2], data.items[0], data.items[1]]
      expect(texts()).toEqual(["c", "a", "b!"])

      ;($$(host, ".f")[1] as HTMLButtonElement).click()

      // the writeback hit the item that moved there (id 1), not old position 1
      expect(data.items.map((item: any) => item.text)).toEqual(["c", "a!", "b!"])
      jq79.destroy()
    })

    it("writes through a :with narrowing, and reads the prop through it", () => {
      const field = new Component79(
        `<input class="i" :value="model" @input="$updateModel($event.target.value)">`
      )
      const jq79 = new Component79(`<div :with="form"><Field :model="uname" /></div>`)
        .render({ form: { uname: "ada" }, Field: field }).mount(host)

      const input = $(host, ".i") as HTMLInputElement
      expect(input.value).toBe("ada")

      input.value = "grace"
      input.dispatchEvent(new Event("input"))

      // the assignment resolved against the narrowed object, not the root scope
      expect(jq79.data!.form.uname).toBe("grace")
      expect(jq79.data!.uname).toBeUndefined()
      jq79.destroy()
    })

    it("wires :model through the late-upgrade path, without the plain-element warn", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const field = new Component79(
        `<input class="i" :value="model" @input="$updateModel($event.target.value)">`
      )
      const jq79 = new Component79(`<div><late-field :model="email"></late-field></div>`)
        .render({ email: "ada@lovelace.dev" }).mount(host)

      // a tag that may still become a component gets no lecture about elements
      expect(warn).not.toHaveBeenCalled()

      jq79.data!.LateField = field

      const input = $(host, ".i") as HTMLInputElement
      expect(input.value).toBe("ada@lovelace.dev") // the prop came down on upgrade

      input.value = "grace@hopper.dev"
      input.dispatchEvent(new Event("input"))

      expect(jq79.data!.email).toBe("grace@hopper.dev")
      warn.mockRestore()
      jq79.destroy()
    })

    it("rewires a swapped definition: the new instance seeds from and writes to the same binding", () => {
      const first = new Component79(`<span class="v1">{{ model }}</span>`)
      const second = new Component79(
        `<button class="v2" @click="$updateModel(model + '+')">{{ model }}</button>`
      )
      const jq79 = new Component79(`<div><Field :model="text" /></div>`)
        .render({ text: "hi", Field: first }).mount(host)

      expect($(host, ".v1")?.textContent).toBe("hi")

      jq79.data!.Field = second
      expect($(host, ".v1")).toBeNull()
      expect($(host, ".v2")?.textContent).toBe("hi")

      ;($(host, ".v2") as HTMLButtonElement).click()

      expect(jq79.data!.text).toBe("hi+")
      jq79.destroy()
    })

    // updates that fire while an effect is mid-run: the writeback and the tag
    // handlers run untracked (a handler's reads are nobody's dependency), and
    // even without that the damage is contained twice over - cross-store deps
    // are never notified, and the creation effect's definition guard no-ops a
    // spurious wake. These pin the visible behavior either way

    it("lets a setup-script update initialize the parent binding - wired before the child renders", () => {
      const field = new Component79(
        `<script :setup="{ model }">$updateModel('init')</script><span class="c">{{ model }}</span>`
      )
      const jq79 = new Component79(`<div><Field :model="user.name" /></div>`)
        .render({ user: { name: "" }, Field: field }).mount(host)

      // the update ran inside the parent's creation effect, and still landed -
      // on the parent and, through the prop sync, back on the child itself
      expect(jq79.data!.user.name).toBe("init")
      expect($(host, ".c")?.textContent).toBe("init")
      const el = $(host, ".c")

      // later parent writes flow normally: same instance, updated in place
      jq79.data!.user.name = "other"

      expect(jq79.data!.user.name).toBe("other")
      expect($(host, ".c")?.textContent).toBe("other")
      expect($(host, ".c")).toBe(el) // the child was not re-created
      jq79.destroy()
    })

    it("settles a $: effect that writes its model back without looping", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const child = new Component79(
        `<script :setup="{ model }">let n = 1\n$: $updateModel(n)</script><i class="c"></i>`
      )
      const jq79 = new Component79(`<div><Field :model="hits" /></div>`)
        .render({ hits: 0, Field: child }).mount(host)

      // the update runs inside the child's own $: effect; the writeback writes
      // the parent's store - one pass, no self-wake (the runtime would cut a
      // loop at 100 rounds with a console.error)
      expect(error).not.toHaveBeenCalled()
      expect(jq79.data!.hits).toBe(1)
      error.mockRestore()
      jq79.destroy()
    })

    it("keeps the writeback alive when the expression carries a trailing comment", () => {
      const field = new Component79(
        `<button class="go" @click="$updateModel('sent')">go</button>`
      )
      // glued on one line, `= $value` would vanish into the comment and the
      // writeback would compile as a bare read - every update silently lost
      const jq79 = new Component79(`<div><Field :model="uname // the username" /></div>`)
        .render({ uname: "ada", Field: field }).mount(host)

      ;($(host, ".go") as HTMLButtonElement).click()

      expect(jq79.data!.uname).toBe("sent")
      jq79.destroy()
    })

    it("stops writing back once the usage site tears the child down", () => {
      let fire: ((value: string) => void) | null = null
      const field = new Component79(
        `<script :setup="{ model, register }">register(v => $updateModel(v))</script><i class="c"></i>`
      )
      const jq79 = new Component79(`<div><Field :model="text" :register /></div>`)
        .render({ text: "start", register: (fn: any) => { fire = fn }, Field: field }).mount(host)

      fire!("live")
      expect(jq79.data!.text).toBe("live")

      // the swap destroys the instance; a closure the old child leaked (a
      // timer, a registered callback) must not keep writing the parent -
      // destroy() nulls the marker, so the stale-generation guard eats it
      jq79.data!.Field = null
      fire!("ghost")

      expect(jq79.data!.text).toBe("live")
      jq79.destroy()
    })

    it("settles a burst of writebacks without effect-loop errors", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const field = new Component79(
        `<input class="i" :value="model" @input="$updateModel($event.target.value)">`
      )
      const jq79 = new Component79(`<div><Field :model="text" /></div>`)
        .render({ text: "", Field: field }).mount(host)

      const input = $(host, ".i") as HTMLInputElement
      for (const text of ["a", "ab", "abc"]) {
        input.value = text
        input.dispatchEvent(new Event("input"))
      }

      expect(jq79.data!.text).toBe("abc")
      expect(input.value).toBe("abc")
      expect(error).not.toHaveBeenCalled()
      error.mockRestore()
      jq79.destroy()
    })
  })

  describe("camelCase names in the template", () => {
    // The HTML parser lowercases attribute and tag names, so every name jq79
    // reads back with kebabToCamel used to have to be authored kebab-case or
    // it landed under the wrong key, silently. expandNameCase rewrites the
    // camelCase spelling to kebab before parsing, so both converge.
    it("passes :userName as the prop userName, like :user-name", () => {
      const child = new Component79(`<p class="out">{{ userName }}</p>`)
      const camel = new Component79(`<div><Field :userName="who" /></div>`)
        .render({ who: "Ada", Field: child }).mount(host)
      expect($(host, ".out")?.textContent).toBe("Ada")
      camel.destroy()

      const kebab = new Component79(`<div><Field :user-name="who" /></div>`)
        .render({ who: "Grace", Field: child }).mount(host)
      expect($(host, ".out")?.textContent).toBe("Grace")
      kebab.destroy()
    })

    it("binds :model.firstName as the model firstName, both ways", () => {
      const field = new Component79(
        `<button class="go" @click="$updateModel('firstName', 'Grace')">{{ firstName }}</button>`
      )
      const jq79 = new Component79(`<div><Field :model.firstName="who" /></div>`)
        .render({ who: "Ada", Field: field }).mount(host)

      expect($(host, ".go")?.textContent).toBe("Ada") // the prop came down under the camel name

      ;($(host, ".go") as HTMLButtonElement).click()

      expect(jq79.data!.who).toBe("Grace") // ...and the writeback found the same model
      jq79.destroy()
    })

    it("round-trips an acronym: :model.userID stays userID", () => {
      const field = new Component79(`<p class="out">{{ userID }}</p>`)
      const jq79 = new Component79(`<div><Field :model.userID="id" /></div>`)
        .render({ id: 42, Field: field }).mount(host)

      expect($(host, ".out")?.textContent).toBe("42")
      jq79.destroy()
    })

    it("matches <slot.firstName> to :slot.firstName, and either spelling to the other", () => {
      new Component79(`
        <script :setup></script>
        <Card><template :slot.firstName><b class="camel">Ada</b></template></Card>
        <Card><template :slot.first-name><b class="kebab">Grace</b></template></Card>
        <template name="Card">
          <section><slot.firstName /></section>
        </template>
      `).render().mount(host)

      expect($(host, ".camel")?.textContent).toBe("Ada")
      expect($(host, ".kebab")?.textContent).toBe("Grace")
    })

    it("rewrites both halves of a <slot.firstName>…</slot.firstName> pair", () => {
      new Component79(`
        <script :setup></script>
        <Card></Card>
        <template name="Card">
          <section class="card"><slot.firstName>fallback</slot.firstName></section>
        </template>
      `).render().mount(host)

      // a mismatched open/close pair would have swallowed or orphaned the text
      expect($(host, ".card")?.textContent?.trim()).toBe("fallback")
    })

    it("leaves quoted values alone - a colon in a value is not a name", () => {
      const jq79 = new Component79(
        `<div><button class="go" style="color: red" @click="flag ? (hit = 'yes') : (hit = 'no')">go</button></div>`
      ).render({ flag: true, hit: "" }).mount(host)

      const button = $(host, ".go") as HTMLButtonElement
      expect(button.getAttribute("style")).toBe("color: red")
      button.click()
      expect(jq79.data!.hit).toBe("yes")
      jq79.destroy()
    })

    it("leaves <script> bodies alone", () => {
      new Component79(`
        <script :setup>
          const firstName = "Ada"
          let fullName = firstName + " Lovelace"
        </script>
        <p class="out">{{ fullName }}</p>
      `).render().mount(host)

      expect($(host, ".out")?.textContent).toBe("Ada Lovelace")
    })

    it("still lets ...userData spread with its camelCase intact", () => {
      const card = new Component79(`<p class="out">{{ name }}/{{ maxAge }}</p>`)
      const jq79 = new Component79(`<div><Card ...userData :maxAge="cap" /></div>`)
        .render({ userData: { name: "Ada" }, cap: 99, Card: card }).mount(host)

      expect($(host, ".out")?.textContent).toBe("Ada/99")
      jq79.destroy()
    })
  })

  describe(":props on component tags", () => {
    it("spreads an object's own properties as props", () => {
      const card = new Component79(`<div class="card">{{ name }} / {{ version }}</div>`)
      const jq79 = new Component79(`<div><Card :props="sdk" /></div>`)
        .render({ sdk: { name: "gba", version: "1.0" }, Card: card }).mount(host)

      expect($(host, ".card")?.textContent).toBe("gba / 1.0")
      jq79.destroy()
    })

    it("keeps spread props live: a change to the object reaches the child", () => {
      const card = new Component79(`<div class="card">{{ version }}</div>`)
      const jq79 = new Component79(`<div><Card :props="sdk" /></div>`)
        .render({ sdk: { name: "gba", version: "1.0" }, Card: card }).mount(host)

      expect($(host, ".card")?.textContent).toBe("1.0")
      jq79.data!.sdk.version = "2.0"
      expect($(host, ".card")?.textContent).toBe("2.0")
      jq79.destroy()
    })

    it("clears a prop when the key disappears from the object", () => {
      const card = new Component79(`<div class="card">[{{ badge }}]</div>`)
      const jq79 = new Component79(`<div><Card :props="sdk" /></div>`)
        .render({ sdk: { badge: "beta" }, Card: card }).mount(host)

      expect($(host, ".card")?.textContent).toBe("[beta]")
      delete jq79.data!.sdk.badge
      expect($(host, ".card")?.textContent).toBe("[]")
      jq79.destroy()
    })

    it("adds a prop when a new key appears on the object", () => {
      const card = new Component79(`<div class="card">[{{ badge }}]</div>`)
      const jq79 = new Component79(`<div><Card :props="sdk" /></div>`)
        .render({ sdk: {} as Record<string, string>, Card: card }).mount(host)

      expect($(host, ".card")?.textContent).toBe("[]")
      jq79.data!.sdk.badge = "new"
      expect($(host, ".card")?.textContent).toBe("[new]")
      jq79.destroy()
    })

    it("lets an explicit prop after the spread win (JS object-spread order)", () => {
      const card = new Component79(`<div class="card">{{ name }}</div>`)
      const jq79 = new Component79(`<div><Card :props="sdk" :name="'override'" /></div>`)
        .render({ sdk: { name: "spread" }, Card: card }).mount(host)

      expect($(host, ".card")?.textContent).toBe("override")
      jq79.destroy()
    })

    it("lets the spread after an explicit prop win (JS object-spread order)", () => {
      const card = new Component79(`<div class="card">{{ name }}</div>`)
      const jq79 = new Component79(`<div><Card :name="'explicit'" :props="sdk" /></div>`)
        .render({ sdk: { name: "spread" }, Card: card }).mount(host)

      expect($(host, ".card")?.textContent).toBe("spread")
      jq79.destroy()
    })

    it("composes multiple spreads (the ...sugar's distinct suffixes), later winning", () => {
      // two bare :props on one tag can't work - identical attribute names, and
      // the HTML parser keeps only the first. The ...sugar suffixes them
      // (:props.0/:props.1) precisely so several spreads survive parsing
      const card = new Component79(`<div class="card">{{ a }}{{ b }}{{ c }}</div>`)
      const jq79 = new Component79(`<div><Card ...one ...two /></div>`)
        .render({ one: { a: "1", b: "x" }, two: { b: "2", c: "3" }, Card: card }).mount(host)

      expect($(host, ".card")?.textContent).toBe("123")
      jq79.destroy()
    })

    it("spreads nothing when the expression isn't an object - fails closed like :with", () => {
      const card = new Component79(`<div class="card">[{{ name }}]</div>`)
      const jq79 = new Component79(`<div><Card :props="maybe" /></div>`)
        .render({ maybe: undefined as any, Card: card }).mount(host)

      expect($(host, ".card")?.textContent).toBe("[]")
      // and it spreads once the object arrives (an await-pending value)
      jq79.data!.maybe = { name: "ready" }
      expect($(host, ".card")?.textContent).toBe("[ready]")
      jq79.destroy()
    })

    it("desugars `...expr` to a value-based spread, camelCase intact", () => {
      const card = new Component79(`<div class="card">{{ userName }}</div>`)
      const jq79 = new Component79(`<div><Card ...sdkInfo /></div>`)
        .render({ sdkInfo: { userName: "ada" }, Card: card }).mount(host)

      // the expression rode through DOMParser in a value, so `sdkInfo`/`userName`
      // kept their case - a name-position `...sdkInfo` would have lowercased
      expect($(host, ".card")?.textContent).toBe("ada")
      jq79.destroy()
    })

    it("mixes `...expr` sugar with an explicit prop, source order deciding", () => {
      const card = new Component79(`<div class="card">{{ label }}</div>`)
      const jq79 = new Component79(`<div><Card :label="'first'" ...opts /></div>`)
        .render({ opts: { label: "spread" }, Card: card }).mount(host)

      expect($(host, ".card")?.textContent).toBe("spread")
      jq79.destroy()
    })
  })

  describe("@event on component tags", () => {
    it("hears the child's $emit on the tag, with $event.detail in scope", () => {
      const child = new Component79(`<button class="bump" @click="$emit('changed', 7)">go</button>`)
      const jq79 = new Component79(`<div><Stepper @changed="last = $event.detail" /></div>`)
        .render({ last: 0, Stepper: child }).mount(host)

      ;($(host, ".bump") as HTMLButtonElement).click()

      expect(jq79.data!.last).toBe(7)
      jq79.destroy()
    })

    it("does not hear native DOM events from the child's inner DOM - the $emit channel only", () => {
      const child = new Component79(`<button class="inner">native</button>`)
      const jq79 = new Component79(`<div><Widget @click="hits = hits + 1" /></div>`)
        .render({ hits: 0, Widget: child }).mount(host)

      // the native click bubbles past the tag's anchors to shared ancestors;
      // hearing it on the tag is the container pattern's job, not this one's
      ;($(host, ".inner") as HTMLButtonElement).click()

      expect(jq79.data!.hits).toBe(0)
      jq79.destroy()
    })

    it("still bubbles the emit to wrapping elements - both channels stay live", () => {
      const child = new Component79(`<button class="fire" @click="$emit('ping')">go</button>`)
      const jq79 = new Component79(
        `<div @ping="outer = outer + 1"><Widget @ping="inner = inner + 1" /></div>`
      ).render({ inner: 0, outer: 0, Widget: child }).mount(host)

      ;($(host, ".fire") as HTMLButtonElement).click()

      expect(jq79.data!.inner).toBe(1)
      expect(jq79.data!.outer).toBe(1)
      jq79.destroy()
    })

    it(".stop keeps the emit off the DOM dispatch - wrapping elements never hear it", () => {
      const child = new Component79(`<button class="fire" @click="$emit('ping')">go</button>`)
      const jq79 = new Component79(
        `<div @ping="outer = outer + 1"><Widget @ping.stop="inner = inner + 1" /></div>`
      ).render({ inner: 0, outer: 0, Widget: child }).mount(host)

      ;($(host, ".fire") as HTMLButtonElement).click()

      expect(jq79.data!.inner).toBe(1)
      expect(jq79.data!.outer).toBe(0)
      jq79.destroy()
    })

    it(".prevent flips the child's $emit() return to false - the parent-veto contract", () => {
      const child = new Component79(
        `<script :setup>let vetoed = "?"</script>` +
          `<button class="fire" @click="vetoed = !$emit('save', 1)">{{ vetoed }}</button>`
      )
      const jq79 = new Component79(`<div><Editor @save.prevent="hits = hits + 1" /></div>`)
        .render({ hits: 0, Editor: child }).mount(host)

      ;($(host, ".fire") as HTMLButtonElement).click()

      expect(jq79.data!.hits).toBe(1) // the handler ran...
      expect($(host, ".fire")?.textContent).toBe("true") // ...and the child heard the veto
      jq79.destroy()
    })

    it("without .prevent, $emit returns true", () => {
      const child = new Component79(
        `<script :setup>let vetoed = "?"</script>` +
          `<button class="fire" @click="vetoed = !$emit('save', 1)">{{ vetoed }}</button>`
      )
      const jq79 = new Component79(`<div><Editor @save="hits = hits + 1" /></div>`)
        .render({ hits: 0, Editor: child }).mount(host)

      ;($(host, ".fire") as HTMLButtonElement).click()

      expect($(host, ".fire")?.textContent).toBe("false")
      jq79.destroy()
    })

    it(".once unsubscribes after the first emit", () => {
      const child = new Component79(`<button class="fire" @click="$emit('tick')">go</button>`)
      const jq79 = new Component79(`<div><Widget @tick.once="count = count + 1" /></div>`)
        .render({ count: 0, Widget: child }).mount(host)

      ;($(host, ".fire") as HTMLButtonElement).click()
      ;($(host, ".fire") as HTMLButtonElement).click()

      expect(jq79.data!.count).toBe(1)
      jq79.destroy()
    })
  })

  describe("script locations (devtools)", () => {
    // the error a throwing setup script logs, as seen by console.error
    const thrownBy = async (src: string, options?: { filename?: string }) => {
      const errors: any[] = []
      const spy = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args) })
      new Component79(src, options).render().mount(host)
      await Promise.resolve()
      spy.mockRestore()
      return errors[0]?.[1] as Error | undefined
    }

    it("names a fetched component's scripts after its URL", async () => {
      const src = `<script :setup>\nboom()\n</script><p>x</p>`
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => src })))

      const jq79 = await Component79.fetch("/components/card.html")
      expect(jq79.filename).toBe("/components/card.html")

      const errors: any[] = []
      const spy = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args) })
      jq79.render().mount(host)
      await Promise.resolve()
      spy.mockRestore()

      expect(String(errors[0]?.[1]?.stack)).toContain("/components/card.html?jq79-script=0")
      jq79.destroy()
    })

    it("names the script in the stack trace of an error thrown inside it", async () => {
      const error = await thrownBy(`<script :setup>\nboom()\n</script><p>x</p>`, { filename: "Card.html" })

      expect(String(error?.stack)).toContain("Card.html?jq79-script=0")
    })

    it("gives each script block of a component its own name", async () => {
      const src = `<script :setup>\nlet a = 1\n</script>\n<script :setup>\nboom()\n</script>\n<p>{{ a }}</p>`
      const error = await thrownBy(src, { filename: "Two.html" })

      // the second block, so the failure can't be confused with the first
      expect(String(error?.stack)).toContain("Two.html?jq79-script=1")
    })

    it("names a factory script too", async () => {
      const src = `<script>\nboom()\nexport default () => ({})\n</script><p>x</p>`
      const errors: any[] = []
      const spy = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args) })
      new Component79(src, { filename: "Factory.html" }).render().mount(host)
      await Promise.resolve()
      spy.mockRestore()

      expect(String(errors[0]?.[1]?.stack)).toContain("Factory.html?jq79-script=0")
    })

    it("leaves an inline component's scripts untouched (nothing to name them after)", async () => {
      const error = await thrownBy(`<script :setup>\nboom()\n</script><p>x</p>`)

      expect(error?.message).toContain("boom is not a function")
      expect(String(error?.stack)).not.toContain("jq79-script")
    })
  })

  describe("<style scoped>", () => {
    const scopeOf = (el: Element | null) => el?.getAttribute("data-jq79") ?? null
    // what a head-mounted instance injects: the scoped rewrite where there is one
    const headCss = (jq79: Component79) => jq79.styles.map(style => style.scoped ?? style.content).join("\n")

    it("stamps every rendered element and requires the stamp in the CSS", () => {
      const jq79 = new Component79(`
        <div class="card"><span class="title">hi</span></div>
        <style scoped>.card .title { color: red; }</style>
      `).render().mount(host)

      const scope = scopeOf($(host, ".card"))
      expect(scope).toMatch(/^[a-z0-9]+$/)
      expect(scopeOf($(host, ".title"))).toBe(scope)
      expect(headCss(jq79)).toContain(`.card .title[data-jq79="${scope}"]`)

      jq79.destroy()
    })

    it("does not stamp :html content: scoped rules cannot be borrowed by injected markup", () => {
      // sanitizeHTML lets `class` through on any allowed tag, so untrusted
      // content can *name* the component's classes - but the stamp only ever
      // lands on template elements, so a <style scoped> rule never matches
      // the injected node. Unscoped styles would: that is the documented
      // trade-off this test keeps visible
      const jq79 = new Component79(`
        <div class="card" :html="body"></div>
        <style scoped>.title { color: red; }</style>
      `).render({ body: `<span class="title">injected</span>` }).mount(host)

      const injected = $(host, ".title")!
      expect(injected.textContent).toBe("injected")
      expect(injected.getAttribute("class")).toBe("title") // survives sanitizing
      expect(scopeOf(injected)).toBeNull() // but carries no scope stamp
      expect(scopeOf($(host, ".card"))).toMatch(/^[a-z0-9]+$/)
      expect(headCss(jq79)).toContain(`.title[data-jq79=`)

      jq79.destroy()
    })

    it("leaves an unscoped <style> and its template alone", () => {
      const jq79 = new Component79(`<div class="plain">x</div><style>.plain { color: red; }</style>`).render().mount(host)

      expect(scopeOf($(host, ".plain"))).toBeNull()
      expect(headCss(jq79)).toContain(".plain {")
      expect(headCss(jq79)).not.toContain("data-jq79")

      jq79.destroy()
    })

    it("scopes the last compound, keeping pseudo-elements last and @keyframes untouched", () => {
      const jq79 = new Component79(`
        <div class="a">x</div>
        <style scoped>
          .a::before { content: "x"; }
          .a:hover, .b > .c { color: red; }
          @media (min-width: 10px) { .a { color: blue; } }
          @keyframes spin { from { opacity: 0; } to { opacity: 1; } }
        </style>
      `).render().mount(host)

      const scope = scopeOf($(host, ".a"))
      const css = headCss(jq79)

      expect(css).toContain(`.a[data-jq79="${scope}"]::before`)
      expect(css).toContain(`.a:hover[data-jq79="${scope}"]`)
      expect(css).toContain(`.b > .c[data-jq79="${scope}"]`)
      expect(css).toContain(`.a[data-jq79="${scope}"] { color: blue; }`) // inside @media
      expect(css).toMatch(/@keyframes spin \{[^}]*0%/) // keyframe selectors left alone

      jq79.destroy()
    })

    it("scopes elements added later by :if and :each", async () => {
      const jq79 = new Component79(`
        <ul class="list"><li :each="n in items" class="item">{{ n }}</li></ul>
        <p :if="open" class="panel">open</p>
        <style scoped>.item { color: red; }</style>
      `).render({ items: [1], open: false }).mount(host)

      const scope = scopeOf($(host, ".list"))
      expect(scopeOf($(host, ".item"))).toBe(scope)

      jq79.data!.items = [1, 2]
      jq79.data!.open = true
      await Promise.resolve()

      expect($$(host, ".item")).toHaveLength(2)
      $$(host, ".item").forEach(item => expect(scopeOf(item)).toBe(scope))
      expect(scopeOf($(host, ".panel"))).toBe(scope)

      jq79.destroy()
    })

    it("gives instances of the same definition one shared scope and one head <style>", () => {
      const parts = new Component79(`<span class="s">x</span><style scoped>.s { color: red; }</style>`)
      const stylesBefore = document.head.querySelectorAll("style").length

      const a = new Component79(parts).render().mount(host)
      const b = new Component79(parts).render().mount(host)

      const [first, second] = $$(host, ".s")
      expect(scopeOf(first)).toBe(scopeOf(second))
      expect(document.head.querySelectorAll("style").length).toBe(stylesBefore + 1)

      a.destroy()
      b.destroy()
      expect(document.head.querySelectorAll("style").length).toBe(stylesBefore)
    })

    it("gives different sources different scopes", () => {
      const a = new Component79(`<div class="x">a</div><style scoped>.x { color: red; }</style>`).render().mount(host)
      const b = new Component79(`<div class="x">b</div><style scoped>.x { color: blue; }</style>`).render().mount(host)

      const [first, second] = $$(host, ".x")
      expect(scopeOf(first)).not.toBe(scopeOf(second))

      a.destroy()
      b.destroy()
    })

    it("stops at the component boundary: a child renders under its own scope, and the stamp is not a prop", () => {
      const Child = new Component79(`<b class="child">{{ label ?? "none" }}</b>`)
      const parent = new Component79(`
        <div class="wrap"><Child :label="'x'"></Child></div>
        <style scoped>.child { color: red; }</style>
      `).render({ Child }).mount(host)

      const child = $(host, ".child")!
      expect(scopeOf($(host, ".wrap"))).not.toBeNull()
      expect(scopeOf(child)).toBeNull() // parent's scoped CSS can't reach it
      expect(child.textContent).toBe("x")

      parent.destroy()
    })

    it("scopes a component fetched at runtime, same as a bundled one", async () => {
      const src = `<div class="fetched">x</div><style scoped>.fetched { color: red; }</style>`
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => src })))

      const fetched = await Component79.fetch("/components/card.html")
      fetched.render().mount(host)
      const bundled = new Component79(src) // what the vite plugin emits: same source string

      const scope = scopeOf($(host, ".fetched"))
      expect(scope).not.toBeNull()
      expect(headCss(fetched)).toContain(`.fetched[data-jq79="${scope}"]`)
      expect(headCss(bundled)).toBe(headCss(fetched)) // same source -> same scope

      fetched.destroy()
    })

    it("ignores scoped under mountShadow: the shadow root gets the CSS as written", () => {
      const jq79 = new Component79(
        `<p class="a">x</p><style scoped>:host { display: block; } .a { color: red; }</style>`
      )
      jq79.mountShadow(host)

      const shadowCss = host.shadowRoot!.querySelector("style")!.textContent!

      // a shadow root already scopes; stamping the selectors on top would break
      // :host, which cannot carry the stamp (the host is outside the template)
      expect(shadowCss).toContain(":host { display: block; }")
      expect(shadowCss).not.toContain("data-jq79")

      // the head rewrite is still there for whoever mounts this definition normally
      expect(jq79.styles[0].scoped).toContain('.a[data-jq79="')

      jq79.destroy()
    })

    it("refcounts head styles by what was actually injected", () => {
      const parts = new Component79(`<span class="s">x</span><style scoped>.s { color: red; }</style>`)
      const stylesBefore = document.head.querySelectorAll("style").length

      const a = new Component79(parts).render().mount(host)
      const b = new Component79(parts).render().mount(host)
      expect(document.head.querySelectorAll("style").length).toBe(stylesBefore + 1)

      // destroy() must release the same string render() acquired, or the
      // refcount never reaches zero and the <style> leaks
      a.destroy()
      b.destroy()
      expect(document.head.querySelectorAll("style").length).toBe(stylesBefore)
    })

    it("warns when an uncompiled <style lang> reaches the runtime, and leaves it as written", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

      // what a fetched (unbundled) component with scss in it looks like: the
      // vite plugin never saw it, so nothing compiled the block
      const jq79 = new Component79(
        `<div class="a">x</div><style lang="scss" scoped>.a { .b { color: red; } }</style>`
      )

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('<style lang="scss">'))
      expect(jq79.styles[0].content).toContain(".b { color: red; }") // untouched, not garbled
      expect(jq79.template[0].attrs["data-jq79"]).toBeUndefined() // no scoping attempted on non-CSS

      warn.mockRestore()
    })

    it("warns about :deep(), which browsers would silently drop", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

      new Component79(`<div class="a">x</div><style scoped>.a :deep(.b) { color: red; }</style>`)

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(":deep()"))
      warn.mockRestore()
    })
  })

  // the dedupe that makes these warnings bearable is module-level and keyed by
  // name, so every test here uses a name of its own
  describe("names a template expression cannot resolve", () => {
    const flush = () => new Promise(resolve => setTimeout(resolve, 0))

    it("warns once for a name declared nowhere, however often it is evaluated", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const jq79 = new Component79(`<button class="go" @click="missingHandler">go</button>`)
        .render().mount(host)

      ;($(host, ".go") as HTMLButtonElement).click()
      ;($(host, ".go") as HTMLButtonElement).click()
      await flush()
      ;($(host, ".go") as HTMLButtonElement).click() // after the warning, too
      await flush()

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("missingHandler is not defined"))
      expect(warn).toHaveBeenCalledTimes(1)
      warn.mockRestore()
      jq79.destroy()
    })

    it("names the fix for a top-level function declaration, the trap that prompted this", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      // transformSetupScript rewrites let/var/const into store assignments and
      // leaves `function` alone, so onFiles is a lexical binding the template
      // cannot see - the failure this whole path exists to make audible
      const jq79 = new Component79(
        `<script :setup>function onFiles(e) { $emit("x", e) }</script>` +
        `<button class="go" @click="onFiles">go</button>`
      ).render().mount(host)

      ;($(host, ".go") as HTMLButtonElement).click()
      await flush()

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("onFiles is not defined"))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("const name = () => {}"))
      warn.mockRestore()
      jq79.destroy()
    })

    it("never reads a name an async factory has not assigned yet", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      // a factory assigns its names to the store when it returns, and the
      // render now waits for that - so the name exists by the time anything
      // reads it, and the missing-name queue is never reached at all. It used
      // to render empty first and be re-checked once the script settled
      const jq79 = new Component79(
        `<script>export default async () => { await Promise.resolve(); return { greeting: "hola" } }</script>` +
        `<p class="hi">{{ greeting }}</p>`
      ).render().mount(host)

      expect($(host, ".hi")).toBeNull() // held back: markers, no template yet
      await flush()

      expect($(host, ".hi")?.textContent).toBe("hola")
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
      jq79.destroy()
    })

    it("says it once for a whole :each, not once per item", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const jq79 = new Component79(`<li :each="n in items" class="row">{{ n * factr }}</li>`)
        .render({ items: [1, 2, 3, 4, 5] }).mount(host)
      await flush()

      expect($$(host, ".row")).toHaveLength(5)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("factr is not defined"))
      expect(warn).toHaveBeenCalledTimes(1)
      warn.mockRestore()
      jq79.destroy()
    })

    it("says it again after a hot update, since the source changed under it", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const jq79 = new Component79(`<p class="out">{{ oldTypo }}</p>`).render().mount(host)
      await flush()
      expect(warn).toHaveBeenCalledTimes(1)

      jq79.hotReplace(`<p class="out">{{ oldTypo }}</p>`)
      await flush()

      expect(warn).toHaveBeenCalledTimes(2)
      warn.mockRestore()
      jq79.destroy()
    })
  })

  // the other half of the same silence: an expression that throws something
  // other than a missing name. Reported where it throws - no deferral, because
  // the engine already caught a real exception and there is nothing left to
  // decide - and as an error, not a warning
  describe("an expression that throws while rendering", () => {
    it("reports once for a member access that never resolves, however many rows read it", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      // the reported shape: every game is {}, so `.is` is undefined and
      // `.is.loaded` throws. :disabled took the undefined as falsy and rendered
      // the buttons enabled - the opposite of what this says - in silence
      const jq79 = new Component79(
        `<button class="go" :each="game, gameKey in games" :key="gameKey"` +
        ` :disabled="!games[gameKey].is.loaded">{{ gameKey }}</button>`
      ).render({ games: { Sonic1: {}, Sonic2: {}, Sonic3: {}, SonicCD: {}, Knuckles: {} } }).mount(host)

      expect($$(host, ".go")).toHaveLength(5)
      expect($(host, ".go")?.hasAttribute("disabled")).toBe(false) // still fails open

      expect(error).toHaveBeenCalledTimes(1) // five rows, one line
      expect(error).toHaveBeenCalledWith(expect.stringContaining("!games[gameKey].is.loaded"))
      expect(error).toHaveBeenCalledWith(expect.stringContaining("reading 'loaded'"))
      expect(error).toHaveBeenCalledWith(expect.stringContaining("a?.b"))

      error.mockRestore()
      jq79.destroy()
    })

    it("reports on the tick it threw, with no deferral to wait through", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const jq79 = new Component79(`<p class="who">{{ absentee.name }}</p>`)
        .render({ absentee: undefined }).mount(host)

      expect($(host, ".who")?.textContent).toBe("")
      expect(error).toHaveBeenCalledTimes(1) // not after a flush: now

      error.mockRestore()
      jq79.destroy()
    })

    // the trade this reporting makes. A value a fetch will fill throws on the
    // first render like any other, and reporting where it throws cannot tell
    // the two apart - so it says so, and the message names the fix
    it("reports a value that is merely on its way, which is the cost of not deferring", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const jq79 = new Component79(`<p class="who">{{ latecomer.name }}</p>`)
        .render({ latecomer: undefined }).mount(host)
      expect(error).toHaveBeenCalledTimes(1)

      jq79.data!.latecomer = { name: "ada" }
      expect($(host, ".who")?.textContent).toBe("ada")
      expect(error).toHaveBeenCalledTimes(1) // and nothing retracts it

      error.mockRestore()
      jq79.destroy()
    })

    it("stays quiet when the guard the message asks for is there", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const jq79 = new Component79(`<p class="who">{{ guarded?.name }}</p>`)
        .render({ guarded: undefined }).mount(host)

      expect($(host, ".who")?.textContent).toBe("")
      expect(error).not.toHaveBeenCalled()

      error.mockRestore()
      jq79.destroy()
    })

    it("says it again after a hot update, since the source changed under it", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const src = `<p class="out">{{ stale.deep.value }}</p>`
      const jq79 = new Component79(src).render({ stale: {} }).mount(host)
      expect(error).toHaveBeenCalledTimes(1)

      jq79.hotReplace(src)

      expect(error).toHaveBeenCalledTimes(2)
      error.mockRestore()
      jq79.destroy()
    })
  })

  describe("an exception thrown inside a handler", () => {
    const flush = () => new Promise(resolve => setTimeout(resolve, 0))

    // a listener that throws is reported on window rather than propagating to
    // whatever dispatched the event - the browser's own path, and jsdom's.
    // preventDefault keeps vitest from failing the run on it
    const collectErrors = (run: () => void): Error[] => {
      const seen: Error[] = []
      const onError = (event: ErrorEvent) => { event.preventDefault(); seen.push(event.error) }
      window.addEventListener("error", onError)
      try { run() } finally { window.removeEventListener("error", onError) }
      return seen
    }

    it("reaches the console when the handler was called inline", () => {
      // the reported case: the call happens *during* the evaluation, and used
      // to be swallowed by the catch that exists for the render path
      const jq79 = new Component79(
        `<script :setup>const save = user => user.name.trim()</script>` +
        `<button class="go" @click="save(missing)">go</button>`
      ).render({ missing: undefined }).mount(host)

      const errors = collectErrors(() => ($(host, ".go") as HTMLButtonElement).click())

      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(TypeError)
      jq79.destroy()
    })

    it("reaches it the same way through a handler reference, as it always did", () => {
      const jq79 = new Component79(
        `<script :setup>const save = () => { throw new TypeError("from the body") }</script>` +
        `<button class="go" @click="save">go</button>`
      ).render().mount(host)

      const errors = collectErrors(() => ($(host, ".go") as HTMLButtonElement).click())

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe("from the body")
      jq79.destroy()
    })

    it("reaches it from a handler on a component tag too", () => {
      const child = new Component79(
        `<script :setup>const fire = () => $emit("go")</script>` +
        `<button class="go" @click="fire">go</button>`
      )
      const parent = new Component79(
        `<script :setup>const onGo = () => { throw new TypeError("from the tag handler") }</script>` +
        `<div><Child @go="onGo($event)" /></div>`
      ).render({ Child: child }).mount(host)

      const errors = collectErrors(() => ($(host, ".go") as HTMLButtonElement).click())

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe("from the tag handler")
      parent.destroy()
    })

    it("still absorbs a name that resolves nowhere, and says it once instead", async () => {
      // a ReferenceError is the one failure that isn't decidable when it
      // throws - an async factory's names arrive later - so it keeps going to
      // the deferred reporter rather than out of the listener
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const jq79 = new Component79(`<button class="go" @click="absentFn()">go</button>`)
        .render().mount(host)

      const errors = collectErrors(() => {
        ;($(host, ".go") as HTMLButtonElement).click()
        ;($(host, ".go") as HTMLButtonElement).click()
      })
      await flush()

      expect(errors).toHaveLength(0)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("absentFn is not defined"))
      expect(warn).toHaveBeenCalledTimes(1)
      warn.mockRestore()
      jq79.destroy()
    })

    it("leaves an inline statement alone - evaluating to a non-function is not a failure", () => {
      const jq79 = new Component79(
        `<script :setup>let count = 0</script>` +
        `<button class="go" @click="count++">{{ count }}</button>`
      ).render().mount(host)

      const errors = collectErrors(() => ($(host, ".go") as HTMLButtonElement).click())

      expect(errors).toHaveLength(0)
      expect($(host, ".go")?.textContent).toBe("1")
      jq79.destroy()
    })
  })
})

// Component79.debug exists so a bug report can say "it goes away with cloning
// off", which is worth something only if the call did what the caller thinks
describe("Component79.debug", () => {
  it("refuses a flag it does not have, instead of storing the typo", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const flags = Component79.debug({ cloneSkeleton: false } as any)

      // the typo used to pass the boolean guard, land in the flags object and
      // come back here - so the caller read "cloning is off" while it was on
      expect(flags).not.toHaveProperty("cloneSkeleton")
      expect(flags.cloneSkeletons, "a typo changed the real flag").toBe(true)
      expect(warn.mock.calls.map(call => String(call[0])))
        .toContainEqual(expect.stringContaining('does not know "cloneSkeleton"'))
    } finally {
      warn.mockRestore()
    }
  })

  it("still refuses a known flag carrying the wrong type", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(Component79.debug({ cloneSkeletons: "no" } as any).cloneSkeletons).toBe(true)
      expect(warn.mock.calls.map(call => String(call[0])))
        .toContainEqual(expect.stringContaining("the flags are booleans"))
    } finally {
      warn.mockRestore()
    }
  })

  it("sets the flag it does have, and puts it back", () => {
    const { cloneSkeletons: was } = Component79.debug()
    try {
      expect(Component79.debug({ cloneSkeletons: false }).cloneSkeletons).toBe(false)
      expect(Component79.debug().cloneSkeletons).toBe(false)
    } finally {
      Component79.debug({ cloneSkeletons: was })
    }
  })
})
