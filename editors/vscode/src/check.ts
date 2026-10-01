// jq79-check: the language server's diagnostics, from a terminal, for CI -
// published on its own as the jq79-check package (editors/check/), because
// the jq79 package must not depend on TypeScript or Volar. See HELP below.
//
// Without --project: TypeScript's defaults plus allowJs, so JavaScript
// components are read too - their scripts type-checked only with --checkJs
// (or `// @ts-check` in the script), as any JS file; their templates always
import * as fs from "node:fs"
import * as path from "node:path"
import { createTypeScriptChecker, createTypeScriptInferredChecker } from "@volar/kit"
import { create as createCssService } from "volar-service-css"
import { create as createTypeScriptServices } from "volar-service-typescript"
import * as ts from "typescript"
import { createJq79LanguagePlugin } from "./language"

const IGNORED = new Set(["node_modules", ".git", "dist"])

const SCRIPT_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/
const LITERAL_RE = /\b(?:Component79|C79|parseComponent)\s*\(\s*`/

// every .html, and every script with a component literal in it
export const findComponents = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (IGNORED.has(entry.name) || entry.name.startsWith(".")) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return findComponents(full)
    if (entry.name.endsWith(".html")) return [full]
    return SCRIPT_RE.test(entry.name) && !entry.name.endsWith(".d.ts") && LITERAL_RE.test(fs.readFileSync(full, "utf8")) ? [full] : []
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

// the jq79-check package's version (editors/check/package.json), put in at build
declare const JQ79_CHECK_VERSION: string

const HELP = `jq79-check - type-check jq79 components: their scripts, templates and props

Usage: jq79-check [paths…] [options]

  paths                  directories or files to check (default: the current directory).
                         A directory means every .html in it and every script with a
                         component literal (new Component79(\`…\`)), node_modules aside
  -p, --project <file>   check what a tsconfig.json/jsconfig.json includes, with its
                         compiler options; its "include" has to take the .html files
      --checkJs          without --project: type-check JavaScript scripts too, not only
                         templates (a template is always checked)
      --format <format>  text (default), or github: annotations a GitHub Actions run
                         shows on the pull request
  -h, --help             this
  -v, --version          the version

Exits 1 when there is an error, 2 when the command line is wrong.`

type Options = { paths: string[]; project?: string; checkJs: boolean; format: "text" | "github"; help: boolean; version: boolean }

export const parseArgs = (args: string[]): Options | string => {
  const options: Options = { paths: [], checkJs: false, format: "text", help: false, version: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-h" || arg === "--help") options.help = true
    else if (arg === "-v" || arg === "--version") options.version = true
    else if (arg === "--checkJs") options.checkJs = true
    else if (arg === "-p" || arg === "--project") {
      if (!args[i + 1]) return `${arg} needs a tsconfig.json`
      options.project = args[++i]
    } else if (arg === "--format") {
      const format = args[++i]
      if (format !== "text" && format !== "github") return `--format takes text or github, not ${format ?? "nothing"}`
      options.format = format
    } else if (arg.startsWith("-")) return `unknown option ${arg}`
    else options.paths.push(arg)
  }
  if (options.project && options.paths.length) return "--project and paths don't go together: the tsconfig says what to check"
  return options
}

// a TypeScript diagnostic's code is a number (TS2322); the CSS service's is a name
const codeOf = (code: unknown) => (code === undefined ? "" : typeof code === "number" ? ` TS${code}` : ` ${code}`)

// GitHub's workflow commands: the message on one line, its specials escaped
const escapeData = (text: string) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
const escapeProperty = (text: string) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C")

const isChecked = (file: string) => file.endsWith(".html") || (SCRIPT_RE.test(file) && !file.endsWith(".d.ts") && LITERAL_RE.test(fs.readFileSync(file, "utf8")))

export const main = async (args: string[], cwd = process.cwd(), log = console.log, error = console.error): Promise<number> => {
  const options = parseArgs(args)
  if (typeof options === "string") {
    error(`jq79-check: ${options}\n\n${HELP}`)
    return 2
  }
  if (options.help) { log(HELP); return 0 }
  if (options.version) { log(JQ79_CHECK_VERSION); return 0 }

  let checker: ReturnType<typeof createChecker>
  let targets: string[]
  if (options.project) {
    const project = path.resolve(cwd, options.project)
    if (!fs.existsSync(project)) { error(`jq79-check: no ${options.project}`); return 2 }
    checker = createChecker({ project })
    targets = checker.getRootFileNames().filter(isChecked)
  } else {
    const paths = options.paths.length ? options.paths : ["."]
    const missing = paths.find(p => !fs.existsSync(path.resolve(cwd, p)))
    if (missing) { error(`jq79-check: no ${missing}`); return 2 }
    targets = [...new Set(paths.flatMap(p => {
      const full = path.resolve(cwd, p)
      return fs.statSync(full).isDirectory() ? findComponents(full) : isChecked(full) ? [full] : []
    }))]
    checker = createChecker(targets, options.checkJs ? { ...INFERRED_OPTIONS, checkJs: true } : INFERRED_OPTIONS)
  }

  let errors = 0
  let warnings = 0
  for (const file of targets) {
    const relative = path.relative(cwd, file)
    const diagnostics = (await checker.check(file))
      .sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character)
    for (const d of diagnostics) {
      // hints (unused names and the like) are an editor's, not a build's
      if (d.severity !== 1 && d.severity !== 2) continue
      if (d.severity === 1) errors++
      else warnings++
      const { line, character } = d.range.start
      const message = typeof d.message === "string" ? d.message : d.message.value
      if (options.format === "github") {
        const level = d.severity === 1 ? "error" : "warning"
        log(`::${level} file=${escapeProperty(relative)},line=${line + 1},col=${character + 1},title=${escapeProperty(`jq79-check${codeOf(d.code)}`)}::${escapeData(message)}`)
      } else {
        log(`${relative}:${line + 1}:${character + 1} - ${SEVERITY[d.severity]}${codeOf(d.code)}: ${message}`)
      }
    }
  }
  log(`${targets.length} file(s) checked: ${errors} error(s), ${warnings} warning(s)`)
  return errors ? 1 : 0
}

if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code })
