// Measures the benchmark operations for TWO builds of jq79 on ONE machine, in
// one session, alternating between them - and reports the comparison with the
// runner's own noise beside it.
//
// This exists because a stopwatch around a click, taken once per build on a
// shared machine, cannot tell a 10% improvement from the weather: measuring
// one build against *itself* on a busy box produced deltas from -23% to +50%
// (see RECORD/2026-08-23.where-the-create-time-goes.md). A CI runner is a
// shared machine too. So the only number worth reading is a paired one, and
// the only paired number worth believing is one whose sign holds across every
// round.
//
// Usage:
//   node scripts/run-ab.mjs                        # this checkout alone
//   node scripts/run-ab.mjs --base none            # the same, said out loud
//   node scripts/run-ab.mjs --base main            # this checkout vs main
//   node scripts/run-ab.mjs --base v0.6.1 --rounds 4 --samples 12
//   node scripts/run-ab.mjs --flags                # cloneSkeletons off vs on
//   node scripts/run-ab.mjs --flags scopedNames    # any Component79.debug flag
//   node scripts/run-ab.mjs --flags scopedNames --only update1k_x16 --samples 40
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

// "none" as well as empty, because a workflow_dispatch input given as "" comes
// through as the input's *default* - so there has to be a word that means none
const BASE = (() => {
  const value = (arg("base", "") || "").trim()
  return !value || value === "none" ? null : value
})()
// --flags measures THIS checkout against itself with one debug flag off, which
// is a pairing no ref can express: one build, one dist, two URLs. The benchmark
// app switches any flag the query names and calls Component79.debug (see its
// src/main.js), so nothing about the bundle differs between the two sides.
// `--flags` alone means cloneSkeletons, the flag it was written for;
// `--flags scopedNames` prices the const prologue against `with`
const FLAGS = process.argv.includes("--flags")
const FLAG = (() => {
  if (!FLAGS) return null
  const next = process.argv[process.argv.indexOf("--flags") + 1]
  return next && !next.startsWith("--") ? next : "cloneSkeletons"
})()
if (FLAGS && BASE) throw new Error("--flags measures one build against itself; drop --base")
const SAMPLES = Number(arg("samples", 10))
const ROUNDS = Number(arg("rounds", 3))
// the first round of a session is the expensive one - cold JIT, cold page
// cache, an empty heap - and whichever build runs first wears it. The first CI
// run of this script had base's create1k at 51ms, 47.7, 41.2 in that order,
// against head's 35.5, and it was base that opened the session. So one full
// round is run and thrown away
const WARMUP = Number(arg("warmup", 1))
// --only create1k,update1k_x16 narrows every round to those operations, which
// is how one that needs more samples gets them without paying for the other
// nine: a focused round says more about a single operation than a whole
// suite's worth of unfocused ones
const ONLY = (() => {
  const value = (arg("only", "") || "").trim()
  if (!value) return null
  const ids = value.split(",").map(id => id.trim()).filter(Boolean)
  const known = new Set(OPERATIONS.map(op => op.id))
  const unknown = ids.filter(id => !known.has(id))
  if (unknown.length) throw new Error(`--only: no such operation: ${unknown.join(", ")} (have: ${[...known].join(", ")})`)
  return ids
})()
const OUT = arg("out", ROOT)
// The regression gate: fail the process when head is at least this much slower
// than base. 0 turns it off, which is the default - a gate belongs where
// somebody chose to put one (see .github/workflows/benchmark.yml), not on every
// exploratory run
const GATE = Number(arg("gate", 0))
// and never on an operation this small: the clock quantises to 0.05ms, so two
// steps of that on a 1ms operation is "+10%" and no amount of rounds makes it
// mean anything. Every operation in the suite now clears this - the four that
// did not are measured as a batch of 16 clicks (see lib/benchmark-ops.mjs) -
// and the clause stays as the guard that made them get fixed
const GATE_MIN_MS = Number(arg("gate-min-ms", 5))

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

const tryCapture = args => {
  try { return capture("git", args) } catch { return null }
}

// The base ref by whatever name the caller had for it. A CI checkout has the
// commits but not necessarily the branch *names*: `git worktree add main` on a
// runner is `fatal: invalid reference: main`, because nothing there ever
// created a local branch called that. So try the name, then the remote-tracking
// name, then go and fetch it - and hand back a sha, which is the one form
// `worktree add` can never misread
const resolveBaseRef = ref => {
  for (const candidate of [ref, `origin/${ref}`]) {
    const sha = tryCapture(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`])
    if (sha) return sha
  }
  console.log(`[base] ${ref} is not a ref here yet; fetching it from origin ...`)
  try {
    run("git", ["fetch", "--no-tags", "--force", "origin", `+refs/heads/${ref}:refs/remotes/origin/${ref}`], ROOT)
  } catch {
    // not a branch name - a tag or a sha, which the next fetch handles
  }
  const fetched = tryCapture(["rev-parse", "--verify", "--quiet", `origin/${ref}^{commit}`])
  if (fetched) return fetched
  try {
    run("git", ["fetch", "--no-tags", "origin", ref], ROOT)
    const head = tryCapture(["rev-parse", "--verify", "--quiet", "FETCH_HEAD^{commit}"])
    if (head) return head
  } catch {
    // falls through to the error below
  }
  throw new Error(`--base ${ref}: no such ref here or on origin`)
}

// ---------------------------------------------------------------- the builds

const builds = []

await mkdir(STAGE_PKG, { recursive: true })
await cp(join(ROOT, "package.json"), join(STAGE_PKG, "package.json"))

const headDist = await buildInto(ROOT, "head")

if (FLAGS) {
  // base is the flag OFF, so a negative delta reads "cloning is faster", the
  // same direction every other run of this script reports
  builds.push({
    id: "base",
    label: `${shortSha("HEAD")}, ${FLAG} off`,
    ref: capture("git", ["rev-parse", "HEAD"]),
    dist: headDist,
    query: `?${FLAG}=0`,
  })
}

builds.push({
  id: "head",
  label: FLAGS
    ? `${shortSha("HEAD")}, ${FLAG} on`
    : BASE ? `this checkout (${shortSha("HEAD")})` : `jq79 ${shortSha("HEAD")}`,
  ref: capture("git", ["rev-parse", "HEAD"]),
  dist: headDist,
  query: FLAGS ? `?${FLAG}=1` : "",
})

let worktree = null
if (BASE) {
  // the base checkout gets its own node_modules, so it stays out of the stage
  worktree = join(await mkdtemp(join(tmpdir(), "jq79-base-")), "checkout")
  const baseSha = resolveBaseRef(BASE)
  console.log(`[base] checking out ${BASE} (${baseSha.slice(0, 7)}) into a worktree ...`)
  // a run killed before its cleanup leaves the registration behind, and git
  // refuses to reuse the name; pruning first makes a rerun the fix
  run("git", ["worktree", "prune"], ROOT)
  run("git", ["worktree", "add", "--detach", worktree, baseSha], ROOT)
  run("npm", ["install", "--no-audit", "--no-fund", "--include=dev"], worktree)
  builds.unshift({
    id: "base",
    label: `${BASE} (${baseSha.slice(0, 7)})`,
    ref: baseSha,
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

// --------------------------------------------------- reading what was measured

// A round that only measured some operations (the gate's confirmation pass)
// contributes to those and to nothing else
const roundMedians = (buildId, opId) =>
  rounds.filter(round => round[buildId][opId]).map(round => round[buildId][opId].median)
const spread = xs => (Math.max(...xs) - Math.min(...xs)) / median(xs) * 100

const operations = () =>
  OPERATIONS.map(op => {
    const per = Object.fromEntries(builds.map(b => [b.id, roundMedians(b.id, op.id)]))
    const measured = per[builds[0].id].length
    const entry = {
      id: op.id,
      label: op.label,
      // every round's median, per build: the raw material for any other reading
      rounds: per,
      roundsMeasured: measured,
      median: Object.fromEntries(builds.map(b => [b.id, Number(median(per[b.id]).toFixed(2))])),
      // how much this operation moved between rounds of the SAME build - the
      // runner's noise floor for this number, and the bar a delta has to clear.
      // One round cannot measure it, and reports null rather than a flattering 0
      noise: measured < 2 ? null : Number(Math.max(...builds.map(b => spread(per[b.id]))).toFixed(1)),
    }
    if (builds.length === 2) {
      const [base, head] = builds.map(b => per[b.id])
      // The headline delta is the median of the per-round deltas, not the
      // delta of the two medians. They are not the same number, and the
      // difference is not academic: the first CI run had replace1k at
      // base [56.8, 52.2, 74.9] against head [45.6, 66.4, 70.4], where the
      // medians say head is 16.8% SLOWER and the rounds - each one a pair
      // measured minutes apart on one machine - say -19.7%, +27.2%, -6.1%,
      // whose median is -6.1%. The medians compare measurements taken under
      // different conditions; the pairs are the only thing this design
      // actually controls for
      const perRound = head.map((h, i) => (h - base[i]) / base[i] * 100)
      entry.deltaPerRound = perRound.map(n => Number(n.toFixed(1)))
      entry.delta = Number(median(perRound).toFixed(1))
      entry.deltaOfMedians = Number(((median(head) - median(base)) / median(base) * 100).toFixed(1))
      // the sign, round by round: a delta that changes direction between
      // rounds is the runner talking, whatever its size
      entry.headFasterInRounds = head.filter((h, i) => h < base[i]).length
      // Two independent facts, and neither one alone is a result: whether the
      // delta clears the runner's own spread, and whether every round agreed
      // on its sign. The first version of this let the noise gate win outright,
      // and reported a -14.9% that head won 3 rounds out of 3 as flatly
      // "inside the noise" - true of the magnitude, misleading about the
      // direction. A unanimous sign is worth saying out loud, qualified
      const clearsNoise = Math.abs(entry.delta) > entry.noise
      const faster = entry.headFasterInRounds === measured
      const unanimous = faster || entry.headFasterInRounds === 0
      entry.verdict =
        entry.noise === null ? "one round: no noise estimate"
        : unanimous && clearsNoise ? `${faster ? "faster" : "slower"}, every round`
        : unanimous ? `${faster ? "faster" : "slower"} every round, under the noise`
        : clearsNoise ? "inconsistent: the sign changed between rounds"
        : "inside the noise"
    }
    return entry
  })
  // --only leaves the rest unmeasured, and an operation with no rounds behind
  // it has nothing to say: reporting it would print a row of NaN
  .filter(entry => entry.roundsMeasured > 0)

// What the gate is willing to call a regression, and every clause is there to
// keep a busy runner from blocking a merge on nothing:
//
//  - slower by at least the threshold, so a 2% drift is not an event;
//  - by more than this operation's own spread between rounds of one build;
//  - in EVERY round, so a single bad round cannot carry the median;
//  - and only where the numbers are big enough to mean anything - a 1ms
//    operation read off a clock that quantises to 0.05ms is not evidence.
//
// A first pass that trips all four is re-measured before any of it counts
const isRegression = entry =>
  GATE > 0 &&
  builds.length === 2 &&
  entry.noise !== null &&
  entry.delta >= GATE &&
  entry.delta > entry.noise &&
  entry.headFasterInRounds === 0 &&
  entry.median.base >= GATE_MIN_MS

// rounds[i][buildId][opId] = one operation's measurement. A round measures
// every build, which is what makes rounds[i] a pair and the pairing meaningful
const rounds = []
let staged = null
let chromiumVersion = "unknown"
let confirmed = []

try {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  chromiumVersion = browser.version()

  // `only` narrows the round to a few operations, for the gate's second pass
  const measureRound = async (name, at, only = null) => {
    // alternate the order every round, so neither build always inherits the
    // other's warm caches and neither always runs first after a GC
    const order = at % 2 ? [...builds].reverse() : builds
    const measured = {}
    for (const build of order) {
      console.log(`\n--- ${name}: ${build.label} ---`)
      // --flags puts the same dist on both sides, and rebuilding the app to
      // stage a bundle it already has would cost more than the measurement
      if (build.dist !== staged) {
        await useBuild(build.dist)
        staged = build.dist
      }
      const server = await preview({ root: APP_DIR, preview: { port: PORT, strictPort: true }, logLevel: "warn" })
      const operations = await measureApp(page, `http://localhost:${PORT}/${build.query ?? ""}`, SAMPLES, only)
      await server.close()
      measured[build.id] = Object.fromEntries(operations.map(op => [op.id, op]))
    }
    return measured
  }

  for (let round = 0; round < WARMUP + ROUNDS; round++) {
    const warming = round < WARMUP
    const name = warming ? `warm-up ${round + 1}/${WARMUP}` : `round ${round + 1 - WARMUP}/${ROUNDS}`
    const measured = await measureRound(name, round, ONLY)
    if (!warming) rounds.push(measured)
  }

  // The gate never fails on the rounds that raised the suspicion. An operation
  // that looks like a regression is measured again, ROUNDS more times, and
  // judged on everything measured - which is what turns "4 rounds agreed" into
  // 8, and what keeps a blocking check from blocking on a runner's bad minute.
  // Only the suspects are re-measured: confirming one operation should not cost
  // the other eight
  if (GATE && builds.length === 2) {
    const suspects = operations().filter(isRegression).map(op => op.id)
    if (suspects.length) {
      console.log(`\n[gate] slower on ${suspects.join(", ")} - measuring ${ROUNDS} more rounds of just those`)
      for (let round = 0; round < ROUNDS; round++) {
        rounds.push(await measureRound(`confirmation ${round + 1}/${ROUNDS}`, WARMUP + ROUNDS + round, suspects))
      }
      confirmed = suspects
    }
  }

  await browser.close()
} finally {
  // a crashed run must not leave a registered worktree behind: the next one
  // would refuse to check the same ref out again
  await cleanup()
}

// ---------------------------------------------------------------- the report

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
  warmupRounds: WARMUP,
  gate: GATE ? { thresholdPercent: GATE, minMs: GATE_MIN_MS, confirmedWithExtraRounds: confirmed } : null,
  builds: builds.map(({ id, label, ref }) => ({ id, label, ref })),
  operations: operations(),
}

report.regressions = report.operations.filter(isRegression).map(op => op.id)

const pct = n => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`
const noiseCell = n => (n === null ? "n/a" : `±${n.toFixed(1)}%`)
const lines = []
lines.push(`# jq79 benchmark report`)
lines.push("")
if (report.regressions.length) {
  lines.push(`## ⛔ Slower than \`${builds[0].label}\``)
  lines.push("")
  for (const id of report.regressions) {
    const op = report.operations.find(entry => entry.id === id)
    lines.push(`- **${op.label}**: ${pct(op.delta)} (${op.median.base.toFixed(1)}ms → ${op.median.head.toFixed(1)}ms), slower in all ${op.roundsMeasured} rounds, against ±${op.noise.toFixed(1)}% of round-to-round spread.`)
  }
  lines.push("")
  lines.push(`Each of these was measured again - ${ROUNDS} extra rounds of that operation alone - and came back the same way. The gate trips at ${GATE}% on operations of at least ${GATE_MIN_MS}ms, and only when every round agrees and the delta beats the noise.`)
  lines.push("")
}
lines.push(`- **generated** ${report.generatedAt}`)
lines.push(`- **runner** ${report.runner.cpu} · node ${report.runner.node} · chromium ${report.runner.chromium}`)
if (report.runner.ci) lines.push(`- **run** ${report.runner.ci}`)
lines.push(`- **method** ${ROUNDS} alternating rounds × ${SAMPLES} samples per operation, medians${WARMUP ? `, after ${WARMUP} discarded warm-up round${WARMUP > 1 ? "s" : ""}` : ""}`)
for (const b of report.builds) lines.push(`- **${b.id}** ${b.label} \`${b.ref.slice(0, 12)}\``)
if (GATE) lines.push(`- **gate** fails at ${GATE}% slower, on operations of at least ${GATE_MIN_MS}ms${confirmed.length ? `; re-measured ${confirmed.join(", ")}` : ""}`)
lines.push("")

if (builds.length === 2) {
  lines.push(`| operation | base | head | delta | per round | noise | verdict |`)
  lines.push(`|---|---:|---:|---:|---|---:|---|`)
  for (const op of report.operations) {
    lines.push(
      `| ${op.label} | ${op.median.base.toFixed(1)}ms | ${op.median.head.toFixed(1)}ms | ${pct(op.delta)} | ${op.deltaPerRound.map(pct).join(" / ")} | ${noiseCell(op.noise)} | ${op.verdict} |`
    )
  }
  lines.push("")
  lines.push(`**delta** is the median of the **per round** deltas beside it - each of those is one base/head pair measured minutes apart on this machine, which is the only thing a shared runner controls for. It is not the difference of the two medians, which compares measurements taken under different conditions.`)
  lines.push("")
  lines.push(`**noise** is how far this operation moved between rounds of the same build - the runner's own spread.`)
  lines.push(`A delta smaller than it says nothing about size. **"every round"** means the ${ROUNDS} rounds also agreed on the sign - supporting evidence, not proof: ${ROUNDS} coin flips land the same way ${(2 ** (1 - ROUNDS) * 100).toFixed(1)}% of the time. More rounds is the only thing that shrinks both columns.`)
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

// after the report is written, never before: a failing gate must still leave
// behind the numbers it failed on
if (report.regressions.length) {
  console.error(`\nslower than ${builds[0].label}: ${report.regressions.join(", ")}`)
  process.exitCode = 1
}
