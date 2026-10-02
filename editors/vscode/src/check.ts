// jq79-check: the extension's checks, from a terminal, for CI - published on
// its own as the jq79-check package (editors/check/), because the jq79
// package must not depend on TypeScript. See HELP below.
//
// It checks with TypeScript 7 (check7.ts); the editor, with Volar and
// TypeScript 5.9 (volar.ts, server.ts). Both read a component with the same
// generator (language.ts), and test/check.mjs runs on both
import * as fs from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { createChecker, INFERRED } from "./check7"
import { findComponents, isChecked } from "./files"

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
    targets = checker.files
  } else {
    const paths = options.paths.length ? options.paths : ["."]
    const missing = paths.find(p => !fs.existsSync(path.resolve(cwd, p)))
    if (missing) { error(`jq79-check: no ${missing}`); return 2 }
    targets = [...new Set(paths.flatMap(p => {
      const full = path.resolve(cwd, p)
      return fs.statSync(full).isDirectory() ? findComponents(full) : isChecked(full) ? [full] : []
    }))]
    checker = createChecker(targets, options.checkJs ? { ...INFERRED, checkJs: true } : INFERRED)
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
      const message = d.message
      if (options.format === "github") {
        const level = d.severity === 1 ? "error" : "warning"
        log(`::${level} file=${escapeProperty(relative)},line=${line + 1},col=${character + 1},title=${escapeProperty(`jq79-check${codeOf(d.code)}`)}::${escapeData(message)}`)
      } else {
        log(`${relative}:${line + 1}:${character + 1} - ${SEVERITY[d.severity]}${codeOf(d.code)}: ${message}`)
      }
    }
  }
  checker.close()
  log(`${targets.length} file(s) checked: ${errors} error(s), ${warnings} warning(s)`)
  return errors ? 1 : 0
}

// run as a command, not imported (the tests import createChecker from here)
const invoked = process.argv[1] && fs.existsSync(process.argv[1]) ? pathToFileURL(fs.realpathSync(process.argv[1])).href : ""
if (invoked === import.meta.url) main(process.argv.slice(2)).then(code => { process.exitCode = code })

export { createChecker, INFERRED } from "./check7"
export { findComponents } from "./files"
