// ---------------------------------------------------------------------------
// a component's template as the code TypeScript checks
//
// Each expression the renderer evaluates - `{{ }}`, every `:attr`, `@event`,
// `:if`, `:each`, `:key`, `:with`, a prop on a component tag - is copied, mapped,
// into a function that sees what the runtime's `with ($scope)` sees there
// (withBody in src/source.ts): the component's store, typed from its scripts
// (component.ts exports it), $emit / $updateModel / $slots, the globals, and
// whatever the element's place in the tree adds:
//
//   <li :each="item, i in items">  for (const [item, i] of __jq79Each(items)) { const $index = 0 as number; … }
//   @click="…"                     $event, typed by the event's name
//   :slot="{ item }"               the binder's names, in the tag's content
//   :with="user"                   the object's keys, which only the runtime
//                                  knows: unknown names are allowed under it
//
// A name the component doesn't have is "Cannot find name" - unless the
// component declares no signature, where it may be a prop the parent passes,
// and that one diagnostic is dropped (component.ts, ComponentScope).
//
// This is always TypeScript, whatever the scripts are written in: it is the
// template that is being checked, and a JavaScript component's store has the
// types TypeScript infers for it. Its own virtual file, beside the scripts'
// one, which it imports the store's type from.
// ---------------------------------------------------------------------------

import type * as TS from "typescript"
import { CONTROL_ATTRS, EACH_PATTERN, INTERPOLATION_RE, VOID_ELEMENTS, kebabToCamel } from "../../../src/source"
import { FULL, Writer, componentScopes, type Mapping } from "./component"

// ------------------------------------------------------------------ the tree

export type TAttr = { name: string; nameStart: number; value?: string; valueStart?: number }
export type TElement = { tag: string; start: number; attrs: TAttr[]; children: TNode[] }
export type TText = { text: string; start: number }
export type TNode = TElement | TText

const isElement = (node: TNode): node is TElement => "tag" in node

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const readAttrs = (text: string, offset: number): TAttr[] => {
  const attrs: TAttr[] = []
  for (const match of text.matchAll(ATTR_RE)) {
    const nameStart = offset + match.index!
    const at = match[2] !== undefined ? 2 : match[3] !== undefined ? 3 : match[4] !== undefined ? 4 : 0
    if (!at) { attrs.push({ name: match[1], nameStart }); continue }
    const value = match[at]
    attrs.push({ name: match[1], nameStart, value, valueStart: nameStart + match[0].length - value.length - (at === 4 ? 0 : 1) })
  }
  return attrs
}

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

// an open element of these is closed by another of its kind (or, for cells,
// by either kind) - the implicit ends a template writes most
const CLOSED_BY: Record<string, string[]> = {
  li: ["li"], option: ["option"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr"], td: ["td", "th"], th: ["td", "th"], p: ["p"],
}

const TAG_RE = /<!--|<(\/?)([A-Za-z][\w.:-]*)/g

// the file as a tree, with offsets: tolerant the way a browser is in the
// cases a template meets (unclosed <li>, a stray closing tag) and no further.
// <script> and <style> are kept as leaves, their content unread
export const parseTree = (text: string): TNode[] => {
  const root: TElement = { tag: "#root", start: 0, attrs: [], children: [] }
  const stack: TElement[] = [root]
  const top = () => stack[stack.length - 1]
  let at = 0
  const flushText = (end: number) => {
    if (end > at) top().children.push({ text: text.slice(at, end), start: at })
  }
  TAG_RE.lastIndex = 0
  for (let match = TAG_RE.exec(text); match; match = TAG_RE.exec(text)) {
    if (match[0] === "<!--") {
      flushText(match.index)
      const end = text.indexOf("-->", match.index + 4)
      at = end === -1 ? text.length : end + 3
      TAG_RE.lastIndex = at
      continue
    }
    const end = openTagEnd(text, match.index)
    if (end === -1) break
    flushText(match.index)
    at = end + 1
    TAG_RE.lastIndex = at
    const tag = match[2]
    const lower = tag.toLowerCase()

    if (match[1] === "/") {
      const open = stack.map(el => el.tag.toLowerCase()).lastIndexOf(lower)
      if (open > 0) stack.length = open
      continue
    }
    if (CLOSED_BY[top().tag.toLowerCase()]?.includes(lower)) stack.pop()
    const attrsText = text.slice(match.index + match[0].length, text[end - 1] === "/" ? end - 1 : end)
    const el: TElement = { tag, start: match.index, attrs: readAttrs(attrsText, match.index + match[0].length), children: [] }
    top().children.push(el)
    if (lower === "script" || lower === "style") {
      const close = new RegExp(`</${lower}\\s*>`, "ig")
      close.lastIndex = at
      const closed = close.exec(text)
      at = closed ? closed.index + closed[0].length : text.length
      TAG_RE.lastIndex = at
      continue
    }
    // jq79 expands `<X />` to `<X></X>` for any tag (expandSelfClosingTags)
    if (text[end - 1] === "/" || VOID_ELEMENTS.has(lower)) continue
    stack.push(el)
  }
  flushText(text.length)
  return root.children
}

// each component's template: the file's top level for its own, the content of
// its <template name> for the others - the split splitComponents makes
const templates = (tree: TNode[], names: (string | undefined)[]): TNode[][] => {
  const taken = new Set<string>()
  const own = tree.filter(node => {
    if (!isElement(node) || node.tag.toLowerCase() !== "template") return true
    return false
  })
  const byName = new Map<string, TNode[]>()
  for (const node of tree) {
    if (!isElement(node) || node.tag.toLowerCase() !== "template") continue
    const name = node.attrs.find(a => a.name.toLowerCase() === "name")?.value
    if (name === undefined || taken.has(name)) continue
    taken.add(name)
    byName.set(name, node.children)
  }
  return names.map(name => (name === undefined ? own : byName.get(name) ?? []))
}

// ------------------------------------------------------------------ the code

// an expression where an unknown name is not an error: under a :with, or in
// a component that declares no signature
const PERMISSIVE: Mapping["data"] = {
  ...FULL,
  verification: { shouldReport: (_source: unknown, code: unknown) => ![2304, 2552].includes(Number(code)) } as unknown as boolean,
}

const preamble = (module: string): string => [
  `// jq79: what a template's expressions are evaluated against (src/source.ts, withBody)`,
  `import type * as __jq79Scripts from ${JSON.stringify(module)};`,
  // :each takes an array (items, index) or a plain object (values, keys), and
  // renders nothing for anything else
  `declare function __jq79Each<T>(list: readonly T[]): [T, number][];`,
  `declare function __jq79Each(list: null | undefined): [never, never][];`,
  `declare function __jq79Each<T extends object>(object: T): [T[keyof T], string][];`,
  // an inline handler's $event: the DOM's own type for a known event name,
  // and a CustomEvent for any other - a component's $emit, which bubbles to
  // the elements around it too (template-syntax.md). Its target is \`any\`: a
  // handler reads $event.target.value on the input it was written on
  `type __Jq79Event<K extends string> = (K extends keyof HTMLElementEventMap ? HTMLElementEventMap[K] : CustomEvent<any>) & { target: any };`,
  `type __Jq79Emitted = CustomEvent<any> & { target: any };`,
  // what an @event's value may be: a statement-like expression, or a function
  // called with the event - typed by it, so an inline arrow's parameter is
  `declare function __jq79On<E>(event: E, handler: ((event: E) => unknown) | {} | null | undefined | void): void;`,
  // a component tag's props, checked against the props the component takes
  // (component.ts, the \`props\` each component function returns). Partial,
  // because a prop the parent leaves out is \`undefined\` in the child, not an
  // error; NoInfer, so the props written can't widen what is taken. A
  // component whose props are unknown (\`any\`, or no brand) takes anything
  `declare function __jq79Props<P>(component: { readonly __jq79Props?: P } | null | undefined, props: NoInfer<Partial<P>>): void;`,
  `type __Jq79PropsOf<C extends (...args: any) => any> = { readonly __jq79Props?: Awaited<ReturnType<C>>["props"] };`,
  `type __Jq79Injected = { $emit: (name: string, payload?: any) => boolean; $updateModel: (...args: [value?: any] | [name: string, value: any]) => boolean; $slots: Record<string, true> };`,
  `export {};`,
  "",
].join("\n")

export type GeneratedTemplate = { code: string; mappings: Mapping[]; links: Mapping[] }

// the template code for every component of the file at `fileName`, or null
// for a page. `module` is how this code imports the scripts' code: the .html
// file itself, which TypeScript resolves to it
export const generateTemplate = (ts: typeof TS, text: string, module: string): GeneratedTemplate | null => {
  const scopes = componentScopes(ts, text)
  if (!scopes.length) return null
  const trees = templates(parseTree(text), scopes.map(s => s.def.name))
  const out = new Writer(text)
  out.text(preamble(module))
  const siblingIndex = new Map(scopes.flatMap((scope, c) => (scope.def.name ? [[scope.def.name, c] as const] : [])))

  scopes.forEach((scope, c) => {
    const injected = ["$emit", "$updateModel", "$slots"].filter(name => !scope.names.includes(name))
    out.text(`\n// template of ${scope.def.name ?? "the file's own component"}\nasync function __jq79Template${c}() {\n`)
    out.text(`const __s = null as any as Awaited<ReturnType<typeof __jq79Scripts.__jq79Component${c}>>["store"];\n`)
    if (injected.length) out.text(`let { ${injected.join(", ")} } = null as any as __Jq79Injected;\n`)
    // the file's other components in scope, typed with the props they take -
    // which the scripts' store leaves out (see generate, component.ts)
    const siblings = scope.names.filter(name => siblingIndex.has(name))
    siblings.forEach(name => out.text(`let ${name} = null as any as __Jq79PropsOf<typeof __jq79Scripts.__jq79Component${siblingIndex.get(name)}>;\n`))
    // `let`: a template assigns to the store (@click="count = count + 1")
    const stored = scope.names.filter(name => !siblingIndex.has(name))
    // each name linked to the store's property, so a rename crosses over
    if (stored.length) {
      out.text("let { ")
      out.linkedPairs(stored)
      out.text(" } = __s;\n")
    }
    const gen = new TemplateWriter(ts, out, scope.permissive, scope.names)
    trees[c].forEach(node => gen.node(node))
    out.text("}\n")
  })
  return { code: out.code, mappings: out.mappings, links: out.links }
}

const EACH_RE = new RegExp(EACH_PATTERN.source, "d")

// whether an attribute on a component tag is one of its props: a \`:x\` that is
// no directive, a \`:model\`, or a plain attribute (renderNestedComponent).
// Spreads (\`:props\`, \`...x\`) are not: their extra keys are dropped, silently
const isProp = (a: TAttr): boolean => {
  const name = a.name.toLowerCase()
  if (name.startsWith("@") || a.name.startsWith("...")) return false
  if (name === ":model" || name.startsWith(":model.")) return true
  if (name === ":props" || name.startsWith(":props.") || name === ":slot" || name.startsWith(":slot.")) return false
  if (CONTROL_ATTRS.has(name) || name.startsWith(":class.")) return false
  return true
}

// the names an expression reads from its scope: identifiers that are neither
// a property (`a.b`, `{ b: 1 }`) nor bound inside the expression itself (an
// arrow's parameters). Unlike freeIdentifiers (src/transform.ts) it takes
// assignments, which are most of what a :with region does
const freeNames = (ts: typeof TS, expr: string): string[] => {
  const file = ts.createSourceFile("e.ts", `(${expr}\n)`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const bound = new Set<string>()
  const used = new Set<string>()
  const bind = (name: TS.BindingName) => {
    if (ts.isIdentifier(name)) bound.add(name.text)
    else name.elements.forEach(e => { if (!ts.isOmittedExpression(e)) bind(e.name) })
  }
  const visit = (node: TS.Node) => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node)) bind(node.name)
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      const property =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node)
      if (!property) used.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...used].filter(name => !bound.has(name))
}
const SKIP = new Set([":else", ":setup", ":mounted", ":each", ":with", ":slot", "name"])

class TemplateWriter {
  // how many :with regions the writer is inside, and has opened
  private withDepth = 0
  private withCount = 0
  private tagCount = 0
  private names: Set<string>
  constructor(private ts: typeof TS, private out: Writer, private permissive: boolean, names: string[]) {
    this.names = new Set(names)
  }

  // every name the expressions of an element and its subtree read
  private readNames(el: TElement): Set<string> {
    const found = new Set<string>()
    const read = (expr: string) => freeNames(this.ts, expr).forEach(name => found.add(name))
    const walk = (node: TNode) => {
      if (!isElement(node)) {
        for (const match of node.text.matchAll(INTERPOLATION_RE)) read(match[1])
        return
      }
      if (/^(script|style)$/i.test(node.tag)) return
      for (const a of node.attrs) {
        const name = a.name.toLowerCase()
        if (a.name.startsWith("...")) read(a.name.slice(3))
        else if (name === ":each") { const m = EACH_RE.exec(a.value ?? ""); if (m) read(m[3]) }
        else if ((name.startsWith(":") || name.startsWith("@")) && !SKIP.has(name) && a.value?.trim()) read(a.value)
      }
      node.children.forEach(walk)
    }
    for (const a of el.attrs) {
      const name = a.name.toLowerCase()
      if (name !== ":with" && name !== ":each" && (name.startsWith(":") || name.startsWith("@")) && !SKIP.has(name) && a.value?.trim()) read(a.value)
    }
    el.children.forEach(walk)
    return found
  }

  private get data() { return this.permissive || this.withDepth > 0 ? PERMISSIVE : FULL }

  // one expression, as the runtime compiles it: parenthesized, with a newline
  // before the `)` so a trailing `//` comment can't swallow it
  private expression(start: number, end: number) {
    this.out.text("(")
    this.out.copy(start, end, this.data)
    this.out.text("\n);\n")
  }

  node(node: TNode) {
    if (!isElement(node)) return this.text(node)
    const lower = node.tag.toLowerCase()
    if (lower === "script" || lower === "style") return
    this.element(node)
  }

  private text(node: TText) {
    for (const match of node.text.matchAll(INTERPOLATION_RE)) {
      const inner = match[0].indexOf(match[1], 2)
      const start = node.start + match.index! + inner
      this.expression(start, start + match[1].length)
    }
  }

  private element(el: TElement) {
    const attr = (name: string) => el.attrs.find(a => a.name.toLowerCase() === name)
    const component = /^[A-Z]/.test(el.tag) || el.tag.includes("-")
    let blocks = 0

    // :each first: every other attribute of the element is read per item
    const each = attr(":each")
    if (each?.value !== undefined && each.valueStart !== undefined) {
      const match = EACH_RE.exec(each.value)
      if (match?.indices) {
        const at = (group: number) => each.valueStart! + match.indices![group][0]
        const end = (group: number) => each.valueStart! + match.indices![group][1]
        this.out.text("for (const [")
        this.out.copy(at(1), end(1), this.data)
        if (match[2] !== undefined) { this.out.text(", "); this.out.copy(at(2), end(2), this.data) }
        this.out.text("] of __jq79Each(")
        this.out.copy(at(3), end(3), this.data)
        this.out.text("\n)) {\nconst $index = 0 as number; $index;\n")
        blocks++
      }
    }

    // :with is evaluated where the element is, and its keys are in scope for
    // the element's own bindings and everything inside it
    // Which keys the object has is the runtime's to know, so the names the
    // region reads are declared from it - typed by its key where it has one,
    // `any` where it doesn't - except the store's own and what the library
    // provides ($event, $index, …)
    const withAttr = attr(":with")
    if (withAttr?.value !== undefined && withAttr.valueStart !== undefined) {
      const w = `__w${this.withCount++}`
      this.out.text(`{\nconst ${w} = (`)
      this.out.copy(withAttr.valueStart, withAttr.valueStart + withAttr.value.length, this.data)
      this.out.text("\n);\n")
      const names = [...this.readNames(el)].filter(name => !name.startsWith("$") && !this.names.has(name))
      if (names.length) {
        this.out.text("let { ")
        this.out.linkedPairs(names)
        this.out.text(` } = ${w} as typeof ${w} & Record<string, any>;\n`)
      }
      blocks++
      this.withDepth++
    }

    if (component) this.componentTag(el)
    for (const a of el.attrs) {
      if (!component || !isProp(a)) this.attribute(a, component)
    }

    // a slot binder declares names for the content it fills
    const binder = el.attrs.find(a => /^:slot(\.|$)/i.test(a.name))
    let bound = false
    if (binder?.value?.trim() && binder.valueStart !== undefined) {
      this.out.text("{\nconst ")
      this.out.copy(binder.valueStart, binder.valueStart + binder.value.length, this.data)
      this.out.text(" = null as any;\n")
      bound = true
    }

    el.children.forEach(child => this.node(child))

    if (bound) this.out.text("}\n")
    if (withAttr?.value !== undefined && withAttr.valueStart !== undefined) this.withDepth--
    this.out.text("}\n".repeat(blocks))
  }

  // the name in scope a component tag resolves to: a capitalized one that
  // equals the tag once dashes and case are gone (findComponentKey, jq79.ts)
  private resolve(tag: string): string | undefined {
    const normal = tag.replace(/-/g, "").toLowerCase()
    return [...this.names].find(name => /^[A-Z]/.test(name) && name.replace(/-/g, "").toLowerCase() === normal)
  }

  // a component tag's props as one object, checked against the component's:
  // \`:x\` and \`:model.x\` with their expression (\`:x\` alone reads \`x\`), a plain
  // attribute as the string it is - renderNestedComponent's reading. Each key is
  // mapped to its attribute's name, where an undeclared or mistyped prop is
  // reported. A tag that names nothing in scope is reported as the name it
  // reads, where it is an identifier: \`<Buton>\` is "Cannot find name"
  private componentTag(el: TElement) {
    const resolved = this.resolve(el.tag)
    const tagStart = el.start + 1
    const c = `__c${this.tagCount++}`
    this.out.text(`const ${c} = `)
    if (resolved === el.tag) this.out.copy(tagStart, tagStart + el.tag.length, this.data)
    else if (resolved) this.out.text(resolved)
    else if (/^[A-Z][\w$]*$/.test(el.tag)) this.out.copy(tagStart, tagStart + el.tag.length, this.data)
    else this.out.text("null")
    this.out.text(";\n")
    // one object per prop: TypeScript reports only the first unknown key of
    // an object literal, and every misspelt prop should be
    for (const a of el.attrs) {
      if (!isProp(a)) continue
      const name = a.name.toLowerCase()
      const written = name.startsWith(":model.") ? a.name.slice(":model.".length) : name === ":model" ? "model" : name.startsWith(":") ? a.name.slice(1) : a.name
      const keyStart = a.nameStart + a.name.length - written.length
      const key = kebabToCamel(written)
      this.out.text(`__jq79Props(${c}, { `)
      if (/^[A-Za-z_$][\w$]*$/.test(key)) this.out.mapText(keyStart, keyStart + written.length, key, this.data)
      else this.out.text(JSON.stringify(key))
      this.out.text(": ")
      const hasValue = a.value !== undefined && a.valueStart !== undefined && a.value.trim() !== ""
      if (!name.startsWith(":")) this.out.text(JSON.stringify(a.value ?? ""))
      else if (hasValue) { this.out.text("("); this.out.copy(a.valueStart!, a.valueStart! + a.value!.length, this.data); this.out.text("\n)") }
      else if (key === written) { this.out.text("("); this.out.copy(keyStart, keyStart + written.length, this.data); this.out.text(")") }
      else this.out.text(`(${key})`)
      this.out.text(" });\n")
    }
  }

  private attribute(a: TAttr, component: boolean) {
    const name = a.name.toLowerCase()
    if (SKIP.has(name) || /^:slot\./.test(name)) return
    const hasValue = a.value !== undefined && a.valueStart !== undefined && a.value.trim() !== ""

    if (name.startsWith("@")) {
      if (!hasValue) return
      const event = name.slice(1).split(".")[0]
      const type = component ? "__Jq79Emitted" : `__Jq79Event<${JSON.stringify(event)}>`
      this.out.text(`{\nconst $event = null as any as ${type};\n__jq79On($event, (`)
      this.out.copy(a.valueStart!, a.valueStart! + a.value!.length, this.data)
      this.out.text("\n));\n}\n")
      return
    }
    if (a.name.startsWith("...")) {
      this.expression(a.nameStart + 3, a.nameStart + a.name.length)
      return
    }
    if (!name.startsWith(":")) return
    if (hasValue) return this.expression(a.valueStart!, a.valueStart! + a.value!.length)

    // `:user` alone reads `user`; `:model.first-name` alone reads `firstName`.
    // Mapped only where the name is written as the identifier it reads
    if (CONTROL_ATTRS.has(name) || name.startsWith(":class.") || name.startsWith(":props")) return
    const read = name.startsWith(":model.") ? a.name.slice(":model.".length) : name === ":model" ? "model" : a.name.slice(1)
    const offset = a.nameStart + a.name.length - read.length
    if (/^[A-Za-z_$][\w$]*$/.test(read)) this.expression(offset, offset + read.length)
    else this.out.text(`(${kebabToCamel(read)});\n`)
  }
}
