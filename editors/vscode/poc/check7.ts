// Proof of concept: jq79-check's checker on TypeScript 7 alone - neither
// Volar's TypeScript layer nor TypeScript 5.9. See
// RECORD/2026-09-28.an-editor-extension.md, the sections appended 2026-10-02.
//
// The virtual code is the extension's own (src/language.ts): the same
// generator, the same mappings. What changes is who runs TypeScript:
//
// - TypeScript 7 (`typescript7`, the native compiler) through its unstable
//   API, which spawns the compiler and asks this process for files: a virtual
//   file is handed over from `fs.readFile`, as if it were on disk
// - the generator's parser is TypeScript 7 too (parse7.ts): its trees,
//   fetched in batches, through a `ts` shaped like the one it reads
// - whether `jq79` resolves from a directory is asked of TypeScript 7 as well:
//   a probe file per directory that imports it
// - each diagnostic is mapped back with @volar/source-map, the one piece of
//   Volar kept: 200 lines of offset arithmetic, with no TypeScript in it
//
// The generator runs before the program exists, in rounds: each round
// generates what it can, parses (and probes) everything it found missing in
// one go, and the files that missed something are generated again. Imported
// components (`import("./Card.html")`) are found in the same rounds, from the
// source, since the compiler can't wait on this process to generate one
// while it asks for it
//
// The .html component Card.html is served as Card.html.ts (or .js), which is
// what `import("./Card.html")` resolves to without a plugin: TypeScript tries
// the name with .ts appended. Its template is Card.html.template.ts, as in
// the server
import * as fs from "node:fs"
import * as path from "node:path"
import type * as TS from "typescript"
import { API } from "typescript7/unstable/sync"
import { SourceMap } from "@volar/source-map"
import type { CodeMapping, IScriptSnapshot, VirtualCode } from "@volar/language-core"
import { createScriptVirtualCode, createVirtualCode } from "../src/language"
import { createParser } from "./parse7"

type Virtual = { text: string; source: string; sourceText: string; map: SourceMap<CodeMapping["data"]> }

export type Diagnostic = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity: number
  code: number
  message: string
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
const shouldReport = (code: number) => (data: CodeMapping["data"]) =>
  typeof data.verification === "object"
    ? (data.verification as { shouldReport?: (source: unknown, code: unknown) => boolean }).shouldReport?.("ts", code) ?? true
    : !!data.verification

// a TS API options object (enums, lib file names) as tsconfig.json spells it.
// The enums' numbers are TypeScript's public API, the same in 5.9 and 7; only
// the ones jq79-check passes are here
const TARGETS: Record<number, string> = { 9: "es2022", 10: "es2023", 11: "es2024", 99: "esnext" }
const MODULES: Record<number, string> = { 99: "esnext", 199: "nodenext" }
const RESOLUTIONS: Record<number, string> = { 100: "bundler", 99: "nodenext" }
const toJson = (options: TS.CompilerOptions): Record<string, unknown> => {
  const json: Record<string, unknown> = { ...options }
  const name = (names: Record<number, string>, value: number) => {
    if (!names[value]) throw new Error(`check7: no tsconfig name for ${value}`)
    return names[value]
  }
  if (options.target !== undefined) json.target = name(TARGETS, options.target)
  if (options.module !== undefined) json.module = name(MODULES, options.module)
  if (options.moduleResolution !== undefined) json.moduleResolution = name(RESOLUTIONS, options.moduleResolution)
  if (options.lib) json.lib = options.lib.map(lib => lib.replace(/^lib\./, "").replace(/\.d\.ts$/, ""))
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

const SEVERITY = [2, 1, 4, 3] // TS's Warning, Error, Suggestion, Message as LSP's

export const createChecker = (files: string[], options: TS.CompilerOptions) => {
  const cwd = process.cwd()
  const virtuals = new Map<string, Virtual>()
  const configName = path.join(cwd, "jq79.virtual.tsconfig.json")
  let config = ""
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
    fs: {
      readFile: name => read(name),
      fileExists: name => { const text = read(name); return text === undefined ? undefined : text !== null },
      directoryExists: name => (name === `${cwd}/__jq79_parse__` ? true : undefined),
    },
  })
  const parser = createParser(api, cwd)
  const ts = parser.ts

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
    probes.set(probeConfig, JSON.stringify({ compilerOptions: { ...toJson(options), noEmit: true, noLib: true, types: [] }, files: names.map(([, name]) => name) }))
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
      const name = code.id === "script" ? file + ext
        : code.id === "template" ? `${file}.template.ts`
        : literal ? `${file}.literal${literal[1]}${literal[2] === "template" ? ".template.ts" : ext}`
        : undefined // <style lang>: the CSS service's, not TypeScript's
      if (name) out.set(name, { text: code.snapshot.getText(0, code.snapshot.getLength()), source: file, sourceText: text, map: new SourceMap(code.mappings) })
    }
    return out
  }

  // the rounds: every checked file, and every component they import
  const generated = new Map<string, string[]>()
  const todo = new Set(files)
  let rounds = 0
  const started = performance.now()
  while (todo.size) {
    rounds++
    for (const file of [...todo]) {
      const codes = generateFor(file)
      if (!codes) continue
      codes.forEach((virtual, name) => virtuals.set(name, virtual))
      generated.set(file, [...codes.keys()])
      todo.delete(file)
      for (const imported of importedComponents(file, fs.readFileSync(file, "utf8"))) if (!generated.has(imported)) todo.add(imported)
    }
    if (!todo.size) break
    parser.flush()
    flushProbes()
    if (rounds > 20) throw new Error(`check7: still generating after ${rounds} rounds: ${[...todo].join(", ")}`)
  }
  const generating = performance.now() - started

  const roots = files.flatMap(file => [...generated.get(file)!, ...(file.endsWith(".html") ? [] : [file])])
  config = JSON.stringify({ compilerOptions: { strict: false, ...toJson(options), noEmit: true }, files: roots })
  let project: ReturnType<ReturnType<typeof api.updateSnapshot>["getProjects"]>[number] | undefined
  const open = () => (project ??= api.updateSnapshot({ openProjects: [configName] }).getProject(configName)!)

  return {
    check: async (file: string): Promise<Diagnostic[]> => {
      const { program } = open()
      const out: Diagnostic[] = []
      for (const name of generated.get(file) ?? []) {
        const virtual = virtuals.get(name)!
        const found = [
          ...program.getSyntacticDiagnostics(name),
          ...program.getSemanticDiagnostics(name),
          ...program.getSuggestionDiagnostics(name),
        ]
        for (const d of found) {
          const [range] = virtual.map.toSourceRange(d.pos, d.end, true, shouldReport(d.code))
          if (!range) continue
          out.push({
            range: { start: positionAt(virtual.sourceText, range[0]), end: positionAt(virtual.sourceText, range[1]) },
            severity: SEVERITY[d.category],
            code: d.code,
            message: d.text,
          })
        }
      }
      return out
    },
    // the virtual code and its mappings, to compare with the server's
    codes: () => new Map([...virtuals].map(([name, v]) => [name, { text: v.text, mappings: v.map.mappings }])),
    // what the rounds cost, for the RECORD
    stats: () => ({ rounds, generating, ...parser.stats, probeRounds }),
    close: () => api.close(),
  }
}
