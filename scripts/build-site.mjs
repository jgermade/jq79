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

const PAGE_CSS = `
:root { color-scheme: light dark; --fg: #1f2328; --body-bg: #333a3e; --bg: #fff; --muted: #59636e; --line: #d1d9e0; --accent: #0969da; --code-bg: #ecf1f5; }
@media (prefers-color-scheme: dark) { :root { --fg: #f0f6fc; --body-bg: #222; --bg: #333a3e; --muted: #9198a1; --line: #3d444d; --accent: #4493f8; --code-bg: #2d2a2e; } }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background: var(--body-bg); }
main { color: var(--fg); background: var(--bg); }
main :first-child { margin-top: 0; }
main :last-child { margin-bottom: 0; }
header nav { max-width: 860px; margin: 0 auto; padding: 0.7rem 1.5rem; display: flex; gap: 1.2rem; align-items: center; flex-wrap: wrap; }
header nav .start { margin-right: auto; font-weight: bold; font-size: 1.2rem; }
header nav .github { display: inline-block; height: 1.5rem; opacity: 0.8; transition: opacity 0.1s; }
header nav .github:hover { opacity: 1; }
header nav .github img { height: 100%; display: block; }
header nav .coverage { display: inline-block; height: 1.5rem; opacity: 0.8; transition: opacity 0.1s; }
header nav .coverage:hover { opacity: 1; }
header nav .coverage img { height: 100%; display: block; }
header nav .npm { display: inline-block; height: 1.2rem; opacity: 0.8; transition: opacity 0.1s; }
header nav .npm:hover { opacity: 1; }
header nav .npm img { height: 100%; display: block; }
header a { color: white; text-decoration: none; }
header a:hover { text-decoration: underline; }
main { max-width: 860px; margin: 0 auto; padding: 1.5rem; }
main a { color: var(--accent); }
h1, h2, h3 { line-height: 1.25; }
h1 { border-bottom: 1px solid var(--line); padding-bottom: 0.3em; }
h2 { border-bottom: 1px solid var(--line); padding-bottom: 0.3em; margin-top: 1.8em; }
code { font: 85%/1.45 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; background: var(--code-bg); padding: 0.2em 0.4em; border-radius: 6px; }
pre { background: var(--code-bg); padding: 1rem; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
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
  pre, code { color: #f8f8f2; }
  pre { background: #2d2a2e; }
  code { background: #363437; }
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

const page = (title, body, root) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" type="image/png" href="${root}assets/favicon-96x96.png" sizes="96x96" />
<link rel="icon" type="image/svg+xml" href="${root}assets/favicon.svg" />
<link rel="shortcut icon" href="${root}assets/favicon.ico" />
<link rel="apple-touch-icon" sizes="180x180" href="${root}assets/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-title" content="jq79" />
<!--<link rel="manifest" href="${root}assets/site.webmanifest" />-->
<style>${PAGE_CSS}</style>
</head>
<body>
<header><nav>
  ${homeLink(root)}
  <a href="${root}coverage/" class="coverage">
    <img src="${root}assets/code-coverage.svg" alt="coverage" />
  </a>
  <a href="${NPM_URL}" class="npm">
    <img src="${root}assets/npm-logo.svg" alt="npm logo" />
  </a>
</nav></header>
<main>
${body}
</main>
<footer>jq79 v${pkg.version} · ISC license · generated from the repo's markdown</footer>
</body>
</html>
`

// rewrites relative links from the markdown sources to their site/GitHub
// homes: .md files become site pages, assets stay relative, and anything
// else (source files, workflows, ...) points at the GitHub repo
const rewriteLinks = (html, srcDir) =>
  html.replace(/(href|src)="([^"]+)"/g, (match, attr, url) => {
    if (/^(https?:|mailto:|data:|#)/.test(url)) return match
    const [path, hash = ""] = url.split(/(?=#)/)
    const repoPath = posix.normalize(posix.join(srcDir, path))
    const relativeTo = target => posix.relative(srcDir, target) || "."
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

// coverage report + badges
const summary = JSON.parse(await readFile("coverage/coverage-summary.json", "utf8"))
const pct = summary.total.lines.pct
await cp("coverage", posix.join(SITE, "coverage"), { recursive: true })
await rm(posix.join(SITE, "coverage/coverage-summary.json"), { force: true })
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
await sizeBadge("cjs", "dist/jq79.global.js", "#6495ed", "#778899")

console.log(`site/ built: v${pkg.version}, coverage ${pct.toFixed(1)}%`)
