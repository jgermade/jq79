import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { $, $$, Component79, $tick, $batch, $reactive, $computed } from "../src/jq79"

// Every @event handler runs inside $batch: what its writes wake runs once,
// after it returns, against the state it left.
// RECORD/2026-11-17.closing-the-gap-with-svelte.md, proposal A
describe("batched event handlers", () => {
  let host: HTMLDivElement
  let flags: ReturnType<typeof Component79.debug>

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    flags = Component79.debug()
  })

  afterEach(() => {
    Component79.debug(flags)
    host.remove()
  })

  // a binding that logs every state it is rendered against
  const twoWrites = () => {
    const seen: string[] = []
    const jq79 = new Component79(
      `<button @click="(a = 1, b = 1)">go</button><p>{{ log(a + ':' + b) }}</p>`
    ).render({ a: 0, b: 0, log: (s: string) => (seen.push(s), s) }).mount(host)
    seen.length = 0
    return { jq79, seen }
  }

  it("runs a binding once per handler, against the final state", () => {
    const { jq79, seen } = twoWrites()
    ;($(host, "button") as HTMLButtonElement).click()
    expect(seen).toEqual(["1:1"])
    expect($(host, "p")!.textContent).toBe("1:1")
    jq79.destroy()
  })

  it("runs it once per write, in between states included, with the flag off", () => {
    Component79.debug({ batchHandlers: false })
    const { jq79, seen } = twoWrites()
    ;($(host, "button") as HTMLButtonElement).click()
    expect(seen).toEqual(["1:0", "1:1"])
    jq79.destroy()
  })

  it("diffs a keyed list once for a swap written as two indexed writes", () => {
    let keys = 0
    const jq79 = new Component79(
      `<script :setup>const swap = () => { const t = rows[0]; rows[0] = rows[2]; rows[2] = t }</script>` +
      `<button @click="swap">swap</button>` +
      `<ul><li :each="row in rows" :key="key(row.id)">{{ row.id }}</li></ul>`
    ).render({
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      key: (id: number) => (keys++, id),
    }).mount(host)
    keys = 0
    ;($(host, "button") as HTMLButtonElement).click()
    expect($$(host, "li").map(li => li.textContent)).toEqual(["3", "2", "1"])
    expect(keys).toBe(3) // one pass over three rows, not two
    jq79.destroy()
  })

  it("lets the handler read its own writes before the DOM catches up", () => {
    let during: unknown[] = []
    const jq79 = new Component79(
      `<script :setup>
        let open = false
        const toggle = () => { open = true; check(open, $self("input")) }
      </script>
      <button @click="toggle">go</button><input :if="open">`
    ).render({ check: (...args: unknown[]) => (during = args) }).mount(host)
    ;($(host, "button") as HTMLButtonElement).click()
    expect(during).toEqual([true, null]) // the write landed; the <input> is not there yet
    expect($(host, "input")).not.toBeNull()
    jq79.destroy()
  })

  it("has the DOM in place after await $tick()", async () => {
    let found: Element | null = null
    const jq79 = new Component79(
      `<script :setup>
        let open = false
        const toggle = async () => { open = true; await $tick(); check($self("input")) }
      </script>
      <button @click="toggle">go</button><input :if="open">`
    ).render({ check: (el: Element | null) => { found = el } }).mount(host)
    ;($(host, "button") as HTMLButtonElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(found).toBe($(host, "input"))
    jq79.destroy()
  })

  it("resolves $tick at once when nothing is pending", async () => {
    await expect($tick()).resolves.toBeUndefined()
  })

  it("batches a handler on a component tag, heard through $emit", () => {
    const seen: string[] = []
    const child = new Component79(`<button @click="$emit('pick')">go</button>`)
    const jq79 = new Component79(
      `<div><Child @pick="(a = 1, b = 1)" /></div><p>{{ log(a + ':' + b) }}</p>`
    ).render({ a: 0, b: 0, Child: child, log: (s: string) => (seen.push(s), s) }).mount(host)
    seen.length = 0
    ;($(host, "button") as HTMLButtonElement).click()
    expect(seen).toEqual(["1:1"])
    jq79.destroy()
  })

  it("still flushes, and rethrows, when the handler throws", () => {
    const jq79 = new Component79(
      `<script :setup>
        let n = 0
        const boom = () => { n = 1; throw new Error("boom") }
      </script>
      <button @click="boom">go</button><p>{{ n }}</p>`
    ).render().mount(host)
    const errors: unknown[] = []
    const onError = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault() }
    window.addEventListener("error", onError)
    try {
      ;($(host, "button") as HTMLButtonElement).click()
    } catch (e) {
      errors.push(e)
    } finally {
      window.removeEventListener("error", onError)
    }
    expect($(host, "p")!.textContent).toBe("1")
    jq79.destroy()
  })

  it("reads a $computed fresh after writing what it derives from", () => {
    let got: unknown
    const jq79 = new Component79(
      `<script :setup>
        let n = 1
        const double = $computed(() => n * 2)
        const quad = $computed(() => double.value * 2)
        const go = () => { n = 5; check([double.value, quad.value]) }
      </script>
      <button @click="go">go</button><p>{{ quad.value }}</p>`
    ).render({ check: (v: unknown) => { got = v } }).mount(host)
    ;($(host, "button") as HTMLButtonElement).click()
    expect(got).toEqual([10, 20])
    expect($(host, "p")!.textContent).toBe("20")
    jq79.destroy()
  })
})

describe("$computed inside $batch", () => {
  it("recomputes on read when a write in the batch left it pending", () => {
    const store = $reactive({ n: 1 })
    const double = $computed(() => store.n * 2)
    let runs = 0
    store.$effect(() => { double.value; runs++ })
    runs = 0
    const seen = $batch(() => {
      store.n = 2
      const first = double.value
      store.n = 3
      return [first, double.value]
    })
    expect(seen).toEqual([4, 6])
    expect(double.value).toBe(6)
    expect(runs).toBe(1) // the effect reading it still ran once, after the batch
  })
})
