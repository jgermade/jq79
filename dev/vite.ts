import { readFile } from "node:fs/promises"
import { relative } from "node:path"
import { preprocessCSS, transformWithEsbuild } from "vite"
import type { Plugin, ResolvedConfig } from "vite"

// Vite plugin: import .html single-file components as modules.
//
//   import { jq79 } from "jq79/vite"          // vite.config
//   import UserCard from "./UserCard.html"    // app code
//
// The imported value is a Component79 built from the file's source - the same
// thing `await Component79.fetch(url)` resolves to, but bundled at build time
// instead of fetched at runtime. The component source is inlined verbatim, so
// a file keeps working unchanged if it's ever served from public/ and loaded
// with fetch instead - with one deliberate exception, `lang`: <style lang="scss">
// (or less/stylus/sass) is compiled to plain CSS here, and <script lang="ts"> to
// plain JS. A component using `lang` therefore only works through the bundler;
// loaded with fetch() it would reach the runtime uncompiled, which the runtime
// warns about.
//
// Only .html files imported from other modules are claimed; entry points
// (index.html) have no importer and imports carrying an explicit query
// (?raw, ?url) keep their built-in Vite meaning.

export interface Jq79PluginOptions {
  // which import specifiers are treated as components (default: any .html)
  include?: RegExp
  // resolved absolute paths to skip even when `include` matches
  exclude?: RegExp
}

// claimed modules get this suffix so their id no longer ends in ".html" and
// Vite's own html handling (entries, asset pipeline) leaves them alone
const COMPONENT_QUERY = "?jq79"

// a <script> block with its attribute string, so `lang` can be read and the
// body replaced - the same shape as STYLE_BLOCK_RE below, quote-aware so a
// ">" inside an attribute value (`:setup="{ n = a > 1 }"`) doesn't end the tag
const SCRIPT_BLOCK_RE = /<script((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi
// import("...") with a literal specifier, tried at word boundaries the
// scanner below reaches (which is what skips $__import and foo.import(...))
const IMPORT_CALL_RE = /import\s*\(\s*(["'])([^"'\n]+?)\1\s*\)/y
// static import statements (factory scripts): optional clause + literal
// specifier. The clause can't contain parens/quotes, so dynamic import()
// and import.meta never match
const STATIC_IMPORT_RE = /import\s*(?:[\w$\s,{}*]+?\s*from\s*)?(["'])([^"'\n]+)\1/y

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

// the literal import specifiers in one script body. A scanner rather than a
// bare matchAll, because a specifier mentioned in a comment or a string is
// not an import: hoisting a commented-out `import("./old.html")` would pull
// dead files into the bundle - or break the build once the file is gone
const importSpecifiers = (script: string): string[] => {
  const specs: string[] = []
  let i = 0
  while (i < script.length) {
    const ch = script[i]
    if (ch === "'" || ch === '"' || ch === "`") { i = skipString(script, i); continue }
    if (ch === "/" && script[i + 1] === "/") {
      const end = script.indexOf("\n", i)
      i = end === -1 ? script.length : end + 1
      continue
    }
    if (ch === "/" && script[i + 1] === "*") {
      const end = script.indexOf("*/", i + 2)
      i = end === -1 ? script.length : end + 2
      continue
    }
    if (ch === "i" && (i === 0 || !/[\w$.]/.test(script[i - 1]))) {
      IMPORT_CALL_RE.lastIndex = i
      const call = IMPORT_CALL_RE.exec(script)
      if (call) { specs.push(call[2]); i = IMPORT_CALL_RE.lastIndex; continue }
      STATIC_IMPORT_RE.lastIndex = i
      const staticImport = STATIC_IMPORT_RE.exec(script)
      if (staticImport) { specs.push(staticImport[2]); i = STATIC_IMPORT_RE.lastIndex; continue }
    }
    i++
  }
  return specs
}

const isHtmlUrl = (spec: string) => /\.html?([?#]|$)/.test(spec)
const isExternalUrl = (spec: string) => /^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith("/")

// literal import specifiers in the component's script blocks - dynamic
// `import("...")` calls and static factory-script imports - that should
// resolve from the bundle instead of at runtime. Absolute paths and full
// URLs are left alone (they point at served files, e.g. public/), and so
// are .html specifiers the plugin wouldn't claim as components
const hoistableImports = (source: string, include: RegExp): string[] => {
  const specifiers = new Set<string>()
  for (const [, , script] of source.matchAll(SCRIPT_BLOCK_RE)) {
    for (const spec of importSpecifiers(script)) {
      if (isExternalUrl(spec)) continue
      if (isHtmlUrl(spec) && !include.test(spec)) continue // html left to runtime fetch
      specifiers.add(spec) // a claimed component, a source file or an npm package
    }
  }
  return [...specifiers]
}

// any start or end tag, quote-aware so a ">" inside an attribute value doesn't
// end it early
const TAG_RE = /<(\/?)([A-Za-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
const NAME_ATTR_RE = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i
const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

// the components a file declares: its *top-level* <template name="…"> blocks,
// which the emitted module re-exports by name. Depth is tracked because only
// the top level declares - a <template> nested in the markup is a plain inert
// element the runtime leaves alone, and exporting it would name something that
// never exists. Script and style bodies are cut out first, so a "<" in JS or a
// selector can't be read as a tag
const declaredComponents = (source: string): string[] => {
  const markup = source.replace(SCRIPT_BLOCK_RE, "").replace(STYLE_BLOCK_RE, "")
  const names: string[] = []
  let depth = 0

  for (const [, closing, tag, attrs] of markup.matchAll(TAG_RE)) {
    if (closing) {
      depth = Math.max(0, depth - 1)
      continue
    }
    const selfClosing = /\/\s*$/.test(attrs) || VOID_ELEMENTS.has(tag.toLowerCase())
    if (depth === 0 && !selfClosing && tag.toLowerCase() === "template") {
      const declared = attrs.match(NAME_ATTR_RE)
      const name = declared?.[1] ?? declared?.[2]
      // the runtime warns about the ones this skips (nameless, not PascalCase)
      if (name && COMPONENT_NAME_RE.test(name)) names.push(name)
    }
    if (!selfClosing) depth++
  }
  return names
}

// a <style> block with its attribute string, so `lang` can be read and the
// content replaced. Attribute values are matched as quoted chunks so a ">"
// inside one doesn't end the tag early
const STYLE_BLOCK_RE = /<style((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/style\s*>/gi
const LANG_ATTR_RE = /\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

// compiles <style lang="scss|less|styl|sass"> blocks to plain CSS with Vite's
// own preprocessing (the same call @vitejs/plugin-vue makes), so the runtime
// only ever sees CSS. The preprocessor picks its parser from the extension,
// and resolving relative @use/@import against a filename in the component's
// own directory is what makes `@use "./vars"` work. Files the preprocessor
// pulls in are registered as watch deps, so editing a partial re-runs HMR for
// every component that uses it. `lang` is dropped from the emitted tag: what
// the runtime parses is a plain <style> (with `scoped` and the rest intact)
const compileStyleBlocks = async (
  source: string,
  file: string,
  config: ResolvedConfig,
  addWatchFile: (id: string) => void
): Promise<string> => {
  const blocks = [...source.matchAll(STYLE_BLOCK_RE)]
  const compiled = await Promise.all(
    blocks.map(async ([, attrs, content]) => {
      const lang = attrs.match(LANG_ATTR_RE)
      if (!lang) return null
      const extension = lang[1] ?? lang[2] ?? lang[3]
      const result = await preprocessCSS(content, `${file}.${extension}`, config)
      result.deps?.forEach(addWatchFile)
      return { attrs: attrs.replace(LANG_ATTR_RE, "").trimEnd(), css: result.code }
    })
  )

  let out = ""
  let last = 0
  blocks.forEach((block, i) => {
    const done = compiled[i]
    if (!done) return
    out += source.slice(last, block.index) + `<style${done.attrs}>${done.css}</style>`
    last = block.index + block[0].length
  })
  return out + source.slice(last)
}

// languages a <script lang> is compiled from. Anything else is left as written
// for the runtime to warn about, rather than guessed at
const TS_LANGS = new Set(["ts", "typescript"])

type ViteTransform = (code: string, id: string, options?: unknown) => Promise<{ code: string }>

// what strips the types: vite's own transform, so the plugin carries no
// compiler of its own. *Which* transform is a version question, and neither
// answer covers the peer range (vite >= 5) alone - transformWithOxc is the one
// vite is moving to but only exists from vite 7, while transformWithEsbuild is
// deprecated under vite 8 and throws there unless esbuild is installed
// separately. So it is looked up at call time: oxc where it exists, esbuild on
// the older versions that ship it.
//
// Both drop unused value imports by default, because a TS transform can't tell
// a type-only import from an unused one. That would be silent damage here: a
// factory script's `import Row from "./row.html"` would vanish, taking with it
// the specifier hoistableImports needs to pull the child into the bundle. The
// flags below are what keep it - only `import type` is erased
const stripTypes = async (ts: string, file: string): Promise<string> => {
  const vite = (await import("vite")) as unknown as { transformWithOxc?: ViteTransform }
  const { code } = vite.transformWithOxc
    ? await vite.transformWithOxc(ts, file, { lang: "ts", typescript: { onlyRemoveTypeImports: true } })
    : await transformWithEsbuild(ts, file, {
      loader: "ts",
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
    })
  // a script whose only imports were `import type` comes back marked as a
  // module. `export {}` exports nothing, and it is a SyntaxError inside the
  // Function body the runtime compiles a script into
  return code.replace(/^[ \t]*export\s*\{\s*\}\s*;?[ \t]*$/m, "")
}

// the `:setup` attribute, when it carries a value (a bare `:setup` is the
// closed signature and can't be typed)
const SETUP_ATTR_RE = /(:setup\s*=\s*)(?:"([^"]*)"|'([^']*)')/i
// the arrow body the signature is wrapped in, so the parameter list can be
// found again in the output without matching brackets
const SIGNATURE_MARKER = "__jq79_signature__"

// a component's props signature lives in the `:setup` *attribute*, not in the
// script body, so the body's transform never sees it - and `lang="ts"` has to
// mean the same thing on both halves of the block, or a typed signature either
// survives into a component the plugin just promised was JS or, for `_: Props`,
// stops reading as a signature at all.
//
// It goes through the same transform as everything else, wrapped as a
// parameter list, rather than being cut with a scanner of its own: the
// annotation can sit on the pattern (`{ a }: Props`), on the permissive `_`, or
// inside a default (`{ step = 1 as number }`, which the runtime would evaluate
// and silently drop), and telling those apart is a parser's job. Both transforms
// hand back `(<params>) => <marker>` on one line, parens intact
const stripSignatureTypes = async (value: string, file: string): Promise<string> => {
  const compiled = await stripTypes(`(${value}) => ${SIGNATURE_MARKER}`, file)
  const marker = compiled.indexOf(SIGNATURE_MARKER)
  if (marker === -1) return value // not the shape expected: leave it as written
  const head = compiled.slice(0, marker).trimEnd()
  const params = (head.endsWith("=>") ? head.slice(0, -2) : head).trim()
  return params.startsWith("(") && params.endsWith(")") ? params.slice(1, -1).trim() : params
}

// the signature back into a double-quoted attribute. Only `"` needs escaping:
// the transforms normalize string literals to double quotes, so a default the
// author wrote as `'x'` comes back as `"x"` and would end the attribute early.
// `&` is deliberately left alone - `&&` in a default is not an entity and
// survives the parse, while escaping it would double-encode a source that
// already wrote `&quot;`
const quoteAttrValue = (value: string) => value.replace(/"/g, "&quot;")

// compiles <script lang="ts"> blocks to plain JS, so the runtime only ever sees
// JS - the same deal <style lang="scss"> gets, for a sharper reason. The setup
// scanner is not a parser: `let count: number = 0` reaching it is not a syntax
// error but a labeled statement that assigns to `number`, so it runs and leaves
// `count` undeclared. `lang` is dropped from the emitted tag and every other
// attribute (`:setup`, `:mounted`) is left as written.
//
// This runs before hoistableImports reads the source, so an `import type`
// specifier is already gone by the time the plugin decides what to bundle
const compileScriptBlocks = async (source: string, file: string): Promise<string> => {
  const blocks = [...source.matchAll(SCRIPT_BLOCK_RE)]
  const compiled = await Promise.all(
    blocks.map(async ([, attrs, content]) => {
      const lang = attrs.match(LANG_ATTR_RE)
      const name = (lang?.[1] ?? lang?.[2] ?? lang?.[3])?.toLowerCase()
      if (!name || !TS_LANGS.has(name)) return null

      let rest = attrs.replace(LANG_ATTR_RE, "").trimEnd()
      const setup = rest.match(SETUP_ATTR_RE)
      if (setup) {
        const signature = await stripSignatureTypes(setup[2] ?? setup[3], `${file}.signature.ts`)
        // a function replacement, not a string: `$&` and friends are live in a
        // replacement string and a default value is arbitrary source
        rest = rest.replace(SETUP_ATTR_RE, () => `${setup[1]}"${quoteAttrValue(signature)}"`)
      }

      return { attrs: rest, js: await stripTypes(content, `${file}.ts`) }
    })
  )

  let out = ""
  let last = 0
  blocks.forEach((block, i) => {
    const done = compiled[i]
    if (!done) return
    out += source.slice(last, block.index) + `<script${done.attrs}>${done.js}</script>`
    last = block.index + block[0].length
  })
  return out + source.slice(last)
}

// the emitted module. Literal import("...") specifiers found in the
// component's scripts become real module imports, handed to Component79 as a
// resolution map: at runtime $__import checks the map before falling back to
// fetch, so bundled components ship with their imports and nothing changes
// for unbundled ones. Claimed components import as their default (a
// Component79, matching what runtime fetch resolves to); everything else as
// a namespace (matching native import()).
//
// A file's <template name="…"> components are re-exported by name, so the
// module shape is the one the file already has: default plus named. They read
// off the instance, which is where the runtime hangs them - so in dev they are
// bound to the *first* evaluation's definitions and a module that imports one
// by name keeps the pre-edit child until the page reloads. The file's own
// component patches in place, and its rendered children come from the reparse,
// so this only shows in a component imported by name from another file.
//
// In dev, `hot.data` carries the exported instance across updates: importers
// hold a reference to the *first* module evaluation's instance, so later
// evaluations patch that same instance in place instead of exporting a new one
// nobody sees. The patching itself is the runtime's `hotReplace` - the same
// swap the jq79/dev server drives, from the one place that can reach a
// component's markers. An instance only used as a definition has nothing to
// re-render (nested clones can't be reached from this module), so it falls
// back to a full reload.
const componentModule = (source: string, include: RegExp, filename: string): string => {
  const hoisted = hoistableImports(source, include)
  const imports = hoisted
    .map((spec, i) =>
      include.test(spec)
        ? `import __jq79_${i} from ${JSON.stringify(spec)}`
        : `import * as __jq79_${i} from ${JSON.stringify(spec)}`
    )
    .join("\n")
  const modulesMap = `{ ${hoisted.map((spec, i) => `${JSON.stringify(spec)}: __jq79_${i}`).join(", ")} }`

  return `
import { Component79 } from "jq79"
${imports}

const src = ${JSON.stringify(source)}
const modules = ${modulesMap}
const filename = ${JSON.stringify(filename)}

let component

if (import.meta.hot && import.meta.hot.data.component) {
  const prior = import.meta.hot.data.component
  prior.modules = modules
  prior.filename = filename
  // re-renders it where it stands, keeping its data. false means it was never
  // rendered - a definition used only as a nested component - and a reload is
  // the only way to reach the clones made from it
  if (!prior.hotReplace(src) && !prior.data) import.meta.hot.invalidate()
  component = prior
} else {
  component = new Component79(src, { modules, filename })
}

if (import.meta.hot) {
  import.meta.hot.data.component = component
  import.meta.hot.accept()
}

export default component
${declaredComponents(source).map(name => `export const ${name} = component.${name}`).join("\n")}
`
}

export function jq79(options: Jq79PluginOptions = {}): Plugin {
  const include = options.include ?? /\.html$/
  const { exclude } = options

  let config: ResolvedConfig | null = null

  return {
    name: "jq79",
    enforce: "pre",

    configResolved(resolved) {
      config = resolved
    },

    async resolveId(source, importer) {
      if (!importer) return null // entry points are never components
      if (source.includes("?")) return null // ?raw, ?url, ... keep their meaning
      if (!include.test(source)) return null

      const resolved = await this.resolve(source, importer, { skipSelf: true })
      if (!resolved || resolved.external) return null
      if (exclude?.test(resolved.id)) return null
      return resolved.id + COMPONENT_QUERY
    },

    async load(id) {
      if (!id.endsWith(COMPONENT_QUERY)) return null
      const file = id.slice(0, -COMPONENT_QUERY.length)

      let source = await readFile(file, "utf8")
      source = await compileScriptBlocks(source, file)
      if (config) source = await compileStyleBlocks(source, file, config, dep => this.addWatchFile(dep))

      // the runtime names the component's setup scripts after this, so devtools
      // shows a path the user recognizes instead of an anonymous VM script
      const filename = config ? relative(config.root, file) : file

      return { code: componentModule(source, include, filename), map: null }
    },
  }
}

export default jq79
