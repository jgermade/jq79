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
// Run it with `npm run check:csp`. Exits non-zero when a claim fails.

import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { chromium } from "playwright"

execFileSync("npx", ["tsup"], { stdio: "ignore" }) // dist/ is gitignored

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

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  if (url.pathname === "/jq79.js") {
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
      "content-security-policy": `script-src 'nonce-${nonce}'`,
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
  for (const mode of ["eval", "nonce", "refused"]) {
    const page = await browser.newPage()
    const errors = []
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
    await page.goto(`${origin}/page?mode=${mode}`)
    await page.waitForFunction(() => window.__result, null, { timeout: 10_000 })
    const result = await page.evaluate(() => window.__result)
    const detail = JSON.stringify({ ...result, errors })

    if (mode === "eval") {
      check(mode, "the CSP refuses eval: mounting a component with a script throws", /'unsafe-eval' is not an allowed source/.test(result.thrown ?? ""), detail)
    } else if (mode === "nonce") {
      check(mode, "renders", result.before === "1/2++10ab", detail)
      check(mode, "reacts to clicks, $: included", result.after === "12/24++10abbig", detail)
      check(mode, "the page records no CSP violation", result.violations.length === 0, detail)
      check(mode, "and logs no error", errors.length === 0, detail)
    } else {
      check(mode, "says the CSP refused the nonce it read, without printing it", /refused a <script> carrying the nonce jq79 read from the page\./.test(result.thrown ?? "") && !/not-the-nonce/.test(result.thrown), detail)
    }
    await page.close()
  }
} finally {
  await browser.close()
  server.close()
}

if (failures.length > 0) {
  console.error(`\n${failures.length} claim(s) failed`)
  process.exit(1)
}
