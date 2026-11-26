import { describe, it, expect, beforeEach, vi } from "vitest"
import { $, $$, $reactive, Component79, enableHotReload, hotUpdate } from "../src/jq79"

// Context: $ctx(key, value) in a component's script sets a value, $ctx(key) in
// any component rendered below it reads it - through components that pass
// nothing on, :each rows and slot content (which sees the values where it
// LANDS). A root sets values with .ctx(key, value) before it renders. See
// RECORD/2026-11-26.a-context-mechanism.md

describe("context ($ctx)", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  it("reaches a grandchild through a component that forwards nothing", () => {
    new Component79(`
      <script :setup>$ctx("lang", "es")</script>
      <Middle />
      <template name="Middle"><div class="middle"><Leaf /></div></template>
      <template name="Leaf">
        <script :setup>const lang = $ctx("lang")</script>
        <b class="leaf" :lang="lang">{{ lang }}</b>
      </template>
    `).render().mount(host)

    expect($(host, ".middle .leaf")?.textContent).toBe("es")
    expect($(host, ".leaf")?.getAttribute("lang")).toBe("es")
  })

  it("reads in templates too, and the nearest value wins", () => {
    new Component79(`
      <script :setup>$ctx("theme", "light")</script>
      <i class="outer">{{ $ctx('theme') }}</i>
      <Dark />
      <template name="Dark">
        <script :setup>$ctx("theme", "dark")</script>
        <Leaf />
      </template>
      <template name="Leaf"><b class="leaf" :data-theme="$ctx('theme')"></b></template>
    `).render().mount(host)

    expect($(host, ".outer")?.textContent).toBe("light")
    expect($(host, ".leaf")?.getAttribute("data-theme")).toBe("dark")
  })

  it("serves a root's ctx() to every component it renders, and reads it back", () => {
    const app = new Component79(`
      <Leaf />
      <template name="Leaf"><b class="leaf">{{ $ctx('lang') }}</b></template>
    `).ctx("lang", "es")
    app.render().mount(host)

    expect($(host, ".leaf")?.textContent).toBe("es")
    expect(app.ctx("lang")).toBe("es")
  })

  it("stays live when the value is a $reactive store", async () => {
    const i18n = $reactive({ lang: "en" })
    new Component79(`
      <Middle />
      <template name="Middle"><Leaf /></template>
      <template name="Leaf">
        <script :setup>const i18n = $ctx("i18n")</script>
        <b class="leaf">{{ i18n.lang }}</b>
      </template>
    `).ctx("i18n", i18n).render().mount(host)

    expect($(host, ".leaf")?.textContent).toBe("en")
    i18n.lang = "es"
    await Promise.resolve()
    expect($(host, ".leaf")?.textContent).toBe("es")
  })

  it("gives slot content the values around the <slot>, not around the tag", () => {
    new Component79(`
      <script :setup>$ctx("group", "page")</script>
      <Tabs>
        <Tab />
        <Tab />
      </Tabs>
      <Tab />
      <template name="Tabs">
        <script :setup>$ctx("group", "tabs")</script>
        <nav><slot /></nav>
      </template>
      <template name="Tab"><b class="tab">{{ $ctx('group') }}</b></template>
    `).render().mount(host)

    expect($$(host, "nav .tab").map(el => el.textContent)).toEqual(["tabs", "tabs"])
    expect($$(host, ".tab").at(-1)?.textContent).toBe("page")
  })

  it("reaches components inside :each rows", () => {
    new Component79(`
      <script :setup>
        $ctx("unit", "kg")
        let rows = [1, 2, 3]
      </script>
      <Row :each="n in rows" :n />
      <template name="Row">
        <script :setup="{ n }"></script>
        <i class="row">{{ n }}{{ $ctx('unit') }}</i>
      </template>
    `).render().mount(host)

    expect($$(host, ".row").map(el => el.textContent)).toEqual(["1kg", "2kg", "3kg"])
  })

  it("answers undefined for a key nobody set, so ?? gives the default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    new Component79(`
      <b class="a">{{ $ctx('missing') ?? "en" }}</b>
    `).render().mount(host)

    expect($(host, ".a")?.textContent).toBe("en")
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("only reads in a template: a set there warns and changes nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    new Component79(`
      <script :setup>$ctx("lang", "es")</script>
      <i class="a">{{ $ctx('lang', 'en') }}</i>
      <Leaf />
      <template name="Leaf"><b class="leaf">{{ $ctx('lang') }}</b></template>
    `).render().mount(host)

    expect($(host, ".a")?.textContent).toBe("es")
    expect($(host, ".leaf")?.textContent).toBe("es")
    expect(warn.mock.calls.filter(([msg]) => String(msg).includes("in a template only reads"))).toHaveLength(1)
    warn.mockRestore()
  })

  it("warns once when set after the first render", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const app = new Component79(`
      <script :setup>
        await $mounted()
        $ctx("late", 1)
        $ctx("later", 2)
      </script>
      <b>x</b>
    `)
    app.render().mount(host)
    await new Promise(r => setTimeout(r, 0))

    expect(warn.mock.calls.filter(([msg]) => String(msg).includes("after the first render"))).toHaveLength(1)
    warn.mockRestore()
  })

  it("leaves a sibling subtree alone", () => {
    new Component79(`
      <A /><B />
      <template name="A">
        <script :setup>$ctx("who", "a")</script>
        <Leaf />
      </template>
      <template name="B"><Leaf /></template>
      <template name="Leaf"><b class="leaf">{{ $ctx('who') ?? "none" }}</b></template>
    `).render().mount(host)

    expect($$(host, ".leaf").map(el => el.textContent)).toEqual(["a", "none"])
  })

  describe("hot reload", () => {
    beforeEach(() => { enableHotReload() })

    // the map rides the instance (like slots), not the store a re-render snapshots
    it("keeps what a provider set when the file is edited", () => {
      const source = (label: string) => `
        <script :setup>$ctx("lang", "es")</script>
        <Middle />
        <template name="Middle"><Leaf /></template>
        <template name="Leaf"><b class="leaf">${label}: {{ $ctx('lang') }}</b></template>
      `
      new Component79(source("before"), { filename: "/ctx.html" }).render().mount(host)
      expect($(host, ".leaf")?.textContent).toBe("before: es")

      expect(hotUpdate("/ctx.html", source("after"))).toBeGreaterThan(0)
      expect($(host, ".leaf")?.textContent).toBe("after: es")
    })

    it("keeps a root's ctx() through an edit of the root's file", () => {
      const source = (label: string) => `
        <Leaf />
        <template name="Leaf"><b class="leaf">${label}: {{ $ctx('lang') }}</b></template>
      `
      new Component79(source("before"), { filename: "/root-ctx.html" }).ctx("lang", "es").render().mount(host)
      expect($(host, ".leaf")?.textContent).toBe("before: es")

      expect(hotUpdate("/root-ctx.html", source("after"))).toBeGreaterThan(0)
      expect($(host, ".leaf")?.textContent).toBe("after: es")
    })
  })
})
