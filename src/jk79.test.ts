
import { describe, it, expect, beforeEach, vi } from "vitest"
import { $, $$, parseComponent, createReactiveDeepData, renderComponent } from "./jk79"

describe("$", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="root">
        <span class="item">a</span>
        <span class="item">b</span>
      </div>
    `
  })

  it("queries the document when given a selector string", () => {
    expect($("#root")).not.toBeNull()
    expect($("#root")?.tagName).toBe("DIV")
  })

  it("returns null when a selector string matches nothing", () => {
    expect($("#missing")).toBeNull()
  })

  it("queries within an element when given an element + selector", () => {
    const root = document.getElementById("root")!
    expect($(root, ".item")?.textContent).toBe("a")
  })
})

describe("$$", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="root">
        <span class="item">a</span>
        <span class="item">b</span>
      </div>
    `
  })

  it("returns an array of all matches for a selector string", () => {
    const items = $$(".item")
    expect(Array.isArray(items)).toBe(true)
    expect(items).toHaveLength(2)
  })

  it("returns an empty array when nothing matches", () => {
    expect($$(".missing")).toEqual([])
  })

  it("returns matches scoped to an element when given an element + selector", () => {
    const root = document.getElementById("root")!
    const items = $$(root, ".item")
    expect(items).toHaveLength(2)
    expect(items.map(el => el.textContent)).toEqual(["a", "b"])
  })
})

describe("parseComponent", () => {
  const component = `
    <script :setup="{ fname, lname }">
      const fullName = \`\${fname} \${lname}\`
    </script>

    <div :bind="{ fullName }"></div>
    <div class="full-name">
      {{ fullName }}
    </div>

    <style>
    .full-name {
      color: red;
    }
    </style>
  `

  it("extracts scripts with their attrs and content", () => {
    const { scripts } = parseComponent(component)

    expect(scripts).toHaveLength(1)
    expect(scripts[0].attrs).toEqual({ ":setup": "{ fname, lname }" })
    expect(scripts[0].content).toContain("const fullName")
  })

  it("extracts styles with their attrs and content", () => {
    const { styles } = parseComponent(component)

    expect(styles).toHaveLength(1)
    expect(styles[0].attrs).toEqual({})
    expect(styles[0].content).toContain(".full-name")
  })

  it("builds a template AST excluding script/style tags", () => {
    const { template } = parseComponent(component)

    expect(template).toHaveLength(2)

    expect(template[0]).toEqual({
      tag: "div",
      attrs: { ":bind": "{ fullName }" },
      children: [],
    })

    expect(template[1]).toEqual({
      tag: "div",
      attrs: { class: "full-name" },
      children: ["{{ fullName }}"],
    })
  })

  it("recurses into nested elements", () => {
    const { template } = parseComponent(`
      <ul>
        <li>one</li>
        <li>two</li>
      </ul>
    `)

    expect(template).toEqual([
      {
        tag: "ul",
        attrs: {},
        children: [
          { tag: "li", attrs: {}, children: ["one"] },
          { tag: "li", attrs: {}, children: ["two"] },
        ],
      },
    ])
  })

  it("returns empty collections for a component with no scripts/styles", () => {
    const { scripts, styles } = parseComponent("<div>just a div</div>")

    expect(scripts).toEqual([])
    expect(styles).toEqual([])
  })
})

describe("createReactiveDeepData", () => {
  it("keeps deep sets on the raw properties working like plain objects", () => {
    const scope = createReactiveDeepData({ user: { address: { city: "NYC" } } })

    scope.user.address.city = "LA"

    expect(scope.user.address.city).toBe("LA")
  })

  describe("$on", () => {
    it("fires with (value, dotKey) on a shallow set", () => {
      const listener = vi.fn()
      const scope = createReactiveDeepData({ name: "a" })
      scope.$on("name", listener)

      scope.name = "b"

      expect(listener).toHaveBeenCalledWith("b", "name")
    })

    it("fires with the full dot path for a nested property present at creation", () => {
      const listener = vi.fn()
      const scope = createReactiveDeepData({ user: { address: { city: "NYC" } } })
      scope.$on("user.address.city", listener)

      scope.user.address.city = "LA"

      expect(listener).toHaveBeenCalledWith("LA", "user.address.city")
    })

    it("fires with the full dot path for a property on an object assigned after creation", () => {
      const listener = vi.fn()
      const scope = createReactiveDeepData({ user: null as any })
      scope.$on("user.address.city", listener)

      scope.user = { address: { city: "NYC" } }
      scope.user.address.city = "LA"

      expect(listener).toHaveBeenCalledWith("LA", "user.address.city")
    })

    it("keeps deeper paths reactive after a whole subtree is replaced", () => {
      const listener = vi.fn()
      const scope = createReactiveDeepData({ user: { address: { city: "NYC" } } })
      scope.$on("user.address.city", listener)

      scope.user.address = { city: "LA" }
      scope.user.address.city = "SF"

      expect(listener).toHaveBeenCalledWith("SF", "user.address.city")
    })

    it("does not fire for unrelated keys", () => {
      const listener = vi.fn()
      const scope = createReactiveDeepData({ name: "a", other: "x" })
      scope.$on("name", listener)

      scope.other = "y"

      expect(listener).not.toHaveBeenCalled()
    })

    it("calls the listener immediately with the current value when immediate: true", () => {
      const listener = vi.fn()
      const scope = createReactiveDeepData({ user: { address: { city: "NYC" } } })

      scope.$on("user.address.city", listener, { immediate: true })

      expect(listener).toHaveBeenCalledWith("NYC", "user.address.city")
    })

    it("stops firing after unsubscribing", () => {
      const listener = vi.fn()
      const scope = createReactiveDeepData({ name: "a" })
      const unsubscribe = scope.$on("name", listener)

      unsubscribe()
      scope.name = "b"

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("$onAny", () => {
    it("fires with (dotKey, value) for any change anywhere in the tree", () => {
      const listener = vi.fn()
      const scope = createReactiveDeepData({ user: { address: { city: "NYC" } } })
      scope.$onAny(listener)

      scope.user.address.city = "LA"

      expect(listener).toHaveBeenCalledWith("user.address.city", "LA")
    })

    it("calls the listener immediately for every current leaf value when immediate: true", () => {
      const listener = vi.fn()
      const scope = createReactiveDeepData({ name: "a", user: { city: "NYC" } })

      scope.$onAny(listener, { immediate: true })

      expect(listener).toHaveBeenCalledWith("name", "a")
      expect(listener).toHaveBeenCalledWith("user.city", "NYC")
      expect(listener).toHaveBeenCalledTimes(2)
    })

    it("stops firing after unsubscribing", () => {
      const listener = vi.fn()
      const scope = createReactiveDeepData({ name: "a" })
      const unsubscribe = scope.$onAny(listener)

      unsubscribe()
      scope.name = "b"

      expect(listener).not.toHaveBeenCalled()
    })
  })

  it("does not expose $on/$onAny as enumerable data properties", () => {
    const scope = createReactiveDeepData({ name: "a" })

    expect(Object.keys(scope)).toEqual(["name"])
  })
})

describe("renderComponent", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  it("interpolates text content and updates it reactively", () => {
    const component = parseComponent(`<div class="full-name">{{ fullName }}</div>`)
    const data = createReactiveDeepData({ fullName: "Ada Lovelace" })

    container.appendChild(renderComponent(component, data))

    expect(container.querySelector(".full-name")?.textContent).toBe("Ada Lovelace")

    data.fullName = "Grace Hopper"

    expect(container.querySelector(".full-name")?.textContent).toBe("Grace Hopper")
  })

  it("applies :bind attributes and keeps them in sync", () => {
    const component = parseComponent(`<div :bind="{ title, disabled }"></div>`)
    const data = createReactiveDeepData({ title: "hi", disabled: false })

    container.appendChild(renderComponent(component, data))
    const el = container.querySelector("div")!

    expect(el.getAttribute("title")).toBe("hi")
    expect(el.hasAttribute("disabled")).toBe(false)

    data.title = "bye"
    data.disabled = true

    expect(el.getAttribute("title")).toBe("bye")
    expect(el.getAttribute("disabled")).toBe("true")
  })

  it("renders the :if branch when the condition is true and removes it when false", () => {
    const component = parseComponent(`<div :if="show" class="a">yes</div>`)
    const data = createReactiveDeepData({ show: true })

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
    const data = createReactiveDeepData({ score: 2 })

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

  it("renders a list with :each and re-renders it when the array changes", () => {
    const component = parseComponent(`<li :each="name in names">{{ name }}</li>`)
    const data = createReactiveDeepData({ names: ["a", "b"] })

    container.appendChild(renderComponent(component, data))

    expect($$(container, "li").map(el => el.textContent)).toEqual(["a", "b"])

    data.names = ["x", "y", "z"]

    expect($$(container, "li").map(el => el.textContent)).toEqual(["x", "y", "z"])
  })

  it("exposes $index inside :each", () => {
    const component = parseComponent(`<li :each="name in names">{{ $index }}:{{ name }}</li>`)
    const data = createReactiveDeepData({ names: ["a", "b"] })

    container.appendChild(renderComponent(component, data))

    expect($$(container, "li").map(el => el.textContent)).toEqual(["0:a", "1:b"])
  })
})
