
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { $, $$, Component79, parseComponent, $reactive, renderComponent, $toRaw } from "../src/jq79"

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
  // runner hardening (TODOS/2026-07-15.effect-runner-hardening.md): a
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
      // child (TODOS/2026-08-23.positional-refresh.md)
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
      // moved - and the diff now says so (TODOS/2026-08-23.notify-a-splice.md)
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
    // re-reads - not an attribute to bind now
    const component = parseComponent(`<div><Later :foo="n" /><drop-area :foo="n"></drop-area></div>`)
    const data = $reactive({ n: 1 })

    container.appendChild(renderComponent(component, data))

    expect(container.querySelector("later")!.getAttribute(":foo")).toBe("n")
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
    // Here the inner <A> finds no "A" in the child scope and falls back to a
    // plain HTML <a> anchor
    const container = document.createElement("div")
    document.body.appendChild(container)
    const A = parseComponent(`<div class="a"><A></A></div>`)
    const data = $reactive({ A })

    container.appendChild(renderComponent(A, data))

    expect(container.querySelectorAll("div.a").length).toBe(2)
    expect(container.querySelector("div.a div.a a")).not.toBeNull()
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
// the tree DOMParser already built - TODOS/2026-08-24.svg-namespace.md
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

  it("does not treat an svg tag as a component that has not arrived", () => {
    const data = render(`<div><svg><circle r="1" /></svg></div>`)
    // the upgrade watch swaps an unknown tag when a matching key appears. An
    // <svg> is a real element and must sit still
    data.Svg = parseComponent(`<b class="wrong">tomado</b>`)
    data.Circle = parseComponent(`<b class="wrong">tomado</b>`)

    expect(container.querySelector(".wrong")).toBeNull()
    expect(container.querySelector("svg")).not.toBeNull()
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
// element - TODOS/2026-08-24.mathml.md
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
