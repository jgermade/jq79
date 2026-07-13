import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    coverage: {
      include: ["src/**"],
      reporter: ["text", "json-summary", "html"],
    },
  },
})
