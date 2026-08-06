import { describe, it, expect, beforeEach, vi } from "vitest"
import { $, $$, Component79, enableHotReload, hotUpdate } from "../src/jq79"

// Content projection: a component tag's children render inside the component,
// where it put a <slot>. The three rules the feature is built on (see the
// slots section of src/jq79.ts) are what most of these tests are about:
// the content is the parent's - its names, its effects, its styles - the child
// only decides where it goes and whether it goes, and slot props reach it only
// under the names it declared with :slot.

describe("slots", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  describe("projection", () => {
    it("renders a tag's children where the component wrote <slot>", () => {
      new Component79(`
        <script :setup></script>
        <Card><b class="inner">hello</b></Card>
        <template name="Card">
          <section class="card"><slot /></section>
        </template>
      `).render().mount(host)

      expect($(host, ".card .inner")?.textContent).toBe("hello")
    })

    it("renders nothing where a component has no <slot> for it", () => {
      new Component79(`
        <script :setup></script>
        <Card><b class="inner">dropped</b></Card>
        <template name="Card">
          <section class="card">nothing here</section>
        </template>
      `).render().mount(host)

      expect($(host, ".inner")).toBe(null)
      expect($(host, ".card")?.textContent).toBe("nothing here")
    })

    it("fills a named slot from <template :slot.name>, and the rest is the default", () => {
      new Component79(`
        <script :setup></script>
        <Card>
          <template :slot.header><h2 class="title">Totals</h2></template>
          <p class="body">the body</p>
        </Card>
        <template name="Card">
          <section>
            <header><slot.header /></header>
            <main><slot /></main>
          </section>
        </template>
      `).render().mount(host)

      expect($(host, "header .title")?.textContent).toBe("Totals")
      expect($(host, "main .body")?.textContent).toBe("the body")
    })

    it("reads a kebab-case name as camelCase, on both sides", () => {
      new Component79(`
        <script :setup></script>
        <Card>
          <template :slot.header-bar><b class="hb">bar</b></template>
        </Card>
        <template name="Card">
          <section :class="{ filled: $slots.headerBar }"><slot.header-bar /></section>
        </template>
      `).render().mount(host)

      expect($(host, ".hb")?.textContent).toBe("bar")
      expect($(host, "section")?.classList.contains("filled")).toBe(true)
    })

    it("renders the slot's own children as fallback when nothing filled it", () => {
      new Component79(`
        <script :setup></script>
        <div class="a"><Card /></div>
        <div class="b"><Card><template :slot.header><i class="given">given</i></template></Card></div>
        <template name="Card">
          <section><slot.header>Untitled</slot.header></section>
        </template>
      `).render().mount(host)

      expect($(host, ".a section")?.textContent?.trim()).toBe("Untitled")
      expect($(host, ".b .given")?.textContent).toBe("given")
      expect($(host, ".b section")?.textContent).not.toContain("Untitled")
    })

    it("renders a <slot> as many times as the child asks", () => {
      new Component79(`
        <script :setup></script>
        <List :rows="['a', 'b', 'c']"><i class="cell">x</i></List>
        <template name="List">
          <script :setup="{ rows }"></script>
          <ul><li :each="row in rows"><slot /></li></ul>
        </template>
      `).render().mount(host)

      expect($$(host, "li .cell")).toHaveLength(3)
    })

    it("counts whitespace between named blocks as layout, not as default content", () => {
      new Component79(`
        <script :setup></script>
        <Card>
          <template :slot.header><b>h</b></template>
        </Card>
        <template name="Card">
          <section :class="{ 'has-default': $slots.default }"><slot /></section>
        </template>
      `).render().mount(host)

      expect($(host, "section")?.classList.contains("has-default")).toBe(false)
    })
  })

  describe("scope", () => {
    it("resolves the content's names in the parent, never in the child", () => {
      new Component79(`
        <script :setup>
          let label = "parent's"
        </script>
        <Card><b class="inner">{{ label }}</b></Card>
        <template name="Card">
          <script :setup>
            let label = "child's"
          </script>
          <section>{{ label }} <slot /></section>
        </template>
      `).render().mount(host)

      expect($(host, ".inner")?.textContent).toBe("parent's")
      expect($(host, "section")?.textContent).toContain("child's")
    })

    it("keeps the content reactive to the parent's store", () => {
      const component = new Component79(`
        <script :setup="{ label }"></script>
        <Card><b class="inner">{{ label }}</b></Card>
        <template name="Card">
          <section><slot /></section>
        </template>
      `).render({ label: "one" })
      component.mount(host)

      expect($(host, ".inner")?.textContent).toBe("one")

      ;(component.data as any).label = "two"

      expect($(host, ".inner")?.textContent).toBe("two")
    })

    it("hands slot props to the names :slot declares, and keeps them live", () => {
      const component = new Component79(`
        <script :setup="{ rows }"></script>
        <List :rows="rows" :slot="{ item, index }">
          <span class="cell">{{ index }}:{{ item.label }}</span>
        </List>
        <template name="List">
          <script :setup="{ rows }"></script>
          <ul><li :each="row in rows"><slot :item="row" :index="$index" /></li></ul>
        </template>
      `).render({ rows: [{ label: "a" }, { label: "b" }] })
      component.mount(host)

      expect($$(host, ".cell").map(el => el.textContent)).toEqual(["0:a", "1:b"])

      // a write to the parent's data reaches the child's store as a prop, and
      // the content reads it back through the slot prop: the round trip both
      // stores are involved in
      ;(component.data as any).rows[1].label = "B"

      expect($$(host, ".cell").map(el => el.textContent)).toEqual(["0:a", "1:B"])
    })

    it("wakes the content when the child's own state changes", () => {
      new Component79(`
        <script :setup></script>
        <Counter :slot="{ count }">
          <b class="count">{{ count }}</b>
        </Counter>
        <template name="Counter">
          <script :setup>
            let n = 0
          </script>
          <button @click="n = n + 1">+</button>
          <slot :count="n" />
        </template>
      `).render().mount(host)

      expect($(host, ".count")?.textContent).toBe("0")

      $(host, "button")!.click()

      expect($(host, ".count")?.textContent).toBe("1")
    })

    it("binds a renamed slot prop, and a default for one the child doesn't pass", () => {
      new Component79(`
        <script :setup></script>
        <Card :slot="{ item: row, tone = 'plain' }">
          <b class="cell">{{ row }}/{{ tone }}</b>
        </Card>
        <template name="Card">
          <section><slot :item="'x'" /></section>
        </template>
      `).render().mount(host)

      expect($(host, ".cell")?.textContent).toBe("x/plain")
    })

    it("passes a plain attribute as a literal string", () => {
      new Component79(`
        <script :setup></script>
        <Card :slot="{ tone }"><b class="cell">{{ tone }}</b></Card>
        <template name="Card">
          <section><slot tone="warm" /></section>
        </template>
      `).render().mount(host)

      expect($(host, ".cell")?.textContent).toBe("warm")
    })

    it("leaves the content on the parent's scope alone when it declares nothing", () => {
      new Component79(`
        <script :setup>
          let item = "the parent's item"
        </script>
        <Card><b class="cell">{{ item }}</b></Card>
        <template name="Card">
          <section><slot :item="'the child\\'s'" /></section>
        </template>
      `).render().mount(host)

      expect($(host, ".cell")?.textContent).toBe("the parent's item")
    })

    it("warns instead of swallowing an assignment to a slot prop", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

      new Component79(`
        <script :setup></script>
        <Card :slot="{ item }"><button @click="item = 'nope'">{{ item }}</button></Card>
        <template name="Card">
          <section><slot :item="'given'" /></section>
        </template>
      `).render().mount(host)
      $(host, "button")!.click()

      expect(warn.mock.calls.map(([message]) => message).join("\n")).toMatch(/"item" is a slot prop/)
      expect($(host, "button")?.textContent).toBe("given")
      warn.mockRestore()
    })
  })

  describe("$slots", () => {
    it("names what the usage site filled, and nothing else", () => {
      new Component79(`
        <script :setup></script>
        <Card>
          <template :slot.footer><b>f</b></template>
          body
        </Card>
        <template name="Card">
          <section>
            <header :if="$slots.header">head</header>
            <footer :if="$slots.footer"><slot.footer /></footer>
            <main :if="$slots.default"><slot /></main>
          </section>
        </template>
      `).render().mount(host)

      expect($(host, "header")).toBe(null)
      expect($(host, "footer")).not.toBe(null)
      expect($(host, "main")).not.toBe(null)
    })

    it("reaches a setup script too", () => {
      new Component79(`
        <script :setup></script>
        <Card><b>b</b></Card>
        <template name="Card">
          <script :setup>
            let names = Object.keys($slots).join(",")
          </script>
          <section class="names">{{ names }}</section>
        </template>
      `).render().mount(host)

      expect($(host, ".names")?.textContent).toBe("default")
    })

    it("is an empty map for a component nobody passed content to", () => {
      new Component79(`
        <script :setup></script>
        <Card />
        <template name="Card">
          <section class="card" :class="{ empty: !$slots.default }">x</section>
        </template>
      `).render().mount(host)

      expect($(host, ".card")?.classList.contains("empty")).toBe(true)
    })
  })

  describe("lifetime", () => {
    it("never renders content the child doesn't project, and creates no effects for it", () => {
      const seen: string[] = []
      const component = new Component79(`
        <script :setup="{ show, label }"></script>
        <Card :show="show"><b class="inner">{{ track(label) }}</b></Card>
        <template name="Card">
          <script :setup="{ show }"></script>
          <section><slot :if="show" /></section>
        </template>
      `).render({ show: false, label: "a", track: (label: string) => { seen.push(label); return label } })
      component.mount(host)

      expect($(host, ".inner")).toBe(null)
      expect(seen).toEqual([])

      // the content's effects don't exist yet, so a change to what they would
      // read reaches nothing
      ;(component.data as any).label = "b"
      expect(seen).toEqual([])

      ;(component.data as any).show = true
      expect($(host, ".inner")?.textContent).toBe("b")
      expect(seen).toEqual(["b"])
    })

    it("disposes the content's effects when the slot goes away", () => {
      const seen: string[] = []
      const component = new Component79(`
        <script :setup="{ show, label }"></script>
        <Card :show="show"><b class="inner">{{ track(label) }}</b></Card>
        <template name="Card">
          <script :setup="{ show }"></script>
          <section><slot :if="show" /></section>
        </template>
      `).render({ show: true, label: "a", track: (label: string) => { seen.push(label); return label } })
      component.mount(host)

      expect(seen).toEqual(["a"])

      ;(component.data as any).show = false
      expect($(host, ".inner")).toBe(null)

      const before = seen.length
      ;(component.data as any).label = "b"

      // the removed content is not re-run by either store
      expect(seen).toHaveLength(before)
    })

    it("drops the content when the component itself is destroyed", () => {
      const seen: string[] = []
      const component = new Component79(`
        <script :setup="{ label }"></script>
        <Card><b class="inner">{{ track(label) }}</b></Card>
        <template name="Card">
          <section><slot /></section>
        </template>
      `).render({ label: "a", track: (label: string) => { seen.push(label); return label } })
      component.mount(host)
      expect(seen).toEqual(["a"])

      const data = component.data as any
      component.destroy()
      const before = seen.length
      data.label = "b"

      expect(seen).toHaveLength(before)
    })
  })

  describe("composition", () => {
    it("forwards its own content through a <slot> written inside slot content", () => {
      new Component79(`
        <script :setup></script>
        <Outer><b class="deep">from the page</b></Outer>
        <template name="Outer">
          <Inner><slot /></Inner>
        </template>
        <template name="Inner">
          <section class="inner"><slot /></section>
        </template>
      `).render().mount(host)

      expect($(host, ".inner .deep")?.textContent).toBe("from the page")
    })

    it("renders a component that sits in slot content, with the parent's props", () => {
      new Component79(`
        <script :setup="{ name }"></script>
        <Card><Badge :label="name" /></Card>
        <template name="Card">
          <section><slot /></section>
        </template>
        <template name="Badge">
          <script :setup="{ label }"></script>
          <i class="badge">{{ label }}</i>
        </template>
      `).render({ name: "ada" }).mount(host)

      expect($(host, "section .badge")?.textContent).toBe("ada")
    })

    it("works with :each on the <slot> itself", () => {
      new Component79(`
        <script :setup></script>
        <List :slot="{ item }"><b class="cell">{{ item }}</b></List>
        <template name="List">
          <script :setup></script>
          <ul><slot :each="row in ['a', 'b']" :item="row" /></ul>
        </template>
      `).render().mount(host)

      expect($$(host, ".cell").map(el => el.textContent)).toEqual(["a", "b"])
    })

    it("stamps slot content with the parent's scope, so the parent's scoped styles reach it", () => {
      const component = new Component79(`
        <script :setup></script>
        <Card><b class="inner">x</b></Card>
        <style scoped>.inner { color: red }</style>
        <template name="Card">
          <section><slot /></section>
        </template>
      `).render().mount(host)

      const stamp = $(host, ".inner")!.getAttribute("data-jq79")
      expect(stamp).toBeTruthy()
      // the section is the child's, and it is not the parent's to style
      expect($(host, "section")?.getAttribute("data-jq79")).not.toBe(stamp)
      component.destroy()
    })
  })

  describe("mistakes", () => {
    it("warns about a <template :slot> that isn't a component tag's child", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

      new Component79(`
        <div class="wrap"><template :slot.header><b class="stray">x</b></template></div>
      `).render().mount(host)

      expect($(host, ".stray")).toBe(null)
      expect(warn.mock.calls.map(([message]) => message).join("\n")).toMatch(/only as a direct child of a component tag/)
      warn.mockRestore()
    })

    it("keeps the first of two <template> for one slot, and says so", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

      new Component79(`
        <script :setup></script>
        <Card>
          <template :slot.header><b class="one">one</b></template>
          <template :slot.header><b class="two">two</b></template>
        </Card>
        <template name="Card"><section><slot.header /></section></template>
      `).render().mount(host)

      expect($(host, ".one")).not.toBe(null)
      expect($(host, ".two")).toBe(null)
      expect(warn.mock.calls.map(([message]) => message).join("\n")).toMatch(/two <template :slot.header>/)
      warn.mockRestore()
    })

    it("warns when default content is written both inside and outside a <template :slot>", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

      new Component79(`
        <script :setup></script>
        <Card>
          <template :slot><b class="in">in</b></template>
          <b class="out">out</b>
        </Card>
        <template name="Card"><section><slot /></section></template>
      `).render().mount(host)

      expect($(host, ".in")).not.toBe(null)
      expect($(host, ".out")).toBe(null)
      expect(warn.mock.calls.map(([message]) => message).join("\n")).toMatch(/both a <template :slot> and content outside it/)
      warn.mockRestore()
    })
  })

  describe("hot reload", () => {
    beforeEach(() => { enableHotReload() })

    // a re-render starts from a snapshot of the instance's data, which a symbol
    // on the store would not survive - the content rides the instance instead
    it("keeps the content a child was handed when its file is edited", () => {
      const source = (label: string) => `
        <script :setup></script>
        <Card><b class="inner">projected</b></Card>
        <template name="Card"><section class="card">${label}: <slot /></section></template>
      `
      new Component79(source("before"), { filename: "/card.html" }).render().mount(host)
      expect($(host, ".card")?.textContent).toBe("before: projected")

      expect(hotUpdate("/card.html", source("after"))).toBe(2)
      expect($(host, ".card")?.textContent).toBe("after: projected")
    })
  })

  describe("a plain nested <template>", () => {
    it("stays an inert element, with its children in .content where a clone finds them", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

      new Component79(`
        <script :setup="{ label }"></script>
        <div class="host">
          <template id="row"><li class="row">{{ label }}</li></template>
        </div>
      `).render({ label: "cloned" }).mount(host)

      const template = $(host, "template") as HTMLTemplateElement
      expect(template.childNodes).toHaveLength(0)
      expect($(host, ".row")).toBe(null) // inert: nothing of it is rendered

      host.appendChild(template.content.cloneNode(true))
      expect($(host, ".row")?.textContent).toBe("cloned")
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })
})
