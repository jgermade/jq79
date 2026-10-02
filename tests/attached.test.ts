import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { $, Component79 } from "../src/jq79"

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe("$attached / $detached", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  afterEach(() => host.remove())

  const logger = () => {
    const log: string[] = []
    return { log, push: (entry: string) => log.push(entry) }
  }

  it("run on every attach and detach, the first mount included", () => {
    const { log, push } = logger()
    const jq79 = new Component79(
      `<script :setup="_">$attached(() => push("in"))\n$detached(() => push("out"))</script><p>x</p>`
    ).mount(host, { push })

    expect(log).toEqual(["in"])
    jq79.detach()
    jq79.mount(host)
    jq79.detach()
    expect(log).toEqual(["in", "out", "in", "out"])
    jq79.destroy()
    expect(log).toEqual(["in", "out", "in", "out"]) // already off the page: nothing to balance
  })

  it("run where the DOM is: on the page in both hooks", () => {
    const seen: boolean[] = []
    const jq79 = new Component79(
      `<script :setup="_">const on = () => seen.push($self(".p").isConnected)\n$attached(on)\n$detached(on)</script><p class="p">x</p>`
    ).mount(host, { seen })

    jq79.detach()
    expect(seen).toEqual([true, true])
    jq79.destroy()
  })

  it("never runs $detached without an $attached to balance", () => {
    const { log, push } = logger()
    const jq79 = new Component79(`<script :setup="_">$detached(() => push("out"))</script><p>x</p>`).render({ push })

    jq79.destroy()
    expect(log).toEqual([])
  })

  it("destroy() on the page runs $detached, then $destroyed", () => {
    const { log, push } = logger()
    const jq79 = new Component79(
      `<script :setup="_">$destroyed(() => push("destroyed"))\n$detached(() => push("detached"))</script><p>x</p>`
    ).mount(host, { push })

    jq79.destroy()
    expect(log).toEqual(["detached", "destroyed"])
  })

  describe("immediate", () => {
    it("is on by default: registered on the page, it runs now and on every attach", async () => {
      const { log, push } = logger()
      const jq79 = new Component79(
        `<script :setup="_">await $mounted()\n$attached(() => push("in"))</script><p>x</p>`
      ).mount(host, { push })

      await tick()
      expect(log).toEqual(["in"])
      jq79.detach()
      jq79.mount(host)
      expect(log).toEqual(["in", "in"])
      jq79.destroy()
    })

    it("{ immediate: false } waits for the next attach", async () => {
      const { log, push } = logger()
      const jq79 = new Component79(
        `<script :setup="_">await $mounted()\n$attached(() => push("in"), { immediate: false })</script><p>x</p>`
      ).mount(host, { push })

      await tick()
      expect(log).toEqual([])
      jq79.detach()
      jq79.mount(host)
      expect(log).toEqual(["in"])
      jq79.destroy()
    })

    it("changes nothing before the first mount: it runs once, on it", () => {
      const { log, push } = logger()
      const jq79 = new Component79(`<script :setup="_">$attached(() => push("in"))</script><p>x</p>`).render({ push })

      expect(log).toEqual([])
      jq79.mount(host)
      expect(log).toEqual(["in"])
      jq79.destroy()
    })
  })

  it("waits for a held render to paint", async () => {
    const { log, push } = logger()
    let release!: () => void
    const late = new Promise<void>(resolve => { release = resolve })
    const jq79 = new Component79(
      `<script :setup="_">$attached(() => push($self(".p") ? "painted" : "empty"))\nawait late</script><p class="p">x</p>`
    ).mount(host, { push, late })

    expect(log).toEqual([])
    release()
    await tick()
    expect(log).toEqual(["painted"])
    jq79.destroy()
  })

  it("doesn't fire for a root mounted outside the document", async () => {
    const { log, push } = logger()
    const jq79 = new Component79(`<script :setup="_">$attached(() => push("in"))</script><p>x</p>`)
      .mount(document.createElement("div"), { push })

    await tick()
    expect(log).toEqual([])
    jq79.mount(host)
    expect(log).toEqual(["in"])
    jq79.destroy()
  })

  describe("nested components", () => {
    const Child = new Component79(
      `<script :setup="{ push, name }">$attached(() => push(name + " in"))\n$detached(() => push(name + " out"))</script><i>{{ name }}</i>`
    )

    it("hear their root's mount and detach, a parent before what it rendered", () => {
      const { log, push } = logger()
      const jq79 = new Component79(
        `<script :setup="_">$attached(() => push("root in"))\n$detached(() => push("root out"))</script>` +
        `<div><Child :push name="a" /><Child :push name="b" /></div>`
      ).mount(host, { Child, push })

      expect(log).toEqual(["root in", "a in", "b in"])
      log.length = 0
      jq79.detach()
      expect(log).toEqual(["root out", "a out", "b out"])
      log.length = 0
      jq79.mount(host)
      expect(log).toEqual(["root in", "a in", "b in"])
      jq79.destroy()
    })

    it("hear their own :if: attached when it inserts them, detached when it removes them", async () => {
      const { log, push } = logger()
      const jq79 = new Component79(
        `<script :setup="_">let show = false</script><div :if="show"><Child :push name="c" /></div>`
      ).mount(host, { Child, push })

      jq79.data!.show = true
      await tick()
      expect(log).toEqual(["c in"])
      jq79.data!.show = false
      expect(log).toEqual(["c in", "c out"])
      jq79.destroy()
    })

    it("count slot content as being where its DOM is", () => {
      const { log, push } = logger()
      const Frame = new Component79(`<section><slot></slot></section>`)
      const jq79 = new Component79(`<Frame><Child :push name="slotted" /></Frame>`).mount(host, { Frame, Child, push })

      jq79.detach()
      jq79.mount(host)
      expect(log).toEqual(["slotted in", "slotted out", "slotted in"])
      jq79.destroy()
    })
  })

  it("runs the old generation's $detached and the new one's $attached on a re-render", () => {
    const { log, push } = logger()
    const src = `<script :setup="_">$attached(() => push(label + " in"))\n$detached(() => push(label + " out"))</script><p>x</p>`
    const jq79 = new Component79(src).mount(host, { push, label: "1" })

    jq79.mount(host, { push, label: "2" })
    expect(log).toEqual(["1 in", "1 out", "2 in"])
    jq79.destroy()
  })

  it("after the component is gone: a late $detached runs at once, a late $attached never", async () => {
    const { log, push } = logger()
    let release!: () => void
    const late = new Promise<void>(resolve => { release = resolve })
    const jq79 = new Component79(
      `<script :setup="_">await $mounted()\nawait late\n$attached(() => push("in"))\n$detached(() => push("out"))</script><p>x</p>`
    ).mount(host, { push, late })

    await tick()
    jq79.destroy()
    release()
    await tick()
    expect(log).toEqual(["out"])
  })

  it("return an unregister", () => {
    const { log, push } = logger()
    const jq79 = new Component79(
      `<script :setup="_">const off = $attached(() => push("in"))\noff()\n$detached(() => push("out"))()</script><p>x</p>`
    ).mount(host, { push })

    jq79.detach()
    expect(log).toEqual([])
    jq79.destroy()
  })

  it("report a hook that throws and run the rest", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const { log, push } = logger()
    const jq79 = new Component79(
      `<script :setup="_">$attached(() => { throw new Error("boom") })\n$attached(() => push("in"))</script><p>x</p>`
    ).mount(host, { push })

    expect(log).toEqual(["in"])
    expect(error).toHaveBeenCalledWith(expect.stringContaining("$attached"), expect.any(Error))
    error.mockRestore()
    jq79.destroy()
  })

  it("are in a factory's ctx", () => {
    const { log, push } = logger()
    const jq79 = new Component79(
      `<script>export default ({ push }, { $attached, $detached }) => { $attached(() => push("in")); $detached(() => push("out")) }</script><p>x</p>`
    ).mount(host, { push })

    jq79.detach()
    expect(log).toEqual(["in", "out"])
    jq79.destroy()
  })

  it("pause and resume a timer across detach()", () => {
    vi.useFakeTimers()
    const jq79 = new Component79(
      `<script :setup>let ticks = 0\nlet timer\n` +
      `$attached(() => { timer = setInterval(() => ticks++, 10) })\n` +
      `$detached(() => clearInterval(timer))</script>` +
      `<p class="t">{{ ticks }}</p>`
    ).mount(host)

    vi.advanceTimersByTime(30)
    jq79.detach()
    vi.advanceTimersByTime(100)
    expect(jq79.data!.ticks).toBe(3)
    jq79.mount(host)
    vi.advanceTimersByTime(20)
    expect($(host, ".t")?.textContent).toBe("5")
    jq79.destroy()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
