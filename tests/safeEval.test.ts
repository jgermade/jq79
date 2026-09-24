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

// the script a nonce-based CSP names, which safeEval({ nonce: true }) reads
const givePageNonce = (nonce = "r4nd0m") => {
  const script = document.createElement("script")
  script.type = "application/json"
  script.setAttribute("nonce", nonce)
  document.head.append(script)
  return script
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
    await library.Component79.safeEval({ worker: false })
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
    await library.Component79.safeEval({ worker: false })
    precompile(late)

    const got = await withEvalBlocked(() => renderCounter(library))
    expect(got.after).toBe("12/24++10abbig")
  })

  it("never evaluates: a missing expression is reported once, by name, and renders empty", async () => {
    const { Component79 } = await freshLibrary()
    await Component79.safeEval({ worker: false })
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
    await Component79.safeEval({ worker: false })
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
    await Component79.safeEval({ worker: false })
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

// jsdom runs an inserted <script> - but in a realm of its own, so a function it
// builds throws that realm's errors and returns that realm's promises. These
// cases stay clear of what that changes (an `instanceof ReferenceError`, an
// async factory's promise); the end-to-end proof, under a real CSP in a real
// browser, is scripts/check-csp.mjs
describe("Component79.safeEval({ nonce: true })", () => {
  let pageScript: HTMLScriptElement | null = null

  // the script a nonce-based CSP names: the one that loaded the page
  const givePageANonce = (nonce = "r4nd0m") => {
    pageScript = document.createElement("script")
    pageScript.type = "application/json" // present, and inert
    pageScript.setAttribute("nonce", nonce)
    document.head.append(pageScript)
  }

  afterEach(() => {
    pageScript?.remove()
    pageScript = null
  })

  // every <script> jq79 inserts, with the nonce it carried
  const watchInsertedScripts = () => {
    // records reach the callback at every microtask checkpoint, so they are
    // kept there as well as taken at the end
    const records: MutationRecord[] = []
    const observer = new MutationObserver(batch => { records.push(...batch) })
    observer.observe(document.head, { childList: true })
    return () => {
      records.push(...observer.takeRecords())
      const nonces = records
        .flatMap(record => Array.from(record.addedNodes))
        .filter((node): node is HTMLScriptElement => node instanceof HTMLScriptElement)
        .map(script => script.getAttribute("nonce"))
      observer.disconnect()
      return nonces
    }
  }

  it("builds a miss as a <script> carrying the page's nonce - and renders as eval does, with eval blocked", async () => {
    givePageANonce()
    const library = await freshLibrary()
    await library.Component79.safeEval({ nonce: true })
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const inserted = watchInsertedScripts()

    const got = await withEvalBlocked(() => renderCounter(library))

    expect(got).toEqual({ before: "1/2++10ab", after: "12/24++10abbig" })
    const nonces = inserted()
    expect(nonces.length).toBeGreaterThan(0)
    expect(new Set(nonces)).toEqual(new Set(["r4nd0m"]))
    expect(document.head.querySelectorAll("script:not([type])")).toHaveLength(0) // none left behind
    expect(error).not.toHaveBeenCalled()
  })

  it("builds each function once, however many instances run it", async () => {
    givePageANonce()
    const library = await freshLibrary()
    await library.Component79.safeEval({ nonce: true })

    await renderCounter(library)
    const inserted = watchInsertedScripts()
    const again = await renderCounter(library)

    expect(again.after).toBe("12/24++10abbig")
    expect(inserted()).toEqual([])
  })

  it("still prefers what was precompiled", async () => {
    const calls = await recordCompiles(({ Component79 }) => {
      new Component79(`<p>{{ msg }}</p>`).mount(document.createElement("div"), { msg: "hi" })
    })
    pushPrecompiled(calls.map(([params, body]) => [params, body, () => "precompiled"]))
    givePageANonce()
    const { Component79 } = await freshLibrary()
    await Component79.safeEval({ nonce: true })
    const inserted = watchInsertedScripts()

    const host = document.createElement("div")
    new Component79(`<p>{{ msg }}</p>`).mount(host, { msg: "hi" })
    expect(host.textContent).toBe("precompiled")
    expect(inserted()).toEqual([])
  })

  it("an expression that doesn't compile renders empty and silent, as under eval - its error event is taken", async () => {
    givePageANonce()
    const { Component79 } = await freshLibrary()
    await Component79.safeEval({ nonce: true })
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    const host = document.createElement("div")
    new Component79(`<p>{{ a b }}</p><b>{{ msg }}</b>`).mount(host, { msg: "hi" })
    expect(host.textContent).toBe("hi")
    expect(error).not.toHaveBeenCalled()
  })

  it("a script that doesn't compile throws its SyntaxError, where new Function threw it", async () => {
    givePageANonce()
    const { Component79 } = await freshLibrary()
    await Component79.safeEval({ nonce: true })

    let thrown: any
    try {
      new Component79(`<script>let = = 1</script><p>x</p>`).mount(document.createElement("div"))
    } catch (error) {
      thrown = error
    }
    expect(thrown?.name).toBe("SyntaxError")
  })

  it("rejects when no script on the page carries a nonce - and safe mode stays on", async () => {
    const { Component79 } = await freshLibrary()
    await expect(Component79.safeEval({ nonce: true })).rejects.toThrow(/found no nonce on this page/)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    const host = document.createElement("div")
    await withEvalBlocked(() => new Component79(`<p>{{ msg }}</p>`).mount(host, { msg: "hi" }))
    expect(host.textContent).toBe("")
    expect(String(error.mock.calls[0]?.[0])).toContain(`"msg" was not precompiled`)
  })
})

// Without a bundler, safeEval() registers jq79-sw.js and waits until it
// controls the page; a component fetched after that arrives with its
// functions, compiled by the worker from the same file. jsdom has no service
// workers and fetches no scripts, so both are stood in for: a container that
// claims the page when asked, and a <script src> whose answer is the worker's
// own code (precompiledResponse), run as the browser would run it. The real
// thing is in scripts/check-csp.mjs
describe("Component79.safeEval() with its worker", () => {
  const FILES: Record<string, string> = {
    "/Counter.html": COUNTER,
    "/App.html": `
      <script>
        const Row = await import("./Row.html")
        let label = "hi"
      </script>
      <Row :label></Row>
    `,
    "/Row.html": `<script :setup="{ label }"></script><b class="row">{{ label.toUpperCase() }}</b>`,
  }
  const origin = "http://localhost:3000"

  const serveFiles = async (url: string) => {
    const path = new URL(url, origin).pathname
    return path in FILES ? new Response(FILES[path]) : new Response("not found", { status: 404 })
  }

  // a service worker container, first visit: nothing controls the page until
  // the worker claims it - which it does when the page asks
  const fakeContainer = (options: { controlled?: boolean; refuse?: boolean } = {}) => {
    const listeners: Record<string, (() => void)[]> = {}
    const container: any = {
      controller: options.controlled ? {} : null,
      registered: [] as string[],
      claims: 0,
      ready: Promise.resolve(),
      addEventListener: (type: string, fn: () => void) => { (listeners[type] ??= []).push(fn) },
      register: async (url: string) => {
        if (options.refuse) throw new TypeError("Failed to register a ServiceWorker: 404")
        container.registered.push(url)
        return {
          active: {
            postMessage: (message: string) => {
              if (message !== "jq79:claim") return
              container.claims++
              container.controller = {}
              listeners.controllerchange?.forEach(fn => fn())
            },
          },
        }
      },
    }
    return container
  }

  // the worker's answer to every `?jq79-precompiled` script the page asks for
  const answerAsTheWorker = async () => {
    const { precompiledResponse } = await import("../src/sw")
    const asked: string[] = []
    const append = document.head.append.bind(document.head)
    vi.spyOn(document.head, "append").mockImplementation((...nodes: (Node | string)[]) => {
      for (const node of nodes) {
        if (node instanceof HTMLScriptElement && node.src.includes("jq79-precompiled")) {
          asked.push(node.src)
          precompiledResponse(new URL(node.src), serveFiles).then(async response => {
            if (!response.ok) return node.dispatchEvent(new Event("error"))
            new RealFunction("self", await response.text())(globalThis)
            node.dispatchEvent(new Event("load"))
          })
        } else append(node)
      }
    })
    return asked
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("registers the worker, waits until it controls the page - and a fetched component arrives with its functions", async () => {
    const container = fakeContainer()
    vi.stubGlobal("navigator", { serviceWorker: container })
    vi.stubGlobal("fetch", serveFiles)
    const asked = await answerAsTheWorker()
    const { Component79 } = await freshLibrary()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    await Component79.safeEval()
    expect(container.registered).toEqual(["/jq79-sw.js"])
    expect(container.claims).toBe(1) // a first visit: claimed when it asked

    const got = await withEvalBlocked(async () => {
      const Counter = await Component79.fetch(`${origin}/Counter.html`)
      const host = document.createElement("div")
      Counter.mount(host)
      // on the stack it mounts on: the functions were in before fetch resolved
      const before = host.textContent!.replace(/\s+/g, "")
      host.querySelector<HTMLButtonElement>(".add")!.click()
      host.querySelector<HTMLButtonElement>(".ten")!.click()
      await tick()
      return { before, after: host.textContent!.replace(/\s+/g, "") }
    })
    expect(got).toEqual({ before: "1/2++10ab", after: "12/24++10abbig" })
    expect(asked).toEqual([`${origin}/Counter.html?jq79-precompiled=`])
    expect(error).not.toHaveBeenCalled()
  })

  it("covers a component imported from a script, which is fetched the same way", async () => {
    vi.stubGlobal("navigator", { serviceWorker: fakeContainer() })
    vi.stubGlobal("fetch", serveFiles)
    const asked = await answerAsTheWorker()
    const { Component79 } = await freshLibrary()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    await Component79.safeEval()

    const host = document.createElement("div")
    await withEvalBlocked(async () => {
      const App = await Component79.fetch(`${origin}/App.html`)
      App.mount(host)
      for (let i = 0; i < 20 && !host.querySelector(".row"); i++) await tick()
    })
    expect(host.querySelector(".row")?.textContent).toBe("HI")
    expect(asked.sort()).toEqual([`${origin}/App.html?jq79-precompiled=`, `${origin}/Row.html?jq79-precompiled=`])
    expect(error).not.toHaveBeenCalled()
  })

  it("on a page the worker already controls, asks nothing of it", async () => {
    const container = fakeContainer({ controlled: true })
    vi.stubGlobal("navigator", { serviceWorker: container })
    const { Component79 } = await freshLibrary()
    await Component79.safeEval()
    expect(container.registered).toEqual(["/jq79-sw.js"])
    expect(container.claims).toBe(0)
  })

  it("registers the worker it is pointed at - or none, with worker: false or { nonce: true }", async () => {
    const container = fakeContainer({ controlled: true })
    vi.stubGlobal("navigator", { serviceWorker: container })
    await (await freshLibrary()).Component79.safeEval({ worker: "/site/jq79-sw.js" })
    await (await freshLibrary()).Component79.safeEval({ worker: false })
    givePageNonce()
    await (await freshLibrary()).Component79.safeEval({ nonce: true })
    expect(container.registered).toEqual(["/site/jq79-sw.js"])
  })

  it("rejects where there can be no worker, saying why - and safe mode stays on", async () => {
    vi.stubGlobal("navigator", {})
    const { Component79 } = await freshLibrary()
    await expect(Component79.safeEval()).rejects.toThrow(/this page can't have one - service workers need https/)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const host = document.createElement("div")
    await withEvalBlocked(() => new Component79(`<p>{{ msg }}</p>`).mount(host, { msg: "hi" }))
    expect(String(error.mock.calls[0]?.[0])).toContain(`"msg" was not precompiled`)
  })

  it("rejects when the worker won't register, naming where it looked - and fetch says so too", async () => {
    vi.stubGlobal("navigator", { serviceWorker: fakeContainer({ refuse: true }) })
    vi.stubGlobal("fetch", serveFiles)
    const { Component79 } = await freshLibrary()
    await expect(Component79.safeEval()).rejects.toThrow(/couldn't register its service worker at \/jq79-sw\.js/)
    await expect(Promise.resolve(Component79.fetch(`${origin}/Counter.html`))).rejects.toThrow(/couldn't register/)
  })
})
