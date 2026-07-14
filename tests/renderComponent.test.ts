
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
