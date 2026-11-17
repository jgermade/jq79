import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { $, $$, Component79 } from "../src/jq79"

// :class and {{ }} compare against what they last wrote and touch the DOM only
// for the difference. RECORD/2026-11-17.closing-the-gap-with-svelte.md, B
//
// Run on both render paths: the skeleton cloner and renderNode each wire their
// own bindings, and a row of four elements is on the clone path by default
for (const cloneSkeletons of [true, false]) {
  describe(`cached setters (cloneSkeletons: ${cloneSkeletons})`, () => {
    let host: HTMLDivElement
    let flags: ReturnType<typeof Component79.debug>

    beforeEach(() => {
      host = document.createElement("div")
      document.body.appendChild(host)
      flags = Component79.debug()
      Component79.debug({ cloneSkeletons })
    })

    afterEach(() => {
      Component79.debug(flags)
      host.remove()
    })

    // the benchmark's row, one cell short
    const table = (rows: number) =>
      new Component79(
        `<table><tbody><tr :each="row in rows" :key="row.id" :class="{ danger: row.id === selected }">` +
        `<td class="col">{{ row.id }}</td><td><a>{{ row.label }}</a></td><td></td></tr></tbody></table>`
      ).render({
        rows: Array.from({ length: rows }, (_, i) => ({ id: i + 1, label: `row ${i + 1}` })),
        selected: null,
      }).mount(host)

    const watch = () => {
      const observer = new MutationObserver(() => {})
      observer.observe(host, { subtree: true, attributes: true, characterData: true, childList: true })
      return () => {
        const records = observer.takeRecords()
        observer.disconnect()
        return records
      }
    }

    it("selecting a row touches only the rows whose class changed", () => {
      const jq79 = table(50)
      jq79.data!.selected = 3
      const stop = watch()
      jq79.data!.selected = 7   // 50 :class effects wake; two of them change
      const records = stop()
      expect(records.map(r => [r.type, (r.target as Element).rowIndex])).toEqual([
        ["attributes", 2],
        ["attributes", 6],
      ])
      expect($$(host, "tr.danger").map(tr => tr.rowIndex)).toEqual([6])
      jq79.destroy()
    })

    it("an update rewrites only the text that changed", () => {
      const jq79 = table(5)
      const stop = watch()
      jq79.data!.rows[2].label += " !!!"
      const records = stop()
      expect(records.map(r => [r.type, r.target.textContent])).toEqual([["characterData", "row 3 !!!"]])
      jq79.destroy()
    })

    it("keeps the static class, and classes other code added", () => {
      const jq79 = new Component79(
        `<div><p class="btn base" :class="{ btn: on, extra: on }">x</p><b></b><i></i></div>`
      ).render({ on: true }).mount(host)
      const p = $(host, "p")!
      p.classList.add("foreign")
      jq79.data!.on = false
      expect(p.className).toBe("btn base foreign")
      jq79.data!.on = true
      expect([...p.classList].sort()).toEqual(["base", "btn", "extra", "foreign"])
      jq79.destroy()
    })

    it("handles every shape :class takes, and the shorthand", () => {
      const jq79 = new Component79(
        `<div><p :class="value" :class.flag="flag">x</p><b></b><i></i></div>`
      ).render({ value: "a  b", flag: false }).mount(host)
      const p = $(host, "p")!
      expect(p.className).toBe("a b")
      jq79.data!.value = ["c", { d: true, e: 0 }, null, "f g"]
      expect(p.className).toBe("c d f g")
      jq79.data!.flag = true
      expect(p.className).toBe("c d f g flag")
      jq79.data!.value = ""
      expect(p.className).toBe("flag")
      jq79.destroy()
    })

    it("does not put back a bound class other code removed until its value changes", () => {
      // the trade the cache makes, written down so changing it is a decision
      const jq79 = new Component79(
        `<div><p :class="{ on: on }">{{ n }}</p><b></b><i></i></div>`
      ).render({ on: true, n: 0 }).mount(host)
      const p = $(host, "p")!
      p.classList.remove("on")
      jq79.data!.on = 1          // truthy again: the same names as last time
      expect(p.classList.contains("on")).toBe(false)
      jq79.data!.on = false
      jq79.data!.on = true
      expect(p.classList.contains("on")).toBe(true)
      jq79.destroy()
    })
  })
}

describe("cached setters off", () => {
  it("re-adds every bound class on every run, as before", () => {
    const flags = Component79.debug()
    Component79.debug({ cachedSetters: false })
    const host = document.createElement("div")
    document.body.appendChild(host)
    try {
      const jq79 = new Component79(`<div><p :class="{ on: on }">x</p><b></b><i></i></div>`)
        .render({ on: true }).mount(host)
      const p = $(host, "p")!
      p.classList.remove("on")
      jq79.data!.on = 1
      expect(p.classList.contains("on")).toBe(true)
      jq79.destroy()
    } finally {
      Component79.debug(flags)
      host.remove()
    }
  })
})
