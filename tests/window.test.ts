import { describe, it, expect, afterEach, vi } from "vitest"
import { Component79 } from "../src/jq79"

// :window - a :each that renders only the rows in view
// (RECORD/2026-11-12.a-windowed-each.md). jsdom has no layout, so the scroll
// container's geometry is faked: a viewport VIEWPORT px tall at the top of the
// page, its content (the list, from offset 0) moved up by scrollTop. What the
// real engine does with it is checked by hand in Chromium; this pins the
// arithmetic and the bookkeeping
const VIEWPORT = 100
const ROW = 20
const OVERSCAN = 8
const settle = () => new Promise(resolve => setTimeout(resolve, 40))

afterEach(() => { vi.restoreAllMocks() })

const setup = (count = 1000) => {
  const items = Array.from({ length: count }, (_, i) => ({ id: i, label: `row ${i}` }))
  const host = document.createElement("div")
  document.body.appendChild(host)
  const jq79 = new Component79(`
    <div class="scroller" style="overflow-y: auto; height: ${VIEWPORT}px">
      <div class="list">
        <p :each="item in items" :key="item.id" :window="${ROW}" class="row">{{ item.label }}</p>
      </div>
    </div>
  `)
  jq79.render({ items }).mount(host)
  const scroller = host.querySelector(".scroller") as HTMLElement
  let scrollTop = 0
  Object.defineProperty(scroller, "clientHeight", { value: VIEWPORT, configurable: true })
  Object.defineProperty(scroller, "scrollTop", { get: () => scrollTop, set: v => { scrollTop = v }, configurable: true })
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = this === scroller ? 0 : -scrollTop
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  })
  const list = host.querySelector(".list") as HTMLElement & { $scrollTo: (index: number, options?: object) => Node | null }
  const rows = () => Array.from(host.querySelectorAll(".row")) as HTMLElement[]
  const labels = () => rows().map(row => row.textContent)
  const spacers = () => Array.from(list.children).filter(el => el.getAttribute("aria-hidden") === "true") as HTMLElement[]
  const scroll = async (to: number) => {
    scrollTop = to
    scroller.dispatchEvent(new Event("scroll"))
    await settle()
  }
  const done = () => { jq79.destroy(); host.remove() }
  return { jq79, items, host, scroller, list, rows, labels, spacers, scroll, done }
}

const windowSize = Math.ceil(VIEWPORT / ROW) + 1 + 2 * OVERSCAN

describe(":window", () => {
  it("renders a screenful before layout, then only the rows in view, between spacers", async () => {
    const { rows, spacers, labels, done } = setup()
    // the first pass runs before the list is in the document: the window's
    // height stands in for the container's
    expect(rows().length).toBe(Math.ceil(window.innerHeight / ROW) + 1 + 2 * OVERSCAN)

    await settle()
    expect(rows().length).toBe(windowSize)
    expect(labels()[0]).toBe("row 0")
    const [top, bottom] = spacers()
    expect(top.style.height).toBe("0px")
    expect(bottom.style.height).toBe(`${(1000 - windowSize) * ROW}px`)
    expect(top.tagName).toBe("P") // the rows' own tag
    done()
  })

  it("follows the scroll, keeping the real $index and the rows that stay in view", async () => {
    const { jq79, rows, labels, spacers, scroll, done } = setup()
    await settle()
    await scroll(500 * ROW)
    const first = 500 - OVERSCAN
    expect(labels()[0]).toBe(`row ${first}`)
    expect(rows().length).toBe(windowSize)
    expect(spacers()[0].style.height).toBe(`${first * ROW}px`)

    // a scroll by one row reuses every row still in the window
    const kept = rows().find(row => row.textContent === "row 505")!
    await scroll(501 * ROW)
    expect(rows().find(row => row.textContent === "row 505")).toBe(kept)
    expect(labels()[0]).toBe(`row ${first + 1}`)

    // and rows that come into view render the item at their real position
    jq79.data!.items[first + 1].label = "changed"
    expect(labels()[0]).toBe("changed")
    done()
  })

  it("$scrollTo renders the row before it returns, and scrolls it into view", async () => {
    const { list, scroller, done } = setup()
    await settle()
    const row = list.$scrollTo(900) as HTMLElement
    expect(row?.textContent).toBe("row 900")
    expect(row.isConnected).toBe(true)
    // nearest edge: the row's bottom at the viewport's bottom
    expect(scroller.scrollTop).toBe(901 * ROW - VIEWPORT)

    list.$scrollTo(10, { block: "start" })
    expect(scroller.scrollTop).toBe(10 * ROW)
    done()
  })

  it("clamps the window when the list shrinks under it", async () => {
    const { jq79, labels, spacers, scroll, done } = setup()
    await settle()
    await scroll(900 * ROW)
    jq79.data!.items = jq79.data!.items.slice(0, 10)
    expect(labels()).toEqual(Array.from({ length: 10 }, (_, i) => `row ${i}`))
    expect(spacers().map(spacer => spacer.style.height)).toEqual(["0px", "0px"])
    done()
  })

  it("renders every row when the row height is not a positive number", () => {
    const host = document.createElement("div")
    const jq79 = new Component79(`<ul><li :each="n in items" :window="height">{{ n }}</li></ul>`)
      .render({ items: [1, 2, 3], height: 0 }).mount(host)
    expect(host.querySelectorAll("li:not([aria-hidden])").length).toBe(3)
    jq79.destroy()
  })

  it("does not write :window as an attribute, and lets go of the container when destroyed", async () => {
    const { host, list, scroller, done } = setup(50)
    await settle()
    expect(host.querySelector("[window]")).toBeNull()
    expect(typeof list.$scrollTo).toBe("function")
    const removed = vi.spyOn(scroller, "removeEventListener")
    done()
    expect(removed).toHaveBeenCalledWith("scroll", expect.any(Function))
    expect((list as any).$scrollTo).toBeUndefined()
  })
})
