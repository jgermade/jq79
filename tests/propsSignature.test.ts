import { describe, it, expect, afterEach, vi } from "vitest"
import { Component79 } from "../src/jq79"

const tick = () => new Promise(resolve => setTimeout(resolve))

// the console.warn spies below stack otherwise: spyOn returns the mock already
// installed, so its call log would carry the previous test's warns
afterEach(() => { vi.restoreAllMocks() })

const mount = (component: Component79, data?: Record<string, any>) => {
  const container = document.createElement("div")
  component.mount(container, data)
  return container
}

describe("component signature: setup mode", () => {
  it("seeds a declared default before the first render", () => {
    const component = new Component79(`
      <script :setup="{ label = 'Total', step = 1 }">
        let count = 0
        const inc = () => { count += step }
      </script>
      <button class="out" @click="inc">{{ label }}: {{ count }}</button>
    `)
    const container = mount(component)

    expect(container.querySelector(".out")?.textContent).toBe("Total: 0")
    container.querySelector("button")!.click()
    expect(container.querySelector(".out")?.textContent).toBe("Total: 1")
    component.destroy()
  })

  it("a prop the parent passes wins over its default", () => {
    const component = new Component79(`
      <script :setup="{ label = 'Total' }"></script>
      <p class="out">{{ label }}</p>
    `)
    const container = mount(component, { label: "Sum" })

    expect(container.querySelector(".out")?.textContent).toBe("Sum")
    component.destroy()
  })

  it("pre-declares a prop with no default, so the template can bind to it", () => {
    const component = new Component79(`
      <script :setup="{ user }">
        const name = () => user?.name ?? "anonymous"
      </script>
      <p class="out">{{ name() }}</p>
    `)
    const container = mount(component)

    expect(container.querySelector(".out")?.textContent).toBe("anonymous")
    expect("user" in (component.data as Record<string, any>)).toBe(true)
    component.destroy()
  })

  it("stays live after mount: a destructured prop name is a store key, not a copy", () => {
    const Child = new Component79(`
      <script :setup="{ label }"></script>
      <p class="out">{{ label }}</p>
    `)
    const parent = new Component79(`
      <script :setup>
        const Child = $child
        let label = "first"
      </script>
      <Child :label="label"></Child>
    `)
    const container = mount(parent, { $child: Child })

    expect(container.querySelector(".out")?.textContent).toBe("first")
    ;(parent.data as Record<string, any>).label = "second"

    expect(container.querySelector(".out")?.textContent).toBe("second")
    parent.destroy()
  })
})

describe("component signature: factory mode", () => {
  it("passes props first and the ctx second", () => {
    const component = new Component79(`
      <script>
        export default ({ label }, { $data }) => {
          $data.count = 1
          return { title: label.toUpperCase() }
        }
      </script>
      <p class="out">{{ title }} {{ count }}</p>
    `)
    const container = mount(component, { label: "hi" })

    expect(container.querySelector(".out")?.textContent).toBe("HI 1")
    component.destroy()
  })

  it("a default reaches the template even before an async factory has run", async () => {
    const component = new Component79(`
      <script>
        export default async ({ label = "Total" }) => {
          await Promise.resolve()
          return { ready: true }
        }
      </script>
      <p class="out">{{ label }} {{ ready }}</p>
    `)
    const container = mount(component)

    expect(container.querySelector(".out")?.textContent).toBe("Total ")
    await tick()
    expect(container.querySelector(".out")?.textContent).toBe("Total true")
    component.destroy()
  })

  it("$props stays live where a destructured primitive goes stale", async () => {
    const component = new Component79(`
      <script>
        export default ({ n = 1 }, { $data, $props, $effect }) => {
          $data.frozen = n
          $effect(() => { $data.live = $props.n })
        }
      </script>
      <p class="frozen">{{ frozen }}</p>
      <p class="live">{{ live }}</p>
    `)
    const container = mount(component)
    expect(container.querySelector(".frozen")?.textContent).toBe("1")
    expect(container.querySelector(".live")?.textContent).toBe("1")

    // what the parent's sync effect does when it re-evaluates a prop
    ;(component.data as Record<string, any>).n = 5
    await tick()

    expect(container.querySelector(".frozen")?.textContent).toBe("1")
    expect(container.querySelector(".live")?.textContent).toBe("5")
    component.destroy()
  })

  it("a nested component's defaults fill the props its parent doesn't pass", () => {
    const Child = new Component79(`
      <script>
        export default ({ label = "Total", step = 1 }) => ({})
      </script>
      <p class="child">{{ label }} +{{ step }}</p>
    `)
    const parent = new Component79(`
      <script :setup>
        const Child = $child
      </script>
      <Child :step="2"></Child>
    `)
    const container = mount(parent, { $child: Child })

    expect(container.querySelector(".child")?.textContent).toBe("Total +2")
    parent.destroy()
  })

  it("throws the migration error when the ctx is destructured as the first parameter", () => {
    const component = new Component79(`
      <script>
        export default ({ $data }) => { $data.count = 1 }
      </script>
      <p>{{ count }}</p>
    `)

    expect(() => mount(component)).toThrow(/the factory signature is \(props, ctx\)/)
  })

  it("an undeclared factory (`_`) keeps taking whatever the parent passes", () => {
    const component = new Component79(`
      <script>
        export default (_, { $data }) => { $data.seen = $data.anything }
      </script>
      <p class="out">{{ seen }}</p>
    `)
    const container = mount(component, { anything: "passed" })

    expect(container.querySelector(".out")?.textContent).toBe("passed")
    component.destroy()
  })
})

// A signature is a contract in both directions: what the component takes, and
// what it doesn't. A prop it never declared is dropped rather than quietly
// added to its store, so a wrong name at the usage site fails where it was
// written - `{{ label }}` renders empty, `{{ user.name }}` throws on the
// member access, and the usage site is warned by name. A bare `<script :setup>`
// is closed, like `{}`; `<script :setup="_">` is the permissive one.
describe("component signature: undeclared props are dropped", () => {
  it("drops what a closed signature doesn't declare", () => {
    const child = new Component79(`<script :setup="{}"></script><p class="out">[{{ extra }}]</p>`)
    const app = new Component79(`<div><Child :extra="'x'" /></div>`)
    const container = mount(app, { Child: child })

    expect(container.querySelector(".out")?.textContent).toBe("[]")
    app.destroy()
  })

  it("keeps what it declares and drops the rest", () => {
    const child = new Component79(
      `<script :setup="{ label }"></script><p class="out">[{{ label }}][{{ extra }}]</p>`
    )
    const app = new Component79(`<div><Child :label="'kept'" :extra="'dropped'" /></div>`)
    const container = mount(app, { Child: child })

    expect(container.querySelector(".out")?.textContent).toBe("[kept][]")
    app.destroy()
  })

  it("keeps dropping on later updates, not just the first render", () => {
    const child = new Component79(
      `<script :setup="{ label }"></script><p class="out">[{{ label }}][{{ extra }}]</p>`
    )
    const app = new Component79(`<div><Child :label="a" :extra="b" /></div>`)
    const container = mount(app, { Child: child, a: "one", b: "no" })

    expect(container.querySelector(".out")?.textContent).toBe("[one][]")

    app.data!.a = "two"
    app.data!.b = "still no"
    expect(container.querySelector(".out")?.textContent).toBe("[two][]")
    app.destroy()
  })

  it("narrows a spread to the declared props", () => {
    const child = new Component79(
      `<script :setup="{ name }"></script><p class="out">[{{ name }}][{{ version }}]</p>`
    )
    const app = new Component79(`<div><Child ...sdk /></div>`)
    const container = mount(app, { Child: child, sdk: { name: "jq79", version: "0.4.16" } })

    expect(container.querySelector(".out")?.textContent).toBe("[jq79][]")
    app.destroy()
  })

  it("stays permissive when the signature is `_`", () => {
    const child = new Component79(`<script :setup="_"></script><p class="out">[{{ extra }}]</p>`)
    const app = new Component79(`<div><Child :extra="'x'" /></div>`)
    const container = mount(app, { Child: child })

    expect(container.querySelector(".out")?.textContent).toBe("[x]")
    app.destroy()
  })

  it("treats a bare :setup as a closed signature, like `{}`", () => {
    // the difference between "takes nothing" and "takes anything" must not be
    // a pair of braces somebody didn't type
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(`<script :setup></script><p class="out">[{{ extra }}]</p>`)
    const app = new Component79(`<div><Child :extra="'x'" /></div>`)
    const container = mount(app, { Child: child })

    expect(container.querySelector(".out")?.textContent).toBe("[]")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(":extra is not declared by <Child>"))
    app.destroy()
  })

  it("filters a factory signature too", () => {
    const child = new Component79(
      `<script>export default ({ label }) => {}</script><p class="out">[{{ label }}][{{ extra }}]</p>`
    )
    const app = new Component79(`<div><Child :label="'kept'" :extra="'dropped'" /></div>`)
    const container = mount(app, { Child: child })

    expect(container.querySelector(".out")?.textContent).toBe("[kept][]")
    app.destroy()
  })

  it("stays silent about a spread's extra keys", () => {
    // `...sdk` wider than the component is the documented, intended use -
    // taking only the declared few is its point, not a mistake to report
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(`<script :setup="{ name }"></script><p class="out">{{ name }}</p>`)
    const app = new Component79(`<div><Child ...sdk /></div>`)
    const container = mount(app, { Child: child, sdk: { name: "jq79", version: "0.4.18" } })

    expect(container.querySelector(".out")?.textContent).toBe("jq79")
    expect(warn).not.toHaveBeenCalled()
    app.destroy()
  })

  it("says it once per usage site, not once per :each item", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(`<script :setup="{ label }"></script><p class="out">{{ label }}</p>`)
    const app = new Component79(`<div><Child :each="n in rows" :label="n" :extra="n" /></div>`)
    const container = mount(app, { Child: child, rows: [1, 2, 3] })

    expect(container.querySelectorAll(".out").length).toBe(3)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(":extra is not declared by <Child>"))
    app.destroy()
  })

  it("warns for a :model whose prop the child never declared", () => {
    // the model's prop is written by hand too, and a child that doesn't
    // declare it never sees the value coming down
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(`<script :setup="{}"></script><i class="out"></i>`)
    const app = new Component79(`<div><Child :model.uname="who" /></div>`)
    const container = mount(app, { Child: child, who: "Ada" })

    expect(container.querySelector(".out")).toBeTruthy()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(":uname is not declared by <Child>"))
    app.destroy()
  })

  it("says nothing when the component declared no signature", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(`<script :setup="_"></script><p class="out">{{ extra }}</p>`)
    const app = new Component79(`<div><Child :extra="'x'" /></div>`)
    const container = mount(app, { Child: child })

    expect(container.querySelector(".out")?.textContent).toBe("x")
    expect(warn).not.toHaveBeenCalled()
    app.destroy()
  })

  it("says nothing about a signature it could read", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(`<script :setup="{ label }"></script><p class="out">{{ label }}</p>`)
    const app = new Component79(`<div><Child :label="'ok'" /></div>`)
    mount(app, { Child: child })

    expect(warn).not.toHaveBeenCalled()
    app.destroy()
  })

  it("never filters the root's own data - it isn't props", () => {
    // render(data) seeds app state and carries the component definitions the
    // template resolves; filtering it would break both
    const child = new Component79(`<script :setup="{ label }"></script><p class="out">{{ label }}</p>`)
    const app = new Component79(`<script :setup="{}"></script><div><Child :label="who" /></div>`)
    const container = mount(app, { Child: child, who: "Ada" })

    expect(container.querySelector(".out")?.textContent).toBe("Ada")
    app.destroy()
  })
})

// a value that isn't a props pattern reads as "no signature", the most
// permissive mode there is - and since a bare :setup became closed and `_` the
// opt-out you ask for, a typo is the only way left to land there by accident
describe("component signature: a :setup value that isn't a props pattern", () => {
  it("warns for a pattern that doesn't start with a brace, and stays permissive", () => {
    // the line an outside report arrived with, written from the factory-mode
    // (props, ctx) signature: :setup taken for an injection list
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(
      `<script :setup=",{ Component79 }"></script><p class="out">[{{ extra }}]</p>`
    )
    const app = new Component79(`<div><Child :extra="'x'" /></div>`)
    const container = mount(app, { Child: child })

    expect(container.querySelector(".out")?.textContent).toBe("[x]") // permissive, as before
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`:setup=",{ Component79 }"`))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("is not a props pattern"))
    app.destroy()
  })

  it("warns for unbalanced braces", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(`<script :setup="{ label, step"></script><i class="out"></i>`)
    mount(new Component79(`<div><Child /></div>`), { Child: child })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("is not a props pattern"))
    child.destroy()
  })

  it("warns for a bare identifier, which is a signature only in factory mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(`<script :setup="props"></script><i class="out"></i>`)
    mount(new Component79(`<div><Child /></div>`), { Child: child })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`:setup="props"`))
    child.destroy()
  })

  it("says nothing for `_`, the opt-out that means it on purpose", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(`<script :setup="_"></script><p class="out">{{ extra }}</p>`)
    const app = new Component79(`<div><Child :extra="'x'" /></div>`)
    const container = mount(app, { Child: child })

    expect(container.querySelector(".out")?.textContent).toBe("x")
    expect(warn).not.toHaveBeenCalled()
    app.destroy()
  })

  it("says it once per definition, not once per instance", () => {
    // the parsed script blocks are shared by every instance a definition
    // renders, and setupSignature is consulted three times per render
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const child = new Component79(`<script :setup="props"></script><p class="out">{{ n }}</p>`)
    const app = new Component79(`<div><Child :each="n in rows" :n="n" /></div>`)
    const container = mount(app, { Child: child, rows: [1, 2, 3] })

    expect(container.querySelectorAll(".out").length).toBe(3)
    expect(warn).toHaveBeenCalledTimes(1)
    app.destroy()
  })
})
