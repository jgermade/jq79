// the language server's checks, run through jq79-check's checker (the same
// language plugin, the same services): what the virtual code has to get right
// is in src/component.ts, and each row of it is a test here.
// Needs the build: `npm test` runs it first
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { createChecker, findComponents, INFERRED_OPTIONS } = require("../dist/check.js")
const { generate } = require("../dist/component.js")
const ts = require("typescript")

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..")
// the helpers typed from the library's source, as a project that installs
// jq79 gets them from its .d.ts
const TYPED = { ...INFERRED_OPTIONS, paths: { jq79: [join(repo, "src/jq79.ts")] } }
const STRICT = { ...TYPED, strict: true }

// every diagnostic of each file, as "line:col TScode message"
const check = async (files, options = STRICT) => {
  const dir = mkdtempSync(join(tmpdir(), "jq79-check-"))
  const paths = Object.entries(files).map(([name, text]) => {
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    return path
  })
  const checker = createChecker(paths.filter(p => p.endsWith(".html")), options)
  const out = {}
  for (const path of paths.filter(p => p.endsWith(".html"))) {
    out[relative(dir, path)] = (await checker.check(path))
      .filter(d => d.severity === 1 || d.severity === 2)
      .sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character)
      .map(d => `${d.range.start.line + 1}:${d.range.start.character + 1} TS${d.code} ${d.message.split("\n")[0]}`)
  }
  return out
}
const one = async (text, options) => (await check({ "c.html": text }, options))["c.html"]

// ------------------------------------------------------------------ the corpus

// every component the tutorial ships, as its own check: no false errors. The
// JavaScript ones are read (allowJs) but not type-checked by default, as with
// any JS file; with checkJs, what is left is DOM typing that is plain
// TypeScript's - $self and $ return Element, as querySelector does - and
// not the virtual code's
test("every tutorial component checks clean", async () => {
  const files = findComponents(join(repo, "tutorial"))
  assert.ok(files.length > 50, `found ${files.length}`)
  const checker = createChecker(files, TYPED)
  const found = []
  for (const file of files) {
    for (const d of await checker.check(file)) {
      if (d.severity === 1 || d.severity === 2) found.push(`${relative(repo, file)}:${d.range.start.line + 1} TS${d.code} ${d.message}`)
    }
  }
  assert.deepEqual(found, [])
})

test("…and with checkJs, only DOM typing is left", async () => {
  const files = findComponents(join(repo, "tutorial"))
  const checker = createChecker(files, { ...TYPED, checkJs: true })
  const found = []
  for (const file of files) {
    for (const d of await checker.check(file)) {
      if (d.severity !== 1 && d.severity !== 2) continue
      const dom = d.code === 2339 && /on type '(Element|ChildNode)'/.test(d.message)
      if (!dom) found.push(`${relative(repo, file)}:${d.range.start.line + 1} TS${d.code} ${d.message}`)
    }
  }
  assert.deepEqual(found, [])
})

// ------------------------------------------------------------------ setup scripts

test("an error in a script lands on its line and column in the .html", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  let count: number = 0`,
    `  count = "one"`,
    `</script>`,
    `<p>{{ count }}</p>`,
  ].join("\n"))
  assert.deepEqual(errors, [`3:3 TS2322 Type 'string' is not assignable to type 'number'.`])
})

test("the :setup pattern types the props, with the component's own interface", async () => {
  const errors = await one([
    `<script :setup="{ step = 1, label }: Props" lang="ts">`,
    `  interface Props { step?: number; label: string }`,
    `  const s: string = step`,
    `  const l: string = label`,
    `</script>`,
  ].join("\n"))
  assert.deepEqual(errors, [`3:9 TS2322 Type 'number' is not assignable to type 'string'.`])
})

test("the :setup pattern is where its own errors are", async () => {
  const errors = await one(`<script :setup="{ step = 1 }: Missing" lang="ts"></script>`)
  assert.deepEqual(errors, [`1:31 TS2304 Cannot find name 'Missing'.`])
})

test("$: declares its target, with the type of the expression", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  let count = 1`,
    `  $: doubled = count * 2`,
    `  $: doubled.toUpperCase()`,
    `</script>`,
  ].join("\n"))
  assert.deepEqual(errors, [`4:14 TS2339 Property 'toUpperCase' does not exist on type 'number'.`])
})

test("$: over a declared name is an assignment, and its call arguments are dependencies", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  let query = ""`,
    `  let total = 0`,
    `  const schedule = () => {}`,
    `  $: total = query.length`,
    `  $: schedule(query)`,
    `  $: { schedule(query) }`,
    `</script>`,
  ].join("\n"))
  // only the call a `$:` labels names dependencies; one inside a block is a call
  assert.deepEqual(errors, [`7:17 TS2554 Expected 0 arguments, but got 1.`])
})

test("the scripts of a component share one store", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  let count = 0`,
    `</script>`,
    `<script :mounted lang="ts">`,
    `  count++`,
    `</script>`,
  ].join("\n"))
  assert.deepEqual(errors, [])
})

test("an assignment to a name declared nowhere goes to the store; a read of one is an error", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  setTimeout(() => { user = { name: "Ada" } })`,
    `  console.log(usr)`,
    `</script>`,
  ].join("\n"))
  assert.deepEqual(errors, [`3:15 TS2552 Cannot find name 'usr'. Did you mean 'user'?`])
})

test("the helpers are in scope, typed", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  await $mounted()`,
    `  const state = $reactive({ n: 1 })`,
    `  const n: number = state.n`,
    `  $emit("changed", n)`,
    `  const input = $self("input")`,
    `  const all: Element[] = $$self("li")`,
    `  const filled: boolean = $slots.footer`,
    `  $updateModel(n)`,
    `  $emit()`,
    `</script>`,
  ].join("\n"))
  assert.equal(errors.length, 1, errors.join("\n"))
  assert.match(errors[0], /^10:3 TS2554 /)
})

test("a sibling component is in scope, unless a prop takes its name", async () => {
  const errors = await check({
    "c.html": [
      `<script :setup lang="ts">`,
      `  const row = Row`,
      `</script>`,
      `<template name="Row">`,
      `  <script :setup="{ Cell }" lang="ts">`,
      `    const row = Row`,
      `    const cell: number = Cell`,
      `  </script>`,
      `</template>`,
      `<template name="Cell"><p></p></template>`,
    ].join("\n"),
  })
  // Cell comes from the parent (a prop), so it isn't the file's Cell
  assert.deepEqual(errors["c.html"], [])
})

test("import() of a component, and a static import where the runtime has none", async () => {
  const errors = await check({
    "c.html": [
      `<script :setup lang="ts">`,
      `  const Card = await import("./Card.html")`,
      `  const { double } = await import("./math")`,
      `  const four: number = double(2)`,
      `  const wrong: string = double(2)`,
      `  import x from "./math"`,
      `</script>`,
    ].join("\n"),
    "Card.html": `<script :setup="{ title }"></script><h2>{{ title }}</h2>`,
    "math.ts": `export const double = (n: number) => n * 2\nexport default 1`,
  })
  assert.deepEqual(errors["c.html"].map(e => e.split(" ").slice(0, 2).join(" ")), ["5:9 TS2322", "6:3 TS1232"])
})

// ------------------------------------------------------------------ factory scripts

test("a factory's (props, ctx) are typed without an annotation, and its imports resolve", async () => {
  const errors = await check({
    "c.html": [
      `<script lang="ts">`,
      `  import { double } from "./math"`,
      `  export default (_, { $data, $effect }) => {`,
      `    $data.count = double(1)`,
      `    $effect(() => { $data.twice = $data.count * 2 })`,
      `    $effect(1)`,
      `    return { inc: () => $data.count++ }`,
      `  }`,
      `</script>`,
    ].join("\n"),
    "math.ts": `export const double = (n: number) => n * 2`,
  })
  assert.deepEqual(errors["c.html"].map(e => e.split(" ").slice(0, 2).join(" ")), ["6:13 TS2345"])
})

// ------------------------------------------------------------------ what isn't checked

test("a page is not a component: its scripts are the browser's", async () => {
  const errors = await one(`<!doctype html>\n<script lang="ts">\n  const n: number = "x"\n</script>`)
  assert.deepEqual(errors, [])
})

test("a JavaScript component isn't type-checked unless checkJs, and a TS type on its :setup is ignored as at runtime", async () => {
  const text = `<script :setup="{ n = 1 }: Props">\n  let count = 1\n  const s = count.toUpperCase()\n</script>`
  assert.deepEqual(await one(text), [])
  assert.deepEqual(await one(text, { ...STRICT, checkJs: true }), [`3:19 TS2339 Property 'toUpperCase' does not exist on type 'number'.`])
})

test("<style lang=\"scss\"> is checked as SCSS", async () => {
  const errors = await one(`<style lang="scss">\n  .a { .b { color: red } }\n  .c { color red; }\n</style>`)
  assert.ok(errors.length > 0 && errors.every(e => e.startsWith("3:")), errors.join("\n"))
})

// ------------------------------------------------------------------ the mapping itself

test("every mapped range is the same text on both sides", () => {
  const text = [
    `<script :setup="{ step = 1 }: Props" lang="ts">`,
    `  interface Props { step?: number }`,
    `  $: doubled = step * 2`,
    `  const C = await import("./C.html")`,
    `</script>`,
    `<template name="Row"><script :setup>let x = 1</script></template>`,
  ].join("\n")
  const { code, mappings } = generate(ts, text)
  for (const m of mappings) {
    const source = text.slice(m.sourceOffsets[0], m.sourceOffsets[0] + m.lengths[0])
    const generated = code.slice(m.generatedOffsets[0], m.generatedOffsets[0] + m.lengths[0])
    assert.equal(generated, source)
  }
})
