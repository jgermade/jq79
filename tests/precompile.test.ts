import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, it, expect, vi, afterEach } from "vitest"
import { parseHTML, type HTMLNode } from "../src/html"
import { precompile } from "../src/precompile"

// precompile() finds every function the runtime would build for a component,
// without rendering it (RECORD/2026-09-23.no-unsafe-eval.md). Two things stand
// behind it: parseHTML reading a file as DOMParser does, checked here tree for
// tree; and the whole suite's differential, `npm run check:precompile`, which
// checks precompile() against every function the runtime actually compiled.
// The cases below are the ones a render can't show: what hasn't rendered yet.

// ---------------------------------------------------------------------------
// parseHTML against DOMParser
// ---------------------------------------------------------------------------

type Tree = { tag: string; attrs: Record<string, string>; children: (Tree | string)[] }

// the tree elementToAST reads off the DOM: elements and non-empty texts, a
// <template>'s children from its content, comments dropped. Tags lowercased,
// because an SVG tag keeps its case in the DOM and precompile never reads it
const domTree = (source: string): (Tree | string)[] => {
  const doc = new DOMParser().parseFromString(`<template>${source}</template>`, "text/html")
  const walk = (parent: ParentNode): (Tree | string)[] =>
    Array.from(parent.childNodes).flatMap((node): (Tree | string)[] => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [node.textContent] : []
      if (node.nodeType !== Node.ELEMENT_NODE) return []
      const el = node as Element
      return [{
        tag: el.tagName.toLowerCase(),
        attrs: Object.fromEntries(Array.from(el.attributes).map(attr => [attr.name, attr.value])),
        children: walk(el instanceof HTMLTemplateElement ? el.content : el),
      }]
    })
  return walk(doc.querySelector("template")!.content)
}

const lowered = (nodes: HTMLNode[]): (Tree | string)[] =>
  nodes.map(node => (typeof node === "string" ? node : { ...node, tag: node.tag.toLowerCase(), children: lowered(node.children) }))

const htmlFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? htmlFiles(path) : name.endsWith(".html") ? [path] : []
  })

describe("parseHTML", () => {
  const cases: Record<string, string> = {
    "references in attributes and text": `<p :if="a &amp;&amp; b" title="&lt;x&gt; &#39;q&#x27;">1 &lt; 2 &amp;&amp; {{ a &gt; b }}</p>`,
    "a legacy reference with no semicolon": `<a href="?x=1&copy=2&ampy" title="&copy 2026">&copy 2026 &ampfoo</a>`,
    "an unknown reference, read as the legacy one it starts with": `<p :text="a &notareference; b" title="&zzz;">&notareference; &zzz;</p>`,
    "every legacy reference, with and without its semicolon": `<p>&sup2 &sup2x &frac12; &AElig &yuml; &REG &eacute=</p><i title="&eacute &eacute= &eacutex &eacute;"></i>`,
    "CRLF and a lone CR": "<p :if=\"a\r\n&& b\">one\r\ntwo\rthree</p>",
    "comments split text, and hide tags": `<p>{{ a }}<!-- <b :if="x">no</b> -->{{ b }}<!-->{{ c }}<!--->{{ d }}</p>`,
    "raw text: script and style verbatim": `<div><script>if (a < b && c) x = "<b>&amp;</b>"</script><style>a > b { content: "&amp;" }</style></div>`,
    "escapable raw text: decoded, never tags": `<textarea :value="v">&lt;b&gt; {{ x }} <i>no</i></textarea><title>a &amp; b</title>`,
    "void elements and duplicate attributes": `<p><input :value="a" :value="b"><br>{{ after }}</p>`,
    "unquoted, empty and odd attributes": `<button @click=go :disabled data-x= y :a='it"s' b="it's">x</button>`,
    "a > and a newline inside a value": `<p :if="a > b &&\n c" :title='x > y'>{{ n }}</p>`,
    "a < that opens nothing": `<p>{{ a < b }} and 1 <2</p>`,
    "uppercase names": `<DIV :IF="x" Class="A"><SPAN>{{ y }}</SPAN></DIV>`,
    "svg, self-closing inside it": `<svg :width="w"><circle :r="r" /><title>{{ t }}</title></svg><p>{{ after }}</p>`,
    "template content": `<template :if="x"><b>{{ inside }}</b></template><template name="Row"><li>{{ row }}</li></template>`,
    "a stray end tag": `<p>{{ a }}</b>{{ b }}</p>`,
    "slot tags with dots": `<slot.header :title="t">{{ fallback }}</slot.header>`,
  }
  for (const [name, source] of Object.entries(cases)) {
    it(`reads ${name} as DOMParser does`, () => {
      expect(lowered(parseHTML(source))).toEqual(domTree(source))
    })
  }

  it("reads every component in the tutorial and the fixtures as DOMParser does", () => {
    const files = [...htmlFiles(resolve("tutorial")), ...htmlFiles(resolve("tests/fixtures"))]
    expect(files.length).toBeGreaterThan(50)
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      expect(lowered(parseHTML(source)), file).toEqual(domTree(source))
    }
  })
})

// ---------------------------------------------------------------------------
// precompile: what renders later
// ---------------------------------------------------------------------------

type Library = typeof import("../src/jq79")
const freshLibrary = async (): Promise<Library> => {
  vi.resetModules()
  return import("../src/jq79")
}

const tick = () => new Promise(resolve => setTimeout(resolve))
const RealFunction = globalThis.Function
const QUEUE = "__jq79precompiled"

// what a precompiled script does once loaded: here the functions are built by
// the test, which may eval; the page under test may not
const load = (entries: [string[], string][]) => {
  ((globalThis as any)[QUEUE] ??= []).push(
    ...entries.map(([params, body]) => {
      try {
        return [params, body, new RealFunction(...params, body)]
      } catch {
        return [params, body, null]
      }
    })
  )
}

// a page in safe mode, where `new Function` throws as a CSP makes it throw
const safePage = async (source: string) => {
  const library = await freshLibrary()
  load(precompile(source))
  await library.Component79.safeEval({ worker: false })
  globalThis.Function = new Proxy(RealFunction, {
    construct() { throw new EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed") },
  })
  return library
}

afterEach(() => {
  globalThis.Function = RealFunction
  delete (globalThis as any)[QUEUE]
  vi.restoreAllMocks()
})

describe("precompile", () => {
  // the runtime is what every page loads, and a page has no use for the
  // generator: it lives at jq79/precompile, for the worker and the Vite plugin
  it("is its own entry: the runtime doesn't carry it", async () => {
    const runtime: Record<string, unknown> = await freshLibrary()
    expect(runtime.precompile).toBeUndefined()
  })

  it("returns [params, body] pairs, deduplicated", async () => {
    const entries = precompile(`<p>{{ msg }}</p><b>{{ msg }}</b>`)
    // the scoped form and the `with` form of one expression, once each
    expect(entries).toHaveLength(2)
    entries.forEach(([params, body]) => {
      expect(params).toEqual(["$scope", "$r"])
      expect(body).toContain("msg")
    })
  })

  it("covers what hasn't rendered yet: a branch not taken, a handler not clicked, an empty list", async () => {
    const source = `
      <script>
        let open = false
        let items = []
        let log = ""
      </script>
      <button class="open" @click="open = true, items = ['a', 'b']">open</button>
      <section :if="open">
        <p class="secret">{{ log || "opened" }}</p>
        <button class="note" @click.prevent="log = $event.type + '!'">note</button>
        <i :each="item, i in items" :key="item" :class.first="i === 0">{{ i }}:{{ item.toUpperCase() }}</i>
      </section>
    `
    const { Component79 } = await safePage(source)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const host = document.createElement("div")
    new Component79(source).mount(host)
    await tick()
    expect(host.querySelector(".secret")).toBeNull()

    host.querySelector<HTMLButtonElement>(".open")!.click()
    await tick()
    expect(host.querySelector(".secret")?.textContent).toBe("opened")
    expect(Array.from(host.querySelectorAll("i")).map(i => i.textContent)).toEqual(["0:A", "1:B"])
    expect(host.querySelector("i")?.className).toBe("first")

    host.querySelector<HTMLButtonElement>(".note")!.click()
    await tick()
    expect(host.querySelector(".secret")?.textContent).toBe("click!")
    expect(error).not.toHaveBeenCalled()
  })

  it("covers a file's named components, their props, models, slots and tag events", async () => {
    const source = `
      <script>
        let name = "Ada"
        let count = 0
      </script>
      <Field :model="name" label="Name" @saved="count++"></Field>
      <Frame :title="name.toUpperCase()">
        <template :slot.footer="{ total = 2 }"><small>{{ total * 10 }}</small></template>
        <b>{{ count }}</b>
      </Frame>

      <template name="Field">
        <script :setup="{ model, label }">
          const save = () => { $updateModel(model + "!"); $emit("saved") }
        </script>
        <label>{{ label }}: <button class="save" @click="save()">{{ model }}</button></label>
      </template>

      <template name="Frame">
        <script :setup="{ title }"></script>
        <h2>{{ title }}</h2>
        <slot></slot>
        <slot.footer></slot.footer>
      </template>
    `
    const { Component79 } = await safePage(source)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const host = document.createElement("div")
    new Component79(source).mount(host)
    await tick()
    // a component's box is its own element, so the texts meet with no space
    expect(host.textContent!.replace(/\s+/g, "")).toBe("Name:AdaADA020")

    host.querySelector<HTMLButtonElement>(".save")!.click()
    await tick()
    expect(host.textContent!.replace(/\s+/g, "")).toBe("Name:Ada!ADA!120")
    expect(error).not.toHaveBeenCalled()
  })

  it("covers a factory script and the defaults of every signature", async () => {
    const source = `
      <script>
        export default ({ step = 5 }, { $data }) => {
          $data.n = 0
          return { bump: () => { $data.n += step } }
        }
      </script>
      <button @click="bump()">{{ n }}</button>
    `
    const { Component79 } = await safePage(source)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const host = document.createElement("div")
    new Component79(source).mount(host)
    await tick()
    host.querySelector("button")!.click()
    await tick()
    expect(host.textContent).toBe("5")
    expect(error).not.toHaveBeenCalled()
  })

  it("skips a component the runtime refuses, and warns about nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    // a factory destructuring a ctx name from props throws when it renders
    expect(() => precompile(`<script>export default ({ $data }) => ({})</script><p>{{ x }}</p>`)).not.toThrow()
    // an unreadable signature warns when it renders - not when it precompiles
    precompile(`<script :setup="{ a, ">let b = 1</script><p>{{ b }}</p>`)
    expect(warn).not.toHaveBeenCalled()
  })

  it("runs where there is no DOM at all: it reads no document, window or DOMParser", async () => {
    const source = readFileSync(resolve("tests/fixtures/user-card.html"), "utf8")
    const expected = precompile(source)
    vi.stubGlobal("DOMParser", undefined)
    vi.stubGlobal("document", undefined)
    vi.stubGlobal("window", undefined)
    try {
      expect(precompile(source)).toEqual(expected)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
