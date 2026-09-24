// Does Component79.safeEval({ nonce: true }) hold under a real CSP?
//
// jsdom enforces no CSP, and runs an inserted <script> in a realm of its own,
// so tests/safeEval.test.ts can show where a function is built and with what
// nonce - not that a browser would run it. This does, in Chromium: the
// published dist/jq79.js, served over HTTP with a
// `Content-Security-Policy: script-src 'nonce-…'` header and no 'unsafe-eval',
// a fresh nonce per response the way a server issues one, and a component
// fetched as a plain .html file (RECORD/2026-09-23.no-unsafe-eval.md).
//
// Every page's CSP also has a `style-src` with no 'unsafe-inline' - its own
// 'self', or its nonce - and its components carry styles, plain and scoped:
// under safe mode they are adopted stylesheets, which style-src doesn't govern.
//
// Three pages, each a claim:
//
//   eval     no safeEval(): the CSP refuses eval, and mounting a component
//            with a setup script throws - the baseline, and the proof that
//            the policy is live
//   nonce    safeEval({ nonce: true }): the same component renders and reacts
//            to clicks, and the page records no CSP violation at all
//   refused  a decoy <script nonce> ahead of the real one: jq79 reads the wrong
//            nonce, the CSP refuses what it builds, and it says so
//
// And two apps built by Vite with the jq79/vite plugin, each mounting its
// component the moment it is imported - so the precompiled script has to be
// in before the module that needs it finishes:
//
//   vite     jq79({ safeEval: true }) under `script-src 'self'`, no nonce at
//            all: renders and reacts from precompiled functions alone
//   vite+n   jq79({ safeEval: { nonce: true } }) under `script-src 'nonce-…'`
//            (Vite's html.cspNonce, filled per response): the same, and a
//            component built from a string goes through the nonce
//
// And the no-bundle route: a static site with jq79-sw.js at its root, every
// response under `script-src 'self'` - the worker's own included - and
// `await Component79.safeEval()` on the page, visited for the first time in a
// fresh browser context and then reloaded:
//
//   sw       first visit: the worker installs and claims the page; a fetched
//            component renders on its mounting stack and reacts to clicks, one
//            imported from a script renders too, and a file holding an
//            expression written to close its function early runs nothing
//   sw 2nd   the same page reloaded, already under the worker's control
//
// Run it with `npm run check:csp`. Exits non-zero when a claim fails.

import { createServer } from "node:http"
import { readFileSync, existsSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join, resolve, extname } from "node:path"
import { tmpdir } from "node:os"
import { chromium } from "playwright"

execFileSync("npx", ["tsup"], { stdio: "ignore" }) // dist/ is gitignored
const { build } = await import("vite")
const { jq79 } = await import(resolve("dist/vite.js"))

const COUNTER = `
<script>
  let count = 1
  let items = ["a", "b"]
  $: doubled = count * 2
  const add = () => { count++ }
</script>
<p class="out">{{ count }}/{{ doubled }}</p>
<button class="add" @click="add()">+</button>
<button class="ten" @click="count += 10">+10</button>
<ul><li :each="item in items">{{ item }}</li></ul>
<span class="big" :if="count > 5">big</span>
<style>.out { color: rgb(1, 2, 3) }</style>
<style scoped>.add { font-weight: 700 }</style>
`

// what each page's module does, then leaves on window.__result
const MAIN = `
import { Component79 } from "/jq79.js"

const violations = []
document.addEventListener("securitypolicyviolation", e => violations.push(e.violatedDirective))
const mode = new URL(import.meta.url).searchParams.get("mode")
const result = { mode }
try {
  if (mode !== "eval") await Component79.safeEval({ nonce: true })
  const Counter = await Component79.fetch("/Counter.html")
  const host = document.querySelector("#app")
  Counter.mount(host)
  const text = () => host.textContent.replace(/\\s+/g, "")
  await new Promise(r => setTimeout(r))
  result.before = text()
  result.color = getComputedStyle(host.querySelector(".out")).color
  result.scoped = getComputedStyle(host.querySelector(".add")).fontWeight
  host.querySelector(".add")?.click()
  host.querySelector(".ten")?.click()
  await new Promise(r => setTimeout(r))
  result.after = text()
} catch (error) {
  result.thrown = String(error && error.message || error)
}
result.violations = violations
window.__result = result
`

// the Vite apps: a page, a main module that mounts on import, the component
const VITE_MAIN = (nonce) => `
import Counter from "./Counter.html"
import { Component79 } from "jq79"

const violations = []
document.addEventListener("securitypolicyviolation", e => violations.push(e.violatedDirective))
const result = {}
try {
  const host = document.querySelector("#app")
  const text = () => host.textContent.replace(/\\s+/g, "")
  // no tick first: the component renders on this stack, from functions that
  // had to be registered before its module finished evaluating
  Counter.mount(host)
  result.before = text()
  result.color = getComputedStyle(host.querySelector(".out")).color
  result.scoped = getComputedStyle(host.querySelector(".add")).fontWeight
  host.querySelector(".add")?.click()
  host.querySelector(".ten")?.click()
  await new Promise(r => setTimeout(r))
  result.after = text()
  ${nonce ? `const extra = document.createElement("div")
  new Component79("<i>{{ n * 2 }}</i>").mount(extra, { n: 21 })
  result.extra = extra.textContent` : ""}
} catch (error) {
  result.thrown = String(error && error.message || error)
}
result.violations = violations
window.__result = result
`
// the no-bundle page: safeEval() first, then components fetched by URL
const SW_MAIN = `
import { Component79 } from "/jq79.js"

const violations = []
document.addEventListener("securitypolicyviolation", e => violations.push(e.violatedDirective))
const result = {}
try {
  await Component79.safeEval()
  result.controlled = !!navigator.serviceWorker.controller
  const Counter = await Component79.fetch("/Counter.html")
  const host = document.querySelector("#app")
  const text = () => host.textContent.replace(/\\s+/g, "")
  Counter.mount(host)
  result.before = text()
  result.color = getComputedStyle(host.querySelector(".out")).color
  result.scoped = getComputedStyle(host.querySelector(".add")).fontWeight
  host.querySelector(".add")?.click()
  host.querySelector(".ten")?.click()
  await new Promise(r => setTimeout(r))
  result.after = text()

  const App = await Component79.fetch("/App.html")
  const appHost = document.createElement("div")
  document.body.append(appHost)
  App.mount(appHost)
  for (let i = 0; i < 50 && !appHost.querySelector(".row"); i++) await new Promise(r => setTimeout(r, 10))
  result.nested = appHost.querySelector(".row")?.textContent
  result.rowColor = getComputedStyle(appHost.querySelector(".row")).color
  result.box = getComputedStyle(appHost.querySelector("c79-row")).display

  const Evil = await Component79.fetch("/Evil.html")
  const evilHost = document.createElement("div")
  Evil.mount(evilHost, { ok: "fine" })
  result.evil = evilHost.textContent
  result.pwned = self.__pwned === 1
} catch (error) {
  result.thrown = String(error && error.message || error)
}
result.violations = violations
window.__result = result
`
const APP = `
<script>
  const Row = await import("./Row.html")
  let label = "hi"
</script>
<Row :label></Row>
`
const ROW = `<script :setup="{ label }"></script><b class="row">{{ label.toUpperCase() }}</b><style>.row { color: rgb(4, 5, 6) }</style>`
// closes its function, its entry and the push, and sets a flag - if it's ever
// written into the worker's script unchecked (see tests/sw.test.ts)
const EVIL = `<p>{{ 1) } }]); self.__pwned = 1; ([[], "", function () { { (1 }}</p><b>{{ ok }}</b>`

const NONCE_PLACEHOLDER = "JQ79_CSP_NONCE"
const viteRoot = mkdtempSync(join(tmpdir(), "jq79-csp-"))
const buildViteApp = async (name, safeEval, nonce) => {
  const root = join(viteRoot, name)
  execFileSync("mkdir", ["-p", root])
  writeFileSync(join(root, "index.html"), `<!doctype html><html><head><script type="module" src="./main.js"></script></head><body><div id="app"></div></body></html>`)
  writeFileSync(join(root, "main.js"), VITE_MAIN(nonce))
  writeFileSync(join(root, "Counter.html"), COUNTER)
  await build({
    configFile: false,
    logLevel: "silent",
    root,
    base: `/${name}/`,
    plugins: [jq79({ safeEval })],
    resolve: { alias: { jq79: resolve("dist/jq79.js") } },
    ...(nonce ? { html: { cspNonce: NONCE_PLACEHOLDER } } : {}),
    build: { outDir: join(root, "dist"), emptyOutDir: true },
  })
  return join(root, "dist")
}
const viteApps = {
  "vite": await buildViteApp("vite", true, false),
  "vite+n": await buildViteApp("vite-n", { nonce: true }, true),
}

const serveBuilt = (res, dir, path, csp, nonce) => {
  const file = join(dir, path === "" ? "index.html" : path)
  if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end()
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }
  const headers = { "content-type": types[extname(file)] ?? "application/octet-stream" }
  let body = readFileSync(file)
  if (extname(file) === ".html") {
    headers["content-security-policy"] = csp
    if (nonce) body = String(body).replaceAll(NONCE_PLACEHOLDER, nonce)
  }
  res.writeHead(200, headers).end(body)
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  if (url.pathname.startsWith("/vite/")) {
    serveBuilt(res, viteApps.vite, url.pathname.slice("/vite/".length), "script-src 'self'; style-src 'self'")
  } else if (url.pathname.startsWith("/vite-n/")) {
    const nonce = randomBytes(16).toString("base64")
    serveBuilt(res, viteApps["vite+n"], url.pathname.slice("/vite-n/".length), `script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`, nonce)
  } else if (url.pathname === "/jq79-sw.js") {
    // a static host's CSP is on every response, the worker's own included
    res.writeHead(200, { "content-type": "text/javascript", "content-security-policy": "script-src 'self'" })
      .end(readFileSync(resolve("dist/jq79-sw.js")))
  } else if (url.pathname === "/sw-page") {
    res.writeHead(200, { "content-type": "text/html", "content-security-policy": "script-src 'self'; style-src 'self'" })
      .end(`<!doctype html><html><head><script type="module" src="/sw-main.js"></script></head><body><div id="app"></div></body></html>`)
  } else if (url.pathname === "/sw-main.js") {
    res.writeHead(200, { "content-type": "text/javascript" }).end(SW_MAIN)
  } else if (url.pathname === "/App.html") {
    res.writeHead(200, { "content-type": "text/html" }).end(APP)
  } else if (url.pathname === "/Row.html") {
    res.writeHead(200, { "content-type": "text/html" }).end(ROW)
  } else if (url.pathname === "/Evil.html") {
    res.writeHead(200, { "content-type": "text/html" }).end(EVIL)
  } else if (url.pathname === "/jq79.js") {
    res.writeHead(200, { "content-type": "text/javascript" }).end(readFileSync(resolve("dist/jq79.js")))
  } else if (url.pathname === "/Counter.html") {
    res.writeHead(200, { "content-type": "text/html" }).end(COUNTER)
  } else if (url.pathname === "/main.js") {
    res.writeHead(200, { "content-type": "text/javascript" }).end(MAIN)
  } else if (url.pathname === "/page") {
    const mode = url.searchParams.get("mode")
    const nonce = randomBytes(16).toString("base64")
    // a script element the parser leaves alone (a data block), carrying a
    // nonce the policy doesn't name - and it comes first in the document
    const decoy = mode === "refused" ? `<script type="application/json" nonce="not-the-nonce">{}</script>` : ""
    res.writeHead(200, {
      "content-type": "text/html",
      "content-security-policy": `script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`,
    }).end(
      `<!doctype html><html><head>${decoy}` +
      `<script type="module" nonce="${nonce}" src="/main.js?mode=${mode}"></script>` +
      `</head><body><div id="app"></div></body></html>`
    )
  } else {
    res.writeHead(404).end()
  }
})
await new Promise(done => server.listen(0, done))
const origin = `http://localhost:${server.address().port}`

const failures = []
const check = (mode, claim, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${mode.padEnd(8)} ${claim}${ok ? "" : `\n        ${detail}`}`)
  if (!ok) failures.push(`${mode}: ${claim}`)
}

const browser = await chromium.launch()
try {
  const pages = { eval: "/page?mode=eval", nonce: "/page?mode=nonce", refused: "/page?mode=refused", "vite": "/vite/", "vite+n": "/vite-n/" }
  for (const [mode, path] of Object.entries(pages)) {
    const page = await browser.newPage()
    const errors = []
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
    await page.goto(`${origin}${path}`)
    await page.waitForFunction(() => window.__result, null, { timeout: 10_000 })
    const result = await page.evaluate(() => window.__result)
    const detail = JSON.stringify({ ...result, errors })

    if (mode === "eval") {
      check(mode, "the CSP refuses eval: mounting a component with a script throws", /'unsafe-eval' is not an allowed source/.test(result.thrown ?? ""), detail)
    } else if (mode === "nonce") {
      check(mode, "renders", result.before === "1/2++10ab", detail)
      check(mode, "reacts to clicks, $: included", result.after === "12/24++10abbig", detail)
      check(mode, "component styles apply, plain and scoped, with no 'unsafe-inline' in style-src", result.color === "rgb(1, 2, 3)" && result.scoped === "700", detail)
      check(mode, "the page records no CSP violation", result.violations.length === 0, detail)
      check(mode, "and logs no error", errors.length === 0, detail)
    } else if (mode === "vite" || mode === "vite+n") {
      check(mode, "renders on the stack it mounts on", result.before === "1/2++10ab", detail)
      check(mode, "reacts to clicks, $: included", result.after === "12/24++10abbig", detail)
      if (mode === "vite+n") check(mode, "builds a string component through the nonce", result.extra === "42", detail)
      check(mode, "component styles apply, plain and scoped, with no 'unsafe-inline' in style-src", result.color === "rgb(1, 2, 3)" && result.scoped === "700", detail)
      check(mode, "the page records no CSP violation", result.violations?.length === 0, detail)
      check(mode, "and logs no error", errors.length === 0, detail)
    } else {
      check(mode, "says the CSP refused the nonce it read, without printing it", /refused a <script> carrying the nonce jq79 read from the page\./.test(result.thrown ?? "") && !/not-the-nonce/.test(result.thrown), detail)
    }
    await page.close()
  }

  // a fresh context is a first visit: no worker installed yet
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
  for (const mode of ["sw", "sw 2nd"]) {
    errors.length = 0
    if (mode === "sw") await page.goto(`${origin}/sw-page`)
    else await page.reload()
    await page.waitForFunction(() => window.__result, null, { timeout: 15_000 })
    const result = await page.evaluate(() => window.__result)
    const detail = JSON.stringify({ ...result, errors })
    check(mode, "the worker controls the page once safeEval() resolves", result.controlled === true, detail)
    check(mode, "a fetched component renders on the stack it mounts on", result.before === "1/2++10ab", detail)
    check(mode, "reacts to clicks, $: included", result.after === "12/24++10abbig", detail)
    check(mode, "a component imported from a script renders", result.nested === "HI", detail)
    check(mode, "component styles apply, plain and scoped, with no 'unsafe-inline' in style-src", result.color === "rgb(1, 2, 3)" && result.scoped === "700" && result.rowColor === "rgb(4, 5, 6)", detail)
    check(mode, "a component's box lays out as display: contents", result.box === "contents", detail)
    check(mode, "an expression written to escape its function runs nothing", result.pwned === false && result.evil === "fine", detail)
    check(mode, "the page records no CSP violation", result.violations?.length === 0, detail)
    check(mode, "and logs no error", errors.length === 0, detail)
  }
  await context.close()
} finally {
  await browser.close()
  server.close()
  rmSync(viteRoot, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} claim(s) failed`)
  process.exit(1)
}
