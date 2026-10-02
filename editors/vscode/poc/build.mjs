// bundles poc/check7.ts into poc/dist/check7.mjs. Both TypeScripts stay
// outside: 5.9 as `typescript`, 7 as `typescript7`
import { build } from "esbuild"

await build({
  entryPoints: [new URL("check7.ts", import.meta.url).pathname],
  outfile: new URL("dist/check7.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["typescript", "typescript7"],
  logLevel: "warning",
})
