import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { $, Component79, $reactive, $computed } from "../src/jq79"

describe("$computed", () => {
  it("holds get's result on .value and follows what it read", () => {
    const cart = $reactive({ items: [] as { price: number }[] })
    const total = $computed(() => cart.items.reduce((sum, item) => sum + item.price, 0))

    expect(total.value).toBe(0)
    cart.items.push({ price: 3 })
    expect(total.value).toBe(3)
    cart.items[0].price = 5
    expect(total.value).toBe(5)
  })

  it("follows more than one store", () => {
    const a = $reactive({ n: 1 })
    const b = $reactive({ n: 2 })
    const sum = $computed(() => a.n + b.n)

    a.n = 10
    b.n = 20
    expect(sum.value).toBe(30)
  })

  it("wakes an effect that reads it, and only when the value changes", () => {
    const list = $reactive({ items: [] as number[] })
    const empty = $computed(() => list.items.length === 0)
    const host = $reactive({})
    const seen: boolean[] = []
    host.$effect(() => { seen.push(empty.value) })

    list.items.push(1)
    list.items.push(2) // still not empty: the same primitive notifies nobody
    list.items.length = 0

    expect(seen).toEqual([true, false, true])
  })

  it("can be derived from another $computed", () => {
    const state = $reactive({ n: 2 })
    const double = $computed(() => state.n * 2)
    const quad = $computed(() => double.value * 2)

    state.n = 5
    expect(quad.value).toBe(20)
  })

  it("is a store: $on hears .value change", () => {
    const state = $reactive({ n: 1 })
    const double = $computed(() => state.n * 2)
    const listener = vi.fn()
    double.$on("value", listener)

    state.n = 4
    expect(listener).toHaveBeenCalledWith(8, "value")
  })

  it("is bridged when held by another store", () => {
    const state = $reactive({ n: 1 })
    const holder = $reactive({ double: $computed(() => state.n * 2) })
    const seen: number[] = []
    holder.$effect(() => { seen.push(holder.double.value) })

    state.n = 3
    expect(seen).toEqual([2, 6])
  })

  it("refuses writes, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const state = $reactive({ n: 1 })
    const double = $computed(() => state.n * 2)

    ;(double as any).value = 99
    delete (double as any).value

    expect(double.value).toBe(2)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("read-only"))
    warn.mockRestore()
  })

  it("keeps its last value when get throws, instead of throwing out of the write", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const state = $reactive({ user: { name: "Ada" } as { name: string } | null })
    const name = $computed(() => state.user!.name.toUpperCase())

    expect(() => { state.user = null }).not.toThrow()
    expect(name.value).toBe("ADA")
    expect(error).toHaveBeenCalledWith(expect.stringContaining("$computed"), expect.any(TypeError))

    state.user = { name: "Grace" }
    expect(name.value).toBe("GRACE")
    error.mockRestore()
  })

  it("stops following its sources once disposed", () => {
    const state = $reactive({ n: 1 })
    const get = vi.fn(() => state.n * 2)
    const double = $computed(get)

    double.$dispose()
    state.n = 5

    expect(get).toHaveBeenCalledTimes(1)
    expect(double.value).toBe(2)
  })
})

describe("$computed in a component", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  afterEach(() => host.remove())

  it("renders through .value, from a setup script", () => {
    const jq79 = new Component79(
      `<script :setup>let count = 1\nconst double = $computed(() => count * 2)</script>` +
      `<button class="c" @click="count++">{{ double.value }}</button>`
    ).mount(host)

    expect($(host, ".c")?.textContent).toBe("2")
    $(host, ".c")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect($(host, ".c")?.textContent).toBe("4")
    jq79.destroy()
  })

  it("renders a $computed passed as a prop", () => {
    const cart = $reactive({ items: [1, 2] })
    const count = $computed(() => cart.items.length)
    const child = new Component79(`<script :setup="{ count }"></script><b class="n">{{ count.value }}</b>`)
    const jq79 = new Component79(`<Badge :count />`).mount(host, { Badge: child, count })

    expect($(host, ".n")?.textContent).toBe("2")
    cart.items.push(3)
    expect($(host, ".n")?.textContent).toBe("3")
    jq79.destroy()
    count.$dispose()
  })

  it("is disposed with the component that made it, in both script modes", () => {
    const shared = $reactive({ n: 1 })
    const setupGet = vi.fn()
    const factoryGet = vi.fn()
    const jq79 = new Component79(
      `<script :setup="{ shared, setupGet }">const a = $computed(() => setupGet(shared.n))</script>` +
      `<script>export default ({ shared, factoryGet }, { $computed }) => ({ b: $computed(() => factoryGet(shared.n)) })</script>`
    ).mount(host, { shared, setupGet, factoryGet })

    // counted from here: the factory's merge adds a key, and a new key re-runs
    // every effect the store holds (see notify), adopted ones included
    setupGet.mockClear()
    factoryGet.mockClear()
    shared.n = 2
    expect(setupGet).toHaveBeenCalledTimes(1)
    expect(factoryGet).toHaveBeenCalledTimes(1)

    jq79.destroy()
    shared.n = 3
    expect(setupGet).toHaveBeenCalledTimes(1)
    expect(factoryGet).toHaveBeenCalledTimes(1)
  })
})
