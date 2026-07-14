
import { describe, it, expect, vi } from "vitest"
import { Component79 } from "../src/jq79"

const tick = () => new Promise(resolve => setTimeout(resolve))

describe("factory scripts (<script> with export default)", () => {
  it("a synchronous factory runs before the first render", () => {
    const component = new Component79(`
      <script>
        export default (_, { $data }) => {
          $data.count = 1
          return { label: "hi" }
        }
      </script>
      <p class="out">{{ label }} {{ count }}</p>
    `)
    const container = document.createElement("div")
    component.mount(container)

    expect(container.querySelector(".out")?.textContent).toBe("hi 1")
    component.destroy()
  })

  it("mutations through $data update the DOM reactively", async () => {
    const component = new Component79(`
      <script>
        export default (_, { $data }) => {
          $data.n = 1
          setTimeout(() => { $data.n = 2 })
        }
      </script>
      <p class="n">{{ n }}</p>
    `)
    const container = document.createElement("div")
    component.mount(container)
    expect(container.querySelector(".n")?.textContent).toBe("1")

    await tick()
    expect(container.querySelector(".n")?.textContent).toBe("2")
    component.destroy()
  })

  it("$effect recomputes derived values", async () => {
    const component = new Component79(`
      <script>
        export default (_, { $data, $effect }) => {
          $data.count = 2
          $effect(() => { $data.double = $data.count * 2 })
          setTimeout(() => { $data.count = 5 })
        }
      </script>
      <p class="d">{{ double }}</p>
    `)
    const container = document.createElement("div")
    component.mount(container)
    expect(container.querySelector(".d")?.textContent).toBe("4")

    await tick()
    expect(container.querySelector(".d")?.textContent).toBe("10")
    component.destroy()
  })

  it("an async factory's return value is merged when it resolves", async () => {
    const component = new Component79(`
      <script>
        export default async () => {
          await Promise.resolve()
          return { label: "later" }
        }
      </script>
      <p class="out">{{ label }}</p>
    `)
    const container = document.createElement("div")
    component.mount(container)

    await tick()
    expect(container.querySelector(".out")?.textContent).toBe("later")
    component.destroy()
  })

  it("$emit reaches on() listeners", () => {
    const heard: any[] = []
    const component = new Component79(`
      <script>
        export default (_, { $emit }) => { $emit("ready", 42) }
      </script>
      <p></p>
    `)
    component.on("ready", (_event, payload) => heard.push(payload))
    const container = document.createElement("div")
    component.mount(container)

    expect(heard).toEqual([42])
    component.destroy()
  })

  it("a :mounted factory runs after attach and can reach its own DOM", async () => {
    const component = new Component79(`
      <script :mounted>
        export default (_, { $self }) => { $self(".target").textContent = "mounted!" }
      </script>
      <p class="target">waiting</p>
    `)
    const container = document.createElement("div")
    component.mount(container)

    await tick()
    expect(container.querySelector(".target")?.textContent).toBe("mounted!")
    component.destroy()
  })

  it("ignores an export default that is not a function", () => {
    const component = new Component79(`
      <script>
        export default { label: "not a factory" }
      </script>
      <p class="t">{{ label }}</p>
    `)
    const container = document.createElement("div")
    component.mount(container)

    // the object is not called and nothing is merged into the store
    expect(container.querySelector(".t")?.textContent).toBe("")
    expect(component.data!.label).toBeUndefined()
    component.destroy()
  })

  it("logs the error when the factory throws, without breaking the render", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const component = new Component79(`
      <script>
        export default () => { throw new Error("boom") }
      </script>
      <p class="t">rendered</p>
    `)
    const container = document.createElement("div")
    component.mount(container)

    await tick()
    expect(container.querySelector(".t")?.textContent).toBe("rendered")
    expect(spy).toHaveBeenCalledWith("jq79: error in factory script", expect.any(Error))
    component.destroy()
    spy.mockRestore()
  })

  it("logs the error when an async factory rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const component = new Component79(`
      <script>
        export default async () => { throw new Error("async boom") }
      </script>
      <p class="t">rendered</p>
    `)
    const container = document.createElement("div")
    component.mount(container)

    await tick()
    expect(spy).toHaveBeenCalledWith("jq79: error in factory script", expect.any(Error))
    component.destroy()
    spy.mockRestore()
  })

  describe("static imports", () => {
    it("default import of a component, exposed to the template via the return value", async () => {
      const child = new Component79(`<span class="child">child</span>`)
      const component = new Component79(
        `
          <script>
            import Child from "./child.html"
            export default () => ({ Child })
          </script>
          <div><Child></Child></div>
        `,
        { modules: { "./child.html": child } }
      )
      const container = document.createElement("div")
      component.mount(container)

      await tick()
      expect(container.querySelector(".child")?.textContent).toBe("child")
      component.destroy()
    })

    it("named, namespace and mixed clause forms", async () => {
      const util = { default: (s: string) => `[${s}]`, upper: (s: string) => s.toUpperCase() }
      const component = new Component79(
        `
          <script>
            import { upper as U } from "./util.js"
            import * as util from "./util.js"
            import wrap, { upper } from "./util.js"
            export default () => ({ out: wrap(U("hi")) + util.upper("!") + upper("?") })
          </script>
          <p class="out">{{ out }}</p>
        `,
        { modules: { "./util.js": util } }
      )
      const container = document.createElement("div")
      component.mount(container)

      await tick()
      expect(container.querySelector(".out")?.textContent).toBe("[HI]!?")
      component.destroy()
    })

    it("falls back to fetch for .html imports without a modules map", async () => {
      const fetchSpy = vi.fn(async () => ({ ok: true, text: async () => `<i class="fetched">f</i>` }))
      vi.stubGlobal("fetch", fetchSpy)
      try {
        const component = new Component79(`
          <script>
            import Remote from "/cards/remote.html"
            export default () => ({ Remote })
          </script>
          <div><Remote></Remote></div>
        `)
        const container = document.createElement("div")
        component.mount(container)

        await tick()
        expect(fetchSpy).toHaveBeenCalledWith("/cards/remote.html")
        expect(container.querySelector(".fetched")?.textContent).toBe("f")
        component.destroy()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  it("dynamic import() resolves through the modules map too", async () => {
    const child = new Component79(`<b class="dyn">dyn</b>`)
    const component = new Component79(
      `
        <script>
          export default async () => {
            const Child = await import("./child.html")
            return { Child }
          }
        </script>
        <div><Child></Child></div>
      `,
      { modules: { "./child.html": child } }
    )
    const container = document.createElement("div")
    component.mount(container)

    await tick()
    expect(container.querySelector(".dyn")?.textContent).toBe("dyn")
    component.destroy()
  })

  it("setup scripts are untouched: export default is what switches modes", () => {
    const component = new Component79(`
      <script :setup>
        let label = "setup"
      </script>
      <p class="out">{{ label }}</p>
    `)
    const container = document.createElement("div")
    component.mount(container)

    expect(container.querySelector(".out")?.textContent).toBe("setup")
    component.destroy()
  })
})
