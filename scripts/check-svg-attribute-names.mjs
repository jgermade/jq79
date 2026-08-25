// Does the parser-table oracle hold in every engine?
//
// src/jq79.ts resolves a bound camelCase SVG or MathML attribute name by asking
// the HTML parser's own foreign-attribute adjustment table - the one that makes
// a written-out viewBox survive - rather than shipping a copy of it
// (TODOS/2026-08-25.svg-attribute-names.md). That design was measured in
// Chromium and jsdom. This is what says it holds in Firefox and WebKit too.
//
// Two levels, and only one of them is allowed to fail a build:
//
//   1. THE INVARIANT, and it gates. For every name, the answer the oracle's
//      mechanism gives must equal what that same engine's DOCUMENT parser does
//      with the attribute written out. This is self-referential per engine, so
//      it cannot fail because an engine has a different table - it fails only
//      if the mechanism itself is broken there, e.g. a browser whose DOMParser
//      does not run foreign-content adjustment the way its document parser
//      does. That is our defect, and it should stop a merge.
//
//      The collision check gates for the same reason. The resolution is a pure
//      function of the kebab name (both spellings converge before it runs), so
//      an engine whose table claimed `strokewidth` would silently rewrite
//      `:stroke-width`. That would be a real break for that engine's users.
//
//   2. THE TABLE ITSELF, and it only reports. Which names each engine adjusts
//      is a fact about the web platform, not a bug in this library: an engine
//      that does not adjust `stdDeviation` gives `stddeviation`, which is what
//      that same engine does with `stdDeviation="2"` written out. The page stays
//      consistent with itself. Printed as a three-column diff so a human can
//      read it, in the shape the benchmark job uses - it reports, you decide.
//
// It also answers a question the implementation had to guess at: the oracle can
// ask through DOMParser or through innerHTML in an SVG context. They agree in
// Chromium. Both are measured here, against the document parser, in every
// engine - so if they ever diverge, this says which one to keep.
//
// Run it locally with `npm run check:svg-names` (chromium only unless the other
// browsers are installed), or let the workflow run all three.

import { chromium, firefox, webkit } from "playwright"

import { CAMEL_NAMES, DASHED_NAMES, UNDASHED_NAMES } from "./svg-attribute-corpus.mjs"

const ENGINES = { chromium, firefox, webkit }

const WRAPPER = "svg"
const TAG = "feGaussianBlur"
const flatten = name => name.replace(/-/g, "").toLowerCase()

// The ground truth, and it has to come from the engine's DOCUMENT parser -
// setContent parses a whole document, where insertAdjacentHTML and innerHTML
// both run the *fragment* algorithm. Using one of those here made the
// innerHTML comparison below a test of a thing against itself: structurally
// unable to fail, which is the exact vacuity TODOS/2026-08-24.clone-path-coverage-check.md
// exists to catch. One document holds every probe, so this is one parse
const inDocument = async (page, flats) => {
  const markup = flats.map((flat, index) => `<${TAG} data-probe="${index}" ${flat}="x"/>`).join("")
  await page.setContent(`<!doctype html><title>probe</title><${WRAPPER}>${markup}</${WRAPPER}>`)
  return page.evaluate(({ flats }) => flats.map((flat, index) => {
    const el = document.querySelector(`[data-probe="${index}"]`)
    return el?.getAttributeNames().find(name => name.toLowerCase() === flat) ?? null
  }), { flats })
}

const probe = async (page, names, dashed, undashed) => {
  const all = [...names, ...dashed, ...undashed]
  const flats = all.map(flatten)
  const document_ = await inDocument(page, flats)

  // and the two ways the oracle can ask, both inside the page it just parsed
  const asked = await page.evaluate(({ flats, WRAPPER, TAG }) => {
    const nameIn = (root, lower) =>
      root?.querySelector(TAG)?.getAttributeNames().find(name => name.toLowerCase() === lower) ?? null

    const viaDomParser = flat =>
      nameIn(new DOMParser().parseFromString(`<${WRAPPER}><${TAG} ${flat}="x"/></${WRAPPER}>`, "text/html"), flat)

    const viaInnerHtml = flat => {
      const host = document.createElement("div")
      host.innerHTML = `<${WRAPPER}><${TAG} ${flat}="x"/></${WRAPPER}>`
      return nameIn(host, flat)
    }

    return {
      engine: navigator.userAgent,
      rows: flats.map(flat => ({ domParser: viaDomParser(flat), innerHtml: viaInnerHtml(flat) })),
    }
  }, { flats, WRAPPER, TAG })

  const rows = all.map((name, index) => ({
    name, flat: flats[index], document: document_[index], ...asked.rows[index],
  }))
  return {
    engine: asked.engine,
    camel: rows.slice(0, names.length),
    dashed: rows.slice(names.length, names.length + dashed.length),
    undashed: rows.slice(names.length + dashed.length),
  }
}

const run = async () => {
  const only = process.argv.slice(2).filter(arg => !arg.startsWith("-"))
  const wanted = only.length ? only : Object.keys(ENGINES)
  const results = {}
  const failures = []

  for (const engine of wanted) {
    if (!ENGINES[engine]) {
      console.error(`unknown engine "${engine}" - one of ${Object.keys(ENGINES).join(", ")}`)
      process.exit(2)
    }
    let browser
    try {
      browser = await ENGINES[engine].launch()
    } catch (error) {
      // a missing browser binary is not a result. Say so and keep the exit code
      // clean, so `npm run check:svg-names` is useful with only chromium around
      console.log(`\n## ${engine}: not installed, skipped`)
      console.log(`   ${String(error.message).split("\n")[0]}`)
      continue
    }
    try {
      const page = await browser.newPage()
      await page.setContent("<!doctype html><title>probe</title>")
      results[engine] = await probe(page, CAMEL_NAMES, DASHED_NAMES, UNDASHED_NAMES)
    } finally {
      await browser.close()
    }

    const { camel, dashed, undashed, engine: ua } = results[engine]
    const version = (ua.match(/(Firefox|Chrome|Version)\/[\d.]+/) ?? ["?"])[0]

    // LEVEL 1, and it gates.
    //
    // Note what is NOT asserted: that a bound name equals the same name written
    // out. It does not, and deliberately - `:strokeWidth` binds `stroke-width`
    // where a written-out `strokeWidth` is flattened to `strokewidth`, which is
    // the name rewrite doing its job. What has to hold is that the MECHANISM
    // reproduces the engine's document parser for the flat question the oracle
    // actually asks
    const rows = [...camel, ...dashed, ...undashed]
    const disagree = rows.filter(row => row.domParser !== row.document)
    const innerHtmlDisagree = rows.filter(row => row.innerHtml !== row.document)
    // a dashed name whose de-dashed form the table claims would be silently
    // rewritten - `:stroke-width` would stop being stroke-width in this engine
    const collisions = [...dashed, ...undashed].filter(row => row.document !== null && row.document !== row.flat)

    console.log(`\n## ${engine} (${version})`)
    console.log(`   names checked                 ${camel.length} camelCase, ${dashed.length} dashed, ${undashed.length} undashed`)
    console.log(`   DOMParser vs document parser  ${disagree.length === 0 ? "agree" : `${disagree.length} DISAGREE`}`)
    console.log(`   innerHTML vs document parser  ${innerHtmlDisagree.length === 0 ? "agree" : `${innerHtmlDisagree.length} DISAGREE`}`)
    console.log(`   names the table claims        ${collisions.length === 0 ? "none" : `${collisions.length} COLLIDE`}`)

    disagree.forEach(row => failures.push(`${engine}: asking for ${row.flat} answers ${row.domParser}, the document parser says ${row.document}`))
    collisions.forEach(row => failures.push(`${engine}: ${row.name} would be rewritten to ${row.document}`))
    if (innerHtmlDisagree.length && !disagree.length) {
      console.log(`   -> DOMParser is the one to keep here; innerHTML disagrees with the document`)
    }
  }

  // LEVEL 2, and it only reports
  const engines = Object.keys(results)
  if (engines.length > 1) {
    const rows = CAMEL_NAMES.map(name => {
      const answers = engines.map(engine => results[engine].camel.find(row => row.name === name).document)
      return { name, answers, agree: new Set(answers).size === 1 }
    })
    const split = rows.filter(row => !row.agree)
    console.log(`\n## the table, engine by engine`)
    console.log(`   ${rows.length - split.length} of ${rows.length} names identical across ${engines.join(", ")}`)
    if (split.length) {
      console.log(`   ${split.length} differ - a fact about the platform, not a defect here:`)
      split.forEach(row => console.log(`     ${row.name.padEnd(28)} ${engines.map((e, i) => `${e}=${row.answers[i]}`).join("  ")}`))
    }
  } else if (engines.length === 1) {
    console.log(`\n## the table, engine by engine`)
    console.log(`   only ${engines[0]} ran, so there is nothing to compare`)
  }

  const adjusted = engines.length ? results[engines[0]].camel.filter(row => row.document !== row.flat).length : 0
  if (engines.length) console.log(`\n   ${adjusted} of ${CAMEL_NAMES.length} names are adjusted by ${engines[0]}; the rest are lowercased there, written out or bound alike`)

  if (!engines.length) {
    console.error("\nno engine ran - install one with `npx playwright install chromium`")
    process.exit(2)
  }
  if (failures.length) {
    console.error(`\nFAILED - the oracle does not hold:`)
    failures.forEach(line => console.error(`  ${line}`))
    process.exit(1)
  }
  console.log(`\nthe oracle holds in ${engines.join(", ")}`)
}

run().catch(error => { console.error(error); process.exit(1) })
