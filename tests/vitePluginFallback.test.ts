// @vitest-environment node
//
// The plugin strips TypeScript with vite's own transform, and picks between two
// of them: transformWithOxc is the one vite is moving to, but it only exists
// from vite 7 and the peer range is `vite >= 5`, so the esbuild fallback is a
// path real users take rather than dead code. It lives in its own file because
// esbuild cannot run under jsdom - its `new TextEncoder().encode("")` is not a
// real Uint8Array there, which esbuild refuses to start on - and the rest of
// the plugin suite mounts components, so it needs jsdom.
import { resolve } from "node:path"
import { describe, it, expect, vi } from "vitest"

const fixture = (name: string) => resolve("tests/fixtures", name)

describe("jq79 vite plugin - TypeScript without transformWithOxc", () => {
  it("falls back to esbuild, stripping the same types", async () => {
    const actual = await vi.importActual<any>("vite")
    // the real transform behind a spy: what the fallback picked is then a fact
    // about this run, not an inference from how the output happens to be
    // formatted (which is the only other tell, and moves with the version)
    const transformWithEsbuild = vi.fn(actual.transformWithEsbuild)
    vi.resetModules()
    vi.doMock("vite", () => ({ ...actual, transformWithOxc: undefined, transformWithEsbuild }))
    // vite 8 logs esbuild's deprecation on the way through; not ours to show
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    try {
      const { jq79 } = await import("../dev/vite")
      const plugin: any = jq79()
      const { code } = await plugin.load.call({}, `${fixture("ts-card.html")}?jq79`)

      // the tag the runtime parses is a plain setup script, types gone
      expect(code).toContain("let count = 2")
      expect(code).toContain("$: shown =")
      // the signature went through the same transform as the body
      expect(code).toContain(':setup=\\"{ label = &quot;Ada&quot;, step = 1 }\\"')
      expect(code).not.toContain(": Props")
      expect(code).not.toContain(": number")
      expect(code).not.toContain("interface Label")
      expect(code).not.toContain("import type")

      // and `verbatimModuleSyntax` did its job: the value import survived for
      // hoistableImports to find, the type-only one did not
      const factory = await plugin.load.call({}, `${fixture("ts-factory-card.html")}?jq79`)
      expect(factory.code).toContain('import __jq79_0 from "./user-card.html"')
      expect(factory.code).not.toContain("./ts-types")

      expect(transformWithEsbuild).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      vi.doUnmock("vite")
      vi.resetModules()
    }
  })
})
