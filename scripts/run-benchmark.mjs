// Measures jq79's own performance on the js-framework-benchmark table
// (frameworks/keyed/jq79) and writes benchmark-results.json next to it.
//
// This is NOT the official js-framework-benchmark harness (webdriver-ts) - no
// CPU throttling, no devtools tracing, no other frameworks to compare
// against (see run-comparison.mjs for that). See scripts/lib/benchmark-ops.mjs
// for the operation set and the click-timing methodology, shared with the
// comparison run so the two results pages agree on jq79's numbers.
//
// Usage: node scripts/run-benchmark.mjs
// Requires `npm run build` to have run first (the benchmark app installs jq79
// from this checkout's dist/, not from npm, so results always reflect the
// code actually being released).

import { chromium } from "playwright"
import { preview } from "vite"
import { cpus } from "node:os"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { installAndBuild, measureApp } from "./lib/benchmark-ops.mjs"

const APP_DIR = fileURLToPath(new URL("../frameworks/keyed/jq79/", import.meta.url))
const RESULTS_PATH = fileURLToPath(new URL("../frameworks/keyed/jq79/benchmark-results.json", import.meta.url))
const PORT = 4790
const SAMPLES = 10 // per operation; the fastest and slowest are dropped, the rest averaged

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))

console.log("installing and building the benchmark app against this checkout's dist/ ...")
await installAndBuild(APP_DIR, [`jq79@file:${fileURLToPath(new URL("..", import.meta.url))}`, "--no-save"])

const server = await preview({ root: APP_DIR, preview: { port: PORT, strictPort: true }, logLevel: "warn" })
const url = `http://localhost:${PORT}/`

const browser = await chromium.launch()
const page = await browser.newPage()

console.log(`benchmarking jq79 (${SAMPLES} samples per operation) ...`)
const operations = await measureApp(page, url, SAMPLES)

await browser.close()
await server.close()

await writeFile(
  RESULTS_PATH,
  JSON.stringify(
    {
      jq79Version: pkg.version,
      generatedAt: new Date().toISOString(),
      samples: SAMPLES,
      cpu: `${cpus()[0].model} × ${cpus().length}`,
      operations,
    },
    null,
    2
  ) + "\n"
)

console.log(`wrote ${RESULTS_PATH}`)
