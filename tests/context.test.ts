import { describe, it, expect, beforeEach, vi } from "vitest"
import { $, $$, $reactive, Component79 } from "../src/jq79"

// Context: $provide(key, value) in a component, $context(key) in any component
// rendered below it - through components that pass nothing on, :each rows and
// slot content (which sees the providers where it LANDS). A root can provide
// with .provide(key, value) before it renders. See
// RECORD/2026-11-26.a-context-mechanism.md

describe("context", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  it("reaches a grandchild through a component that forwards nothing", () => {
    new Component79(`
      <script :setup>$provide("lang", "es")</script>
      <Middle />
      <template name="Middle"><div class="middle"><Leaf /></div></template>
      <template name="Leaf">
        <script :setup>const lang = $context("lang")</script>
        <b class="leaf">{{ lang }}</b>
      </template>
    `).render().mount(host)

    expect($(host, ".middle .leaf")?.textContent).toBe("es")
  })

  it("answers in templates too, and the nearest provider wins", () => {
    new Component79(`
      <script :setup>$provide("theme", "light")</script>
      <i class="outer">{{ $context("theme") }}</i>
      <Dark />
      <template name="Dark">
        <script :setup>$provide("theme", "dark")</script>
        <Leaf />
      </template>
      <template name="Leaf"><b class="leaf">{{ $context("theme") }}</b></template>
    `).render().mount(host)

    expect($(host, ".outer")?.textContent).toBe("light")
    expect($(host, ".leaf")?.textContent).toBe("dark")
  })

  it("serves a root's provide() to every component it renders", () => {
    new Component79(`
      <Leaf />
      <template name="Leaf"><b class="leaf">{{ $context("lang") }}</b></template>
    `).provide("lang", "es").render().mount(host)

    expect($(host, ".leaf")?.textContent).toBe("es")
  })

  it("stays live when the value is a $reactive store", async () => {
    const i18n = $reactive({ lang: "en" })
    new Component79(`
      <Middle />
      <template name="Middle"><Leaf /></template>
      <template name="Leaf">
        <script :setup>const i18n = $context("i18n")</script>
        <b class="leaf">{{ i18n.lang }}</b>
      </template>
    `).provide("i18n", i18n).render().mount(host)

    expect($(host, ".leaf")?.textContent).toBe("en")
    i18n.lang = "es"
    await Promise.resolve()
    expect($(host, ".leaf")?.textContent).toBe("es")
  })

  it("gives slot content the providers around the <slot>, not around the tag", () => {
    new Component79(`
      <script :setup>$provide("group", "page")</script>
      <Tabs>
        <Tab />
        <Tab />
      </Tabs>
      <Tab />
      <template name="Tabs">
        <script :setup>$provide("group", "tabs")</script>
        <nav><slot /></nav>
      </template>
      <template name="Tab"><b class="tab">{{ $context("group") }}</b></template>
    `).render().mount(host)

    expect($$(host, "nav .tab").map(el => el.textContent)).toEqual(["tabs", "tabs"])
    expect($$(host, ".tab").at(-1)?.textContent).toBe("page")
  })

  it("reaches components inside :each rows", () => {
    new Component79(`
      <script :setup>
        $provide("unit", "kg")
        let rows = [1, 2, 3]
      </script>
      <Row :each="n in rows" :n />
      <template name="Row">
        <script :setup="{ n }"></script>
        <i class="row">{{ n }}{{ $context("unit") }}</i>
      </template>
    `).render().mount(host)

    expect($$(host, ".row").map(el => el.textContent)).toEqual(["1kg", "2kg", "3kg"])
  })

  it("warns once for a key nobody provides, and is silent with a fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    new Component79(`
      <b class="a">{{ $context("missing") }}</b>
      <b class="b">{{ $context("other", "x") }}</b>
    `).render().mount(host)

    expect($(host, ".b")?.textContent).toBe("x")
    const missing = warn.mock.calls.filter(([msg]) => String(msg).includes("$context(missing)"))
    expect(missing).toHaveLength(1)
    expect(warn.mock.calls.some(([msg]) => String(msg).includes("$context(other)"))).toBe(false)
    warn.mockRestore()
  })

  it("leaves a sibling subtree alone", () => {
    new Component79(`
      <A /><B />
      <template name="A">
        <script :setup>$provide("who", "a")</script>
        <Leaf />
      </template>
      <template name="B"><Leaf /></template>
      <template name="Leaf"><b class="leaf">{{ $context("who", "none") }}</b></template>
    `).render().mount(host)

    expect($$(host, ".leaf").map(el => el.textContent)).toEqual(["a", "none"])
  })
})
