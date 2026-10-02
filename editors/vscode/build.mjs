// bundles src/ into dist/: the client (extension.js), the language server
// (server.js), the CLI (check.mjs) and the editor's checker without the
// editor (volar.js, for the tests). The runtime's own modules come in from
// ../../src as source, which is what keeps this extension reading components
// exactly as the library does. typescript stays outside every bundle: 5.9 is
// the extension's one runtime dependency, shipped in the .vsix as is; 7
// (`typescript7`) is the CLI's, and the CLI must not reach 5.9 at all
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

// the CLI checks with TypeScript 7 alone: an import of `typescript` (5.9)
// reaching its bundle is a mistake, and fails the build
const noTypeScript5 = {
  name: "no-typescript-5",
  setup(build) {
    build.onResolve({ filter: /^typescript(\/|$)/ }, args => ({
      errors: [{ text: `${args.importer} imports ${args.path}: jq79-check runs on TypeScript 7 (typescript7) only` }],
    }))
  },
}

await Promise.all([
  build({ ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js" }),
  build({ ...common, entryPoints: ["src/server.ts"], outfile: "dist/server.js" }),
  build({
    ...common,
    entryPoints: ["src/check.ts"],
    outfile: "dist/check.mjs",
    // TypeScript 7's API is ES modules only. Its client is bundled (the
    // compiler is a platform package of its own: check7.ts)
    format: "esm",
    plugins: [noTypeScript5],
    // and a `require` for the CommonJS modules bundled into it (the CSS
    // service's) that call it
    banner: { js: '#!/usr/bin/env node\nimport { createRequire as __jq79Require } from "node:module"\nconst require = __jq79Require(import.meta.url)' },
    define: { JQ79_CHECK_VERSION: JSON.stringify(checkVersion) },
  }),
  build({ ...common, entryPoints: ["src/volar.ts"], outfile: "dist/volar.js" }),
  build({ ...common, entryPoints: ["src/component.ts"], outfile: "dist/component.js" }),
  build({ ...common, entryPoints: ["src/template.ts"], outfile: "dist/template.js" }),
  build({ ...common, entryPoints: ["src/literal.ts"], outfile: "dist/literal.js" }),
  build({ ...common, entryPoints: ["src/entities.ts"], outfile: "dist/entities.js" }),
  build({ ...common, entryPoints: ["src/completion.ts"], outfile: "dist/completion.js" }),
])
