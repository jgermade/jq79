// Measures jq79's own performance on the js-framework-benchmark table
// (frameworks/keyed/jq79) and writes benchmark-results.json next to it.
//
// This is NOT the official js-framework-benchmark harness (webdriver-ts) - no
// CPU throttling, no devtools tracing, no other frameworks to compare against.
// jq79 has no microtask/rAF-batched render: a `set` on the store runs its
// effects (and patches the DOM) synchronously, before the write that caused it
// returns. So each operation is timed as the synchronous span of its click:
// performance.now() around a direct .click() call, both read from the page's
// own clock in one round-trip (so Playwright's IPC isn't part of the number).
// Good enough to track jq79's own numbers release over release; not a
// cross-framework leaderboard.
//
// Usage: node scripts/run-benchmark.mjs
// Requires `npm run build` to have run first (the benchmark app installs jq79
// from this checkout's dist/, not from npm, so results always reflect the
// code actually being released).

import { chromium } from "playwright"
import { preview } from "vite"
import { execFileSync } from "node:child_process"
import { cpus } from "node:os"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const APP_DIR = fileURLToPath(new URL("../frameworks/keyed/jq79/", import.meta.url))
const RESULTS_PATH = fileURLToPath(new URL("../frameworks/keyed/jq79/benchmark-results.json", import.meta.url))
const PORT = 4790
const SAMPLES = 10 // per operation; the fastest and slowest are dropped, the rest averaged

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))

console.log("installing the benchmark app against this checkout's dist/ ...")
execFileSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", `jq79@file:${fileURLToPath(new URL("..", import.meta.url))}`], {
  cwd: APP_DIR,
  stdio: "inherit",
})

console.log("building the benchmark app ...")
execFileSync("npx", ["vite", "build"], { cwd: APP_DIR, stdio: "inherit" })

const server = await preview({ root: APP_DIR, preview: { port: PORT, strictPort: true }, logLevel: "warn" })
const url = `http://localhost:${PORT}/`

const browser = await chromium.launch()
const page = await browser.newPage()

// runs entirely inside the page (one round-trip) so Playwright's own IPC
// doesn't get counted as part of the operation
const clickAndTime = (selector, expectedRows) =>
  page.evaluate(
    ({ selector, expectedRows }) => {
      const el = document.querySelector(selector)
      const start = performance.now()
      el.click()
      const elapsed = performance.now() - start
      if (expectedRows != null) {
        const actual = document.querySelectorAll("#tbody tr").length
        if (actual !== expectedRows) throw new Error(`expected ${expectedRows} rows after ${selector}, found ${actual}`)
      }
      return elapsed
    },
    { selector, expectedRows }
  )

const waitForRows = n =>
  page.waitForFunction(count => document.querySelectorAll("#tbody tr").length === count, n, { timeout: 15000 })

const OPERATIONS = [
  {
    id: "create1k",
    label: "Create 1,000 rows",
    prepare: async () => {},
    action: () => clickAndTime("#run", 1000),
  },
  {
    id: "replace1k",
    label: "Replace all 1,000 rows",
    prepare: async () => {
      await page.click("#run")
      await waitForRows(1000)
    },
    action: () => clickAndTime("#run", null),
  },
  {
    id: "partialUpdate",
    label: "Update every 10th row",
    prepare: async () => {
      await page.click("#run")
      await waitForRows(1000)
    },
    action: () => clickAndTime("#update", null),
  },
  {
    id: "selectRow",
    label: "Select a row",
    prepare: async () => {
      await page.click("#run")
      await waitForRows(1000)
    },
    action: () => clickAndTime("#tbody tr:nth-child(2) td:nth-child(2) a", null),
  },
  {
    id: "swapRows",
    label: "Swap rows",
    prepare: async () => {
      await page.click("#run")
      await waitForRows(1000)
    },
    action: () => clickAndTime("#swaprows", null),
  },
  {
    id: "removeRow",
    label: "Remove a row",
    prepare: async () => {
      await page.click("#run")
      await waitForRows(1000)
    },
    action: () => clickAndTime("#tbody tr:nth-child(4) td:nth-child(3) a", 999),
  },
  {
    id: "create10k",
    label: "Create 10,000 rows",
    prepare: async () => {},
    action: () => clickAndTime("#runlots", 10000),
  },
  {
    id: "appendToLarge",
    label: "Append 1,000 rows to 10,000",
    prepare: async () => {
      await page.click("#runlots")
      await waitForRows(10000)
    },
    action: () => clickAndTime("#add", 11000),
  },
  {
    id: "clearLarge",
    label: "Clear 10,000 rows",
    prepare: async () => {
      await page.click("#runlots")
      await waitForRows(10000)
    },
    action: () => clickAndTime("#clear", 0),
  },
]

const trimmedMean = samples => {
  const sorted = [...samples].sort((a, b) => a - b)
  const trimmed = sorted.slice(1, -1)
  return trimmed.reduce((sum, n) => sum + n, 0) / trimmed.length
}

const median = samples => {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const results = []

for (const op of OPERATIONS) {
  console.log(`benchmarking ${op.id} ...`)
  const samples = []
  for (let i = 0; i < SAMPLES; i++) {
    await page.goto(url)
    await page.waitForSelector("#run")
    await op.prepare()
    samples.push(await op.action())
  }
  results.push({
    id: op.id,
    label: op.label,
    samples,
    mean: Number(trimmedMean(samples).toFixed(2)),
    median: Number(median(samples).toFixed(2)),
    min: Number(Math.min(...samples).toFixed(2)),
    max: Number(Math.max(...samples).toFixed(2)),
  })
}

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
      operations: results,
    },
    null,
    2
  ) + "\n"
)

console.log(`wrote ${RESULTS_PATH}`)
