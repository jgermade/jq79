// Runs the same js-framework-benchmark operations (scripts/lib/benchmark-ops.mjs)
// against every implementation under frameworks/keyed/, on this machine, in
// the same process - so the numbers are at least comparable to each other,
// even though this is NOT the official js-framework-benchmark harness
// (webdriver-ts): no CPU throttling, no devtools tracing, just the browser's
// own clock around each click. Writes frameworks/keyed/comparison-results.json.
//
// Usage: node scripts/run-comparison.mjs
// Requires `npm run build` to have run first (jq79's app installs from this
// checkout's dist/, not from npm).

import { chromium } from "playwright"
import { preview } from "vite"
import { cpus } from "node:os"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { installAndBuild, measureApp } from "./lib/benchmark-ops.mjs"

const KEYED_DIR = fileURLToPath(new URL("../frameworks/keyed/", import.meta.url))
const RESULTS_PATH = fileURLToPath(new URL("../frameworks/keyed/comparison-results.json", import.meta.url))
const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url))
const PORT = 4791
const SAMPLES = 10 // per operation; the fastest and slowest are dropped, the rest averaged

const APPS = [
  { id: "jq79", label: "jq79", pkg: "jq79", installArg: `jq79@file:${ROOT_DIR}` },
  { id: "vanillajs", label: "vanillajs", pkg: null },
  { id: "preact", label: "Preact", pkg: "preact" },
  { id: "vue", label: "Vue", pkg: "vue" },
  { id: "svelte", label: "Svelte", pkg: "svelte" },
  { id: "react", label: "React", pkg: "react" },
]

const browser = await chromium.launch()
const page = await browser.newPage()

const results = []

for (const app of APPS) {
  const dir = `${KEYED_DIR}${app.id}/`

  console.log(`[${app.id}] installing and building ...`)
  // jq79 installs from this checkout's dist/, not npm - --no-save keeps that
  // one-off resolution out of the app's committed package.json
  const installArgs = app.installArg ? [app.installArg, "--no-save"] : []
  await installAndBuild(dir, installArgs)

  const version = app.pkg
    ? JSON.parse(await readFile(`${dir}node_modules/${app.pkg}/package.json`, "utf8")).version
    : null

  const server = await preview({ root: dir, preview: { port: PORT, strictPort: true }, logLevel: "warn" })
  const url = `http://localhost:${PORT}/`

  console.log(`[${app.id}] benchmarking (${SAMPLES} samples per operation) ...`)
  const operations = await measureApp(page, url, SAMPLES)

  await server.close()

  results.push({ id: app.id, label: app.label, version, operations })
}

await browser.close()

await writeFile(
  RESULTS_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      samples: SAMPLES,
      cpu: `${cpus()[0].model} × ${cpus().length}`,
      frameworks: results,
    },
    null,
    2
  ) + "\n"
)

console.log(`wrote ${RESULTS_PATH}`)
