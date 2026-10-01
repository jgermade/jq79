// the language server as VS Code runs it: dist/server.js in a process of its
// own, spoken to over LSP. The checks themselves are check.mjs's; this is that
// the bundle starts, finds the plugin, and answers an editor's three requests
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const rpc = require("vscode-jsonrpc/node")

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dir = mkdtempSync(join(tmpdir(), "jq79-server-"))
const file = join(dir, "Counter.html")
const uri = pathToFileURL(file).href
const text = [
  `<script :setup="{ step = 1 }" lang="ts">`,
  `  let count = 0`,
  `  $: doubled = count * step`,
  `  count = "one"`,
  `  $em`,
  `</script>`,
  `<button @click="count += step">{{ doubled }}</button>`,
  `<p>{{ doubled.toUpperCase() }} {{ cou }}</p>`,
].join("\n")
writeFileSync(file, text)

// JQ79_SERVER: another build of it, such as the one unpacked from a .vsix
const serverPath = process.env.JQ79_SERVER ?? join(root, "dist/server.js")
const server = spawn(process.execPath, [serverPath, "--stdio"], { stdio: ["pipe", "pipe", "inherit"] })
const connection = rpc.createMessageConnection(new rpc.StreamMessageReader(server.stdout), new rpc.StreamMessageWriter(server.stdin))
connection.listen()
after(() => { connection.dispose(); server.kill() })

const ready = (async () => {
  await connection.sendRequest("initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(dir).href,
    workspaceFolders: [{ uri: pathToFileURL(dir).href, name: "test" }],
    capabilities: { textDocument: { diagnostic: {}, hover: { contentFormat: ["markdown", "plaintext"] }, completion: {} }, workspace: { configuration: true } },
    initializationOptions: {},
  })
  // the server asks for settings; an editor with none answers null for each
  connection.onRequest("workspace/configuration", params => params.items.map(() => null))
  connection.onRequest(() => null)
  connection.sendNotification("initialized", {})
  connection.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId: "html", version: 1, text } })
})()

test("diagnostics: the type error, where it is in the .html", async () => {
  await ready
  const report = await connection.sendRequest("textDocument/diagnostic", { textDocument: { uri } })
  const errors = report.items.filter(d => d.severity === 1).map(d => `${d.range.start.line}:${d.range.start.character} ${d.code}`)
  assert.ok(errors.includes("3:2 2322"), JSON.stringify(report.items, null, 1))
})

test("hover: the type TypeScript inferred for a $: target", async () => {
  await ready
  const hover = await connection.sendRequest("textDocument/hover", { textDocument: { uri }, position: { line: 2, character: 6 } })
  const shown = JSON.stringify(hover?.contents)
  assert.match(shown, /doubled: number/)
})

test("completion: the helpers are offered", async () => {
  await ready
  const list = await connection.sendRequest("textDocument/completion", { textDocument: { uri }, position: { line: 4, character: 5 } })
  const labels = (Array.isArray(list) ? list : list.items).map(item => item.label)
  assert.ok(labels.includes("$emit"), labels.slice(0, 20).join(", "))
})

test("the template: its errors, hover and completion come from the template's code", async () => {
  await ready
  const report = await connection.sendRequest("textDocument/diagnostic", { textDocument: { uri } })
  const errors = report.items.filter(d => d.severity === 1).map(d => `${d.range.start.line}:${d.range.start.character} ${d.code}`)
  assert.ok(errors.includes("7:14 2339"), JSON.stringify(report.items, null, 1))
  const hover = await connection.sendRequest("textDocument/hover", { textDocument: { uri }, position: { line: 6, character: 37 } })
  assert.match(JSON.stringify(hover?.contents), /doubled: number/)
  const list = await connection.sendRequest("textDocument/completion", { textDocument: { uri }, position: { line: 7, character: 37 } })
  const labels = (Array.isArray(list) ? list : list.items).map(item => item.label)
  assert.ok(labels.includes("count"), labels.slice(0, 20).join(", "))
})

// a name the script declares and the template reads is one name: renaming it
// on either side renames it on both, whatever the editor's alias setting
const renameFile = join(dir, "Rename.html")
const renameUri = pathToFileURL(renameFile).href
const renameText = [
  `<script :setup="{ step = 1 }">`,
  `  let count = 0`,
  `  let draft = { name: "" }`,
  `  const inc = () => { count += step }`,
  `</script>`,
  `<button @click="inc(); count++">{{ count }} × {{ step }}</button>`,
  `<fieldset :with="draft"><p>{{ name }}</p></fieldset>`,
].join("\n")
writeFileSync(renameFile, renameText)
const opened = ready.then(() => connection.sendNotification("textDocument/didOpen", { textDocument: { uri: renameUri, languageId: "html", version: 1, text: renameText } }))

const renamed = async (line, character) => {
  await opened
  const edit = await connection.sendRequest("textDocument/rename", { textDocument: { uri: renameUri }, position: { line, character }, newName: "total" })
  return (edit?.changes?.[renameUri] ?? []).map(e => `${e.range.start.line}:${e.range.start.character}`).sort()
}

const COUNT = ["1:6", "3:22", "5:23", "5:35"]

test("rename: from the script's declaration, the template's reads follow", async () => {
  assert.deepEqual(await renamed(1, 7), COUNT)
})

test("rename: from the template, the script's declaration and uses follow", async () => {
  assert.deepEqual(await renamed(5, 35), COUNT)
})

test("rename: a key a :with region reads is the object's property", async () => {
  assert.deepEqual(await renamed(6, 30), ["2:16", "6:30"])
})

test("definition and references: a template's name is the script's", async () => {
  await opened
  const def = await connection.sendRequest("textDocument/definition", { textDocument: { uri: renameUri }, position: { line: 5, character: 36 } })
  const defs = (Array.isArray(def) ? def : [def]).map(d => (d.targetUri ?? d.uri) === renameUri && (d.targetRange ?? d.range).start.line)
  assert.deepEqual(defs, [1])
  const refs = await connection.sendRequest("textDocument/references", { textDocument: { uri: renameUri }, position: { line: 1, character: 7 }, context: { includeDeclaration: true } })
  assert.deepEqual(refs.map(r => `${r.range.start.line}:${r.range.start.character}`).sort(), COUNT)
})

// the scripts of a component share their names (one store): a name one
// declares and another uses is renamed in both, and in the template
test("rename: across the scripts of one component", async () => {
  const file = join(dir, "TwoScripts.html")
  const uri = pathToFileURL(file).href
  const text = [
    `<script :setup>`,
    `  let count = 0`,
    `</script>`,
    `<script :mounted>`,
    `  count++`,
    `</script>`,
    `<p>{{ count }}</p>`,
  ].join("\n")
  writeFileSync(file, text)
  await opened
  connection.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId: "html", version: 1, text } })
  for (const [line, character] of [[4, 3], [1, 7], [6, 7]]) {
    const edit = await connection.sendRequest("textDocument/rename", { textDocument: { uri }, position: { line, character }, newName: "total" })
    const at = (edit?.changes?.[uri] ?? []).map(e => `${e.range.start.line}:${e.range.start.character}`).sort()
    assert.deepEqual(at, ["1:6", "4:2", "6:6"], `from ${line}:${character}`)
  }
})

test("rename: a prop is renamed in its component, the :setup pattern included", async () => {
  assert.deepEqual(await renamed(5, 51), ["0:18", "3:31", "5:49"])
})

// a script is the editor's TypeScript's: this server answers only inside a
// component literal, and says nothing about a script without one
test("a script: only its component literals are this server's", async () => {
  await opened
  const withLiteral = join(dir, "app.ts")
  const plain = join(dir, "plain.ts")
  const literalText = [
    `const wrong: number = "the editor says this"`,
    `const C = new Component79(\`<script :setup>let count = 0</script><p>{{ cuont }}</p>\`)`,
  ].join("\n")
  const plainText = `const wrong: number = "and this"\n`
  writeFileSync(withLiteral, literalText)
  writeFileSync(plain, plainText)
  for (const [file, text] of [[withLiteral, literalText], [plain, plainText]]) {
    connection.sendNotification("textDocument/didOpen", { textDocument: { uri: pathToFileURL(file).href, languageId: "typescript", version: 1, text } })
  }
  const report = async file => (await connection.sendRequest("textDocument/diagnostic", { textDocument: { uri: pathToFileURL(file).href } })).items
    .map(d => `${d.range.start.line}:${d.range.start.character} ${d.code}`)
  assert.deepEqual(await report(withLiteral), [`1:${literalText.split("\n")[1].indexOf("cuont")} 2552`])
  assert.deepEqual(await report(plain), [])
  const hover = await connection.sendRequest("textDocument/hover", { textDocument: { uri: pathToFileURL(withLiteral).href }, position: { line: 1, character: literalText.split("\n")[1].indexOf("count") + 1 } })
  assert.match(JSON.stringify(hover?.contents), /count: number/)
  const outside = await connection.sendRequest("textDocument/hover", { textDocument: { uri: pathToFileURL(withLiteral).href }, position: { line: 0, character: 7 } })
  assert.equal(outside, null)
})

// ------------------------------------------------------------------ completion and hover in tags

const tagsFile = join(dir, "Tags.html")
const tagsUri = pathToFileURL(tagsFile).href
const tagsLines = [
  `<script :setup lang="ts">`,
  `  let items = [1]`,
  `</script>`,
  `<li :key="1" :></li>`,
  `<button @></button>`,
  `<button @click.></button>`,
  `<Card :title="'x'" :></Card>`,
  `<C></C>`,
  `<template name="Card">`,
  `  <script :setup="{ title, count = 0 }: { title: string; count?: number }" lang="ts"></script>`,
  `  <p :each="i in items">{{ title }}</p><button @click="$emit('picked', 1)"></button><slot.header></slot.header>`,
  `</template>`,
  `<script ></script>`,
  `<Card @></Card>`,
  `<Card><template :></template></Card>`,
  `<template ></template>`,
]
const tagsText = tagsLines.join("\n")
writeFileSync(tagsFile, tagsText)
const tagsOpened = ready.then(() => connection.sendNotification("textDocument/didOpen", { textDocument: { uri: tagsUri, languageId: "html", version: 1, text: tagsText } }))

// what is offered right after `marker` on `line`, as label → [detail, inserted text]
const offered = async (line, marker) => {
  await tagsOpened
  const character = tagsLines[line].indexOf(marker) + marker.length
  const list = await connection.sendRequest("textDocument/completion", { textDocument: { uri: tagsUri }, position: { line, character } })
  const items = Array.isArray(list) ? list : list?.items ?? []
  return Object.fromEntries(items.filter(i => i.detail?.startsWith("jq79") || i.kind === 10 || i.kind === 7).map(i => [i.label, [i.detail, i.textEdit?.newText ?? i.insertText]]))
}

test("completion: the directives, in an element's tag, as snippets - and not one already there", async () => {
  const items = await offered(3, `:key="1" :`)
  assert.deepEqual(items[":each"], ["jq79", ':each="${1:item} in ${2:items}"'])
  assert.deepEqual(items[":if"], ["jq79", ':if="$1"'])
  assert.equal(items[":key"], undefined)
  assert.equal(items[":model"], undefined, "a component's, not an element's")
})

test("completion: events, and after a dot their modifiers", async () => {
  assert.deepEqual((await offered(4, "@"))["@click"], ["jq79 event", '@click="$1"'])
  const modifiers = await offered(5, "@click.")
  assert.deepEqual(Object.keys(modifiers).sort(), ["@click.capture", "@click.once", "@click.prevent", "@click.self", "@click.stop"])
})

test("completion: a component's props, typed, from its signature - and not one already there", async () => {
  const items = await offered(6, `:title="'x'" :`)
  assert.deepEqual(items[":count"], ["count?: number", ':count="$1"'])
  assert.equal(items[":title"], undefined)
  assert.ok(items[":model"] && items[":if"])
})

test("completion: the components in scope, after <", async () => {
  assert.deepEqual((await offered(7, "<C"))["Card"], ["component", "Card"])
})

test("completion: a script's attributes; and nothing of jq79's in a script's code", async () => {
  assert.ok((await offered(12, "<script "))[":setup"])
  assert.deepEqual(await offered(1, "  let "), {})
})

test("hover: a directive says what it does", async () => {
  await tagsOpened
  const hover = await connection.sendRequest("textDocument/hover", { textDocument: { uri: tagsUri }, position: { line: 10, character: tagsLines[10].indexOf(":each") + 2 } })
  assert.match(hover?.contents?.value ?? "", /\*\*:each\*\* - Renders the element once per item/)
})

test("completion in an expression: the store's names, not the virtual code's own", async () => {
  await tagsOpened
  const character = tagsLines[10].indexOf("{{ ") + 3
  const list = await connection.sendRequest("textDocument/completion", { textDocument: { uri: tagsUri }, position: { line: 10, character } })
  const labels = (Array.isArray(list) ? list : list.items).map(item => item.label)
  assert.ok(labels.includes("title") && labels.includes("count") && labels.includes("$emit"), labels.slice(0, 30).join(", "))
  assert.ok(!labels.includes("items"), "the file's own component's, not Card's")
  const scaffolding = labels.filter(label => /^__|^\$__/.test(label))
  assert.deepEqual(scaffolding, [])
})

test("completion: what a component emits, on its tag", async () => {
  const items = await offered(13, "<Card @")
  assert.deepEqual(items["@picked"], ["jq79 emitted event", '@picked="$1"'])
  assert.equal(items["@click"], undefined, "a DOM event never reaches a component's tag")
})

test("completion: a component's named slots, on a <template> in its tag; `name` only at the top", async () => {
  assert.deepEqual((await offered(14, "<Card><template :"))[":slot.header"], ["jq79 slot", ":slot.header"])
  assert.equal((await offered(14, "<Card><template :"))["name"], undefined)
  assert.ok((await offered(15, "<template "))["name"])
})

// a literal's tags get the same, through its own text: the script's own code
// is still the editor's TypeScript's
test("completion in a literal, in a script and in a page", async () => {
  await tagsOpened
  const ask = async (file, languageId, text, marker) => {
    const uri = pathToFileURL(join(dir, file)).href
    writeFileSync(join(dir, file), text)
    connection.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } })
    const line = text.split("\n").findIndex(l => l.includes(marker))
    const character = text.split("\n")[line].indexOf(marker) + marker.length
    const list = await connection.sendRequest("textDocument/completion", { textDocument: { uri }, position: { line, character } })
    return (Array.isArray(list) ? list : list?.items ?? []).map(i => i.label)
  }
  const script = [
    "const Row = new Component79(`",
    "  <script :setup>let rows = [1]</script>",
    "  <li :key=\"1\" :></li>",
    "  <Ro></Ro>",
    "  <template name=\"Rows\"><script :setup=\"{ count }\"></script></template>",
    "`)",
  ].join("\n")
  assert.ok((await ask("lit.js", "javascript", script, `:key="1" :`)).includes(":each"))
  assert.ok((await ask("lit2.js", "javascript", script.replace(`<li :key="1" :></li>`, "<Rows :></Rows>"), "<Rows :")).includes(":count"))
  assert.ok((await ask("lit3.js", "javascript", script, "<Ro")).includes("Rows"))
  // outside the literal: nothing of jq79's
  const outside = await ask("lit4.js", "javascript", script + "\nconst x = 1 ", "const x = 1 ")
  assert.ok(!outside.includes(":each"))
  const page = ["<!doctype html>", "<script type=\"module\">", "  new Component79(`<p :></p>`)", "</script>"].join("\n")
  assert.ok((await ask("page.html", "html", page, "<p :")).includes(":if"))
})

test("completion: the props of a component that arrives as a prop, declared with Component<P>", async () => {
  await tagsOpened
  // a project with jq79 installed, as far as these types go (the real ones
  // are held to it in check.mjs): without it, Component<P> is any
  const project = join(dir, "with-jq79")
  mkdirSync(join(project, "node_modules/jq79"), { recursive: true })
  writeFileSync(join(project, "node_modules/jq79/package.json"), JSON.stringify({ name: "jq79", types: "index.d.ts" }))
  writeFileSync(join(project, "node_modules/jq79/index.d.ts"),
    `export declare class Component79 { mount(target: Element): this }\nexport type Component<P = any> = Component79 & { readonly "~props"?: (props: P) => void }\n`)
  const file = join(project, "Toolbar.html")
  const uri = pathToFileURL(file).href
  const lines = [
    `<script :setup="{ Button }: { Button: Component<{ label: string; size?: number }> }" lang="ts">`,
    `  import type { Component } from "jq79"`,
    `</script>`,
    `<Button :></Button>`,
  ]
  writeFileSync(file, lines.join("\n"))
  connection.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId: "html", version: 1, text: lines.join("\n") } })
  const list = await connection.sendRequest("textDocument/completion", { textDocument: { uri }, position: { line: 3, character: lines[3].indexOf(":") + 1 } })
  const props = Object.fromEntries((Array.isArray(list) ? list : list.items).filter(i => i.kind === 10).map(i => [i.label, i.detail]))
  assert.deepEqual(props, { ":label": "label: string", ":size": "size?: number" })
})
