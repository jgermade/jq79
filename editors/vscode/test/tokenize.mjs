// VS Code's own grammars (see fetch-grammars.mjs) plus this extension's
// injections, wired the way VS Code wires them: each injection is offered to
// the top-level grammars its package.json `injectTo` names, and nowhere else.
// So a test that tokenizes through here is a test of the manifest too
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { GRAMMARS, grammarPath } from "./fetch-grammars.mjs"

const require = createRequire(import.meta.url)
const vsctm = require("vscode-textmate")
const oniguruma = require("vscode-oniguruma")

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"))

const files = Object.fromEntries(Object.keys(GRAMMARS).map(scope => [scope, grammarPath(scope)]))
files["source.stylus"] = join(root, "test/fixtures/source.stylus.json")
const injections = {}
for (const { scopeName, path, injectTo = [] } of manifest.contributes.grammars) {
  files[scopeName] = join(root, path)
  for (const target of injectTo) (injections[target] ??= []).push(scopeName)
}

await oniguruma.loadWASM((await readFile(require.resolve("vscode-oniguruma/release/onig.wasm"))).buffer)

const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: sources => new oniguruma.OnigScanner(sources),
    createOnigString: str => new oniguruma.OnigString(str),
  }),
  loadGrammar: async scopeName => {
    const file = files[scopeName]
    // a grammar VS Code wouldn't have either (source.sass without its
    // extension): the include resolves to nothing, as it does in the editor
    if (!file) return null
    return vsctm.parseRawGrammar(await readFile(file, "utf8"), file)
  },
  getInjections: scopeName => injections[scopeName],
})

export const tokenize = async (scopeName, source) => {
  const grammar = await registry.loadGrammar(scopeName)
  const tokens = []
  let state = vsctm.INITIAL
  for (const line of source.split("\n")) {
    const { tokens: lineTokens, ruleStack } = grammar.tokenizeLine(line, state)
    for (const { startIndex, endIndex, scopes } of lineTokens) {
      tokens.push({ text: line.slice(startIndex, endIndex), scopes })
    }
    state = ruleStack
  }
  return tokens
}

// every token with its scopes, one per line - what a failing assertion prints,
// and what `node test/tokenize.mjs <scope> <file>` prints for a whole file
export const dump = tokens => tokens.map(({ text, scopes }) => `${JSON.stringify(text)}  ${scopes.join(" ")}`).join("\n")

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [scopeName, file] = process.argv.slice(2)
  console.log(dump(await tokenize(scopeName, await readFile(file, "utf8"))))
}
