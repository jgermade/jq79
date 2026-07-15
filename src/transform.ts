// ---------------------------------------------------------------------------
// :setup script transform
//
// setup scripts are written like Svelte components:
//
//   let firstName = null
//   $: fullName = `${firstName} ${lastName}`
//   fetchUser().then(user => { firstName = user.firstName })
//
// and are executed inside `with ($scope)` against the component's reactive
// store, so plain assignments (even from async callbacks) go through the
// proxy's set trap and re-render whatever depends on them. To make that work
// the source is lightly rewritten - no full JS parser, just a scanner that is
// string/comment-aware and only touches code at brace/paren depth 0:
// - `let/var/const x = ...` at the top level loses its keyword, becoming a
//   scope assignment (the name is pre-declared on the store so the `with`
//   lookup resolves it)
// - `$: x = expr` becomes `$__effect(() => { x = expr })`, re-running when a
//   dependency read inside expr changes ($__effect is deliberately NOT a
//   property of the scope, so `with` falls through to the function parameter)
// ---------------------------------------------------------------------------

type SetupTransform = { vars: string[]; code: string }

// a declaration whose target is an identifier (`let x`), an object pattern
// (`let { a }`, space optional) or an array pattern (`let [x]`)
const DECLARATION_START_RE = /(?:let|var|const)(?:\s+(?=[A-Za-z_$])|\s*(?=[{[]))/y
const REACTIVE_LABEL_RE = /\$:\s*/y
const IMPORT_CALL_RE = /import(?=\s*\()/y
const REACTIVE_ASSIGN_RE = /\$:\s*([A-Za-z_$][\w$]*)\s*=(?!=)/y

const skipString = (src: string, start: number): number => {
  const quote = src[start]
  let i = start + 1
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue }
    if (src[i] === quote) return i + 1
    i++
  }
  return src.length
}

const skipLineComment = (src: string, start: number): number => {
  const end = src.indexOf("\n", start)
  return end === -1 ? src.length : end
}

const skipBlockComment = (src: string, start: number): number => {
  const end = src.indexOf("*/", start + 2)
  return end === -1 ? src.length : end + 2
}

// index of the next thing that isn't whitespace or a comment
const skipToToken = (src: string, start: number): number => {
  let i = start
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue }
    if (src[i] === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue }
    if (src[i] === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue }
    break
  }
  return i
}

// ---------------------------------------------------------------------------
// regex literals. The scanners walk the source counting bracket depth, and a
// regex walked as if it were code poisons that count: `split(/\//)` puts two
// slashes side by side (a line comment, as far as a scanner knows) and the
// `)` after them is skipped uncounted; `/[(]/` inflates the depth for good.
// So a `/` that opens a regex is consumed whole - and whether it opens one is
// the classic lexer call, made the way every tokenizer makes it: by what came
// before. Division needs a completed expression on its left; everywhere else
// a `/` can only be a regex.
// ---------------------------------------------------------------------------

// reserved words a regex can follow. Reserved only - `of` is not (`const of
// = 4; of / 2` is legal division), so `for (x of /re/)` stays unrescued
// rather than risking real code
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "case", "in", "instanceof", "new", "delete", "void", "do", "else", "yield", "await",
])

// whether a `/` at `at` opens a regex literal rather than a division: looks
// backward past whitespace and block comments for the last meaningful thing.
// A completed expression - identifier, number, closing quote or bracket,
// postfix ++/-- - takes division; a reserved word or any other punctuator
// admits a regex. Only consulted for the rare `/` that is neither `//` nor
// `/*`, so the scanners pay nothing on the common path
const regexAllowed = (src: string, at: number): boolean => {
  let i = at - 1
  while (i >= 0) {
    const ch = src[i]
    if (/\s/.test(ch)) { i--; continue }
    if (ch === "/" && src[i - 1] === "*") {
      const open = src.lastIndexOf("/*", i - 2)
      if (open === -1) return true // an unopened comment tail: malformed input
      i = open - 1
      continue
    }
    break
  }
  if (i < 0) return true // the start of the source starts an expression
  const ch = src[i]
  if (/[\w$]/.test(ch)) {
    let start = i
    while (start > 0 && /[\w$]/.test(src[start - 1])) start--
    return REGEX_AFTER_WORD.has(src.slice(start, i + 1))
  }
  if ((ch === "+" || ch === "-") && src[i - 1] === ch) return false // postfix ++/--
  return !")]}\"'`.".includes(ch)
}

// consumes a regex literal (with its flags): backslash escapes, and character
// classes, where an unescaped `/` doesn't close the literal (`/[/]/` is one
// regex). A literal can't contain an unescaped newline, so hitting one means
// the classification was wrong or the input malformed - stop there, bounding
// any damage to a single line
const skipRegex = (src: string, start: number): number => {
  let i = start + 1
  let inClass = false
  while (i < src.length) {
    const ch = src[i]
    if (ch === "\\") { i += 2; continue }
    if (ch === "\n") return i
    if (ch === "[") inClass = true
    else if (ch === "]") inClass = false
    else if (ch === "/" && !inClass) {
      i++
      while (i < src.length && /[a-z]/i.test(src[i])) i++ // flags
      return i
    }
    i++
  }
  return src.length
}

// tokens that can't *start* a statement, so a line beginning with one is
// continuing the previous expression rather than opening a new statement -
// the same call JS's automatic semicolon insertion makes. Unary-only forms
// (!, ~, ++, --) are deliberately absent: those do start a statement, and JS
// inserts the semicolon before them
const CONTINUATION_RE = /^(\?\.|\?\?|&&|\|\||\*\*|[.,+\-*/%&|^<>=?:([])/

// the last meaningful character before `at`: walks back past whitespace and
// block comments, the way regexAllowed does. A line comment can't be skipped
// from behind (its start is only findable forwards), so a line ending in one
// reports the comment's text instead - callers treat that as "not the char I
// was looking for", which degrades to ending the statement, exactly as
// before this helper existed
const lastMeaningfulBefore = (src: string, at: number): string => {
  let i = at - 1
  while (i >= 0) {
    const ch = src[i]
    if (/\s/.test(ch)) { i--; continue }
    if (ch === "/" && src[i - 1] === "*") {
      const open = src.lastIndexOf("/*", i - 2)
      if (open === -1) return ""
      i = open - 1
      continue
    }
    return ch
  }
  return ""
}

// end of a statement starting at `start`: the first `;` or line break that
// isn't inside a string/comment or unbalanced brackets. A line break only
// ends the statement if the next line can't continue it, so leading-dot
// method chains and multi-line operator chains stay in one piece:
//
//   $: total = items
//     .filter(item => item.active)      <- still the same statement
//     .length
//
// ...and only if the current line *can* end it: a line whose last meaningful
// character is `,` or `=` left its expression incomplete (a multi-line
// declarator list writes exactly this), so the statement continues - the
// same ASI call as the leading-token check, made from the other side
const findStatementEnd = (src: string, start: number): number => {
  let depth = 0
  let i = start
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(src, i); continue }
    if (ch === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue }
    if (ch === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue }
    if (ch === "/" && regexAllowed(src, i)) { i = skipRegex(src, i); continue }
    if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch)) depth--
    else if (depth <= 0 && ch === ";") return i
    else if (depth <= 0 && ch === "\n") {
      const next = skipToToken(src, i + 1)
      const continues =
        next < src.length &&
        (CONTINUATION_RE.test(src.slice(next, next + 2)) || [",", "="].includes(lastMeaningfulBefore(src, i)))
      if (!continues) return i
      i = next
      continue
    }
    i++
  }
  return src.length
}

// ---------------------------------------------------------------------------
// top-level declarations. `let x = 1` loses its keyword and becomes a scope
// assignment (x pre-declared on the store). A destructuring declarator
// becomes an *assignment pattern*: inside `with`, `({ a, b } = obj)` writes
// every binding through the reactive proxy - which is what makes it reactive.
// The parens keep the `{` from opening a block, and a leading `;` keeps the
// `(` from gluing onto the previous line as a call. Multi-declarator
// statements (`let a = 1, b = 2`) register every binding, not just the first.
// These lean on the pattern helpers defined with the props signature below
// (splitTopLevel, indexOfTopLevel, defaultAssignIndex); the scanner only
// runs long after the module evaluates, so the order is cosmetic
// ---------------------------------------------------------------------------

type Declarator = { raw: string; codeEnd: number }

// splits a declarator list at top-level commas, keeping each segment's raw
// text (layout and comments included) and where its last meaningful token
// ends - the spot a closing paren must go, so a trailing comment can't
// swallow it
const splitDeclarators = (src: string): Declarator[] => {
  const parts: Declarator[] = []
  let depth = 0
  let start = 0
  let lastEnd = 0
  const flush = (end: number) => {
    parts.push({ raw: src.slice(start, end), codeEnd: Math.max(0, lastEnd - start) })
    start = end + 1
    lastEnd = start
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(src, i); lastEnd = i; continue }
    if (ch === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue }
    if (ch === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue }
    if (ch === "/" && regexAllowed(src, i)) { i = skipRegex(src, i); lastEnd = i; continue }
    if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch)) depth--
    else if (ch === "," && depth <= 0) { flush(i); i++; continue }
    if (!/\s/.test(ch)) lastEnd = i + 1
    i++
  }
  flush(src.length)
  return parts
}

// the *binding* names a destructuring pattern declares - unlike
// parsePropsPattern, which answers "which props" (the keys), this answers
// "which variables": `{ a: x }` binds x, `{ a: { b } }` binds b,
// `[x, ...rest]` binds x and rest. Defaults are stripped; what remains is a
// nested pattern (recurse) or the bound identifier
const patternBindings = (src: string): string[] => {
  const pattern = src.trim()
  if (!pattern.startsWith("{") && !pattern.startsWith("[")) {
    return IDENTIFIER_RE.test(pattern) ? [pattern] : []
  }
  const names: string[] = []
  for (let part of splitTopLevel(pattern.slice(1, patternCloseIndex(pattern)))) {
    if (part.startsWith("...")) part = part.slice(3).trim()
    const assign = defaultAssignIndex(part)
    if (assign !== -1) part = part.slice(0, assign).trim()
    if (pattern.startsWith("{")) {
      const colon = indexOfTopLevel(part, ":")
      if (colon !== -1) {
        names.push(...patternBindings(part.slice(colon + 1)))
        continue
      }
    }
    names.push(...patternBindings(part))
  }
  return names
}

// one `let/var/const` declarator list, rewritten to scope assignments.
// Each segment's initializer is re-scanned so an `import()` inside it is
// rewritten like anywhere else - nothing else can match in there, since a
// nested top-level declaration inside a declarator is a SyntaxError in JS
const rewriteDeclarators = (src: string): SetupTransform => {
  const vars: string[] = []
  const rewritten = splitDeclarators(src).map(({ raw, codeEnd }) => {
    const lead = raw.match(/^\s*/)![0]
    if (codeEnd <= lead.length) return { text: raw, empty: true }
    const body = raw.slice(lead.length, codeEnd)
    const tail = raw.slice(codeEnd)
    const assign = defaultAssignIndex(body)
    const target = (assign === -1 ? body : body.slice(0, assign)).trim()
    const isPattern = body[0] === "{" || body[0] === "["
    if (isPattern) vars.push(...patternBindings(target))
    else if (IDENTIFIER_RE.test(target)) vars.push(target)
    const code = transformSetupScript(body).code
    return { text: `${lead}${isPattern ? `(${code})` : code}${tail}`, empty: false }
  })

  // a trailing comment-only segment (`let a = 1, // note` cut at its line
  // end) is re-attached without its comma, so the output stays a statement
  const tail: string[] = []
  while (rewritten.length && rewritten[rewritten.length - 1].empty) tail.unshift(rewritten.pop()!.text)
  let code = rewritten.map(part => part.text).join(",") + tail.join("")
  if (code.trimStart().startsWith("(")) code = `;${code}`
  return { vars, code }
}

export const transformSetupScript = (src: string): SetupTransform => {
  const vars: string[] = []
  let out = ""
  let i = 0
  let depth = 0
  let atStatementStart = true

  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]

    if (ch === "'" || ch === '"' || ch === "`") {
      const end = skipString(src, i)
      out += src.slice(i, end)
      i = end
      atStatementStart = false
      continue
    }
    if (ch === "/" && (next === "/" || next === "*")) {
      const end = next === "/" ? skipLineComment(src, i) : skipBlockComment(src, i)
      out += src.slice(i, end)
      i = end
      continue
    }
    if (ch === "/" && regexAllowed(src, i)) {
      const end = skipRegex(src, i)
      out += src.slice(i, end)
      i = end
      atStatementStart = false
      continue
    }

    // `import(...)` is a keyword form, so it can't be intercepted through the
    // scope - rewrite the identifier to the injected $__import (which loads
    // .html URLs as components via Component79.fetch and delegates the rest to
    // native import). The `(` is left for the scanner so depth stays balanced
    if (ch === "i" && (i === 0 || !/[\w$.]/.test(src[i - 1]))) {
      IMPORT_CALL_RE.lastIndex = i
      if (IMPORT_CALL_RE.test(src)) {
        out += "$__import"
        i += "import".length
        atStatementStart = false
        continue
      }
    }

    if (depth === 0 && atStatementStart) {
      DECLARATION_START_RE.lastIndex = i
      const decl = DECLARATION_START_RE.exec(src)
      if (decl) {
        const start = i + decl[0].length
        const end = findStatementEnd(src, start)
        const { vars: names, code } = rewriteDeclarators(src.slice(start, end))
        vars.push(...names)
        out += code
        i = end
        atStatementStart = false
        continue
      }

      REACTIVE_LABEL_RE.lastIndex = i
      const label = REACTIVE_LABEL_RE.exec(src)
      if (label) {
        REACTIVE_ASSIGN_RE.lastIndex = i
        const assign = REACTIVE_ASSIGN_RE.exec(src)
        if (assign) vars.push(assign[1])
        const start = i + label[0].length
        const end = findStatementEnd(src, start)
        // the body is re-scanned rather than sliced raw, so an `import()`
        // inside it gets the $__import rewrite like anywhere else. Safe to
        // recurse: strings/comments/regexes copy through unchanged, and a
        // depth-0 declaration inside a labeled statement is a SyntaxError
        // in JS anyway, so nothing else can rewrite
        out += `$__effect(() => { ${transformSetupScript(src.slice(start, end)).code} });`
        i = end
        continue
      }
    }

    if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1)

    if (ch === "\n" || ch === ";" || ch === "}") atStatementStart = true
    else if (!/\s/.test(ch)) atStatementStart = false

    out += ch
    i++
  }

  return { vars, code: out }
}

// ---------------------------------------------------------------------------
// factory scripts - a <script> whose top level has `export default` runs as a
// plain lexical module instead of a `with`-scoped setup script: no implicit
// reactivity, no `$:` labels - standard JS that editors and type-checkers
// understand. The default export is called with the instance context
// ({ $data, $effect, $emit, $mounted, $self, $$self }) and a returned object
// is merged into the reactive store for the template to use.
// Detection is backwards-safe: `export default` is a SyntaxError inside a
// setup script, so no previously-working component can change behavior.
// The same scanner rewrites the module-only syntax into a Function body:
// - `export default X`      -> `$__exports.default = X`
// - `import d from "m"`     -> `const d = $__default(await $__import("m"))`
//   (and the other static clause forms), so imports resolve through the same
//   $__import as setup scripts: bundler map first, then fetch/native import
// ---------------------------------------------------------------------------

const EXPORT_DEFAULT_RE = /export\s+default(?![\w$])/y
// clause (default/namespace/named, no quotes or parens) + specifier; the
// no-clause alternative requires the specifier right away, so dynamic
// `import(...)` and `import.meta` never match
const STATIC_IMPORT_RE = /import\s*(?:([\w$\s,{}*]+?)\s*from\s*)?(["'])([^"'\n]+)\2/y

// splits an import clause on top-level commas: `d, { a, b as c }` keeps the
// braced group together
const splitImportClause = (clause: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= clause.length; i++) {
    const ch = clause[i]
    if (ch === "{") depth++
    else if (ch === "}") depth--
    else if (i === clause.length || (ch === "," && depth === 0)) {
      const part = clause.slice(start, i).trim()
      if (part) parts.push(part)
      start = i + 1
    }
  }
  return parts
}

// one static import statement -> const bindings from the awaited module
const staticImportToAwait = (clause: string | undefined, spec: string, n: number): string => {
  const source = `await $__import(${JSON.stringify(spec)})`
  if (clause === undefined) return source // side-effect import
  const parts = splitImportClause(clause)
  const bindings: string[] = []
  let ref = source
  if (parts.length > 1) {
    const tmp = `$__mod${n}`
    bindings.push(`${tmp} = ${source}`)
    ref = tmp
  }
  for (const part of parts) {
    if (part.startsWith("{")) bindings.push(`${part.replace(/\s+as\s+/g, ": ")} = ${ref}`)
    else if (part.startsWith("*")) bindings.push(`${part.replace(/^\*\s*as\s+/, "")} = ${ref}`)
    else bindings.push(`${part} = $__default(${ref})`)
  }
  return `const ${bindings.join(", ")}`
}

// ---------------------------------------------------------------------------
// the component's prop signature
//
// A component declares the props it takes as a destructuring pattern, in the
// place each script mode already puts its inputs: the `:setup` attribute's
// value, or the factory's *first* parameter (the ctx moved to the second).
// Position is fixed, so the signature is read straight from the source string -
// no parser, no execution - and the runtime can seed the defaults on the store
// before the first render, which is what makes them reach the template even in
// factory mode (where JS would only apply them inside the function body).
//
//   <script :setup="{ label = 'Total', step = 1 }">
//   export default ({ label = "Total" }, { $data }) => {}
//
// An object pattern *is* the declaration; anything else (`_`, a plain
// identifier, no attribute at all) declares nothing and stays permissive.
// ---------------------------------------------------------------------------

export type PropDecl = { name: string; default?: string }

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/

// index of the bracket that closes the one opening at src[0], skipping
// strings, comments and regex literals; src.length when unbalanced
const patternCloseIndex = (src: string): number => {
  let depth = 0
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(src, i); continue }
    if (ch === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue }
    if (ch === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue }
    if (ch === "/" && regexAllowed(src, i)) { i = skipRegex(src, i); continue }
    if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch) && --depth === 0) return i
    i++
  }
  return src.length
}

// index of the first `ch` at bracket depth 0, skipping strings and comments
const indexOfTopLevel = (src: string, ch: string): number => {
  let depth = 0
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === "'" || c === '"' || c === "`") { i = skipString(src, i); continue }
    if (c === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue }
    if (c === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue }
    if (c === "/" && c !== ch && regexAllowed(src, i)) { i = skipRegex(src, i); continue }
    if ("([{".includes(c)) depth++
    else if (")]}".includes(c)) depth--
    else if (depth === 0 && c === ch) return i
    i++
  }
  return -1
}

const splitTopLevel = (src: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i <= src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(src, i); continue }
    if (ch === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue }
    if (ch === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue }
    if (ch === "/" && regexAllowed(src, i)) { i = skipRegex(src, i); continue }
    if (ch !== undefined && "([{".includes(ch)) depth++
    else if (ch !== undefined && ")]}".includes(ch)) depth--
    else if (i === src.length || (ch === "," && depth === 0)) {
      const part = src.slice(start, i).trim()
      if (part) parts.push(part)
      start = i + 1
    }
    i++
  }
  return parts
}

// the `=` that opens a default value: the first one at depth 0 that isn't part
// of `==`/`===` or an arrow's `=>` (so `{ format = a => a }` keeps its default)
const defaultAssignIndex = (src: string): number => {
  let from = 0
  while (from < src.length) {
    const at = indexOfTopLevel(src.slice(from), "=")
    if (at === -1) return -1
    const i = from + at
    if (src[i + 1] !== "=" && src[i + 1] !== ">" && src[i - 1] !== "=" && src[i - 1] !== "!") return i
    from = i + 1
  }
  return -1
}

// a destructuring pattern -> the props it declares. null means "no signature":
// the pattern isn't an object one (`_`, `props`, nothing at all), so the
// component declares nothing and keeps the permissive, undeclared behavior.
// `{}` parses to [] - a closed signature that declares zero props
export const parsePropsPattern = (pattern: string | undefined): PropDecl[] | null => {
  const src = (pattern ?? "").trim()
  if (!src.startsWith("{")) return null

  // to the `}` that closes the pattern, so a parameter's own default value
  // (`({ label } = {})`) is left out of it
  const close = patternCloseIndex(src)
  if (close >= src.length) return null // unbalanced: not a pattern we can read

  const props: PropDecl[] = []
  for (const part of splitTopLevel(src.slice(1, close))) {
    if (part.startsWith("...")) continue // a rest element names no prop
    const assign = defaultAssignIndex(part)
    const named = assign === -1 ? part : part.slice(0, assign)
    const fallback = assign === -1 ? undefined : part.slice(assign + 1).trim()
    // `{ user: { id } }` and `{ user: renamed }` both declare `user`: what the
    // store holds is the key, whatever the pattern binds it to
    const colon = indexOfTopLevel(named, ":")
    const name = (colon === -1 ? named : named.slice(0, colon)).trim()
    if (!IDENTIFIER_RE.test(name)) continue
    props.push(fallback === undefined ? { name } : { name, default: fallback })
  }
  return props
}

// index just past a top-level `export default`, or -1
const findExportDefault = (src: string): number => {
  let i = 0
  let depth = 0
  let atStatementStart = true
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(src, i); atStatementStart = false; continue }
    if (ch === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue }
    if (ch === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue }
    if (ch === "/" && regexAllowed(src, i)) { i = skipRegex(src, i); atStatementStart = false; continue }

    if (ch === "e" && depth === 0 && atStatementStart && (i === 0 || !/[\w$.]/.test(src[i - 1]))) {
      EXPORT_DEFAULT_RE.lastIndex = i
      const found = EXPORT_DEFAULT_RE.exec(src)
      if (found) return i + found[0].length
    }

    if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1)
    if (ch === "\n" || ch === ";" || ch === "}") atStatementStart = true
    else if (!/\s/.test(ch)) atStatementStart = false
    i++
  }
  return -1
}

const ASYNC_RE = /^async(?![\w$])/
const FUNCTION_RE = /^function(?![\w$])\s*\*?\s*[A-Za-z_$][\w$]*|^function(?![\w$])\s*\*?/

// source text of the exported function's first parameter, or null when there
// is no parameter list to read (`export default Factory`, `export default
// props => ...`, an exported object) - all of which declare nothing
const firstParameterSource = (src: string): string | null => {
  const start = findExportDefault(src)
  if (start === -1) return null

  let i = skipToToken(src, start)
  const rest = src.slice(i)
  if (ASYNC_RE.test(rest)) i = skipToToken(src, i + "async".length)
  const fn = FUNCTION_RE.exec(src.slice(i))
  if (fn) i = skipToToken(src, i + fn[0].length)
  if (src[i] !== "(") return null

  // the parameter list runs to the `)` that closes this `(`
  let depth = 0
  let end = i
  while (end < src.length) {
    const ch = src[end]
    if (ch === "'" || ch === '"' || ch === "`") { end = skipString(src, end); continue }
    if (ch === "/" && src[end + 1] === "/") { end = skipLineComment(src, end); continue }
    if (ch === "/" && src[end + 1] === "*") { end = skipBlockComment(src, end); continue }
    if (ch === "/" && regexAllowed(src, end)) { end = skipRegex(src, end); continue }
    if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch) && --depth === 0) break
    end++
  }
  return splitTopLevel(src.slice(i + 1, end))[0] ?? ""
}

// the props declared by a factory script's first parameter. Throws the
// migration error when it finds the pre-0.4 signature there - the ctx used to
// be the first parameter, and the change is silent otherwise ($data would just
// come back undefined). `$` is what tells them apart: what carries one comes
// from the library, what doesn't comes from the parent, everywhere in jq79
export const parseFactoryProps = (src: string): PropDecl[] | null => {
  const first = firstParameterSource(src)
  if (first === null) return null
  const props = parsePropsPattern(first)
  const ctxName = props?.find(prop => prop.name.startsWith("$"))?.name
  if (ctxName) {
    throw new Error(
      `jq79: the factory signature is (props, ctx), so \`${ctxName}\` can't be destructured from the first parameter. ` +
      `Write \`export default (props, { ${ctxName} }) => …\`, or \`_\` in place of props if the component takes none.`
    )
  }
  return props
}

// rewrites a factory script into a Function body, or returns null when the
// script has no top-level `export default` (i.e. it's a regular setup script)
export const transformFactoryScript = (src: string): string | null => {
  let out = ""
  let i = 0
  let depth = 0
  let atStatementStart = true
  let isFactory = false
  let modCount = 0

  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    const atWordBoundary = i === 0 || !/[\w$.]/.test(src[i - 1])

    if (ch === "'" || ch === '"' || ch === "`") {
      const end = skipString(src, i)
      out += src.slice(i, end)
      i = end
      atStatementStart = false
      continue
    }
    if (ch === "/" && (next === "/" || next === "*")) {
      const end = next === "/" ? skipLineComment(src, i) : skipBlockComment(src, i)
      out += src.slice(i, end)
      i = end
      continue
    }
    if (ch === "/" && regexAllowed(src, i)) {
      const end = skipRegex(src, i)
      out += src.slice(i, end)
      i = end
      atStatementStart = false
      continue
    }

    if (ch === "i" && atWordBoundary) {
      // dynamic import() -> $__import, same rewrite as setup scripts
      IMPORT_CALL_RE.lastIndex = i
      if (IMPORT_CALL_RE.test(src)) {
        out += "$__import"
        i += "import".length
        atStatementStart = false
        continue
      }
      if (depth === 0 && atStatementStart) {
        STATIC_IMPORT_RE.lastIndex = i
        const staticImport = STATIC_IMPORT_RE.exec(src)
        if (staticImport) {
          out += staticImportToAwait(staticImport[1], staticImport[3], modCount++)
          i += staticImport[0].length
          atStatementStart = false
          continue
        }
      }
    }

    if (ch === "e" && atWordBoundary && depth === 0 && atStatementStart) {
      EXPORT_DEFAULT_RE.lastIndex = i
      const exportDefault = EXPORT_DEFAULT_RE.exec(src)
      if (exportDefault) {
        isFactory = true
        out += "$__exports.default ="
        i += exportDefault[0].length
        atStatementStart = false
        continue
      }
    }

    if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1)

    if (ch === "\n" || ch === ";" || ch === "}") atStatementStart = true
    else if (!/\s/.test(ch)) atStatementStart = false

    out += ch
    i++
  }

  return isFactory ? out : null
}

