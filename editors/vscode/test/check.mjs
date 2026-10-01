// the language server's checks, run through jq79-check's checker (the same
// language plugin, the same services): what the virtual code has to get right
// is in src/component.ts, and each row of it is a test here.
// Needs the build: `npm test` runs it first
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { createChecker, findComponents, INFERRED_OPTIONS } = require("../dist/check.js")
const { generate } = require("../dist/component.js")
const { generateTemplate } = require("../dist/template.js")
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
  // an .html, or a script with a component literal in it (as findComponents)
  const checked = paths.filter(p => p.endsWith(".html") || /(?:Component79|C79|parseComponent)\s*\(\s*`/.test(files[relative(dir, p)]))
  const checker = createChecker(checked, options)
  const out = {}
  for (const path of checked) {
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
// it (DOM_TYPING, below)
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
      if (d.severity === 1 || d.severity === 2) found.push({ d, file, line: `${relative(repo, file)}:${d.range.start.line + 1} TS${d.code} ${d.message}` })
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

// and a solution's import of a component the tutorial serves from elsewhere:
// the exercise's own files, one folder up (a solution is mounted over them),
// or the shared examples in tutorial/_app/ - a layout of the tutorial's that
// the filesystem doesn't have. In JavaScript, an unresolved import is only
// reported under checkJs
const exerciseFile = ({ d, file }) => {
  const missing = /Cannot find module '\.\/([^']+)'/.exec(d.message)?.[1]
  return d.code === 2307 && file.includes("/solution/") && !!missing &&
    (existsSync(join(dirname(file), "..", missing)) || existsSync(join(repo, "tutorial/_app", missing)))
}

// what checkJs adds beyond those is DOM typing that is plain TypeScript's: a
// textarea found by its class is an HTMLElement until it is said to be more
// (RECORD/2026-10-01.typed-queries.md), and a ChildNode has no outerHTML.
// Before $self was typed like querySelector's tag-name overloads, with an
// HTMLElement default, two more were here: `.focus()` and `.blur()` on Element
const DOM_TYPING = [
  "tutorial/_app/components/Editor.html:24 TS2339 Property 'value' does not exist on type 'HTMLElement'.",
  "tutorial/_app/components/Editor.html:24 TS2339 Property 'value' does not exist on type 'HTMLElement'.",
  "tutorial/_app/components/Output.html:63 TS2339 Property 'outerHTML' does not exist on type 'ChildNode'.",
]

test("…and with checkJs, only DOM typing is added", async () => {
  const found = (await corpus({ ...TYPED, checkJs: true }))
    .filter(f => !exerciseFile(f))
    .map(f => f.line)
  assert.deepEqual(found.sort(), [...EXERCISES, ...DOM_TYPING].sort())
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
  const { code, mappings, links } = generate(ts, text)
  for (const m of mappings) {
    const source = text.slice(m.sourceOffsets[0], m.sourceOffsets[0] + m.lengths[0])
    const generated = code.slice(m.generatedOffsets[0], m.generatedOffsets[0] + m.lengths[0])
    assert.equal(generated, source)
  }
  // and the two ends of every link are one name (a rename goes on from one
  // to the other), in the scripts' code and the template's
  const template = generateTemplate(ts, text, "./c.html")
  for (const [linked, generatedCode] of [[links, code], [template.links, template.code]]) {
    assert.ok(linked.length > 0)
    for (const l of linked) {
      const a = generatedCode.slice(l.sourceOffsets[0], l.sourceOffsets[0] + l.lengths[0])
      const b = generatedCode.slice(l.generatedOffsets[0], l.generatedOffsets[0] + l.lengths[0])
      assert.equal(a, b)
      assert.match(a, /^[A-Za-z_$][\w$]*$/)
    }
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

// ------------------------------------------------------------------ props against the child's signature

const ROW = `<template name="Row">\n  <script :setup="{ label, count = 0, onPick }: RowProps" lang="ts">\n    interface RowProps { label: string; count?: number; onPick?: (id: number) => void }\n  </script>\n  <p>{{ label }}</p>\n</template>`

test("a prop is checked against the type the child declares", async () => {
  const errors = await one([
    `<script :setup lang="ts">let n = 1</script>`,
    `<Row :label="n" :count="n" />`,
    `<Row label="plain" count="3" />`,
    `<Row :on-pick="id => id.toUpperCase()" />`,
    ROW,
  ].join("\n"))
  assert.deepEqual(errors, [
    "2:7 TS2322 Type 'number' is not assignable to type 'string'.",
    "3:20 TS2322 Type 'string' is not assignable to type 'number'.",
    "4:25 TS2339 Property 'toUpperCase' does not exist on type 'number'.",
  ])
})

test("a prop the child doesn't declare is reported where it is written; a missing one is not", async () => {
  const errors = await one([
    `<script :setup lang="ts"></script>`,
    `<Row :lable="'x'" class="wide" />`,
    `<Row />`,
    ROW,
  ].join("\n"))
  assert.equal(errors.length, 2, errors.join("\n"))
  assert.match(errors[0], /^2:7 TS2561 .*'lable' does not exist.*Did you mean to write 'label'/)
  assert.match(errors[1], /^2:19 TS2353 .*'class' does not exist/)
})

test("a kebab prop is its camelCase name, reported on the attribute", async () => {
  const errors = await one([
    `<script :setup lang="ts"></script>`,
    `<Card :user-name="1" :user-nmae="'x'" />`,
    `<template name="Card"><script :setup="{ userName }: { userName: string }" lang="ts"></script></template>`,
  ].join("\n"))
  assert.equal(errors.length, 2, errors.join("\n"))
  assert.match(errors[0], /^2:8 TS2322 Type 'number' is not assignable to type 'string'/)
  assert.match(errors[1], /^2:23 TS2561 .*'userNmae' does not exist.*Did you mean to write 'userName'/)
})

test("a JavaScript child's props are what its pattern infers", async () => {
  const errors = await one([
    `<script :setup></script>`,
    `<Counter :step="'two'" :start="1" />`,
    `<template name="Counter"><script :setup="{ step = 1 }"></script></template>`,
  ].join("\n"), TYPED)
  assert.equal(errors.length, 2, errors.join("\n"))
  assert.match(errors[0], /^2:11 TS2322 Type 'string' is not assignable to type 'number'/)
  assert.match(errors[1], /^2:25 TS2353 .*'start' does not exist/)
})

test("a closed signature takes no props, a permissive one takes any", async () => {
  const errors = await one([
    `<script :setup></script>`,
    `<Closed :a="1" />`,
    `<Open :a="1" anything="x" />`,
    `<template name="Closed"><script :setup></script></template>`,
    `<template name="Open"><script :setup="_"></script></template>`,
  ].join("\n"), TYPED)
  assert.equal(errors.length, 1, errors.join("\n"))
  assert.match(errors[0], /^2:10 TS2353 .*'a' does not exist/)
})

test("spreads narrow, :model binds a prop, and directives aren't props", async () => {
  const errors = await one([
    `<script :setup lang="ts">let sdk = { label: "x", extra: 1 }; let rows = [1]; let v = "a"</script>`,
    `<Row ...sdk :props="sdk" />`,
    `<Row :each="r in rows" :key="r" :if="r" :class="'a'" :model.label="v" />`,
    `<Row :model.count="v" />`,
    ROW,
  ].join("\n"))
  assert.deepEqual(errors, ["4:13 TS2322 Type 'string' is not assignable to type 'number'."])
})

test("a component imported from another file carries its props", async () => {
  const errors = await check({
    "app.html": [
      `<script :setup lang="ts">`,
      `  const Card = await import("./Card.html")`,
      `  const Crad = await import("./Crad.html")`,
      `</script>`,
      `<Card :title="1" />`,
    ].join("\n"),
    "factory.html": [
      `<script lang="ts">`,
      `  import Card from "./Card.html"`,
      `  export default () => ({ Card })`,
      `</script>`,
      `<Card :titel="'x'" />`,
    ].join("\n"),
    "Card.html": `<script :setup="{ title }: { title: string }" lang="ts"></script><h2>{{ title }}</h2>`,
  })
  assert.deepEqual(errors["app.html"].map(e => e.split(" ").slice(0, 2).join(" ")), ["3:29 TS2307", "5:8 TS2322"])
  assert.match(errors["factory.html"][0], /^5:8 TS2561 .*'titel' does not exist.*Did you mean to write 'title'/)
  assert.deepEqual(errors["Card.html"], [])
})

test("a factory child's props are the names its first parameter declares", async () => {
  const errors = await one([
    `<script :setup></script>`,
    `<Badge :label="1" :lable="2" />`,
    `<template name="Badge"><script>export default ({ label }, { $data }) => {}</script></template>`,
  ].join("\n"), TYPED)
  assert.equal(errors.length, 1, errors.join("\n"))
  assert.match(errors[0], /^2:20 TS2561 .*'lable' does not exist.*Did you mean to write 'label'/)
})

test("a tag that names nothing in scope", async () => {
  const closed = await one(`<script :setup></script>\n<Buton :a="1" />\n<Button /><template name="Button"></template>`, TYPED)
  assert.deepEqual(closed, ["2:2 TS2552 Cannot find name 'Buton'. Did you mean 'Button'?"])
  // a parent may pass a component to a permissive one
  assert.deepEqual(await one(`<script :setup="_"></script>\n<Buton :a="1" />`, TYPED), [])
})

// ------------------------------------------------------------------ components written as literals

test("a component literal in a script is checked like an .html file, and nothing else in the script is", async () => {
  const errors = await check({
    "app.ts": [
      `import { Component79, parseComponent, C79 } from "jq79"`,
      `const wrong: number = "outside a literal: the editor's TypeScript says this, not jq79"`,
      `const Counter = new Component79(\``,
      `  <script :setup="{ step = 1 }: { step?: number }" lang="ts">`,
      `    let count: number = "zero"`,
      `  </script>`,
      `  <button @click="count += step">{{ cuont }}</button>`,
      `\`)`,
      `const Hello = parseComponent(\`<p>{{ helo }}</p><script :setup>let hello = 1</script>\`)`,
      `const Alias = new C79(\`<script :setup></script><p>{{ x }}</p>\`)`,
    ].join("\n"),
  }, { ...STRICT, allowImportingTsExtensions: true })
  assert.deepEqual(errors["app.ts"], [
    "5:9 TS2322 Type 'string' is not assignable to type 'number'.",
    "7:37 TS2552 Cannot find name 'cuont'. Did you mean 'count'?",
    "9:37 TS2552 Cannot find name 'helo'. Did you mean 'hello'?",
    "10:54 TS2304 Cannot find name 'x'.",
  ])
})

test("a literal's escapes are the characters they write, and positions after them still land", async () => {
  const errors = await check({
    "app.js": "new Component79(`<script :setup>let a = 1</script><p title=\"\\`q\\`\">\\u0041 {{ b }}</p>`)\n",
  }, TYPED)
  assert.deepEqual(errors["app.js"], ["1:78 TS2304 Cannot find name 'b'."])
})

test("a literal with ${…} in it isn't read: what it holds depends on what runs", async () => {
  const errors = await check({ "app.js": "const x = 1\nnew Component79(`<script :setup></script><p>${x}{{ nope }}</p>`)\n" }, TYPED)
  assert.deepEqual(errors["app.js"], [])
})

// a page's <script> can't hold `</script>`: the browser ends the script there,
// so a component in one writes `<\/script>`, which the literal cooks back
test("a page's scripts: the literals they hand to Component79", async () => {
  const line = `  new Component79(\`<script :setup>let items = [1]<\\/script><li :each="i in itms">{{ i }}</li>\`).mount(document.body)`
  const errors = await check({
    "index.html": [`<!doctype html>`, `<script type="module">`, `  import { Component79 } from "jq79"`, line, `</script>`].join("\n"),
  }, TYPED)
  assert.deepEqual(errors["index.html"], [`4:${line.indexOf("itms") + 1} TS2552 Cannot find name 'itms'. Did you mean 'items'?`])
})

test("components of one literal see each other, and their props are checked", async () => {
  const errors = await check({
    "app.js": [
      "new Component79(`",
      "  <script :setup></script>",
      "  <Row :label=\"1\" :lable=\"2\" />",
      "  <template name=\"Row\"><script :setup=\"{ label }\"></script>{{ label }}</template>",
      "`)",
    ].join("\n"),
  }, TYPED)
  assert.equal(errors["app.js"].length, 1, errors["app.js"].join("\n"))
  assert.match(errors["app.js"][0], /^3:20 TS2561 .*'lable'/)
})

test("cook: a literal's text and where each character is in the file", () => {
  const { cook } = require("../dist/literal.js")
  const raw = "a\\`b\\nc\\u0041\\\nd\r\ne"
  const { text, at } = cook(raw, 10)
  assert.equal(text, "a`b\ncA" + "d\ne")
  assert.deepEqual(at, [10, -1, 13, -1, 16, -1, 25, -1, 28])
})

test("a literal's mount data is in its scope, where the code says what it is", async () => {
  const first = "new Component79(`<script :setup></script><p>{{ msg }} {{ nope }}</p>`).on('x', () => {}).mount(document.body, { msg: 'hi' })"
  const errors = await check({
    "app.js": [first, "new Component79(`<script :setup></script><p>{{ title }}</p>`).render({ title: 'x' })"].join("\n"),
  }, TYPED)
  assert.deepEqual(errors["app.js"], [`1:${first.indexOf("nope") + 1} TS2304 Cannot find name 'nope'.`])
})

test("a factory's props are in its template's scope, as at runtime", async () => {
  const errors = await one([
    `<script>export default ({ label = "Total" }) => ({ ready: true })</script>`,
    `<p>{{ label }} {{ ready }} {{ lable }}</p>`,
  ].join("\n"), TYPED)
  // and naming a prop is declaring a signature: a name it neither takes nor
  // returns is an error
  assert.deepEqual(errors, ["2:31 TS2552 Cannot find name 'lable'. Did you mean 'label'?"])
})

test("a component without a signature: `{ active }` may be a prop too", async () => {
  assert.deepEqual(await one(`<div :class="[theme, { active }]"></div>`, TYPED), [])
})

test("a factory with the pre-0.4 signature doesn't stop the checker", async () => {
  const other = `<template name="Other"><script :setup>let x = 1</script>{{ y }}</template>`
  const errors = await one([`<script>export default ({ $data }) => { $data.count = 0 }</script>`, `<p>{{ count }}</p>`, other].join("\n"), TYPED)
  assert.deepEqual(errors, [`3:${other.indexOf("y }}") + 1} TS2304 Cannot find name 'y'.`])
})

// ------------------------------------------------------------------ character references

// the runtime reads a value or a text after the HTML parser decoded it, so
// the checker does too - with src/html.ts's decoder, precompile's own
test("&amp; and friends in an attribute or a text are the characters they write", async () => {
  const errors = await one([
    `<script :setup>let count = 1; let ready = true</script>`,
    `<p :if="ready &amp;&amp; count &gt; 0">{{ count &lt; 10 ? &quot;few&quot; : "many" }}</p>`,
    `<p :title="ready &amp;&amp; cuont">x</p>`,
  ].join("\n"), TYPED)
  const line = `<p :title="ready &amp;&amp; cuont">x</p>`
  assert.deepEqual(errors, [`3:${line.indexOf("cuont") + 1} TS2552 Cannot find name 'cuont'. Did you mean 'count'?`])
})

test("the :setup pattern as the Vite plugin writes it: &quot; is a quote", async () => {
  const line = `<p>{{ label.toFixed() }}</p>`
  const errors = await one([`<script :setup="{ label = &quot;Total&quot; }: { label?: string }" lang="ts"></script>`, line].join("\n"))
  assert.deepEqual(errors, [`2:${line.indexOf("toFixed") + 1} TS2551 Property 'toFixed' does not exist on type 'string'. Did you mean 'fixed'?`])
})

test("a reference that writes {{ makes an interpolation, as it does at runtime", async () => {
  const errors = await one(`<script :setup></script>\n<p>&#123;&#123; nope }}</p>`, TYPED)
  assert.deepEqual(errors, ["2:17 TS2304 Cannot find name 'nope'."])
})

test("decodeAt: html.ts's decoding, attribute rule included, with where each part is", () => {
  const { decodeAt } = require("../dist/entities.js")
  assert.equal(decodeAt("x &amp; y ?a=1&copy=2", 0, true).text, "x & y ?a=1&copy=2")
  assert.equal(decodeAt("x &amp; y ?a=1&copy=2", 0, false).text, "x & y ?a=1©=2")
  const { segments } = decodeAt("a&lt;b", 10, true)
  assert.deepEqual(segments.map(s => [s.start, s.end, s.text, s.plain]), [[10, 11, "a", true], [11, 15, "<", false], [15, 16, "b", true]])
})

// `&#110;ope` is `nope`: the name starts on the character the reference wrote,
// and the error starts on the reference
test("an error on a character a reference wrote lands on the reference", async () => {
  const line = `<p>{{ &#110;ope }}</p>`
  const errors = await one(`<script :setup></script>\n${line}`, TYPED)
  assert.deepEqual(errors, [`2:${line.indexOf("&#110;") + 1} TS2304 Cannot find name 'nope'.`])
})

// ------------------------------------------------------------------ $ and $self

// typed as querySelector's overloads are, with an HTMLElement default
// (RECORD/2026-10-01.typed-queries.md): $ from the library's own source, $self
// from the checker's copy of it - and the two must agree
test("$ and $self: a tag name gives its element, anything else an HTMLElement unless told", async () => {
  const lines = [
    `<script :setup lang="ts">`,
    `  await $mounted()`,
    `  $self(".search")?.focus()`,
    `  const q: string | undefined = $self("input")?.value`,
    `  const r = $self("circle")?.r`,
    `  const v: string | undefined = $self<HTMLInputElement>(".q")?.value`,
    `  const items: HTMLLIElement[] = $$self("li")`,
    `  const doc: HTMLSelectElement | null = $("select")`,
    `  const all: HTMLElement[] = $$(".row")`,
    `  $self(".search")?.value`,
    `  $(".search")?.value`,
    `</script>`,
  ]
  const errors = await one(lines.join("\n"))
  assert.deepEqual(errors, [
    `10:${lines[9].indexOf("value") + 1} TS2339 Property 'value' does not exist on type 'HTMLElement'.`,
    `11:${lines[10].indexOf("value") + 1} TS2339 Property 'value' does not exist on type 'HTMLElement'.`,
  ])
})

test("…and a factory's ctx.$self the same", async () => {
  const errors = await one([
    `<script lang="ts">`,
    `  export default (_, { $self, $$self }) => {`,
    `    $self(".x")?.focus()`,
    `    const inputs: HTMLInputElement[] = $$self("input")`,
    `  }`,
    `</script>`,
  ].join("\n"))
  assert.deepEqual(errors, [])
})

// ------------------------------------------------------------------ a factory's props, typed

test("a factory child's props have the types its first parameter gives them", async () => {
  const lines = [
    `<script :setup></script>`,
    `<Badge :label="1" :count="'any'" />`,
    `<Counter :step="'two'" />`,
    `<template name="Badge"><script>export default ({ label = "Total", count }) => ({})</script></template>`,
    `<template name="Counter"><script lang="ts">`,
    `  interface Props { step: number }`,
    `  export default ({ step }: Props, { $data }) => { $data.n = step }`,
    `</script></template>`,
  ]
  const errors = await one(lines.join("\n"), TYPED)
  assert.deepEqual(errors, [
    `2:${lines[1].indexOf("label") + 1} TS2322 Type 'number' is not assignable to type 'string'.`,
    `3:${lines[2].indexOf("step") + 1} TS2322 Type 'string' is not assignable to type 'number'.`,
  ])
})

test("…and in its own template, as they are bound", async () => {
  const lines = [
    `<script>export default ({ label = "Total", user: who }) => ({ ready: true })</script>`,
    `<p>{{ label.toFixed() }} {{ user }} {{ ready.toUpperCase() }}</p>`,
  ]
  const errors = await one(lines.join("\n"), TYPED)
  assert.deepEqual(errors, [
    `2:${lines[1].indexOf("toFixed") + 1} TS2551 Property 'toFixed' does not exist on type 'string'. Did you mean 'fixed'?`,
    `2:${lines[1].indexOf("toUpperCase") + 1} TS2339 Property 'toUpperCase' does not exist on type 'boolean'.`,
  ])
})

// ------------------------------------------------------------------ a component that arrives as a prop

// its signature declares what it takes, with jq79's Component<P>, and both the
// child's tags and the parents that pass one are held to it
// (RECORD/2026-10-01.component-as-prop.md)
const TOOLBAR = [
  `<template name="Toolbar">`,
  `  <script :setup="{ Button }: { Button: Component<{ label: string }> }" lang="ts">`,
  `    import type { Component } from "jq79"`,
  `  </script>`,
  `  <Button :label="1" /><Button :lable="'x'" /><Button :label="'ok'" />`,
  `</template>`,
]

test("a component prop declared with Component<P>: the child's tags are checked against P", async () => {
  const lines = [`<script :setup lang="ts"></script>`, ...TOOLBAR]
  const errors = await one(lines.join("\n"))
  const tags = lines[5]
  assert.equal(errors.length, 2, errors.join("\n"))
  assert.equal(errors[0], `6:${tags.indexOf(":label") + 2} TS2322 Type 'number' is not assignable to type 'string'.`)
  assert.match(errors[1], new RegExp(`^6:${tags.indexOf(":lable") + 2} TS2561 .*'lable'`))
})

test("…and what a parent passes for it has to take P", async () => {
  const lines = [
    `<script :setup lang="ts"></script>`,
    `<Toolbar :Button="Wide" /><Toolbar :Button="Numeric" /><Toolbar :Button="Titled" />`,
    `<template name="Wide"><script :setup="{ label, size }: { label: string; size?: number }" lang="ts"></script></template>`,
    `<template name="Numeric"><script :setup="{ label }: { label: number }" lang="ts"></script></template>`,
    `<template name="Titled"><script :setup="{ label, title }: { label: string; title: string }" lang="ts"></script></template>`,
    ...TOOLBAR.map(line => line.replace(`<Button :label="1" /><Button :lable="'x'" />`, "")),
  ]
  const errors = await one(lines.join("\n"))
  const tags = lines[1]
  // Wide takes more than Toolbar passes it, optionally: fine. Numeric types
  // label otherwise, Titled requires a title Toolbar never passes
  assert.deepEqual(errors, [
    `2:${tags.indexOf(`:Button="Numeric"`) + 2} TS2322 Type 'Jq79Component<{ label: number; }, never, never>' is not assignable to type 'Component<{ label: string; }> | undefined'.`,
    `2:${tags.indexOf(`:Button="Titled"`) + 2} TS2322 Type 'Jq79Component<{ label: string; title: string; }, never, never>' is not assignable to type 'Component<{ label: string; }> | undefined'.`,
  ])
})

// Component<P, E, S>: Toolbar listens for "pressed" and fills slot "icon", so
// what a parent passes has to emit and render at least those
test("a component prop's events and slots: what a parent passes has to have them", async () => {
  const lines = [
    `<script :setup lang="ts"></script>`,
    `<Toolbar :Button="Full" /><Toolbar :Button="Mute" /><Toolbar :Button="Bare" /><Toolbar :Button="Any" />`,
    `<template name="Full"><button @click="$emit('pressed')" @focus="$emit('focused', 1)"><slot.icon /><slot.extra /></button></template>`,
    `<template name="Mute"><button><slot.icon /></button></template>`,
    `<template name="Bare"><button @click="$emit('pressed')"></button></template>`,
    `<template name="Any"><script :setup lang="ts">const name = "pressed"</script><button @click="$emit(name)"><slot.icon /></button></template>`,
    `<template name="Toolbar">`,
    `  <script :setup="{ Button }: { Button: Component<{}, 'pressed', 'icon'> }" lang="ts">`,
    `    import type { Component } from "jq79"`,
    `  </script>`,
    `</template>`,
  ]
  const errors = await one(lines.join("\n"))
  const tags = lines[1]
  // Full emits and renders more: fine. Mute never emits "pressed", Bare
  // renders no icon. Any's emit is computed: it may emit anything
  const to = `is not assignable to type 'Component<{}, "pressed", "icon"> | undefined'.`
  assert.deepEqual(errors, [
    `2:${tags.indexOf(`:Button="Mute"`) + 2} TS2322 Type 'Jq79Component<any, never, "icon">' ${to}`,
    `2:${tags.indexOf(`:Button="Bare"`) + 2} TS2322 Type 'Jq79Component<any, "pressed", never>' ${to}`,
  ])
})

test("a slot written kebab-case is the camelCase one a Component<P, E, S> names", async () => {
  const errors = await one([
    `<script :setup lang="ts"></script>`,
    `<Toolbar :Button="Card" />`,
    `<template name="Card"><slot.header-bar /></template>`,
    `<template name="Toolbar"><script :setup="{ Button }: { Button: Component<{}, never, 'headerBar'> }" lang="ts">import type { Component } from "jq79"</script></template>`,
  ].join("\n"))
  assert.deepEqual(errors, [])
})

test("a component prop declared without a type is still anything", async () => {
  const errors = await one([`<script :setup lang="ts"></script>`, `<template name="Toolbar"><script :setup="{ Button }"></script><Button :anything="1" /></template>`].join("\n"))
  assert.deepEqual(errors, [])
})

// a project without jq79 installed (it loads it from a CDN, say): a type can't
// name it there, and must not try - an unresolved import is an error type,
// which turns a component's props into any. They are checked all the same
test("without jq79 installed, an imported component's props are still checked", async () => {
  const errors = await check({
    "app.html": `<script :setup lang="ts">\n  const Card = await import("./Card.html")\n</script>\n<Card :title="1" />`,
    "Card.html": `<script :setup="{ title }: { title: string }" lang="ts"></script><h2>{{ title }}</h2>`,
  }, { ...INFERRED_OPTIONS, strict: true })
  assert.deepEqual(errors["app.html"], ["4:8 TS2322 Type 'number' is not assignable to type 'string'."])
})
