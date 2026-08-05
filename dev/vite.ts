import { readFile } from "node:fs/promises"
import { relative } from "node:path"
import { preprocessCSS } from "vite"
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
// with fetch instead - with one deliberate exception: <style lang="scss"> (or
// less/stylus/sass) is compiled to plain CSS here. A component using `lang`
// therefore only works through the bundler; loaded with fetch() it would
// reach the runtime uncompiled, which the runtime warns about.
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

const SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi
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
  for (const [, script] of source.matchAll(SCRIPT_BLOCK_RE)) {
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
      if (config) source = await compileStyleBlocks(source, file, config, dep => this.addWatchFile(dep))

      // the runtime names the component's setup scripts after this, so devtools
      // shows a path the user recognizes instead of an anonymous VM script
      const filename = config ? relative(config.root, file) : file

      return { code: componentModule(source, include, filename), map: null }
    },
  }
}

export default jq79
