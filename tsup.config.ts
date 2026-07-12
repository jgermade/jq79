import { defineConfig } from "tsup"

export default defineConfig({
  entry: { c79: "src/c79.ts" },
  format: ["esm", "cjs", "iife"], // c79.js / c79.cjs / c79.global.js
  globalName: "c79",             // window.c79 for the CDN <script> build
  dts: false,                     // emitted via tsc (tsup's dts crashes on TS 7)
  sourcemap: true,
  minify: true,
  clean: true,
  target: "es2020",
})
