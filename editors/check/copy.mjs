// the CLI is the editor extension's checker, built there (editors/vscode,
// `npm run build`), so the two read a component the same way by construction.
// This package ships that one file, and TypeScript, which it loads at runtime
import { chmodSync, copyFileSync, mkdirSync } from "node:fs"

mkdirSync(new URL("dist/", import.meta.url), { recursive: true })
const target = new URL("dist/check.js", import.meta.url)
copyFileSync(new URL("../vscode/dist/check.js", import.meta.url), target)
chmodSync(target, 0o755)
