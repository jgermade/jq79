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

// Four of these are a batch of 16 clicks timed as one measurement - the shape
// the official benchmark writes `_x16`, and for the same reason. A single click
// on any of them landed between 1.5ms and 6.3ms; Chromium quantises
// performance.now() to 0.05ms, so one step was 3% of "Update every 10th row"
// and the whole operation was 30 of them. They also sat under run-ab.mjs's
// GATE_MIN_MS, which meant a regression in the two operations jq79 is fastest
// at could not fail a build. Sixteen clicks clear both floors.
//
// The suite builds, appends to and clears a 10,000-row table, and until now it
// only ever *updated* a 1,000-row one - so `update10k_x16` is the cell its own
// symmetry was missing. See RECORD/2026-08-27.measuring-the-update-side.md.

// one selector per click. A batch that clicked the same row link 16 times would
// measure fifteen no-ops - selecting an already-selected row changes nothing -
// so the select batch walks 16 different rows instead
const repeat = (selector, times = 16) => Array(times).fill(selector)
const rowLinks = (times = 16) => Array.from({ length: times }, (_, i) => `#tbody tr:nth-child(${i + 2}) td:nth-child(2) a`)
const build = (button, rows) => async page => {
  await page.click(button)
  await waitForRows(page, rows)
}

export const OPERATIONS = [
  {
    id: "create1k",
    label: "Create 1,000 rows",
    prepare: async page => {},
    clicks: ["#run"],
    expect: { rows: 1000 },
  },
  {
    id: "replace1k",
    label: "Replace all 1,000 rows",
    prepare: build("#run", 1000),
    clicks: ["#run"],
    expect: { rows: 1000 },
  },
  {
    id: "update1k_x16",
    label: "Update every 10th row, 1,000 rows ×16",
    prepare: build("#run", 1000),
    clicks: repeat("#update"),
    // every click appends " !!!" to row 1's label, so all 16 have to have
    // landed for the first cell to carry 16 marks
    expect: { rows: 1000, updateMarks: 16 },
  },
  {
    id: "select1k_x16",
    label: "Select a row, 1,000 rows ×16",
    prepare: build("#run", 1000),
    clicks: rowLinks(),
    expect: { rows: 1000, selectedRows: 1 },
  },
  {
    id: "swap1k_x16",
    label: "Swap rows, 1,000 rows ×16",
    prepare: build("#run", 1000),
    clicks: repeat("#swaprows"),
    // 16 swaps of the same two rows is an even number of them, so the table
    // ends where it started
    expect: { rows: 1000 },
  },
  {
    id: "removeRow",
    label: "Remove a row",
    // the only one that cannot repeat without rebuilding the table between
    // clicks, which would put the rebuild inside the measurement
    prepare: build("#run", 1000),
    clicks: ["#tbody tr:nth-child(4) td:nth-child(3) a"],
    expect: { rows: 999 },
  },
  {
    id: "create10k",
    label: "Create 10,000 rows",
    prepare: async page => {},
    clicks: ["#runlots"],
    expect: { rows: 10000 },
  },
  {
    id: "update10k_x16",
    label: "Update every 10th row, 10,000 rows ×16",
    prepare: build("#runlots", 10000),
    clicks: repeat("#update"),
    expect: { rows: 10000, updateMarks: 16 },
  },
  {
    id: "appendToLarge",
    label: "Append 1,000 rows to 10,000",
    prepare: build("#runlots", 10000),
    clicks: ["#add"],
    expect: { rows: 11000 },
  },
  {
    id: "clearLarge",
    label: "Clear 10,000 rows",
    prepare: build("#runlots", 10000),
    clicks: ["#clear"],
    expect: { rows: 0 },
  },
]

export const waitForRows = (page, n) =>
  page.waitForFunction(count => document.querySelectorAll("#tbody tr").length === count, n, { timeout: 15000 })

// runs entirely inside the page (one round-trip) so Playwright's own IPC
// doesn't get counted as part of the operation. Every element is resolved
// before the clock starts - a querySelector against a 10,000-row table is not
// free, and it is not what any of these operations is about
export const clickAndTime = (page, clicks, expect) =>
  page.evaluate(
    async ({ clicks, expect }) => {
      const els = clicks.map(selector => {
        const el = document.querySelector(selector)
        if (!el) throw new Error(`no element matched ${selector}`)
        return el
      })
      const start = performance.now()
      for (const el of els) {
        el.click()
        // let any microtask-queued reactivity (Vue's scheduler, React's
        // batching, Svelte's effects) flush before reading the DOM or the clock
        for (let i = 0; i < 8; i++) await null
      }
      const elapsed = performance.now() - start

      // what the operation was supposed to do, checked after the clock stops.
      // A batch whose clicks land on detached nodes does no work and reports a
      // very good time for it, and that is the failure this catches
      const check = (what, actual, wanted) => {
        if (wanted != null && actual !== wanted) throw new Error(`expected ${wanted} ${what} after ${clicks.length} click(s), found ${actual}`)
      }
      check("rows", document.querySelectorAll("#tbody tr").length, expect.rows)
      check("selected rows", document.querySelectorAll("#tbody tr.danger").length, expect.selectedRows)
      if (expect.updateMarks != null) {
        // the update walks every 10th row, so row 1 carries one " !!!" per click
        const label = document.querySelector("#tbody tr:nth-child(1) td:nth-child(2) a")?.textContent ?? ""
        check("update marks on row 1", (label.match(/!!!/g) ?? []).length, expect.updateMarks)
      }
      return elapsed
    },
    { clicks, expect }
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
//
// `only` narrows it to a list of operation ids, for a caller that already has
// an answer for the rest: run-ab.mjs re-measures just the operations its
// regression gate is about to fail on, and paying for the other seven to
// confirm one is what would make that confirmation too expensive to do
export const measureApp = async (page, url, samples, only = null) => {
  const results = []
  for (const op of OPERATIONS) {
    if (only && !only.includes(op.id)) continue
    const times = []
    for (let i = 0; i < samples; i++) {
      await page.goto(url)
      await page.waitForSelector("#run")
      await op.prepare(page)
      times.push(await clickAndTime(page, op.clicks, op.expect))
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
