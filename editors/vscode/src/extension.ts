// the client: starts the language server for .html files, and nothing else.
// The grammars need none of this - they are contributed by package.json
import * as path from "node:path"
import * as vscode from "vscode"
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node"

let client: LanguageClient | undefined

export async function activate(context: vscode.ExtensionContext) {
  const module = context.asAbsolutePath(path.join("dist", "server.js"))
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6009"] } },
  }
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: "html" }],
    initializationOptions: {},
  }
  client = new LanguageClient("jq79", "jq79", serverOptions, clientOptions)
  await client.start()
}

export function deactivate() {
  return client?.stop()
}
