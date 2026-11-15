import { describe, it, expect, afterEach, vi } from "vitest"
import { Component79, $reactive, $computed } from "../src/jq79"

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
        <p :each="item in items" :key="item.id" :window="height" class="row">{{ item.label }}</p>
      </div>
    </div>
  `)
  jq79.render({ items, height: ROW }).mount(host)
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

// a view switch that changes the list, its keys and the row height at once -
// an app's library pane, where Songs is windowed and Albums is not, and the
// rows and the height each come from a $computed of their own over one store.
// The binding used to run between the two, against the new height and the old
// rows: 1,759 rows rendered unwindowed and torn down again in the same switch.
// See RECORD/2026-11-15.glitch-free-propagation.md
describe(":window, switching views", () => {
  const library = () => {
    const counts = { mounted: 0, destroyed: 0 }
    const songs = Array.from({ length: 1759 }, (_, i) => ({ key: `track:${i}` }))
    const albums = Array.from({ length: 129 }, (_, i) => ({ key: `@album:${i}` }))
    const lib = $reactive({ view: "songs" })
    const activeRoot = $computed(() => ({ data: { view: lib.view } }))
    const treeRows = $computed(() => ({ data: lib.view === "songs" ? songs : albums }))
    const host = document.createElement("div")
    document.body.appendChild(host)
    const jq79 = new Component79(`
      <script :setup="{ ws, counts }">
        const rowPx = () => ws.activeRoot.value.data.view === "songs" ? ${ROW} : 0
        const listed = () => ws.treeRows.value.data
      </script>
      <div class="scroller" style="overflow-y: auto; height: ${VIEWPORT}px">
        <div class="list"><Row :each="row in listed()" :key="row.key" :row="row" :counts="counts" :window="rowPx()" /></div>
      </div>
      <template name="Row">
        <script :setup="{ row, counts }">counts.mounted++; $destroyed(() => counts.destroyed++)</script>
        <p class="row">{{ row.key }}</p>
      </template>
    `)
    jq79.render({ ws: { activeRoot, treeRows }, counts }).mount(host)
    const rows = () => host.querySelectorAll(".row").length
    const reset = () => { counts.mounted = 0; counts.destroyed = 0 }
    return { lib, counts, rows, reset, done: () => { jq79.destroy(); host.remove() } }
  }

  it("windowed to whole: mounts each new row once and unmounts each old one once", async () => {
    const { lib, counts, rows, reset, done } = library()
    await settle()
    const windowed = rows()
    reset()
    lib.view = "albums"
    expect(rows()).toBe(129)
    expect(counts).toEqual({ mounted: 129, destroyed: windowed })
    done()
  })

  it("whole to windowed: mounts only the window", async () => {
    const { lib, counts, rows, reset, done } = library()
    await settle()
    lib.view = "albums"
    reset()
    lib.view = "songs"
    expect(counts).toEqual({ mounted: rows(), destroyed: 129 })
    expect(rows()).toBeLessThan(129)
    done()
  })
})

describe(":window, a new row height", () => {
  it("opening again after 0 renders the rows at the scroll position now, not the one it closed at", async () => {
    const { jq79, labels, scroll, done } = setup()
    await settle()
    await scroll(900 * ROW)
    jq79.data!.height = 0
    await scroll(0)
    jq79.data!.height = ROW
    // in the same pass: no frame of rows 892.. over an empty viewport
    expect(labels()[0]).toBe("row 0")
    expect(labels().length).toBe(windowSize)
    done()
  })

  it("a different height re-measures the window in the same pass", async () => {
    const { jq79, labels, spacers, scroll, done } = setup()
    await settle()
    await scroll(400 * ROW)
    jq79.data!.height = ROW / 2
    // the same scrollTop is row 800 at half the height
    const first = 800 - OVERSCAN
    expect(labels()[0]).toBe(`row ${first}`)
    expect(labels().length).toBe(Math.ceil(VIEWPORT / (ROW / 2)) + 1 + 2 * OVERSCAN)
    expect(spacers()[0].style.height).toBe(`${first * (ROW / 2)}px`)
    done()
  })
})
