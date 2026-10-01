// ---------------------------------------------------------------------------
// completion and hover in a component's tags
//
// Where TypeScript has nothing to say - the name of an attribute not yet
// written, the name of a tag - this plugin offers what jq79 reads there:
//
//   <li :|          the directives, as snippets (:if="…", :each="… in …", :class="…")
//   <li @|          events, and after `@click.` the modifiers
//   <Card :|        the props Card declares, typed: TypeScript's own answer for
//                   the __jq79Props check the template's code already makes
//   <script :|      :setup, :mounted, lang="ts"      <style |   scoped, lang="scss"
//   <C|             the components in scope
//
// and a line of documentation on hovering a directive. An attribute's value
// is TypeScript's (it is mapped code), and HTML's own attributes are the
// editor's HTML service's: the editor shows both lists together.
// ---------------------------------------------------------------------------

import type { CompletionItem, InsertTextFormat, LanguageServicePlugin, LanguageServiceContext } from "@volar/language-service"
import type * as TS from "typescript"
import { URI } from "vscode-uri"
import { componentScopes, splitComponents } from "./component"
import { literalsIn } from "./language"
import { parseTree, type TElement, type TNode } from "./template"

const DOCS = "https://github.com/jgermade/jq79/blob/main/docs/template-syntax.md"

type Directive = { name: string; snippet: string; doc: string }

// what template-syntax.md documents, in the order a reader meets it
const DIRECTIVES: Directive[] = [
  { name: ":if", snippet: ':if="$1"', doc: "Renders the element only while the expression is truthy. Starts a chain that `:elseif` and `:else` siblings continue." },
  { name: ":elseif", snippet: ':elseif="$1"', doc: "The next branch of the `:if` chain this element follows." },
  { name: ":else", snippet: ":else", doc: "The branch of the `:if` chain that renders when no other did. Closes the chain." },
  { name: ":each", snippet: ':each="${1:item} in ${2:items}"', doc: "Renders the element once per item: `item in items`, `item, i in items`, `(value, key) in object`. `$index` is in scope inside." },
  { name: ":key", snippet: ':key="$1"', doc: "What identifies an item of the `:each` on this element, so a reorder keeps its DOM." },
  { name: ":with", snippet: ':with="$1"', doc: "Puts the object's properties in scope for this element and everything inside it." },
  { name: ":class", snippet: ':class="$1"', doc: "Classes on top of the static `class`: a string, an object of `class: condition`, or an array of both." },
  { name: ":text", snippet: ':text="$1"', doc: "Sets the element's `textContent`." },
  { name: ":html", snippet: ':html="$1"', doc: "Sets the element's `innerHTML`, sanitized. `:html.allowed` restricts where its links and images may point." },
  { name: ":html.allowed", snippet: ':html.allowed="$1"', doc: "The destinations `:html`'s links and images may point to: host patterns, or a predicate." },
  { name: ":value", snippet: ':value="$1"', doc: "Drives a form control's `value` property, not its attribute." },
  { name: ":checked", snippet: ':checked="$1"', doc: "Drives a checkbox's or radio's `checked` property." },
  { name: ":selected", snippet: ':selected="$1"', doc: "Drives an option's `selected` property." },
]

// on a component's tag, besides its props
const COMPONENT_DIRECTIVES: Directive[] = [
  { name: ":model", snippet: ':model="$1"', doc: "Two-way binding: passes the expression as the prop `model`, and assigns it what the child sends with `$updateModel(value)`." },
  { name: ":props", snippet: ':props="$1"', doc: "Spreads an object as props. The keys the component doesn't declare are dropped, without a warning." },
  { name: ":slot", snippet: ':slot="{ $1 }"', doc: "Names the slot props the content between the tags reads: `:slot=\"{ item }\"`." },
]

const SCRIPT_ATTRIBUTES: Directive[] = [
  { name: ":setup", snippet: ':setup="{ $1 }"', doc: "A setup script. Its value is the props the component takes, as a destructuring pattern; `:setup` alone takes none, `:setup=\"_\"` any." },
  { name: ":mounted", snippet: ":mounted", doc: "Runs the script after the component is mounted, instead of before its first render." },
  { name: "lang", snippet: 'lang="ts"', doc: "`lang=\"ts\"`: the script is TypeScript, compiled by the Vite plugin." },
]

const STYLE_ATTRIBUTES: Directive[] = [
  { name: "scoped", snippet: "scoped", doc: "Applies the rules to this component's own elements only." },
  { name: "lang", snippet: 'lang="${1|scss,less,sass,styl|}"', doc: "The language the styles are written in, compiled by the Vite plugin." },
]

const TEMPLATE_ATTRIBUTES: Directive[] = [
  { name: "name", snippet: 'name="$1"', doc: "At the top of a file: another component of the file, under this name." },
]

// the events a template listens to most, then the modifiers (template-syntax.md)
const EVENTS = [
  "click", "dblclick", "input", "change", "submit", "keydown", "keyup", "focus", "blur", "focusin", "focusout",
  "mouseenter", "mouseleave", "mousedown", "mouseup", "mousemove", "pointerdown", "pointerup", "pointermove",
  "contextmenu", "wheel", "scroll", "dragstart", "dragover", "drop", "load", "error", "reset", "toggle",
]
const MODIFIERS: Record<string, string> = {
  prevent: "Calls `event.preventDefault()`.",
  stop: "Calls `event.stopPropagation()`.",
  self: "Only when `event.target` is the element itself.",
  once: "Runs at most once.",
  capture: "Listens in the capture phase.",
}

const isComponentTag = (tag: string) => /^[A-Z]/.test(tag) || tag.includes("-")

// ------------------------------------------------------------------ where the cursor is

type Where =
  | { kind: "tag"; fragment: string }
  | { kind: "attribute"; tagStart: number; tag: string; fragment: string; present: Set<string> }

const ATTRIBUTE_NAME_RE = /(?:^|\s)([^\s"'<>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g

// what is being written at `offset`: a tag's name, an attribute's name in an
// open tag, or something this plugin has nothing for (text, a value, a
// comment, a script's or style's content)
export const whereAt = (text: string, offset: number): Where | undefined => {
  const lt = text.lastIndexOf("<", offset - 1)
  if (lt === -1) return undefined
  if (text.lastIndexOf("<!--", offset) > text.lastIndexOf("-->", offset)) return undefined
  const inRawText = splitComponents(text).some(c => [...c.scripts, ...c.styles].some(b => offset > b.contentStart && offset <= b.contentEnd))
  if (inRawText) return undefined
  const before = text.slice(lt, offset)
  const tagName = /^<([A-Za-z][\w.-]*)?$/.exec(before)
  if (tagName) return { kind: "tag", fragment: tagName[1] ?? "" }
  const open = /^<([A-Za-z][\w.:-]*)\s/.exec(before)
  if (!open) return undefined
  let quote = ""
  for (const ch of before) {
    if (quote) { if (ch === quote) quote = ""; continue }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === ">") return undefined
  }
  if (quote) return undefined
  const fragment = /(?:^|\s)([^\s"'<>/=]*)$/.exec(before)
  if (!fragment) return undefined
  // the whole open tag, for the attributes it already has
  let end = offset
  for (quote = ""; end < text.length; end++) {
    const ch = text[end]
    if (quote) { if (ch === quote) quote = ""; continue }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === ">" || ch === "<") break
  }
  const present = new Set<string>()
  const attrs = text.slice(lt + open[0].length - 1, end)
  const typedAt = offset - fragment[1].length - (lt + open[0].length - 1)
  for (const match of attrs.matchAll(ATTRIBUTE_NAME_RE)) {
    const start = match.index! + match[0].indexOf(match[1])
    if (start !== typedAt) present.add(match[1].toLowerCase())
  }
  return { kind: "attribute", tagStart: lt, tag: open[1], fragment: fragment[1], present }
}

// ------------------------------------------------------------------ the text a position is in

// a component's text the cursor is in - an .html component's, or a literal's
// as the runtime receives it - with where the cursor is in it, the way back to
// the document, and the template code TypeScript knows it by
type Source = {
  uri: URI
  text: string
  index: number
  toDocument: (index: number) => number
  templateId: string
  templateFile: string
}

// ------------------------------------------------------------------ what a tag's component carries

// the brand on the variable the template's code checks a component tag
// against (template.ts, componentTag): `__jq79Props`, `__jq79Emits` or
// `__jq79Slots`, as TypeScript types it (component.ts, __Jq79Typed)
const brandOf = (ts: typeof TS, context: LanguageServiceContext, source: Source, tagStart: number, property: string) => {
  const script = context.language.scripts.get(source.uri)
  const template = script?.generated?.root.embeddedCodes?.find(code => code.id === source.templateId) as { jq79Tags?: { start: number; variable: string }[] } | undefined
  const variable = template?.jq79Tags?.find(tag => tag.start === tagStart)?.variable
  const languageService = context.inject<{ "typescript/languageService": () => TS.LanguageService }>("typescript/languageService")
  if (!variable || !languageService) return undefined
  const program = languageService.getProgram()
  const file = program?.getSourceFile(source.templateFile)
  if (!program || !file) return undefined
  let declaration: TS.VariableDeclaration | undefined
  const find = (node: TS.Node) => {
    if (declaration) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variable) declaration = node
    else ts.forEachChild(node, find)
  }
  find(file)
  if (!declaration) return undefined
  const checker = program.getTypeChecker()
  const brand = checker.getTypeAtLocation(declaration.name).getProperty(property)
  if (!brand) return undefined
  const type = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(brand, declaration))
  if (type.flags & ts.TypeFlags.Any) return undefined
  return { checker, declaration, type }
}

type Prop = { name: string; type: string; optional: boolean; doc: string }

// the props the component at a tag takes, typed
const propsOf = (ts: typeof TS, context: LanguageServiceContext, source: Source, tagStart: number): Prop[] | undefined => {
  const found = brandOf(ts, context, source, tagStart, "__jq79Props")
  if (!found) return undefined
  const { checker, declaration, type } = found
  return checker.getPropertiesOfType(type)
    .filter(p => !p.name.startsWith("__jq79"))
    .map(p => ({
      name: p.name,
      type: checker.typeToString(checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(p, declaration))),
      optional: (p.flags & ts.SymbolFlags.Optional) !== 0,
      doc: ts.displayPartsToString(p.getDocumentationComment(checker)),
    }))
}

// the names a union of string literals holds: what the component at a tag
// emits, or the slots it renders
const namesOf = (ts: typeof TS, context: LanguageServiceContext, source: Source, tagStart: number, property: string): string[] => {
  const found = brandOf(ts, context, source, tagStart, property)
  if (!found || found.type.flags & ts.TypeFlags.Never) return []
  const types = found.type.isUnion() ? found.type.types : [found.type]
  return types.filter(t => t.isStringLiteral()).map(t => (t as TS.StringLiteralType).value)
}

// the element whose open tag starts at `start`, and the one it is in
const parentOf = (nodes: TNode[], start: number, parent?: TElement): TElement | undefined | null => {
  for (const node of nodes) {
    if (!("tag" in node)) continue
    if (node.start === start) return parent ?? null
    if (node.start < start && (node.end ?? Infinity) > start) return parentOf(node.children, start, node)
  }
  return undefined
}

// the last place in the file a literal's characters up to `i` have (an escape
// writes characters the file has no single place for)
const lastKnown = (at: number[], i: number): number | undefined => {
  for (let j = Math.min(i, at.length - 1); j >= 0; j--) if (at[j] !== -1) return at[j]
  return undefined
}

// ------------------------------------------------------------------ the plugin

const SNIPPET = 2 satisfies InsertTextFormat
type Kind = NonNullable<CompletionItem["kind"]>
const KIND = { property: 10 as Kind, keyword: 14 as Kind, event: 23 as Kind, class: 7 as Kind }

export const createJq79TemplateService = (ts: typeof TS): LanguageServicePlugin => ({
  name: "jq79-template",
  capabilities: {
    completionProvider: { triggerCharacters: [":", "@", ".", "<"] },
    hoverProvider: true,
  },
  create(context) {
    // the component text at `offset` of a root code: an .html component's
    // whole text, or the literal the offset is in, in a page or a script
    const sourceAt = (uri: string, offset: number): Source | undefined => {
      const decoded = context.decodeEmbeddedDocumentUri(URI.parse(uri))
      if (!decoded || decoded[1] !== "root") return undefined
      const script = context.language.scripts.get(decoded[0])
      const asFileName = context.project.typescript?.uriConverter.asFileName
      if (!script || !asFileName) return undefined
      const text = script.snapshot.getText(0, script.snapshot.getLength())
      const fileName = asFileName(decoded[0])
      if (script.languageId === "html" && script.generated?.root.embeddedCodes?.some(code => code.id === "template")) {
        return { uri: decoded[0], text, index: offset, toDocument: i => i, templateId: "template", templateFile: `${fileName}.template.ts` }
      }
      const literals = literalsIn(ts, script.languageId, text)
      for (const [n, literal] of literals.entries()) {
        const at = literal.at
        const end = (lastKnown(at, at.length - 1) ?? -2) + 1
        const index = offset === end ? at.length : at.indexOf(offset)
        if (index === -1) continue
        return {
          uri: decoded[0],
          text: literal.text,
          index,
          // a position the literal's text has no character of (an escape) is
          // the nearest one before it that it has
          toDocument: i => (i >= at.length ? end : lastKnown(at, i) ?? at.find(a => a !== -1)!),
          templateId: `literal${n}_template`,
          templateFile: `${fileName}.literal${n}.template.ts`,
        }
      }
      return undefined
    }

    return {
      provideCompletionItems(document, position) {
        const source = sourceAt(document.uri, document.offsetAt(position))
        if (!source) return undefined
        const where = whereAt(source.text, source.index)
        if (!where) return undefined
        const range = { start: document.positionAt(source.toDocument(source.index - where.fragment.length)), end: position }
        const items: CompletionItem[] = []
        const add = (label: string, kind: Kind, newText: string, doc?: string, detail?: string, sort = "1") =>
          items.push({ label, kind, detail, documentation: doc ? { kind: "markdown", value: doc } : undefined, insertTextFormat: SNIPPET, textEdit: { range, newText }, sortText: `${sort}${label}` })

        if (where.kind === "tag") {
          // the components the text's components have in scope, by name
          const names = new Set(componentScopes(ts, source.text).flatMap(scope => scope.names).filter(name => /^[A-Z]/.test(name)))
          names.forEach(name => add(name, KIND.class, name, undefined, "component"))
          return { isIncomplete: false, items }
        }

        const tag = where.tag.toLowerCase()
        const offer = (list: Directive[]) => list
          .filter(d => !where.present.has(d.name.toLowerCase()))
          .forEach(d => add(d.name, KIND.keyword, d.snippet, `${d.doc}\n\n[jq79 template syntax](${DOCS})`, "jq79"))

        if (tag === "script") offer(SCRIPT_ATTRIBUTES)
        else if (tag === "style") offer(STYLE_ATTRIBUTES)
        else if (tag === "template") {
          // in a component's tag, the content for one of its named slots
          const parent = parentOf(parseTree(source.text), where.tagStart)
          if (parent && isComponentTag(parent.tag)) {
            namesOf(ts, context, source, parent.start, "__jq79Slots")
              .filter(name => !where.present.has(`:slot.${name}`.toLowerCase()))
              .forEach(name => add(`:slot.${name}`, KIND.property, `:slot.${name}`, `The content for <${parent.tag}>'s \`<slot.${name}>\`. A value names the slot props it reads: \`:slot.${name}="{ item }"\`.`, "jq79 slot", "0"))
          } else if (parent === null) offer(TEMPLATE_ATTRIBUTES)
        } else if (where.fragment.startsWith("@")) {
          const dot = where.fragment.indexOf(".")
          if (dot !== -1) {
            // modifiers, after what is written so far
            const written = where.fragment.slice(0, where.fragment.lastIndexOf(".") + 1)
            const used = new Set(where.fragment.slice(dot + 1).split("."))
            Object.entries(MODIFIERS).filter(([m]) => !used.has(m))
              .forEach(([m, doc]) => add(`${written}${m}`, KIND.event, `${written}${m}`, doc, "jq79 modifier"))
          } else if (isComponentTag(where.tag)) {
            // on a component's tag, what it emits
            namesOf(ts, context, source, where.tagStart, "__jq79Emits")
              .filter(name => !where.present.has(`@${name}`.toLowerCase()))
              .forEach(name => add(`@${name}`, KIND.event, `@${name}="$1"`, `What <${where.tag}> emits as \`$emit("${name}", …)\`; the payload is \`$event.detail\`.`, "jq79 emitted event", "0"))
          } else {
            EVENTS.filter(e => !where.present.has(`@${e}`))
              .forEach(e => add(`@${e}`, KIND.event, `@${e}="$1"`, `Listens to \`${e}\`, with \`$event\` in scope.`, "jq79 event"))
          }
        } else {
          if (isComponentTag(where.tag)) {
            const props = propsOf(ts, context, source, where.tagStart)
            const model = where.fragment.toLowerCase().startsWith(":model.")
            props?.filter(p => !where.present.has(`:${p.name}`.toLowerCase()) && !where.present.has(p.name.toLowerCase()))
              .forEach(p => {
                const label = model ? `:model.${p.name}` : `:${p.name}`
                add(label, KIND.property, `${label}="$1"`, p.doc || undefined, `${p.name}${p.optional ? "?" : ""}: ${p.type}`, "0")
              })
            if (!model) offer(COMPONENT_DIRECTIVES)
          }
          offer(DIRECTIVES)
        }
        return { isIncomplete: false, items }
      },

      provideHover(document, position) {
        const source = sourceAt(document.uri, document.offsetAt(position))
        if (!source) return undefined
        // the attribute name the cursor is on: what is written up to it, and on to its end
        const tail = /^[^\s"'<>/=]*/.exec(source.text.slice(source.index))![0]
        const where = whereAt(source.text, source.index + tail.length)
        if (!where || where.kind !== "attribute") return undefined
        const name = where.fragment
        const tag = where.tag.toLowerCase()
        const list = tag === "script" ? SCRIPT_ATTRIBUTES : tag === "style" ? STYLE_ATTRIBUTES : [...COMPONENT_DIRECTIVES, ...DIRECTIVES]
        const directive = list.find(d => d.name === name.toLowerCase()) ??
          (name.startsWith(":class.") ? { name, snippet: "", doc: "Toggles the class named after the dot while the expression is truthy." } : undefined) ??
          (name.startsWith(":model.") ? { name, snippet: "", doc: "Two-way binding of the prop named after the dot." } : undefined)
        let value: string | undefined
        if (directive) value = `**${name}** - ${directive.doc}\n\n[jq79 template syntax](${DOCS})`
        else if (name.startsWith("@")) {
          const [event, ...modifiers] = name.slice(1).split(".")
          value = `**@${event}** - listens to \`${event}\`, with \`$event\` in scope` +
            modifiers.filter(m => MODIFIERS[m]).map(m => `\n\n\`.${m}\`: ${MODIFIERS[m]}`).join("")
        }
        if (!value) return undefined
        const end = source.index + tail.length
        return {
          contents: { kind: "markdown", value },
          range: { start: document.positionAt(source.toDocument(end - name.length)), end: document.positionAt(source.toDocument(end)) },
        }
      },
    }
  },
})
