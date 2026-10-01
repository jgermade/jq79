// the language server as VS Code runs it: dist/server.js in a process of its
// own, spoken to over LSP. The checks themselves are check.mjs's; this is that
// the bundle starts, finds the plugin, and answers an editor's three requests
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
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
