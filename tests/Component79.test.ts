
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { $, $$, Component79 } from "../src/jq79"

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

      expect(globalThis.fetch).toHaveBeenCalledWith("/components/foobar.html")
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
})
