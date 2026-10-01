// ---------------------------------------------------------------------------
// a component file as the code TypeScript checks
//
// A jq79 component is HTML whose <script>s the runtime compiles into function
// bodies (setupBody / factoryBody in src/source.ts). TypeScript can't read
// that, so this writes each component of a file out as the program it runs as
// - one virtual .ts (or .js) per .html file - with a mapping back to every
// character that came from the file. What the checker says about a mapped
// range lands on the .html; what it says about the scaffolding around it
// (unmapped) is dropped.
//
// What the scaffolding has to reproduce, so the checker agrees with the runtime
// (RECORD/2026-09-28.an-editor-extension.md, phase 2):
// - a setup script is the body of an async function (top-level await), and
//   its :setup pattern is what that function destructures its props with
// - every script of a component runs against one store, so a name one script
//   declares exists in the others: declared at the component's level, `any`
// - `$: x = expr` declares x when nothing else does (`let x = expr`)
// - an assignment to a name declared nowhere goes to the store: declared too
// - the helpers (SETUP_HELPER_NAMES, INSTANCE_HELPER_NAMES) are in scope,
//   typed from the jq79 package when the project has it, and so is each
//   sibling <template name> the component doesn't take as a prop
// - `import(".html")` is the runtime's $__import and gives a component
// - a factory script (`export default`) is plain module code whose default
//   export is called with (props, ctx)
//
// Which names are store variables, which scripts are factories and what a
// :setup pattern declares are the runtime's own functions, imported from
// src/, so the two can't disagree about them.
// ---------------------------------------------------------------------------

import type * as TS from "typescript"
import { parseFactoryProps, parsePropsPattern, transformFactoryScript, transformSetupScript, type PropDecl } from "../../../src/transform"
import { COMPONENT_NAME_RE, INSTANCE_HELPER_NAMES, SETUP_HELPER_NAMES } from "../../../src/source"

// ------------------------------------------------------------------ the split

export type Attr = { name: string; value?: string; valueStart?: number }

export type Block = {
  tag: "script" | "style"
  attrs: Attr[]
  contentStart: number
  contentEnd: number
}

export type ComponentDef = { name?: string; scripts: Block[]; styles: Block[] }

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

// the attributes of an open tag, `text` running from after the tag name to
// (not including) its `>`, with each value's offset in the file
const readAttrs = (text: string, offset: number): Attr[] => {
  const attrs: Attr[] = []
  for (const match of text.matchAll(ATTR_RE)) {
    const name = match[1].toLowerCase()
    const index = match.index!
    const valueIndex = match[2] !== undefined ? 2 : match[3] !== undefined ? 3 : match[4] !== undefined ? 4 : 0
    if (!valueIndex) { attrs.push({ name }); continue }
    const value = match[valueIndex]
    // the value's own offset: after the `=`, past a quote when there is one
    const valueStart = offset + index + match[0].length - value.length - (valueIndex === 4 ? 0 : 1)
    attrs.push({ name, value, valueStart })
  }
  return attrs
}

export const attr = (block: Block, name: string): Attr | undefined => block.attrs.find(a => a.name === name)

// the end of an open tag that starts at `from` (at its `<`): the `>` that isn't
// inside a quoted value, or -1
const openTagEnd = (text: string, from: number): number => {
  let quote = ""
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (quote) { if (ch === quote) quote = ""; continue }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === ">") return i
  }
  return -1
}

// a page, not a component: the runtime never reads one as a component, and
// its scripts are the browser's
const PAGE_RE = /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i

const TAG_RE = /<!--|<(\/?)(script|style|template)(?=[\s/>])/gi

// a file's components, as parseComponentString splits them (src/jq79.ts): a
// top-level <template name="X"> with a valid, not yet taken name is component
// X, and everything else at the top is the file's own. A <script> or <style>
// belongs to the component whose top it is at; one inside a nested <template>
// (a slot's content) belongs to none, as it does at runtime.
//
// Offsets are the point of this: the runtime's own split (parseHTML over
// prepareSource) rewrites the text before reading it and keeps no positions.
// It also reads the element tree, where this only tracks <template> depth - so
// a <script> inside some other element is taken here and not at runtime
export const splitComponents = (text: string): ComponentDef[] => {
  if (PAGE_RE.test(text)) return []
  const main: ComponentDef = { scripts: [], styles: [] }
  const components = [main]
  const names = new Set<string>()
  // one entry per open <template>: the component it starts, or null
  const templates: (ComponentDef | null)[] = []

  TAG_RE.lastIndex = 0
  for (let match = TAG_RE.exec(text); match; match = TAG_RE.exec(text)) {
    if (match[0] === "<!--") {
      const end = text.indexOf("-->", match.index + 4)
      if (end === -1) break
      TAG_RE.lastIndex = end + 3
      continue
    }
    const closing = match[1] === "/"
    const tag = match[2].toLowerCase()
    const end = openTagEnd(text, match.index)
    if (end === -1) break
    TAG_RE.lastIndex = end + 1

    if (tag === "template") {
      if (closing) { templates.pop(); continue }
      if (text[end - 1] === "/") continue
      let started: ComponentDef | null = null
      if (templates.length === 0) {
        const name = readAttrs(text.slice(match.index + match[0].length, end), match.index + match[0].length)
          .find(a => a.name === "name")?.value
        if (name !== undefined && COMPONENT_NAME_RE.test(name) && !names.has(name)) {
          names.add(name)
          started = { name, scripts: [], styles: [] }
          components.push(started)
        }
      }
      templates.push(started)
      continue
    }
    if (closing) continue

    // a raw-text element runs to its closing tag, whatever is in between
    const close = new RegExp(`</${tag}\\s*>`, "ig")
    close.lastIndex = end + 1
    const closed = close.exec(text)
    const contentEnd = closed ? closed.index : text.length
    TAG_RE.lastIndex = closed ? closed.index + closed[0].length : text.length

    const owner = templates.length === 0 ? main : templates.length === 1 ? templates[0] : null
    if (!owner) continue
    const attrs = readAttrs(text.slice(match.index + match[0].length, end), match.index + match[0].length)
    const block: Block = { tag: tag as Block["tag"], attrs, contentStart: end + 1, contentEnd }
    if (tag === "script") {
      if (!attr(block, "src")) owner.scripts.push(block)
    } else owner.styles.push(block)
  }
  // the file's own component stays even with no script or style: its
  // template is still checked, and it is what the file's default export is
  return components
}

// the jq79/vite plugin's typescriptAttr (dev/vite.ts), rule for rule: a lang
// answers on its own, and type is only read when there is none
const TS_LANGS = new Set(["ts", "typescript"])
const TS_TYPE_RE = /^(?:text|application)\/(?:x-)?typescript$/
export const isTypeScript = (block: Block): boolean => {
  const lang = attr(block, "lang")?.value
  if (lang !== undefined) return TS_LANGS.has(lang.trim().toLowerCase())
  const type = attr(block, "type")?.value
  return type !== undefined && TS_TYPE_RE.test(type.trim().toLowerCase())
}

// ------------------------------------------------------------------ the code

// Volar's mapping shape, and what a mapped range is good for: everything but
// formatting, which would reformat the scaffolding's idea of the code
export type Mapping = {
  sourceOffsets: number[]
  generatedOffsets: number[]
  lengths: number[]
  // when the generated text is not the source's (a kebab name written camelCase)
  generatedLengths?: number[]
  data: Record<string, boolean>
}
export const FULL = { verification: true, completion: true, semantic: true, navigation: true, structure: true, format: false }

// a setup script's own code. The store is returned from a closure (see
// writeBody): TypeScript reports an unannotated
// `let user = null` read in one as "implicitly has type 'any' in some
// locations" (TS7034), on the declaration - a complaint about the virtual
// code's closure, not the script
const SCRIPT: Mapping["data"] = {
  ...FULL,
  verification: { shouldReport: (_source: unknown, code: unknown) => Number(code) !== 7034 } as unknown as boolean,
}

export class Writer {
  code = ""
  mappings: Mapping[] = []
  // pairs of ranges in the generated code that are one name (linkedCodeMappings)
  links: Mapping[] = []
  constructor(private source: string) {}
  text(text: string) { this.code += text }
  copy(start: number, end: number, data: Mapping["data"] = FULL) {
    if (end <= start) return
    this.mappings.push({ sourceOffsets: [start], generatedOffsets: [this.code.length], lengths: [end - start], data })
    this.code += this.source.slice(start, end)
  }
  // \`name: name\` for each name, the key linked to the value: a rename that
  // reaches either goes on from the other. The property is the name as the
  // other virtual file knows it, the value is the variable this one declares;
  // TypeScript treats them as two symbols, and a shorthand (\`{ name }\`) only
  // links them while it is not asked to keep the old name as an alias, which
  // VS Code asks by default (useAliasesForRenames)
  linkedPair(name: string): number {
    const key = this.code.length
    this.code += `${name}: `
    const value = this.code.length
    this.code += name
    this.link(key, value, name.length)
    return value
  }
  // \`{ a: a, b: b }\`'s inside, each pair linked; where each value is
  linkedPairs(names: string[]): Map<string, number> {
    const values = new Map<string, number>()
    names.forEach((name, i) => { if (i) this.code += ", "; values.set(name, this.linkedPair(name)) })
    return values
  }
  link(a: number, b: number, length: number) {
    this.links.push({ sourceOffsets: [a], generatedOffsets: [b], lengths: [length], data: {} })
  }
  // \`text\` in place of the source's [start, end), mapped to it
  mapText(start: number, end: number, text: string, data: Mapping["data"] = FULL) {
    this.mappings.push({ sourceOffsets: [start], generatedOffsets: [this.code.length], lengths: [end - start], generatedLengths: [text.length], data })
    this.code += text
  }
  // a copy mapped with `data`, except `marks` (sorted), mapped with their own
  copyMarked(start: number, end: number, marks: Mark[], data: Mapping["data"] = FULL) {
    let at = start
    for (const mark of marks) {
      if (mark.end <= at || mark.start >= end) continue
      this.copy(at, Math.max(at, mark.start), data)
      this.copy(Math.max(at, mark.start), Math.min(end, mark.end), mark.data)
      at = Math.min(end, mark.end)
    }
    this.copy(at, end, data)
  }
}

// what a mapped script needs done to it, as replacements of source ranges
type Edit = { start: number; end: number; text: string }
// a source range mapped with other data than FULL
type Mark = { start: number; end: number; data: Mapping["data"] }

// `$: schedule(query)` is how a script names an effect's dependencies
// (docs/setup-scripts.md): the arguments are read so the effect re-runs when
// they change, whatever the function takes. So their count is not an error
const EFFECT_ARGUMENTS: Mapping["data"] = {
  ...FULL,
  verification: { shouldReport: (_source: unknown, code: unknown) => Number(code) !== 2554 } as unknown as boolean,
}

const bindingNames = (ts: typeof TS, name: TS.BindingName, into: Set<string>) => {
  if (ts.isIdentifier(name)) into.add(name.text)
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(ts, element.name, into)
}

// every name the script declares anywhere, in any scope - an over-approximation
// that only ever means one assignment fewer is declared at the store's level
const declaredAnywhere = (ts: typeof TS, file: TS.SourceFile): Set<string> => {
  const names = new Set<string>()
  const visit = (node: TS.Node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) bindingNames(ts, node.name, names)
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) names.add(node.name.text)
    else if (ts.isImportClause(node) && node.name) names.add(node.name.text)
    else if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) names.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return names
}

// the identifiers a script assigns to, at any depth: `x = …`, `x += …`, `x++`,
// and the plain targets of a destructuring assignment
const assignedNames = (ts: typeof TS, file: TS.SourceFile): Set<string> => {
  const names = new Set<string>()
  const target = (node: TS.Expression) => {
    if (ts.isIdentifier(node)) names.add(node.text)
    else if (ts.isParenthesizedExpression(node)) target(node.expression)
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(e => target(ts.isSpreadElement(e) ? e.expression : e))
    else if (ts.isObjectLiteralExpression(node)) {
      for (const p of node.properties) {
        if (ts.isShorthandPropertyAssignment(p)) names.add(p.name.text)
        else if (ts.isPropertyAssignment(p)) target(p.initializer)
        else if (ts.isSpreadAssignment(p)) target(p.expression)
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) target(node.left)
  }
  const visit = (node: TS.Node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) target(node.left)
    else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) target(node.operand)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return names
}

// how an `import(spec)` is read. The runtime's $__import answers a `.html`
// with the component itself, not a module, so that one keeps its import -
// TypeScript resolves the file and knows the component's props - and is
// unwrapped to the module's default export. A URL or a computed specifier is
// the runtime's to answer ($__import, any). Anything else is a module, left
// to TypeScript, which then knows its types
const importKind = (ts: typeof TS, call: TS.CallExpression): "component" | "runtime" | "module" => {
  const spec = call.arguments[0]
  if (!spec || !ts.isStringLiteralLike(spec) || /^[a-z][a-z0-9+.-]*:/i.test(spec.text)) return "runtime"
  return /\.html(?:[?#]|$)/i.test(spec.text) ? "component" : "module"
}

type ScriptPlan = {
  block: Block
  factory: boolean
  file: TS.SourceFile
  // names this script puts on the store: top-level declarations and `$:`
  // targets (transformSetupScript), and its props
  storeNames: string[]
  // assigned and declared nowhere, so they go to the store at runtime
  undeclared: string[]
}

const planScript = (ts: typeof TS, text: string, block: Block): ScriptPlan => {
  const content = text.slice(block.contentStart, block.contentEnd)
  const file = ts.createSourceFile("script.ts", content, ts.ScriptTarget.Latest, true, isTypeScript(block) ? ts.ScriptKind.TS : ts.ScriptKind.JS)
  const factory = transformFactoryScript(content) !== null
  if (factory) return { block, factory, file, storeNames: [], undeclared: [] }
  // a TypeScript script reaches the runtime with its types stripped (the
  // Vite plugin), and transformSetupScript reads that: `let count: number`
  // is not a declaration to it. Its top-level let/const/var are read here
  const storeNames = [...transformSetupScript(content).vars]
  if (isTypeScript(block)) storeNames.push(...topLevelVariables(ts, file), ...reactiveTargets(ts, file))
  const props = parsePropsPattern(attr(block, ":setup")?.value) ?? []
  props.forEach(({ name, as }) => storeNames.push(as ?? name))
  const declared = declaredAnywhere(ts, file)
  const undeclared = [...assignedNames(ts, file)].filter(name => !declared.has(name))
  return { block, factory, file, storeNames, undeclared }
}

// an import the virtual code moves to the top of the module: any in a factory
// script, and in a setup script one that only imports types - `import type`,
// or named imports that are all `type` - which stripping the types erases
const hoisted = (ts: typeof TS, statement: TS.Statement, factory: boolean): statement is TS.ImportDeclaration => {
  if (!ts.isImportDeclaration(statement)) return false
  if (factory) return true
  const clause = statement.importClause
  if (!clause) return false
  if (clause.isTypeOnly) return true
  const named = clause.namedBindings
  return !clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(e => e.isTypeOnly)
}

// the names a script's top-level let/const/var declare - what goes on the
// store. A top-level `function` doesn't: transformSetupScript leaves it a
// lexical binding, which the template can't see (MISSING_NAME_RE, jq79.ts)
const topLevelVariables = (ts: typeof TS, file: TS.SourceFile): string[] => {
  const names = new Set<string>()
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) statement.declarationList.declarations.forEach(d => bindingNames(ts, d.name, names))
  }
  return [...names]
}

// `$: x = …` targets (REACTIVE_ASSIGN_RE, src/transform.ts)
const reactiveTargets = (ts: typeof TS, file: TS.SourceFile): string[] =>
  file.statements.flatMap(statement =>
    ts.isLabeledStatement(statement) && statement.label.text === "$" && ts.isExpressionStatement(statement.statement) &&
    ts.isBinaryExpression(statement.statement.expression) && statement.statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(statement.statement.expression.left)
      ? [statement.statement.expression.left.text]
      : [])

// index of the bracket closing the one that opens `src` (at its first
// non-space), or -1 - enough to cut a JS pattern's `: Type` off
const patternEnd = (src: string): number => {
  const start = src.search(/\S/)
  if (start === -1 || (src[start] !== "{" && src[start] !== "[")) return -1
  let depth = 0
  let quote = ""
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = ""; continue }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch) && --depth === 0) return i + 1
  }
  return -1
}

const HELPERS = [...SETUP_HELPER_NAMES, ...INSTANCE_HELPER_NAMES]

// the declarations every virtual file starts with. Types come from the jq79
// package when the project resolves it; when it doesn't, the import fails in
// unmapped code (nothing is reported) and every helper is `any`
const preamble = (typescript: boolean): string => {
  const ctx = "{ $data: any; $props: any; $effect: (run: () => void) => void; $mounted: () => Promise<void>; " +
    "$self: (selector: string) => Element | null; $$self: (selector: string) => Element[]; " +
    "$emit: (name: string, payload?: any) => boolean; $updateModel: (...args: [value?: any] | [name: string, value: any]) => boolean; " +
    "$slots: Record<string, true>; [sibling: string]: any }"
  const types: Record<string, string> = {
    $: `typeof import("jq79").$`,
    $$: `typeof import("jq79").$$`,
    $create: `typeof import("jq79").$create`,
    $reactive: `typeof import("jq79").$reactive`,
    $toRaw: `typeof import("jq79").$toRaw`,
    Component79: `typeof import("jq79").Component79`,
    $mounted: "() => Promise<void>",
    $self: "(selector: string) => Element | null",
    $$self: "(selector: string) => Element[]",
    $emit: "(name: string, payload?: any) => boolean",
    $updateModel: "(...args: [value?: any] | [name: string, value: any]) => boolean",
    $slots: "Record<string, true>",
  }
  const lines = ["// jq79: what a component's scripts are compiled with (src/source.ts, setupParams / factoryParams)"]
  for (const name of HELPERS) {
    lines.push(typescript ? `declare const ${name}: ${types[name]};` : `/** @type {${types[name]}} */ const ${name} = /** @type {any} */ (null);`)
  }
  // a component carries the props it takes, for a tag that uses it to be
  // checked against (template.ts, __jq79Props). Component79 when the project
  // resolves jq79 - and {} when it doesn't, because \`any & …\` would be any
  // and take the props with it
  const plain = `unknown extends import("jq79").Component79 ? {} : import("jq79").Component79`
  const own = `Awaited<ReturnType<typeof __jq79Component0>>["props"]`
  if (typescript) {
    lines.push(`declare function __jq79Bindings<T>(returned: T): T extends object ? T : {};`)
    lines.push(`declare function $__import(url: string): Promise<any>;`)
    lines.push(`declare function __jq79DefaultOf<M>(module: M): M extends { default: infer D } ? D : any;`)
    lines.push(`type __Jq79Factory = (props: any, ctx: ${ctx}) => any;`)
    lines.push(`type __Jq79Plain = ${plain};`)
    lines.push(`export type __Jq79Typed<P> = __Jq79Plain & { readonly __jq79Props?: P };`)
    lines.push(`type __Jq79NoProps = { readonly __jq79NoProps?: never };`)
    lines.push(`declare const __jq79Component: __Jq79Typed<${own}>;`)
  } else {
    lines.push(`/** @type {<T>(returned: T) => T extends object ? T : {}} */ const __jq79Bindings = /** @type {any} */ (null);`)
    lines.push(`/** @type {(url: string) => Promise<any>} */ const $__import = /** @type {any} */ (null);`)
    lines.push(`/** @type {<M>(module: M) => M extends { default: infer D } ? D : any} */ const __jq79DefaultOf = /** @type {any} */ (null);`)
    lines.push(`/** @typedef {(props: any, ctx: ${ctx}) => any} __Jq79Factory */`)
    lines.push(`/** @typedef {${plain}} __Jq79Plain */`)
    lines.push(`/**\n * @template P\n * @typedef {__Jq79Plain & { readonly __jq79Props?: P }} __Jq79Typed\n */`)
    lines.push(`/** @typedef {{ readonly __jq79NoProps?: never }} __Jq79NoProps */`)
    lines.push(`/** @type {__Jq79Typed<${own}>} */ const __jq79Component = /** @type {any} */ (null);`)
  }
  // \`import X from "./X.html"\` elsewhere gets this file's own component
  lines.push(`export default __jq79Component;`, "")
  return lines.join("\n")
}

export type Generated = { code: string; mappings: Mapping[]; links: Mapping[]; typescript: boolean }

// what the template of a component is checked against (template.ts): the
// names its store is known to have, and whether a name it doesn't know is an
// error. A component that declares no signature - `:setup="_"`, a factory's
// `_`, a script without `:setup`, no script at all - takes whatever its parent
// passes (components.md, "A signature is a contract both ways"), so an
// unknown name may be a prop. One that does declares every prop it takes
export type ComponentScope = { def: ComponentDef; names: string[]; permissive: boolean }

// a factory's store names that can be read off its source: the keys of the
// object its default export returns (`return { … }`, or an arrow's `=> ({ … })`),
// and every `$data.x =` / `$props.x =`
const factoryNames = (ts: typeof TS, file: TS.SourceFile): string[] => {
  const names = new Set<string>()
  const keys = (expression: TS.Expression) => {
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression
    if (!ts.isObjectLiteralExpression(expression)) return
    for (const p of expression.properties) if (p.name && ts.isIdentifier(p.name)) names.add(p.name.text)
  }
  const visit = (node: TS.Node) => {
    if (ts.isReturnStatement(node) && node.expression) keys(node.expression)
    else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) keys(node.body)
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression) &&
      (node.left.expression.text === "$data" || node.left.expression.text === "$props")) {
      names.add(node.left.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...names]
}

export const componentScopes = (ts: typeof TS, text: string): ComponentScope[] => {
  const components = splitComponents(text)
  const siblings = components.map(c => c.name).filter((n): n is string => !!n)
  return components.map(def => {
    const plans = def.scripts.map(block => planScript(ts, text, block))
    const signatures = plans.map(p => {
      const content = text.slice(p.block.contentStart, p.block.contentEnd)
      return p.factory ? parseFactoryProps(content) : readSignature(p.block)
    })
    const declared = new Set(signatures.flatMap(sig => (sig ?? []).map(d => d.name)))
    const names = new Set([
      ...plans.flatMap(p => (p.factory ? factoryNames(ts, p.file) : [...p.storeNames, ...p.undeclared, ...propBindings(ts, p.block)])),
      ...siblings.filter(name => !declared.has(name)),
    ])
    return { def, names: [...names], permissive: signatures.every(sig => sig === null) }
  })
}

// readSetupSignature (src/source.ts), on this file's blocks: no :setup is no
// signature, an empty one is a closed one, and a pattern declares its props
const readSignature = (block: Block): PropDecl[] | null => {
  const value = attr(block, ":setup")
  if (!value) return null
  if (!value.value?.trim()) return []
  return parsePropsPattern(value.value)
}

// the virtual code for the scripts of a whole .html file: each component an
// exported function that runs its scripts and returns its store, which is
// what the template's code (template.ts) imports the type of. null for a page
export const generate = (ts: typeof TS, text: string): Generated | null => {
  const components = splitComponents(text)
  if (!components.length) return null
  const typescript = components.some(c => c.scripts.some(isTypeScript))
  const siblings = components.map(c => c.name).filter((n): n is string => !!n)
  const plans = components.map(c => c.scripts.map(block => planScript(ts, text, block)))
  const any = typescript ? "(null as any)" : "/** @type {any} */ (null)"

  const out = new Writer(text)
  out.text(preamble(typescript))

  // a factory's static imports, and a setup script's `import type`, at the
  // top of the module where TypeScript resolves them. A setup script's other
  // imports are left where they are, because there they are an error: the
  // runtime compiles it as a function body, and only the types are erased
  // before it gets there (vite-plugin.md)
  plans.flat().forEach(plan => {
    for (const statement of plan.file.statements) {
      if (!hoisted(ts, statement, plan.factory)) continue
      const base = plan.block.contentStart
      out.copy(base + statement.getStart(plan.file), base + statement.end)
      out.text("\n")
    }
  })

  let n = 0
  components.forEach((component, c) => {
    const scripts = plans[c]
    const declaredProps = new Set(scripts.flatMap(p => (p.factory ? [] : (parsePropsPattern(attr(p.block, ":setup")?.value) ?? []).map(d => d.name))))
    out.text(`\n// component ${component.name ?? "(the file's own)"}\nexport async function __jq79Component${c}() {\n`)
    const shared = new Set([...scripts.flatMap(p => [...p.storeNames, ...p.undeclared])].filter(name => !HELPERS.includes(name)))
    const inScope = siblings.filter(name => !declaredProps.has(name))
    // a sibling is a plain component here: typing it with its props would make
    // this function's return type depend on itself (a component that renders
    // itself, Folder in Folder). The template types the tags (template.ts)
    inScope.forEach(name => {
      shared.delete(name)
      out.text(typescript ? `const ${name} = ${any} as __Jq79Plain;\n` : `/** @type {__Jq79Plain} */ const ${name} = ${any};\n`)
    })
    // where each shared name is declared here, to link it to the script that
    // declares it (below): a rename in a script that only uses it reaches
    // the one that declares it, and from there the template
    const sharedAt = new Map<string, number>()
    shared.forEach(name => {
      out.text(typescript ? `let ` : `/** @type {any} */ let `)
      sharedAt.set(name, out.code.length)
      out.text(typescript ? `${name}: any;\n` : `${name};\n`)
    })
    const stores: string[] = []
    const props: string[] = []
    scripts.forEach(plan => {
      const i = n++
      const fn = plan.factory ? `__jq79Factory${i}` : `__jq79Setup${i}`
      out.text(plan.factory ? `async function ${fn}() {\n` : `async function ${fn}(${typescript ? "__props: any" : "__props"}) {\n`)
      if (!plan.factory) writeProps(out, text, plan.block, typescript)
      const values = writeBody(ts, out, text, plan, typescript)
      values.forEach((value, name) => { const at = sharedAt.get(name); if (at !== undefined) out.link(at, value, name.length) })
      out.text("\n}\n")
      if (plan.factory) {
        stores.push(`__jq79Bindings(await (await ${fn}())(${any}, ${any}))`)
        const declared = parseFactoryProps(text.slice(plan.block.contentStart, plan.block.contentEnd))
        if (declared) props.push(declared.length ? `{ ${declared.map(d => `${d.name}?: any`).join("; ")} }` : "__Jq79NoProps")
      } else {
        out.text(`const __r${i} = await ${fn}(${any});\n`)
        stores.push(`__r${i}.store()`)
        const declared = readSignature(plan.block)
        if (declared) props.push(declared.length ? `Parameters<typeof __r${i}.signature>[0]` : "__Jq79NoProps")
      }
    })
    // the store: what every script returns, over the siblings in scope and
    // the names no script returns typed (an assignment to a name declared
    // nowhere), which are \`any\`. Not over all of them: \`any & number\` is any
    const returned = new Set(scripts.flatMap(p => (p.factory ? [] : returnedNames(ts, p))))
    const base = [
      ...[...shared].filter(name => !returned.has(name)).map(name => `${name}: any`),
      ...inScope.map(name => `${name}: __Jq79Plain`),
    ]
    const seed = typescript ? `({} as { ${base.join("; ")} })` : `/** @type {{ ${base.join("; ")} }} */ ({})`
    // the props it takes: what each declaring script's signature says, and
    // anything at all when none declares one (components.md: permissive)
    const type = props.length ? props.join(" & ") : "any"
    const propsValue = typescript ? `${any} as ${type}` : `/** @type {${type}} */ (${any})`
    out.text(`return { store: Object.assign(${seed}${stores.map(store => `, ${store}`).join("")}), props: ${propsValue} };\n}\n`)
  })
  return { code: out.code, mappings: out.mappings, links: out.links, typescript }
}

// `let <pattern> = __props;`, the pattern mapped from the :setup attribute.
// A JavaScript file can't carry the `: Type` a TypeScript component writes
// after it - the runtime ignores it too (parsePropsPattern stops at the `}`)
//
// And the same pattern again, unmapped, as the parameter of an arrow that is
// never called: what TypeScript infers for that parameter is the props type
// (\`{ step = 1, label }\` is \`{ step?: number; label: any }\`, an annotation is
// itself). It sits in the body, not on the setup function, because an
// \`interface Props\` the script declares is only visible inside it
const writeProps = (out: Writer, text: string, block: Block, typescript: boolean) => {
  const setup = attr(block, ":setup")
  if (!setup?.value?.trim() || setup.valueStart === undefined) {
    out.text("const __jq79Signature = undefined;\n")
    return
  }
  let length = setup.value.length
  if (!typescript) {
    const end = patternEnd(setup.value)
    if (end !== -1) length = end
  }
  out.text("let ")
  out.copy(setup.valueStart, setup.valueStart + length)
  out.text(" = __props;\n")
  out.text(`const __jq79Signature = (${text.slice(setup.valueStart, setup.valueStart + length)}) => {};\n`)
}

// the names a :setup pattern binds, read the way the checker reads it
const propBindings = (ts: typeof TS, block: Block): string[] => {
  const value = attr(block, ":setup")?.value
  if (!value?.trim()) return []
  const file = ts.createSourceFile("props.ts", `let ${value} = 0`, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const names = new Set<string>()
  const statement = file.statements[0]
  if (statement && ts.isVariableStatement(statement)) statement.declarationList.declarations.forEach(d => bindingNames(ts, d.name, names))
  return [...names]
}

// what a setup script returns as its part of the store: its props, its
// top-level let/const/var and its `$:` targets
const returnedNames = (ts: typeof TS, plan: ScriptPlan): string[] =>
  [...new Set([...propBindings(ts, plan.block), ...topLevelVariables(ts, plan.file), ...reactiveTargets(ts, plan.file)])]

// what `export default` becomes: a declaration that satisfies the factory
// type, so its (props, ctx) parameters are typed without an annotation and
// what it returns keeps its own type (an annotation would make it the
// factory type's `any`) - the template reads that
const defaultExport = (typescript: boolean): string =>
  typescript ? "const __jq79Default = (" : "/** @satisfies {__Jq79Factory} */ const __jq79Default = "
const DEFAULT_EXPORT_END = ") satisfies __Jq79Factory"

const writeBody = (ts: typeof TS, out: Writer, text: string, plan: ScriptPlan, typescript: boolean) => {
  const { file, block, factory } = plan
  const base = block.contentStart
  const edits: Edit[] = []
  const topDeclared = new Set<string>()

  for (const statement of file.statements) {
    if (hoisted(ts, statement, factory)) {
      edits.push({ start: statement.getStart(file), end: statement.end, text: "" })
    } else if (factory && ts.isExportAssignment(statement) && !statement.isExportEquals) {
      edits.push({ start: statement.getStart(file), end: statement.expression.getStart(file), text: defaultExport(typescript) })
      if (typescript) edits.push({ start: statement.expression.end, end: statement.expression.end, text: DEFAULT_EXPORT_END })
    } else if (factory && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      const modifiers = statement.modifiers!
      edits.push({ start: modifiers[0].getStart(file), end: modifiers[modifiers.length - 1].end, text: defaultExport(typescript) })
      if (typescript) edits.push({ start: statement.end, end: statement.end, text: DEFAULT_EXPORT_END })
    } else if (ts.isVariableStatement(statement)) {
      statement.declarationList.declarations.forEach(d => bindingNames(ts, d.name, topDeclared))
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      topDeclared.add(statement.name.text)
    }
  }

  // `$: x = expr` declares x, unless the script or its props already do
  const props = new Set((parsePropsPattern(attr(block, ":setup")?.value) ?? []).map(d => d.as ?? d.name))
  const reactive: string[] = []
  const marks: Mark[] = []
  if (!factory) {
    for (const statement of file.statements) {
      if (!ts.isLabeledStatement(statement) || statement.label.text !== "$") continue
      const body = statement.statement
      if (!ts.isExpressionStatement(body) || !ts.isBinaryExpression(body.expression) ||
        body.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(body.expression.left)) continue
      const name = body.expression.left.text
      if (topDeclared.has(name) || props.has(name) || reactive.includes(name)) continue
      reactive.push(name)
      // `$:` and the space after it become `let `, so `x = expr` reads as a declaration
      edits.push({ start: statement.label.getStart(file), end: body.getStart(file), text: "let " })
    }
    // an effect whose statement is a call: its arguments are dependencies
    for (const statement of file.statements) {
      if (!ts.isLabeledStatement(statement) || statement.label.text !== "$") continue
      const body = statement.statement
      if (!ts.isExpressionStatement(body) || !ts.isCallExpression(body.expression) || !body.expression.arguments.length) continue
      const args = body.expression.arguments
      // parens included: a diagnostic whose ends touch the neighbouring
      // mappings is mapped through them instead (Volar falls back to any
      // mapping that takes each end), and that one would report it
      marks.push({ start: base + args.pos - 1, end: base + args.end + 1, data: EFFECT_ARGUMENTS })
    }
    // every other `$:` is dropped: the statement it labels is what gets
    // checked, and a label nothing breaks to is TypeScript's "Unused label"
    for (const statement of file.statements) {
      if (!ts.isLabeledStatement(statement) || statement.label.text !== "$") continue
      if (edits.some(edit => edit.start === statement.label.getStart(file))) continue
      edits.push({ start: statement.label.getStart(file), end: statement.statement.getStart(file), text: "" })
    }
  }

  const visit = (node: TS.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const kind = importKind(ts, node)
      if (kind === "runtime") edits.push({ start: node.expression.getStart(file), end: node.expression.end, text: "$__import" })
      else if (kind === "component") edits.push({ start: node.end, end: node.end, text: ".then(__jq79DefaultOf)" })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)

  const hasDefault = edits.some(edit => edit.text === defaultExport(typescript))
  const data = factory ? FULL : SCRIPT
  edits.sort((a, b) => a.start - b.start)
  marks.sort((a, b) => a.start - b.start)
  let at = 0
  for (const edit of edits) {
    out.copyMarked(base + at, base + edit.start, marks, data)
    out.text(edit.text)
    at = edit.end
  }
  out.copyMarked(base + at, block.contentEnd, marks, data)

  // what the script puts on the store, for the template to be checked
  // against (template.ts). A function returning it, not the object: a value
  // returned at the end of the script has the type control flow narrowed it
  // to there - `let user: User | null = null`, assigned in a callback, is
  // `null` at the return - and a closure reads the variable's declared type.
  // Each property linked to its variable (Writer.linkedPairs), which is what
  // carries a rename between the script and the template
  if (!factory) {
    const names = returnedNames(ts, plan)
    out.text(`\n;return { store: () => ({ `)
    const values = out.linkedPairs(names)
    out.text(` }), signature: __jq79Signature };`)
    return values
  }
  if (hasDefault) out.text(`\n;return __jq79Default;`)
  return new Map<string, number>()
}
