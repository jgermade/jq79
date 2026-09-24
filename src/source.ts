// ---------------------------------------------------------------------------
// what a component's text says, before there is a DOM
//
// The half of the runtime that reads a component as text: the rewrites that
// run before the HTML parser sees it, the directive grammar the renderer reads
// out of attributes and texts, and the exact text each expression and script
// compiles to. Nothing here touches a document, which is what lets it serve
// two entries - the runtime (jq79.ts), and precompile (precompile.ts), which
// has to read a component as the runtime reads it, on node or in a worker, and
// produce exactly what the runtime compiles. Moved out of jq79.ts verbatim, so
// that sharing the code is what keeps the two in step - and so a page that
// never precompiles doesn't carry the generator (RECORD/2026-09-23.no-unsafe-eval.md)
// ---------------------------------------------------------------------------

import { freeIdentifiers, parsePropsPattern, parseFactoryProps, type PropDecl } from "./transform"

export type TemplateNode = {
  tag: string
  attrs: Record<string, string>
  children: (TemplateNode | string)[]
  // the tag as the author capitalized it, present only when they wrote it
  // uppercase-initial - i.e. when they meant a component. `tag` cannot answer
  // this: the HTML parser lowercases it, so the claim is captured before the
  // parse (see stampComponentTag) and lifted off attrs here, where it stops
  // looking like an attribute to every loop downstream
  component?: string
  // the element's namespace, present only when it is NOT HTML - an <svg>
  // subtree, or MathML. Read straight off the parsed tree, because the HTML
  // parser has already run the foreign-content algorithm over it and knows
  // things a tag name cannot say: whether this <title> is SVG's or HTML's, and
  // where a <foreignObject> hands the namespace back. Absent is the common
  // case and means HTML, so an ordinary node is exactly the shape it was
  ns?: string
}

export type TagBlock = {
  attrs: Record<string, string>
  content: string
  // <style scoped> only: `content` rewritten to require the component's scope
  // attribute. Kept beside the original rather than replacing it, because a
  // shadow root doesn't want it - see headStyle()
  scoped?: string
}

export const kebabToCamel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

// the inverse, used only by the pre-parse name rewrite (see expandNameCase):
// uppercase ASCII letters only, never digits - `:props.0` is a generated
// attribute name and splitting on digits would mangle it. Round-trips through
// kebabToCamel, acronyms included: userID -> user-i-d -> userID
export const camelToKebab = (name: string) => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)

export const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

// a self-closing tag with its attributes; quoted attribute values are matched
// as whole chunks so a "/>" inside one doesn't end the tag early. The tag name
// admits a dot for the named forms of a tag - <slot.header /> - which is a
// legal HTML tag name (the tokenizer reads to the first space, "/" or ">")
export const SELF_CLOSING_RE = /<([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\/>/g
export const RAW_BLOCK_RE = /(<script[\s\S]*?<\/script\s*>|<style[\s\S]*?<\/style\s*>)/gi

// expands self-closing tags (<MyComponent />, <div />) into explicit
// open+close pairs BEFORE DOM parsing. The HTML parser ignores the slash and
// would treat them as unclosed, swallowing the following siblings. Void
// elements keep their native behavior, and <script>/<style> contents are
// passed through untouched so code inside them is never rewritten
export const expandSelfClosingTags = (src: string): string =>
  src
    .split(RAW_BLOCK_RE)
    .map((chunk, i) =>
      i % 2 === 1 // odd chunks are the captured script/style blocks
        ? chunk
        : chunk.replace(SELF_CLOSING_RE, (match, tag: string, attrs: string) =>
            VOID_ELEMENTS.has(tag.toLowerCase()) ? match : `<${tag}${attrs}></${tag}>`
          )
    )
    .join("")

// a start tag with its attributes, quote-aware so a ">" inside a value doesn't
// end it early; and a single spread attribute in name position (preceded by
// start-or-whitespace), its expression an identifier or member path
export const OPEN_TAG_RE = /<([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
export const ATTR_SPREAD_RE = /"[^"]*"|'[^']*'|(^|\s)\.\.\.([A-Za-z_$][\w$.]*)/g

// `...expr` as an attribute is sugar for :props="expr" (spread an object's
// properties as props - see renderNestedComponent). Rewritten BEFORE DOM
// parsing, into a value-based :props.<n>, because the HTML parser lowercases
// attribute *names*: with the expression in the name, `...userData` would arrive
// as `...userdata` and resolve to nothing. Moving it into a value - which the
// parser leaves untouched - keeps camelCase intact. Same pre-parse string move
// as expandSelfClosingTags, with the same defenses against rewriting code that
// only looks like a spread: <script>/<style> bodies are split out (a JS `...rest`
// there is not an attribute), only a start tag's interior is scanned (text
// between tags is safe), and quoted values are consumed whole so a genuine JS
// spread in a value (@click="f(...args)", :x="{ ...a }") is skipped. The <n>
// suffix (per tag) only keeps several spreads' attribute names distinct. A call
// (`...getProps()`) stops at the paren and is left alone - use :props="expr()"
export const expandPropsSpread = (src: string): string =>
  src
    .split(RAW_BLOCK_RE)
    .map((chunk, i) =>
      i % 2 === 1
        ? chunk
        : chunk.replace(OPEN_TAG_RE, (_match, tag: string, attrs: string) => {
            let n = 0
            const rewritten = attrs.replace(ATTR_SPREAD_RE, (whole, space: string | undefined, expr: string | undefined) =>
              expr === undefined ? whole : `${space}:props.${n++}="${expr}"`
            )
            return `<${tag}${rewritten}>`
          })
    )
    .join("")

// a `:`-prefixed attribute name in name position, and a </slot.name> closing
// tag. Both quote-aware for the same reason ATTR_SPREAD_RE is: a colon inside
// a value (@click="a ? b : c", style="color: red") is not an attribute name
export const ATTR_NAME_RE = /"[^"]*"|'[^']*'|(^|\s)(:[\w.$-]+)/g
export const CLOSE_SLOT_RE = /<\/slot\.([\w.$-]+)(\s*)>/gi
export const SLOT_TAG_RE = /^slot\./i

// camelCase -> kebab-case for every name the HTML parser would lowercase,
// BEFORE it gets the chance: `:firstName` would arrive as `:firstname` and
// kebabToCamel (which is what reads these names back out) would have nothing
// to un-kebab, so the prop, model or slot would silently land under the wrong
// key. Rewriting to `:first-name` here means both spellings converge on the
// same camelCase name downstream - the author picks, the runtime doesn't care.
//
// Runs FIRST among the pre-parse passes, which is what keeps it simple: it
// never sees the `:props.<n>` that expandPropsSpread generates, and a
// <slot.firstName /> is still one occurrence rather than the open+close pair
// expandSelfClosingTags turns it into. Same defenses as the passes after it -
// <script>/<style> bodies split out, only start-tag interiors scanned, quoted
// values consumed whole.
//
// Three name positions, not one: attribute names (`:model.firstName`), the
// dotted tag names (`<slot.firstName>`) and component tags (`<UserCard>`,
// renamed by componentTagName below). The last two have closing halves that are
// rewritten too, or the parser sees a mismatched pair
export const kebabTagName = (tag: string): string =>
  SLOT_TAG_RE.test(tag) ? `slot.${camelToKebab(tag.slice("slot.".length))}` : tag

// the same pass records what it declined to rewrite. An uppercase-initial tag
// is a claim about a component: HTML's own elements are matched
// case-insensitively but nobody writes <DIV> by accident, and a custom element
// may not be spelled that way at all. So <UserCard> is a name the author
// expected to resolve - which is what lets renderNode throw when it doesn't
// (see unresolvedComponent).
//
// Carried in a *value* rather than left in the tag name, because the value is
// the one place the HTML parser preserves case - the same move expandPropsSpread
// makes for `...userData`, and for the same reason. elementToAST lifts it
// straight off attrs into a field, so no attribute loop downstream ever sees
// it - and since that lift is unconditional, the name has to be one no author
// would write: a plain `:component` would eat the prop of that name off
// <Card :component="Widget" />
export const COMPONENT_TAG_ATTR = ":jq79-component"
export const COMPONENT_TAG_RE = /^[A-Z]/

// A component tag is renamed to a name the HTML parser cannot resolve to an
// element, because a PascalCase tag is lowercased by the parser and what comes
// out is *the native element of that name*: <Circle /> inside an <svg> is a
// circle, <Tr /> is a row placed inside its <tbody>, and 70 of 90 ordinary
// one-word component names collide the same way. The claim the author made -
// this is a component - survives in the stamp, and the tag stops being a name
// anything downstream can mistake for an element's.
//
//   <Circle />    ->  <c79-circle :jq79-component="Circle" />
//   </UserCard>   ->  </c79-user-card>
//
// Hyphenated, and that is not cosmetic: `c79-circle` is a valid custom element
// name, so the parser builds an HTMLElement for it, where `c79circle` would be
// an HTMLUnknownElement. The hyphen is the shape the platform reserves for what
// is not native, which is the principle this rests on applied to our own tags -
// and it reads for itself in the inspector, where a component that resolves to
// nothing leaves <c79-circle> rather than a plausible-looking <circle>.
//
// Every capitalized tag, not only the colliding ones: today's safe name is
// tomorrow's element. See RECORD/2026-08-25.component-tag-prefix.md
export const COMPONENT_TAG_PREFIX = "c79-"

export const componentTagName = (tag: string): string =>
  `${COMPONENT_TAG_PREFIX}${camelToKebab(tag[0].toLowerCase() + tag.slice(1))}`

export const rewriteTagName = (tag: string): string =>
  COMPONENT_TAG_RE.test(tag) ? componentTagName(tag) : kebabTagName(tag)

// the closing half of the rename. OPEN_TAG_RE matches open tags only, which was
// fine while both ends lowercased to the same name; rename one end and not the
// other and `<c79-circle>` gets closed by `</circle>`, nesting everything that
// follows inside it. </slot.x> keeps its own pass - it is lowercase and
// unaffected by this one
export const CLOSE_COMPONENT_RE = /<\/([A-Z][\w.-]*)(\s*)>/g

// appends the stamp inside the tag, *before* a self-closing slash: this pass
// runs first and expandSelfClosingTags still has to recognize the `/>` that
// OPEN_TAG_RE swept into the attributes. A slash inside a quoted value can't be
// mistaken for it - only a trailing one is matched
export const TRAILING_SLASH_RE = /\/\s*$/

export const stampComponentTag = (tag: string, attrs: string): string => {
  if (!COMPONENT_TAG_RE.test(tag)) return attrs
  const stamp = ` ${COMPONENT_TAG_ATTR}="${tag}"`
  const slash = TRAILING_SLASH_RE.exec(attrs)
  return slash ? `${attrs.slice(0, slash.index)}${stamp}${slash[0]}` : `${attrs}${stamp}`
}

export const expandNameCase = (src: string): string =>
  src
    .split(RAW_BLOCK_RE)
    .map((chunk, i) =>
      i % 2 === 1
        ? chunk
        : chunk
            .replace(OPEN_TAG_RE, (_match, tag: string, attrs: string) => {
              const rewritten = attrs.replace(ATTR_NAME_RE, (whole, space: string | undefined, name: string | undefined) =>
                name === undefined ? whole : `${space}${camelToKebab(name)}`
              )
              return `<${rewriteTagName(tag)}${stampComponentTag(tag, rewritten)}>`
            })
            .replace(CLOSE_SLOT_RE, (_match, suffix: string, space: string) => `</slot.${camelToKebab(suffix)}${space}>`)
            .replace(CLOSE_COMPONENT_RE, (_match, tag: string, space: string) => `</${componentTagName(tag)}${space}>`)
    )
    .join("")

// all three pre-parse rewrites, in their load-bearing order (see
// parseComponentString) - shared with precompile, which reads the same text
export const prepareSource = (component: string): string => expandSelfClosingTags(expandPropsSpread(expandNameCase(component)))

// a component name has to be PascalCase to be usable: findComponentKey only
// ever considers capitalized scope keys, so a lowercase name would declare a
// component no tag could reference. It is also what keeps the named exports
// from colliding with a definition's own fields, which are all lowercase
export const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/

// [\s\S] rather than `.` so an expression can span lines, like the ones in
// directive attributes (which reach evalExpr wrapped in parens either way)
export const INTERPOLATION_RE = /{{\s*([\s\S]+?)\s*}}/g

// A text template split once into its literal and expression parts. The split
// used to happen on every run of every instance - `String.replace` over the
// whole text, a fresh match object and a callback per expression - and a
// :each over 1,000 rows runs it 1,000 times per text node to reach the same
// answer about the same string. Keyed by the template text, like compileExpr's
// cache and bounded the same way: by how many distinct texts the source holds
//
// An expression part is boxed so a literal `"x"` and an expression `x` stay
// distinguishable without a second array
export type TextPart = string | { expr: string }

export const textParts = new Map<string, TextPart[]>()

export const splitText = (template: string): TextPart[] => {
  const cached = textParts.get(template)
  if (cached) return cached
  const parts: TextPart[] = []
  let at = 0
  INTERPOLATION_RE.lastIndex = 0
  for (let match = INTERPOLATION_RE.exec(template); match; match = INTERPOLATION_RE.exec(template)) {
    if (match.index > at) parts.push(template.slice(at, match.index))
    parts.push({ expr: match[1] })
    at = match.index + match[0].length
  }
  if (at < template.length) parts.push(template.slice(at))
  textParts.set(template, parts)
  return parts
}

export const CONTROL_ATTRS = new Set([":class", ":value", ":checked", ":selected", ":if", ":elseif", ":else", ":each", ":key", ":with", ":text", ":html", ":html.allowed", ":props"])

// a control attribute is one the static-attr loop and nested-component prop
// collection must skip. The set holds the fixed names; `:class.<name>` (the
// single-flag shorthand) and `:props.<n>` (one spread among several) are
// open-ended, so they're matched by prefix - they can't be enumerated into the set
export const isControlAttr = (attr: string): boolean =>
  CONTROL_ATTRS.has(attr) || attr.startsWith(":class.") || attr.startsWith(":props.") ||
  attr === ":slot" || attr.startsWith(":slot.")
// `item in items`, `item, i in items`, `(value, key) in props` - the second
// binding is the array index or the object key, parens optional (Vue-style).
// The list expression can span lines, so it matches [\s\S] rather than `.`
export const EACH_PATTERN = /^\s*\(?\s*(\w+)\s*(?:,\s*(\w+))?\s*\)?\s+in\s+([\s\S]+)$/

// <slot>, <slot.header-bar>: the hole and its name. Names arrive kebab-case
// whichever way they were authored (the HTML parser lowercases tag names and
// attribute modifiers alike, so expandNameCase normalizes camelCase to kebab
// before parsing) and are camelCase where read - <slot.header-bar> and
// <slot.headerBar> are :slot.header-bar is $slots.headerBar
export const isSlotTag = (tag: string): boolean => tag === "slot" || tag.startsWith("slot.")

export const slotName = (suffix: string): string => (suffix ? kebabToCamel(suffix) : "default")

// a :model's way back up: its expression as an assignment target. The newline
// keeps `= $value` out of a trailing line comment in the expression
// (:model="uname // the username") - glued on the same line, the assignment
// would vanish into the comment and compile as a bare read, dropping every
// update without a word
export const assignment = (expr: string) => `${expr}\n= $value`

// the newline before `)` ends a trailing line comment in the expression
// ({{ msg // greeting }}); ASI doesn't apply inside parens, so everything else
// is untouched. Without it the comment eats the rest of this single-line body
// and the expression never compiles
// the text of the two forms an expression compiles to, and the parameters in
// front of its extras - one place, because precompile has to produce exactly
// what the runtime hands makeFunction, or its functions are never looked up
export const EXPR_PARAMS = ["$scope", "$r"]

export const withBody = (expr: string): string => `with ($scope) { return (${expr}\n); }`

// the scoped form: each free name read off the scope in a `const` prologue -
// see compileScoped (jq79.ts) for what it buys and what it risks. null where
// freeIdentifiers won't vouch for the names - the `with` form's case
export const scopedBody = (expr: string, params: string[]): string | null => {
  const free = freeIdentifiers(expr)
  if (free === null) return null
  // an extra is already a parameter of this function: declaring it again would
  // shadow the value the caller passed in
  const names = free.filter(name => !params.includes(name))
  const prologue = names.length === 0 ? "" : `let $t; ${names.map(name =>
    `const ${name} = ($t = $scope.${name}) !== undefined ? $t : $r($scope, ${JSON.stringify(name)});`).join(" ")}`
  return `${prologue} return (${expr}\n);`
}

// a parameter name can't contain a newline, so the key is unambiguous
export const functionKey = (params: string[], body: string): string => `${params.join(",")}\n${body}`

// a `:mounted` script is deferred by prepending the await on the code's own
// first line, so deferring doesn't shift the lines devtools reports for it
export const defer = (code: string) => `await $mounted();${code}`

// what the two kinds of script compile to, shared with precompile for the
// reason the expression forms are
export const setupParams = (helperNames: string[]): string[] => ["$scope", "$__effect", "$__import", "$__state", ...helperNames]
export const setupBody = (code: string): string => `return (async () => { with ($scope) { ${code} }\n;$__state.done = true })()`
export const factoryParams = (helperNames: string[]): string[] => ["$__exports", "$__default", "$__import", ...helperNames]
export const factoryBody = (code: string): string => `return (async () => { "use strict";\n${code}\n;$__exports.done = true })()`

// the same answer without the warning - what precompile reads, which has
// nobody to warn and would otherwise say it once per build
export const readSetupSignature = (script: TagBlock): PropDecl[] | null => {
  const pattern = script.attrs[":setup"]
  if (pattern === undefined) return null
  if (pattern.trim() === "") return []
  return parsePropsPattern(pattern)
}

// every prop name a component's scripts declare, across both script modes.
// Read before the store exists, because what a component declares decides
// which of its file's sibling components it can still see: declaring a name
// says it comes from the parent, so the file's own definition of that name is
// deliberately not in this component's scope. The runtime reads the setup
// signatures with setupSignature, which warns; precompile, with readSetupSignature
export const declaredPropNames = (scripts: TagBlock[], signature: (script: TagBlock) => PropDecl[] | null): Set<string> => {
  const names = new Set<string>()
  scripts.forEach(script => {
    const declarations = parseFactoryProps(script.content) ?? signature(script)
    declarations?.forEach(({ name }) => names.add(name))
  })
  return names
}

// the names every setup and factory script is compiled with, in the order
// renderWith passes them: SETUP_HELPERS (whose values live in jq79.ts, beside
// the functions they are) and then the per-instance ones it builds -
// $mounted, $self and $$self, then the injected $emit, $updateModel and
// $slots. They are positional parameters, so the order is part of what
// precompile has to reproduce; change one side and precompiled scripts stop
// matching, which tests/precompile.test.ts and `npm run check:precompile` catch
export const SETUP_HELPER_NAMES = ["$", "$$", "$create", "$reactive", "$toRaw", "Component79"]
export const INSTANCE_HELPER_NAMES = ["$mounted", "$self", "$$self", "$emit", "$updateModel", "$slots"]
