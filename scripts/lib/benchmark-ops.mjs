import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"

// vite's preview()/build() set process.env.NODE_ENV = "production" and leave
// it set - so once one app has been previewed, npm install for the next one
// (inheriting that env) silently omits devDependencies, which is where vite
// itself lives in every one of these apps. "--include=dev" overrides that
// regardless of NODE_ENV; the existsSync check is a belt-and-braces guard
// against this same class of silent partial install
export const installAndBuild = async (dir, installArgs = []) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await rm(`${dir}node_modules`, { recursive: true, force: true })
    await rm(`${dir}package-lock.json`, { force: true })
    execFileSync("npm", ["install", ...installArgs, "--include=dev", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit" })
    if (existsSync(`${dir}node_modules/vite/package.json`)) break
    console.warn(`[install] "vite" missing from node_modules after attempt ${attempt}/3, retrying ...`)
    if (attempt === 3) throw new Error(`${dir}: npm install would not produce a working node_modules/vite after 3 attempts`)
  }
  // the app's own local vite, not whatever "npx vite" resolves to walking up
  // the tree - a mismatch there is what caused each app's own vite plugin
  // (@preact/preset-vite, @vitejs/plugin-vue, ...) to go unresolved
  execFileSync(`${dir}node_modules/.bin/vite`, ["build"], { cwd: dir, stdio: "inherit" })
}

// The operation set every frameworks/keyed/<name> app is measured against -
// shared by scripts/run-benchmark.mjs (jq79 alone) and
// scripts/run-comparison.mjs (all of them), so the two results pages use the
// exact same methodology and their numbers are comparable to each other.
//
// Settling on a click: some of these apps patch the DOM synchronously inside
// the click handler (jq79, vanillajs); others queue the update on a microtask
// (Vue's scheduler, React's batching, Svelte's effects) and apply it before
// that microtask queue drains. Waiting out a few microtask turns after the
// click - `await null` a handful of times - catches both without waiting a
// full animation frame, which would add a ~16ms floor to every measurement
// and swamp the fast operations (select/swap are single-digit milliseconds).

export const OPERATIONS = [
  {
    id: "create1k",
    label: "Create 1,000 rows",
    prepare: async page => {},
    selector: "#run",
    expectedRows: 1000,
  },
  {
    id: "replace1k",
    label: "Replace all 1,000 rows",
    prepare: async page => {
      await page.click("#run")
      await waitForRows(page, 1000)
    },
    selector: "#run",
    expectedRows: null,
  },
  {
    id: "partialUpdate",
    label: "Update every 10th row",
    prepare: async page => {
      await page.click("#run")
      await waitForRows(page, 1000)
    },
    selector: "#update",
    expectedRows: null,
  },
  {
    id: "selectRow",
    label: "Select a row",
    prepare: async page => {
      await page.click("#run")
      await waitForRows(page, 1000)
    },
    selector: "#tbody tr:nth-child(2) td:nth-child(2) a",
    expectedRows: null,
  },
  {
    id: "swapRows",
    label: "Swap rows",
    prepare: async page => {
      await page.click("#run")
      await waitForRows(page, 1000)
    },
    selector: "#swaprows",
    expectedRows: null,
  },
  {
    id: "removeRow",
    label: "Remove a row",
    prepare: async page => {
      await page.click("#run")
      await waitForRows(page, 1000)
    },
    selector: "#tbody tr:nth-child(4) td:nth-child(3) a",
    expectedRows: 999,
  },
  {
    id: "create10k",
    label: "Create 10,000 rows",
    prepare: async page => {},
    selector: "#runlots",
    expectedRows: 10000,
  },
  {
    id: "appendToLarge",
    label: "Append 1,000 rows to 10,000",
    prepare: async page => {
      await page.click("#runlots")
      await waitForRows(page, 10000)
    },
    selector: "#add",
    expectedRows: 11000,
  },
  {
    id: "clearLarge",
    label: "Clear 10,000 rows",
    prepare: async page => {
      await page.click("#runlots")
      await waitForRows(page, 10000)
    },
    selector: "#clear",
    expectedRows: 0,
  },
]

export const waitForRows = (page, n) =>
  page.waitForFunction(count => document.querySelectorAll("#tbody tr").length === count, n, { timeout: 15000 })

// runs entirely inside the page (one round-trip) so Playwright's own IPC
// doesn't get counted as part of the operation
export const clickAndTime = (page, selector, expectedRows) =>
  page.evaluate(
    async ({ selector, expectedRows }) => {
      const el = document.querySelector(selector)
      const start = performance.now()
      el.click()
      // let any microtask-queued reactivity (Vue's scheduler, React's
      // batching, Svelte's effects) flush before reading the DOM or the clock
      for (let i = 0; i < 8; i++) await null
      const elapsed = performance.now() - start
      if (expectedRows != null) {
        const actual = document.querySelectorAll("#tbody tr").length
        if (actual !== expectedRows) throw new Error(`expected ${expectedRows} rows after ${selector}, found ${actual}`)
      }
      return elapsed
    },
    { selector, expectedRows }
  )

export const trimmedMean = samples => {
  const sorted = [...samples].sort((a, b) => a - b)
  const trimmed = sorted.slice(1, -1)
  return trimmed.reduce((sum, n) => sum + n, 0) / trimmed.length
}

export const median = samples => {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// runs the whole OPERATIONS suite against whatever `url` is currently serving,
// `samples` fresh page loads per operation (fastest/slowest dropped)
export const measureApp = async (page, url, samples) => {
  const results = []
  for (const op of OPERATIONS) {
    const times = []
    for (let i = 0; i < samples; i++) {
      await page.goto(url)
      await page.waitForSelector("#run")
      await op.prepare(page)
      times.push(await clickAndTime(page, op.selector, op.expectedRows))
    }
    results.push({
      id: op.id,
      label: op.label,
      samples: times,
      mean: Number(trimmedMean(times).toFixed(2)),
      median: Number(median(times).toFixed(2)),
      min: Number(Math.min(...times).toFixed(2)),
      max: Number(Math.max(...times).toFixed(2)),
    })
  }
  return results
}
