// jq79-check's checker: the extension's virtual code (language.ts - the same
// generator, the same mappings), checked by TypeScript 7 alone. Neither
// Volar's TypeScript layer nor TypeScript 5.9 is loaded; the editor keeps
// both (volar.ts, server.ts), and test/check.mjs runs on the two. See
// RECORD/2026-09-28.an-editor-extension.md, the sections appended 2026-10-02.
//
// - TypeScript 7 (`typescript7`: the `typescript` package, 7.x, under an
//   alias) through its unstable API, which spawns the native compiler and
//   asks this process for files: a virtual file is handed over from
//   `fs.readFile`, as if it were on disk. The API is unstable, so the version
//   is pinned, exactly. Its client is bundled into the CLI, and the compiler
//   is the platform's package (@typescript/typescript-<os>-<arch>), found
//   here: the `typescript` package itself would bring its `tsc` command into
//   the project that installs jq79-check, in place of the project's own
// - the generator's parser is TypeScript 7 too (parse7.ts), and whether
//   `jq79` resolves from a directory is asked of it: a probe file per
//   directory that imports it
// - each diagnostic is mapped back with @volar/source-map, the one piece of
//   Volar kept: offset arithmetic, with no TypeScript in it
// - <style lang="scss|less"> goes to vscode-css-languageservice, as the
//   server's CSS service does
//
// The generator runs before the program exists, in rounds: each round
// generates what it can, parses (and probes) everything it found missing in
// one go, and the files that missed something are generated again. Imported
// components (`import("./Card.html")`) are found in the same rounds, from the
// source, since the compiler can't wait on this process to generate one
// while it asks for it.
//
// Card.html is served as Card.html.ts (or .js), which is what
// `import("./Card.html")` resolves to without a plugin: TypeScript tries the
// name with .ts appended. Its template is Card.html.template.ts, as in the
// server
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as path from "node:path"
import { API } from "typescript7/unstable/sync"
import { SourceMap } from "@volar/source-map"
import type { CodeMapping, IScriptSnapshot, VirtualCode } from "@volar/language-core"
import { getLESSLanguageService, getSCSSLanguageService } from "vscode-css-languageservice"
import { TextDocument } from "vscode-languageserver-textdocument"
import { isChecked } from "./files"
import { createScriptVirtualCode, createVirtualCode } from "./language"
import { createParser } from "./parse7"

type Virtual = { text: string; languageId: string; sourceText: string; map: SourceMap<CodeMapping["data"]> }

export type Diagnostic = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  // LSP's: 1 error, 2 warning, 3 information, 4 hint
  severity: number
  // TypeScript's number, or the CSS service's name
  code: number | string | undefined
  message: string
}

// compiler options as a tsconfig.json spells them. A TS API object (enum
// numbers, lib file names) is taken too, for the tests that run this checker
// and the editor's on the same options
export type Options = Record<string, unknown>

// TypeScript's defaults plus allowJs, so JavaScript components are read too -
// their scripts type-checked only with checkJs (or `// @ts-check` in the
// script), as any JS file; their templates always. TypeScript 7 turns strict
// on by default, 5.9 didn't: it stays off unless asked, as the editor has it
export const INFERRED: Options = {
  allowJs: true,
  target: "es2022",
  module: "esnext",
  moduleResolution: "bundler",
  lib: ["es2022", "dom", "dom.iterable"],
  strict: false,
}

const SCRIPT_LANGUAGES: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact",
}

const snapshotOf = (text: string): IScriptSnapshot => ({
  getText: (start, end) => text.slice(start, end),
  getLength: () => text.length,
  getChangeRange: () => undefined,
})

// Volar's own rule (language-core's shouldReportDiagnostics)
const shouldReport = (code: number | string | undefined) => (data: CodeMapping["data"]) =>
  typeof data.verification === "object"
    ? (data.verification as { shouldReport?: (source: unknown, code: unknown) => boolean }).shouldReport?.(undefined, code) ?? true
    : !!data.verification

// a TS API options object as tsconfig.json spells it. The enums' numbers are
// TypeScript's public API; only the ones the tests pass are here
const TARGETS: Record<number, string> = { 9: "es2022", 10: "es2023", 11: "es2024", 99: "esnext" }
const MODULES: Record<number, string> = { 99: "esnext", 199: "nodenext" }
const RESOLUTIONS: Record<number, string> = { 100: "bundler", 99: "nodenext" }
const toJson = (options: Options): Options => {
  const json: Options = { ...options }
  const name = (names: Record<number, string>, key: string) => {
    const value = options[key]
    if (typeof value !== "number") return
    if (!names[value]) throw new Error(`jq79-check: no tsconfig name for ${key} ${value}`)
    json[key] = names[value]
  }
  name(TARGETS, "target")
  name(MODULES, "module")
  name(RESOLUTIONS, "moduleResolution")
  if (Array.isArray(options.lib)) json.lib = options.lib.map(lib => String(lib).replace(/^lib\./, "").replace(/\.d\.ts$/, ""))
  return json
}

// the .html files a component imports by a relative path: import("./Card.html"),
// import Card from "../Card.html"
const IMPORTED_RE = /(?:\bimport\s*\(\s*|\bfrom\s*)["'](\.{1,2}\/[^"']+\.html)["']/g
const importedComponents = (file: string, text: string) =>
  [...text.matchAll(IMPORTED_RE)].map(m => path.resolve(path.dirname(file), m[1])).filter(f => fs.existsSync(f))

// the line and character of an offset
const positionAt = (text: string, offset: number) => {
  let line = 0
  let lineStart = 0
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1 }
  return { line, character: offset - lineStart }
}

const SEVERITY = [2, 1, 4, 3] // TypeScript's Warning, Error, Suggestion, Message, as LSP's

// the native compiler: the platform package TypeScript 7 installs beside
// itself, and jq79-check in place of it
const compilerPath = () => {
  const name = `@typescript/typescript-${process.platform}-${process.arch}`
  let manifest: string
  try {
    manifest = createRequire(import.meta.url).resolve(`${name}/package.json`)
  } catch {
    throw new Error(`jq79-check: no TypeScript 7 compiler for ${process.platform}-${process.arch} (${name} isn't installed)`)
  }
  return path.join(path.dirname(manifest), "lib", process.platform === "win32" ? "tsc.exe" : "tsc")
}

// ------------------------------------------------------------------ a tsconfig's .html files

// TypeScript 7 reads a tsconfig itself (`extends` is how the checked project
// takes it), but lists only the files it compiles: an "include" of
// "src/**/*.html" is for this checker to follow. These are its rules, for
// .html: a pattern's `**/`, `*` and `?`; a last segment with no wildcard and no
// extension is a directory; exclude defaults to node_modules and its kind; and
// what a config doesn't say comes from the one it extends

// a tsconfig is JSON with comments and trailing commas
const readJsonc = (file: string): Record<string, unknown> => {
  const text = fs.readFileSync(file, "utf8")
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      const end = text.indexOf('"', i + 1)
      let j = end
      while (j !== -1 && text[j - 1] === "\\") j = text.indexOf('"', j + 1)
      out += text.slice(i, j + 1)
      i = j
    } else if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i) - 1
    else if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i) + 1
    else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}

const toPattern = (base: string, spec: string) => {
  let full = path.resolve(base, spec).split(path.sep).join("/")
  const last = full.slice(full.lastIndexOf("/") + 1)
  if (!/[*?]/.test(last) && !last.includes(".")) full += "/**/*"
  let source = ""
  for (let i = 0; i < full.length; i++) {
    if (full.startsWith("**/", i)) { source += "(?:[^/]+/)*"; i += 2 }
    else if (full[i] === "*") source += "[^/]*"
    else if (full[i] === "?") source += "[^/]"
    else source += full[i].replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return { regex: new RegExp(`^${source}$`), root: full.slice(0, full.search(/\/[^/]*[*?]/) + 1 || undefined) }
}

const SKIPPED_DIRS = new Set(["node_modules", "bower_components", "jspm_packages"])

const walk = (dir: string): string[] => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) return []
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

// the .html files a tsconfig takes
export const projectComponents = (project: string): string[] => {
  // files, include and exclude: each from the nearest config that says it
  const said: Record<"files" | "include" | "exclude", { base: string; specs: string[] } | undefined> = { files: undefined, include: undefined, exclude: undefined }
  const visit = (file: string, seen: Set<string>) => {
    if (seen.has(file) || !fs.existsSync(file)) return
    seen.add(file)
    const config = readJsonc(file)
    for (const key of ["files", "include", "exclude"] as const) {
      if (!said[key] && Array.isArray(config[key])) said[key] = { base: path.dirname(file), specs: (config[key] as unknown[]).map(String) }
    }
    const extended = config.extends === undefined ? [] : Array.isArray(config.extends) ? config.extends : [config.extends]
    // a relative extends; a package's config ("@tsconfig/…") is left to TypeScript
    for (const spec of [...extended].reverse()) {
      if (typeof spec === "string" && spec.startsWith(".")) visit(path.resolve(path.dirname(file), spec.endsWith(".json") ? spec : `${spec}.json`), seen)
    }
  }
  visit(project, new Set())
  const dir = path.dirname(project)
  const listed = (said.files?.specs ?? []).map(spec => path.resolve(said.files!.base, spec)).filter(f => f.endsWith(".html") && fs.existsSync(f))
  const include = said.include ?? (said.files ? { base: dir, specs: [] } : { base: dir, specs: ["**/*"] })
  const exclude = (said.exclude?.specs ?? []).map(spec => toPattern(said.exclude!.base, spec).regex)
  const matched = include.specs.flatMap(spec => {
    const { regex, root } = toPattern(include.base, spec)
    return walk(root).filter(f => f.endsWith(".html") && regex.test(f.split(path.sep).join("/")))
  }).filter(f => !exclude.some(regex => regex.test(f.split(path.sep).join("/"))))
  return [...new Set([...listed, ...matched])]
}

// ------------------------------------------------------------------ the checker

export const createChecker = (files: string[] | { project: string }, options: Options = INFERRED) => {
  const cwd = process.cwd()
  const project = Array.isArray(files) ? undefined : path.resolve(cwd, files.project)
  const virtuals = new Map<string, Virtual>()
  const styles = new Map<string, Virtual>()
  const configName = path.join(cwd, "__jq79_check__.json")
  let config = ""
  // what the checked files' config says about options: a tsconfig's, by
  // `extends` (TypeScript 7's defaults, strict included, are its business),
  // or the options given - strict off unless they say so, as 5.9 had it
  const optionsOf = (extra: Options) => project
    ? { extends: project, compilerOptions: { ...extra } }
    : { compilerOptions: { strict: false, ...toJson(options), ...extra } }

  // whether jq79 resolves, by directory: a probe file each, read by a project
  // with the checked files' options
  const resolved = new Map<string, boolean>()
  const probing = new Set<string>()
  const probes = new Map<string, string>()
  let probeRounds = 0
  let probeMissed = 0

  // every file the API asks for: the checked project's, the parser's, the probes'
  const read = (name: string): string | null | undefined => {
    if (name === configName) return config
    if (virtuals.has(name)) return virtuals.get(name)!.text
    if (probes.has(name)) return probes.get(name)
    const parsed = parser.read(name)
    if (parsed !== undefined) return parsed
    // Card.html.ts when Card.html's script is JavaScript: no such file
    if (/\.html\.(?:template\.ts|literal\d+(?:\.template)?\.[jt]s|[jt]s)$/.test(name) && fs.existsSync(name.replace(/\.html\..*$/, ".html"))) return null
    return undefined
  }
  const api = new API({
    cwd,
    tsserverPath: compilerPath(),
    fs: {
      readFile: name => read(name),
      fileExists: name => { const text = read(name); return text === undefined ? undefined : text !== null },
      directoryExists: name => (name === `${cwd}/__jq79_parse__` ? true : undefined),
    },
  })
  const parser = createParser(api, cwd)
  const ts = parser.ts

  // what the project compiles, and of that, what this checker reads
  const compiled = project ? api.parseConfigFile(project).fileNames : []
  const targets = project ? [...projectComponents(project), ...compiled.filter(isChecked)] : files as string[]

  const resolves = (file: string) => {
    const directory = path.dirname(file)
    const found = resolved.get(directory)
    if (found !== undefined) return found
    probing.add(directory)
    probeMissed++
    return false
  }
  const flushProbes = () => {
    if (!probing.size) return
    probeRounds++
    const names = [...probing].map(directory => {
      const name = path.join(directory, `__jq79_probe_${probeRounds}__.ts`)
      probes.set(name, `import type {} from "jq79"\n`)
      return [directory, name] as const
    })
    const probeConfig = path.join(cwd, `__jq79_probes_${probeRounds}__.json`)
    probes.set(probeConfig, JSON.stringify({ ...optionsOf({ noEmit: true, types: [] }), files: names.map(([, name]) => name), include: [] }))
    const { program } = api.updateSnapshot({ openProjects: [probeConfig] }).getProject(probeConfig)!
    for (const [directory, name] of names) resolved.set(directory, !program.getSemanticDiagnostics(name).some(d => d.code === 2307 || d.code === 2792))
    probing.clear()
  }

  // a file's virtual codes, by name; undefined when something it needed
  // wasn't parsed or probed yet (it is generated again next round)
  const generateFor = (file: string): Map<string, Virtual> | undefined => {
    const missed = parser.missed + probeMissed
    const text = fs.readFileSync(file, "utf8")
    const extension = file.slice(file.lastIndexOf(".") + 1).toLowerCase()
    const base = path.basename(file)
    let root: VirtualCode | undefined
    try {
      const jq79 = { jq79: resolves(file) }
      root = extension === "html"
        ? createVirtualCode(ts, snapshotOf(text), base, jq79)
        : SCRIPT_LANGUAGES[extension] ? createScriptVirtualCode(ts, snapshotOf(text), SCRIPT_LANGUAGES[extension], base, jq79) : undefined
    } catch (error) {
      // a stand-in tree can lead the generator anywhere; what it was missing
      // is what counts
      if (parser.missed + probeMissed === missed) throw error
    }
    if (parser.missed + probeMissed !== missed) return undefined
    const out = new Map<string, Virtual>()
    for (const code of root?.embeddedCodes ?? []) {
      const ext = code.languageId === "typescript" ? ".ts" : ".js"
      const literal = /^literal(\d+)_(script|template)$/.exec(code.id)
      const style = /^style_(\d+)$/.exec(code.id)
      const name = code.id === "script" ? file + ext
        : code.id === "template" ? `${file}.template.ts`
        : literal ? `${file}.literal${literal[1]}${literal[2] === "template" ? ".template.ts" : ext}`
        : style ? `${file}.style${style[1]}.${code.languageId}`
        : undefined
      if (name) out.set(name, { text: code.snapshot.getText(0, code.snapshot.getLength()), languageId: code.languageId, sourceText: text, map: new SourceMap(code.mappings) })
    }
    return out
  }

  // the rounds: every checked file, and every component they import
  const generated = new Map<string, string[]>()
  const todo = new Set(targets)
  let rounds = 0
  while (todo.size) {
    rounds++
    for (const file of [...todo]) {
      const codes = generateFor(file)
      if (!codes) continue
      codes.forEach((virtual, name) => (virtual.languageId === "scss" || virtual.languageId === "less" ? styles : virtuals).set(name, virtual))
      generated.set(file, [...codes.keys()])
      todo.delete(file)
      for (const imported of importedComponents(file, fs.readFileSync(file, "utf8"))) if (!generated.has(imported)) todo.add(imported)
    }
    if (!todo.size) break
    parser.flush()
    flushProbes()
    if (rounds > 20) throw new Error(`jq79-check: still generating after ${rounds} rounds: ${[...todo].join(", ")}`)
  }

  // the checked program: the project's own files, and every virtual one
  const roots = [...new Set([...compiled, ...targets.flatMap(file => [...(generated.get(file) ?? []).filter(name => virtuals.has(name)), ...(file.endsWith(".html") ? [] : [file])])])]
  config = JSON.stringify({ ...optionsOf({ noEmit: true }), files: roots, include: [] })
  let opened: ReturnType<ReturnType<typeof api.updateSnapshot>["getProjects"]>[number] | undefined
  const open = () => (opened ??= api.updateSnapshot({ openProjects: [configName] }).getProject(configName)!)

  const mapped = (virtual: Virtual, start: number, end: number, code: number | string | undefined) => {
    const [range] = virtual.map.toSourceRange(start, end, true, shouldReport(code))
    return range && { start: positionAt(virtual.sourceText, range[0]), end: positionAt(virtual.sourceText, range[1]) }
  }

  const checkStyle = (virtual: Virtual): Diagnostic[] => {
    const service = virtual.languageId === "scss" ? getSCSSLanguageService() : getLESSLanguageService()
    const document = TextDocument.create("file:///style." + virtual.languageId, virtual.languageId, 0, virtual.text)
    return service.doValidation(document, service.parseStylesheet(document)).flatMap(d => {
      const code = d.code as string | undefined
      const range = mapped(virtual, document.offsetAt(d.range.start), document.offsetAt(d.range.end), code)
      return range ? [{ range, severity: d.severity ?? 1, code, message: d.message }] : []
    })
  }

  return {
    // what is checked: the files given, or the ones the tsconfig takes
    files: targets,
    check: async (file: string): Promise<Diagnostic[]> => {
      const { program } = open()
      const out: Diagnostic[] = []
      for (const name of generated.get(file) ?? []) {
        const style = styles.get(name)
        if (style) { out.push(...checkStyle(style)); continue }
        const virtual = virtuals.get(name)!
        const found = [
          ...program.getSyntacticDiagnostics(name),
          ...program.getSemanticDiagnostics(name),
          ...program.getSuggestionDiagnostics(name),
        ]
        for (const d of found) {
          const range = mapped(virtual, d.pos, d.end, d.code)
          if (range) out.push({ range, severity: SEVERITY[d.category], code: d.code, message: d.text })
        }
      }
      return out
    },
    // the virtual code and its mappings, for the test that holds it to the
    // code TypeScript 5.9's trees give
    codes: () => new Map([...virtuals].map(([name, v]) => [name, { text: v.text, mappings: v.map.mappings }])),
    stats: () => ({ rounds, ...parser.stats, probeRounds }),
    close: () => api.close(),
  }
}
