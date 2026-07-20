import { defineConfig } from "vitest/config"

export default defineConfig({
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
