// bundles src/ into dist/: the client (extension.js), the language server
// (server.js) and the CLI (check.js). The runtime's own modules come in from
// ../../src as source, which is what keeps this extension reading components
// exactly as the library does. typescript stays outside every bundle: it is
// the one runtime dependency, shipped in the .vsix as is
import { readFileSync } from "node:fs"
import { build } from "esbuild"

// the CLI says the version of the package it is published in (editors/check)
const checkVersion = JSON.parse(readFileSync(new URL("../check/package.json", import.meta.url), "utf8")).version

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
  external: ["vscode", "typescript"],
  logLevel: "warning",
  // the ESM builds: vscode-css-languageservice's UMD one requires its own
  // modules by computed path, which a bundle can't follow
  mainFields: ["module", "main"],
}

await Promise.all([
  build({ ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js" }),
  build({ ...common, entryPoints: ["src/server.ts"], outfile: "dist/server.js" }),
  build({
    ...common,
    entryPoints: ["src/check.ts"],
    outfile: "dist/check.js",
    banner: { js: "#!/usr/bin/env node" },
    define: { JQ79_CHECK_VERSION: JSON.stringify(checkVersion) },
  }),
  build({ ...common, entryPoints: ["src/component.ts"], outfile: "dist/component.js" }),
  build({ ...common, entryPoints: ["src/template.ts"], outfile: "dist/template.js" }),
  build({ ...common, entryPoints: ["src/literal.ts"], outfile: "dist/literal.js" }),
  build({ ...common, entryPoints: ["src/entities.ts"], outfile: "dist/entities.js" }),
  build({ ...common, entryPoints: ["src/completion.ts"], outfile: "dist/completion.js" }),
])
