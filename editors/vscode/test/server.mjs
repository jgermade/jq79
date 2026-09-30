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
