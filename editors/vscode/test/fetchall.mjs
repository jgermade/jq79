// the fetchAll quick fix's reading (src/fetchall.ts): which runs of awaited
// C79.fetch calls it offers to rewrite, and what into. The server answering
// with it, over LSP, is server.mjs's
import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const { fetchRuns, documentRuns } = require("../dist/fetchall.js")

// the text with every run rewritten, the way the quick fix leaves it
const fixed = (text, runs = fetchRuns(ts, text, ts.ScriptKind.TS)) =>
  [...runs].reverse().reduce((out, run) => out.slice(0, run.start) + run.replacement + out.slice(run.end), text)

test("two awaited fetches in a row become one fetchAll", () => {
  const text = [
    `import { C79 } from "jq79"`,
    `const Header = await C79.fetch("./header.html")`,
    `const Footer = await C79.fetch('./footer.html');`,
    `Header.mount("header")`,
  ].join("\n")
  assert.equal(fixed(text), [
    `import { C79 } from "jq79"`,
    `const [Header, Footer] = await C79.fetchAll(["./header.html", './footer.html']);`,
    `Header.mount("header")`,
  ].join("\n"))
})

test("a long run is written one URL a line, at its own indentation", () => {
  const text = [
    `async function start() {`,
    `  let Header = await Component79.fetch("./components/layout/site-header.html")`,
    `  let Sidebar = await Component79.fetch("./components/layout/site-sidebar.html")`,
    `  let Footer = await Component79.fetch("./components/layout/site-footer.html")`,
    `}`,
  ].join("\n")
  assert.equal(fixed(text), [
    `async function start() {`,
    `  let [Header, Sidebar, Footer] = await Component79.fetchAll([`,
    `    "./components/layout/site-header.html",`,
    `    "./components/layout/site-sidebar.html",`,
    `    "./components/layout/site-footer.html",`,
    `  ])`,
    `}`,
  ].join("\n"))
})

test("only what the rewrite can't change the meaning of", () => {
  const text = [
    `const A = await C79.fetch("./a.html")`,          // a run of one: nothing
    `doSomething()`,
    `const B = await C79.fetch("./b.html").mount("#b")`, // a chain: it mounts
    `const C = await C79.fetch(url)`,                  // not a literal
    `const D = await C79.fetch("./d.html")`,
    `let E = await C79.fetch("./e.html")`,             // another kind
    `const F = await C79.fetch("./f.html")`,
    `// the author's note`,
    `const G = await C79.fetch("./g.html")`,           // a comment between
    `const { H } = await C79.fetch("./h.html")`,       // a pattern
    `const I = C79.fetch("./i.html")`,                 // not awaited
    `const J = await other.fetch("./j.html")`,         // not jq79
    `export const K = await C79.fetch("./k.html")`,    // exported
    `export const L = await C79.fetch("./l.html")`,
  ].join("\n")
  assert.deepEqual(fetchRuns(ts, text, ts.ScriptKind.TS), [])
})

test("runs are per block, and broken by anything else", () => {
  const text = [
    `const A = await C79.fetch("./a.html")`,
    `const B = await C79.fetch("./b.html")`,
    `if (wanted) {`,
    `  const C = await C79.fetch("./c.html")`,
    `  const D = await C79.fetch("./d.html")`,
    `}`,
  ].join("\n")
  assert.deepEqual(fetchRuns(ts, text, ts.ScriptKind.TS).map(run => run.names), [["A", "B"], ["C", "D"]])
})

test("a page's scripts are read where they are; a component's are not", () => {
  const page = [
    `<!doctype html>`,
    `<main></main>`,
    `<script type="module">`,
    `  const A = await C79.fetch("./a.html")`,
    `  const B = await C79.fetch("./b.html")`,
    `</script>`,
  ].join("\n")
  const [run] = documentRuns(ts, "html", page)
  assert.equal(page.slice(run.start, run.end), `const A = await C79.fetch("./a.html")\n  const B = await C79.fetch("./b.html")`)
  assert.equal(run.replacement, `const [A, B] = await C79.fetchAll(["./a.html", "./b.html"])`)

  const component = [`<script :setup>`, `  const A = await C79.fetch("./a.html")`, `  const B = await C79.fetch("./b.html")`, `</script>`, `<p></p>`].join("\n")
  assert.deepEqual(documentRuns(ts, "html", component), [])
  assert.equal(documentRuns(ts, "javascript", `const A = await C79.fetch("a.html")\nconst B = await C79.fetch("b.html")`).length, 1)
})
