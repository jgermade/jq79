import { defineConfig, mergeConfig } from "vitest/config"
import base from "./vitest.config"

// `npm run check:precompile`: the whole suite, with the precompile
// differential recording underneath it - see tests/setup/precompile-differential.ts
export default mergeConfig(base, defineConfig({
  test: { setupFiles: ["tests/setup/precompile-differential.ts"] },
}))
