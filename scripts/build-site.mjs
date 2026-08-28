// Builds the GitHub Pages site into site/ from things the repo already has:
//
//   /                 index.html (rendered README) + the dist/ files, so the
//                     Pages URL doubles as a CDN (https://.../jq79/jq79.js)
//   /docs/*.html      rendered documentation pages
//   /coverage/        the HTML coverage report (vitest run --coverage)
//   /badges/npm.svg   self-hosted badges (npm version, test coverage)
//   /badges/coverage.svg
//
// Expects `npm run build` and `npm run test:coverage` to have run first.

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { posix } from "node:path"
import { gzip } from "node:zlib"
import { promisify } from "node:util"
import { marked } from "marked"
import { markedHighlight } from "marked-highlight"
import hljs from "highlight.js"

const gzipSize = promisify(gzip)

marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext"
      return hljs.highlight(code, { language }).value
    },
  })
)

// marked emits headings with no id, so the cross-document anchor links the docs
// already use (components.md#styles, vite-plugin.md#style-lang--css-preprocessors)
// landed nowhere once rendered - they only worked on GitHub, which slugs headings
// itself. Same rules as GitHub's: lowercase, drop anything that isn't a word
// character/space/hyphen, then one hyphen per remaining space (an em dash leaves
// the spaces on either side of it behind, hence the double hyphens)
const slug = text =>
  text.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s/g, "-")

marked.use({
  renderer: {
    heading(token) {
      const content = this.parser.parseInline(token.tokens)
      return `<h${token.depth} id="${slug(token.text)}">${content}</h${token.depth}>\n`
    },
  },
})

const SITE = "site"
const REPO_URL = "https://github.com/jgermade/jq79"
const NPM_URL = "https://www.npmjs.com/package/jq79"

const pkg = JSON.parse(await readFile("package.json", "utf8"))

// --- badges -----------------------------------------------------------------

// a minimal shields-style flat badge (label gray, value colored)
const badge = (label, value, color) => {
  const width = text => Math.round(text.length * 6.5 + 12)
  const lw = width(label)
  const vw = width(value)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${label}: ${value}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${lw + vw}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${lw + vw}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14">${label}</text>
    <text x="${lw + vw / 2}" y="14">${value}</text>
  </g>
</svg>`
}

const coverageColor = pct =>
  pct >= 90 ? "#4c1" : pct >= 80 ? "#97ca00" : pct >= 70 ? "#dfb317" : "#e05d44"

// --- markdown pages ----------------------------------------------------------

const ROOT_CSS = `
:root { color-scheme: light dark; --fg: #1f2328; --body-bg: #333a3e; --bg: #fff; --muted: #59636e; --line: #d1d9e0; --accent: #0969da; --code-bg: #ecf1f5; }
@media (prefers-color-scheme: dark) { :root { --fg: #f0f6fc; --body-bg: #222; --bg: #333a3e; --muted: #9198a1; --line: #3d444d; --accent: #4493f8; --code-bg: #2d2a2e; } }
`

// shared by the markdown pages and the (istanbul-generated) coverage report, so
// the background/font are set on the header itself rather than inherited.
// Every selector is anchored at `body > header` - the page's own chrome, always
// the first child of <body>. A bare `header` would reach into whatever the page
// mounts below it: the tutorial's tab bar is a <header> too, and used to come out
// wearing the site header's dark background
const HEADER_CSS = `
body > header { background: var(--body-bg); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
body > header nav { max-width: 860px; margin: 0 auto; padding: 0 1.5rem; height: 2.5rem; display: flex; gap: 1.2rem; align-items: center; flex-wrap: wrap; }
/* 1.5rem is the tallest nav item (the logos), so the wordmark matches it: the
   header keeps its height whether .start is text or the GitHub image */
body > header nav .start { margin-right: auto; font-weight: bold; font-size: 1.2rem; line-height: 1.5rem; }
body > header nav .github { display: inline-block; height: 1.5rem; opacity: 0.8; transition: opacity 0.1s; }
body > header nav .github:hover { opacity: 1; }
body > header nav .github img { height: 100%; display: block; }
body > header nav .coverage { display: inline-block; height: 1.5rem; opacity: 0.8; transition: opacity 0.1s; }
body > header nav .coverage:hover { opacity: 1; }
body > header nav .coverage img { height: 100%; display: block; }
body > header nav .npm { display: inline-block; height: 1.2rem; opacity: 0.8; transition: opacity 0.1s; }
body > header nav .npm:hover { opacity: 1; }
body > header nav .npm img { height: 100%; display: block; }
body > header a { color: white; text-decoration: none; }
body > header a:hover { text-decoration: underline; }
.pad1 { overflow-x: auto; }
`

// the istanbul report only ships light styles, so pin the page to the light
// palette (the dark media query in ROOT_CSS would otherwise recolor the header)
const COVERAGE_CSS = `
:root { color-scheme: light; --body-bg: #333a3e; --line: #d1d9e0; }
body { background: #fff; }
body > .wrapper { max-width: 860px; margin: 0 auto; }
`

// the token palette, shared by every surface that shows code: the markdown pages
// (highlighted here by marked-highlight) and the tutorial's prose, editor and
// solution diff (highlighted in the browser by site/assets/hljs.js). Same class
// names on all of them, so one stylesheet dresses the lot
const HLJS_CSS = `
.hljs { color: var(--fg); }
.hljs-comment, .hljs-quote { color: var(--muted); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type, .hljs-tag, .hljs-name { color: #d6285f; }
.hljs-string, .hljs-attr, .hljs-regexp, .hljs-addition { color: #8f6100; }
.hljs-number, .hljs-symbol, .hljs-link, .hljs-bullet { color: #7c3aed; }
.hljs-title, .hljs-function, .hljs-title.function_ { color: #4f7d0f; }
.hljs-variable, .hljs-template-variable, .hljs-attribute { color: #b35900; }
.hljs-built_in, .hljs-class .hljs-title { color: #0b7285; }
.hljs-deletion { color: #d6285f; background: #ffeef0; }
.hljs-addition { color: #4f7d0f; background: #e6f4ea; }
.hljs-section, .hljs-meta { color: var(--muted); }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
@media (prefers-color-scheme: dark) {
  .hljs { color: #f8f8f2; }
  .hljs-comment, .hljs-quote { color: #727072; }
  .hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type, .hljs-tag, .hljs-name { color: #ff6188; }
  .hljs-string, .hljs-attr, .hljs-regexp, .hljs-addition { color: #ffd866; }
  .hljs-number, .hljs-symbol, .hljs-link, .hljs-bullet { color: #ab9df2; }
  .hljs-title, .hljs-function, .hljs-title.function_ { color: #a9dc76; }
  .hljs-variable, .hljs-template-variable, .hljs-attribute { color: #fc9867; }
  .hljs-built_in, .hljs-class .hljs-title { color: #78dce8; }
  .hljs-deletion { color: #ff6188; background: #2d2a2e; }
  .hljs-addition { color: #a9dc76; background: #2d2a2e; }
  .hljs-section, .hljs-meta { color: #727072; }
}
`

const PAGE_CSS = `
${ROOT_CSS}
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background: var(--body-bg); }
main { color: var(--fg); background: var(--bg); }
main :first-child { margin-top: 0; }
main :last-child { margin-bottom: 0; }
${HEADER_CSS}
main { max-width: 860px; margin: 0 auto; padding: 1.5rem; }
main a { color: var(--accent); }
h1, h2, h3 { line-height: 1.25; }
h1 { border-bottom: 1px solid var(--line); padding-bottom: 0.3em; }
h2 { border-bottom: 1px solid var(--line); padding-bottom: 0.3em; margin-top: 1.8em; }
code { font: 85%/1.45 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; background: var(--code-bg); padding: 0.2em 0.4em; border-radius: 6px; }
pre { background: var(--code-bg); padding: 1rem; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
${HLJS_CSS}
@media (prefers-color-scheme: dark) {
  pre, code { color: #f8f8f2; }
  pre { background: #2d2a2e; }
  code { background: #363437; }
}
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--line); padding: 0.4em 0.8em; }
img { max-width: 100%; }
blockquote { margin: 0; padding: 0 1em; color: var(--muted); border-left: 0.25em solid var(--line); }
footer { max-width: 860px; margin: 0 auto; padding: 1rem 1.5rem 2rem; color: white; border-top: 1px solid var(--line); font-size: 0.85rem; }
`

// the landing page links out to GitHub; nested pages link back to it instead
const homeLink = root =>
  root === "./"
    ? `<a href="${REPO_URL}" class="start github">
      <img src="${root}assets/github-light.svg" alt="GitHub" />
    </a>`
    : `<a href="${root}index.html" class="start">jq79</a>`

const siteHeader = root => `<header><nav>
  ${homeLink(root)}
  <a href="${root}tutorial/" class="tutorial">tutorial</a>
  <a href="${root}benchmark/" class="benchmark">benchmark</a>
  <a href="${root}coverage/" class="coverage">
    <img src="${root}assets/code-coverage.svg" alt="coverage" />
  </a>
  <a href="${NPM_URL}" class="npm">
    <img src="${root}assets/npm-logo.svg" alt="npm logo" />
  </a>
</nav></header>`

const siteIcons = root => `<link rel="icon" type="image/png" href="${root}assets/favicon-96x96.png" sizes="96x96" />
<link rel="icon" type="image/svg+xml" href="${root}assets/favicon.svg" />
<link rel="shortcut icon" href="${root}assets/favicon.ico" />
<link rel="apple-touch-icon" sizes="180x180" href="${root}assets/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-title" content="jq79" />
<!--<link rel="manifest" href="${root}assets/site.webmanifest" />-->`

const page = (title, body, root) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${siteIcons(root)}
<style>${PAGE_CSS}</style>
</head>
<body>
${siteHeader(root)}
<main>
${body}
</main>
<footer>jq79 v${pkg.version} · ISC license · generated from the repo's markdown</footer>
</body>
</html>
`

// rewrites relative links from the markdown sources to their site/GitHub
// homes: .md files become site pages, assets stay relative, and anything
// else (source files, workflows, ...) points at the GitHub repo.
//
// `srcDir` is where the markdown lives (what its links are relative *to*);
// `outDir` is where the rendered HTML is served from (what the rewritten links
// must be relative *from*). They differ for the tutorial, whose per-exercise
// READMEs all end up inside the single /tutorial/ page
const rewriteLinks = (html, srcDir, outDir = srcDir) =>
  html.replace(/(href|src)="([^"]+)"/g, (match, attr, url) => {
    if (/^(https?:|mailto:|data:|#)/.test(url)) return match
    const [path, hash = ""] = url.split(/(?=#)/)
    const repoPath = posix.normalize(posix.join(srcDir, path))
    const relativeTo = target => posix.relative(outDir, target) || "."
    if (repoPath.toLowerCase() === "readme.md") return `${attr}="${relativeTo("index.html")}${hash}"`
    if (repoPath.endsWith(".md")) return `${attr}="${relativeTo(repoPath.replace(/\.md$/, ".html"))}${hash}"`
    if (repoPath.startsWith("assets/")) return `${attr}="${relativeTo(repoPath)}"`
    return `${attr}="${REPO_URL}/blob/main/${repoPath}${hash}"`
  })

const renderPage = async (mdPath, outPath, root) => {
  const md = await readFile(mdPath, "utf8")
  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? "jq79"
  const body = rewriteLinks(await marked.parse(md), posix.dirname(mdPath))
  await mkdir(posix.dirname(posix.join(SITE, outPath)), { recursive: true })
  await writeFile(posix.join(SITE, outPath), page(title === "jq79" ? "jq79" : `${title} · jq79`, body, root))
}

// --- tutorial ----------------------------------------------------------------

// tutorial/<NN-section>/<NN-exercise>/ holds a README.md (the prose), the files
// the editor starts with, and a solution/ with the files the "solution" button
// swaps in. The whole thing is emitted as one JSON manifest that the tutorial
// page (itself a jq79 component) renders - so adding an exercise is adding a
// folder, no code change anywhere
const TUTORIAL = "tutorial"
const EDITABLE = /\.(html|js|css|json)$/
// the file the exercise is mounted from; the rest are its importable modules.
// Listed first, so it's the tab the editor opens on
const ENTRY = "app.html"

const titleFromSlug = slug =>
  slug.replace(/^\d+-/, "").replace(/-/g, " ").replace(/^./, char => char.toUpperCase())

const subdirs = async dir =>
  (await readdir(dir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("_"))
    .map(entry => entry.name)
    .sort()

// the editable files sitting directly in `dir` (missing dir → {}, for the
// exercises that have no solution/ of their own)
const sourceFiles = async dir => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = entries.filter(entry => entry.isFile() && EDITABLE.test(entry.name)).map(entry => entry.name)
  const ordered = files.sort((a, b) => (a === ENTRY ? -1 : b === ENTRY ? 1 : a.localeCompare(b)))
  return Object.fromEntries(
    await Promise.all(ordered.map(async name => [name, await readFile(posix.join(dir, name), "utf8")]))
  )
}

const buildTutorial = async () => {
  const sections = []
  let position = 0

  for (const sectionSlug of await subdirs(TUTORIAL)) {
    const sectionDir = posix.join(TUTORIAL, sectionSlug)
    const exercises = []

    for (const slug of await subdirs(sectionDir)) {
      const dir = posix.join(sectionDir, slug)
      const md = await readFile(posix.join(dir, "README.md"), "utf8")
      exercises.push({
        slug,
        path: `${sectionSlug}/${slug}`,
        // the flat position, so the table of contents can jump straight to it
        index: position++,
        title: md.match(/^#\s+(.+)$/m)?.[1] ?? titleFromSlug(slug),
        // rendered from the exercise dir, but displayed from /tutorial/
        html: rewriteLinks(await marked.parse(md), dir, TUTORIAL),
        files: await sourceFiles(dir),
        solution: await sourceFiles(posix.join(dir, "solution")),
      })
    }

    sections.push({ slug: sectionSlug, title: titleFromSlug(sectionSlug), exercises })
  }

  return sections
}

// highlight.js ships as CommonJS, so the copy the tutorial page loads has to be
// bundled. It only changes when the dependency does, so it's cached outside
// site/ (which is wiped on every build, watch loop included) and keyed by version
const HLJS_BUNDLE = "assets/hljs.js"

const bundleHljs = async () => {
  const version = JSON.parse(await readFile("node_modules/highlight.js/package.json", "utf8")).version
  const cached = `node_modules/.cache/jq79/hljs-${version}.js`

  if (!(await stat(cached).catch(() => null))) {
    const { build } = await import("vite")
    await build({
      configFile: false,
      logLevel: "warn",
      build: {
        lib: { entry: "scripts/hljs-browser.js", formats: ["es"], fileName: () => posix.basename(cached) },
        outDir: posix.dirname(cached),
        emptyOutDir: true,
        minify: true,
      },
    })
  }

  await cp(cached, posix.join(SITE, HLJS_BUNDLE))
}

// The shell the tutorial mounts into is a file, tutorial/_app/index.html, rather
// than a template literal here: it's a page, so it's written as one. What it
// shares with the pages this script generates - the palette, the header nav, the
// favicons, the path the bundled highlighter lands on - it leaves as `{{holes}}`
// for us to fill, and its leading comment (addressed to whoever edits it) is
// dropped on the way out
const SHELL = posix.join(TUTORIAL, "_app", "index.html")

const tutorialPage = async () => {
  const template = (await readFile(SHELL, "utf8")).replace(/^<!--[\s\S]*?-->\n/, "")
  const holes = {
    icons: siteIcons("../"),
    styles: `${ROOT_CSS}${HEADER_CSS}${HLJS_CSS}`,
    header: siteHeader("../"),
    hljs: HLJS_BUNDLE,
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (!(name in holes)) throw new Error(`${SHELL}: no such hole as ${match}`)
    return holes[name]
  })
}

// --- benchmark -----------------------------------------------------------

// results are pre-generated by `npm run benchmark` (frameworks/keyed/jq79 +
// scripts/run-benchmark.mjs), not measured at site-build time - the numbers
// are meant to be reproducible against a specific tagged release, not
// whatever this machine happens to be doing right now
const BENCHMARK_RESULTS = "frameworks/keyed/jq79/benchmark-results.json"
const BENCHMARK_DIR = "frameworks/keyed/jq79"

const fmtMs = ms => (ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`)

// horizontal bars, log-scaled: the operations span ~5ms (remove a row) to
// ~250ms (create 10,000 rows), and a linear scale would flatten everything
// but the biggest bars to invisible slivers
const benchmarkChart = operations => {
  const width = 780
  const barHeight = 26
  const gap = 10
  const labelWidth = 230
  const valueWidth = 70
  const chartWidth = width - labelWidth - valueWidth
  const height = operations.length * (barHeight + gap) + gap
  const maxLog = Math.log10(Math.max(...operations.map(op => op.median)) + 1)

  const rows = operations
    .map((op, i) => {
      const y = gap + i * (barHeight + gap)
      const w = Math.max((Math.log10(op.median + 1) / maxLog) * chartWidth, 2)
      return `<text x="${labelWidth - 10}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-size="13" fill="var(--fg)">${op.label}</text>
  <rect x="${labelWidth}" y="${y}" width="${w}" height="${barHeight}" rx="4" fill="var(--accent)"/>
  <text x="${labelWidth + w + 8}" y="${y + barHeight / 2 + 4}" font-size="13" fill="var(--fg)">${fmtMs(op.median)}</text>`
    })
    .join("\n  ")

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="jq79 benchmark: median time per operation, log-scaled">
  ${rows}
</svg>`
}

const benchmarkTable = operations => `<table>
<thead><tr><th>Operation</th><th>Median</th><th>Mean</th><th>Min</th><th>Max</th></tr></thead>
<tbody>
${operations
  .map(op => `<tr><td>${op.label}</td><td>${fmtMs(op.median)}</td><td>${fmtMs(op.mean)}</td><td>${fmtMs(op.min)}</td><td>${fmtMs(op.max)}</td></tr>`)
  .join("\n")}
</tbody>
</table>`

const buildBenchmarkPage = async () => {
  const raw = await readFile(BENCHMARK_RESULTS, "utf8").catch(() => null)
  if (!raw) {
    console.warn(`${BENCHMARK_RESULTS} not found - skipping /benchmark/ (run "npm run benchmark" first)`)
    return
  }
  const results = JSON.parse(raw)
  const date = results.generatedAt.slice(0, 10)

  const body = `<h1>Benchmark</h1>
<p>jq79's own numbers on the <a href="https://github.com/krausest/js-framework-benchmark">js-framework-benchmark</a> row table: create, replace, partial update, select, swap, remove and clear, at 1,000 and 10,000 rows. The implementation lives in <a href="${REPO_URL}/tree/main/${BENCHMARK_DIR}">${BENCHMARK_DIR}</a>.</p>

<p>Each number is the <strong>synchronous time inside the click</strong>: jq79 has no microtask or animation-frame batching, so a <code>set</code> on the store runs its effects - and patches the DOM - before the write that caused it returns, so there's nothing after the click worth waiting for. ${results.samples} runs per operation, each from a fresh page load; the fastest and slowest are dropped and the rest averaged for "mean", "median" is the middle sample.</p>

<p>This is <strong>not</strong> the official js-framework-benchmark harness (<code>webdriver-ts</code>) - no CPU throttling, no devtools tracing, no other frameworks measured alongside it. It exists to catch jq79's own regressions release over release. For React/Vue/Svelte/Preact/vanillajs numbers measured the same way, see <a href="comparison/">the framework comparison</a>.</p>

${benchmarkChart(results.operations)}

${benchmarkTable(results.operations)}

<p><small>jq79 v${results.jq79Version} · generated ${date} · ${results.cpu}</small></p>
`

  await mkdir(posix.join(SITE, "benchmark"), { recursive: true })
  await writeFile(posix.join(SITE, "benchmark/index.html"), page("Benchmark · jq79", body, "../"))
}

// --- benchmark comparison -----------------------------------------------------

// pre-generated by `npm run benchmark:comparison` (scripts/run-comparison.mjs),
// same reasoning as BENCHMARK_RESULTS above: reproducible against a tagged
// release, not whatever this machine happens to be doing right now
const COMPARISON_RESULTS = "frameworks/keyed/comparison-results.json"

// brand colors, so each framework reads as itself at a glance rather than an
// arbitrary categorical palette
const FRAMEWORK_COLOR = {
  jq79: "#0969da",
  vanillajs: "#6e7781",
  preact: "#673ab8",
  vue: "#42b883",
  svelte: "#ff3e00",
  react: "#087ea4",
}

// geometric mean of each framework's ratio-to-the-fastest across every
// operation: a single "1.0x is best-possible, lower is better" score, immune
// to the big operations (create 10k) swamping the small ones (select a row)
// the way a plain average of milliseconds would
const comparisonSummary = frameworks => {
  const opIds = frameworks[0].operations.map(op => op.id)
  const bestByOp = Object.fromEntries(
    opIds.map(id => [id, Math.min(...frameworks.map(f => f.operations.find(op => op.id === id).median))])
  )
  return frameworks
    .map(f => {
      const ratios = f.operations.map(op => op.median / bestByOp[op.id])
      const geoMean = Math.exp(ratios.reduce((sum, r) => sum + Math.log(r), 0) / ratios.length)
      return { id: f.id, label: f.label, version: f.version, geoMean }
    })
    .sort((a, b) => a.geoMean - b.geoMean)
}

const comparisonChart = summary => {
  const width = 780
  const barHeight = 30
  const gap = 12
  const labelWidth = 150
  const valueWidth = 130
  const chartWidth = width - labelWidth - valueWidth
  const height = summary.length * (barHeight + gap) + gap
  const maxRatio = Math.max(...summary.map(f => f.geoMean))

  const rows = summary
    .map((f, i) => {
      const y = gap + i * (barHeight + gap)
      const w = Math.max((f.geoMean / maxRatio) * chartWidth, 2)
      const color = FRAMEWORK_COLOR[f.id] ?? "var(--accent)"
      return `<text x="${labelWidth - 10}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-size="14" font-weight="600" fill="var(--fg)">${f.label}</text>
  <rect x="${labelWidth}" y="${y}" width="${w}" height="${barHeight}" rx="4" fill="${color}"/>
  <text x="${labelWidth + w + 8}" y="${y + barHeight / 2 + 4}" font-size="13" fill="var(--fg)">${f.geoMean.toFixed(2)}× ${f.version ? `(v${f.version})` : ""}</text>`
    })
    .join("\n  ")

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Overall slowdown factor versus the fastest framework per operation, lower is better">
  ${rows}
</svg>`
}

// green (fastest in the row) to red (slowest), as a translucent overlay so it
// reads correctly over both the light and dark page background
const heatColor = t => `hsl(${140 - 140 * t} 70% 50% / ${0.12 + 0.28 * t})`

const comparisonTable = frameworks => {
  const opMeta = frameworks[0].operations.map(op => ({ id: op.id, label: op.label }))
  const headerCells = frameworks.map(f => `<th>${f.label}</th>`).join("")

  const rows = opMeta
    .map(({ id, label }) => {
      const values = frameworks.map(f => f.operations.find(op => op.id === id).median)
      const min = Math.min(...values)
      const max = Math.max(...values)
      const cells = values
        .map(v => {
          const t = max > min ? (v - min) / (max - min) : 0
          return `<td style="background:${heatColor(t)}">${fmtMs(v)}</td>`
        })
        .join("")
      return `<tr><td>${label}</td>${cells}</tr>`
    })
    .join("\n")

  return `<table>
<thead><tr><th>Operation</th>${headerCells}</tr></thead>
<tbody>
${rows}
</tbody>
</table>`
}

const buildComparisonPage = async () => {
  const raw = await readFile(COMPARISON_RESULTS, "utf8").catch(() => null)
  if (!raw) {
    console.warn(`${COMPARISON_RESULTS} not found - skipping /benchmark/comparison/ (run "npm run benchmark:comparison" first)`)
    return
  }
  const results = JSON.parse(raw)
  const date = results.generatedAt.slice(0, 10)
  const summary = comparisonSummary(results.frameworks)

  const body = `<h1>Benchmark: framework comparison</h1>
<p>The same <a href="https://github.com/krausest/js-framework-benchmark">js-framework-benchmark</a> row table (see <a href="../">jq79's own numbers</a>), implemented once per framework in <a href="${REPO_URL}/tree/main/frameworks/keyed">frameworks/keyed/</a> and measured the same way, in the same run, on the same machine: <a href="${REPO_URL}/tree/main/frameworks/keyed/jq79">jq79</a>, <a href="${REPO_URL}/tree/main/frameworks/keyed/vanillajs">vanillajs</a> (no framework - the baseline), <a href="${REPO_URL}/tree/main/frameworks/keyed/preact">Preact</a>, <a href="${REPO_URL}/tree/main/frameworks/keyed/vue">Vue</a>, <a href="${REPO_URL}/tree/main/frameworks/keyed/svelte">Svelte</a> and <a href="${REPO_URL}/tree/main/frameworks/keyed/react">React</a>.</p>

<p>Each is idiomatic-but-minimal: hooks for Preact/React, a single-file component for Vue/Svelte/jq79, direct DOM for vanillajs - not tuned beyond what a reasonable implementation would do. ${results.samples} runs per operation per framework, each from a fresh page load; the fastest and slowest dropped, the rest averaged.</p>

<p>This is <strong>not</strong> the official js-framework-benchmark harness (<code>webdriver-ts</code>) - no CPU throttling, no devtools tracing, one machine measuring all six back to back rather than isolated runs. Treat it as directional, not authoritative; the <a href="https://krausest.github.io/js-framework-benchmark/current.html">official results table</a> is the one with the CI rigor behind it.</p>

<h2>Overall</h2>
<p>Geometric mean of each framework's ratio to the fastest framework on each operation - 1.00× would mean "won every single operation"; a plain average of milliseconds would let the two 10,000-row operations drown out the other seven. Lower is better.</p>

${comparisonChart(summary)}

<h2>Per operation</h2>
<p>Median time, colored green (fastest in that row) to red (slowest).</p>

<div class="pad1">
${comparisonTable(results.frameworks)}
</div>

<h2>Where the interpreter collects</h2>
<p><strong>Updating data in an existing list is what jq79 is fastest at, and it is
the same design as the row below.</strong> Sixteen updates of every 10th row in a
10,000-row table put it around a fifth of Vue's time and within about 1.7&times;
Svelte - against 3&times; Svelte on <code>create1k</code>. A write reaches the
effects that read the path it changed and nothing else, so an update costs what
the changed rows cost rather than what the list costs. There is no diff to run and
no component to re-invoke.</p>

<p>Four of these operations are a batch of 16 clicks timed as one measurement,
which is the shape the official benchmark writes <code>_x16</code>. A single click
on any of them lands under a few milliseconds, and a browser clock that ticks in
0.05ms steps cannot report that honestly.</p>

<h2>Where the distance is</h2>
<p>jq79 parses and mounts at runtime - no compiler, no virtual DOM - and this table
is where that costs something. The numbers behind it have different causes,
though, and only one of them is the design.</p>

<p><strong>Building elements is about 3&times; Svelte at a thousand rows and
4.6&times; at ten thousand, and that is the price of the design, not a defect in
it.</strong> A devtools trace of <code>create1k</code> charges 77% of the measured
window to JavaScript and finds no layout, no style recalculation and no HTML
parsing: jq79 simply executes several times more JavaScript to build the same
thousand rows. It is not one hot spot. Four rounds of
profiling found one - memoizing the component-name scan, worth about a third - and
nothing else above a few percent. The rest is the sum of what a runtime interpreter
does per element that compiled straight-line code does not do at all: classify
attributes, resolve names through a scope chain, allocate an effect and index its
dependencies, build closures. Closing it means deriving that work when the template
is parsed, or compiling the template to a closure tree once per component - a
different library on the inside, for the same public one.</p>

<p><strong>The list operations are a different story, and an open one.</strong>
Removing one row of a thousand re-runs 999 rows' bindings, because a dependency is
a path (<code>rows.4.label</code>) and a removal changes the path of every row
behind it. Swapping two rows runs the whole diff twice - once per write - because
jq79 patches the DOM synchronously instead of batching a handler's writes.
Selecting a row re-runs 1,000 class bindings, which Svelte does too; there the
distance is the cost of one binding - lower since 0.6.5, which resolves a template
expression's free identifiers through a declared prologue instead of
<code>with</code>, but still an evaluation against a store proxy where Svelte has a
compiled read. None of those three is the price of having no compiler.</p>

<p><small>generated ${date} · ${results.cpu}</small></p>
`

  await mkdir(posix.join(SITE, "benchmark/comparison"), { recursive: true })
  await writeFile(posix.join(SITE, "benchmark/comparison/index.html"), page("Benchmark comparison · jq79", body, "../../"))
}

// --- assemble ----------------------------------------------------------------

await rm(SITE, { recursive: true, force: true })
await mkdir(posix.join(SITE, "badges"), { recursive: true })

// the dist files at the site root, CDN-style, plus the readme's assets
await cp("dist", SITE, { recursive: true })
await cp("assets", posix.join(SITE, "assets"), { recursive: true })

// rendered markdown: README as the landing page, docs/ alongside
await renderPage("README.md", "index.html", "./")
for (const file of await readdir("docs")) {
  if (file.endsWith(".md")) await renderPage(`docs/${file}`, `docs/${file.replace(/\.md$/, ".html")}`, "../")
}

// tutorial: the exercise manifest, the app component itself, its shell, and the
// highlighter it colors the editor with
const tutorial = await buildTutorial()
await bundleHljs()
await mkdir(posix.join(SITE, TUTORIAL), { recursive: true })
await cp(posix.join(TUTORIAL, "_app"), posix.join(SITE, TUTORIAL), {
  recursive: true,
  // the shell is a template, not a page: it goes out filled in, below
  filter: source => !/[\\/]_app[\\/]index\.html$/.test(source),
})
await writeFile(posix.join(SITE, TUTORIAL, "tutorial.json"), JSON.stringify(tutorial))
await writeFile(posix.join(SITE, TUTORIAL, "index.html"), await tutorialPage())

// benchmark: pre-generated results.json rendered into a chart + table
await buildBenchmarkPage()
await buildComparisonPage()

// coverage report + badges
const summary = JSON.parse(await readFile("coverage/coverage-summary.json", "utf8"))
const pct = summary.total.lines.pct
await cp("coverage", posix.join(SITE, "coverage"), { recursive: true })
await rm(posix.join(SITE, "coverage/coverage-summary.json"), { force: true })

// the istanbul report is generated HTML, so the site header goes in as a
// post-process: our styles after base.css, the nav as the first thing in body
for (const file of await readdir(posix.join(SITE, "coverage"))) {
  if (!file.endsWith(".html")) continue
  const path = posix.join(SITE, "coverage", file)
  const html = await readFile(path, "utf8")
  await writeFile(
    path,
    html
      .replace("</head>", `<style>${ROOT_CSS}${HEADER_CSS}${COVERAGE_CSS}</style>\n</head>`)
      .replace(/<body([^>]*)>/, `<body$1>\n${siteHeader("../")}`)
  )
}
await writeFile(posix.join(SITE, "badges/npm.svg"), badge("npm", `v${pkg.version}`, "#cb3837"))
await writeFile(posix.join(SITE, "badges/coverage.svg"), badge("coverage", `${pct.toFixed(1)}%`, "#2e8b57"))

// size badges: esm (dist/jq79.js) and cdn (dist/jq79.global.js), normal + gzip
const fmtSize = bytes => {
  if (bytes < 1024) return `${bytes}b`
  return `${(bytes / 1024).toFixed(1)}kb`
}

// a 4-segment badge: label | size | zip | gzip — colors passed per-badge
const badge4 = (s1, s2, s3, s4, c1, c2, c3, c4) => {
  const width = text => Math.round(text.length * 6.5 + 12)
  const segs = [
    { text: s1, color: c1 },
    { text: s2, color: c2 },
    { text: s3, color: c3 },
    { text: s4, color: c4 },
  ]
  const widths = segs.map(s => width(s.text))
  const total = widths.reduce((a, b) => a + b, 0)
  let x = 0
  const rects = segs
    .map((s, i) => {
      const r = `<rect x="${x}" width="${widths[i]}" height="20" fill="${s.color}"/>`
      x += widths[i]
      return r
    })
    .join("\n    ")
  x = 0
  const texts = segs
    .map((s, i) => {
      const cx = x + widths[i] / 2
      x += widths[i]
      return `<text x="${cx}" y="14">${s.text}</text>`
    })
    .join("\n    ")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${s1}: ${s2} | ${s3} ${s4}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    ${rects}
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    ${texts}
  </g>
</svg>`
}

const sizeBadge = async (label, file, c2, c4) => {
  const raw = await stat(file)
  const buf = await readFile(file)
  const gz = await gzipSize(buf)
  await writeFile(
    posix.join(SITE, "badges", `${label}-size.svg`),
    badge4(label, fmtSize(raw.size), "zip", fmtSize(gz.length), "#555", c2, "#555", c4)
  )
}
await sizeBadge("esm", "dist/jq79.js", "goldenrod", "#778899")
// the global/IIFE build - what unpkg/jsdelivr serve - not the cjs one
await sizeBadge("cjs", "dist/jq79.global.js", "#6495ed", "#778899")

const exercises = tutorial.reduce((total, section) => total + section.exercises.length, 0)
console.log(
  `site/ built: v${pkg.version}, coverage ${pct.toFixed(1)}%, ${exercises} tutorial exercises`
)
