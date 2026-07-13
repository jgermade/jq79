import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: { jq79: "src/jq79.ts" },
    format: ["esm", "cjs", "iife"], // jq79.js / jq79.cjs / jq79.global.js
    globalName: "jq79",             // window.jq79 for the CDN <script> build
    dts: false,                     // emitted via tsc (tsup's dts crashes on TS 7)
    sourcemap: true,
    minify: true,
    clean: true,
    target: "es2020",
  },
  {
    entry: { vite: "src/vite.ts" }, // the Vite plugin, exported as jq79/vite
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: true,
    clean: false,                   // keep the runtime build from the config above
    platform: "node",
    target: "node18",
  },
])
