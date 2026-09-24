import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, it, expect, afterEach } from "vitest"
import { precompiledResponse, parsesAsOneFunction } from "../src/sw"
import { precompile, precompiledScript } from "../src/precompile"

// jq79-sw.js, the service worker behind `await Component79.safeEval()` without
// a bundler (RECORD/2026-09-23.no-unsafe-eval.md). What it answers is tested
// here; the runtime's side is in tests/safeEval.test.ts, and the whole thing
// under a real CSP, in a real browser, in scripts/check-csp.mjs

// the intrinsic constructor, not the global binding: `npm run check:precompile`
// wraps the global to record what the runtime compiles, and what this file
// compiles is its own checking, not the runtime's
const RealFunction = (() => {}).constructor as FunctionConstructor

// what a browser does with the script the worker answers: runs it, as a
// classic script, where `self` is the page
const run = (script: string, self: Record<string, any> = {}) => {
  new RealFunction("self", script)(self)
  return self
}

const serving = (files: Record<string, string>) => {
  const asked: string[] = []
  const fetchSource = async (url: string) => {
    asked.push(url)
    const path = new URL(url).pathname
    return path in files ? new Response(files[path]) : new Response("not found", { status: 404 })
  }
  return { asked, fetchSource }
}

const htmlFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? htmlFiles(path) : name.endsWith(".html") ? [path] : []
  })

afterEach(() => {
  delete (globalThis as any).__pwned
})

describe("the worker's answer", () => {
  it("is the component's functions, as a script that registers them", async () => {
    const source = readFileSync(resolve("tests/fixtures/user-card.html"), "utf8")
    const { asked, fetchSource } = serving({ "/cards/user-card.html": source })
    const response = await precompiledResponse(new URL("http://site.test/cards/user-card.html?jq79-precompiled="), fetchSource)

    expect(asked).toEqual(["http://site.test/cards/user-card.html"])
    expect(response.headers.get("Content-Type")).toBe("text/javascript")
    const { __jq79precompiled: registered } = run(await response.text())
    expect(registered.map(([params, body]: [string[], string]) => [params, body])).toEqual(precompile(source))
    registered.forEach(([, , fn]: [unknown, unknown, unknown]) => expect(typeof fn).toBe("function"))
  })

  it("asks for the same URL minus its own parameter, and keeps the component's", async () => {
    const { asked, fetchSource } = serving({ "/card.html": "<p>{{ a }}</p>" })
    await precompiledResponse(new URL("http://site.test/card.html?v=2&jq79-precompiled=&lang=es"), fetchSource)
    expect(asked).toEqual(["http://site.test/card.html?v=2&lang=es"])
  })

  it("answers a missing component with its status, so the <script> that asked fails", async () => {
    const { fetchSource } = serving({})
    const response = await precompiledResponse(new URL("http://site.test/gone.html?jq79-precompiled="), fetchSource)
    expect(response.status).toBe(404)
  })

  it("writes a function that doesn't parse as null - the runtime's syntax error - and keeps the rest", async () => {
    const { fetchSource } = serving({ "/card.html": "<p>{{ a b }}</p><b>{{ ok }}</b>" })
    const response = await precompiledResponse(new URL("http://site.test/card.html?jq79-precompiled="), fetchSource)
    const { __jq79precompiled: registered } = run(await response.text())
    const byBody = new Map(registered.map(([, body, fn]: [unknown, string, unknown]) => [body, fn]))
    expect(byBody.get("with ($scope) { return (a b\n); }")).toBeNull()
    expect(typeof byBody.get("with ($scope) { return (ok\n); }")).toBe("function")
  })

  // An expression is the component author's text - or whoever managed to put a
  // file on the origin. Written into the script unchecked, one that closes its
  // function early runs what follows when the script loads: this one closes
  // the function, the entry and the push, and sets a flag
  const ESCAPE = `<p>{{ 1) } }]); self.__pwned = 1; ([[], "", function () { { (1 }}</p><b>{{ ok }}</b>`

  it("never writes text that runs when the script loads - the escape, shown working without the check", () => {
    const unchecked = precompiledScript(precompile(ESCAPE), () => true)
    expect(run(unchecked).__pwned).toBe(1) // the payload is real
  })

  it("never writes text that runs when the script loads - and with the check, it doesn't", async () => {
    const { fetchSource } = serving({ "/evil.html": ESCAPE })
    const response = await precompiledResponse(new URL("http://site.test/evil.html?jq79-precompiled="), fetchSource)
    const page = run(await response.text())
    expect(page.__pwned).toBeUndefined()
    const byBody = new Map(page.__jq79precompiled.map(([, body, fn]: [unknown, string, unknown]) => [body, fn]))
    expect(typeof byBody.get("with ($scope) { return (ok\n); }")).toBe("function")
  })

  it("checks with a parser what new Function would check - over every component in the tutorial and the fixtures", () => {
    const files = [...htmlFiles(resolve("tutorial")), ...htmlFiles(resolve("tests/fixtures"))]
    let checked = 0
    for (const file of files) {
      for (const [params, body] of precompile(readFileSync(file, "utf8"))) {
        let compiles = true
        try {
          new RealFunction(...params, body)
        } catch {
          compiles = false
        }
        expect(parsesAsOneFunction(params, body), `${file}: ${body.slice(0, 80)}`).toBe(compiles)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(500)
  })
})
