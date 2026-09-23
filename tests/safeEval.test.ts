import { describe, it, expect, vi, afterEach } from "vitest"

// Component79.safeEval() is global and one-way, like the CSP it exists for, so
// every case gets its own copy of the library: vi.resetModules() makes the
// next import evaluate the module again, with safe mode off and nothing
// registered. See RECORD/2026-09-23.no-unsafe-eval.md
type Library = typeof import("../src/jq79")
const freshLibrary = async (): Promise<Library> => {
  vi.resetModules()
  return import("../src/jq79")
}

const tick = () => new Promise(resolve => setTimeout(resolve))

const QUEUE = "__jq79precompiled"
const RealFunction = globalThis.Function

// runs `fn` on a page whose CSP has no 'unsafe-eval': `new Function` throws the
// way the browser makes it throw
const withEvalBlocked = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  globalThis.Function = new Proxy(RealFunction, {
    construct() { throw new EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed") },
    apply() { throw new EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed") },
  })
  try {
    return await fn()
  } finally {
    globalThis.Function = RealFunction
  }
}

// what the default mode hands `new Function` while it renders - which is, by
// definition, what a precompiler has to produce. The real Function is behind
// the proxy, so the component renders exactly as it always does
type Recorded = [params: string[], body: string]
const recordCompiles = async (fn: (library: Library) => void | Promise<void>): Promise<Recorded[]> => {
  const library = await freshLibrary()
  const calls: Recorded[] = []
  globalThis.Function = new Proxy(RealFunction, {
    construct(target, args: string[]) {
      // the //# sourceURL a named script carries is not part of what's precompiled
      calls.push([args.slice(0, -1), args[args.length - 1].replace(/\n\/\/# sourceURL=[^\n]*$/, "")])
      return Reflect.construct(target, args)
    },
  })
  try {
    await fn(library)
  } finally {
    globalThis.Function = RealFunction
  }
  return calls
}

// what a precompiled script does once the browser has loaded it as code
const pushPrecompiled = (entries: [string[], string, Function | null][]) => {
  const queue = ((globalThis as any)[QUEUE] ??= [])
  queue.push(...entries)
}
const precompile = (calls: Recorded[]) =>
  pushPrecompiled(calls.map(([params, body]) => [params, body, new RealFunction(...params, body)]))

afterEach(() => {
  delete (globalThis as any)[QUEUE]
  vi.restoreAllMocks()
})

const COUNTER = `
  <script>
    let count = 1
    let items = ["a", "b"]
    $: doubled = count * 2
    const add = () => { count++ }
  </script>
  <p class="out">{{ count }}/{{ doubled }}</p>
  <button class="add" @click="add()">+</button>
  <button class="ten" @click="count += 10">+10</button>
  <ul><li :each="item in items">{{ item }}</li></ul>
  <span class="big" :if="count > 5">big</span>
`

const renderCounter = async ({ Component79 }: Library) => {
  const host = document.createElement("div")
  new Component79(COUNTER).mount(host)
  await tick()
  // the template's whitespace between elements is dropped, so the buttons'
  // labels run into their neighbours: "1/2" "+" "+10" "a" "b"
  const text = () => host.textContent!.replace(/\s+/g, "")
  const before = text()
  host.querySelector<HTMLButtonElement>(".add")!.click()
  host.querySelector<HTMLButtonElement>(".ten")!.click()
  await tick()
  return { before, after: text() }
}

describe("Component79.safeEval()", () => {
  it("renders a precompiled component with eval blocked, exactly as eval renders it", async () => {
    let expected!: { before: string; after: string }
    const calls = await recordCompiles(async library => { expected = await renderCounter(library) })
    expect(expected.before).toBe("1/2++10ab")
    expect(expected.after).toBe("12/24++10abbig")

    precompile(calls)
    const library = await freshLibrary()
    await library.Component79.safeEval()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    const got = await withEvalBlocked(() => renderCounter(library))
    expect(got).toEqual(expected)
    expect(error).not.toHaveBeenCalled()
  })

  it("takes precompiled functions pushed after the library loaded, or before it", async () => {
    const calls = await recordCompiles(renderCounter)
    const [early, late] = [calls.slice(0, 3), calls.slice(3)]

    precompile(early)
    const library = await freshLibrary()
    await library.Component79.safeEval()
    precompile(late)

    const got = await withEvalBlocked(() => renderCounter(library))
    expect(got.after).toBe("12/24++10abbig")
  })

  it("never evaluates: a missing expression is reported once, by name, and renders empty", async () => {
    const { Component79 } = await freshLibrary()
    await Component79.safeEval()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const construct = vi.fn()
    globalThis.Function = new Proxy(RealFunction, { construct: (target, args) => { construct(); return Reflect.construct(target, args) } })

    const host = document.createElement("div")
    try {
      new Component79(`<p :each="n in [1, 2, 3]">{{ n * 10 }}</p>`).mount(host, {})
    } finally {
      globalThis.Function = RealFunction
    }

    expect(construct).not.toHaveBeenCalled() // eval is *allowed* here - safe mode just doesn't use it
    expect(host.textContent).toBe("")
    const messages = error.mock.calls.map(args => String(args[0]))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain(`"[1, 2, 3]" was not precompiled`)
  })

  it("a missing script throws, naming the script, as a script that doesn't compile always has", async () => {
    const { Component79 } = await freshLibrary()
    await Component79.safeEval()
    vi.spyOn(console, "error").mockImplementation(() => {})

    const component = new Component79(`<script>let n = 1</script><p>{{ n }}</p>`, { filename: "counter.html" })
    expect(() => component.mount(document.createElement("div"))).toThrow(
      /safeEval\(\) is on, and script 0 of counter\.html was not precompiled/
    )
  })

  it("an entry precompiled as null is a syntax error: it renders empty, and is not a miss", async () => {
    // the `with` form only: a scoped form that fails to compile falls back to
    // it, so nulling just the scoped one would leave the fallback missing
    const calls = await recordCompiles(({ Component79 }) => {
      Component79.debug({ scopedNames: false })
      new Component79(`<p>{{ msg }}</p>`).mount(document.createElement("div"), { msg: "hi" })
    })
    pushPrecompiled(calls.map(([params, body]) => [params, body, null]))
    const { Component79 } = await freshLibrary()
    Component79.debug({ scopedNames: false })
    await Component79.safeEval()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    const host = document.createElement("div")
    new Component79(`<p>{{ msg }}</p>`).mount(host, { msg: "hi" })
    expect(host.textContent).toBe("")
    expect(error).not.toHaveBeenCalled()
  })
})

describe("without safeEval()", () => {
  it("uses a precompiled function when there is one, and evaluates when there isn't", async () => {
    const calls = await recordCompiles(({ Component79 }) => {
      new Component79(`<p>{{ msg }}</p>`).mount(document.createElement("div"), { msg: "hi" })
    })
    // a stand-in, so the output shows which function ran
    pushPrecompiled(calls.map(([params, body]) => [params, body, () => "precompiled"]))
    const { Component79 } = await freshLibrary()

    const host = document.createElement("div")
    new Component79(`<p>{{ msg }}</p><b>{{ other }}</b>`).mount(host, { msg: "hi", other: "evaluated" })
    expect(host.textContent).toBe("precompiledevaluated")
  })

  it("a CSP that blocks eval still renders empty, as it always has", async () => {
    const { Component79 } = await freshLibrary()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    const host = document.createElement("div")
    await withEvalBlocked(() => new Component79(`<p>{{ msg }}</p>`).mount(host, { msg: "hi" }))
    expect(host.textContent).toBe("")
    expect(error).not.toHaveBeenCalled()
  })
})
