// the grammars these injections are written against are VS Code's own, so the
// tests tokenize with those - pinned to one release, downloaded once into
// test/.grammars/<tag>/ (gitignored) rather than vendored: they are ~1MB of
// JSON that is somebody else's to maintain. Bump VSCODE_TAG to test against a
// newer VS Code; a grammar change there that breaks an injection here is
// exactly what the tests are for
import { mkdir, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const VSCODE_TAG = "1.139.1"

// scope name -> path inside microsoft/vscode
export const GRAMMARS = {
  "text.html.basic": "extensions/html/syntaxes/html.tmLanguage.json",
  "text.html.derivative": "extensions/html/syntaxes/html-derivative.tmLanguage.json",
  "source.js": "extensions/javascript/syntaxes/JavaScript.tmLanguage.json",
  "source.ts": "extensions/typescript-basics/syntaxes/TypeScript.tmLanguage.json",
  "source.css": "extensions/css/syntaxes/css.tmLanguage.json",
  "source.css.scss": "extensions/scss/syntaxes/scss.tmLanguage.json",
  "source.css.less": "extensions/less/syntaxes/less.tmLanguage.json",
}

export const grammarDir = join(dirname(fileURLToPath(import.meta.url)), ".grammars", VSCODE_TAG)

export const grammarPath = scopeName => join(grammarDir, `${scopeName}.json`)

const exists = path => stat(path).then(() => true, () => false)

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(grammarDir, { recursive: true })
  for (const [scopeName, path] of Object.entries(GRAMMARS)) {
    const target = grammarPath(scopeName)
    if (await exists(target)) continue
    const url = `https://raw.githubusercontent.com/microsoft/vscode/${VSCODE_TAG}/${path}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
    await writeFile(target, await res.text())
    console.log(`fetched ${scopeName} (VS Code ${VSCODE_TAG})`)
  }
}
