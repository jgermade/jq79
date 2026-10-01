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
// JavaScript scripts are read (allowJs) but not type-checked by default, as
// with any JS file; their templates always are (template.ts). What is left is
// the exercises themselves: a starting file whose template reads a name the
// exercise is to add. With checkJs, DOM typing that is TypeScript's own joins
// it - $self and $ return Element, as querySelector does
const EXERCISES = [
  "tutorial/01-basics/02-reactive-state/app.html:6 TS2304 Cannot find name 'doubled'.",
  "tutorial/01-basics/03-lists-and-conditions/app.html:12 TS2552 Cannot find name 'todo'. Did you mean 'todos'?",
  "tutorial/01-basics/07-objects-and-entries/app.html:6 TS2304 Cannot find name 'fruit'.",
  "tutorial/01-basics/07-objects-and-entries/app.html:6 TS2304 Cannot find name 'count'.",
]

const corpus = async options => {
  const files = findComponents(join(repo, "tutorial"))
  assert.ok(files.length > 50, `found ${files.length}`)
  const checker = createChecker(files, options)
  const found = []
  for (const file of files) {
    for (const d of await checker.check(file)) {
      if (d.severity === 1 || d.severity === 2) found.push({ d, line: `${relative(repo, file)}:${d.range.start.line + 1} TS${d.code} ${d.message}` })
    }
  }
  return found
}

test("every tutorial component checks clean, but for the exercises", async () => {
  const found = (await corpus(TYPED)).map(f => f.line)
  assert.deepEqual(found.sort(), [...EXERCISES].sort())
  // and no solution is among them
  assert.ok(found.every(line => !line.includes("/solution/")))
})

test("…and with checkJs, only DOM typing is added", async () => {
  const found = (await corpus({ ...TYPED, checkJs: true }))
    .filter(({ d }) => !(d.code === 2339 && /on type '(Element|ChildNode)'/.test(d.message)))
    .map(f => f.line)
  assert.deepEqual(found.sort(), [...EXERCISES].sort())
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

test("an `import type` in a setup script is erased with the types, so it is hoisted, not an error", async () => {
  const errors = await check({
    "c.html": [
      `<script :setup="{ user }: Props" lang="ts">`,
      `  import type { Props } from "./types"`,
      `  import { type Props as P2 } from "./types"`,
      `  const age: string = user.age`,
      `</script>`,
    ].join("\n"),
    "types.ts": `export interface Props { user: { age: number } }`,
  })
  assert.deepEqual(errors["c.html"], ["4:9 TS2322 Type 'number' is not assignable to type 'string'."])
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

// ------------------------------------------------------------------ templates

test("a template reads the store, typed by the scripts", async () => {
  const errors = await one([
    `<script :setup="{ step = 1 }: Props" lang="ts">`,
    `  interface Props { step?: number }`,
    `  let count = 0`,
    `  $: label = \`\${count} × \${step}\``,
    `</script>`,
    `<p>{{ label.toUpperCase() }} {{ count.toUpperCase() }}</p>`,
    `<button @click="count = count + step">+</button>`,
    `<button @click="count = 'x'">x</button>`,
  ].join("\n"))
  assert.deepEqual(errors, [
    "6:39 TS2339 Property 'toUpperCase' does not exist on type 'number'.",
    "8:17 TS2322 Type 'string' is not assignable to type 'number'.",
  ])
})

// a JS file's object literal is open: reading a property it lacks is `any`,
// unless noImplicitAny. That is TypeScript's rule for JS, kept here - a name
// that doesn't exist is reported either way
test("…in a JavaScript component too, without checkJs: its store has the types TypeScript infers", async () => {
  const text = [
    `<script :setup>`,
    `  let todos = [{ text: "a", done: false }]`,
    `</script>`,
    `<li :each="todo in todos">{{ todo.txt }}</li>`,
    `<p>{{ todoz.length }}</p>`,
  ].join("\n")
  assert.deepEqual(await one(text, TYPED), ["5:7 TS2552 Cannot find name 'todoz'. Did you mean 'todos'?"])
  assert.deepEqual(await one(text, { ...TYPED, noImplicitAny: true }), [
    "4:35 TS2551 Property 'txt' does not exist on type '{ text: string; done: boolean; }'. Did you mean 'text'?",
    "5:7 TS2552 Cannot find name 'todoz'. Did you mean 'todos'?",
  ])
})

test("a store variable keeps its declared type, whatever control flow says at the end of the script", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  type User = { name: string }`,
    `  let user: User | null = null`,
    `  setTimeout(() => { user = { name: "Ada" } })`,
    `</script>`,
    `<p>{{ user?.name }}</p>`,
  ].join("\n"))
  assert.deepEqual(errors, [])
})

test("a top-level function is not on the store, as at runtime", async () => {
  const errors = await one(`<script :setup>\n  function save() {}\n  const reset = () => {}\n</script>\n<button @click="save" @dblclick="reset">s</button>`, TYPED)
  assert.deepEqual(errors, ["5:17 TS2304 Cannot find name 'save'."])
})

test(":each binds the item, the index or key, and $index - inside the element only", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  let rows = [{ id: 1, label: "a" }]`,
    `  let labels = { en: "hi" }`,
    `</script>`,
    `<li :each="row, i in rows" :key="row.id">{{ i.toFixed() }} {{ $index + 1 }} {{ row.label.toUpperCase() }}</li>`,
    `<li :each="(value, key) in labels">{{ key.toUpperCase() }} {{ value.toUpperCase() }}</li>`,
    `<p>{{ row }} {{ $index }}</p>`,
  ].join("\n"))
  assert.deepEqual(errors, [
    "7:7 TS2552 Cannot find name 'row'. Did you mean 'rows'?",
    "7:17 TS2304 Cannot find name '$index'.",
  ])
})

test("@event: $event typed by the event's name, an arrow's parameter by it too", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  let name = ""`,
    `  let x = 0`,
    `  const pick = (n: number) => n`,
    `</script>`,
    `<input @input="name = $event.target.value" @click="x = $event.clientX" @keydown="e => e.key.toUpperCase()" />`,
    `<div @changed="x = $event.detail" @click="x = $event.detail.foo"></div>`,
  ].join("\n"))
  // a click's detail is a number; a component's emit is a CustomEvent
  assert.deepEqual(errors, ["7:61 TS2339 Property 'foo' does not exist on type 'number'."])
})

test("an event on a component tag is its $emit: a CustomEvent", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  let last: unknown`,
    `</script>`,
    `<Stepper @changed="last = $event.detail" @click="last = $event.clientX" />`,
    `<template name="Stepper"><p></p></template>`,
  ].join("\n"))
  assert.deepEqual(errors, ["4:64 TS2339 Property 'clientX' does not exist on type '__Jq79Emitted'."])
})

test(":with puts the object's keys in scope, typed", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  let draft = { name: "", email: "" }`,
    `</script>`,
    `<fieldset :with="draft">`,
    `  <input @input="name = $event.target.value" />`,
    `  <p>{{ name.toUpperCase() }} {{ email.foo }}</p>`,
    `</fieldset>`,
  ].join("\n"))
  assert.deepEqual(errors, ["6:40 TS2339 Property 'foo' does not exist on type 'string'."])
})

test("a slot binder declares names for the content it fills", async () => {
  const errors = await one([
    `<script :setup lang="ts"></script>`,
    `<List :slot="{ item }">{{ item.name }}</List>`,
    `<List><template :slot.row="{ row }">{{ row }}</template>{{ item }}</List>`,
    `<template name="List"><slot :item="1"></slot></template>`,
  ].join("\n"))
  assert.deepEqual(errors, ["3:60 TS2304 Cannot find name 'item'."])
})

test("shorthand bindings and spreads read their name", async () => {
  const errors = await one([
    `<script :setup lang="ts">`,
    `  let user = { id: 1 }`,
    `</script>`,
    `<Card :user :usr ...user ...usr :model.user />`,
    `<template name="Card"><script :setup="_"></script></template>`,
  ].join("\n"))
  assert.deepEqual(errors, [
    "4:14 TS2552 Cannot find name 'usr'. Did you mean 'user'?",
    "4:29 TS2552 Cannot find name 'usr'. Did you mean 'user'?",
  ])
})

test("a component without a signature may get any name from its parent; one with a signature can't", async () => {
  const permissive = await one(`<script :setup="_">\n</script>\n<p>{{ title }}</p>`, TYPED)
  assert.deepEqual(permissive, [])
  const noScript = await one(`<p>{{ title }}</p>`, TYPED)
  assert.deepEqual(noScript, [])
  const closed = await one(`<script :setup="{ label }">\n</script>\n<p>{{ title }} {{ label }}</p>`, TYPED)
  assert.deepEqual(closed, ["3:7 TS2304 Cannot find name 'title'."])
})

test("each <template name> is checked against its own store", async () => {
  const errors = await one([
    `<script :setup>`,
    `  let tree = { label: "src" }`,
    `</script>`,
    `<Folder :node="tree" />`,
    `<template name="Folder">`,
    `  <script :setup="{ node }"></script>`,
    `  <span>{{ node.label }} {{ tree }}</span>`,
    `</template>`,
  ].join("\n"), TYPED)
  assert.deepEqual(errors, ["7:29 TS2304 Cannot find name 'tree'."])
})

test("a factory's returned bindings are typed in the template", async () => {
  const errors = await one([
    `<script lang="ts">`,
    `  export default ({}, { $data }) => {`,
    `    $data.count = 0`,
    `    const inc = (by: number) => { $data.count += by }`,
    `    return { inc }`,
    `  }`,
    `</script>`,
    `<button @click="inc(1)">{{ count }}</button>`,
    `<button @click="inc('x')"></button>`,
  ].join("\n"))
  assert.deepEqual(errors, ["9:21 TS2345 Argument of type 'string' is not assignable to parameter of type 'number'."])
})

test("not in comments, scripts or styles", async () => {
  const errors = await one([
    `<script :setup>let a = 1</script>`,
    `<!-- {{ nope }} <p :if="nope"></p> -->`,
    `<style>.a::after { content: "{{ nope }}" }</style>`,
    `<p>{{ a }}</p>`,
  ].join("\n"), TYPED)
  assert.deepEqual(errors, [])
})
