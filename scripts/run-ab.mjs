// Measures the benchmark operations for TWO builds of jq79 on ONE machine, in
// one session, alternating between them - and reports the comparison with the
// runner's own noise beside it.
//
// This exists because a stopwatch around a click, taken once per build on a
// shared machine, cannot tell a 10% improvement from the weather: measuring
// one build against *itself* on a busy box produced deltas from -23% to +50%
// (see TODOS/2026-08-23.where-the-create-time-goes.md). A CI runner is a
// shared machine too. So the only number worth reading is a paired one, and
// the only paired number worth believing is one whose sign holds across every
// round.
//
// Usage:
//   node scripts/run-ab.mjs                        # this checkout alone
//   node scripts/run-ab.mjs --base main            # this checkout vs main
//   node scripts/run-ab.mjs --base v0.6.1 --rounds 4 --samples 12
//
// Writes <out>/benchmark-report.md and <out>/benchmark-report.json, and prints
// the markdown to stdout so it survives in a CI log with no artifact download.

import { chromium } from "playwright"
import { preview } from "vite"
import { execFileSync } from "node:child_process"
import { cpus, tmpdir } from "node:os"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { OPERATIONS, installAndBuild, measureApp, median } from "./lib/benchmark-ops.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const APP_DIR = join(ROOT, "frameworks/keyed/jq79/")
const PORT = 4793

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}

const BASE = arg("base", null)
const SAMPLES = Number(arg("samples", 10))
const ROUNDS = Number(arg("rounds", 3))
const OUT = arg("out", ROOT)

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" })
const capture = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim()

// A package directory the benchmark app is installed against once (npm links
// `file:` dependencies, so the app follows this path rather than copying it).
// Swapping what lives here is what makes a round change builds without a
// reinstall - `npm install` per round would cost more than the measurement.
//
// Under the checkout's own node_modules, not the system temp dir, because
// node resolves a module's imports from its real path: `dist/vite.js` imports
// `vite` (a peer dependency), and from /tmp there is no node_modules above it
// to find one in
const stage = await mkdtemp(join(ROOT, "node_modules/.jq79-ab-"))
const STAGE_PKG = join(stage, "pkg")

const buildInto = async (checkout, label) => {
  const dist = join(stage, label)
  console.log(`[${label}] building jq79 from ${checkout} ...`)
  // tsup alone: the declaration emit in `npm run build` is another 20s of tsc
  // and nothing here reads a .d.ts
  run("npx", ["tsup"], checkout)
  await rm(dist, { recursive: true, force: true })
  await cp(join(checkout, "dist"), dist, { recursive: true })
  return dist
}

const stageDist = async dist => {
  await rm(join(STAGE_PKG, "dist"), { recursive: true, force: true })
  await cp(dist, join(STAGE_PKG, "dist"), { recursive: true })
}

// the app's own vite, and a fresh build per swap: the bundle it produces is
// what the browser will actually run
const useBuild = async dist => {
  await stageDist(dist)
  run(join(APP_DIR, "node_modules/.bin/vite"), ["build", "--logLevel", "warn"], APP_DIR)
}

const shortSha = ref => {
  try { return capture("git", ["rev-parse", "--short", ref]) } catch { return ref }
}

// ---------------------------------------------------------------- the builds

const builds = []

await mkdir(STAGE_PKG, { recursive: true })
await cp(join(ROOT, "package.json"), join(STAGE_PKG, "package.json"))

builds.push({
  id: "head",
  label: BASE ? `this checkout (${shortSha("HEAD")})` : `jq79 ${shortSha("HEAD")}`,
  ref: capture("git", ["rev-parse", "HEAD"]),
  dist: await buildInto(ROOT, "head"),
})

let worktree = null
if (BASE) {
  // the base checkout gets its own node_modules, so it stays out of the stage
  worktree = join(await mkdtemp(join(tmpdir(), "jq79-base-")), "checkout")
  console.log(`[base] checking out ${BASE} into a worktree ...`)
  // a run killed before its cleanup leaves the registration behind, and git
  // refuses to reuse the name; pruning first makes a rerun the fix
  run("git", ["worktree", "prune"], ROOT)
  run("git", ["worktree", "add", "--detach", worktree, BASE], ROOT)
  run("npm", ["install", "--no-audit", "--no-fund", "--include=dev"], worktree)
  builds.unshift({
    id: "base",
    label: `${BASE} (${shortSha(BASE)})`,
    ref: capture("git", ["rev-parse", BASE]),
    dist: await buildInto(worktree, "base"),
  })
}

// ------------------------------------------------------------ the measurement

console.log("installing the benchmark app against the staging package ...")
// seeded with a real build first: the app's vite.config.js imports jq79/vite,
// so the install's own build step needs a dist to resolve before any round
// has had the chance to swap one in
await stageDist(builds[builds.length - 1].dist)
await installAndBuild(APP_DIR, [`jq79@file:${STAGE_PKG}`, "--no-save"])

const cleanup = async () => {
  if (worktree) {
    try { run("git", ["worktree", "remove", "--force", worktree], ROOT) } catch { /* already gone */ }
  }
  await rm(stage, { recursive: true, force: true })
}

// rounds[i][buildId] = { opId: median }
const rounds = []
let chromiumVersion = "unknown"

try {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  chromiumVersion = browser.version()

  for (let round = 0; round < ROUNDS; round++) {
    // alternate the order every round, so neither build always inherits the
    // other's warm caches and neither always runs first after a GC
    const order = round % 2 ? [...builds].reverse() : builds
    const measured = {}
    for (const build of order) {
      console.log(`\n--- round ${round + 1}/${ROUNDS}: ${build.label} ---`)
      await useBuild(build.dist)
      const server = await preview({ root: APP_DIR, preview: { port: PORT, strictPort: true }, logLevel: "warn" })
      const operations = await measureApp(page, `http://localhost:${PORT}/`, SAMPLES)
      await server.close()
      measured[build.id] = Object.fromEntries(operations.map(op => [op.id, op]))
    }
    rounds.push(measured)
  }

  await browser.close()
} finally {
  // a crashed run must not leave a registered worktree behind: the next one
  // would refuse to check the same ref out again
  await cleanup()
}

// ---------------------------------------------------------------- the report

const roundMedians = (buildId, opId) => rounds.map(r => r[buildId][opId].median)
const spread = xs => (Math.max(...xs) - Math.min(...xs)) / median(xs) * 100

const report = {
  generatedAt: new Date().toISOString(),
  runner: {
    cpu: `${cpus()[0].model} × ${cpus().length}`,
    node: process.version,
    chromium: chromiumVersion,
    ci: process.env.GITHUB_ACTIONS ? `${process.env.GITHUB_REPOSITORY}#${process.env.GITHUB_RUN_ID}` : null,
  },
  samples: SAMPLES,
  rounds: ROUNDS,
  builds: builds.map(({ id, label, ref }) => ({ id, label, ref })),
  operations: OPERATIONS.map(op => {
    const per = Object.fromEntries(builds.map(b => [b.id, roundMedians(b.id, op.id)]))
    const entry = {
      id: op.id,
      label: op.label,
      // every round's median, per build: the raw material for any other reading
      rounds: per,
      median: Object.fromEntries(builds.map(b => [b.id, Number(median(per[b.id]).toFixed(2))])),
      // how much this operation moved between rounds of the SAME build - the
      // runner's noise floor for this number, and the bar a delta has to clear.
      // One round cannot measure it, and reports null rather than a flattering 0
      noise: ROUNDS < 2 ? null : Number(Math.max(...builds.map(b => spread(per[b.id]))).toFixed(1)),
    }
    if (builds.length === 2) {
      const [base, head] = builds.map(b => per[b.id])
      entry.delta = Number(((median(head) - median(base)) / median(base) * 100).toFixed(1))
      // the sign, round by round: a delta that changes direction between
      // rounds is the runner talking, whatever its size
      entry.headFasterInRounds = head.filter((h, i) => h < base[i]).length
      entry.verdict =
        entry.noise === null ? "one round: no noise estimate"
        : Math.abs(entry.delta) <= entry.noise ? "inside the noise"
        : entry.headFasterInRounds === ROUNDS ? "faster, every round"
        : entry.headFasterInRounds === 0 ? "slower, every round"
        : "inconsistent"
    }
    return entry
  }),
}

const pct = n => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`
const noiseCell = n => (n === null ? "n/a" : `±${n.toFixed(1)}%`)
const lines = []
lines.push(`# jq79 benchmark report`)
lines.push("")
lines.push(`- **generated** ${report.generatedAt}`)
lines.push(`- **runner** ${report.runner.cpu} · node ${report.runner.node} · chromium ${report.runner.chromium}`)
if (report.runner.ci) lines.push(`- **run** ${report.runner.ci}`)
lines.push(`- **method** ${ROUNDS} alternating rounds × ${SAMPLES} samples per operation, medians`)
for (const b of report.builds) lines.push(`- **${b.id}** ${b.label} \`${b.ref.slice(0, 12)}\``)
lines.push("")

if (builds.length === 2) {
  lines.push(`| operation | base | head | delta | noise | verdict |`)
  lines.push(`|---|---:|---:|---:|---:|---|`)
  for (const op of report.operations) {
    lines.push(
      `| ${op.label} | ${op.median.base.toFixed(1)}ms | ${op.median.head.toFixed(1)}ms | ${pct(op.delta)} | ${noiseCell(op.noise)} | ${op.verdict} (${op.headFasterInRounds}/${ROUNDS}) |`
    )
  }
  lines.push("")
  lines.push(`**noise** is how far this operation moved between rounds of the same build - the runner's own spread.`)
  lines.push(`A delta smaller than it says nothing. \`(k/${ROUNDS})\` is how many rounds head won: only ${ROUNDS}/${ROUNDS} or 0/${ROUNDS} is a direction.`)
  if (ROUNDS < 2) lines.push("")
  if (ROUNDS < 2) lines.push(`> One round measures no noise at all, so every verdict above is unqualified. Re-run with \`--rounds 3\` or more before believing any of them.`)
} else {
  lines.push(`| operation | median | rounds | noise |`)
  lines.push(`|---|---:|---|---:|`)
  for (const op of report.operations) {
    lines.push(`| ${op.label} | ${op.median.head.toFixed(1)}ms | ${op.rounds.head.map(n => n.toFixed(1)).join(", ")} | ${noiseCell(op.noise)} |`)
  }
  lines.push("")
  lines.push(`Run again with \`--base <ref>\` to compare two builds on one machine, which is the only comparison a shared runner can support.`)
}
lines.push("")
lines.push(`<details><summary>raw json</summary>`)
lines.push("")
lines.push("```json")
lines.push(JSON.stringify(report, null, 2))
lines.push("```")
lines.push("")
lines.push(`</details>`)

const markdown = lines.join("\n") + "\n"
await mkdir(OUT, { recursive: true })
await writeFile(join(OUT, "benchmark-report.json"), JSON.stringify(report, null, 2) + "\n")
await writeFile(join(OUT, "benchmark-report.md"), markdown)

console.log("\n" + markdown)
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" })
