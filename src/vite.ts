import { readFile } from "node:fs/promises"
import type { Plugin } from "vite"

// Vite plugin: import .html single-file components as modules.
//
//   import { jq79 } from "jq79/vite"          // vite.config
//   import UserCard from "./UserCard.html"    // app code
//
// The imported value is a Component79 built from the file's source - the same
// thing `await Component79.fetch(url)` resolves to, but bundled at build time
// instead of fetched at runtime. The plugin is a pure loader: the component
// source is inlined verbatim (no transforms), so a file keeps working
// unchanged if it's ever served from public/ and loaded with fetch instead.
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
// import("...") with a literal specifier; the lookbehind skips $__import and
// property accesses like foo.import(...)
const IMPORT_LITERAL_RE = /(?<![\w$.])import\s*\(\s*(["'])([^"'\n]+?)\1\s*\)/g

const isHtmlUrl = (spec: string) => /\.html?([?#]|$)/.test(spec)
const isRelative = (spec: string) => spec.startsWith("./") || spec.startsWith("../")
const isExternalUrl = (spec: string) => /^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith("/")

// literal `import("...")` specifiers in the component's script blocks that
// should resolve from the bundle instead of at runtime. Absolute paths and
// full URLs are left alone (they point at served files, e.g. public/), and
// so are .html specifiers the plugin wouldn't claim as components
const hoistableImports = (source: string, include: RegExp): string[] => {
  const specifiers = new Set<string>()
  for (const [, script] of source.matchAll(SCRIPT_BLOCK_RE)) {
    for (const [, , spec] of script.matchAll(IMPORT_LITERAL_RE)) {
      if (isExternalUrl(spec)) continue
      if (isHtmlUrl(spec) && !include.test(spec)) continue // html left to runtime fetch
      specifiers.add(spec) // a claimed component, a source file or an npm package
    }
  }
  return [...specifiers]
}

// the emitted module. Literal import("...") specifiers found in the
// component's scripts become real module imports, handed to Component79 as a
// resolution map: at runtime $__import checks the map before falling back to
// fetch, so bundled components ship with their imports and nothing changes
// for unbundled ones. Claimed components import as their default (a
// Component79, matching what runtime fetch resolves to); everything else as
// a namespace (matching native import()).
//
// In dev, `hot.data` carries the exported instance across updates: importers
// hold a reference to the *first* module evaluation's instance, so later
// evaluations patch that same instance in place (the parsed parts are public
// fields) instead of exporting a new one nobody sees. A live instance is
// re-rendered where it stands, seeded with a snapshot of its current store;
// an instance only used as a definition (nested component clones can't be
// reached from here) falls back to a full reload. `mountRoot` is internal to
// Component79, but plugin and runtime ship in lockstep from the same package.
const componentModule = (source: string, include: RegExp): string => {
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

let component

if (import.meta.hot && import.meta.hot.data.component) {
  const prior = import.meta.hot.data.component
  const next = new Component79(src)
  prior.template = next.template
  prior.scripts = next.scripts
  prior.styles = next.styles
  prior.modules = modules
  const root = prior.mountRoot
  if (root) {
    prior.mount(root, { ...prior.data })
  } else if (!prior.data) {
    import.meta.hot.invalidate()
  }
  component = prior
} else {
  component = new Component79(src, { modules })
}

if (import.meta.hot) {
  import.meta.hot.data.component = component
  import.meta.hot.accept()
}

export default component
`
}

export function jq79(options: Jq79PluginOptions = {}): Plugin {
  const include = options.include ?? /\.html$/
  const { exclude } = options

  return {
    name: "jq79",
    enforce: "pre",

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
      return { code: componentModule(await readFile(file, "utf8"), include), map: null }
    },
  }
}

export default jq79
