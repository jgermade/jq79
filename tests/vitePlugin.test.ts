
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, it, expect, vi } from "vitest"
import { build } from "vite"
import { jq79 } from "../src/vite"
import { Component79 } from "../src/jq79"

// vitest runs from the repo root
const fixture = (name: string) => resolve("tests/fixtures", name)
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
      const dir = resolve("node_modules/.cache/jq79-tests")
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
      const dir = resolve("node_modules/.cache/jq79-tests")
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

      const dir = resolve("node_modules/.cache/jq79-tests")
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

      const dir = resolve("node_modules/.cache/jq79-tests")
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
