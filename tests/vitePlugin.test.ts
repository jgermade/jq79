
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, it, expect, vi } from "vitest"
import { build } from "vite"
import { jq79 } from "../dev/vite"
import { Component79 } from "../src/jq79"

// vitest runs from the repo root
const fixture = (name: string) => resolve("tests/fixtures", name)

// These tests write a built bundle to disk and import it back, so the path has
// to be one per process: two vitest processes on one checkout - a watch run
// beside a one-off, or a suite run under stress - would overwrite each other's
// file while the other was importing it, and a truncated read surfaces as
// `Cannot read properties of undefined` on whatever the bundle should export
const BUNDLE_DIR = resolve("node_modules/.cache/jq79-tests", String(process.pid))
const runtimePath = resolve("src/jq79.ts")

// calls a hook with a minimal rollup context that resolves to the given id
const resolveId = (plugin: any, source: string, importer?: string, resolvedTo = "/abs/Card.html") =>
  plugin.resolveId.call(
    { resolve: async () => ({ id: resolvedTo, external: false }) },
    source,
    importer
  )

describe("jq79 vite plugin", () => {
  const plugin: any = jq79()

  describe("resolveId", () => {
    it("claims .html imports coming from a module", async () => {
      expect(await resolveId(plugin, "./Card.html", "/abs/main.js")).toBe("/abs/Card.html?jq79")
    })

    it("ignores entry points (no importer)", async () => {
      expect(await resolveId(plugin, "/abs/index.html", undefined)).toBe(null)
    })

    it("leaves explicit queries like ?raw and ?url alone", async () => {
      expect(await resolveId(plugin, "./Card.html?raw", "/abs/main.js")).toBe(null)
      expect(await resolveId(plugin, "./Card.html?url", "/abs/main.js")).toBe(null)
    })

    it("ignores non-matching specifiers", async () => {
      expect(await resolveId(plugin, "./data.json", "/abs/main.js")).toBe(null)
    })

    it("respects a custom include", async () => {
      const custom: any = jq79({ include: /\.c79\.html$/ })
      expect(await resolveId(custom, "./Card.html", "/abs/main.js")).toBe(null)
      expect(await resolveId(custom, "./Card.c79.html", "/abs/main.js", "/abs/Card.c79.html"))
        .toBe("/abs/Card.c79.html?jq79")
    })

    it("respects exclude against the resolved path", async () => {
      const custom: any = jq79({ exclude: /\/vendor\// })
      expect(await resolveId(custom, "./Card.html", "/abs/main.js", "/abs/vendor/Card.html")).toBe(null)
    })

    it("leaves unresolvable and external specifiers to vite", async () => {
      const unresolved = await plugin.resolveId.call(
        { resolve: async () => null },
        "./Missing.html",
        "/abs/main.js"
      )
      expect(unresolved).toBe(null)

      const external = await plugin.resolveId.call(
        { resolve: async () => ({ id: "https://cdn.dev/Card.html", external: true }) },
        "https://cdn.dev/Card.html",
        "/abs/main.js"
      )
      expect(external).toBe(null)
    })
  })

  describe("load", () => {
    it("ignores ids without the component query", async () => {
      expect(await plugin.load.call({}, "/abs/Card.html")).toBe(null)
    })

    it("inlines the file source into a Component79 module", async () => {
      const file = fixture("user-card.html")
      const source = await readFile(file, "utf8")
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      expect(code).toContain('import { Component79 } from "jq79"')
      expect(code).toContain(JSON.stringify(source))
      expect(code).toContain("export default component")
    })

    it("names the component after its path, so its scripts are findable in devtools", async () => {
      const result: any = await build({
        configFile: false,
        logLevel: "silent",
        root: resolve("tests"),
        plugins: [jq79()],
        resolve: { alias: { jq79: runtimePath } },
        build: {
          write: false,
          minify: false,
          lib: { entry: fixture("app.js"), formats: ["es"], fileName: "app" },
        },
      })
      const { code } = (Array.isArray(result) ? result[0] : result).output[0]

      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const bundlePath = join(dir, "named-app.mjs")
      await writeFile(bundlePath, code)
      const { UserCard } = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)

      // relative to the vite root, not an absolute path from the build machine
      expect(UserCard.filename).toBe("fixtures/user-card.html")
    })

    it("hoists literal import() specifiers into real imports", async () => {
      const file = fixture("parent.html")
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      expect(code).toContain('import __jq79_0 from "./user-card.html"')
      expect(code).toContain('"./user-card.html": __jq79_0')
      // absolute paths stay runtime-fetched (they point at served files)
      expect(code).not.toContain("/cards/remote.html\": ")
    })

    it("hoists static imports from factory scripts", async () => {
      const file = fixture("factory-card.html")
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      expect(code).toContain('import __jq79_0 from "./user-card.html"')
      expect(code).toContain('"./user-card.html": __jq79_0')
    })

    it("hoists non-html imports as namespaces, skips URLs and dynamic specifiers", async () => {
      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const file = join(dir, "imports.html")
      await writeFile(file, `
        <script :setup>
          const utils = await import("./utils.js")
          const pkg = await import("some-pkg")
          const remote = await import("https://esm.sh/other")
          const dynamic = await import(\`./cards/\${name}.html\`)
        </script>
        <p>{{ x }}</p>
      `)
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      expect(code).toContain('import * as __jq79_0 from "./utils.js"')
      expect(code).toContain('import * as __jq79_1 from "some-pkg"')
      // URLs and non-literal specifiers stay runtime-resolved: only the two
      // hoistable ones become real imports / map entries
      expect(code).not.toContain("__jq79_2")
      expect(code).not.toContain('from "https://esm.sh/other"')
    })

    it("does not hoist specifiers sitting in comments or strings", async () => {
      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const file = join(dir, "commented.html")
      await writeFile(file, `
        <script :setup>
          // const Old = await import("./gone.html")
          /* import legacy from "./also-gone.js" */
          const label = 'see import("./not-code.html") for details'
          const Card = await import("./user-card.html")
        </script>
        <p>{{ x }}</p>
      `)
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      // only the real import is hoisted; the commented-out and quoted ones
      // must not become bundle imports (a missing file would break the build)
      expect(code).toContain('import __jq79_0 from "./user-card.html"')
      expect(code).not.toContain("__jq79_1")
      expect(code).not.toContain('from "./gone.html"')
      expect(code).not.toContain('from "./also-gone.js"')
      expect(code).not.toContain('from "./not-code.html"')
    })

    it("leaves html imports the include does not claim to runtime fetch", async () => {
      const custom: any = jq79({ include: /\.c79\.html$/ })
      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const file = join(dir, "unclaimed.html")
      await writeFile(file, `
        <script :setup>
          const Claimed = await import("./Card.c79.html")
          const Plain = await import("./Plain.html")
        </script>
        <p>{{ x }}</p>
      `)
      const { code } = await custom.load.call({}, `${file}?jq79`)

      expect(code).toContain('import __jq79_0 from "./Card.c79.html"')
      // .html the plugin wouldn't claim stays out of the map: Component79.fetch handles it
      expect(code).not.toContain('from "./Plain.html"')
      expect(code).not.toContain('"./Plain.html": __jq79')
    })

    it("strips the types out of <script lang=\"ts\"> and drops the lang", async () => {
      const file = fixture("ts-card.html")
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      // the tag the runtime parses is a plain setup script: `lang` is gone,
      // every other attribute survives (the signature keeps its own section
      // below)
      expect(code).toContain("<script :setup=")
      expect(code).not.toContain("lang=")

      // no TypeScript survives into the inlined source
      expect(code).not.toContain("interface Label")
      expect(code).not.toContain("import type")
      expect(code).not.toContain(": number")
      expect(code).not.toContain("as Label")

      // and what the runtime scanner needs did survive
      expect(code).toContain("let count = 2")
      expect(code).toContain("$: shown =")
    })

    it("keeps a value import hoistable and leaves `import type` out of the bundle", async () => {
      const file = fixture("ts-factory-card.html")
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      // this fixture carries the other spelling of the mark
      // (`type="text/typescript"`), so both go through a real build below

      // erasing `import type` is the point - hoisting it would pull a
      // types-only module into the bundle
      expect(code).not.toContain("./ts-types")
      // the value import is still there for hoistableImports to find. Both
      // transforms drop unused value imports unless told not to, and a
      // component silently losing its child is exactly what that looks like
      expect(code).toContain('import __jq79_0 from "./user-card.html"')
      expect(code).toContain('"./user-card.html": __jq79_0')
    })

    it("strips the types out of the :setup signature too, and re-quotes it", async () => {
      const file = fixture("ts-card.html")
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      // the signature lives in the attribute, which the body's transform never
      // sees - so `lang` has to reach it separately or TypeScript survives into
      // a component the plugin just promised was JS
      expect(code).not.toContain(": Props")
      expect(code).not.toContain("as number")
      // the pattern itself is intact, defaults included. The transforms
      // normalize 'Ada' to "Ada", which would end the attribute early
      expect(code).toContain(':setup=\\"{ label = &quot;Ada&quot;, step = 1 }\\"')
    })

    it("strips the annotation off the permissive `_` signature", async () => {
      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const file = join(dir, "open-signature.html")
      await writeFile(file, `<script :setup="_: Props" lang="ts">let n: number = 1</script><p>{{ n }}</p>`)
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      // `_` is the opt-out the runtime recognises by value: annotated, it stops
      // reading as one and warns instead of staying open
      expect(code).toContain(':setup=\\"_\\"')
    })

    it("leaves the signature of a block without a lang untouched", async () => {
      const file = fixture("user-card.html")
      const source = await readFile(file, "utf8")
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      expect(code).toContain(JSON.stringify(source)) // byte-for-byte, as before
    })

    it("takes `type=\"text/typescript\"` as the same mark, and drops the type", async () => {
      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const file = join(dir, "typed-by-type.html")
      await writeFile(
        file,
        `<script :setup="{ step = 1 }: Props" type="text/typescript">let count: number = 2 * step</script><p>{{ count }}</p>`
      )
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      // `type` is the mark an IDE reads in a plain .html file, where `lang`
      // means nothing to it - so the plugin takes either, and drops whichever
      // one it found: what it emits is JS
      expect(code).not.toContain("type=")
      expect(code).toContain("let count = 2 * step")
      expect(code).toContain(':setup=\\"{ step = 1 }\\"')
    })

    it("leaves a script `type` that isn't TypeScript alone", async () => {
      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const file = join(dir, "module-type.html")
      const source = `<script type="module">export default () => ({ n: 1 })</script><p>{{ n }}</p>`
      await writeFile(file, source)
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      // `type="module"` is real HTML with real meaning, and not this plugin's
      expect(code).toContain(JSON.stringify(source)) // byte-for-byte
    })

    it("leaves a lang it doesn't compile alone, for the runtime to warn about", async () => {
      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const file = join(dir, "coffee.html")
      await writeFile(file, `<script :setup lang="coffee">x = 1</script><p>{{ x }}</p>`)
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      expect(code).toContain('lang=\\"coffee\\"')
    })

  })

  describe("modules resolution map (runtime)", () => {
    it("import() resolves from the map instead of fetching", async () => {
      const child = new Component79(`<p class="child">hi</p>`)
      const fetchSpy = vi.fn(() => { throw new Error("no fetch expected") })
      vi.stubGlobal("fetch", fetchSpy)
      try {
        const parent = new Component79(
          `
            <script :setup>
              const Child = await import("./child.html")
            </script>
            <div><Child></Child></div>
          `,
          { modules: { "./child.html": child } }
        )
        const container = document.createElement("div")
        parent.mount(container)
        await new Promise(resolve => setTimeout(resolve))

        expect(container.querySelector(".child")?.textContent).toBe("hi")
        expect(fetchSpy).not.toHaveBeenCalled()
        parent.destroy()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it("the map survives per-usage-site cloning of a nested definition", async () => {
      const leaf = new Component79(`<span class="leaf">leaf</span>`)
      const mid = new Component79(
        `
          <script :setup>
            const Leaf = await import("./leaf.html")
          </script>
          <div class="mid"><Leaf></Leaf></div>
        `,
        { modules: { "./leaf.html": leaf } }
      )
      const top = new Component79(`<section><Mid></Mid><Mid></Mid></section>`)
      const container = document.createElement("div")
      top.mount(container, { Mid: mid })
      await new Promise(resolve => setTimeout(resolve))

      expect(container.querySelectorAll(".leaf")).toHaveLength(2)
      top.destroy()
    })
  })

  describe("multi-template files", () => {
    it("re-exports a file's <template name> components by name", async () => {
      const file = fixture("list.html")
      const { code } = await plugin.load.call({}, `${file}?jq79`)

      expect(code).toContain("export default component")
      expect(code).toContain("export const Row = component.Row")
    })

    it("only exports the top-level declarations", async () => {
      const { code } = await plugin.load.call(
        {},
        `${fixture("list.html")}?jq79`
      )
      // one export, from the one top-level <template name="Row">
      expect(code.match(/^export const /gm)).toHaveLength(1)
    })

    it("bundles the file, and both components render", async () => {
      const result: any = await build({
        configFile: false,
        logLevel: "silent",
        plugins: [jq79()],
        resolve: { alias: { jq79: runtimePath } },
        build: {
          write: false,
          minify: false,
          lib: { entry: fixture("list-app.js"), formats: ["es"], fileName: "list-app" },
        },
      })
      const { code } = (Array.isArray(result) ? result[0] : result).output[0]

      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const bundlePath = join(dir, "list-app.mjs")
      await writeFile(bundlePath, code)
      const { List, Row } = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)

      // the file's own component renders the sibling it declares, no import
      const container = document.createElement("div")
      List.mount(container)
      expect([...container.querySelectorAll(".row")].map(el => el.textContent)).toEqual(["a", "b"])
      List.destroy()

      // and the named export is that same definition, mountable on its own
      expect(Row).toBe(List.siblings.Row)
      const alone = document.createElement("div")
      Row.mount(alone, { label: "solo" })
      expect(alone.querySelector(".row")?.textContent).toBe("solo")
      Row.destroy()
    })
  })

  describe("vite build integration", () => {
    it("bundles an imported .html component that mounts and renders", async () => {
      const result: any = await build({
        configFile: false,
        logLevel: "silent",
        plugins: [jq79()],
        resolve: { alias: { jq79: runtimePath } },
        build: {
          write: false,
          minify: false,
          lib: { entry: fixture("app.js"), formats: ["es"], fileName: "app" },
        },
      })
      const { code } = (Array.isArray(result) ? result[0] : result).output[0]

      // the component travels inside the bundle - nothing left to fetch
      expect(code).toContain("Hello, ${name}!")

      // somewhere vitest can import from (inside the root, ignored by watch)
      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const bundlePath = join(dir, "app.mjs")
      await writeFile(bundlePath, code)
      const { UserCard, Component79 } = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)

      // direct mount of the imported instance
      const container = document.createElement("div")
      UserCard.mount(container)
      expect(container.querySelector(".greeting")?.textContent).toBe("Hello, Ada!")
      UserCard.destroy()

      // the same import used as a definition: one instance per usage site
      const parent = new Component79(`
        <div class="wrap">
          <UserCard></UserCard>
          <UserCard></UserCard>
        </div>
      `)
      const container2 = document.createElement("div")
      parent.mount(container2, { UserCard })
      expect(container2.querySelectorAll(".greeting")).toHaveLength(2)
      parent.destroy()
    })

    it("bundles components imported from setup scripts - no runtime fetch", async () => {
      const result: any = await build({
        configFile: false,
        logLevel: "silent",
        plugins: [jq79()],
        resolve: { alias: { jq79: runtimePath } },
        build: {
          write: false,
          minify: false,
          lib: { entry: fixture("parent-app.js"), formats: ["es"], fileName: "parent-app" },
        },
      })
      const { code } = (Array.isArray(result) ? result[0] : result).output[0]

      // the child travels inside the bundle
      expect(code).toContain("Hello, ${name}!")

      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const bundlePath = join(dir, "parent-app.mjs")
      await writeFile(bundlePath, code)
      const { Parent } = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)

      const fetchSpy = vi.fn(() => { throw new Error("no fetch expected") })
      vi.stubGlobal("fetch", fetchSpy)
      try {
        const container = document.createElement("div")
        Parent.mount(container)
        await new Promise(resolve => setTimeout(resolve))

        expect(container.querySelector(".parent .greeting")?.textContent).toBe("Hello, Ada!")
        expect(fetchSpy).not.toHaveBeenCalled()
        Parent.destroy()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it("compiles <style lang=\"scss\"> - nesting and @use resolved, then scoped at runtime", async () => {
      const result: any = await build({
        configFile: false,
        logLevel: "silent",
        plugins: [jq79()],
        resolve: { alias: { jq79: runtimePath } },
        build: {
          write: false,
          minify: false,
          lib: { entry: fixture("sass-app.js"), formats: ["es"], fileName: "sass-app" },
        },
      })
      const { code } = (Array.isArray(result) ? result[0] : result).output[0]

      // the SCSS is gone from the bundle: nesting flattened, @use variable inlined
      expect(code).not.toContain("@use")
      expect(code).not.toContain("$brand")
      expect(code).toContain("rebeccapurple")
      expect(code).not.toContain('lang=\\"scss\\"') // the tag the runtime parses is plain CSS

      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const bundlePath = join(dir, "sass-app.mjs")
      await writeFile(bundlePath, code)
      const { SassCard } = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const container = document.createElement("div")
      SassCard.mount(container)

      // compiled CSS reaching the runtime is scoped like any other stylesheet
      const scope = container.querySelector(".sass-card")?.getAttribute("data-jq79")
      const css = SassCard.styles.map((style: any) => style.scoped ?? style.content).join("\n")
      expect(scope).toBeTruthy()
      expect(css).toContain(`.sass-card[data-jq79="${scope}"]`)
      expect(css).toContain(`.sass-card .label[data-jq79="${scope}"]`) // scss nesting, flattened
      expect(css).toContain("rebeccapurple")
      expect(warn).not.toHaveBeenCalled() // it went through the plugin: nothing to warn about

      warn.mockRestore()
      SassCard.destroy()
    })

    it("compiles <script lang=\"ts\"> - types stripped, the annotated `let` still reactive", async () => {
      const result: any = await build({
        configFile: false,
        logLevel: "silent",
        plugins: [jq79()],
        resolve: { alias: { jq79: runtimePath } },
        build: {
          write: false,
          minify: false,
          lib: { entry: fixture("ts-app.js"), formats: ["es"], fileName: "ts-app" },
        },
      })
      const { code } = (Array.isArray(result) ? result[0] : result).output[0]

      expect(code).not.toContain("interface Label")
      expect(code).not.toContain("import type")

      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const bundlePath = join(dir, "ts-app.mjs")
      await writeFile(bundlePath, code)
      const { TsCard } = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const fetchSpy = vi.fn(() => { throw new Error("no fetch expected") })
      vi.stubGlobal("fetch", fetchSpy)
      try {
        const container = document.createElement("div")
        TsCard.mount(container)
        await new Promise(resolve => setTimeout(resolve))

        // "Ada" and the ×1 are the signature's own defaults: they only land if
        // `{ label = 'Ada', step = 1 as number }: Props` still parsed as a
        // props pattern after the plugin was done with it
        expect(container.querySelector(".ts-card .label")?.textContent).toBe("Ada 4")
        // the child came out of the bundle, not the network
        expect(container.querySelector(".ts-card .greeting")?.textContent).toBe("Hello, Ada!")
        expect(fetchSpy).not.toHaveBeenCalled()

        // the whole point: `let count: number = 2` is a store variable, not a
        // labeled statement that assigned to `number` and declared nothing
        TsCard.data.count = 5
        expect(container.querySelector(".ts-card .label")?.textContent).toBe("Ada 10")

        expect(warn).not.toHaveBeenCalled() // it went through the plugin
        TsCard.destroy()
      } finally {
        vi.unstubAllGlobals()
        warn.mockRestore()
      }
    })

    it("compiles a typed factory script marked with `type`, keeping its static child import", async () => {
      const result: any = await build({
        configFile: false,
        logLevel: "silent",
        plugins: [jq79()],
        resolve: { alias: { jq79: runtimePath } },
        build: {
          write: false,
          minify: false,
          lib: { entry: fixture("ts-factory-app.js"), formats: ["es"], fileName: "ts-factory-app" },
        },
      })
      const { code } = (Array.isArray(result) ? result[0] : result).output[0]

      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const bundlePath = join(dir, "ts-factory-app.mjs")
      await writeFile(bundlePath, code)
      const { TsFactoryCard } = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)

      const fetchSpy = vi.fn(() => { throw new Error("no fetch expected") })
      vi.stubGlobal("fetch", fetchSpy)
      try {
        const container = document.createElement("div")
        TsFactoryCard.mount(container)
        await new Promise(resolve => setTimeout(resolve))

        // a factory declares its props in its *first parameter*, which sits in
        // the body - so the body's own transform is what makes a typed one
        // readable. Both defaults of `({ label = "Grace", step = 1 }: Props)`
        // landing is the proof it still parsed as a props pattern. The block is
        // marked `type="text/typescript"` rather than `lang="ts"`: the mark an
        // editor reads, through a real build
        expect(container.querySelector(".ts-factory h2")?.textContent).toBe("Grace 3")
        expect(container.querySelector(".ts-factory .greeting")?.textContent).toBe("Hello, Ada!")
        expect(fetchSpy).not.toHaveBeenCalled()
        TsFactoryCard.destroy()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it("bundles a factory-script component with a static child import", async () => {
      const result: any = await build({
        configFile: false,
        logLevel: "silent",
        plugins: [jq79()],
        resolve: { alias: { jq79: runtimePath } },
        build: {
          write: false,
          minify: false,
          lib: { entry: fixture("factory-app.js"), formats: ["es"], fileName: "factory-app" },
        },
      })
      const { code } = (Array.isArray(result) ? result[0] : result).output[0]

      expect(code).toContain("Hello, ${name}!") // the child travels inside the bundle

      const dir = BUNDLE_DIR
      await mkdir(dir, { recursive: true })
      const bundlePath = join(dir, "factory-app.mjs")
      await writeFile(bundlePath, code)
      const { FactoryCard } = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)

      const fetchSpy = vi.fn(() => { throw new Error("no fetch expected") })
      vi.stubGlobal("fetch", fetchSpy)
      try {
        const container = document.createElement("div")
        FactoryCard.mount(container)
        await new Promise(resolve => setTimeout(resolve))

        expect(container.querySelector(".factory h2")?.textContent).toBe("Factory 4")
        expect(container.querySelector(".factory .greeting")?.textContent).toBe("Hello, Ada!")
        expect(fetchSpy).not.toHaveBeenCalled()
        FactoryCard.destroy()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})
