import { defineConfig } from "tsup"
import { createRequire } from "node:module"

// what Component79.version reads. Substituted here rather than imported: src/
// ships to the browser, so it can't read package.json at runtime
const { version } = createRequire(import.meta.url)("./package.json")

export default defineConfig([
  {
    entry: { jq79: "src/jq79.ts" },
    format: ["esm", "cjs", "iife"], // jq79.js / jq79.cjs / jq79.global.js
    globalName: "jq79",             // window.jq79 for the CDN <script> build
    define: { __JQ79_VERSION__: JSON.stringify(version) },
    dts: false,                     // emitted via tsc (tsup's dts crashes on TS 7)
    sourcemap: true,
    minify: true,
    clean: true,
    target: "es2020",
  },
  {
    // the generator safe mode runs on (RECORD/2026-09-23.no-unsafe-eval.md),
    // exported as jq79/precompile: its own entry so the runtime every page
    // loads doesn't carry it. Browser code with no DOM in it - it runs on node
    // for the Vite plugin, and in a service worker
    entry: { precompile: "src/precompile.ts" },
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: true,
    minify: true,
    clean: false,
    target: "es2020",
  },
  {
    entry: { vite: "dev/vite.ts" }, // the Vite plugin, exported as jq79/vite
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: true,
    clean: false,                   // keep the runtime build from the config above
    platform: "node",
    target: "node18",
  },
  {
    entry: { dev: "dev/dev.ts" },   // the no-bundle dev server, exported as jq79/dev
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: true,
    clean: false,
    platform: "node",
    target: "node20",               // fs.watch({ recursive: true }) on linux
  },
  {
    entry: { cli: "dev/cli.ts" },   // the `jq79` command (package.json "bin")
    format: ["esm"],                // it awaits at the top level
    banner: { js: "#!/usr/bin/env node" },
    dts: false,
    sourcemap: false,
    clean: false,
    platform: "node",
    target: "node20",
  },
])
