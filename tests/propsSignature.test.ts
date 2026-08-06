import { describe, it, expect } from "vitest"
import { Component79 } from "../src/jq79"

const tick = () => new Promise(resolve => setTimeout(resolve))

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
// member access. Only a component that declared a signature filters: a bare
// `<script :setup>` declares nothing and stays permissive.
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

  it("stays permissive when no signature was declared", () => {
    const child = new Component79(`<script :setup></script><p class="out">[{{ extra }}]</p>`)
    const app = new Component79(`<div><Child :extra="'x'" /></div>`)
    const container = mount(app, { Child: child })

    expect(container.querySelector(".out")?.textContent).toBe("[x]")
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
