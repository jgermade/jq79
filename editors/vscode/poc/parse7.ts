// a `ts` for the generator (src/component.ts, template.ts, literal.ts) whose
// trees come from TypeScript 7, so that TypeScript 5.9 isn't loaded at all.
//
// The generator reads TypeScript's tree through a small surface: a parser
// (`ts.createSourceFile`), `ts.forEachChild`, ~40 `ts.is*` guards, `SyntaxKind`
// and `ScriptKind`, and a node's `getStart`/`getText`/`pos`/`end`/`parent`.
// TypeScript 7's `typescript/unstable/ast` has all of that but the parser and
// two guards' names, and its nodes, decoded from the compiler's own, have the
// rest - so this is mostly TypeScript 7's module as it is.
//
// The parser is the compiler, in its own process: it has no "parse this text"
// call, only a program's files. So a text is parsed by handing it over as a
// file of a project made for parsing (no lib, no resolution), and reading
// back `program.getSourceFile`. One round trip per text would be slow, so
// texts are batched: a text that isn't parsed yet gets a stand-in (an empty
// file) and is remembered, the caller finishes what it was doing - wrongly, and
// knows it (`missed`) - and `flush()` parses everything remembered at once.
// The caller runs again until nothing is missed (check7.ts)
import type * as TS from "typescript"
import * as ast from "typescript7/unstable/ast"
import type { API } from "typescript7/unstable/sync"

const extensionOf = (kind: number) =>
  kind === ast.ScriptKind.TS ? ".ts" : kind === ast.ScriptKind.TSX ? ".tsx" : kind === ast.ScriptKind.JSX ? ".jsx" : ".js"

// what the generator gets for a text that isn't parsed yet: a file with
// nothing in it, which every reading of it walks past
const standIn = (text: string) => ({
  kind: ast.SyntaxKind.SourceFile,
  text,
  statements: [],
  pos: 0,
  end: text.length,
  forEachChild: () => undefined,
  getStart: () => 0,
  getText: () => text,
})

export const createParser = (api: API, root: string) => {
  const trees = new Map<string, unknown>()
  const pending = new Map<string, { text: string; kind: number }>()
  let missed = 0
  let files = 0
  let rounds = 0

  const ts = {
    ...ast,
    // the two guards TypeScript 7 names otherwise
    isParameter: ast.isParameterDeclaration,
    isStringLiteralLike: ast.isStringLiteralLikeNode,
    // a method of the node in TypeScript 7
    forEachChild: <T>(node: { forEachChild: (cb: (n: unknown) => T, cbs?: (ns: unknown) => T) => T | undefined }, cb: (n: unknown) => T, cbs?: (ns: unknown) => T) =>
      node.forEachChild(cb, cbs),
    createSourceFile: (_name: string, text: string, _target: unknown, _setParents?: boolean, kind: number = ast.ScriptKind.TS) => {
      const key = `${kind}\0${text}`
      const tree = trees.get(key)
      if (tree) return tree
      pending.set(key, { text, kind })
      missed++
      return standIn(text)
    },
  } as unknown as typeof TS

  // parses every text asked for since the last flush, in one project
  const flush = () => {
    if (!pending.size) return
    rounds++
    const names = new Map<string, string>()
    for (const [key, { text, kind }] of pending) names.set(`${root}/__jq79_parse__/${files++}${extensionOf(kind)}`, key)
    const texts = new Map([...names].map(([name, key]) => [name, pending.get(key)!.text]))
    const config = `${root}/__jq79_parse_${rounds}__.json`
    const json = JSON.stringify({
      compilerOptions: { noLib: true, noResolve: true, types: [], allowJs: true, noEmit: true },
      files: [...names.keys()],
    })
    readers.push(name => (name === config ? json : texts.get(name)))
    const { program } = api.updateSnapshot({ openProjects: [config] }).getProject(config)!
    for (const [name, key] of names) trees.set(key, program.getSourceFile(name))
    pending.clear()
  }

  // the parse projects' files, for the API's fs callbacks
  const readers: ((name: string) => string | undefined)[] = []
  const read = (name: string) => {
    for (const reader of readers) {
      const text = reader(name)
      if (text !== undefined) return text
    }
    return undefined
  }

  return {
    ts,
    flush,
    read,
    // how many texts were asked for and not parsed yet: a caller compares it
    // before and after to know whether what it built is to be thrown away
    get missed() { return missed },
    get stats() { return { texts: files, parseRounds: rounds } },
  }
}
