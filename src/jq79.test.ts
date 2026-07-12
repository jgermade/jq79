
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { $, $$, parseComponent, $reactive, renderComponent, Component79 } from "./jq79"

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

describe("$reactive", () => {
  it("keeps deep sets on the raw properties working like plain objects", () => {
    const scope = $reactive({ user: { address: { city: "NYC" } } })

    scope.user.address.city = "LA"

    expect(scope.user.address.city).toBe("LA")
  })

  describe("$on", () => {
    it("fires with (value, dotKey) on a shallow set", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a" })
      scope.$on("name", listener)

      scope.name = "b"

      expect(listener).toHaveBeenCalledWith("b", "name")
    })

    it("fires with the full dot path for a nested property present at creation", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: { address: { city: "NYC" } } })
      scope.$on("user.address.city", listener)

      scope.user.address.city = "LA"

      expect(listener).toHaveBeenCalledWith("LA", "user.address.city")
    })

    it("fires with the full dot path for a property on an object assigned after creation", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: null as any })
      scope.$on("user.address.city", listener)

      scope.user = { address: { city: "NYC" } }
      scope.user.address.city = "LA"

      expect(listener).toHaveBeenCalledWith("LA", "user.address.city")
    })

    it("keeps deeper paths reactive after a whole subtree is replaced", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: { address: { city: "NYC" } } })
      scope.$on("user.address.city", listener)

      scope.user.address = { city: "LA" }
      scope.user.address.city = "SF"

      expect(listener).toHaveBeenCalledWith("SF", "user.address.city")
    })

    it("does not fire for unrelated keys", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a", other: "x" })
      scope.$on("name", listener)

      scope.other = "y"

      expect(listener).not.toHaveBeenCalled()
    })

    it("calls the listener immediately with the current value when immediate: true", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: { address: { city: "NYC" } } })

      scope.$on("user.address.city", listener, { immediate: true })

      expect(listener).toHaveBeenCalledWith("NYC", "user.address.city")
    })

    it("stops firing after unsubscribing", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a" })
      const unsubscribe = scope.$on("name", listener)

      unsubscribe()
      scope.name = "b"

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("$onAny", () => {
    it("fires with (dotKey, value) for any change anywhere in the tree", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: { address: { city: "NYC" } } })
      scope.$onAny(listener)

      scope.user.address.city = "LA"

      expect(listener).toHaveBeenCalledWith("user.address.city", "LA")
    })

    it("calls the listener immediately for every current leaf value when immediate: true", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a", user: { city: "NYC" } })

      scope.$onAny(listener, { immediate: true })

      expect(listener).toHaveBeenCalledWith("name", "a")
      expect(listener).toHaveBeenCalledWith("user.city", "NYC")
      expect(listener).toHaveBeenCalledTimes(2)
    })

    it("stops firing after unsubscribing", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a" })
      const unsubscribe = scope.$onAny(listener)

      unsubscribe()
      scope.name = "b"

      expect(listener).not.toHaveBeenCalled()
    })
  })

  it("does not expose $on/$onAny as enumerable data properties", () => {
    const scope = $reactive({ name: "a" })

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
    const data = $reactive({ fullName: "Ada Lovelace" })

    container.appendChild(renderComponent(component, data))

    expect(container.querySelector(".full-name")?.textContent).toBe("Ada Lovelace")

    data.fullName = "Grace Hopper"

    expect(container.querySelector(".full-name")?.textContent).toBe("Grace Hopper")
  })

  it("applies :bind attributes and keeps them in sync", () => {
    const component = parseComponent(`<div :bind="{ title, disabled }"></div>`)
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
    const component = parseComponent(`<div>{{ title }}</div><div :bind="{ label }"></div>`)
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
    const component = parseComponent(`<li :each="user in users" :key="user.id"><input :bind="{ value: user.name }"></li>`)
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

  it("mounts into a selector string", () => {
    host.id = "jq79-host"
    const jq79 = new Component79(`<div class="sel">ok</div>`).render().mount("#jq79-host")

    expect($(host, ".sel")).not.toBeNull()
    jq79.destroy()
  })

  it("injects styles into document.head on render and removes them on destroy", () => {
    const jq79 = new Component79(`<div class="styled">x</div><style>.styled { color: red; }</style>`)
    const stylesBefore = document.head.querySelectorAll("style").length

    jq79.render().mount(host)
    expect(document.head.querySelectorAll("style").length).toBe(stylesBefore + 1)

    jq79.unmount().destroy()
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

  it("unmount() detaches but keeps state, and mount() re-attaches with pending updates applied", () => {
    const jq79 = new Component79(`<div class="m">{{ n }}</div>`).render({ n: 1 }).mount(host)

    jq79.unmount()
    expect($(host, ".m")).toBeNull()

    jq79.data!.n = 2
    jq79.mount(host)
    expect($(host, ".m")?.textContent).toBe("2")

    jq79.destroy()
  })

  it("unmount() also collects nodes that :if inserted after mounting", () => {
    const jq79 = new Component79(`<div :if="show" class="cond">yes</div>`).render({ show: false }).mount(host)
    jq79.data!.show = true
    expect($(host, ".cond")).not.toBeNull()

    jq79.unmount()
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

    it("exposes the $, $$ and $create DOM helpers to setup scripts", () => {
      document.body.insertAdjacentHTML("beforeend", `<div class="probe">one</div><div class="probe">two</div>`)

      const jq79 = new Component79(
        `<script :setup="{ $, $$, $create }">` +
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

    it("lets scope properties shadow same-named DOM helpers", () => {
      const jq79 = new Component79(
        `<script :setup="{ $ }">const picked = $("ignored")</script><div class="shadow">{{ picked }}</div>`
      ).render({ $: () => "from scope" }).mount(host)

      expect($(host, ".shadow")?.textContent).toBe("from scope")
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
