// the Volar language plugin. Two kinds of file carry components:
//
// - an .html component becomes a root code (the file itself) with its
//   checkable parts embedded in it - one code for the scripts of the whole
//   file (component.ts), one for its templates (template.ts), and one per
//   <style lang="scss|less">. The scripts' code is the file's service script:
//   what TypeScript sees as the module "./Card.html". The templates' code is
//   an extra one beside it, <file>.template.ts, which imports that module.
// - a JavaScript or TypeScript file, or an .html page, with component literals
//   in it (`new Component79(\`…\`)`, literal.ts): each literal gets the same
//   two codes, as extra scripts of their own (<file>.literal<n>.ts and
//   <file>.literal<n>.template.ts), mapped onto the literal. A JS/TS file's
//   own code is still its service script, mapped with nothing turned on: the
//   editor's TypeScript serves it, and this server only what is inside a
//   literal - so nothing is said twice.
//
// The same plugin runs in the language server and in `jq79-check`
import type { CodeMapping, LanguagePlugin, IScriptSnapshot, VirtualCode } from "@volar/language-core"
import type {} from "@volar/typescript"
import type * as TS from "typescript"
import type { URI } from "vscode-uri"
import { FULL, attr, generate, splitComponents, type Mapping } from "./component"
import { findLiterals, toFile, type Literal } from "./literal"
import { generateTemplate } from "./template"

// <style lang> that this server checks. Plain CSS is left to VS Code's HTML
// service, which already checks it: checking it here too would say every
// problem twice
const STYLE_LANGS: Record<string, string> = { scss: "scss", less: "less" }

const snapshotOf = (text: string): IScriptSnapshot => ({
  getText: (start, end) => text.slice(start, end),
  getLength: () => text.length,
  getChangeRange: () => undefined,
})

// the languages a component literal can be found in, by extension
const SCRIPT_LANGUAGES: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact",
}

const extensionOf = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase()
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

const scriptKindOf = (ts: typeof TS, languageId: string): TS.ScriptKind =>
  ({ javascript: ts.ScriptKind.JS, javascriptreact: ts.ScriptKind.JSX, typescript: ts.ScriptKind.TS, typescriptreact: ts.ScriptKind.TSX })[languageId] ?? ts.ScriptKind.JS

// the two codes of one literal's component, ids prefixed `literal<n>_`
const literalCodes = (ts: typeof TS, literal: Literal, n: number, fileName: string): VirtualCode[] => {
  const generated = generate(ts, literal.text)
  if (!generated) return []
  const codes: VirtualCode[] = [{
    id: `literal${n}_script`,
    languageId: generated.typescript ? "typescript" : "javascript",
    snapshot: snapshotOf(generated.code),
    mappings: toFile(generated.mappings, literal) as CodeMapping[],
    linkedCodeMappings: generated.links,
  }]
  // the scripts' code is <file>.literal<n>.ts|js; `.js` reaches either
  const template = generateTemplate(ts, literal.text, `./${fileName}.literal${n}.js`, literal.data)
  if (template) {
    codes.push({
      id: `literal${n}_template`,
      languageId: "typescript",
      snapshot: snapshotOf(template.code),
      mappings: toFile(template.mappings, literal) as CodeMapping[],
      linkedCodeMappings: template.links,
      // positions in the literal's text, as completion.ts reads it
      jq79Tags: template.tags,
    } as VirtualCode)
  }
  return codes
}

const PAGE_SCRIPT_RE = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi
const TS_MARK_RE = /\blang\s*=\s*["']?\s*(?:ts|typescript)\b|\btype\s*=\s*["']?\s*(?:text|application)\/(?:x-)?typescript\b/i

// the component literals in a page's <script>s
const pageLiterals = (ts: typeof TS, text: string): Literal[] =>
  [...text.matchAll(PAGE_SCRIPT_RE)].flatMap(match => {
    const contentStart = match.index! + match[0].indexOf(">") + 1
    return findLiterals(ts, match[2], TS_MARK_RE.test(match[1]) ? ts.ScriptKind.TS : ts.ScriptKind.JS, contentStart)
  })

// the component literals of a file, numbered as their codes are
// (literal<n>_script / _template): a page's, or a script's. An .html
// component has none - it is a component itself
export const literalsIn = (ts: typeof TS, languageId: string, text: string): Literal[] => {
  if (languageId === "html") return generate(ts, text) ? [] : pageLiterals(ts, text)
  return findLiterals(ts, text, scriptKindOf(ts, languageId))
}

// `fileName` is the file's base name, which the templates' code imports
export const createVirtualCode = (ts: typeof TS, snapshot: IScriptSnapshot, fileName: string): VirtualCode => {
  const text = snapshot.getText(0, snapshot.getLength())
  const embeddedCodes: VirtualCode[] = []
  const generated = generate(ts, text)
  if (generated) {
    embeddedCodes.push({
      id: "script",
      languageId: generated.typescript ? "typescript" : "javascript",
      snapshot: snapshotOf(generated.code),
      mappings: generated.mappings as CodeMapping[],
      linkedCodeMappings: generated.links,
    })
    const template = generateTemplate(ts, text, `./${fileName}`)
    if (template) {
      embeddedCodes.push({
        id: "template",
        languageId: "typescript",
        snapshot: snapshotOf(template.code),
        mappings: template.mappings as CodeMapping[],
        linkedCodeMappings: template.links,
        // the component tags, for completion.ts to find a tag's props
        jq79Tags: template.tags,
      } as VirtualCode)
    }
  } else {
    // a page: its components are the literals its scripts hand to Component79
    pageLiterals(ts, text).forEach((literal, n) => embeddedCodes.push(...literalCodes(ts, literal, n, fileName)))
  }
  splitComponents(text).flatMap(c => c.styles).forEach((block, i) => {
    const lang = STYLE_LANGS[attr(block, "lang")?.value?.trim().toLowerCase() ?? ""]
    if (!lang) return
    embeddedCodes.push({
      id: `style_${i}`,
      languageId: lang,
      snapshot: snapshotOf(text.slice(block.contentStart, block.contentEnd)),
      mappings: [{ sourceOffsets: [block.contentStart], generatedOffsets: [0], lengths: [block.contentEnd - block.contentStart], data: FULL }],
    })
  })
  return {
    id: "root",
    languageId: "html",
    snapshot,
    mappings: [{ sourceOffsets: [0], generatedOffsets: [0], lengths: [text.length], data: FULL }],
    embeddedCodes,
  }
}

// a JavaScript or TypeScript file, with whatever component literals it has.
// Even with none it gets a code, mapped with nothing on: without one, Volar's
// own TypeScript service would serve the file - every script the editor
// sends here - and say everything the editor's TypeScript already says
export const createScriptVirtualCode = (ts: typeof TS, snapshot: IScriptSnapshot, languageId: string, fileName: string): VirtualCode => {
  const text = snapshot.getText(0, snapshot.getLength())
  const literals = findLiterals(ts, text, scriptKindOf(ts, languageId))
  // the file's own code, mapped with nothing on: the editor's TypeScript has it
  const none: Mapping = { sourceOffsets: [0], generatedOffsets: [0], lengths: [text.length], data: {} }
  return {
    id: "root",
    languageId,
    snapshot,
    // and each literal's text with completion on, which nothing else turns
    // on in a script: completion.ts offers attributes and tags there. The
    // TypeScript service is asked too, and has nothing in a string to offer
    mappings: [
      none as CodeMapping,
      ...literals.filter(l => l.at.length).map(literal => {
        const first = literal.at.find(at => at !== -1) ?? 0
        const last = [...literal.at].reverse().find(at => at !== -1) ?? first
        return { sourceOffsets: [first], generatedOffsets: [first], lengths: [last + 1 - first], data: { completion: true } } as CodeMapping
      }),
    ],
    embeddedCodes: literals.flatMap((literal, n) => literalCodes(ts, literal, n, fileName)),
  }
}

export const createJq79LanguagePlugin = (ts: typeof TS): LanguagePlugin<URI> => ({
  getLanguageId: uri => {
    const extension = extensionOf(uri.path)
    return extension === "html" ? "html" : SCRIPT_LANGUAGES[extension]
  },
  createVirtualCode: (uri, languageId, snapshot) => {
    if (languageId === "html") return createVirtualCode(ts, snapshot, baseName(uri.path))
    if (Object.values(SCRIPT_LANGUAGES).includes(languageId)) return createScriptVirtualCode(ts, snapshot, languageId, baseName(uri.path))
    return undefined
  },
  typescript: {
    extraFileExtensions: [{ extension: "html", isMixedContent: true, scriptKind: 7 satisfies TS.ScriptKind.Deferred }],
    getServiceScript(root) {
      if (root.languageId !== "html") {
        // a JS/TS file: itself
        const kind = scriptKindOf(ts, root.languageId)
        const extension = kind === ts.ScriptKind.TS ? ".ts" : kind === ts.ScriptKind.TSX ? ".tsx" : kind === ts.ScriptKind.JSX ? ".jsx" : ".js"
        return { code: root, extension, scriptKind: kind }
      }
      const script = root.embeddedCodes?.find(code => code.id === "script")
      if (!script) return undefined
      const typescript = script.languageId === "typescript"
      return { code: script, extension: typescript ? ".ts" : ".js", scriptKind: typescript ? ts.ScriptKind.TS : ts.ScriptKind.JS }
    },
    getExtraServiceScripts(fileName, root) {
      return (root.embeddedCodes ?? []).flatMap(code => {
        if (code.id === "template") return [{ fileName: `${fileName}.template.ts`, code, extension: ".ts", scriptKind: ts.ScriptKind.TS }]
        const literal = /^literal(\d+)_(script|template)$/.exec(code.id)
        if (!literal) return []
        const [, n, part] = literal
        if (part === "template") return [{ fileName: `${fileName}.literal${n}.template.ts`, code, extension: ".ts", scriptKind: ts.ScriptKind.TS }]
        const typescript = code.languageId === "typescript"
        return [{ fileName: `${fileName}.literal${n}${typescript ? ".ts" : ".js"}`, code, extension: typescript ? ".ts" : ".js", scriptKind: typescript ? ts.ScriptKind.TS : ts.ScriptKind.JS }]
      })
    },
  },
})
