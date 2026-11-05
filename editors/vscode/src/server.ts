// the language server: Volar's, with the jq79 plugin and the TypeScript and
// CSS services. TypeScript is the one the extension ships (package.json
// dependencies), not the workspace's or VS Code's - Volar needs its JS API,
// which the native TypeScript 7 doesn't have
import { createConnection, createServer, createTypeScriptProject, type LanguageServicePlugin } from "@volar/language-server/node"
import { create as createCssService } from "volar-service-css"
import { create as createTypeScriptServices } from "volar-service-typescript"
import * as ts from "typescript"
import { URI } from "vscode-uri"
import { createJq79TemplateService } from "./completion"
import { createJq79FetchAllService } from "./fetchall"
import { createJq79LanguagePlugin, jq79Resolver } from "./language"

const connection = createConnection()
const server = createServer(connection)

connection.listen()

// the names the virtual code declares for itself (__s, __c0, __jq79Each, …)
// are in scope wherever an expression is, and TypeScript would offer them
// with the store's names in every {{ }}. They are nobody's to write
const SCAFFOLDING_RE = /^(?:__jq79|\$__import$|__[scwrf]\d*$|__props$)/

// a JavaScript or TypeScript file's own code: the editor's TypeScript serves
// it, and the fetchAll hint (fetchall.ts) is all this server says there
const SCRIPT_ROOT_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/

const withoutScaffolding = (plugin: LanguageServicePlugin): LanguageServicePlugin => ({
  ...plugin,
  create(context) {
    const instance = plugin.create(context)
    const provide = instance.provideCompletionItems
    const actions = instance.provideCodeActions
    const isScriptRoot = (uri: string) => {
      const decoded = context.decodeEmbeddedDocumentUri(URI.parse(uri))
      return !!decoded && decoded[1] === "root" && SCRIPT_ROOT_RE.test(decoded[0].path)
    }
    return {
      ...instance,
      provideCompletionItems: provide && (async (document, ...rest) => {
        const list = await provide.call(instance, document, ...rest)
        // only in a component's code: a script of the user's own is TypeScript's
        if (!list || !/^volar-embedded-content:/.test(document.uri)) return list
        return { ...list, items: list.items.filter(item => !SCAFFOLDING_RE.test(item.label)) }
      }),
      // the fetchAll hint turns a script's own code on where a run is
      // (language.ts); TypeScript's refactors there are the editor's already
      provideCodeActions: actions && ((document, ...rest) =>
        isScriptRoot(document.uri) ? [] : actions.call(instance, document, ...rest)),
    }
  },
})

connection.onInitialize(params =>
  server.initialize(
    params,
    // whether a file can name jq79 in a type is its project's resolution's
    // answer, paths and all (GenerateOptions in component.ts)
    createTypeScriptProject(ts, undefined, ({ projectHost, sys }) => ({
      languagePlugins: [createJq79LanguagePlugin(ts, jq79Resolver(ts, () => projectHost.getCompilationSettings(), sys))],
    })),
    [createCssService(), ...createTypeScriptServices(ts).map(withoutScaffolding), createJq79TemplateService(ts), createJq79FetchAllService(ts)],
  )
)

connection.onInitialized(server.initialized)
connection.onShutdown(server.shutdown)
