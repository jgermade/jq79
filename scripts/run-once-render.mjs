// Does a definition that renders ONCE pay for its skeleton plan?
//
// The question §5 of TODOS/2026-08-24.what-is-still-open.md left open, and the
// reason it stayed open: the instrument built for it timed *parse + render* as
// one block - ~154µs, nearly all of it parsing - so the few µs of plan work sat
// under a null control of ±19% and nothing could be read out of it.
//
// The fix is not a better clock. It is measuring a smaller thing:
//
//   1. **Parsing is outside the timed region.** It is identical in both arms
//      and it was ~90% of what was being timed. `planOf` is called from
//      renderNode on first render, so a freshly parsed definition rendered once
//      pays plannableNode + buildSkeleton + renderFromSkeleton inside the clock
//      regardless. Parsing never needed to be in there.
//   2. **Many distinct definitions, each rendered once.** One render is too
//      small to time, so K of them are timed as one block. They have to be
//      *distinct* - the plan cache is a WeakMap keyed by AST node, so parsing K
//      sources gives K plans, which is exactly the "page of many small
//      components" shape §5 says nothing in this repo measures.
//   3. **A detached container.** Layout is identical in both arms and only adds
//      variance. Removing it makes any plan cost a LARGER fraction of what is
//      left, so the instrument errs toward finding a difference rather than
//      hiding one.
//   4. **One build, two arms.** cloneSkeletons is a runtime flag, so both sides
//      are the same bundle in the same page with the same JIT state - a tighter
//      pairing than two builds can give. Same trick as run-ab.mjs --flags.
//
// Usage:
//   node scripts/run-once-render.mjs                 # clone off vs on
//   node scripts/run-once-render.mjs --null          # on vs on, the control
//   node scripts/run-once-render.mjs --rounds 12 --defs 1000 --elements 6
//   node scripts/run-once-render.mjs --renders 4     # where does the plan pay?

import { chromium } from "playwright"
import { build } from "esbuild"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const chromeExecutable = () => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return {}
  const dir = readdirSync(root).filter(name => name.startsWith("chromium-")).sort().pop()
  if (!dir) return {}
  const executablePath = join(root, dir, "chrome-linux", "chrome")
  return existsSync(executablePath) ? { executablePath } : {}
}

const ROOT = fileURLToPath(new URL("..", import.meta.url))

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : Number(process.argv[at + 1])
}

const NULL_CONTROL = process.argv.includes("--null")
const ROUNDS = arg("rounds", 15)
const WARMUP = arg("warmup", 3)
const DEFS = arg("defs", 1500)
// elements per definition. MIN_SKELETON_ELEMENTS is 3, so below that nothing is
// planned at all and the arms are identical by construction
const ELEMENTS = arg("elements", 6)
// definitions per timed chunk. performance.now() is clamped to 100us in a page
// that is not cross-origin isolated (measured), so a chunk has to be worth a
// few ms - and small enough that one machine stall corrupts only one of them
const CHUNK = arg("chunk", 100)
// how many times each definition is rendered. 1 is the question Â§5 asks; above
// it, the plan is built once and reused, so raising this walks the break-even
const RENDERS = arg("renders", 1)

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const half = sorted.length >> 1
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2
}

// The in-page instrument. Everything it needs is passed in, because it is
// serialized across to the browser
const inPage = async ({ defs, elements, chunk, renders, rounds, warmup, nullControl }) => {
  const { Component79, parseComponent, renderComponent, $reactive } = window.jq79

  // K structurally distinct definitions. Distinct so each gets its own plan;
  // the expressions repeat on purpose, so evalExpr's compile cache is warm and
  // `new Function` is not what is being timed
  const sources = []
  for (let i = 0; i < defs; i++) {
    const parts = []
    for (let e = 0; e < elements - 2; e++) {
      // the shape varies with i, so no two definitions are the same tree
      const tag = ["span", "b", "i", "em", "small"][(i + e) % 5]
      parts.push(`<${tag} class="c${(i + e) % 7}">{{ a }}</${tag}>`)
    }
    sources.push(`<div class="d${i % 11}" :class="{ on: flag }"><p @click="hit()">{{ b }}</p>${parts.join("")}</div>`)
  }

  const makeStore = () => $reactive({ a: "x", b: "y", flag: false, hit() {} })

  // times one chunk of definitions, each rendered exactly once, into a detached
  // container. The flag is set per chunk: reading it is one property load in
  // renderNode, paid identically by both arms
  const timeChunk = (parsed, stores, from, to, clone) => {
    Component79.debug({ cloneSkeletons: clone })
    const host = document.createElement("div")
    const start = performance.now()
    for (let i = from; i < to; i++) {
      // `renders` instances of the SAME definition: the plan is built on the
      // first and reused by the rest, which is what makes this a break-even
      // curve rather than a single answer
      for (let n = 0; n < renders; n++) host.appendChild(renderComponent(parsed[i], stores[i]))
    }
    const elapsed = performance.now() - start
    return { elapsed, nodes: host.querySelectorAll("*").length }
  }

  const left = nullControl ? true : false
  const right = true
  const pairs = []
  let nodesLeft = 0
  let nodesRight = 0

  for (let round = 0; round < warmup + rounds; round++) {
    // each arm renders its OWN parse of every source, so both pay a first
    // render of a definition nothing has planned yet - which is the question
    const parsedLeft = sources.map(source => parseComponent(source))
    const parsedRight = sources.map(source => parseComponent(source))
    const storesLeft = sources.map(makeStore)
    const storesRight = sources.map(makeStore)

    // collect the previous round's garbage before the clock starts, not during
    if (window.gc) window.gc()

    for (let from = 0; from < defs; from += chunk) {
      const to = Math.min(from + chunk, defs)
      // alternate which arm opens each chunk. A machine that stalls for 30ms -
      // this box does - then corrupts one chunk of hundreds instead of half a
      // round, and cannot land on the same side every time
      const leftFirst = (from / chunk) % 2 === 0
      const first = leftFirst
        ? timeChunk(parsedLeft, storesLeft, from, to, left)
        : timeChunk(parsedRight, storesRight, from, to, right)
      const second = leftFirst
        ? timeChunk(parsedRight, storesRight, from, to, right)
        : timeChunk(parsedLeft, storesLeft, from, to, left)
      const [l, r] = leftFirst ? [first, second] : [second, first]
      if (round >= warmup) {
        pairs.push([l.elapsed, r.elapsed])
        nodesLeft += l.nodes
        nodesRight += r.nodes
      }
    }
  }

  return { pairs, nodesLeft, nodesRight }
}

const run = async () => {
  const bundle = await build({
    entryPoints: [`${ROOT}src/jq79.ts`],
    bundle: true,
    format: "iife",
    globalName: "jq79",
    write: false,
    logLevel: "silent",
  })
  const source = bundle.outputFiles[0].text

  // --expose-gc so the instrument can collect a round's garbage BEFORE starting
  // the clock rather than during it.
  //
  // The executable is resolved by hand rather than left to playwright: an
  // environment can carry a preinstalled browser whose build number does not
  // match the installed playwright package, and playwright then asks for an
  // install instead of using the one that is right there. Falling back to its
  // own resolution keeps this working where the versions do line up
  const browser = await chromium.launch({ args: ["--js-flags=--expose-gc"], ...chromeExecutable() })
  try {
    const page = await browser.newPage()
    await page.setContent("<!doctype html><html><body></body></html>")
    await page.addScriptTag({ content: source })

    const { pairs, nodesLeft, nodesRight } = await page.evaluate(inPage, {
      defs: DEFS, elements: ELEMENTS, chunk: CHUNK, renders: RENDERS, rounds: ROUNDS, warmup: WARMUP, nullControl: NULL_CONTROL,
    })

    const leftName = NULL_CONTROL ? "clone ON (a)" : "clone OFF"
    const rightName = NULL_CONTROL ? "clone ON (b)" : "clone ON"

    console.log(`\n${DEFS} definitions x ${ELEMENTS} elements, each rendered ${RENDERS === 1 ? "ONCE" : RENDERS + "x"}, in chunks of ${CHUNK}`)
    console.log(`${leftName} vs ${rightName}${NULL_CONTROL ? "   [NULL CONTROL]" : ""}`)
    console.log(`${pairs.length} paired chunks over ${ROUNDS} rounds`)
    // if the two arms did not build the same DOM, nothing below means anything
    console.log(`nodes built: ${nodesLeft} / ${nodesRight}${nodesLeft === nodesRight ? "" : "   *** ARMS DISAGREE ***"}\n`)

    const deltas = pairs.map(([l, r]) => ((r - l) / l) * 100)
    const sorted = [...deltas].sort((a, b) => a - b)
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    const totalLeft = pairs.reduce((sum, [l]) => sum + l, 0)
    const totalRight = pairs.reduce((sum, [, r]) => sum + r, 0)
    const wins = deltas.filter(delta => delta < 0).length
    const sign = value => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`

    console.log(`  total            ${totalLeft.toFixed(1)}ms  vs  ${totalRight.toFixed(1)}ms   ${sign(((totalRight - totalLeft) / totalLeft) * 100)}`)
    console.log(`  median chunk     ${sign(median(deltas))}`)
    console.log(`  p25 .. p75       ${sign(at(0.25))} .. ${sign(at(0.75))}`)
    console.log(`  p05 .. p95       ${sign(at(0.05))} .. ${sign(at(0.95))}`)
    console.log(`  right faster     ${wins}/${deltas.length} chunks  (${((wins / deltas.length) * 100).toFixed(0)}%)`)
    console.log(
      NULL_CONTROL
        ? `\n  ^ the floor. A real run has to clear this p25..p75 band, and its win\n    rate has to sit away from the 50% a coin gives.\n`
        : ""
    )
  } finally {
    await browser.close()
  }
}

run().catch(error => { console.error(error); process.exit(1) })
