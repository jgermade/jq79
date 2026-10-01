// the Volar language plugin: an .html component becomes a root code (the file
// itself) with its checkable parts embedded in it - one code for the scripts of
// the whole file (component.ts), one for its templates (template.ts), and one
// per <style lang="scss|less">. The scripts' code is the file's service script:
// what TypeScript sees as the module "./Card.html". The templates' code is an
// extra one beside it, <file>.template.ts, which imports that module.
// The same plugin runs in the language server and in `jq79-check`
import type { CodeMapping, LanguagePlugin, IScriptSnapshot, VirtualCode } from "@volar/language-core"
import type {} from "@volar/typescript"
import type * as TS from "typescript"
import type { URI } from "vscode-uri"
import { FULL, attr, generate, splitComponents } from "./component"
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
      })
    }
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

export const createJq79LanguagePlugin = (ts: typeof TS): LanguagePlugin<URI> => ({
  getLanguageId: uri => (uri.path.endsWith(".html") ? "html" : undefined),
  createVirtualCode: (uri, languageId, snapshot) =>
    languageId === "html" ? createVirtualCode(ts, snapshot, uri.path.slice(uri.path.lastIndexOf("/") + 1)) : undefined,
  typescript: {
    extraFileExtensions: [{ extension: "html", isMixedContent: true, scriptKind: 7 satisfies TS.ScriptKind.Deferred }],
    getServiceScript(root) {
      const script = root.embeddedCodes?.find(code => code.id === "script")
      if (!script) return undefined
      const typescript = script.languageId === "typescript"
      return { code: script, extension: typescript ? ".ts" : ".js", scriptKind: typescript ? ts.ScriptKind.TS : ts.ScriptKind.JS }
    },
    getExtraServiceScripts(fileName, root) {
      const template = root.embeddedCodes?.find(code => code.id === "template")
      if (!template) return []
      return [{ fileName: `${fileName}.template.ts`, code: template, extension: ".ts", scriptKind: ts.ScriptKind.TS }]
    },
  },
})
