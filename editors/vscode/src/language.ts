// the Volar language plugin: an .html component becomes a root code (the file
// itself) with its checkable parts embedded in it - one script code for the
// whole file (see component.ts), and a code per <style lang="scss|less">.
// The same plugin runs in the language server and in `jq79-check`
import type { CodeMapping, LanguagePlugin, IScriptSnapshot, VirtualCode } from "@volar/language-core"
import type {} from "@volar/typescript"
import type * as TS from "typescript"
import type { URI } from "vscode-uri"
import { FULL, attr, generate, splitComponents } from "./component"

// <style lang> that this server checks. Plain CSS is left to VS Code's HTML
// service, which already checks it: checking it here too would say every
// problem twice
const STYLE_LANGS: Record<string, string> = { scss: "scss", less: "less" }

const snapshotOf = (text: string): IScriptSnapshot => ({
  getText: (start, end) => text.slice(start, end),
  getLength: () => text.length,
  getChangeRange: () => undefined,
})

export const createVirtualCode = (ts: typeof TS, snapshot: IScriptSnapshot): VirtualCode => {
  const text = snapshot.getText(0, snapshot.getLength())
  const embeddedCodes: VirtualCode[] = []
  const generated = generate(ts, text)
  if (generated) {
    embeddedCodes.push({
      id: "script",
      languageId: generated.typescript ? "typescript" : "javascript",
      snapshot: snapshotOf(generated.code),
      mappings: generated.mappings as CodeMapping[],
    })
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
  createVirtualCode: (_uri, languageId, snapshot) => (languageId === "html" ? createVirtualCode(ts, snapshot) : undefined),
  typescript: {
    extraFileExtensions: [{ extension: "html", isMixedContent: true, scriptKind: 7 satisfies TS.ScriptKind.Deferred }],
    getServiceScript(root) {
      const script = root.embeddedCodes?.find(code => code.id === "script")
      if (!script) return undefined
      const typescript = script.languageId === "typescript"
      return { code: script, extension: typescript ? ".ts" : ".js", scriptKind: typescript ? ts.ScriptKind.TS : ts.ScriptKind.JS }
    },
  },
})
