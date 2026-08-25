// Does the component box behave in a browser the way jsdom was asked to imagine?
//
// Step 2 of the tag rename gave every component instance an element and one
// line of CSS (RECORD/2026-08-25.the-wrapper-and-the-css-rename.md):
//
//   :where([data-c79-box]) { display: contents }
//
// Every assertion behind it is jsdom's, and jsdom has no layout and no cascade -
// it can say the rule reached document.head and nothing about what it does. This
// opens a browser. See RECORD/2026-08-25.open-a-browser.md.
//
// Two levels, and only one of them is allowed to fail a build:
//
//   1. OURS, and it gates. The box does not disturb the layout its children were
//      in, in flex and in grid, and an author's `c79-panel { display: flex }`
//      outranks the default without !important. Both are measured against a
//      CONTROL rendered in the same engine - the same markup with no component
//      in it - so the gate is engine-independent by construction and asserts no
//      absolute geometry.
//
//      Each of those also measures its own COUNTERFACTUAL: the same page with
//      the mechanism defeated by a stylesheet. If defeating it changes nothing,
//      the probe could not have failed and that is itself a failure. Write the
//      sabotage before trusting the check - here the check carries it.
//
//   2. THE PLATFORM'S, and it reports. Where a component tag lands in table-row
//      position, what an <svg> does with an unknown element wrapped around a
//      component, whether a parent's :empty still matches. An engine that
//      answers differently is news about the web platform, or about a cost
//      already written down - not a defect here. Printed as a table even when
//      everything passes, in the shape the oracle's job uses.
//
// It measures the BUILT BUNDLE in a real page (`npm run build` first), because
// the claims are about what a browser does with what the library ships.
//
// Run it locally with `npm run check:box` (chromium only unless the other
// browsers are installed), or let the workflow run all three. `--exe <path>`
// points one named engine at a browser Playwright did not download itself.

// playwright is imported lazily, inside the path that launches a browser:
// --compare only reads JSON, and the job that runs it has no node_modules - the
// same lesson the oracle's compare job learned by failing (55ef2c5)
const ENGINE_NAMES = ["chromium", "firefox", "webkit"]

import { readFile } from "node:fs/promises"

const BUNDLE = new URL("../dist/jq79.global.js", import.meta.url)

// the same three-item strip in both layout modes, and the two modes catch the
// failure differently. In flex, `flex: 1` is a property only a flex ITEM has, so
// a box that is a box takes the line for itself and the real child stops sizing.
//
// In grid the first shape tried here - three equal tracks, three plain children -
// could not fail, and its own counterfactual said so on the first run: a block
// box lands in cell 2 and the child fills it, so `display: block` measured
// exactly what `display: contents` measured. Uneven tracks and a SPAN fix that.
// `grid-column: 2 / span 2` is honoured only while .b is a grid item; inside a
// box it is 50px of column 2 instead of 200px of columns 2 and 3
const STRIP = {
  flex: { row: "display:flex;width:300px", child: "flex:1" },
  grid: { row: "display:grid;grid-template-columns:100px 50px 150px;width:300px", child: "grid-column:2 / span 2" },
}

// control and component differ in exactly one thing: whether the middle child
// arrives as a component. No newlines between the children - whitespace text
// nodes are ignored by flex and grid, but not by everything, and a probe whose
// two sides differ in whitespace measures the whitespace.
//
// .a and .c carry the flex case's `flex: 1` and nothing in the grid case, where
// the tracks place them; .b carries whichever property the mode is testing
const outer = mode => (mode === "flex" ? "flex:1" : "")

const controlSrc = mode =>
  `<div class="row" style="${STRIP[mode].row}">` +
  `<div class="a" style="${outer(mode)}">A</div>` +
  `<div class="b" style="${STRIP[mode].child}">B</div>` +
  `<div class="c" style="${outer(mode)}">C</div></div>`

const componentSrc = mode =>
  `<div class="row" style="${STRIP[mode].row}">` +
  `<div class="a" style="${outer(mode)}">A</div>` +
  `<Item />` +
  `<div class="c" style="${outer(mode)}">C</div></div>` +
  `<template name="Item"><script :setup></script>` +
  `<div class="b" style="${STRIP[mode].child}">B</div></template>`

// a page per probe. The wrapper rule is injected on the first box and
// deliberately never removed (§5 of the open list), so probes sharing a page
// inherit each other's stylesheets - which is how a wrapper came back `inline`
// while the rule that would have made it `contents` had not been created yet
const freshPage = async (browser, bundle) => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.setContent("<!doctype html><title>box</title><div id=app></div>")
  await page.addScriptTag({ content: bundle })
  await page.evaluate(() => {
    window.probe = {
      mount(source) {
        const app = document.getElementById("app")
        new window.jq79.Component79(source).mount(app)
        return app
      },
      css(text, first = false) {
        const el = document.createElement("style")
        el.textContent = text
        if (first) document.head.insertBefore(el, document.head.firstChild)
        else document.head.appendChild(el)
        return el
      },
      // the geometry that matters, rounded to hundredths: sub-pixel noise is not
      // a difference, and a box that became a box moves things by pixels
      rects(selectors) {
        return selectors.map(selector => {
          const el = document.querySelector(selector)
          if (!el) return null
          const r = el.getBoundingClientRect()
          return [r.x, r.y, r.width, r.height].map(n => Math.round(n * 100) / 100)
        })
      },
    }
  })
  return page
}

const SELECTORS = [".a", ".b", ".c"]
const sameRects = (left, right) => JSON.stringify(left) === JSON.stringify(right)

// LEVEL 1. Three measurements per layout mode: the markup with no component in
// it, the same markup with one, and the same again with the box forced to be a
// box. The first two must agree - that is the claim - and the third must not:
// a sabotage that measures the same as the real thing proves the probe blind
const layoutProbe = async (browser, bundle, mode) => {
  const control = await freshPage(browser, bundle)
  const controlRects = await control.evaluate(({ src, selectors }) => {
    window.probe.mount(src)
    return window.probe.rects(selectors)
  }, { src: controlSrc(mode), selectors: SELECTORS })
  await control.close()

  const boxed = await freshPage(browser, bundle)
  const { rects: boxedRects, display } = await boxed.evaluate(({ src, selectors }) => {
    window.probe.mount(src)
    return {
      rects: window.probe.rects(selectors),
      display: getComputedStyle(document.querySelector("[data-c79-box]")).display,
    }
  }, { src: componentSrc(mode), selectors: SELECTORS })
  await boxed.close()

  const sabotaged = await freshPage(browser, bundle)
  const sabotagedRects = await sabotaged.evaluate(({ src, selectors }) => {
    // !important, and deliberately: this probe asks what `display: contents`
    // does to layout, not who wins the cascade - that is the probe below. An
    // ordinary `c79-item { display: block }` loses the moment the default rule
    // is written without :where(), which made a broken cascade report itself as
    // three blind probes rather than the one real failure
    window.probe.css("[data-c79-box] { display: block !important }")
    window.probe.mount(src)
    return window.probe.rects(selectors)
  }, { src: componentSrc(mode), selectors: SELECTORS })
  await sabotaged.close()

  return {
    mode,
    display,
    control: controlRects,
    boxed: boxedRects,
    sabotaged: sabotagedRects,
    agrees: sameRects(controlRects, boxedRects),
    // the sabotage has to move something. If `display: block` on the box leaves
    // the strip where it was, this measurement is not reading layout at all
    sabotageMoves: !sameRects(controlRects, sabotagedRects),
  }
}

// LEVEL 1. The author's rule is inserted BEFORE the library's exists, which is
// the order that decides it: the library appends its stylesheet when the first
// box renders, so at equal specificity source order would hand the default the
// win. `:where()` is what makes the author's 0-0-1 beat it anyway.
//
// The counterfactual is the same page with the rule written as the plan first
// wrote it - `[data-c79-box] { display: contents }`, 0-1-0 - which takes the
// cascade back from the author whatever the order
const whereProbe = async (browser, bundle) => {
  const src =
    `<div class="host" style="width:300px"><Panel /></div>` +
    `<template name="Panel"><script :setup></script>` +
    `<div class="p1" style="flex:1">1</div><div class="p2" style="flex:1">2</div></template>`

  const honoured = await freshPage(browser, bundle)
  const author = await honoured.evaluate(({ src }) => {
    window.probe.css("c79-panel { display: flex }", true)
    window.probe.mount(src)
    return {
      display: getComputedStyle(document.querySelector("[data-c79-box]")).display,
      rects: window.probe.rects([".p1", ".p2"]),
      // what the library actually shipped into the page, read back rather than
      // assumed: the gate below is about this exact text
      rule: [...document.head.querySelectorAll("style")].map(el => el.textContent).find(text => text.includes("data-c79-box")) ?? null,
    }
  }, { src })
  await honoured.close()

  const overruled = await freshPage(browser, bundle)
  const naked = await overruled.evaluate(({ src }) => {
    window.probe.css("c79-panel { display: flex }", true)
    window.probe.mount(src)
    window.probe.css("[data-c79-box] { display: contents }")
    return { display: getComputedStyle(document.querySelector("[data-c79-box]")).display }
  }, { src })
  await overruled.close()

  return {
    display: author.display,
    rule: author.rule,
    sideBySide: author.rects[0] && author.rects[1] && author.rects[0][0] !== author.rects[1][0],
    withoutWhere: naked.display,
    wins: author.display === "flex",
    // and without :where() it has to lose, or the probe never tested the cascade
    sabotageMoves: naked.display !== "flex",
  }
}

// LEVEL 2. Every component tag is `c79-*` now, whatever the author wrote, so the
// old "positioned correctly by accident of its name" is gone - both spellings
// get the same answer from the parser. What that answer IS, in a real engine,
// is what this reads. jsdom says foster-parented; nothing else has said anything
const tableProbe = async (browser, bundle) => {
  const page = await freshPage(browser, bundle)
  const answer = await page.evaluate(() => {
    const read = (name) => {
      const app = document.getElementById("app")
      app.innerHTML = ""
      window.probe.mount(
        `<table class="t"><tbody><${name} /></tbody></table>` +
        `<template name="${name}"><script :setup></script><tr class="r"><td>x</td></tr></template>`,
      )
      const box = app.querySelector("[data-c79-box]")
      const row = app.querySelector(".r")
      const answer = {
        tag: box?.tagName.toLowerCase() ?? null,
        boxParent: box?.parentElement?.tagName.toLowerCase() ?? null,
        rowParent: row?.parentElement?.tagName.toLowerCase() ?? null,
        insideTable: !!app.querySelector("table .r"),
      }
      app.innerHTML = ""
      return answer
    }
    return { Row: read("Row"), Tr: read("Tr") }
  })
  await page.close()
  return answer
}

// LEVEL 1 for what it gates, LEVEL 2 for what it finds. `componentBox` returns a
// fragment inside <svg> or <math> because SVG renders neither an unknown element
// nor its children - a wrapper there could turn a diagram into a blank. That was
// the conservative reading of the rendering model, from a runner with no layout,
// and it is not conservative: deleting the exception (run as a sabotage) turns a
// red circle into an empty box. So "a component inside <svg> still paints" gates,
// against the control below. What it does with a box is the level-2 half - an
// engine that renders a wrapped child anyway makes the exception unnecessary
// there, which is news rather than a defect.
//
// Four readings: the component as it ships (no box), the same tree with the box
// the exception withholds, that box with the library's own rule on it (is
// `display: contents` the escape hatch there that it is in HTML?), and what
// namespace a component's own root lands in when its template is not <svg>
const svgProbe = async (browser, bundle) => {
  const page = await freshPage(browser, bundle)
  const answer = await page.evaluate(() => {
    const app = document.getElementById("app")
    const paints = (selector) => {
      const el = document.querySelector(selector)
      if (!el) return { rect: null, hit: null }
      const r = el.getBoundingClientRect()
      const hit = r.width && r.height ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null
      return {
        rect: [r.width, r.height].map(n => Math.round(n * 100) / 100),
        hit: hit && (typeof hit.className === "string" ? hit.className : hit.className?.baseVal) || null,
      }
    }

    // the rule the library injects on its first box, obtained the only honest
    // way: render a component in HTML, where it makes one. Every mount below is
    // inside <svg>, where the exception means no box is ever created - the first
    // draft read document.head after those and got null, so the "with the rule"
    // reading was the same page as the one without it
    window.probe.mount(`<div class="seed"><Any /></div><template name="Any"><script :setup></script><i>.</i></template>`)
    const rule = [...document.head.querySelectorAll("style")].map(el => el.textContent).find(text => text.includes("data-c79-box")) ?? null
    app.innerHTML = ""

    // the control: the same drawing with no component in it. "The circle paints"
    // is not a number anyone should write down - it is a comparison
    window.probe.mount(
      `<svg class="s0" width="100" height="100" viewBox="0 0 100 100">` +
      `<svg class="inner0" x="10" y="10" width="80" height="80"><circle class="d0" cx="40" cy="40" r="20" fill="red" /></svg></svg>`,
    )
    const control = { ns: app.querySelector(".d0")?.namespaceURI ?? null, ...paints(".d0") }
    app.innerHTML = ""

    // 1. as it ships: a component rooted at <svg>, used inside <svg>
    window.probe.mount(
      `<svg class="s" width="100" height="100" viewBox="0 0 100 100"><Dot /></svg>` +
      `<template name="Dot"><script :setup></script>` +
      `<svg class="inner" x="10" y="10" width="80" height="80"><circle class="d" cx="40" cy="40" r="20" fill="red" /></svg></template>`,
    )
    const shipped = {
      box: !!app.querySelector("[data-c79-box]"),
      ns: app.querySelector(".d")?.namespaceURI ?? null,
      ...paints(".d"),
    }

    // 4. a component whose root is a bare SVG element: its template is parsed on
    // its own, where <circle> is not in a foreign context
    app.innerHTML = ""
    window.probe.mount(
      `<svg class="s3" width="100" height="100" viewBox="0 0 100 100"><Bare /></svg>` +
      `<template name="Bare"><script :setup></script><circle class="d3" cx="50" cy="50" r="20" fill="red" /></template>`,
    )
    const bareRoot = { ns: app.querySelector(".d3")?.namespaceURI ?? null, ...paints(".d3") }

    // 2 and 3: the box the exception withholds, built by hand where it would go
    const seeded = [...document.head.querySelectorAll("style")].filter(el => el.textContent.includes("data-c79-box"))
    const wrapped = (withRule) => {
      app.innerHTML = ""
      // the seeded copy comes OUT for the unstyled reading, or the page still
      // carries the rule the reading is meant to be missing
      seeded.forEach(el => el.remove())
      const style = withRule && rule ? window.probe.css(rule) : null
      app.innerHTML =
        `<svg class="s2" width="100" height="100" viewBox="0 0 100 100">` +
        `<c79-dot data-c79-box><svg class="inner2" x="10" y="10" width="80" height="80">` +
        `<circle class="d2" cx="40" cy="40" r="20" fill="red"/></svg></c79-dot></svg>`
      const wrapper = app.querySelector("c79-dot")
      const answer = {
        wrapperNs: wrapper?.namespaceURI ?? null,
        wrapperDisplay: wrapper ? getComputedStyle(wrapper).display : null,
        ...paints(".d2"),
      }
      style?.remove()
      app.innerHTML = ""
      return answer
    }
    // the rule first, while it is the only <style> in the page, then without
    const withRule = wrapped(true)
    const bare = wrapped(false)
    return { rule, control, shipped, bareRoot, wrapped: withRule, wrappedUnstyled: bare }
  })
  await page.close()
  return answer
}

// LEVEL 2. A cost step 2 wrote down and nobody has watched: the child is an
// empty element now rather than nothing, so a parent that matched :empty stops
const emptyProbe = async (browser, bundle) => {
  const page = await freshPage(browser, bundle)
  const answer = await page.evaluate(() => {
    window.probe.mount(
      `<div class="host"><None /></div>` +
      `<template name="None"><script :setup></script><span :if="false">x</span></template>`,
    )
    return {
      hostMatchesEmpty: document.querySelector(".host").matches(":empty"),
      boxDisplay: getComputedStyle(document.querySelector("[data-c79-box]")).display,
    }
  })
  await page.close()
  return answer
}

const engineOf = async (page) => page.evaluate(() => navigator.userAgent)

const probeAll = async (browser, bundle) => {
  const page = await freshPage(browser, bundle)
  const ua = await engineOf(page)
  await page.close()
  return {
    ua,
    flex: await layoutProbe(browser, bundle, "flex"),
    grid: await layoutProbe(browser, bundle, "grid"),
    where: await whereProbe(browser, bundle),
    table: await tableProbe(browser, bundle),
    svg: await svgProbe(browser, bundle),
    empty: await emptyProbe(browser, bundle),
  }
}

// what an engine answers at level 2, flattened to one line per fact. This is the
// table the compare job prints, and the only place the repo holds it
const factsOf = (result) => ({
  "box display": result.flex.display,
  "table: box lands in": result.table.Row.boxParent,
  "table: <tr> inside the table": String(result.table.Row.insideTable),
  "table: <Tr /> agrees with <Row />": String(result.table.Row.boxParent === result.table.Tr.boxParent),
  "svg: the same drawing without a component": String(result.svg.control.rect?.[0] > 0),
  "svg: component paints (no box)": String(result.svg.shipped.rect?.[0] > 0),
  "svg: and the point hits": String(result.svg.shipped.hit),
  "svg: paints inside a box": String(result.svg.wrapped.rect?.[0] > 0),
  "svg: box display with the rule": result.svg.wrapped.wrapperDisplay,
  "svg: paints inside an unstyled box": String(result.svg.wrappedUnstyled.rect?.[0] > 0),
  "svg: bare-rooted child namespace": result.svg.bareRoot.ns,
  "parent still matches :empty": String(result.empty.hostMatchesEmpty),
})

const report = (engine, version, result) => {
  const { flex, grid, where } = result
  console.log(`\n## ${engine} (${version})`)
  console.log(`   flex: box vs no box            ${flex.agrees ? "identical" : "DIFFER"}${flex.sabotageMoves ? "" : "  (and the sabotage moved nothing)"}`)
  console.log(`   grid: box vs no box            ${grid.agrees ? "identical" : "DIFFER"}${grid.sabotageMoves ? "" : "  (and the sabotage moved nothing)"}`)
  console.log(`   author rule over the default   ${where.wins ? `wins (${where.display})` : `LOSES (${where.display})`}`)
  console.log(`   the same rule without :where() ${where.withoutWhere}${where.sabotageMoves ? "" : "  (which is not a counterfactual)"}`)
  console.log(`   svg: component vs no component ${svgPaints(result) ? "both paint" : "the COMPONENT does not paint"}`)
  if (svgPaints(result) && result.svg.wrapped.rect?.[0] > 0) {
    // not a failure: it would mean the exception in componentBox is protecting
    // against something this engine does not do. News about the platform, and
    // the reason RECORD/2026-08-25.open-a-browser.md says removing it is its own
    // change with its own evidence
    console.log(`   -> a box inside <svg> does NOT hide its children here; the exception may be unnecessary in this engine`)
  }
  if (!flex.agrees) console.log(`     control ${JSON.stringify(flex.control)}\n     boxed   ${JSON.stringify(flex.boxed)}`)
  if (!grid.agrees) console.log(`     control ${JSON.stringify(grid.control)}\n     boxed   ${JSON.stringify(grid.boxed)}`)

  console.log(`\n   the platform's answers, reported and not gated:`)
  Object.entries(factsOf(result)).forEach(([fact, value]) => console.log(`     ${fact.padEnd(42)} ${value}`))
}

// the component draws what the same markup draws without it. Measured against
// the control in the same page, so nothing here asserts a pixel.
//
// Geometry only, deliberately: an element SVG does not render reports 0x0, which
// is what the sabotage produced and what this has to catch. The hit test beside
// it is reported and not gated - a gate that also demands elementFromPoint find
// the circle would fail an engine that hit-tests the <svg> there, which is a
// false red about nothing this claim is about
const svgPaints = (result) =>
  result.svg.control.rect?.[0] > 0 && result.svg.shipped.rect?.[0] > 0 &&
  result.svg.shipped.rect[0] === result.svg.control.rect[0]

const failuresOf = (engine, result) => {
  const out = []
  const { flex, grid, where } = result
  ;[flex, grid].forEach(layout => {
    if (!layout.agrees) out.push(`${engine}: the box changes ${layout.mode} layout - control ${JSON.stringify(layout.control)} vs ${JSON.stringify(layout.boxed)}`)
    // a probe that cannot fail is not a probe. Its own sabotage says whether it
    // is reading anything: RECORD/2026-08-24.clone-path-coverage-check.md
    if (!layout.sabotageMoves) out.push(`${engine}: forcing the ${layout.mode} box to display:block changed nothing - this probe is not measuring layout`)
  })
  if (!where.wins) out.push(`${engine}: c79-panel { display: flex } lost to the default - the box computed ${where.display}`)
  if (!where.sabotageMoves) out.push(`${engine}: the rule without :where() also lost to the author - this probe is not measuring the cascade`)
  if (where.wins && !where.sideBySide) out.push(`${engine}: the box computed flex and its children did not lay out side by side`)
  // ours too, and it gates: componentBox withholds the box in a foreign
  // namespace precisely so this keeps painting. Removing that exception was run
  // as a sabotage and turned this red, which is why it is not a report
  if (result.svg.control.rect?.[0] > 0 && !svgPaints(result)) {
    out.push(`${engine}: a component inside <svg> does not paint what the same markup paints without it - control ${JSON.stringify(result.svg.control)} vs ${JSON.stringify(result.svg.shipped)}`)
  }
  if (!(result.svg.control.rect?.[0] > 0)) out.push(`${engine}: the control drawing did not paint either - this probe is measuring nothing`)
  return out
}

// The matrix puts every engine on its own runner, so no job in it can see the
// others - the same reason the oracle grew a compare job (487035f). Each engine
// writes its facts out; this reads them all
const compareReports = async (dir) => {
  const { readdir } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const files = (await readdir(dir, { recursive: true })).filter(name => name.endsWith(".json"))
  const reports = await Promise.all(files.map(async name => JSON.parse(await readFile(join(dir, name), "utf8"))))
  if (!reports.length) {
    console.error(`no engine reports under ${dir} - the jobs that write them did not run, or their artifacts did not arrive`)
    process.exit(2)
  }
  reports.sort((a, b) => a.engine.localeCompare(b.engine))
  const engines = reports.map(report => report.engine)
  console.log(`## the box, engine by engine\n`)
  reports.forEach(report => console.log(`   ${report.engine.padEnd(10)} ${report.version}`))

  const facts = Object.keys(reports[0].facts)
  const split = facts.filter(fact => new Set(reports.map(report => String(report.facts[fact]))).size !== 1)
  console.log(`\n   ${facts.length - split.length} of ${facts.length} answers identical across ${engines.join(", ")}`)
  console.log(``)
  facts.forEach(fact => {
    const answers = reports.map(report => report.facts[fact])
    const mark = split.includes(fact) ? " <-" : "  "
    console.log(`   ${fact.padEnd(42)}${mark} ${engines.map((engine, i) => `${engine}=${answers[i]}`).join("  ")}`)
  })
  if (split.length) {
    // a fact about the platform, not a defect here - the same posture the
    // oracle's table takes about a name an engine does not adjust
    console.log(`\n   ${split.length} differ. That is the platform's answer, not this library's; what gates is level 1, inside each engine's own job.`)
  }
}

const run = async () => {
  const compareAt = process.argv.indexOf("--compare")
  if (compareAt !== -1) return compareReports(process.argv[compareAt + 1])

  const valueAfter = flag => {
    const at = process.argv.indexOf(flag)
    return at === -1 ? null : process.argv[at + 1]
  }
  const jsonPath = valueAfter("--json")
  // a browser Playwright did not download itself - some environments ship one
  // and deny the CDN that would fetch the matching build
  const exe = valueAfter("--exe")
  const taken = new Set([jsonPath, exe, process.argv[compareAt + 1]])
  const only = process.argv.slice(2).filter(arg => !arg.startsWith("-") && !taken.has(arg))

  let bundle
  try {
    bundle = await readFile(BUNDLE, "utf8")
  } catch {
    console.error(`no bundle at ${BUNDLE.pathname} - run \`npm run build\` first. This measures what ships, not the source`)
    process.exit(2)
  }

  const ENGINES = await import("playwright")
  const wanted = only.length ? only : ENGINE_NAMES
  const results = {}
  const failures = []

  for (const engine of wanted) {
    if (!ENGINE_NAMES.includes(engine)) {
      console.error(`unknown engine "${engine}" - one of ${ENGINE_NAMES.join(", ")}`)
      process.exit(2)
    }
    let browser
    try {
      browser = await ENGINES[engine].launch(exe && wanted.length === 1 ? { executablePath: exe } : {})
    } catch (error) {
      // a missing browser binary is not a result. Say so and keep the exit code
      // clean, so `npm run check:box` is useful with only chromium around
      console.log(`\n## ${engine}: not installed, skipped`)
      console.log(`   ${String(error.message).split("\n")[0]}`)
      continue
    }
    try {
      results[engine] = await probeAll(browser, bundle)
    } finally {
      await browser.close()
    }
    const version = (results[engine].ua.match(/(Firefox|Chrome|Version)\/[\d.]+/) ?? ["?"])[0]
    report(engine, version, results[engine])
    failures.push(...failuresOf(engine, results[engine]))
  }

  // written even on a failure: an engine that disagrees is exactly the one the
  // comparison is worth reading for
  if (jsonPath) {
    const { writeFile } = await import("node:fs/promises")
    const [engine] = Object.keys(results)
    if (engine) {
      const result = results[engine]
      await writeFile(jsonPath, JSON.stringify({
        engine,
        version: (result.ua.match(/(Firefox|Chrome|Version)\/[\d.]+/) ?? ["?"])[0],
        facts: factsOf(result),
        detail: result,
      }, null, 2))
      console.log(`\n   answers written to ${jsonPath}`)
    }
  }

  const engines = Object.keys(results)
  // only when several ran in ONE process, which is what a local run does. In CI
  // the matrix separates them and the compare job does this off the artifacts
  if (engines.length > 1) {
    console.log(`\n## the box, engine by engine`)
    const facts = Object.keys(factsOf(results[engines[0]]))
    const answers = Object.fromEntries(engines.map(engine => [engine, factsOf(results[engine])]))
    const split = facts.filter(fact => new Set(engines.map(engine => String(answers[engine][fact]))).size !== 1)
    console.log(`   ${facts.length - split.length} of ${facts.length} answers identical across ${engines.join(", ")}\n`)
    facts.forEach(fact => console.log(`   ${fact.padEnd(42)}${split.includes(fact) ? " <-" : "  "} ${engines.map(engine => `${engine}=${answers[engine][fact]}`).join("  ")}`))
  }

  if (!engines.length) {
    console.error("\nno engine ran - install one with `npx playwright install chromium`")
    process.exit(2)
  }
  if (failures.length) {
    console.error(`\nFAILED - the box does not behave as claimed:`)
    failures.forEach(line => console.error(`  ${line}`))
    process.exit(1)
  }
  console.log(`\nthe box holds in ${engines.join(", ")}`)
}

run().catch(error => { console.error(error); process.exit(1) })
