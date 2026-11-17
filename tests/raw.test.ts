import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { $, $$, Component79, $reactive, $raw, $toRaw } from "../src/jq79"

// $raw: plain data the store holds without wrapping. The variable stays
// reactive, its contents do not. RECORD/2026-11-17.closing-the-gap-with-svelte.md, D
describe("$raw", () => {
  it("is never wrapped: reads hand back the object itself", () => {
    const rows = $raw([{ id: 1 }])
    const store = $reactive({ rows })
    expect(store.rows).toBe(rows)
    expect(store.rows[0]).toBe(rows[0])
  })

  it("unwraps what it is handed, and leaves primitives alone", () => {
    const store = $reactive({ list: [1, 2] })
    const raw = $raw(store.list)
    expect(raw).toBe($toRaw(store.list))
    expect($raw(5)).toBe(5)
    expect($raw(null)).toBe(null)
  })

  it("notifies when the key is reassigned, not when the contents change", () => {
    const store = $reactive({ rows: $raw([{ label: "a" }]) })
    const seen: string[] = []
    store.$effect(() => { seen.push(store.rows.map((r: any) => r.label).join()) })
    store.rows[0].label = "changed in place"
    store.rows.push({ label: "pushed" })
    expect(seen).toEqual(["a"])
    store.rows = [{ label: "b" }]
    expect(seen).toEqual(["a", "b"])
  })

  it("keeps a key raw across reassignment", () => {
    const store = $reactive({ rows: $raw([{ n: 1 }]) })
    store.rows = store.rows.map((r: any) => ({ n: r.n + 1 }))
    const next = store.rows
    expect($toRaw(next)).toBe(next) // not a proxy
    expect(next[0]).toEqual({ n: 2 })
  })

  it("travels with the value into a second store", () => {
    const rows = $raw([{ id: 1 }])
    const a = $reactive({ rows })
    const b = $reactive({ list: a.rows })
    expect(b.list).toBe(rows)
  })
})

describe("$raw in a component", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  afterEach(() => host.remove())

  const table = () => new Component79(
    `<script :setup>
      let data = $raw([{ id: 1, label: "a" }, { id: 2, label: "b" }, { id: 3, label: "c" }])
      let selected = null
      const relabel = () => { data = data.map(r => r.id === 2 ? { ...r, label: "B" } : r) }
      const swap = () => { const next = data.slice(); [next[0], next[2]] = [next[2], next[0]]; data = next }
      const inPlace = () => { data[0].label = "ignored" }
      const select = id => { selected = id }
    </script>
    <button class="relabel" @click="relabel">r</button>
    <button class="swap" @click="swap">s</button>
    <button class="in-place" @click="inPlace">i</button>
    <button class="select" @click="select(3)">x</button>
    <table><tbody>
      <tr :each="row in data" :key="row.id" :class="{ danger: row.id === selected }"><td>{{ row.id }}</td><td>{{ row.label }}</td></tr>
    </tbody></table>`
  ).render().mount(host)

  const rows = () => $$(host, "tr").map(tr => tr.textContent)
  const click = (cls: string) => ($(host, `.${cls}`) as HTMLButtonElement).click()

  it("renders a list replaced immutably, row by row", () => {
    const jq79 = table()
    expect(rows()).toEqual(["1a", "2b", "3c"])
    const second = $$(host, "tr")[1]
    click("relabel")
    expect(rows()).toEqual(["1a", "2B", "3c"])
    expect($$(host, "tr")[1]).toBe(second) // the keyed row was kept, and re-ran
    click("swap")
    expect(rows()).toEqual(["3c", "2B", "1a"])
    click("select")
    expect($$(host, "tr.danger").map(tr => tr.textContent)).toEqual(["3c"])
    jq79.destroy()
  })

  it("does not see a change made in place", () => {
    const jq79 = table()
    click("in-place")
    expect(rows()).toEqual(["1a", "2b", "3c"])
    jq79.destroy()
  })
})
