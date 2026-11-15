// what a script's text compiles to is read once per text, not once per
// instance: a list of 130 component rows used to re-run every script pass per
// row, which was most of its render time. See
// RECORD/2026-11-15.cache-script-transforms.md

import { describe, it, expect, vi, afterEach } from "vitest"

// spies over the real passes, so a test counts how often the runtime asks
vi.mock("../src/transform", async importOriginal => {
  const real = await importOriginal<typeof import("../src/transform")>()
  return {
    ...real,
    transformSetupScript: vi.fn(real.transformSetupScript),
    transformFactoryScript: vi.fn(real.transformFactoryScript),
    parseFactoryProps: vi.fn(real.parseFactoryProps),
    parsePropsPattern: vi.fn(real.parsePropsPattern),
  }
})

import * as transform from "../src/transform"
import { Component79 } from "../src/jq79"

// the caches are module-wide, so every test gets script text of its own
let uid = 0
const unique = () => `/* ${++uid} */`

// calls whose argument is exactly `text` - other tests' scripts, and the
// expressions the template compiles, don't count
const callsWith = (fn: unknown, text: string) =>
  (fn as ReturnType<typeof vi.fn>).mock.calls.filter(([arg]) => arg === text).length

const mount = (component: Component79, data?: Record<string, any>) => {
  const container = document.createElement("div")
  component.mount(container, data)
  return container
}

afterEach(() => {
  document.head.innerHTML = ""
})

describe("script passes are cached by text", () => {
  it("a setup script is transformed once across many instances", () => {
    const script = `${unique()}\nlet count = 1\nconst double = count * 2`
    const pattern = "{ start = 0 }"
    const src = `<script :setup="${pattern}">${script}</script><p class="out">{{ count }} {{ double }} {{ start }}</p>`

    const outputs = Array.from({ length: 5 }, (_, i) => {
      const container = mount(new Component79(src), i % 2 ? { start: i } : {})
      return container.querySelector(".out")!.textContent
    })

    expect(outputs).toEqual(["1 2 0", "1 2 1", "1 2 0", "1 2 3", "1 2 0"])
    expect(callsWith(transform.transformSetupScript, script)).toBe(1)
    expect(callsWith(transform.transformFactoryScript, script)).toBe(1)
    expect(callsWith(transform.parseFactoryProps, script)).toBe(1)
    expect(callsWith(transform.parsePropsPattern, pattern)).toBe(1)
  })

  it("a factory script is transformed once across many instances", () => {
    const script = `${unique()}\nexport default ({ n = 1 }) => ({ twice: n * 2 })`
    const src = `<script>${script}</script><p class="out">{{ twice }}</p>`

    const texts = [1, 2, 3].map(n => mount(new Component79(src), { n }).querySelector(".out")!.textContent)

    expect(texts).toEqual(["2", "4", "6"])
    expect(callsWith(transform.transformFactoryScript, script)).toBe(1)
    expect(callsWith(transform.parseFactoryProps, script)).toBe(1)
    expect(callsWith(transform.transformSetupScript, script)).toBe(0)
  })

  it("a list of component rows reads its row's script once, not once per row", () => {
    const script = `${unique()}\nlet label = "#" + item`
    const pattern = "{ item }"
    const rows = Array.from({ length: 130 }, (_, i) => i)
    const container = mount(new Component79(`
      <ul><Row :each="n in items" :item="n" /></ul>
      <template name="Row">
        <script :setup="${pattern}">${script}</script>
        <li class="row">{{ label }}</li>
      </template>
    `), { items: rows })

    const labels = [...container.querySelectorAll(".row")].map(li => li.textContent)
    expect(labels).toEqual(rows.map(i => `#${i}`))
    expect(callsWith(transform.transformSetupScript, script)).toBe(1)
    expect(callsWith(transform.transformFactoryScript, script)).toBe(1)
    expect(callsWith(transform.parseFactoryProps, script)).toBe(1)
    expect(callsWith(transform.parsePropsPattern, pattern)).toBe(1)
  })

  it("instances sharing a cached script still keep state of their own", async () => {
    const src = `<script :setup>${unique()}\nlet n = 0</script><button class="b" @click="n++">{{ n }}</button>`
    const a = mount(new Component79(src))
    const b = mount(new Component79(src))

    a.querySelector<HTMLButtonElement>(".b")!.click()
    a.querySelector<HTMLButtonElement>(".b")!.click()
    await Promise.resolve()

    expect(a.querySelector(".b")!.textContent).toBe("2")
    expect(b.querySelector(".b")!.textContent).toBe("0")
  })

  it("the pre-0.4 factory signature still throws on every render, not just the first", () => {
    const src = `<script>${unique()}\nexport default ({ $data }) => { $data.count = 1 }</script><p>{{ count }}</p>`

    expect(() => mount(new Component79(src))).toThrow(/the factory signature is \(props, ctx\)/)
    expect(() => mount(new Component79(src))).toThrow(/the factory signature is \(props, ctx\)/)
  })
})
