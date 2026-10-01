// ---------------------------------------------------------------------------
// components written as template literals
//
//   new Component79(`<p>{{ label }}</p>`)       parseComponent(`…`)       new C79(`…`)
//
// A literal handed straight to one of these is a component, read exactly as a
// .html file is (component.ts, template.ts) - but it lives inside a JavaScript
// or TypeScript file, or a page's <script>, so its code is written against the
// string the runtime receives (the *cooked* one: \` is `) and mapped back
// through where each of its characters sits in the file.
//
// A literal with `${…}` in it is not read: what it is depends on what runs.
// ---------------------------------------------------------------------------

import type * as TS from "typescript"
import type { Mapping } from "./component"

export type Literal = {
  // the string the runtime receives
  text: string
  // where each of its characters is in the file, or -1 for one an escape wrote
  at: number[]
  // the names the component is mounted with, where the code says so
  data?: string[]
}

// \`.mount(el, data)\` and \`.render(data)\` (and renderShadow), anywhere down a
// chain of calls on the component: \`new Component79(\`…\`).on(…).mount(host, { msg })\`.
// What a root is mounted with is in its scope whatever its signature says,
// and here it is written right beside it - the keys of an object literal
const DATA_ARGUMENT: Record<string, number> = { mount: 1, render: 0, renderShadow: 0 }

const mountedWith = (ts: typeof TS, created: TS.Expression): string[] => {
  const names: string[] = []
  let current: TS.Node = created
  while (ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current && ts.isCallExpression(current.parent.parent)) {
    const call = current.parent.parent
    const at = DATA_ARGUMENT[current.parent.name.text]
    const data = at === undefined ? undefined : call.arguments[at]
    if (data && ts.isObjectLiteralExpression(data)) {
      for (const p of data.properties) {
        if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) names.push(p.name.text)
      }
    }
    current = call
  }
  return names
}

const CALLEES = new Set(["Component79", "C79", "parseComponent"])

// `Component79`, `jq79.Component79`, …: the name a call is made through
const calleeName = (ts: typeof TS, expression: TS.Expression): string | undefined =>
  ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined

const SIMPLE_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" }

// a template literal's raw text, cooked: each escape as the character it
// writes, and where every character came from
export const cook = (raw: string, offset: number): Literal => {
  let text = ""
  const at: number[] = []
  for (let i = 0; i < raw.length; i++) {
    // a line break is \n in the string, however the file writes it
    if (raw[i] === "\r") { text += "\n"; at.push(-1); if (raw[i + 1] === "\n") i++; continue }
    if (raw[i] !== "\\") { text += raw[i]; at.push(offset + i); continue }
    const next = raw[i + 1]
    let cooked: string
    let length = 2
    if (next === "\n") cooked = ""
    else if (next === "\r") { cooked = ""; if (raw[i + 2] === "\n") length = 3 }
    else if (next === "u" && raw[i + 2] === "{") {
      const close = raw.indexOf("}", i + 3)
      cooked = String.fromCodePoint(parseInt(raw.slice(i + 3, close), 16))
      length = close - i + 1
    } else if (next === "u") { cooked = String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16)); length = 6 }
    else if (next === "x") { cooked = String.fromCharCode(parseInt(raw.slice(i + 2, i + 4), 16)); length = 4 }
    else cooked = SIMPLE_ESCAPES[next] ?? next
    for (const ch of cooked) { text += ch; at.push(-1) }
    i += length - 1
  }
  return { text, at }
}

// every component literal in a script's code. `offset` is where the code
// starts in the file (a page's <script> content)
export const findLiterals = (ts: typeof TS, code: string, kind: TS.ScriptKind, offset = 0): Literal[] => {
  if (!/\b(?:Component79|C79|parseComponent)\b/.test(code)) return []
  const file = ts.createSourceFile("literals.ts", code, ts.ScriptTarget.Latest, true, kind)
  const found: Literal[] = []
  const visit = (node: TS.Node) => {
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && CALLEES.has(calleeName(ts, node.expression) ?? "")) {
      const first = node.arguments?.[0]
      if (first && ts.isNoSubstitutionTemplateLiteral(first)) {
        const start = first.getStart(file) + 1
        found.push({ ...cook(code.slice(start, first.end - 1), offset + start), data: mountedWith(ts, node) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

// mappings written against a literal's text, moved onto the file: each split
// where the file's characters stop being consecutive (an escape), and the
// characters an escape wrote left unmapped. A mapping whose generated text is
// not the source's (Writer.mapText) is kept only where its source is plain
export const toFile = (mappings: Mapping[], literal: Literal): Mapping[] => {
  const out: Mapping[] = []
  for (const m of mappings) {
    const start = m.sourceOffsets[0]
    const length = m.lengths[0]
    if (m.generatedLengths) {
      const plain = literal.at.slice(start, start + length)
      if (plain.every((at, i) => at !== -1 && at === plain[0] + i)) out.push({ ...m, sourceOffsets: [plain[0] ?? 0] })
      continue
    }
    let run = -1
    for (let i = 0; i <= length; i++) {
      const at = i < length ? literal.at[start + i] : -1
      const continues = run !== -1 && at !== -1 && at === literal.at[start + i - 1] + 1
      if (continues) continue
      if (run !== -1) {
        out.push({ ...m, sourceOffsets: [literal.at[start + run]], generatedOffsets: [m.generatedOffsets[0] + run], lengths: [i - run] })
      }
      run = at === -1 ? -1 : i
    }
  }
  return out
}
