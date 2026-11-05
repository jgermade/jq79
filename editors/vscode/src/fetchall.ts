// ---------------------------------------------------------------------------
// consecutive awaited fetches, and the fetchAll they could be
//
//   const Header = await C79.fetch("./header.html")      each waits for the
//   const Footer = await C79.fetch("./footer.html")      one before it
//
//   const [Header, Footer] = await C79.fetchAll(["./header.html", "./footer.html"])
//
// A page's script is one jq79 never reads, so nothing starts these downloads
// early the way a setup script's are (RECORD/2026-11-05.a-preload-scanner.md):
// the editor points them out, and offers the rewrite. Only what the rewrite
// can't change the meaning of: declarations of one name each, of one kind,
// side by side in one block, each awaiting a fetch of a string literal and
// nothing after it - no `.mount()` on the chain, no name an argument could
// read. Downloading a component has no effects of its own, so starting them
// together changes when they arrive, never what they are.
// ---------------------------------------------------------------------------

import type { CodeAction, Diagnostic, LanguageServicePlugin } from "@volar/language-service"
import type * as TS from "typescript"
import { URI } from "vscode-uri"
import { generate } from "./component"
import { pageScripts } from "./literal"

export type FetchRun = {
  // the statements the rewrite replaces, as offsets in the text it was given
  start: number
  end: number
  // the names, in order, and what replaces them
  names: string[]
  replacement: string
}

const CALLEES = new Set(["C79", "Component79"])
const LINE_LIMIT = 100

// `const Name = await C79.fetch("lit")`, read: its kind, name, callee and URL
type Fetch = { statement: TS.VariableStatement; kind: string; name: string; callee: string; url: string }

const readFetch = (ts: typeof TS, file: TS.SourceFile, statement: TS.Statement): Fetch | undefined => {
  if (!ts.isVariableStatement(statement) || statement.modifiers?.length) return undefined
  const list = statement.declarationList
  if (list.declarations.length !== 1) return undefined
  const [declaration] = list.declarations
  if (!ts.isIdentifier(declaration.name) || declaration.type || !declaration.initializer) return undefined
  const awaited = declaration.initializer
  if (!ts.isAwaitExpression(awaited) || !ts.isCallExpression(awaited.expression)) return undefined
  const call = awaited.expression
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "fetch") return undefined
  if (!ts.isIdentifier(callee.expression) || !CALLEES.has(callee.expression.text)) return undefined
  if (call.arguments.length !== 1 || !ts.isStringLiteral(call.arguments[0])) return undefined
  const kind = list.flags & ts.NodeFlags.Const ? "const" : list.flags & ts.NodeFlags.Let ? "let" : "var"
  return { statement, kind, name: declaration.name.text, callee: callee.expression.text, url: call.arguments[0].getText(file) }
}

const rewrite = (run: Fetch[], indent: string): string => {
  const { kind, callee } = run[0]
  const names = run.map(f => f.name).join(", ")
  const oneLine = `${kind} [${names}] = await ${callee}.fetchAll([${run.map(f => f.url).join(", ")}])`
  if (indent.length + oneLine.length <= LINE_LIMIT) return oneLine
  const entries = run.map(f => `${indent}  ${f.url},`).join("\n")
  return `${kind} [${names}] = await ${callee}.fetchAll([\n${entries}\n${indent}])`
}

// the runs of a script's text. `offset` is where that text starts in the
// document it came from (a page's <script>), and every offset is the
// document's
export const fetchRuns = (ts: typeof TS, text: string, kind: TS.ScriptKind, offset = 0): FetchRun[] => {
  const file = ts.createSourceFile("fetches.ts", text, ts.ScriptTarget.Latest, true, kind)
  const runs: FetchRun[] = []

  const statementsOf = (node: TS.Node): readonly TS.Statement[] | undefined =>
    ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) ? node.statements
      : ts.isCaseClause(node) || ts.isDefaultClause(node) ? node.statements
        : undefined

  const visit = (node: TS.Node) => {
    const statements = statementsOf(node)
    if (statements) {
      let run: Fetch[] = []
      const flush = () => {
        // two or more, every name its own (a repeat is a redeclaration the
        // array pattern would turn into an error of its own)
        if (run.length > 1 && new Set(run.map(f => f.name)).size === run.length) {
          const first = run[0].statement
          const last = run[run.length - 1].statement
          const start = first.getStart(file)
          const lineStart = text.lastIndexOf("\n", start - 1) + 1
          const indent = /^[ \t]*/.exec(text.slice(lineStart, start))![0]
          // the last statement's own `;` goes with it, and comes back after
          const end = last.end
          const semicolon = text[end - 1] === ";" ? ";" : ""
          runs.push({ start: offset + start, end: offset + end, names: run.map(f => f.name), replacement: rewrite(run, indent) + semicolon })
        }
        run = []
      }
      for (const statement of statements) {
        const fetch = readFetch(ts, file, statement)
        // one kind and one callee per run: `const` and `let` would make one
        // of them something it wasn't. And nothing between two of them: a
        // comment there is the author's, and the rewrite has nowhere to put it
        const previous = run[run.length - 1]?.statement
        if (fetch && previous && (fetch.kind !== run[0].kind || fetch.callee !== run[0].callee ||
          text.slice(previous.end, statement.getStart(file)).trim() !== "")) flush()
        if (fetch) run.push(fetch)
        else flush()
      }
      flush()
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return runs
}

// ---------------------------------------------------------------------------
// the service: a hint on each run, and the quick fix that rewrites it. It
// reads a page - an .html with no component in it, whose <script>s are the
// page's own - and a JavaScript or TypeScript file. A component's scripts are
// left alone: there, the runtime already starts their downloads together
// ---------------------------------------------------------------------------

export const FETCH_ALL_CODE = "fetch-all"
const HINT = 4 satisfies Diagnostic["severity"]

const scriptKind = (ts: typeof TS, languageId: string): TS.ScriptKind | undefined =>
  ({ javascript: ts.ScriptKind.JS, javascriptreact: ts.ScriptKind.JSX, typescript: ts.ScriptKind.TS, typescriptreact: ts.ScriptKind.TSX })[languageId]

// the runs in a document's text, by its language
export const documentRuns = (ts: typeof TS, languageId: string, text: string): FetchRun[] => {
  if (languageId === "html") {
    if (generate(ts, text)) return [] // a component, not a page
    return pageScripts(text).flatMap(script =>
      fetchRuns(ts, script.content, script.typescript ? ts.ScriptKind.TS : ts.ScriptKind.JS, script.start))
  }
  const kind = scriptKind(ts, languageId)
  return kind === undefined ? [] : fetchRuns(ts, text, kind)
}

export const createJq79FetchAllService = (ts: typeof TS): LanguageServicePlugin => ({
  name: "jq79-fetch-all",
  capabilities: {
    diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false },
    codeActionProvider: { codeActionKinds: ["quickfix"], resolveProvider: false },
  },
  create(context) {
    // the file's own text and language: a document is the file itself, or -
    // for a file the jq79 plugin reads - its root code, which is the file's
    // text unchanged. Any other embedded code is generated, and not the
    // author's to rewrite
    const sourceOf = (document: { uri: string; languageId: string; getText(): string }) => {
      const decoded = context.decodeEmbeddedDocumentUri(URI.parse(document.uri))
      if (!decoded) return { uri: document.uri, languageId: document.languageId, text: document.getText() }
      if (decoded[1] !== "root") return undefined
      const script = context.language.scripts.get(decoded[0])
      if (!script) return undefined
      return { uri: decoded[0].toString(), languageId: script.languageId, text: script.snapshot.getText(0, script.snapshot.getLength()) }
    }
    const runsOf = (document: Parameters<typeof sourceOf>[0]) => {
      const source = sourceOf(document)
      return source ? { uri: source.uri, runs: documentRuns(ts, source.languageId, source.text) } : { uri: document.uri, runs: [] }
    }
    // the actions this plugin made: their edits are the file's already
    const ours = new WeakSet<CodeAction>()

    return {
      provideDiagnostics(document) {
        return runsOf(document).runs.map((run): Diagnostic => ({
          range: { start: document.positionAt(run.start), end: document.positionAt(run.end) },
          severity: HINT,
          source: "jq79",
          code: FETCH_ALL_CODE,
          message: `These ${run.names.length} fetches wait for each other; C79.fetchAll starts them together.`,
        }))
      },
      provideCodeActions(document, range) {
        const from = document.offsetAt(range.start)
        const to = document.offsetAt(range.end)
        const { uri, runs } = runsOf(document)
        return runs
          .filter(run => run.start <= to && from <= run.end)
          .map(run => {
            const where = { start: document.positionAt(run.start), end: document.positionAt(run.end) }
            const action: CodeAction = {
              title: `Fetch ${run.names.join(", ")} together with fetchAll`,
              kind: "quickfix",
              isPreferred: true,
              edit: { changes: { [uri]: [{ range: where, newText: run.replacement }] } },
            }
            ours.add(action)
            return action
          })
      },
      // the edit is written against the file itself: the root code is its
      // text unchanged, so its offsets are the file's. Handed back as is,
      // Volar doesn't map it again - which, in a script's own code, it would
      // refuse: that mapping carries no rename, so as not to duplicate the
      // editor's TypeScript (language.ts)
      transformCodeAction: action => (ours.has(action) ? action : undefined),
    }
  },
})
