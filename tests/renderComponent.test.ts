
import { describe, it, expect, beforeEach, vi } from "vitest"
import { $, $$, parseComponent, $reactive, renderComponent } from "../src/jq79"

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
    expect(el.getAttribute("disabled")).toBe("true")
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
describe("attribute binding edges", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  it(":attrs sets boolean attributes for falsy values that are not null/undefined/false", () => {
    // only null, undefined and false remove; 0 and "" *set* the attribute,
    // and a set boolean attribute is ON - `disabled: items.length` disables
    // the button when the list is empty. Pinned so the trap stays documented
    const component = parseComponent(`<button :attrs="{ disabled: n }">x</button>`)
    const data = $reactive({ n: 0 as any })

    container.appendChild(renderComponent(component, data))
    const button = container.querySelector("button")!

    expect(button.hasAttribute("disabled")).toBe(true)
    expect(button.disabled).toBe(true)

    data.n = ""
    expect(button.disabled).toBe(true)

    data.n = false
    expect(button.disabled).toBe(false)
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
