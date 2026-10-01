// jq79-check: the language server's diagnostics, from a terminal, for CI.
//
//   jq79-check                     every .html under the current directory
//   jq79-check --checkJs           …and type-check the JavaScript ones too
//   jq79-check --project tsconfig.json
//
// With a tsconfig, its compiler options and its file list (which must take the
// .html files: "include": ["src/**/*.html", …]); without one, TypeScript's
// defaults plus allowJs, so JavaScript components are read too - checked only
// if checkJs (or `// @ts-check` in the script) says so, as in any JS file.
// Exits 1 when there is an error
import * as fs from "node:fs"
import * as path from "node:path"
import { createTypeScriptChecker, createTypeScriptInferredChecker } from "@volar/kit"
import { create as createCssService } from "volar-service-css"
import { create as createTypeScriptServices } from "volar-service-typescript"
import * as ts from "typescript"
import { createJq79LanguagePlugin } from "./language"

const IGNORED = new Set(["node_modules", ".git", "dist"])

export const findComponents = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (IGNORED.has(entry.name) || entry.name.startsWith(".")) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return findComponents(full)
    return entry.name.endsWith(".html") ? [full] : []
  })

export const INFERRED_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  noEmit: true,
}

// `setup` reaches Volar's project (its TypeScript host), for a test that needs
// to see past what the checker maps back to the .html
type Setup = Parameters<typeof createTypeScriptInferredChecker>[4]

export const createChecker = (files: string[] | { project: string }, options: ts.CompilerOptions = INFERRED_OPTIONS, setup?: Setup) => {
  const languages = [createJq79LanguagePlugin(ts)]
  const services = [createCssService(), ...createTypeScriptServices(ts)]
  return Array.isArray(files)
    ? createTypeScriptInferredChecker(languages, services, () => files, options, setup)
    : createTypeScriptChecker(languages, services, files.project, false, setup)
}

const SEVERITY = ["", "error", "warning", "info", "hint"]

const main = async () => {
  const args = process.argv.slice(2)
  const projectAt = args.indexOf("--project")
  // --checkJs: without a tsconfig, check JavaScript components as well
  const options = args.includes("--checkJs") ? { ...INFERRED_OPTIONS, checkJs: true } : INFERRED_OPTIONS
  const project = projectAt === -1 ? undefined : path.resolve(args[projectAt + 1])
  const files = project ? [] : findComponents(process.cwd())
  const checker = project ? createChecker({ project }) : createChecker(files, options)
  const targets = project ? checker.getRootFileNames().filter(f => f.endsWith(".html")) : files

  let errors = 0
  for (const file of targets) {
    const diagnostics = await checker.check(file)
    if (!diagnostics.length) continue
    for (const d of diagnostics) {
      if (d.severity === 1) errors++
      const where = `${path.relative(process.cwd(), file)}:${d.range.start.line + 1}:${d.range.start.character + 1}`
      console.log(`${where} - ${SEVERITY[d.severity ?? 1]}${d.code !== undefined ? ` TS${d.code}` : ""}: ${d.message}`)
    }
  }
  console.log(`${targets.length} component file(s), ${errors} error(s)`)
  process.exitCode = errors ? 1 : 0
}

if (require.main === module) main()
