import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { $, Component79 } from "../src/jq79"

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe("$destroyed", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  afterEach(() => host.remove())

  it("runs on destroy(), once", () => {
    const cleanup = vi.fn()
    const jq79 = new Component79(`<script :setup>$destroyed(cleanup)</script><p>x</p>`).mount(host, { cleanup })

    expect(cleanup).not.toHaveBeenCalled()
    jq79.destroy()
    jq79.destroy()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it("does not run on detach(), and still runs on the destroy after a remount", () => {
    const cleanup = vi.fn()
    const jq79 = new Component79(`<script :setup>$destroyed(cleanup)</script><p>x</p>`).mount(host, { cleanup })

    jq79.detach()
    jq79.mount(host)
    expect(cleanup).not.toHaveBeenCalled()

    jq79.destroy()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it("runs before teardown: the DOM is on the page and the store answers", () => {
    const report = vi.fn()
    const jq79 = new Component79(
      `<script :setup="_">let count = 3\n$destroyed(() => report($self(".p").textContent, $self(".p").isConnected, count))</script>` +
      `<p class="p">{{ count }}</p>`
    ).mount(host, { report })

    jq79.destroy()
    expect(report).toHaveBeenCalledWith("3", true, 3)
  })

  it("runs the previous generation's hooks on a re-render", () => {
    const cleanup = vi.fn()
    const src = `<script :setup="_">$destroyed(() => cleanup(label))</script><p>{{ label }}</p>`
    const jq79 = new Component79(src).mount(host, { cleanup, label: "first" })

    jq79.mount(host, { cleanup, label: "second" })
    expect(cleanup).toHaveBeenCalledWith("first")
    expect(cleanup).toHaveBeenCalledTimes(1)

    jq79.destroy()
    expect(cleanup).toHaveBeenLastCalledWith("second")
  })

  it("runs when an :if removes a child component, children after their parent", () => {
    const order: string[] = []
    const Child = new Component79(`<script :setup="{ log }">$destroyed(() => log("child"))</script><i>c</i>`)
    const jq79 = new Component79(
      `<script :setup="_">let show = true\n$destroyed(() => log("parent"))</script>` +
      `<div :if="show"><Child :log /></div>`
    ).mount(host, { Child, log: (name: string) => order.push(name) })

    jq79.data!.show = false
    expect(order).toEqual(["child"])

    jq79.data!.show = true
    jq79.destroy()
    expect(order).toEqual(["child", "parent", "child"])
  })

  it("runs every hook in order, reporting one that throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const order: number[] = []
    const jq79 = new Component79(
      `<script :setup="_">` +
      `$destroyed(() => order.push(1))\n` +
      `$destroyed(() => { throw new Error("boom") })\n` +
      `$destroyed(() => order.push(3))` +
      `</script>`
    ).mount(host, { order })

    expect(() => jq79.destroy()).not.toThrow()
    expect(order).toEqual([1, 3])
    expect(error).toHaveBeenCalledWith(expect.stringContaining("$destroyed"), expect.any(Error))
    error.mockRestore()
  })

  it("returns an unregister", () => {
    const cleanup = vi.fn()
    const jq79 = new Component79(`<script :setup="_">const off = $destroyed(cleanup)\noff()</script>`).mount(host, { cleanup })

    jq79.destroy()
    expect(cleanup).not.toHaveBeenCalled()
  })

  it("runs at once when registered after the component is already gone", async () => {
    const cleanup = vi.fn()
    let release!: () => void
    const late = new Promise<void>(resolve => { release = resolve })
    const jq79 = new Component79(
      `<script :setup="_">await $mounted()\nawait late\n$destroyed(cleanup)</script><p>x</p>`
    ).mount(host, { cleanup, late })

    await tick()
    jq79.destroy()
    release()
    await tick()

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it("is in a factory's ctx", () => {
    const cleanup = vi.fn()
    const jq79 = new Component79(
      `<script>export default ({ cleanup }, { $destroyed }) => { $destroyed(cleanup) }</script><p>x</p>`
    ).mount(host, { cleanup })

    jq79.destroy()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it("refuses a non-function where it is called", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    new Component79(`<script :setup>$destroyed("nope")</script>`).mount(host).destroy()
    await tick()

    expect(error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ name: "TypeError" }))
    error.mockRestore()
  })

  it("stops a timer the script started", async () => {
    vi.useFakeTimers()
    const jq79 = new Component79(
      `<script :setup>let ticks = 0\nconst timer = setInterval(() => ticks++, 10)\n$destroyed(() => clearInterval(timer))</script>` +
      `<p class="t">{{ ticks }}</p>`
    ).mount(host)

    vi.advanceTimersByTime(30)
    expect($(host, ".t")?.textContent).toBe("3")
    jq79.destroy()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
