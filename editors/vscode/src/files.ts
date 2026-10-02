// which files jq79-check reads: every .html, and every script with a
// component literal in it (new Component79(`…`)) - with no TypeScript in it,
// so that the CLI's bundle carries only the one it checks with
import * as fs from "node:fs"
import * as path from "node:path"

const IGNORED = new Set(["node_modules", ".git", "dist"])

export const SCRIPT_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/
export const LITERAL_RE = /\b(?:Component79|C79|parseComponent)\s*\(\s*`/

// every .html, and every script with a component literal in it
export const findComponents = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (IGNORED.has(entry.name) || entry.name.startsWith(".")) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return findComponents(full)
    if (entry.name.endsWith(".html")) return [full]
    return SCRIPT_RE.test(entry.name) && !entry.name.endsWith(".d.ts") && LITERAL_RE.test(fs.readFileSync(full, "utf8")) ? [full] : []
  })

export const isChecked = (file: string) =>
  file.endsWith(".html") || (SCRIPT_RE.test(file) && !file.endsWith(".d.ts") && LITERAL_RE.test(fs.readFileSync(file, "utf8")))
