// several components in one file: <template name="…"> declares the file's
// other components, auto-imported by every component in it and exported
// alongside the file's own.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { $, $$, Component79, enableHotReload, hotUpdate } from "../src/jq79"

describe("multi-template files", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    host.remove()
    document.head.innerHTML = ""
  })

  describe("parsing and exports", () => {
    it("declares the file's other components, and keeps them off its own template", () => {
      const file = new Component79(`
        <ul class="list"><Row :each="items" /></ul>
        <template name="Row"><li class="row">{{ item }}</li></template>
      `)

      expect(file.template).toHaveLength(1) // the <ul>, not the <template>
      expect(file.siblings).toHaveProperty("Row")
      expect(file.siblings!.Row).toBeInstanceOf(Component79)
    })

    it("hangs them off the definition, so one await destructures the file", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(`
        <div class="page"><Row /></div>
        <template name="Row"><li class="row">row</li></template>
      `)))

      const file = await Component79.fetch("/list.html")
      const { Row } = file as unknown as { Row: Component79 }

      expect(Row).toBe(file.siblings!.Row)
      expect(Row.name).toBe("Row")
      expect(file.name).toBeUndefined() // the default is named by its importer
      vi.unstubAllGlobals()
    })

    it("hands its own origin down to the components it declares", () => {
      const file = new Component79(
        `<div><Row /></div><template name="Row"><li>row</li></template>`,
        { filename: "list.html", modules: { "./x.js": {} } }
      )

      expect(file.siblings!.Row.filename).toBe("list.html")
      expect(file.siblings!.Row.modules).toBe(file.modules)
    })

    it("warns and ignores a <template> that declares nothing usable", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

      new Component79(`
        <div>x</div>
        <template><b>no name</b></template>
        <template name="row"><b>lowercase</b></template>
        <template name="Row"><b>one</b></template>
        <template name="Row"><b>two</b></template>
      `)

      expect(warn).toHaveBeenCalledTimes(3)
      expect(warn.mock.calls.map(([message]) => message).join("\n")).toMatch(/without a name[\s\S]*PascalCase[\s\S]*two <template name="Row">/)
    })

    it("leaves a nested <template> alone - only the top level declares", () => {
      const file = new Component79(`<div><template name="Row"><li>row</li></template></div>`)

      expect(file.siblings).toBeUndefined()
      expect(file.template).toHaveLength(1)
    })
  })

  describe("resolution", () => {
    it("renders a sibling as a tag, with props, without an import", () => {
      new Component79(`
        <script :setup>
          let items = ["a", "b"]
        </script>
        <ul class="list"><Row :each="label in items" :label="label" /></ul>
        <template name="Row">
          <script :setup="{ label }"></script>
          <li class="row">{{ label }}</li>
        </template>
      `).render().mount(host)

      expect($$(host, ".row").map(el => el.textContent)).toEqual(["a", "b"])
    })

    it("resolves a sibling in a setup script expression too", () => {
      new Component79(`
        <script :setup>
          let flag = true
          $: Current = flag ? Yes : No
        </script>
        <div class="slot"><Current /></div>
        <template name="Yes"><b class="yes">yes</b></template>
        <template name="No"><b class="no">no</b></template>
      `).render().mount(host)

      expect($(host, ".yes")).not.toBeNull()
      expect($(host, ".no")).toBeNull()
    })

    it("resolves a sibling in a factory script, which has no `with` to fall back on", () => {
      new Component79(`
        <script>
        export default (_, { $data }) => {
          $data.Current = Row
        }
        </script>
        <div class="slot"><Current /></div>
        <template name="Row"><b class="row">row</b></template>
      `).render().mount(host)

      expect($(host, ".row")?.textContent).toBe("row")
    })

    it("keeps siblings out of the data", () => {
      const file = new Component79(`<div><Row /></div><template name="Row"><b>row</b></template>`)
      file.render({ n: 1 }).mount(host)

      expect(Object.keys(file.data!)).toEqual(["n"])
      expect({ ...file.data }).toEqual({ n: 1 })
    })

    it("lets a component render itself, and stops when the data does", () => {
      const tree = { label: "root", children: [{ label: "a", children: [{ label: "a1" }] }, { label: "b" }] }

      new Component79(`
        <div class="tree"><Node :node="tree" /></div>
        <template name="Node">
          <script :setup="{ node }"></script>
          <li class="node">
            {{ node.label }}
            <ul :if="node.children"><Node :each="child in node.children" :node="child" /></ul>
          </li>
        </template>
      `).render({ tree }).mount(host)

      expect($$(host, ".node").map(el => el.firstChild?.textContent?.trim())).toEqual(["root", "a", "a1", "b"])
    })

    it("cuts a component that recurses on cyclic data, instead of dying by stack overflow", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      const node: any = { label: "loop" }
      node.children = [node]

      expect(() => {
        new Component79(`
          <div class="tree"><Node :node="node" /></div>
          <template name="Node">
            <script :setup="{ node }"></script>
            <li class="node">
              <ul :if="node.children"><Node :each="child in node.children" :node="child" /></ul>
            </li>
          </template>
        `).render({ node }).mount(host)
      }).not.toThrow()

      expect($$(host, ".node").length).toBe(200)
      expect(error.mock.calls.map(([message]) => message).join("\n")).toMatch(/200 levels deep inside itself/)
    })
  })

  describe("precedence", () => {
    it("uses the file's own when the signature doesn't declare the name", () => {
      const file = new Component79(`
        <script :setup></script>
        <div class="slot"><Button /></div>
        <template name="Button"><b class="mine">mine</b></template>
      `)
      file.render().mount(host)

      expect($(host, ".mine")).not.toBeNull()
    })

    it("lets a parent substitute it even undeclared - an own key shadows the prototype", () => {
      const file = new Component79(`
        <div class="slot"><Button /></div>
        <template name="Button"><b class="mine">mine</b></template>
      `)
      file.render({ Button: new Component79(`<b class="theirs">theirs</b>`) }).mount(host)

      expect($(host, ".theirs")).not.toBeNull()
      expect($(host, ".mine")).toBeNull()
    })

    it("takes the parent's when the signature declares the name", () => {
      const file = new Component79(`
        <script :setup="{ Button }"></script>
        <div class="slot"><Button /></div>
        <template name="Button"><b class="mine">mine</b></template>
      `)
      file.render({ Button: new Component79(`<b class="theirs">theirs</b>`) }).mount(host)

      expect($(host, ".theirs")).not.toBeNull()
      expect($(host, ".mine")).toBeNull()
    })

    it("errors when a declared name is used and the parent passed nothing", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})

      new Component79(`
        <script :setup="{ Button }"></script>
        <div class="slot"><Button /></div>
        <template name="Button"><b class="mine">mine</b></template>
      `).render().mount(host)

      expect($(host, ".mine")).toBeNull()
      expect(error).toHaveBeenCalledTimes(1)
      expect(error.mock.calls[0][0]).toMatch(/declared as a prop and the parent passed nothing/)
    })

    it("says nothing when a declared name is never used as a tag", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})

      new Component79(`
        <script :setup="{ Button }"></script>
        <div class="slot">no tag here</div>
        <template name="Button"><b class="mine">mine</b></template>
      `).render().mount(host)

      expect(error).not.toHaveBeenCalled()
    })

    it("says nothing while a component the parent did pass is still undefined", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})

      const jq79 = new Component79(`<div class="slot"><Card /></div>`)
      jq79.render({ Card: undefined }).mount(host)
      expect(error).not.toHaveBeenCalled()

      // ... and it appears when the import lands
      jq79.data!.Card = new Component79(`<b class="card">card</b>`)
      expect($(host, ".card")).not.toBeNull()
    })

    it("names a value that is not a component at all", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})

      new Component79(`<div class="slot"><Card /></div>`).render({ Card: "nope" }).mount(host)

      expect(error).toHaveBeenCalledTimes(1)
      expect(error.mock.calls[0][0]).toMatch(/is string, not a component/)
    })
  })

  describe("scoped styles", () => {
    it("gives each component of the file its own scope", () => {
      new Component79(`
        <div class="box"><Row /></div>
        <style scoped>.box { color: red; }</style>
        <template name="Row">
          <li class="box">row</li>
          <style scoped>.box { color: blue; }</style>
        </template>
      `).render().mount(host)

      const stamps = $$(host, ".box").map(el => el.getAttribute("data-jq79"))
      expect(stamps[0]).not.toBe(stamps[1])
      expect(stamps.every(Boolean)).toBe(true)

      // the file's rule requires its own stamp, so it can't reach the child's
      const css = $$(document.head, "style").map(el => el.textContent).join("\n")
      expect(css).toContain(`.box[data-jq79="${stamps[0]}"] { color: red; }`)
      expect(css).toContain(`.box[data-jq79="${stamps[1]}"] { color: blue; }`)
    })
  })

  describe("hot reload", () => {
    beforeEach(() => { enableHotReload() })

    const source = (label: string) => `
      <div class="page"><Row /></div>
      <template name="Row"><li class="row">${label}</li></template>
    `

    it("reparses the file once and hands each instance the parts it is", () => {
      new Component79(source("before"), { filename: "/list.html" }).render().mount(host)
      expect($(host, ".row")?.textContent).toBe("before")

      // the file's own component and the live Row both come from one reparse
      expect(hotUpdate("/list.html", source("after"))).toBe(2)
      expect($(host, ".row")?.textContent).toBe("after")
    })

    it("falls back to a full reload when a declared component is gone", () => {
      new Component79(source("before"), { filename: "/gone.html" }).render().mount(host)

      expect(hotUpdate("/gone.html", `<div class="page">no more templates</div>`)).toBe(0)
    })
  })
})
