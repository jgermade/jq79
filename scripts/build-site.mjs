// Builds the GitHub Pages site into site/ from things the repo already has:
//
//   /                 index.html (landing/index.html, filled in) + the dist/
//                     files, so the Pages URL doubles as a CDN (https://.../jq79/jq79.js)
//   /tutorial/        the tutorial app and its exercise manifest
//   /benchmark/       the benchmark pages, from pre-generated results
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

// --- the theme ----------------------------------------------------------------

// One design system for every page the site serves: the landing, the docs, the
// benchmark pages, the tutorial (whose shell takes it as a hole) and the header
// injected into the coverage report. Colors are tokens on :root, light and dark
// both, taken from the logo: its blue, and the yellow of its "79"
const TOKENS_CSS = `
:root {
  color-scheme: light dark;
  --bg: #ffffff; --bg-soft: #f5f7fb; --surface: #ffffff; --fg: #0e1626; --muted: #5a6478; --line: #e2e7ef;
  --accent: #2f6fc0; --accent-strong: #1f5aa6; --accent-soft: rgb(49 120 198 / 0.1); --on-accent: #ffffff;
  --yellow: #f7df1e; --good: #1f8f5a;
  --code-bg: #0f1729; --code-fg: #e4e9f2; --code-line: #24304a; --inline-code-bg: #edf1f7;
  --header-bg: rgb(255 255 255 / 0.82);
  --shadow: 0 1px 2px rgb(14 22 38 / 0.06), 0 8px 24px rgb(14 22 38 / 0.08);
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
  --radius: 14px; --header-h: 3.5rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a0f1c; --bg-soft: #0e1526; --surface: #111a2d; --fg: #e6eaf2; --muted: #97a1b6; --line: #212b42;
    --accent: #6aa5f5; --accent-strong: #8fbcff; --accent-soft: rgb(106 165 245 / 0.12); --on-accent: #08101f;
    --good: #4cc38a;
    --code-bg: #0b1222; --code-fg: #e4e9f2; --code-line: #1e2940; --inline-code-bg: #18223a;
    --header-bg: rgb(10 15 28 / 0.78);
    --shadow: 0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.35);
  }
}
`

// shared by every page and the (istanbul-generated) coverage report, so the
// font is set on the header itself rather than inherited. Every selector is
// anchored at `body > header` - the page's own chrome, always the first child of
// <body>. A bare `header` would reach into whatever the page mounts below it:
// the tutorial's tab bar is a <header> too
const HEADER_CSS = `
body > header { position: sticky; top: 0; z-index: 50; background: var(--header-bg); backdrop-filter: saturate(1.6) blur(12px); -webkit-backdrop-filter: saturate(1.6) blur(12px); border-bottom: 1px solid var(--line); font: 500 15px/1.4 var(--font); }
body > header nav { max-width: 1200px; margin: 0 auto; padding: 0 1rem; height: calc(var(--header-h) - 1px); display: flex; align-items: center; gap: 0.25rem; }
body > header a { color: var(--muted); text-decoration: none; padding: 0.45rem 0.6rem; border-radius: 8px; white-space: nowrap; }
body > header a:hover { color: var(--fg); background: var(--accent-soft); }
body > header a[aria-current] { color: var(--fg); }
body > header .brand { display: flex; align-items: center; gap: 0.5rem; margin-right: auto; padding-left: 0; color: var(--fg); font-weight: 800; font-size: 1.1rem; letter-spacing: -0.02em; }
body > header .brand:hover { background: none; }
body > header .brand img { width: 28px; height: 28px; border-radius: 7px; display: block; }
body > header .github { display: flex; padding: 0.4rem; }
body > header .github svg { width: 20px; height: 20px; fill: currentColor; display: block; }
@media (max-width: 30rem) { body > header .optional { display: none; } body > header nav { gap: 0; padding: 0 0.6rem; } }
`

// the token palette, shared by every surface that shows code: the markdown pages
// and the landing (highlighted here at build time), and the tutorial's prose,
// editor and solution diff (highlighted in the browser by site/assets/hljs.js).
// Code always sits on the dark --code-bg, so one palette serves both themes
const HLJS_CSS = `
.hljs { color: var(--code-fg); }
.hljs-comment, .hljs-quote { color: #7d8aa5; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type, .hljs-tag, .hljs-name { color: #ff7a9c; }
.hljs-string, .hljs-attr, .hljs-regexp { color: #ffd866; }
.hljs-number, .hljs-symbol, .hljs-link, .hljs-bullet { color: #b9a6ff; }
.hljs-title, .hljs-function, .hljs-title.function_ { color: #a9dc76; }
.hljs-variable, .hljs-template-variable, .hljs-attribute { color: #fc9867; }
.hljs-built_in, .hljs-class .hljs-title { color: #78dce8; }
.hljs-deletion { color: #ff7a9c; }
.hljs-addition { color: #a9dc76; }
.hljs-section, .hljs-meta { color: #7d8aa5; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
`

// the base every generated page stands on: reset, type, buttons, code blocks,
// tables and the footer
const BASE_CSS = `
${TOKENS_CSS}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-padding-top: calc(var(--header-h) + 1rem); }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.65 var(--font); -webkit-font-smoothing: antialiased; }
${HEADER_CSS}
a { color: var(--accent); text-underline-offset: 0.18em; }
img, svg { max-width: 100%; }
code, pre { font-family: var(--mono); }
:not(pre) > code { font-size: 0.86em; background: var(--inline-code-bg); padding: 0.15em 0.4em; border-radius: 6px; overflow-wrap: anywhere; }
pre { margin: 1.2em 0; padding: 1rem 1.1rem; background: var(--code-bg); color: var(--code-fg); border: 1px solid var(--code-line); border-radius: var(--radius); overflow-x: auto; font-size: 13.5px; line-height: 1.6; -webkit-overflow-scrolling: touch; }
pre code { background: none; padding: 0; font-size: inherit; }
${HLJS_CSS}
.btn { display: inline-flex; align-items: center; gap: 0.5em; padding: 0.7em 1.15em; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); font: 600 15px/1 var(--font); text-decoration: none; cursor: pointer; transition: transform 0.15s, background 0.15s, border-color 0.15s; }
.btn:hover { border-color: var(--accent); transform: translateY(-1px); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn.primary:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
.table-wrap { overflow-x: auto; margin: 1.2em 0; border: 1px solid var(--line); border-radius: var(--radius); -webkit-overflow-scrolling: touch; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
th, td { padding: 0.55em 0.85em; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
th { background: var(--bg-soft); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
body > footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 0.875rem; }
body > footer .inner { max-width: 1200px; margin: 0 auto; padding: 2rem 1rem 2.5rem; display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; align-items: center; }
body > footer .inner > :first-child { margin-right: auto; }
body > footer a { color: var(--muted); }
body > footer a:hover { color: var(--fg); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } html { scroll-behavior: auto; } }
`

// a rendered markdown page: the docs, with their own sidebar, and the benchmark
// pages, which use the same reading column without it
const PROSE_CSS = `
.page { max-width: 1200px; margin: 0 auto; padding: 1.5rem 1rem 3rem; display: grid; gap: 2rem; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 64rem) { .page.with-nav { grid-template-columns: 14rem minmax(0, 1fr); gap: 3rem; padding-top: 2.5rem; } }
.doc-nav { font-size: 0.92rem; }
.doc-nav h2 { margin: 0 0 0.5rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.doc-nav ol { list-style: none; margin: 0; padding: 0; display: flex; gap: 0.4rem; overflow-x: auto; padding-bottom: 0.25rem; }
.doc-nav a { display: block; padding: 0.35rem 0.75rem; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); text-decoration: none; white-space: nowrap; }
.doc-nav a:hover { color: var(--fg); border-color: var(--accent); }
.doc-nav a[aria-current] { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
@media (min-width: 64rem) {
  .doc-nav > div { position: sticky; top: calc(var(--header-h) + 2rem); }
  .doc-nav ol { flex-direction: column; gap: 0.1rem; overflow: visible; }
  .doc-nav a { border: 0; border-radius: 8px; white-space: normal; }
  .doc-nav a[aria-current] { color: var(--accent); background: var(--accent-soft); font-weight: 600; }
}
.prose { min-width: 0; max-width: 46rem; }
.prose > :first-child { margin-top: 0; }
.prose h1, .prose h2, .prose h3 { line-height: 1.2; letter-spacing: -0.02em; }
.prose h1 { font-size: clamp(2rem, 6vw, 2.75rem); font-weight: 800; margin-bottom: 0.6em; }
.prose h2 { font-size: 1.5rem; margin-top: 2.2em; padding-top: 1.2em; border-top: 1px solid var(--line); }
.prose h3 { font-size: 1.15rem; margin-top: 1.8em; }
.prose blockquote { margin: 1.4em 0; padding: 0.9em 1.1em; border-left: 3px solid var(--accent); background: var(--accent-soft); border-radius: 0 var(--radius) var(--radius) 0; color: var(--fg); }
.prose blockquote > :first-child { margin-top: 0; } .prose blockquote > :last-child { margin-bottom: 0; }
.prose li + li { margin-top: 0.3em; }
.prose table { font-size: 0.9rem; }
.prose small { color: var(--muted); }
`

// the istanbul report only ships light styles, so pin the header to the light
// palette (the dark media query in TOKENS_CSS would otherwise recolor it)
const COVERAGE_CSS = `
:root { color-scheme: light; --bg: #fff; --fg: #0e1626; --muted: #5a6478; --line: #e2e7ef; --accent-soft: rgb(49 120 198 / 0.1); --header-bg: rgb(255 255 255 / 0.9); }
body { background: #fff; }
body > .wrapper { max-width: 960px; margin: 0 auto; }
.pad1 { overflow-x: auto; }
`

const GITHUB_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`

// `current` marks the section the page belongs to
const siteHeader = (root, current = "") => {
  const link = (href, label, id, extra = "") =>
    `<a href="${href}"${extra}${current === id ? ' aria-current="page"' : ""}>${label}</a>`
  return `<header><nav>
  <a href="${root}index.html" class="brand"><img src="${root}assets/favicon.svg" alt="" width="28" height="28" />jq79</a>
  ${link(`${root}index.html#guide`, "Guide", "guide", ' class="optional"')}
  ${link(`${root}tutorial/`, "Tutorial", "tutorial")}
  ${link(`${root}docs/components.html`, "Docs", "docs")}
  ${link(`${root}benchmark/`, "Benchmark", "benchmark")}
  <a href="${REPO_URL}" class="github" aria-label="jq79 on GitHub">${GITHUB_ICON}</a>
</nav></header>`
}

const siteFooter = root => `<footer><div class="inner">
  <span>jq79 v${pkg.version} · ISC license</span>
  <a href="${NPM_URL}">npm</a>
  <a href="${REPO_URL}">GitHub</a>
  <a href="${root}coverage/">Test coverage</a>
  <a href="${REPO_URL}/releases">Releases</a>
</div></footer>`

const siteIcons = root => `<link rel="icon" type="image/png" href="${root}assets/favicon-96x96.png" sizes="96x96" />
<link rel="icon" type="image/svg+xml" href="${root}assets/favicon.svg" />
<link rel="shortcut icon" href="${root}assets/favicon.ico" />
<link rel="apple-touch-icon" sizes="180x180" href="${root}assets/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-title" content="jq79" />
<meta name="theme-color" content="#3178c6" />`

// the docs, in the order someone building an app reaches for them
const DOCS = [
  ["components", "Components"],
  ["template-syntax", "Template syntax"],
  ["setup-scripts", "Setup scripts"],
  ["reactive-data", "Reactive data"],
  ["dom-helpers", "DOM helpers"],
  ["dev-server", "Dev server"],
  ["vite-plugin", "Vite plugin"],
  ["csp", "Content Security Policy"],
  ["development", "Contributing"],
]

const docNav = (root, active) => `<nav class="doc-nav" aria-label="Documentation"><div>
  <h2>Documentation</h2>
  <ol>${DOCS.map(([slug, label]) =>
    `<li><a href="${root}docs/${slug}.html"${slug === active ? ' aria-current="page"' : ""}>${label}</a></li>`).join("")}</ol>
</div></nav>`

// `section` is the header link to mark; `docSlug` puts the docs sidebar beside
// the article
const page = (title, body, root, { section = "", docSlug, description = "" } = {}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${description ? `<meta name="description" content="${description}">\n` : ""}${siteIcons(root)}
<style>${BASE_CSS}${PROSE_CSS}</style>
</head>
<body>
${siteHeader(root, section)}
<main class="page${docSlug ? " with-nav" : ""}">
${docSlug ? docNav(root, docSlug) : ""}
<article class="prose">
${body}
</article>
</main>
${siteFooter(root)}
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

// a wide table scrolls inside its own box instead of pushing the page sideways
const wrapTables = html =>
  html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>")

const renderPage = async (mdPath, outPath, root, docSlug) => {
  const md = await readFile(mdPath, "utf8")
  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? "jq79"
  const body = wrapTables(rewriteLinks(await marked.parse(md), posix.dirname(mdPath)))
  await mkdir(posix.dirname(posix.join(SITE, outPath)), { recursive: true })
  await writeFile(posix.join(SITE, outPath), page(`${title} · jq79`, body, root, { section: "docs", docSlug }))
}

// --- hand-written pages ---------------------------------------------------------

// The landing and the tutorial's shell are pages, so they are written as files
// rather than template literals here. What they share with the generated pages
// (the theme, the header, the favicons, ...) they leave as `{{holes}}` for us to
// fill, and their leading comment (addressed to whoever edits them) is dropped.
//
// A code sample is written raw, as <x-code lang="html" title="app.html">…</x-code>,
// and comes out highlighted. Samples are set aside before the holes are filled,
// so a `{{name}}` inside one is the template syntax it shows, not a hole
const escapeHtml = text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const codeSample = (lang, title, code) => {
  const language = hljs.getLanguage(lang) ? lang : "plaintext"
  // a sample can name the version being released without going stale
  const html = hljs.highlight(code.replace(/%VERSION%/g, pkg.version), { language }).value
  return `<figure class="code">${title ? `<figcaption>${escapeHtml(title)}</figcaption>` : ""}<pre><code class="hljs">${html}</code></pre></figure>`
}

// drops the indentation the sample shares with the markup around it
const dedent = text => {
  const lines = text.replace(/^\n+|\s+$/g, "").split("\n")
  const indent = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^ */)[0].length))
  return lines.map(line => line.slice(indent)).join("\n")
}

const fillTemplate = (file, template, holes) => {
  const samples = []
  const withoutSamples = template
    .replace(/^<!--[\s\S]*?-->\n/, "")
    .replace(/<x-code lang="(\w+)"(?: title="([^"]*)")?>([\s\S]*?)<\/x-code>/g, (match, lang, title, code) => {
      samples.push(codeSample(lang, title, dedent(code)))
      return `\0${samples.length - 1}\0`
    })
  return withoutSamples
    .replace(/\{\{(\w+)\}\}/g, (match, name) => {
      if (!(name in holes)) throw new Error(`${file}: no such hole as ${match}`)
      return holes[name]
    })
    .replace(/\0(\d+)\0/g, (match, index) => samples[index])
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

// the shell the tutorial mounts into (see "hand-written pages" above)
const SHELL = posix.join(TUTORIAL, "_app", "index.html")

const tutorialPage = async () =>
  fillTemplate(SHELL, await readFile(SHELL, "utf8"), {
    icons: siteIcons("../"),
    styles: BASE_CSS,
    header: siteHeader("../", "tutorial"),
    hljs: HLJS_BUNDLE,
  })

// --- benchmark -----------------------------------------------------------

// results are pre-generated by `npm run benchmark` (frameworks/keyed/jq79 +
// scripts/run-benchmark.mjs), not measured at site-build time - the numbers
// are meant to be reproducible against a specific tagged release, not
// whatever this machine happens to be doing right now
const BENCHMARK_RESULTS = "frameworks/keyed/jq79/benchmark-results.json"
const BENCHMARK_DIR = "frameworks/keyed/jq79"

const fmtMs = ms => (ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`)

// the benchmark pages' own styles, on top of the prose column: stat cards and
// horizontal bars drawn in HTML rather than a fixed-width SVG, so a label never
// shrinks to illegible on a phone - the bar takes the width that's left
const BENCH_CSS = `
.prose { max-width: 60rem; }
.bench-lead { font-size: 1.1rem; color: var(--muted); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.75rem; margin: 1.5rem 0; }
.stat { padding: 0.9rem 1rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg-soft); }
.stat b { display: block; font-size: 1.35rem; letter-spacing: -0.02em; }
.stat span { color: var(--muted); font-size: 0.85rem; }
.bars { list-style: none; margin: 1.5rem 0; padding: 0; display: grid; gap: 0.8rem; }
.bars li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.3rem 0.75rem; align-items: center; }
.bars .label { font-size: 0.92rem; }
.bars .value { font: 600 0.85rem var(--mono); color: var(--muted); text-align: right; }
.bars .track { display: block; grid-column: 1 / -1; height: 0.7rem; border-radius: 999px; background: var(--bg-soft); border: 1px solid var(--line); overflow: hidden; }
.bars .fill { display: block; height: 100%; border-radius: 999px; background: var(--accent); }
.bars li.own .label { font-weight: 700; }
@media (min-width: 40rem) {
  .bars li { grid-template-columns: 13rem minmax(0, 1fr) 6.5rem; }
  .bars .track { grid-row: 1; grid-column: 2; }
  .bars .value { grid-column: 3; grid-row: 1; }
}
.bench-tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0 0 1.5rem; }
.bench-tabs a { padding: 0.35rem 0.85rem; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); text-decoration: none; font-size: 0.9rem; }
.bench-tabs a[aria-current] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.prose td.num, .prose th.num { text-align: right; font-family: var(--mono); font-size: 0.85rem; }
`

// one bar per row; `scale` maps a value to 0..1 of the track
const bars = (rows, scale) => `<ul class="bars">
${rows
  .map(row => `<li${row.own ? ' class="own"' : ""}><span class="label">${row.label}</span><span class="track"><span class="fill" style="width:${(Math.max(scale(row.value), 0.01) * 100).toFixed(1)}%${row.color ? `;background:${row.color}` : ""}"></span></span><span class="value">${row.text}</span></li>`)
  .join("\n")}
</ul>`

// log-scaled: the operations span ~5ms (remove a row) to ~250ms (create 10,000
// rows), and a linear scale would flatten all but the biggest to slivers
const benchmarkChart = operations => {
  const maxLog = Math.log10(Math.max(...operations.map(op => op.median)) + 1)
  return bars(
    operations.map(op => ({ label: op.label, value: op.median, text: fmtMs(op.median) })),
    value => Math.log10(value + 1) / maxLog
  )
}

const benchmarkTable = operations => `<div class="table-wrap"><table>
<thead><tr><th>Operation</th><th class="num">Median</th><th class="num">Mean</th><th class="num">Min</th><th class="num">Max</th></tr></thead>
<tbody>
${operations
  .map(op => `<tr><td>${op.label}</td><td class="num">${fmtMs(op.median)}</td><td class="num">${fmtMs(op.mean)}</td><td class="num">${fmtMs(op.min)}</td><td class="num">${fmtMs(op.max)}</td></tr>`)
  .join("\n")}
</tbody>
</table></div>`

const benchTabs = (root, active) => `<nav class="bench-tabs" aria-label="Benchmark pages">
  <a href="${root}benchmark/"${active === "own" ? ' aria-current="page"' : ""}>jq79 release over release</a>
  <a href="${root}benchmark/comparison/"${active === "comparison" ? ' aria-current="page"' : ""}>Framework comparison</a>
</nav>`

const benchPage = (title, body, root) =>
  page(title, body, root, { section: "benchmark" }).replace("</style>", `${BENCH_CSS}</style>`)

const buildBenchmarkPage = async () => {
  const raw = await readFile(BENCHMARK_RESULTS, "utf8").catch(() => null)
  if (!raw) {
    console.warn(`${BENCHMARK_RESULTS} not found - skipping /benchmark/ (run "npm run benchmark" first)`)
    return
  }
  const results = JSON.parse(raw)
  const date = results.generatedAt.slice(0, 10)

  const body = `<h1>Benchmark</h1>
${benchTabs("../", "own")}
<p class="bench-lead">jq79's own numbers on the <a href="https://github.com/krausest/js-framework-benchmark">js-framework-benchmark</a> row table: create, replace, partial update, select, swap, remove and clear, at 1,000 and 10,000 rows.</p>

<div class="stats">
  <div class="stat"><b>v${results.jq79Version}</b><span>release measured</span></div>
  <div class="stat"><b>${results.samples}</b><span>runs per operation</span></div>
  <div class="stat"><b>${date}</b><span>generated</span></div>
</div>

<h2>Median time per operation</h2>
<p>Log-scaled, so the small operations stay visible next to the 10,000-row ones.</p>
${benchmarkChart(results.operations)}

${benchmarkTable(results.operations)}

<h2>How it's measured</h2>
<p>Each number is the <strong>synchronous time inside the click</strong>: jq79 has no microtask or animation-frame batching, so a <code>set</code> on the store runs its effects - and patches the DOM - before the write that caused it returns, so there's nothing after the click worth waiting for. ${results.samples} runs per operation, each from a fresh page load; the fastest and slowest are dropped and the rest averaged for "mean", "median" is the middle sample. The implementation lives in <a href="${REPO_URL}/tree/main/${BENCHMARK_DIR}">${BENCHMARK_DIR}</a>.</p>

<p>This is <strong>not</strong> the official js-framework-benchmark harness (<code>webdriver-ts</code>) - no CPU throttling, no devtools tracing, no other frameworks measured alongside it. It exists to catch jq79's own regressions release over release. For React/Vue/Svelte/Preact/vanillajs numbers measured the same way, see <a href="comparison/">the framework comparison</a>.</p>

<p><small>jq79 v${results.jq79Version} · generated ${date} · ${results.cpu}</small></p>
`

  await mkdir(posix.join(SITE, "benchmark"), { recursive: true })
  await writeFile(posix.join(SITE, "benchmark/index.html"), benchPage("Benchmark · jq79", body, "../"))
}

// --- benchmark comparison -----------------------------------------------------

// pre-generated by `npm run benchmark:comparison` (scripts/run-comparison.mjs),
// same reasoning as BENCHMARK_RESULTS above: reproducible against a tagged
// release, not whatever this machine happens to be doing right now
const COMPARISON_RESULTS = "frameworks/keyed/comparison-results.json"

// brand colors, so each framework reads as itself at a glance rather than an
// arbitrary categorical palette
const FRAMEWORK_COLOR = {
  jq79: "#3178c6",
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
  const max = Math.max(...summary.map(f => f.geoMean))
  return bars(
    summary.map(f => ({
      label: `${f.label}${f.version ? ` <small>v${f.version}</small>` : ""}`,
      value: f.geoMean,
      text: `${f.geoMean.toFixed(2)}×`,
      color: FRAMEWORK_COLOR[f.id],
      own: f.id === "jq79",
    })),
    value => value / max
  )
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
          return `<td class="num" style="background:${heatColor(t)}">${fmtMs(v)}</td>`
        })
        .join("")
      return `<tr><td>${label}</td>${cells}</tr>`
    })
    .join("\n")

  return `<div class="table-wrap"><table>
<thead><tr><th>Operation</th>${headerCells}</tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`
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

  const body = `<h1>Framework comparison</h1>
${benchTabs("../../", "comparison")}
<p class="bench-lead">The same <a href="https://github.com/krausest/js-framework-benchmark">js-framework-benchmark</a> row table (see <a href="../">jq79's own numbers</a>), implemented once per framework in <a href="${REPO_URL}/tree/main/frameworks/keyed">frameworks/keyed/</a> and measured the same way, in the same run, on the same machine: <a href="${REPO_URL}/tree/main/frameworks/keyed/jq79">jq79</a>, <a href="${REPO_URL}/tree/main/frameworks/keyed/vanillajs">vanillajs</a> (no framework - the baseline), <a href="${REPO_URL}/tree/main/frameworks/keyed/preact">Preact</a>, <a href="${REPO_URL}/tree/main/frameworks/keyed/vue">Vue</a>, <a href="${REPO_URL}/tree/main/frameworks/keyed/svelte">Svelte</a> and <a href="${REPO_URL}/tree/main/frameworks/keyed/react">React</a>.</p>

<p>Each is idiomatic-but-minimal: hooks for Preact/React, a single-file component for Vue/Svelte/jq79, direct DOM for vanillajs - not tuned beyond what a reasonable implementation would do. ${results.samples} runs per operation per framework, each from a fresh page load; the fastest and slowest dropped, the rest averaged.</p>

<p>This is <strong>not</strong> the official js-framework-benchmark harness (<code>webdriver-ts</code>) - no CPU throttling, no devtools tracing, one machine measuring all six back to back rather than isolated runs. Treat it as directional, not authoritative; the <a href="https://krausest.github.io/js-framework-benchmark/current.html">official results table</a> is the one with the CI rigor behind it.</p>

<h2>Overall</h2>
<p>Geometric mean of each framework's ratio to the fastest framework on each operation - 1.00× would mean "won every single operation"; a plain average of milliseconds would let the two 10,000-row operations drown out the other seven. Lower is better.</p>

${comparisonChart(summary)}

<h2>Per operation</h2>
<p>Median time, colored green (fastest in that row) to red (slowest).</p>

${comparisonTable(results.frameworks)}

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
  await writeFile(posix.join(SITE, "benchmark/comparison/index.html"), benchPage("Framework comparison · jq79", body, "../../"))
}

// --- landing -------------------------------------------------------------------

// landing/index.html, independent of the README; landing/counter.html is the
// hero's live demo, served from /examples/ and shown highlighted beside it
const LANDING = "landing"

const fmtSize = bytes => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`)

const buildLanding = async ({ tutorial, coveragePct }) => {
  const demo = await readFile(posix.join(LANDING, "counter.html"), "utf8")
  const gzipped = (await gzipSize(await readFile("dist/jq79.js"))).length
  const lessons = tutorial.reduce((total, section) => total + section.exercises.length, 0)
  const chapters = tutorial
    .map(section => `<li><div><b>${section.title}</b><br><span>${section.exercises.map(exercise => exercise.title).join(" · ")}</span></div></li>`)
    .join("\n      ")

  const file = posix.join(LANDING, "index.html")
  const html = fillTemplate(file, await readFile(file, "utf8"), {
    icons: siteIcons("./"),
    styles: BASE_CSS,
    header: siteHeader("./"),
    footer: siteFooter("./"),
    version: pkg.version,
    gzip: fmtSize(gzipped),
    coverage: `${coveragePct.toFixed(0)}%`,
    lessons: String(lessons),
    chapters,
    demoCode: codeSample("html", "", demo),
  })
  await writeFile(posix.join(SITE, "index.html"), html)
  await mkdir(posix.join(SITE, "examples"), { recursive: true })
  await writeFile(posix.join(SITE, "examples", "counter.html"), demo)
}

// --- assemble ----------------------------------------------------------------

await rm(SITE, { recursive: true, force: true })
await mkdir(posix.join(SITE, "badges"), { recursive: true })

// the dist files at the site root, CDN-style, plus the readme's assets
await cp("dist", SITE, { recursive: true })
await cp("assets", posix.join(SITE, "assets"), { recursive: true })

// rendered markdown: the docs
for (const file of await readdir("docs")) {
  if (file.endsWith(".md")) {
    const slug = file.replace(/\.md$/, "")
    await renderPage(`docs/${file}`, `docs/${slug}.html`, "../", slug)
  }
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

// the landing, which quotes the numbers above
await buildLanding({ tutorial, coveragePct: pct })
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
      .replace("</head>", `<style>${TOKENS_CSS}${HEADER_CSS}${COVERAGE_CSS}</style>\n</head>`)
      .replace(/<body([^>]*)>/, `<body$1>\n${siteHeader("../")}`)
  )
}
await writeFile(posix.join(SITE, "badges/npm.svg"), badge("npm", `v${pkg.version}`, "#cb3837"))
await writeFile(posix.join(SITE, "badges/coverage.svg"), badge("coverage", `${pct.toFixed(1)}%`, "#2e8b57"))

// size badges: esm (dist/jq79.js) and cdn (dist/jq79.global.js), normal + gzip
const fmtBadgeSize = bytes => (bytes < 1024 ? `${bytes}b` : `${(bytes / 1024).toFixed(1)}kb`)

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
    badge4(label, fmtBadgeSize(raw.size), "zip", fmtBadgeSize(gz.length), "#555", c2, "#555", c4)
  )
}
await sizeBadge("esm", "dist/jq79.js", "goldenrod", "#778899")
// the global/IIFE build - what unpkg/jsdelivr serve - not the cjs one
await sizeBadge("cjs", "dist/jq79.global.js", "#6495ed", "#778899")

const exercises = tutorial.reduce((total, section) => total + section.exercises.length, 0)
console.log(
  `site/ built: v${pkg.version}, coverage ${pct.toFixed(1)}%, ${exercises} tutorial exercises`
)
