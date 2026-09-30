// the language server: Volar's, with the jq79 plugin and the TypeScript and
// CSS services. TypeScript is the one the extension ships (package.json
// dependencies), not the workspace's or VS Code's - Volar needs its JS API,
// which the native TypeScript 7 doesn't have
import { createConnection, createServer, createTypeScriptProject } from "@volar/language-server/node"
import { create as createCssService } from "volar-service-css"
import { create as createTypeScriptServices } from "volar-service-typescript"
import * as ts from "typescript"
import { createJq79LanguagePlugin } from "./language"

const connection = createConnection()
const server = createServer(connection)

connection.listen()

connection.onInitialize(params =>
  server.initialize(
    params,
    createTypeScriptProject(ts, undefined, () => ({ languagePlugins: [createJq79LanguagePlugin(ts)] })),
    [createCssService(), ...createTypeScriptServices(ts)],
  )
)

connection.onInitialized(server.initialized)
connection.onShutdown(server.shutdown)
