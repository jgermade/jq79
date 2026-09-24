import { defineConfig } from "vitest/config"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

// the same substitution the build makes (see tsup.config.ts), so tests see the
// version the released bundle would carry rather than the "0.0.0-dev" fallback
const { version } = createRequire(import.meta.url)("./package.json")

export default defineConfig({
  define: { __JQ79_VERSION__: JSON.stringify(version) },
  // the Vite plugin imports the generator by the package's own name (see
  // dev/vite.ts); from source here, like everything else under test
  resolve: { alias: { "jq79/precompile": fileURLToPath(new URL("./src/precompile.ts", import.meta.url)) } },
  test: {
    environment: "jsdom",
    coverage: {
      provider: "istanbul",
      include: ["src/**", "dev/**"],
      // the bin entry: it runs on import (top-level await, process.exit), so it
      // is driven as a subprocess rather than imported. Its behaviour is the
      // dev server's, which is covered
      exclude: ["dev/cli.ts"],
      reporter: ["text", "json-summary", "html"],
    },
  },
})
