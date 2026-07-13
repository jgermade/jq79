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

const DECLARATION_RE = /(?:let|var|const)\s+([A-Za-z_$][\w$]*)/y
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

// end of a statement starting at `start`: the first newline or `;` that isn't
// inside a string/comment or unbalanced brackets, so multi-line RHS like a
// wrapped function call or template literal stays in one piece
const findStatementEnd = (src: string, start: number): number => {
  let depth = 0
  let i = start
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(src, i); continue }
    if (ch === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue }
    if (ch === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue }
    if ("([{".includes(ch)) depth++
    else if (")]}".includes(ch)) depth--
    else if (depth <= 0 && (ch === "\n" || ch === ";")) return i
    i++
  }
  return src.length
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
      DECLARATION_RE.lastIndex = i
      const decl = DECLARATION_RE.exec(src)
      if (decl) {
        vars.push(decl[1])
        out += decl[1]
        i += decl[0].length
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
        out += `$__effect(() => { ${src.slice(start, end)} });`
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

