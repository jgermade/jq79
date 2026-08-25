import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { $, $$, Component79, parseComponent, $reactive, renderComponent, $toRaw } from "../src/jq79"
import { DASHED_NAMES, UNDASHED_NAMES } from "../scripts/svg-attribute-corpus.mjs"

describe("renderComponent", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  it("interpolates text content and updates it reactively", () => {
    const component = parseComponent(`<div class="full-name">{{ fullName }}</div>`)
    const data = $reactive({ fullName: "Ada Lovelace" })

    container.appendChild(renderComponent(component, data))

    expect(container.querySelector(".full-name")?.textContent).toBe("Ada Lovelace")

    data.fullName = "Grace Hopper"

    expect(container.querySelector(".full-name")?.textContent).toBe("Grace Hopper")
  })

  it("applies :attrs attributes and keeps them in sync", () => {
    const component = parseComponent(`<div :attrs="{ title, disabled }"></div>`)
    const data = $reactive({ title: "hi", disabled: false })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("div")!

    expect(el.getAttribute("title")).toBe("hi")
    expect(el.hasAttribute("disabled")).toBe(false)

    data.title = "bye"
    data.disabled = true

    expect(el.getAttribute("title")).toBe("bye")
    // a boolean attribute carries nothing in its value, so it's set to ""
    expect(el.getAttribute("disabled")).toBe("")
  })

  describe(":class", () => {
    it("applies a string expression and swaps its classes reactively", () => {
      const component = parseComponent(`<div :class="theme"></div>`)
      const data = $reactive({ theme: "dark compact" })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("div")!

      expect(el.classList.contains("dark")).toBe(true)
      expect(el.classList.contains("compact")).toBe(true)

      data.theme = "light"

      expect(el.className).toBe("light")
    })

    it("toggles object-form classes on top of the static class attribute", () => {
      const component = parseComponent(`<button class="btn" :class="{ 'btn-active': active }">go</button>`)
      const data = $reactive({ active: false })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("button")!

      expect(el.className).toBe("btn")

      data.active = true
      expect(el.classList.contains("btn")).toBe(true)
      expect(el.classList.contains("btn-active")).toBe(true)

      data.active = false
      expect(el.className).toBe("btn")
    })

    it("never removes a static class, even when the expression names and drops it", () => {
      const component = parseComponent(`<div class="btn" :class="{ btn: on }"></div>`)
      const data = $reactive({ on: true })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("div")!

      data.on = false

      expect(el.classList.contains("btn")).toBe(true)
    })

    it("normalizes arrays mixing strings and objects", () => {
      const component = parseComponent(`<div :class="[theme, { active }]"></div>`)
      const data = $reactive({ theme: "dark", active: true })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("div")!

      expect(el.classList.contains("dark")).toBe(true)
      expect(el.classList.contains("active")).toBe(true)

      data.active = false
      data.theme = "light"

      expect(el.classList.contains("light")).toBe(true)
      expect(el.classList.contains("dark")).toBe(false)
      expect(el.classList.contains("active")).toBe(false)
    })

    it("contributes nothing for null/undefined/false/number values", () => {
      const component = parseComponent(`<div :class="value"></div>`)
      const data = $reactive({ value: null as any })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("div")!

      expect(el.className).toBe("")

      data.value = 42
      expect(el.className).toBe("")

      data.value = false
      expect(el.className).toBe("")

      data.value = "cond && 'active' can yield false" && "active"
      expect(el.className).toBe("active")
    })

    it("tracks a flag nested in the store, per key", () => {
      const component = parseComponent(`<li :class="{ done: task.done }"></li>`)
      const data = $reactive({ task: { done: false } })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("li")!

      expect(el.classList.contains("done")).toBe(false)

      data.task.done = true

      expect(el.classList.contains("done")).toBe(true)
    })

    it("splits object keys holding several space-separated names", () => {
      const component = parseComponent(`<div :class="{ 'a b': on }"></div>`)
      const data = $reactive({ on: true })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("div")!

      expect(el.classList.contains("a")).toBe(true)
      expect(el.classList.contains("b")).toBe(true)

      data.on = false
      expect(el.className).toBe("")
    })

    it("works per item on a :each element", () => {
      const component = parseComponent(
        `<li :each="task in tasks" :key="task.id" :class="{ done: task.done }">{{ task.name }}</li>`
      )
      const data = $reactive({ tasks: [{ id: 1, name: "a", done: false }, { id: 2, name: "b", done: true }] })

      container.appendChild(renderComponent(component, data))

      expect($$(container, "li").map(el => el.classList.contains("done"))).toEqual([false, true])

      data.tasks[0].done = true

      expect($$(container, "li").map(el => el.classList.contains("done"))).toEqual([true, true])
    })

    it("toggles a single class with the :class.<name> shorthand", () => {
      const component = parseComponent(`<div class="drop" :class.active="dropping"></div>`)
      const data = $reactive({ dropping: false })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("div")!

      expect(el.className).toBe("drop")

      data.dropping = true
      expect(el.classList.contains("drop")).toBe(true)
      expect(el.classList.contains("active")).toBe(true)

      data.dropping = false
      expect(el.className).toBe("drop")
    })

    it("unions a :class.<name> shorthand with a bare :class", () => {
      const component = parseComponent(`<div :class="theme" :class.active="on"></div>`)
      const data = $reactive({ theme: "dark", on: true })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("div")!

      expect(el.classList.contains("dark")).toBe(true)
      expect(el.classList.contains("active")).toBe(true)

      data.theme = "light"
      data.on = false
      expect(el.className).toBe("light")
    })

    it("supports several :class.<name> toggles, including kebab names", () => {
      const component = parseComponent(`<div :class.busy="busy" :class.is-open="open"></div>`)
      const data = $reactive({ busy: true, open: false })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("div")!

      expect(el.classList.contains("busy")).toBe(true)
      expect(el.classList.contains("is-open")).toBe(false)

      data.busy = false
      data.open = true
      expect(el.classList.contains("busy")).toBe(false)
      expect(el.classList.contains("is-open")).toBe(true)
    })

    it("never removes a static class a :class.<name> toggle names then drops", () => {
      const component = parseComponent(`<div class="active" :class.active="on"></div>`)
      const data = $reactive({ on: true })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector("div")!

      data.on = false
      expect(el.classList.contains("active")).toBe(true)
    })

    it("works per item on a :each element", () => {
      const component = parseComponent(
        `<li :each="task in tasks" :key="task.id" :class.done="task.done">{{ task.name }}</li>`
      )
      const data = $reactive({ tasks: [{ id: 1, name: "a", done: false }, { id: 2, name: "b", done: true }] })

      container.appendChild(renderComponent(component, data))

      expect($$(container, "li").map(el => el.classList.contains("done"))).toEqual([false, true])

      data.tasks[0].done = true

      expect($$(container, "li").map(el => el.classList.contains("done"))).toEqual([true, true])
    })
  })

  describe("multi-line expressions", () => {
    it("interpolates a {{ }} expression spanning several lines", () => {
      const component = parseComponent(`<p class="out">{{ items\n  .map(n => n * 2)\n  .join(",") }}</p>`)
      const data = $reactive({ items: [1, 2, 3] })

      container.appendChild(renderComponent(component, data))

      expect($(container, ".out")?.textContent).toBe("2,4,6")

      data.items = [5]
      expect($(container, ".out")?.textContent).toBe("10")
    })

    it("iterates an :each list expression spanning several lines", () => {
      const component = parseComponent(
        `<ul><li class="item" :each="n in items\n  .filter(n => n > 1)\n  .map(n => n * 10)">{{ n }}</li></ul>`
      )
      const data = $reactive({ items: [1, 2, 3] })

      container.appendChild(renderComponent(component, data))

      expect($$(container, ".item").map(el => el.textContent)).toEqual(["20", "30"])

      data.items = [1, 2, 3, 4]
      expect($$(container, ".item").map(el => el.textContent)).toEqual(["20", "30", "40"])
    })

    it("survives a trailing line comment in an expression", () => {
      // the compiled body is one line, so without the newline compileExpr
      // adds before `)`, the comment would swallow the rest and the whole
      // expression silently never compiled
      const component = parseComponent(`<p class="out">{{ msg // the greeting }}</p>`)
      const data = $reactive({ msg: "hola" })

      container.appendChild(renderComponent(component, data))

      expect($(container, ".out")?.textContent).toBe("hola")

      data.msg = "adios"
      expect($(container, ".out")?.textContent).toBe("adios")
    })

    it("evaluates multi-line :if and :attrs expressions", () => {
      const component = parseComponent(
        `<div class="box" :if="items\n  .filter(n => n > 1)\n  .length > 0" :attrs="{\n  'data-count': items.length,\n}"></div>`
      )
      const data = $reactive({ items: [1, 2, 3] })

      container.appendChild(renderComponent(component, data))

      expect($(container, ".box")?.getAttribute("data-count")).toBe("3")

      data.items = [1]
      expect($(container, ".box")).toBeNull()
    })
  })

  describe(":text / :html", () => {
    it("sets textContent from :text and updates it reactively", () => {
      const component = parseComponent(`<div class="n" :text="user.name"></div>`)
      const data = $reactive({ user: { name: "Ada" } })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector(".n")!

      expect(el.textContent).toBe("Ada")

      data.user.name = "Grace"

      expect(el.textContent).toBe("Grace")
    })

    it(":text does not parse markup - it's inserted as literal text", () => {
      const component = parseComponent(`<div class="n" :text="markup"></div>`)
      const data = $reactive({ markup: "<b>bold</b>" })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector(".n")!

      expect(el.textContent).toBe("<b>bold</b>")
      expect(el.querySelector("b")).toBeNull()
    })

    it(":text overrides the element's own template children", () => {
      const component = parseComponent(`<div class="n" :text="label">ignored</div>`)
      const data = $reactive({ label: "shown" })

      container.appendChild(renderComponent(component, data))

      expect(container.querySelector(".n")?.textContent).toBe("shown")
    })

    it("falls back to an empty string when :text evaluates to null/undefined", () => {
      const component = parseComponent(`<div class="n" :text="missing"></div>`)
      const data = $reactive({ missing: undefined as any })

      container.appendChild(renderComponent(component, data))

      expect(container.querySelector(".n")?.textContent).toBe("")
    })

    it("sets innerHTML from :html and updates it reactively", () => {
      const component = parseComponent(`<div class="n" :html="body"></div>`)
      const data = $reactive({ body: "<p>hello <b>world</b></p>" })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector(".n")!

      expect(el.innerHTML).toBe("<p>hello <b>world</b></p>")

      data.body = "<p>bye</p>"

      expect(el.innerHTML).toBe("<p>bye</p>")
    })

    it("sanitizes :html, stripping disallowed tags/attributes and unsafe URLs", () => {
      const component = parseComponent(`<div class="n" :html="body"></div>`)
      const data = $reactive({
        body: `<p onclick="evil()">hi</p><script>evil()</script><a href="javascript:evil()">link</a>`,
      })

      container.appendChild(renderComponent(component, data))
      const el = container.querySelector(".n")!

      expect(el.querySelector("script")).toBeNull()
      expect(el.querySelector("p")?.hasAttribute("onclick")).toBe(false)
      expect(el.querySelector("a")?.hasAttribute("href")).toBe(false)
      expect(el.textContent).toContain("hi")
    })

    it(":html overrides the element's own template children", () => {
      const component = parseComponent(`<div class="n" :html="body">ignored</div>`)
      const data = $reactive({ body: "<em>shown</em>" })

      container.appendChild(renderComponent(component, data))

      expect(container.querySelector(".n")?.innerHTML).toBe("<em>shown</em>")
    })
  })

  it("renders the :if branch when the condition is true and removes it when false", () => {
    const component = parseComponent(`<div :if="show" class="a">yes</div>`)
    const data = $reactive({ show: true })

    container.appendChild(renderComponent(component, data))

    expect(container.querySelector(".a")).not.toBeNull()

    data.show = false

    expect(container.querySelector(".a")).toBeNull()
  })

  it("walks an :if/:elseif/:else chain and swaps branches reactively", () => {
    const component = parseComponent(
      `<div :if="score > 8" class="a">great</div>` +
      `<div :elseif="score > 4" class="b">ok</div>` +
      `<div :else class="c">bad</div>`
    )
    const data = $reactive({ score: 2 })

    container.appendChild(renderComponent(component, data))

    expect(container.querySelector(".c")).not.toBeNull()
    expect(container.querySelector(".a")).toBeNull()
    expect(container.querySelector(".b")).toBeNull()

    data.score = 6

    expect(container.querySelector(".b")).not.toBeNull()
    expect(container.querySelector(".a")).toBeNull()
    expect(container.querySelector(".c")).toBeNull()

    data.score = 10

    expect(container.querySelector(".a")).not.toBeNull()
    expect(container.querySelector(".b")).toBeNull()
    expect(container.querySelector(".c")).toBeNull()
  })

  // the branches of a chain are siblings in the AST, and a real template writes
  // them on their own lines - so the indentation between them lands in the AST
  // too, and must not break the chain into three unrelated :if nodes
  it("walks an :if/:else chain written across lines", () => {
    const component = parseComponent(`
      <div :if="ok" class="a">yes</div>
      <div :elseif="maybe" class="b">maybe</div>
      <div :else class="c">no</div>
    `)
    const data = $reactive({ ok: false, maybe: false })

    container.appendChild(renderComponent(component, data))

    expect(container.querySelector(".c")).not.toBeNull()
    expect(container.querySelector(".a")).toBeNull()
    expect(container.querySelector(".b")).toBeNull()

    data.maybe = true

    expect(container.querySelector(".b")).not.toBeNull()
    expect(container.querySelector(".c")).toBeNull()

    data.ok = true

    expect(container.querySelector(".a")).not.toBeNull()
    expect(container.querySelector(".b")).toBeNull()
    expect(container.querySelector(".c")).toBeNull()
  })

  // a template is HTML: siblings on separate lines are separated by a space when
  // the browser renders them, so the template can't quietly glue them together
  it("keeps the whitespace between siblings and around inline text", () => {
    const component = parseComponent(`<p>
      <span>uno</span>
      <span>dos</span>
      hola <b>{{ who }}</b> adios
    </p>`)

    container.appendChild(renderComponent(component, $reactive({ who: "mundo" })))

    expect(container.querySelector("p")?.innerHTML).toBe(
      "\n      <span>uno</span>\n      <span>dos</span>\n      hola <b>mundo</b> adios\n    "
    )
  })

  it("renders a list with :each and re-renders it when the array changes", () => {
    const component = parseComponent(`<li :each="name in names">{{ name }}</li>`)
    const data = $reactive({ names: ["a", "b"] })

    container.appendChild(renderComponent(component, data))

    expect($$(container, "li").map(el => el.textContent)).toEqual(["a", "b"])

    data.names = ["x", "y", "z"]

    expect($$(container, "li").map(el => el.textContent)).toEqual(["x", "y", "z"])
  })

  it("exposes $index inside :each", () => {
    const component = parseComponent(`<li :each="name in names">{{ $index }}:{{ name }}</li>`)
    const data = $reactive({ names: ["a", "b"] })

    container.appendChild(renderComponent(component, data))

    expect($$(container, "li").map(el => el.textContent)).toEqual(["0:a", "1:b"])
  })

  it("updates the template when a key it renders is deleted", () => {
    const component = parseComponent(`<span class="v">{{ user ? user.name : "none" }}</span>`)
    const data = $reactive({ user: { name: "Ada" } } as { user?: { name: string } })

    container.appendChild(renderComponent(component, data))
    expect($(container, ".v")?.textContent).toBe("Ada")

    delete data.user

    expect($(container, ".v")?.textContent).toBe("none")
  })

  it("does not touch unrelated bindings when an unrelated property changes", () => {
    const component = parseComponent(`<div>{{ title }}</div><div :attrs="{ label }"></div>`)
    const data = $reactive({ title: "hi", label: "x", unrelated: 1 })

    container.appendChild(renderComponent(component, data))
    const [titleEl, boundEl] = container.querySelectorAll("div")

    data.unrelated = 2

    // still the exact same DOM nodes/content - nothing was torn down and rebuilt
    expect(container.querySelectorAll("div")[0]).toBe(titleEl)
    expect(container.querySelectorAll("div")[1]).toBe(boundEl)
    expect(titleEl.textContent).toBe("hi")
    expect(boundEl.getAttribute("label")).toBe("x")
  })

  it("does not rebuild an :if branch's DOM when an unrelated property changes", () => {
    const component = parseComponent(`<div :if="show" class="a">yes</div>`)
    const data = $reactive({ show: true, unrelated: 1 })

    container.appendChild(renderComponent(component, data))
    const branchEl = container.querySelector(".a")

    data.unrelated = 2

    expect(container.querySelector(".a")).toBe(branchEl)
  })

  it("does not rebuild :each list DOM when an unrelated property changes", () => {
    const component = parseComponent(`<li :each="name in names">{{ name }}</li>`)
    const data = $reactive({ names: ["a", "b"], unrelated: 1 })

    container.appendChild(renderComponent(component, data))
    const before = $$(container, "li")

    data.unrelated = 2

    const after = $$(container, "li")
    expect(after).toEqual(before)
  })

  it("updates just one :each item's text when only that item's nested property changes, without rebuilding the list", () => {
    const component = parseComponent(`<li :each="user in users" :key="user.id">{{ user.name }}</li>`)
    const data = $reactive({ users: [{ id: 1, name: "Ada" }, { id: 2, name: "Grace" }] })

    container.appendChild(renderComponent(component, data))
    const before = $$(container, "li")

    data.users[0].name = "Ada Lovelace"

    const after = $$(container, "li")
    expect(after).toEqual(before) // same DOM node instances, just their own text updated
    expect(after.map(el => el.textContent)).toEqual(["Ada Lovelace", "Grace"])
  })

  it("keeps unchanged keyed items' DOM/state stable when the list is reordered", () => {
    const component = parseComponent(`<li :each="user in users" :key="user.id"><input :attrs="{ value: user.name }"></li>`)
    const data = $reactive({
      users: [{ id: 1, name: "Ada" }, { id: 2, name: "Grace" }, { id: 3, name: "Katherine" }],
    })

    container.appendChild(renderComponent(component, data))
    const inputs = $$(container, "input") as HTMLInputElement[]
    inputs[0].dataset.marker = "ada-input"

    data.users = [data.users[2], data.users[0], data.users[1]]

    const reordered = $$(container, "li input") as HTMLInputElement[]
    expect(reordered.map(el => el.value)).toEqual(["Katherine", "Ada", "Grace"])
    // the input for user 1 (Ada) is still the exact same DOM node, just moved
    expect(reordered[1].dataset.marker).toBe("ada-input")
  })

  it("renders a comment placeholder for an unparseable :each expression", () => {
    const component = parseComponent(`<li :each="not an each expression">{{ name }}</li>`)
    const data = $reactive({})

    container.appendChild(renderComponent(component, data))

    expect($$(container, "li")).toEqual([])
    expect(container.firstChild?.nodeType).toBe(Node.COMMENT_NODE)
    expect(container.firstChild?.textContent).toContain("invalid :each expression")
  })

  it("removes a dropped keyed item's node and disposes its effect", () => {
    const component = parseComponent(`<li :each="user in users" :key="user.id">{{ user.name }}</li>`)
    const data = $reactive({
      users: [{ id: 1, name: "Ada" }, { id: 2, name: "Grace" }, { id: 3, name: "Katherine" }],
    })

    container.appendChild(renderComponent(component, data))
    const grace = data.users[1] // the reactive item, kept alive after it leaves the list
    const removedNode = $$(container, "li")[1]

    data.users = [data.users[0], data.users[2]]

    expect($$(container, "li").map(el => el.textContent)).toEqual(["Ada", "Katherine"])
    expect(container.contains(removedNode)).toBe(false)

    // the dropped item's effect is disposed: its detached node stops re-rendering
    grace.name = "Grace Hopper"
    expect(removedNode.textContent).toBe("Grace")
  })

  describe(":each corners", () => {
    it("keeps $index fresh after a keyed reorder, in bindings and handlers alike", () => {
      const seen: number[] = []
      const component = parseComponent(
        `<li :each="u in users" :key="u.id" @click="record($index)">{{ $index }}:{{ u.name }}</li>`
      )
      const data = $reactive({
        record: (i: number) => seen.push(i),
        users: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }],
      })
      container.appendChild(renderComponent(component, data))

      data.users = [data.users[2], data.users[0], data.users[1]]

      expect($$(container, "li").map(el => el.textContent)).toEqual(["0:c", "1:a", "2:b"])
      $$(container, "li").forEach(el => el.dispatchEvent(new MouseEvent("click", { bubbles: true })))
      expect(seen).toEqual([0, 1, 2])
    })

    it("follows in-place mutation: reverse() and push()", () => {
      const component = parseComponent(`<li :each="u in users" :key="u.id">{{ u.name }}</li>`)
      const data = $reactive({ users: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }] })
      container.appendChild(renderComponent(component, data))

      data.users.reverse()
      expect($$(container, "li").map(el => el.textContent)).toEqual(["c", "b", "a"])

      data.users.push({ id: 4, name: "d" })
      expect($$(container, "li").map(el => el.textContent)).toEqual(["c", "b", "a", "d"])
    })

    it("nests :each scopes, inner lists updating on their own", () => {
      const component = parseComponent(
        `<ul><li :each="row in rows"><b :each="cell in row.cells">{{ row.tag }}{{ cell }}</b></li></ul>`
      )
      const data = $reactive({ rows: [{ tag: "r1-", cells: ["a", "b"] }, { tag: "r2-", cells: ["c"] }] })
      container.appendChild(renderComponent(component, data))

      expect($$(container, "b").map(el => el.textContent)).toEqual(["r1-a", "r1-b", "r2-c"])

      data.rows[0].cells = ["a", "b", "x"]
      expect($$(container, "b").map(el => el.textContent)).toEqual(["r1-a", "r1-b", "r1-x", "r2-c"])
    })

    it("takes :with on the :each element itself, over the item scope", () => {
      const component = parseComponent(`<li :each="u in users" :with="u.profile">{{ city }}</li>`)
      const data = $reactive({ users: [{ profile: { city: "NYC" } }, { profile: { city: "LA" } }] })
      container.appendChild(renderComponent(component, data))

      expect($$(container, "li").map(el => el.textContent)).toEqual(["NYC", "LA"])
    })

    it("renders nothing for a non-array, and the list when one arrives", () => {
      const component = parseComponent(`<li :each="n in items">{{ n }}</li>`)
      const data = $reactive({ items: null as any })
      container.appendChild(renderComponent(component, data))

      expect($$(container, "li")).toHaveLength(0)

      data.items = ["x"]
      expect($$(container, "li").map(el => el.textContent)).toEqual(["x"])
    })

    it("renders falsy items as values, not as holes", () => {
      const component = parseComponent(`<li :each="n in items">[{{ n }}]</li>`)
      container.appendChild(renderComponent(component, $reactive({ items: [0, "", false, null] })))

      expect($$(container, "li").map(el => el.textContent)).toEqual(["[0]", "[]", "[false]", "[]"])
    })

    it("degrades duplicate keys to positional pairing, with a warning", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const component = parseComponent(`<li :each="u in users" :key="u.k">{{ u.name }}</li>`)
      const data = $reactive({ users: [{ k: 1, name: "a" }] })
      container.appendChild(renderComponent(component, data))

      // same key twice: the diff used to match one entry for both, disposing
      // a reused row and resurrecting a removed one - a zombie third <li>
      data.users = [data.users[0], { k: 1, name: "b" }]
      expect($$(container, "li").map(el => el.textContent)).toEqual(["a", "b"])
      expect(warn).toHaveBeenCalledOnce()

      // both rows stay live and consistent through later updates
      data.users[0].name = "a2"
      expect($$(container, "li").map(el => el.textContent)).toEqual(["a2", "b"])
      warn.mockRestore()
    })

    it("ignores :if on a :each element, out loud", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const component = parseComponent(`<li :each="n in items" :if="n > 1">{{ n }}</li>`)
      container.appendChild(renderComponent(component, $reactive({ items: [1, 2, 3] })))

      // not per-item filtering: everything renders, and the console says why
      expect($$(container, "li").map(el => el.textContent)).toEqual(["1", "2", "3"])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(":if/:elseif/:else on a :each element"))
      warn.mockRestore()
    })
  })

  // the flaky seams found in the 2026-07-15 review, closed by the effect
  // runner hardening (RECORD/2026-07-15.effect-runner-hardening.md): a
  // reentrancy guard with a trailing re-run, no-op writes not notifying, and
  // repositioned entries refreshing their dep-less bindings
  describe(":each flaky seams", () => {
    it("keeps a binding that reads ONLY $index fresh across keyed reorders", () => {
      // $index is an untracked scope var, so this binding has no deps - the
      // move reaches it through the repositioned entry's refresh, not through
      // a lucky unrelated new-key sweep as before
      const component = parseComponent(`<li :each="u in users" :key="u.id">{{ $index }}</li>`)
      const data = $reactive({ users: [{ id: 1 }, { id: 2 }] })
      container.appendChild(renderComponent(component, data))

      data.users = [data.users[1], data.users[0]]

      expect($$(container, "li").map(el => el.textContent)).toEqual(["0", "1"])
    })

    it("still refreshes a moved entry when a nested tag is handed $index as a prop", () => {
      // the positional-name walk has to reach attributes of nodes *inside* the
      // item, not just the item's own - a prop is how $index escapes into a
      // child (RECORD/2026-08-23.positional-refresh.md)
      const component = parseComponent(`<li :each="u in users" :key="u.id"><b :data-at="$index"></b></li>`)
      const data = $reactive({ users: [{ id: 1 }, { id: 2 }] })
      container.appendChild(renderComponent(component, data))

      data.users = [data.users[1], data.users[0]]

      expect($$(container, "b").map(el => el.getAttribute("data-at"))).toEqual(["0", "1"])
    })

    it("does not re-run a moved entry's bindings when nothing in the item reads a position", () => {
      // the refresh exists for position-only bindings; a template that names no
      // position cannot have one, and re-running every binding of every moved
      // row was 9ms of removeRow's 25ms. Ten rows with two swapped, so the
      // container diff notifies those two precisely instead of sweeping - the
      // two entries move, and their bindings must run once, not twice
      const runs: string[] = []
      const component = parseComponent(`<li :each="u in users" :key="u.id">{{ seen(u.name) }}</li>`)
      const data = $reactive({
        users: Array.from({ length: 10 }, (_, i) => ({ id: i, name: `u${i}` })),
        seen: (name: string) => { runs.push(name); return name },
      })
      container.appendChild(renderComponent(component, data))
      runs.length = 0

      const next = [...($toRaw(data.users) as any[])]
      ;[next[8], next[9]] = [next[9], next[8]]
      data.users = next

      expect($$(container, "li").map(el => el.textContent)).toEqual(
        ["u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7", "u9", "u8"]
      )
      // once each, in creation order - not twice, which is what the
      // unconditional refresh did
      expect(runs).toEqual(["u8", "u9"])
    })

    it("survives a store write during item render without re-entering the diff", () => {
      // a NEW store key created while an item renders (here by the item's own
      // text effect; in real code, a child component's setup writing to a
      // shared store) sweeps every effect - the list effect must finish its
      // run and repeat, not re-enter mid-map and duplicate its rows
      const component = parseComponent(
        `<li :each="u in users" :key="u.id">{{ (seen["k" + u.id] ??= u.name) && u.name }}</li>`
      )
      const data = $reactive({ users: [{ id: 1, name: "a" }, { id: 2, name: "b" }], seen: {} })
      container.appendChild(renderComponent(component, data))

      expect($$(container, "li").map(el => el.textContent)).toEqual(["a", "b"])
    })

    it("appends an item whose render writes a new store key, exactly once", () => {
      const component = parseComponent(
        `<li :each="u in users" :key="u.id">{{ (seen["k" + u.id] ??= u.name) && u.name }}</li>`
      )
      const data = $reactive({ users: [{ id: 1, name: "a" }], seen: {} })
      container.appendChild(renderComponent(component, data))
      expect($$(container, "li").map(el => el.textContent)).toEqual(["a"])

      data.users = [...data.users, { id: 2, name: "b" }]

      expect($$(container, "li").map(el => el.textContent)).toEqual(["a", "b"])
    })

    it("moves only the rows that really moved, not every row after them", () => {
      // the positioning walk used to demand that each entry follow the one
      // before it, which is minimal for an append and quadratic for a reorder:
      // one row out of place cascaded into a move for every row behind it. The
      // longest increasing run of old positions is what says which rows are
      // already in order relative to each other, and those are left alone
      const component = parseComponent(`<li :each="u in users" :key="u.id">{{ u.name }}</li>`)
      const data = $reactive({ users: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `u${i}` })) })
      container.appendChild(renderComponent(component, data))

      const next = [...($toRaw(data.users) as any[])]
      ;[next[1], next[98]] = [next[98], next[1]]
      const insertBefore = vi.spyOn(Node.prototype, "insertBefore")
      data.users = next
      const moves = insertBefore.mock.calls.length
      insertBefore.mockRestore()

      const names = $$(container, "li").map(el => el.textContent)
      expect(names[0]).toBe("u0")
      expect(names[1]).toBe("u98")
      expect(names[98]).toBe("u1")
      expect(names[99]).toBe("u99")
      expect(moves).toBe(2)
    })

    it("keys a list the same whether or not the expression takes the fast path", () => {
      // `row.id` is read straight off the item; a deeper path, a call, or a
      // name from the outer scope still goes through evalExpr. All four have to
      // agree on identity, or a reorder rebuilds rows it should have reused
      for (const keyExpr of ["u.id", "u.meta.id", "String(u.id)", "ids[u.id]"]) {
        const host = document.createElement("div")
        container.appendChild(host)
        const component = parseComponent(`<li :each="u in users" :key="${keyExpr}">{{ u.name }}</li>`)
        const data = $reactive({
          users: [{ id: 1, name: "a", meta: { id: 1 } }, { id: 2, name: "b", meta: { id: 2 } }],
          ids: { 1: "one", 2: "two" },
        })
        host.appendChild(renderComponent(component, data))
        const [first, second] = $$(host, "li")

        data.users = [data.users[1], data.users[0]]

        expect($$(host, "li").map(el => el.textContent)).toEqual(["b", "a"])
        // reused, not rebuilt: the same two elements came back in the new order
        expect($$(host, "li")[0]).toBe(second)
        expect($$(host, "li")[1]).toBe(first)
      }
    })

    it("removes a spliced row without re-running the bindings of the ones that stay", () => {
      // `data.filter(...)` shifts every row behind the cut, which read as a
      // wholesale replacement and swept the container: 1,000 rows meant ~3,000
      // bindings re-rendering identical output. The rows did not change - they
      // moved - and the diff now says so (RECORD/2026-08-23.notify-a-splice.md)
      const runs: string[] = []
      const component = parseComponent(`<li :each="u in users" :key="u.id">{{ seen(u.name) }}</li>`)
      const data = $reactive({
        users: Array.from({ length: 10 }, (_, i) => ({ id: i, name: `u${i}` })),
        seen: (name: string) => { runs.push(name); return name },
      })
      container.appendChild(renderComponent(component, data))
      runs.length = 0

      data.users = ($toRaw(data.users) as any[]).filter(user => user.id !== 1)

      expect($$(container, "li").map(el => el.textContent)).toEqual(
        ["u0", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"]
      )
      // the `:each` heard it and dropped the row; not one survivor re-rendered
      expect(runs).toEqual([])
    })

    it("inserts a row at the front the same way", () => {
      const runs: string[] = []
      const component = parseComponent(`<li :each="u in users" :key="u.id">{{ seen(u.name) }}</li>`)
      const data = $reactive({
        users: Array.from({ length: 10 }, (_, i) => ({ id: i, name: `u${i}` })),
        seen: (name: string) => { runs.push(name); return name },
      })
      container.appendChild(renderComponent(component, data))
      runs.length = 0

      data.users = [{ id: 99, name: "new" }, ...($toRaw(data.users) as any[])]

      expect($$(container, "li").map(el => el.textContent)[0]).toBe("new")
      expect($$(container, "li")).toHaveLength(11)
      // only the row that arrived renders
      expect(runs).toEqual(["new"])
    })

    it("updates a binding that reads a row by index when the splice moves it", () => {
      // the other reader of a list: `users[6]` means "whoever sits at slot 6",
      // so a removal ahead of it is a change to what it reads even though no
      // row changed. It holds the slot as a dep of its own for exactly this
      // (see indexable in src/reactive.ts)
      const component = parseComponent(`<p>{{ users[6].name }}</p>`)
      const data = $reactive({ users: Array.from({ length: 10 }, (_, i) => ({ id: i, name: `u${i}` })) })
      container.appendChild(renderComponent(component, data))
      expect($(container, "p")?.textContent).toBe("u6")

      data.users = ($toRaw(data.users) as any[]).filter(user => user.id !== 1)

      expect($(container, "p")?.textContent).toBe("u7")
    })

    it("evaluates a :key without ever writing the loop name into the store", () => {
      // the key expression needs the item bound to a scope to read it from, and
      // one scratch scope now serves the whole pass - the loop variable written
      // into it by plain assignment, which is only safe because the property is
      // already the scratch's own (see defineScopeVar). Were it not, the write
      // would delegate up to the store's set trap and land as a real mutation
      // of the same-named key, here `item`
      const component = parseComponent(`<li :each="item in items" :key="item.id">{{ item.name }}</li>`)
      const data = $reactive({ item: "untouched", items: [{ id: 1, name: "a" }, { id: 2, name: "b" }] })
      container.appendChild(renderComponent(component, data))

      // a second pass, so the scratch is reused rather than freshly defined
      data.items = [...data.items, { id: 3, name: "c" }]

      expect($$(container, "li").map(el => el.textContent)).toEqual(["a", "b", "c"])
      expect(data.item).toBe("untouched")
    })
  })

  describe(":each second binding", () => {
    it("names the array index, and keeps it fresh after a keyed reorder", () => {
      const component = parseComponent(`<li :each="u, i in users" :key="u.id">{{ i }}:{{ u.name }}</li>`)
      const data = $reactive({ users: [{ id: 1, name: "a" }, { id: 2, name: "b" }] })
      container.appendChild(renderComponent(component, data))

      expect($$(container, "li").map(el => el.textContent)).toEqual(["0:a", "1:b"])

      data.users = [data.users[1], data.users[0]]
      expect($$(container, "li").map(el => el.textContent)).toEqual(["0:b", "1:a"])
    })

    it("lets nested loops hold both indices - what $index alone can't", () => {
      const component = parseComponent(
        `<ul><li :each="row, r in rows"><b :each="cell, c in row" :key="cell">{{ r }}.{{ c }}:{{ cell }}</b></li></ul>`
      )
      container.appendChild(renderComponent(component, $reactive({ rows: [["a", "b"], ["c"]] })))

      expect($$(container, "b").map(el => el.textContent)).toEqual(["0.0:a", "0.1:b", "1.0:c"])
    })

    it("iterates a plain object as its entries, parens form included", () => {
      const component = parseComponent(`<li :each="(value, key) in labels">{{ key }}={{ value }}</li>`)
      const data = $reactive({ labels: { es: "Hola", en: "Hello" } })
      container.appendChild(renderComponent(component, data))

      expect($$(container, "li").map(el => el.textContent)).toEqual(["es=Hola", "en=Hello"])

      // per-key reactivity, deletes included (the deleteProperty trap)
      data.labels.es = "¡Hola!"
      expect($$(container, "li")[0].textContent).toBe("es=¡Hola!")
      data.labels.fr = "Salut"
      expect($$(container, "li").map(el => el.textContent)).toEqual(["es=¡Hola!", "en=Hello", "fr=Salut"])
      delete data.labels.en
      expect($$(container, "li").map(el => el.textContent)).toEqual(["es=¡Hola!", "fr=Salut"])
    })

    it("diffs object entries by property key: deleting one leaves the rest alone", () => {
      const component = parseComponent(`<li :each="(user, id) in users">{{ id }}:{{ user.name }}</li>`)
      const data = $reactive({ users: { u1: { name: "Ada" }, u2: { name: "Grace" }, u3: { name: "Katherine" } } })
      container.appendChild(renderComponent(component, data))
      const [first, , third] = $$(container, "li")

      delete data.users.u2

      expect($$(container, "li").map(el => el.textContent)).toEqual(["u1:Ada", "u3:Katherine"])
      // same key, same item: the survivors kept their DOM
      expect($$(container, "li")[0]).toBe(first)
      expect($$(container, "li")[1]).toBe(third)
    })

    it("still rejects a malformed binding list with the comment placeholder", () => {
      const component = parseComponent(`<li :each="item, in items">{{ item }}</li>`)
      container.appendChild(renderComponent(component, $reactive({ items: [1] })))

      expect($$(container, "li")).toHaveLength(0)
      expect(container.firstChild?.textContent).toContain("invalid :each expression")
    })
  })

  describe(":with", () => {
    it("resolves names against the object first, falling back to the outer scope", () => {
      const component = parseComponent(
        `<div :each="item in items">` +
        `<b class="direct">{{ item.name }}</b>` +
        `<i class="via" :with="item">{{ name }} of {{ items.length }}</i>` +
        `</div>`
      )
      const data = $reactive({ items: [{ name: "Ada" }, { name: "Grace" }] })

      container.appendChild(renderComponent(component, data))

      expect($$(container, ".direct").map(el => el.textContent)).toEqual(["Ada", "Grace"])
      expect($$(container, ".via").map(el => el.textContent)).toEqual(["Ada of 2", "Grace of 2"])
    })

    it("shadows same-named outer scope properties", () => {
      const component = parseComponent(`<div :with="user"><span class="n">{{ name }}</span></div>`)
      const data = $reactive({ name: "outer", user: { name: "inner" } })

      container.appendChild(renderComponent(component, data))

      expect($(container, ".n")?.textContent).toBe("inner")
    })

    it("stays reactive to property mutations and to replacing the object itself", () => {
      const component = parseComponent(`<div :with="user"><span class="n">{{ name }}</span></div>`)
      const data = $reactive({ user: { name: "Ada" } })

      container.appendChild(renderComponent(component, data))
      expect($(container, ".n")?.textContent).toBe("Ada")

      data.user.name = "Grace"
      expect($(container, ".n")?.textContent).toBe("Grace")

      data.user = { name: "Katherine" }
      expect($(container, ".n")?.textContent).toBe("Katherine")
    })

    it("applies to the element's own bindings, and assignments write through to the object", () => {
      const component = parseComponent(
        `<button :with="user" :attrs="{ title: name }" @click="name = 'Grace'">go</button>` +
        `<span class="outside">{{ user.name }}</span>`
      )
      const data = $reactive({ user: { name: "Ada" } })

      container.appendChild(renderComponent(component, data))
      const button = $(container, "button")!
      expect(button.getAttribute("title")).toBe("Ada")

      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))

      expect(data.user.name).toBe("Grace")
      expect(button.getAttribute("title")).toBe("Grace")
      expect($(container, ".outside")?.textContent).toBe("Grace")
    })

    it("writes assignments to names the object does not own through to the outer scope", () => {
      const component = parseComponent(
        `<button :with="user" @click="status = 'saved'">go</button>` +
        `<span class="s">{{ status }}</span>`
      )
      const data = $reactive({ status: "idle", user: { name: "Ada" } })

      container.appendChild(renderComponent(component, data))
      $(container, "button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))

      expect(data.status).toBe("saved")
      expect((data.user as any).status).toBeUndefined()
      expect($(container, ".s")?.textContent).toBe("saved")
    })

    it("falls back entirely to the outer scope when the expression is not an object", () => {
      const component = parseComponent(`<div :with="missing"><span class="n">{{ name }}</span></div>`)
      const data = $reactive({ name: "outer", missing: null as any })

      container.appendChild(renderComponent(component, data))

      expect($(container, ".n")?.textContent).toBe("outer")
    })

    it("does not render :with as an attribute", () => {
      const component = parseComponent(`<div class="w" :with="user"></div>`)
      const data = $reactive({ user: { name: "Ada" } })

      container.appendChild(renderComponent(component, data))

      expect($(container, ".w")?.hasAttribute(":with")).toBe(false)
    })
  })

  describe("@event attributes", () => {
    it("calls a handler referenced by name with the event", () => {
      const onClick = vi.fn()
      const component = parseComponent(`<button @click="onClick">go</button>`)
      const data = $reactive({ onClick })

      container.appendChild(renderComponent(component, data))
      const button = $(container, "button")!
      button.dispatchEvent(new MouseEvent("click"))

      expect(onClick).toHaveBeenCalledTimes(1)
      expect(onClick.mock.calls[0][0]).toBeInstanceOf(Event)
    })

    it("supports inline arrow handlers using $event", () => {
      const onSubmit = vi.fn()
      const component = parseComponent(`<form @submit.prevent="$event => onSubmit($event)"><button>ok</button></form>`)
      const data = $reactive({ onSubmit })

      container.appendChild(renderComponent(component, data))
      const form = $(container, "form")!
      const event = new Event("submit", { cancelable: true })
      form.dispatchEvent(event)

      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(onSubmit).toHaveBeenCalledWith(event)
      // .prevent modifier
      expect(event.defaultPrevented).toBe(true)
    })

    it("supports inline statements that mutate reactive data", () => {
      const component = parseComponent(`<button @click="count = count + 1">{{ count }}</button>`)
      const data = $reactive({ count: 0 })

      container.appendChild(renderComponent(component, data))
      const button = $(container, "button")!

      button.dispatchEvent(new MouseEvent("click"))
      button.dispatchEvent(new MouseEvent("click"))

      expect(data.count).toBe(2)
      expect(button.textContent).toBe("2")
    })

    it("applies the .stop modifier", () => {
      const onOuter = vi.fn()
      const component = parseComponent(
        `<div @click="onOuter"><button class="inner" @click.stop="() => {}">x</button></div>`
      )
      const data = $reactive({ onOuter })

      container.appendChild(renderComponent(component, data))
      $(container, ".inner")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))

      expect(onOuter).not.toHaveBeenCalled()
    })

    it("applies the .once modifier", () => {
      const onClick = vi.fn()
      const component = parseComponent(`<button @click.once="onClick">go</button>`)
      const data = $reactive({ onClick })

      container.appendChild(renderComponent(component, data))
      const button = $(container, "button")!
      button.dispatchEvent(new MouseEvent("click"))
      button.dispatchEvent(new MouseEvent("click"))

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it("applies the .self modifier", () => {
      const onClick = vi.fn()
      const component = parseComponent(`<div class="outer" @click.self="onClick"><button class="inner">x</button></div>`)
      const data = $reactive({ onClick })

      container.appendChild(renderComponent(component, data))

      $(container, ".inner")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      expect(onClick).not.toHaveBeenCalled()

      $(container, ".outer")!.dispatchEvent(new MouseEvent("click"))
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it("does not render @event attributes into the DOM", () => {
      const component = parseComponent(`<button @click="onClick">go</button>`)
      const data = $reactive({ onClick: () => {} })

      container.appendChild(renderComponent(component, data))

      expect($(container, "button")!.hasAttribute("@click")).toBe(false)
    })
  })
})

// sharp edges of attribute binding, pinned: what :attrs does with falsy
// non-false values, and where the attribute/property split of form elements
// shows through
// `:name="expr"` binds one attribute reactively - the single-key case
// :attrs="{ name: expr }" was carrying. Same value rule as :attrs, because two
// similar-but-different rules would be worse than either.
describe(":attr - the single-attribute form", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  it("binds one attribute and keeps it in sync", () => {
    const component = parseComponent(`<a :href="url">link</a>`)
    const data = $reactive({ url: "/first" })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("a")!

    expect(el.getAttribute("href")).toBe("/first")
    data.url = "/second"
    expect(el.getAttribute("href")).toBe("/second")
  })

  it("removes the attribute when a non-boolean value goes null", () => {
    const component = parseComponent(`<div :title="tip"></div>`)
    const data = $reactive({ tip: "hi" as any })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("div")!

    expect(el.getAttribute("title")).toBe("hi")
    data.tip = null
    expect(el.hasAttribute("title")).toBe(false)
    data.tip = ""
    expect(el.getAttribute("title")).toBe("")
  })

  it("removes a boolean attribute for any falsy value and sets it to \"\"", () => {
    const component = parseComponent(`<button :disabled="busy">x</button>`)
    const data = $reactive({ busy: 0 as any })

    container.appendChild(renderComponent(component, data))
    const button = container.querySelector("button")!

    expect(button.disabled).toBe(false)
    data.busy = true
    expect(button.getAttribute("disabled")).toBe("")
    expect(button.disabled).toBe(true)
    data.busy = false
    expect(button.disabled).toBe(false)
  })

  it("writes false for an attribute that is not a boolean one", () => {
    const component = parseComponent(`<div :aria-expanded="open" :data-flag="open"></div>`)
    const data = $reactive({ open: false })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("div")!

    expect(el.getAttribute("aria-expanded")).toBe("false")
    expect(el.getAttribute("data-flag")).toBe("false")
  })

  it(":name alone is shorthand for :name=\"name\", reading the camelCase variable", () => {
    // the attribute keeps its written (kebab) name; the expression can't -
    // `aria-expanded` as an expression is a subtraction
    const component = parseComponent(`<input :disabled /><div :aria-expanded></div>`)
    const data = $reactive({ disabled: true, ariaExpanded: true })

    container.appendChild(renderComponent(component, data))

    expect(container.querySelector("input")!.disabled).toBe(true)
    expect(container.querySelector("div")!.getAttribute("aria-expanded")).toBe("true")
  })

  it("leaves reserved directives alone", () => {
    const component = parseComponent(`<input :value="name" :class.on="flag" />`)
    const data = $reactive({ name: "Ada", flag: true })

    container.appendChild(renderComponent(component, data))
    const input = container.querySelector("input")!

    // :value is the property directive, not the value attribute
    expect(input.value).toBe("Ada")
    expect(input.hasAttribute("value")).toBe(false)
    expect(input.className).toBe("on")
  })

  it("leaves a tag that may still become a component written as-is", () => {
    // <drop-area> resolves DropArea, so its :foo is a parameter the upgrade
    // re-reads - not an attribute to bind now. <Later /> is the same claim
    // written the other way, and it sits in the DOM under the name the pre-parse
    // rewrite gave it: <c79-later>, which is nothing the parser can resolve
    const component = parseComponent(`<div><Later :foo="n" /><drop-area :foo="n"></drop-area></div>`)
    const data = $reactive({ n: 1 })

    container.appendChild(renderComponent(component, data))

    expect(container.querySelector("later")).toBeNull()
    expect(container.querySelector("c79-later")!.getAttribute(":foo")).toBe("n")
    expect(container.querySelector("drop-area")!.getAttribute(":foo")).toBe("n")
  })
})

describe("attribute binding edges", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  it(":attrs removes a boolean attribute for any falsy value, 0 and \"\" included", () => {
    // presence is the whole message for a boolean attribute, so the value is
    // never worth writing: `disabled: items.length` enables the button on an
    // empty list, which is what it reads like
    const component = parseComponent(`<button :attrs="{ disabled: n }">x</button>`)
    const data = $reactive({ n: 0 as any })

    container.appendChild(renderComponent(component, data))
    const button = container.querySelector("button")!

    expect(button.hasAttribute("disabled")).toBe(false)

    data.n = ""
    expect(button.disabled).toBe(false)

    data.n = false
    expect(button.disabled).toBe(false)

    data.n = 3
    expect(button.getAttribute("disabled")).toBe("")
    expect(button.disabled).toBe(true)
  })

  it(":attrs writes false and 0 for an attribute that is not a boolean one", () => {
    // absent and "false" are different things to a screen reader, so the rule
    // that removes a falsy boolean attribute must not reach aria-* or data-*
    const component = parseComponent(`<div :attrs="{ 'aria-expanded': open, 'data-count': n, title: t }"></div>`)
    const data = $reactive({ open: false, n: 0, t: null as any })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("div")!

    expect(el.getAttribute("aria-expanded")).toBe("false")
    expect(el.getAttribute("data-count")).toBe("0")
    expect(el.hasAttribute("title")).toBe(false)

    data.open = true
    expect(el.getAttribute("aria-expanded")).toBe("true")
  })

  it(":attrs value writes the attribute, which stops driving an input the user has typed in", () => {
    const component = parseComponent(`<input :attrs="{ value: name }">`)
    const data = $reactive({ name: "Ada" })

    container.appendChild(renderComponent(component, data))
    const input = container.querySelector("input") as HTMLInputElement

    // before any user interaction the attribute is also the visible value
    expect(input.value).toBe("Ada")

    // once the user types, value (the property) detaches from the attribute:
    // later store writes update the attribute but not what the user sees -
    // which is what :value (the property directive) exists for
    input.value = "typed by user"
    data.name = "Grace"

    expect(input.getAttribute("value")).toBe("Grace")
    expect(input.value).toBe("typed by user")
  })

  it(":value writes the property, so it keeps driving an input the user has typed in", () => {
    const component = parseComponent(`<input :value="name">`)
    const data = $reactive({ name: "Ada" })

    container.appendChild(renderComponent(component, data))
    const input = container.querySelector("input") as HTMLInputElement

    expect(input.value).toBe("Ada")

    input.value = "typed by user"
    data.name = "Grace"

    expect(input.value).toBe("Grace")
  })

  it(":value falls back to an empty string for null/undefined", () => {
    const component = parseComponent(`<input :value="missing">`)
    const data = $reactive({ missing: null as any })

    container.appendChild(renderComponent(component, data))
    const input = container.querySelector("input") as HTMLInputElement

    expect(input.value).toBe("")
  })

  it(":checked drives a checkbox's property reactively", () => {
    const component = parseComponent(`<input type="checkbox" :checked="agreed">`)
    const data = $reactive({ agreed: false })

    container.appendChild(renderComponent(component, data))
    const box = container.querySelector("input") as HTMLInputElement

    expect(box.checked).toBe(false)

    data.agreed = true
    expect(box.checked).toBe(true)

    // the user unticks it; the store is still the source of truth
    box.checked = false
    data.agreed = false
    data.agreed = true
    expect(box.checked).toBe(true)
  })

  it(":value on a <select> selects the matching option, from the first render on", () => {
    // the property effects run after the children render - a <select> can
    // only pick an <option> that already exists
    const component = parseComponent(
      `<select :value="lang"><option value="en">en</option><option value="es">es</option></select>`
    )
    const data = $reactive({ lang: "es" })

    container.appendChild(renderComponent(component, data))
    const select = container.querySelector("select") as HTMLSelectElement

    expect(select.value).toBe("es")

    data.lang = "en"
    expect(select.value).toBe("en")
  })

  it(":selected drives an option's property reactively", () => {
    const component = parseComponent(
      `<select><option value="en" :selected="lang === 'en'">en</option>` +
      `<option value="es" :selected="lang === 'es'">es</option></select>`
    )
    const data = $reactive({ lang: "es" })

    container.appendChild(renderComponent(component, data))
    const select = container.querySelector("select") as HTMLSelectElement

    expect(select.value).toBe("es")

    data.lang = "en"
    expect(select.value).toBe("en")
  })

  it(":class and a class key inside :attrs degrade predictably when combined", () => {
    // the documented "don't": :attrs rewrites the whole attribute on each of
    // its runs, wiping what :class added until :class happens to re-run
    const component = parseComponent(`<div :attrs="{ class: base }" :class="{ active: on }"></div>`)
    const data = $reactive({ base: "box", on: true })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("div")!

    expect(el.className).toBe("box active")

    data.base = "box2"
    expect(el.className).toBe("box2")

    data.on = false
    data.on = true
    expect(el.className).toBe("box2 active")
  })
})

// how :each identity behaves under the two ways of sorting a list - pinned
// because the difference (reassignment preserves rows, in-place doesn't) is
// invisible until an input loses its text
describe(":each and in-place array mutation", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  it("reassigning a sorted copy moves the existing rows", () => {
    const component = parseComponent(`<li :each="u in users" :key="u.id">{{ u.name }}</li>`)
    const data = $reactive({ users: [{ id: 1, name: "b" }, { id: 2, name: "a" }] })

    container.appendChild(renderComponent(component, data))
    const before = [...container.querySelectorAll("li")]

    data.users = [...data.users].sort((x: any, y: any) => x.name.localeCompare(y.name))
    const after = [...container.querySelectorAll("li")]

    expect(after.map(li => li.textContent)).toEqual(["a", "b"])
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[0])
  })

  it("sorting in place re-renders the rows: mid-swap writes duplicate the keys", () => {
    // each proxy write during sort() re-runs the list effect, and halfway
    // through a swap the array holds the same item twice - the duplicate-key
    // degradation kicks in (warns, pairs by position) and the settled result
    // is correct but rebuilt. Reassign a sorted copy to keep row state
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const component = parseComponent(`<li :each="u in users" :key="u.id">{{ u.name }}</li>`)
    const data = $reactive({ users: [{ id: 1, name: "b" }, { id: 2, name: "a" }] })

    container.appendChild(renderComponent(component, data))
    const before = [...container.querySelectorAll("li")]

    data.users.sort((x: any, y: any) => x.name.localeCompare(y.name))
    const after = [...container.querySelectorAll("li")]

    expect(after.map(li => li.textContent)).toEqual(["a", "b"])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("duplicate :key"))
    expect(after).not.toContain(before[0])
    warn.mockRestore()
  })
})

// :html.allowed - the per-element destination policy over :html's sanitizer.
// Value is an expression, like every : attribute: host patterns (string or
// array) or a predicate; anything broken denies every destination
describe(":html.allowed", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  const BODY = `<a href="https://a.germade.dev/x">ok</a><a href="https://evil.com/x">bad</a>`

  it("filters destinations with a host-pattern string", () => {
    const component = parseComponent(`<div :html="body" :html.allowed="'*.germade.dev'"></div>`)
    const data = $reactive({ body: BODY })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("div")!

    expect(el.querySelectorAll("a").length).toBe(2)
    expect(el.innerHTML).toContain(`href="https://a.germade.dev/x"`)
    expect(el.innerHTML).not.toContain("evil.com")
  })

  it("takes the policy from the store and re-applies it reactively", () => {
    const component = parseComponent(`<div :html="body" :html.allowed="policy"></div>`)
    const data = $reactive({ body: BODY, policy: ["*.germade.dev"] as any })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("div")!

    expect(el.innerHTML).not.toContain("evil.com")

    data.policy = ["*.germade.dev", "evil.com"]

    expect(el.innerHTML).toContain(`href="https://evil.com/x"`)
  })

  it("accepts a predicate, evaluated per URL", () => {
    const component = parseComponent(
      `<div :html="body" :html.allowed="url => url.hostname.endsWith('.germade.dev')"></div>`
    )
    const data = $reactive({ body: BODY })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("div")!

    expect(el.innerHTML).toContain("a.germade.dev")
    expect(el.innerHTML).not.toContain("evil.com")
  })

  it("a policy that evaluates to undefined denies every destination (fails closed)", () => {
    const component = parseComponent(`<div :html="body" :html.allowed="missing"></div>`)
    const data = $reactive({ body: BODY })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("div")!

    expect(el.querySelectorAll("a").length).toBe(2) // the content stays, destination-less
    expect(el.innerHTML).not.toContain("href=")
  })

  it("warns when :html.allowed sits on an element without :html", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const component = parseComponent(`<div :html.allowed="'*.germade.dev'">plain</div>`)

    container.appendChild(renderComponent(component, $reactive({})))

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(":html.allowed without :html"))
    warn.mockRestore()
  })
})

describe("nested component recursion", () => {
  it("a component's own tag inside its template renders one level and stops", () => {
    // no runaway recursion by construction: the child's scope holds only its
    // props, and prop names pass through the HTML parser lowercased - so the
    // PascalCase key a component tag needs can never arrive via an attribute.
    // The inner <A> finds no "A" in the child scope, and it no longer falls
    // back to a plain <a> anchor: a capitalized tag is a component claim, the
    // rewrite renamed it to <c79-a>, and a claim that resolves to nothing after
    // every script has settled throws (RECORD/2026-08-25.component-tag-prefix.md)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const A = parseComponent(`<div class="a"><A></A></div>`)
    const data = $reactive({ A })

    expect(() => container.appendChild(renderComponent(A, data))).toThrow(/<A> is not defined/)
    // and nothing of it reaches the page: the throw happens while the subtree is
    // still detached, so there is no half-rendered component to look at
    expect(container.querySelector("div.a")).toBeNull()
    expect(container.querySelector("a")).toBeNull()
  })
})

// findComponentKey skips a scope level it knows declares no PascalCase key, and
// an :each item scope is marked from the loop names. A capitalised loop name is
// exactly the case that marking must not swallow: it *is* a component tag
describe(":each with a component in the loop variable", () => {
  it("renders the component the loop variable holds", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const Red = parseComponent(`<b class="red">rojo</b>`)
    const Blue = parseComponent(`<i class="blue">azul</i>`)
    const component = parseComponent(`<div><Cell :each="Cell in cells" /></div>`)

    container.appendChild(renderComponent(component, $reactive({ cells: [Red, Blue] })))

    expect(container.querySelector(".red")).not.toBeNull()
    expect(container.querySelector(".blue")).not.toBeNull()
  })

  it("still resolves an outer component from inside a plain-named loop", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const Chip = parseComponent(`<span class="chip">{{ label }}</span>`)
    const component = parseComponent(`<div><p :each="item in items"><Chip :label="item" /></p></div>`)

    container.appendChild(renderComponent(component, $reactive({ items: ["a", "b"], Chip })))

    expect($$(container, ".chip").map(el => el.textContent)).toEqual(["a", "b"])
  })
})

// A nested <template> carrying a directive is two silent failures - the bare
// one shows nothing in either state, the :slot one has its directive dropped
// and renders anyway - and neither is a rendering bug to fix. Both are worth
// the console line every other it-does-nothing case gets
// RECORD/2026-08-24.template-directive-warning.md
describe("a directive on a nested <template>", () => {
  let container: HTMLDivElement
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    container.remove()
  })

  const messages = () => warn.mock.calls.map(call => String(call[0]))

  it("warns that the children never reach the page, in either state", () => {
    const data = $reactive({ show: true })
    container.appendChild(renderComponent(
      parseComponent(`<ul><template :if="show"><li class="in">uno</li></template></ul>`), data))

    expect(messages()).toContainEqual(expect.stringContaining(":if on a nested <template> shows nothing"))
    // the :if works exactly as written - it decides whether an inert
    // <template> is inserted, and its children live in .content either way
    expect(container.querySelector(".in"), "a <template>'s children are not in the document").toBeNull()

    ;(data as any).show = false
    expect(container.querySelector(".in")).toBeNull()
  })

  it("warns that a slot filler's directive is dropped, and it is", () => {
    const Panel = parseComponent(`<section class="panel"><slot.header /><slot /></section>`)
    container.appendChild(renderComponent(
      parseComponent(`<div><Panel><template :slot.header :if="show"><h2 class="title">cabecera</h2></template></Panel></div>`),
      $reactive({ Panel, show: false })))

    expect(messages()).toContainEqual(expect.stringContaining(":if on <template :slot.header> is ignored"))
    expect(container.querySelector(".title"), "the slot content renders whatever :if says").not.toBeNull()
  })

  // the third position, and neither message fits it: a <template :slot> that is
  // not a direct child of a component tag is MISPLACED, and there the directive
  // is not dropped at all - renderNodes groups the :if into a chain like any
  // other element's. Saying "the directive is ignored, a slot is filled" would
  // be wrong twice, and misplacedSlotContent already speaks for the position
  it("says nothing about a misplaced <template :slot>, whose directive does work", () => {
    const data = $reactive({ x: false }) as any
    container.appendChild(renderComponent(
      parseComponent(`<div><template :slot.header :if="x"><h2 class="t">c</h2></template></div>`), data))

    expect(messages(), "the :if was honoured, and no slot is filled here").toEqual([])
    expect(container.querySelector(".t")).toBeNull()

    // and when the branch does render, the warning that speaks is the one about
    // the position - not this one
    data.x = true
    expect(messages()).toContainEqual(expect.stringContaining("fills a slot only as a direct child"))
    expect(messages()).not.toContainEqual(expect.stringContaining("is ignored - a slot is filled"))
  })

  it("warns for :each too, which is the same misconception", () => {
    container.appendChild(renderComponent(
      parseComponent(`<ul><template :each="n in ns"><li>{{ n }}</li></template></ul>`), $reactive({ ns: [1, 2] })))

    expect(messages()).toContainEqual(expect.stringContaining(":each on a nested <template> shows nothing"))
  })

  it("says nothing about a bare nested <template>, which is the legitimate use", () => {
    container.appendChild(renderComponent(
      parseComponent(`<div><template class="tpl"><b>x</b></template></div>`), $reactive({})))

    expect(messages()).toEqual([])
    expect(container.querySelector("template")).not.toBeNull()
  })

  it("says nothing about a <template> inside an svg, whose children do render", () => {
    // in the SVG namespace `template` is a plain element with ordinary
    // children, not the inert HTML one - so they reach the page and the
    // message about `.content` would be false
    const data = $reactive({ on: true }) as any
    container.appendChild(renderComponent(
      parseComponent(`<div><svg><template :if="on"><circle r="1" class="inside" /></template></svg></div>`), data))

    expect(container.querySelector(".inside"), "an svg <template> renders its children").not.toBeNull()
    expect(messages()).toEqual([])

    data.on = false
    expect(container.querySelector(".inside")).toBeNull()
  })

  it("says nothing about a top-level <template> declaration", () => {
    // a declaration is lifted out before the walk ever runs, so its position
    // needs no exclusion - this is the test that says so
    const component = new Component79(`<template name="Row"><li class="row">fila</li></template><ul><Row /></ul>`)
    component.mount(container)

    expect(messages()).toEqual([])
    expect(container.querySelector(".row")).not.toBeNull()
  })
})

// The chain grammar is :if, then :elseif, then :else, on adjacent siblings.
// Both ways of breaking it render something, so both have to say so - the
// orphan especially, which renders the branch unconditionally and used to do it
// in complete silence
describe(":if/:elseif/:else chain validation", () => {
  let container: HTMLDivElement
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => warn.mockRestore())

  const messages = () => warn.mock.calls.map(call => String(call[0]))

  it("warns about an :else that continues no :if, and renders it unconditionally", () => {
    const component = parseComponent(`<div><p :else class="c">huerfano</p></div>`)

    container.appendChild(renderComponent(component, $reactive({})))

    expect(container.querySelector(".c")).not.toBeNull()
    expect(messages()).toContainEqual(expect.stringContaining(":else on <p> continues no :if"))
  })

  it("warns when an element between the branches breaks the chain", () => {
    const component = parseComponent(
      `<div><p :if="a">A</p><span>corta</span><p :elseif="b">B</p></div>`
    )

    // b is false: a chain would hide it. It renders anyway, which is the point
    container.appendChild(renderComponent(component, $reactive({ a: false, b: false })))

    expect(container.textContent).toContain("B")
    expect(messages()).toContainEqual(expect.stringContaining(":elseif on <p> continues no :if"))
  })

  it("warns when a :each element separates a branch from its :if", () => {
    const component = parseComponent(
      `<div><p :if="a">A</p><span :each="n in nums">{{ n }}</span><p :else>B</p></div>`
    )

    container.appendChild(renderComponent(component, $reactive({ a: true, nums: [1] })))

    // both branches in the DOM at once - a chain can never do that
    expect(container.textContent).toContain("A")
    expect(container.textContent).toContain("B")
    expect(messages()).toContainEqual(expect.stringContaining(":else on <p> continues no :if"))
  })

  it("warns about two branch directives on one element, and applies the first", () => {
    const component = parseComponent(`<div><p :if="a" :else class="c">A</p></div>`)

    container.appendChild(renderComponent(component, $reactive({ a: false })))

    expect(container.querySelector(".c")).toBeNull()
    expect(messages()).toContainEqual(expect.stringContaining(":if and :else on the same <p>"))
  })

  it("tells a second :else from a stray one", () => {
    const component = parseComponent(`
      <div>
        <p :if="a">A</p>
        <p :else>B</p>
        <p :else class="c">C</p>
      </div>
    `)

    container.appendChild(renderComponent(component, $reactive({ a: true })))

    // it renders next to the branch that won, which is what gives it away
    expect(container.querySelector(".c")).not.toBeNull()
    expect(messages()).toContainEqual(expect.stringContaining("a second :else on <p>"))
    expect(messages()).not.toContainEqual(expect.stringContaining("continues no :if"))
  })

  it("warns about two directives on an element the chain itself claimed", () => {
    const component = parseComponent(
      `<div><p :if="a">A</p><p :elseif="b" :else class="c">B</p></div>`
    )

    container.appendChild(renderComponent(component, $reactive({ a: false, b: false })))

    // claimed as the :elseif branch, so the dropped :else does not make it a
    // fallback: nothing renders, which is what the warning is about
    expect(container.querySelector(".c")).toBeNull()
    expect(messages()).toContainEqual(expect.stringContaining(":elseif and :else on the same <p>"))
  })

  it("reports at parse time, before anything renders", () => {
    parseComponent(`<div><p :else>huerfano</p></div>`)

    expect(messages()).toContainEqual(expect.stringContaining(":else on <p> continues no :if"))
  })

  it("reports a stray branch inside a branch that never becomes active", () => {
    const component = parseComponent(
      `<div><p :if="a">A</p><p :else>B<span :else>dentro</span></p></div>`
    )

    // a is true, so the :else branch is never rendered at all - and the stray
    // :else inside it is reported anyway, which is what parse time buys
    container.appendChild(renderComponent(component, $reactive({ a: true })))

    expect(container.textContent).not.toContain("dentro")
    expect(messages()).toContainEqual(expect.stringContaining(":else on <span> continues no :if"))
  })

  it("says nothing about a well-formed chain, across lines and with :elseif repeated", () => {
    const component = parseComponent(`
      <div>
        <p :if="score > 8">great</p>
        <p :elseif="score > 4">ok</p>
        <p :elseif="score > 2">meh</p>
        <p :else>bad</p>
      </div>
    `)

    container.appendChild(renderComponent(component, $reactive({ score: 6 })))

    expect(container.textContent).toContain("ok")
    expect(messages()).toEqual([])
  })

  it("reports a template's stray branch once, not once per :each row or per pass", () => {
    const component = parseComponent(
      `<ul><li :each="n in nums" :key="n"><b :if="n > 1">si</b><i :else>no</i><s :else>orphan</s></li></ul>`
    )
    const data = $reactive({ nums: [1, 2, 3] })

    container.appendChild(renderComponent(component, data))
    data.nums = [1, 2, 3, 4]

    const orphans = messages().filter(message => message.includes(":else on <s>"))
    expect(orphans).toHaveLength(1)
  })
})

// <svg> used to render as an HTMLUnknownElement in the XHTML namespace: no
// drawing, `viewBox` flattened to `viewbox` by setAttribute, every `:` binding
// left in the DOM verbatim (an unknown element is a component that might still
// arrive, so renderNode keeps its `:` attributes as parameters), and any
// camelCase tag lowercased. The namespace now rides on the AST node, read off
// the tree DOMParser already built - RECORD/2026-08-24.svg-namespace.md
describe("svg", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })
  afterEach(() => container.remove())

  const render = (template: string, data: Record<string, any> = {}) => {
    const store = $reactive(data)
    container.appendChild(renderComponent(parseComponent(template), store))
    return store as any
  }

  it("builds svg elements in the svg namespace", () => {
    render(`<div><svg><circle r="4" /></svg></div>`)
    const svg = container.querySelector("svg")!

    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg")
    expect(svg).toBeInstanceOf(SVGElement)
    expect(container.querySelector("circle")!.namespaceURI).toBe("http://www.w3.org/2000/svg")
  })

  it("keeps the case of a case-sensitive attribute", () => {
    render(`<div><svg viewBox="0 0 10 10" preserveAspectRatio="xMidYMid"><circle r="1" /></svg></div>`)
    const svg = container.querySelector("svg")!

    expect(svg.getAttributeNames()).toContain("viewBox")
    expect(svg.getAttribute("viewBox")).toBe("0 0 10 10")
    expect(svg.getAttributeNames()).toContain("preserveAspectRatio")
  })

  it("keeps the case of a case-sensitive tag", () => {
    render(`<div><svg><defs><linearGradient id="g"><stop offset="0" /></linearGradient><clipPath id="c"><circle r="1" /></clipPath></defs></svg></div>`)

    expect(container.querySelector("linearGradient")?.tagName).toBe("linearGradient")
    expect(container.querySelector("clipPath")?.tagName).toBe("clipPath")
  })

  // the one that made every other binding inside an <svg> inert
  it("binds attributes inside an svg, reactively", () => {
    const data = render(`<div><svg><circle r="4" :fill="color" :class.on="flag" /></svg></div>`, { color: "red", flag: false })
    const circle = container.querySelector("circle")!

    expect(circle.getAttribute("fill")).toBe("red")
    expect(circle.getAttribute(":fill")).toBeNull()
    expect(circle.classList.contains("on")).toBe(false)

    data.color = "blue"
    data.flag = true
    expect(circle.getAttribute("fill")).toBe("blue")
    expect(circle.classList.contains("on")).toBe(true)
  })

  it("interpolates and repeats inside an svg", () => {
    const data = render(`<div><svg><text>{{ label }}</text><circle :each="c in circles" :key="c.id" :r="c.r" /></svg></div>`,
      { label: "hola", circles: [{ id: 1, r: 1 }, { id: 2, r: 2 }] })

    expect(container.querySelector("text")!.textContent).toBe("hola")
    expect(container.querySelectorAll("circle")).toHaveLength(2)

    data.circles = [{ id: 2, r: 2 }]
    expect(container.querySelectorAll("circle")).toHaveLength(1)
    expect(container.querySelector("circle")!.namespaceURI).toBe("http://www.w3.org/2000/svg")
  })

  // the parser's foreign-content algorithm, which is the reason the namespace
  // is read off the tree rather than guessed from a list of tag names
  it("hands the namespace back inside a foreignObject", () => {
    render(`<div><svg><foreignObject><p>de vuelta</p></foreignObject></svg></div>`)

    expect(container.querySelector("foreignObject")!.namespaceURI).toBe("http://www.w3.org/2000/svg")
    expect(container.querySelector("p")!.namespaceURI).toBe("http://www.w3.org/1999/xhtml")
    expect(container.querySelector("p")).toBeInstanceOf(HTMLElement)
  })

  // The other half of the same rule, and it moved: a PascalCase key in scope
  // used to capture the foreign tag of that name (`Circle` took `<circle>`, the
  // trade `Td` had with `<td>`), so every SVG tag somebody might name a
  // component after - Text, Path, Filter, Marker, Circle - was reachable that
  // way. A lowercase tag resolves to no component now, whatever is in scope:
  // RECORD/2026-08-25.component-tag-prefix.md
  it("is not captured by a scope key of the same name", () => {
    render(`<div><svg><circle r="4" /></svg></div>`, { Circle: parseComponent(`<b class="taken">tomado</b>`) })

    expect(container.querySelector(".taken")).toBeNull()
    expect(container.querySelector("circle")!.namespaceURI).toBe("http://www.w3.org/2000/svg")
  })

  // and the capitalized spelling is what reaches the component, in an <svg>
  // like anywhere else - the tag the parser saw was <c79-circle>, which is not
  // an SVG name, so nothing of the element it was named after survives
  it("renders a component written capitalized, inside an svg", () => {
    render(`<div><svg><Circle r="4" /></svg></div>`, { Circle: parseComponent(`<b class="taken">tomado</b>`) })

    expect(container.querySelector(".taken")).not.toBeNull()
    expect(container.querySelector("circle")).toBeNull()
  })

  it("does not treat an svg tag as a component that has not arrived", () => {
    const data = render(`<div><svg><circle r="1" /></svg></div>`)
    // the upgrade watch swaps an unknown tag when a matching key appears. An
    // <svg> is a real element and must sit still
    data.Svg = parseComponent(`<b class="wrong">tomado</b>`)
    data.Circle = parseComponent(`<b class="wrong">tomado</b>`)

    expect(container.querySelector(".wrong")).toBeNull()
    expect(container.querySelector("svg")).not.toBeNull()
  })

  // A bound camelCase attribute used to be rewritten to kebab and lost: the
  // rewrite turns `:viewBox` into `:view-box` before the parse, and SVG has no
  // such attribute. The name is resolved against the parser's own adjust table
  // now - the one that makes a written-out viewBox survive
  // RECORD/2026-08-25.svg-attribute-names.md
  //
  // Hardcoded rather than asked, so these pin a semantics instead of agreeing
  // with the implementation. The last three are the ones that killed the IDL
  // trick this replaces (RECORD/2026-08-24.svg-namespace.md)
  const CAMEL_ATTRS: [tag: string, attribute: string][] = [
    ["svg", "viewBox"],
    ["svg", "preserveAspectRatio"],
    ["linearGradient", "gradientUnits"],
    ["marker", "markerWidth"],
    ["marker", "refX"],
    ["textPath", "startOffset"],
    ["path", "pathLength"],
    ["feTurbulence", "baseFrequency"],
    ["feGaussianBlur", "stdDeviation"],
    ["animate", "attributeName"],
    ["animate", "repeatCount"],
  ]

  // camelCase and kebab converge before any of this runs, so both spellings
  // have to arrive at the same attribute - which is the rule the docs promise
  const kebab = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)

  // <svg> is its own wrapper; everything else needs one to be in the namespace
  const inSvg = (tag: string, attrs: string) =>
    tag === "svg" ? `<div><svg ${attrs}></svg></div>` : `<div><svg><${tag} ${attrs} /></svg></div>`

  CAMEL_ATTRS.forEach(([tag, attribute]) => {
    it(`binds :${attribute} on <${tag}> as ${attribute}`, () => {
      const data = render(inSvg(tag, `:${attribute}="v"`), { v: "2" })
      const el = container.querySelector(tag)!

      expect(el.getAttributeNames()).toContain(attribute)
      expect(el.getAttribute(attribute)).toBe("2")
      expect(el.getAttributeNames(), "the kebab spelling reached the DOM").not.toContain(kebab(attribute))

      data.v = "3"
      expect(el.getAttribute(attribute), "the resolved name is not reactive").toBe("3")
    })

    it(`binds :${kebab(attribute)} on <${tag}> as ${attribute} too`, () => {
      render(inSvg(tag, `:${kebab(attribute)}="v"`), { v: "2" })

      expect(container.querySelector(tag)!.getAttributeNames()).toContain(attribute)
    })
  })

  // The collision test, and the one to re-run if the name rewrite is ever
  // touched. The resolution has to be a pure function of the kebab name,
  // because both spellings converge before it runs - so a real kebab attribute
  // whose de-dashed form the table claims would start being rewritten. Every
  // presentation attribute, plus data-* and aria-*: none of them collides
  // shared with scripts/check-svg-attribute-names.mjs, which asks the same
  // names of chromium, firefox and webkit - one corpus, two questions
  it("leaves every dashed svg attribute exactly as written", () => {
    const written = DASHED_NAMES.map(name => {
      render(`<div><svg><circle :${name}="v" /></svg></div>`, { v: "x" })
      const circle = container.querySelector("circle")!
      const found = circle.getAttributeNames().find(candidate => candidate.toLowerCase().replace(/-/g, "") === name.replace(/-/g, ""))
      circle.closest("svg")!.remove()
      return `${name} -> ${found}`
    })

    expect(written.filter(pair => pair.split(" -> ")[0] !== pair.split(" -> ")[1]), "a dashed name collided with the parser's table").toEqual([])
  })

  // the all-lowercase spelling: the parser adjusts `viewbox` written out, so a
  // bound one has to reach the same attribute. It used to skip the lookup for
  // want of a dash and write a dead `viewbox`
  it("resolves a name written all in lowercase", () => {
    render(`<div><svg :viewbox="box"></svg></div>`, { box: "0 0 10 10" })

    expect(container.querySelector("svg")!.getAttributeNames()).toContain("viewBox")
    expect(container.querySelector("svg")!.getAttributeNames()).not.toContain("viewbox")
  })

  it("leaves every undashed svg attribute exactly as written", () => {
    const written = UNDASHED_NAMES.map(name => {
      render(`<div><svg><circle :${name}="v" /></svg></div>`, { v: "x" })
      const circle = container.querySelector("circle")!
      const found = circle.getAttributeNames().find(candidate => candidate.toLowerCase() === name)
      circle.closest("svg")!.remove()
      return `${name} -> ${found}`
    })

    expect(written.filter(pair => pair.split(" -> ")[0] !== pair.split(" -> ")[1]),
      "an undashed name was claimed by the parser's table").toEqual([])
  })

  it("leaves html elements alone, camelCase and all", () => {
    render(`<div><p :viewBox="v" :dataFoo="w"></p></div>`, { v: "x", w: "y" })
    const p = container.querySelector("p")!

    // nothing here consults the table: it is the parser's foreign-content
    // table, and an HTML element is not foreign
    expect(p.getAttributeNames()).toContain("view-box")
    expect(p.getAttributeNames()).toContain("data-foo")
  })

  it("stamps svg elements for a scoped style", () => {
    // <style scoped> requires the stamp on every element the component
    // rendered, and a foreign element has to be reachable by its rules too
    new Component79(`<style scoped>circle { fill: red }</style><div><svg><circle r="4" /></svg></div>`).mount(container)
    const circle = container.querySelector("circle")!

    const stamp = circle.getAttributeNames().find(name => name.startsWith("data-jq79"))
    expect(stamp, "an svg element carries no scope stamp, so scoped rules cannot reach it").toBeDefined()
    expect(circle.getAttribute(stamp!)).toBe(container.querySelector("div")!.getAttribute(stamp!))
  })
})

// MathML rides on the same AST field <svg> does - elementToAST records any
// non-HTML namespace, not SVG's - so most of this was true and untested. What
// was NOT true is <annotation-xml>: the one tag in either foreign namespace
// with a hyphen in it, and a hyphen is how this library recognizes a custom
// element - RECORD/2026-08-24.mathml.md
const MATHML_NS = "http://www.w3.org/1998/Math/MathML"

describe("mathml", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })
  afterEach(() => container.remove())

  const render = (template: string, data: Record<string, any> = {}) => {
    const store = $reactive(data)
    container.appendChild(renderComponent(parseComponent(template), store))
    return store as any
  }

  it("builds mathml elements in the mathml namespace", () => {
    render(`<div><math display="block"><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math></div>`)
    const math = container.querySelector("math")!

    expect(math.namespaceURI).toBe(MATHML_NS)
    // jsdom has no MathMLElement, so the claim that carries here is the one the
    // bugs came from: it is not the unknown HTML element createElement builds
    expect(math).not.toBeInstanceOf(HTMLUnknownElement)
    expect(math.getAttribute("display")).toBe("block")
    expect(container.querySelector("mi")!.namespaceURI).toBe(MATHML_NS)
  })

  it("binds attributes inside a math, reactively", () => {
    const data = render(`<div><math><mrow><mi :mathcolor="color" :class.on="flag">x</mi></mrow></math></div>`, { color: "red", flag: false })
    const mi = container.querySelector("mi")!

    expect(mi.getAttribute("mathcolor")).toBe("red")
    expect(mi.getAttribute(":mathcolor")).toBeNull()
    expect(mi.classList.contains("on")).toBe(false)

    data.color = "blue"
    data.flag = true
    expect(mi.getAttribute("mathcolor")).toBe("blue")
    expect(mi.classList.contains("on")).toBe(true)
  })

  it("interpolates and repeats inside a math", () => {
    const data = render(`<div><math><mrow><mtext>{{ label }}</mtext><mi :each="s in syms" :key="s.id">{{ s.t }}</mi></mrow></math></div>`,
      { label: "suma", syms: [{ id: 1, t: "x" }, { id: 2, t: "y" }] })

    expect(container.querySelector("mtext")!.textContent).toBe("suma")
    expect(container.querySelectorAll("mi")).toHaveLength(2)

    data.syms = [{ id: 2, t: "y2" }]
    expect(container.querySelectorAll("mi")).toHaveLength(1)
    expect(container.querySelector("mi")!.textContent).toBe("y2")
    expect(container.querySelector("mi")!.namespaceURI).toBe(MATHML_NS)
  })

  // MathML's integration points, which are <foreignObject>'s counterparts and
  // the reason the namespace is read off the parsed tree rather than guessed
  it("hands the namespace back at an integration point", () => {
    render(`<div><math><mtext><b>negrita</b></mtext><annotation-xml encoding="text/html"><p>de vuelta</p></annotation-xml></math></div>`)

    expect(container.querySelector("mtext")!.namespaceURI).toBe(MATHML_NS)
    expect(container.querySelector("annotation-xml")!.namespaceURI).toBe(MATHML_NS)
    expect(container.querySelector("b")!.namespaceURI).toBe("http://www.w3.org/1999/xhtml")
    expect(container.querySelector("p")).toBeInstanceOf(HTMLElement)
  })

  // the one the <svg> corpus could not have caught: a hyphen used to make this
  // a custom element that might still become a component, so its bindings were
  // held verbatim as parameters for a component that can never arrive
  it("binds attributes on annotation-xml, hyphen and all", () => {
    const data = render(`<div><math><annotation-xml encoding="text/html" :id="which"><p>x</p></annotation-xml></math></div>`, { which: "uno" })
    const annotation = container.querySelector("annotation-xml")!

    expect(annotation.getAttribute("id")).toBe("uno")
    expect(annotation.getAttributeNames(), "the binding was left verbatim, as a parameter for a component").not.toContain(":id")

    data.which = "dos"
    expect(annotation.getAttribute("id")).toBe("dos")
  })

  it("warns for :model on a mathml element", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      render(`<div><math><annotation-xml :model="who"><mi>x</mi></annotation-xml></math></div>`, { who: "ada" })
      // the warning is suppressed on a tag that may upgrade, because the
      // upgrade re-renders through renderNestedComponent, models and all
      expect(warn.mock.calls.map(call => String(call[0])))
        .toContainEqual(expect.stringContaining(":model on <annotation-xml> does nothing"))
    } finally {
      warn.mockRestore()
    }
  })

  it("does not treat a mathml tag as a component that has not arrived", () => {
    const data = render(`<div><math><mrow><mi>x</mi></mrow><annotation-xml encoding="text/html"><p>y</p></annotation-xml></math></div>`)
    // the upgrade watch swaps an unknown tag when a matching key appears.
    // Every one of these is a real element and must sit still - AnnotationXml
    // is the one that did not
    data.Math = parseComponent(`<b class="wrong">tomado</b>`)
    data.Mi = parseComponent(`<b class="wrong">tomado</b>`)
    data.AnnotationXml = parseComponent(`<b class="wrong">tomado</b>`)

    expect(container.querySelector(".wrong")).toBeNull()
    expect(container.querySelector("annotation-xml")).not.toBeNull()
    expect(container.querySelector("math")).not.toBeNull()
  })

  // the same table, asked in MathML's namespace - one entry, and it is free
  it("binds :definitionUrl as definitionURL", () => {
    const data = render(`<div><math><mi :definitionUrl="url">x</mi></math></div>`, { url: "/a" })
    const mi = container.querySelector("mi")!

    expect(mi.getAttributeNames()).toContain("definitionURL")
    expect(mi.getAttributeNames()).not.toContain("definition-url")

    data.url = "/b"
    expect(mi.getAttribute("definitionURL")).toBe("/b")
  })

  it("leaves a lowercase mathml attribute as written", () => {
    render(`<div><math><mi :mathcolor="c" :math-color="c2">x</mi></math></div>`, { c: "red", c2: "blue" })

    expect(container.querySelector("mi")!.getAttributeNames()).toContain("mathcolor")
  })

  it("stamps mathml elements for a scoped style", () => {
    new Component79(`<style scoped>mi { color: red }</style><div><math><mrow><mi>x</mi></mrow></math></div>`).mount(container)
    const mi = container.querySelector("mi")!

    const stamp = mi.getAttributeNames().find(name => name.startsWith("data-jq79"))
    expect(stamp, "a mathml element carries no scope stamp, so scoped rules cannot reach it").toBeDefined()
    expect(mi.getAttribute(stamp!)).toBe(container.querySelector("div")!.getAttribute(stamp!))
  })

  // not a jq79 rule - the HTML parser's. <annotation-xml> is an integration
  // point only when its encoding is text/html or application/xhtml+xml, and a
  // bound :encoding means the parser never sees a value it recognizes, so <p>
  // hits the foreign-content breakout list and lands OUTSIDE the <math>. The
  // author wrote nesting that silently is not there, which is the same shape as
  // the :viewBox limitation and documented beside it
  it("parses html out of an annotation-xml whose encoding is bound", () => {
    render(`<div><math><annotation-xml :encoding="e"><p>x</p></annotation-xml></math></div>`, { e: "text/html" })

    expect(container.querySelector("math")!.querySelector("p"), "the <p> is a sibling of the <math>, not a child").toBeNull()
    expect(container.querySelector("p")!.namespaceURI).toBe("http://www.w3.org/1999/xhtml")
  })
})

// The pre-parse rename: <Circle /> reaches the HTML parser as <c79-circle>, so
// no component tag is ever the native element it was named after.
// RECORD/2026-08-25.component-tag-prefix.md
describe("the component tag rename", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })
  afterEach(() => container.remove())

  const render = (template: string, data: Record<string, any> = {}) => {
    const store = $reactive(data)
    container.appendChild(renderComponent(parseComponent(template), store))
    return store as any
  }

  it("renames every capitalized tag, not only the ones that collide", () => {
    const [circle, card] = parseComponent(`<div><Circle /><UserCard /></div>`).template[0].children as any[]

    expect(circle.tag).toBe("c79-circle")
    expect(circle.component).toBe("Circle")
    expect(card.tag).toBe("c79-user-card")
    expect(card.component).toBe("UserCard")
  })

  it("builds an HTMLElement for the renamed tag, not an HTMLUnknownElement", () => {
    // the hyphen is why: `c79-circle` is a valid custom element name and
    // `c79circle` would not be. The placeholder is what an unresolved component
    // leaves in the page, and it names itself there
    render(`<div><Circle /></div>`)
    const el = container.querySelector("c79-circle")!

    expect(el).not.toBeInstanceOf(HTMLUnknownElement)
    expect(el).toBeInstanceOf(HTMLElement)
  })

  it("closes the renamed tag too, so the siblings after it stay siblings", () => {
    // OPEN_TAG_RE matches open tags only. Rename one end and not the other and
    // </user-card> closes nothing, leaving everything that follows nested
    // inside the component tag instead of beside it
    render(`<div><UserCard>dentro</UserCard><b class="after">fuera</b></div>`, {
      UserCard: parseComponent(`<span class="card"><slot /></span>`),
    })

    expect(container.querySelector(".card")!.textContent).toBe("dentro")
    expect(container.querySelector(".card .after"), "the <b> is a sibling of the component, not its content").toBeNull()
    expect(container.querySelector("div > .after")).not.toBeNull()
  })

  it("resolves a component by the name the author wrote, dashes and case aside", () => {
    render(`<div><UserCard /><user-card /><USER-CARD /></div>`, {
      UserCard: parseComponent(`<span class="card">tarjeta</span>`),
    })

    expect(container.querySelectorAll(".card")).toHaveLength(3)
  })

  it("never resolves an undashed lowercase tag, whatever is in scope", () => {
    // withdrawn with the rename: <mychip> used to become MyChip, both when the
    // key was there and when it arrived later
    const data = render(`<div><mychip></mychip><label></label></div>`, {
      MyChip: parseComponent(`<b class="chip">tomado</b>`),
      Label: parseComponent(`<b class="chip">tomado</b>`),
    })
    data.MyChip = parseComponent(`<b class="chip">llegué</b>`)

    expect(container.querySelector(".chip")).toBeNull()
    expect(container.querySelector("mychip")).not.toBeNull()
    expect(container.querySelector("label")).not.toBeNull()
  })

  it("names the component the author wrote in its messages, not the renamed tag", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      render(`<div><Field :model.name="who" :name="x" /></div>`, {
        who: "ada", x: "y",
        Field: parseComponent(`<script :setup>let name = ""</script><b class="f">{{ name }}</b>`),
      })

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("<Field>"))
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("c79-field"))
    } finally {
      warn.mockRestore()
    }
  })

  // the cost, pinned rather than left to be rediscovered: a component tag is no
  // longer a `tr` to the parser, so table foster-parenting evicts it from the
  // table it was written in. The row component is a `:each` on the <tr> itself
  it("cannot sit in table-row position any more", () => {
    render(`<table><tbody><Row /></tbody></table>`, {
      Row: parseComponent(`<b class="row">fila</b>`),
    })

    expect(container.querySelector(".row"), "the component still renders").not.toBeNull()
    expect(container.querySelector("table .row"), "but outside the table the author wrote it in").toBeNull()
  })
})

// Step 2 of the tag rename: a component instance renders in an element of its
// own - <c79-name> - instead of a bare pair of comment anchors, and a
// stylesheet can name the component to reach that box.
// RECORD/2026-08-25.the-wrapper-and-the-css-rename.md
describe("the component box", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })
  afterEach(() => container.remove())

  const mount = (src: string) => new Component79(src).render().mount(container)

  it("wraps every instance, whatever it renders - one root, several, or none", () => {
    // "sometimes" is not an alternative: the same component renders one root or
    // two according to its data, so a box that appears only in the multi-root
    // case would make the parent's CSS depend on what the child rendered this
    // pass. And the empty case has nothing to hang a box off but a box
    mount(`
      <div class="w"><One /><Many /><None /></div>
      <template name="One"><p class="a">uno</p></template>
      <template name="Many"><h2>t</h2><p>c</p></template>
      <template name="None"><p :if="false">no</p></template>
    `)

    expect(container.querySelector("c79-one > .a")).not.toBeNull()
    expect(container.querySelectorAll("c79-many > *")).toHaveLength(2)
    const none = container.querySelector("c79-none")!
    expect(none, "a component that renders nothing is still a box").not.toBeNull()
    expect(none.querySelector("*")).toBeNull()
  })

  it("names the box after the component, not after the usage site", () => {
    mount(`
      <div class="w"><UserCard /><user-card /></div>
      <template name="UserCard"><b class="card">tarjeta</b></template>
    `)

    expect(container.querySelectorAll("c79-user-card")).toHaveLength(2)
    expect(container.querySelectorAll(".card")).toHaveLength(2)
  })

  it("stamps the box with the parent's scope, and the child's root with neither", () => {
    const jq79 = mount(`
      <div class="p"><Chip /></div>
      <style scoped>.p { color: red }</style>
      <template name="Chip"><b class="c">x</b></template>
    `)
    const scope = container.querySelector(".p")!.getAttribute("data-jq79")

    expect(scope).not.toBeNull()
    expect(container.querySelector("c79-chip")!.getAttribute("data-jq79")).toBe(scope)
    expect(container.querySelector(".c")!.getAttribute("data-jq79"), "the parent gets the box, never what is inside it").toBeNull()

    jq79.destroy()
  })

  it("rewrites a component's name in a selector to the tag its box has", () => {
    const jq79 = new Component79(`
      <div class="p"><Chip /></div>
      <style scoped>Chip { color: red } .p > Chip { color: blue }</style>
      <template name="Chip"><b class="c">x</b></template>
    `)
    jq79.render().mount(container)
    const scope = container.querySelector(".p")!.getAttribute("data-jq79")
    const css = jq79.styles[0].scoped!

    expect(css).toContain(`c79-chip[data-jq79="${scope}"]`)
    expect(css).toContain(`.p > c79-chip[data-jq79="${scope}"]`)
    expect(css).not.toContain("Chip")

    jq79.destroy()
  })

  it("renames in an unscoped style too, and inside a media query", () => {
    const jq79 = new Component79(`
      <div><Chip /></div>
      <style>Chip { color: red } @media (min-width: 1px) { Chip { color: blue } }</style>
      <template name="Chip"><b class="c">x</b></template>
    `)

    expect(jq79.styles[0].content).toContain("c79-chip { color: red }")
    expect(jq79.styles[0].content).toContain("@media (min-width: 1px) { c79-chip { color: blue } }")
  })

  it("renames only in selector position - not declarations, at-rule preludes, strings or classes", () => {
    const jq79 = new Component79(`
      <div><Chip /></div>
      <style>
        @import url(Chip.css);
        .Chip, #Chip { font-family: Georgia; content: "Chip" }
        DIV { color: red }
        p[title="Chip"] { color: blue }
        p[title="a > Chip"] /* keep Chip */ { color: teal }
      </style>
      <template name="Chip"><b class="c">x</b></template>
    `)
    const css = jq79.styles[0].content

    expect(css).toContain("@import url(Chip.css);")
    expect(css).toContain(".Chip, #Chip")
    expect(css).toContain("font-family: Georgia")
    expect(css).toContain(`content: "Chip"`)
    expect(css).toContain(`p[title="Chip"]`)
    // a string or a comment inside a selector is verbatim, not renamable text
    expect(css).toContain(`p[title="a > Chip"] /* keep Chip */`)
    // shouty type selectors are established CSS and match case-insensitively;
    // only a name with a lowercase letter in it is read as a component
    expect(css).toContain("DIV { color: red }")
    expect(css).not.toContain("c79-")
  })

  it("gives the box display:contents through a rule any author rule outranks", () => {
    mount(`<div><Chip /></div><template name="Chip"><b class="c">x</b></template>`)
    const rules = [...document.head.querySelectorAll("style")].map(el => el.textContent)
    const wrapper = rules.filter(css => css?.includes("display: contents"))

    expect(wrapper).toHaveLength(1)
    // :where() has no specificity, so `c79-chip { display: flex }` wins without
    // !important and without depending on stylesheet order
    expect(wrapper[0]).toBe(":where([data-c79-box]) { display: contents }")
  })

  it("renders no box inside an svg, where an unknown element would take its children with it", () => {
    mount(`
      <div><svg class="s"><Dot /></svg></div>
      <template name="Dot"><circle r="4" /></template>
    `)

    expect(container.querySelector("svg circle"), "the component still renders").not.toBeNull()
    expect(container.querySelector("c79-dot")).toBeNull()
  })

  it("moves component rows as one node when :each reorders them", () => {
    // the box is a stable single-node range, where the anchors were a pair with
    // dynamic content between them - boundsOf resolves an element as itself
    const jq79 = new Component79(`
      <ul><Row :each="row in rows" :key="row.id" :label="row.label" /></ul>
      <template name="Row"><script :setup="{ label }"></script><li class="r">{{ label }}</li></template>
    `).render({ rows: [{ id: 1, label: "a" }, { id: 2, label: "b" }] }).mount(container)

    const [first] = [...container.querySelectorAll("c79-row")]
    const rows = jq79.data!.rows
    jq79.data!.rows = [rows[1], rows[0]] // the same items, reordered

    const boxes = [...container.querySelectorAll("c79-row")]
    expect(boxes).toHaveLength(2)
    expect(boxes[1], "the same box moved, not a re-rendered one").toBe(first)
    expect([...container.querySelectorAll(".r")].map(el => el.textContent)).toEqual(["b", "a"])

    jq79.destroy()
  })
})
