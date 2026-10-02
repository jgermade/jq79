// Proof of concept: jq79-check's checker on TypeScript 7, without Volar's
// TypeScript layer. See RECORD/2026-09-28.an-editor-extension.md, the section
// appended 2026-10-02.
//
// The virtual code is the extension's own (src/language.ts): the same
// generator, the same mappings. What changes is who runs TypeScript over it:
//
// - TypeScript 7 (`typescript7`, the native compiler) through its unstable
//   API, which spawns tsgo and asks this process for files: a virtual file is
//   handed over from `fs.readFile`, as if it were on disk
// - each diagnostic is mapped back with @volar/source-map, the one piece of
//   Volar kept: 200 lines of offset arithmetic, with no TypeScript in it
//
// TypeScript 5.9 is still loaded, as a parser only: the generator reads a
// script with `ts.createSourceFile`, and TypeScript 7 has no parser in this
// process
//
// The .html component Card.html is served as Card.html.ts (or .js), which is
// what `import("./Card.html")` resolves to without a plugin: TypeScript tries
// the name with .ts appended. Its template is Card.html.template.ts, as in
// the server
import * as fs from "node:fs"
import * as path from "node:path"
import * as ts from "typescript"
import { API } from "typescript7/unstable/sync"
import { SourceMap } from "@volar/source-map"
import type { CodeMapping, IScriptSnapshot, VirtualCode } from "@volar/language-core"
import { createScriptVirtualCode, createVirtualCode, jq79Resolver } from "../src/language"

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

// a TS API options object (enums, lib file names) as tsconfig.json spells it
const toJson = (options: ts.CompilerOptions): Record<string, unknown> => {
  const json: Record<string, unknown> = { ...options }
  const name = (enumObject: Record<string, unknown>, value: unknown) => String(enumObject[value as number]).toLowerCase()
  if (options.target !== undefined) json.target = name(ts.ScriptTarget, options.target)
  if (options.module !== undefined) json.module = name(ts.ModuleKind, options.module)
  if (options.moduleResolution !== undefined) json.moduleResolution = name(ts.ModuleResolutionKind, options.moduleResolution)
  if (options.lib) json.lib = options.lib.map(lib => lib.replace(/^lib\./, "").replace(/\.d\.ts$/, ""))
  return json
}

// the line and character of an offset
const positionAt = (text: string, offset: number) => {
  let line = 0
  let lineStart = 0
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1 }
  return { line, character: offset - lineStart }
}

const SEVERITY = [2, 1, 4, 3] // TS's Warning, Error, Suggestion, Message as LSP's

export const createChecker = (files: string[], options: ts.CompilerOptions) => {
  const resolves = jq79Resolver(ts, options)
  const virtuals = new Map<string, Virtual>()
  // the virtual files of each source file, generated once
  const generated = new Map<string, string[]>()

  const generateFor = (file: string): string[] => {
    let names = generated.get(file)
    if (names) return names
    names = []
    const text = fs.readFileSync(file, "utf8")
    const extension = file.slice(file.lastIndexOf(".") + 1).toLowerCase()
    const base = path.basename(file)
    const jq79 = { jq79: resolves(file) }
    const root: VirtualCode | undefined = extension === "html"
      ? createVirtualCode(ts, snapshotOf(text), base, jq79)
      : SCRIPT_LANGUAGES[extension] ? createScriptVirtualCode(ts, snapshotOf(text), SCRIPT_LANGUAGES[extension], base, jq79) : undefined
    for (const code of root?.embeddedCodes ?? []) {
      const ext = code.languageId === "typescript" ? ".ts" : ".js"
      const literal = /^literal(\d+)_(script|template)$/.exec(code.id)
      const name = code.id === "script" ? file + ext
        : code.id === "template" ? `${file}.template.ts`
        : literal ? `${file}.literal${literal[1]}${literal[2] === "template" ? ".template.ts" : ext}`
        : undefined // <style lang>: the CSS service's, not TypeScript's
      if (!name) continue
      virtuals.set(name, { text: code.snapshot.getText(0, code.snapshot.getLength()), source: file, sourceText: text, map: new SourceMap(code.mappings) })
      names.push(name)
    }
    generated.set(file, names)
    return names
  }

  // Card.html.ts asked for: Card.html's code, when Card.html exists. null is
  // "no such file" (Card.html's script is JavaScript, so it is Card.html.js);
  // undefined is "not mine", and tsgo reads the disk
  const virtualFor = (fileName: string): Virtual | null | undefined => {
    if (virtuals.has(fileName)) return virtuals.get(fileName)
    const html = /^(.*\.html)\.(?:template\.ts|literal\d+(?:\.template)?\.[jt]s|[jt]s)$/.exec(fileName)?.[1]
    if (!html || !fs.existsSync(html)) return undefined
    generateFor(html)
    return virtuals.get(fileName) ?? null
  }

  const roots = files.flatMap(file => [...generateFor(file), ...(file.endsWith(".html") ? [] : [file])])
  const cwd = process.cwd()
  const configName = path.join(cwd, "jq79.virtual.tsconfig.json")
  const config = JSON.stringify({ compilerOptions: { strict: false, ...toJson(options), noEmit: true }, files: roots })

  const api = new API({
    cwd,
    fs: {
      readFile: name => name === configName ? config : virtualFor(name) === null ? null : virtualFor(name)?.text,
      fileExists: name => name === configName ? true : virtualFor(name) === null ? false : virtualFor(name) ? true : undefined,
    },
  })
  let project: ReturnType<ReturnType<typeof api.updateSnapshot>["getProjects"]>[number] | undefined
  const open = () => (project ??= api.updateSnapshot({ openProjects: [configName] }).getProject(configName)!)

  return {
    check: async (file: string): Promise<Diagnostic[]> => {
      const { program } = open()
      const out: Diagnostic[] = []
      for (const name of generateFor(file)) {
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
    close: () => api.close(),
  }
}
