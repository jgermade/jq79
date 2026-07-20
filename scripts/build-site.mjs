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
.pad1 { overflow-x: auto; }
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
