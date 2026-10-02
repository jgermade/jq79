// the CLI is built in the editor extension (editors/vscode, `npm run build`),
// from the same generator as its language server, so the two read a component
// the same way by construction. This package ships that one file, which has
// TypeScript 7's API client bundled in, with TypeScript's license and notice;
// the compiler it talks to is the platform's package, an optional dependency
// here as it is of TypeScript itself
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs"

const read = url => JSON.parse(readFileSync(new URL(url, import.meta.url), "utf8"))

// the compiler has to be the version the client was bundled from: the API
// between them is unstable
const typescript = read("../vscode/node_modules/typescript7/package.json")
const own = read("package.json").optionalDependencies ?? {}
const want = typescript.optionalDependencies
const wrong = Object.keys({ ...want, ...own }).filter(name => own[name] !== want[name])
if (wrong.length) {
  console.error(`editors/check/package.json: optionalDependencies must be TypeScript ${typescript.version}'s own:\n` +
    wrong.map(name => `  ${name}: ${own[name] ?? "missing"}, wants ${want[name] ?? "nothing"}`).join("\n"))
  process.exit(1)
}

mkdirSync(new URL("dist/typescript/", import.meta.url), { recursive: true })
const target = new URL("dist/check.mjs", import.meta.url)
copyFileSync(new URL("../vscode/dist/check.mjs", import.meta.url), target)
chmodSync(target, 0o755)
for (const file of ["LICENSE", "NOTICE.txt"]) {
  copyFileSync(new URL(`../vscode/node_modules/typescript7/${file}`, import.meta.url), new URL(`dist/typescript/${file}`, import.meta.url))
}
