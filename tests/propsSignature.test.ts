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
    expect("user" in component.data).toBe(true)
    component.destroy()
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
