// what each injection has to get right, asserted on the scopes VS Code would
// give the tokens (see tokenize.mjs for how the grammars are wired)
import { test } from "node:test"
import assert from "node:assert/strict"
import { dump, tokenize } from "./tokenize.mjs"

// the scopes of the nth token whose text is `text` (surrounding space ignored)
const scopesOf = (tokens, text, nth = 0) => {
  const found = tokens.filter(token => token.text.trim() === text)[nth]
  assert.ok(found, `no token ${JSON.stringify(text)} (#${nth}) in:\n${dump(tokens)}`)
  return found.scopes
}

// a scope selector's prefix rule: "source.ts" matches source.ts and source.ts.x
const has = (scopes, scope) => scopes.some(s => s === scope || s.startsWith(`${scope}.`))

const assertIn = (tokens, text, scope, nth = 0) => {
  const scopes = scopesOf(tokens, text, nth)
  assert.ok(has(scopes, scope), `${JSON.stringify(text)} should be in ${scope}, is in:\n  ${scopes.join("\n  ")}`)
}

const assertNotIn = (tokens, text, scope, nth = 0) => {
  const scopes = scopesOf(tokens, text, nth)
  assert.ok(!has(scopes, scope), `${JSON.stringify(text)} should not be in ${scope}, is in:\n  ${scopes.join("\n  ")}`)
}

const html = source => tokenize("text.html.derivative", source)
const js = source => tokenize("source.js", source)
const ts = source => tokenize("source.ts", source)

// ------------------------------------------------------------------ <script>

test("<script lang=\"ts\"> is TypeScript", async () => {
  const tokens = await html([
    `<script :setup="{ step = 1 }: Props" lang="ts">`,
    `  let count: number = 0`,
    `</script>`,
  ].join("\n"))
  assertIn(tokens, "number", "source.ts")
  assertIn(tokens, "number", "support.type.primitive")
  assertNotIn(tokens, "number", "source.js")
})

test("the tag keeps its HTML scopes, and the markup after it is HTML again", async () => {
  const tokens = await html([
    `<script :setup lang="ts">`,
    `  let count: number = 0`,
    `</script>`,
    `<p>{{ count }}</p>`,
  ].join("\n"))
  assertIn(tokens, "script", "entity.name.tag.html", 0)
  assertIn(tokens, "lang", "entity.other.attribute-name")
  assertIn(tokens, "script", "entity.name.tag.html", 1)
  assertIn(tokens, "p", "entity.name.tag.html")
  assertNotIn(tokens, "p", "source.ts")
})

test("every spelling the plugin compiles", async () => {
  for (const tag of [
    `<script lang="typescript">`,
    `<script lang='ts'>`,
    `<script lang=ts>`,
    `<SCRIPT LANG="TS">`,
    `<script type="text/typescript">`,
    `<script type="application/x-typescript">`,
    `<script :setup type='text/typescript' >`,
  ]) {
    const tokens = await html(`${tag}\n  let n: number = 0\n</script>`)
    assertIn(tokens, "number", "source.ts")
  }
})

test("a lang answers on its own: type is not read past it", async () => {
  const tokens = await html(`<script lang="coffee" type="text/typescript">\n  n = 1\n</script>`)
  assertNotIn(tokens, "n = 1", "source.ts")
})

test("scripts the plugin leaves alone keep VS Code's own grammar", async () => {
  const plain = await html(`<script :setup>\n  let n = 0\n</script>`)
  assertIn(plain, "n", "source.js")
  const module = await html(`<script type="module">\n  let n = 0\n</script>`)
  assertIn(module, "n", "source.js")
  const other = await html(`<script lang="coffee">\n  let n = 0\n</script>`)
  assertIn(other, "n", "source.js")
})

test("an indented tag, where VS Code's rule starts matching at the indentation", async () => {
  const tokens = await html(`<template name="Row">\n  <script :setup lang="ts">\n    let n: number = 0\n  </script>\n</template>`)
  assertIn(tokens, "number", "source.ts")
})

test("a > inside an attribute value doesn't end the tag early", async () => {
  const tokens = await html(`<script :setup="{ onPick = (x) => x > 0 }" lang="ts">\n  let n: number = 0\n</script>`)
  assertIn(tokens, "number", "source.ts")
})

test("a lang inside another attribute's value is not the mark", async () => {
  const tokens = await html(`<script :setup="{ lang = 'ts' }">\n  let n = 0\n</script>`)
  assertIn(tokens, "n", "source.js")
})

// only a comment that starts a statement: after code, the TS grammar's own
// comment rule is the one open, and it runs to the end of the line - which
// VS Code's HTML grammar does to plain JS too
test("a // comment on the closing line doesn't swallow </script>", async () => {
  const tokens = await html(`<script lang="ts">\n  let n: number = 0\n  // done</script>\n<p></p>`)
  assertIn(tokens, "p", "entity.name.tag.html")
  assertNotIn(tokens, "p", "source.ts")
})

// TextMate reads one line at a time, so the mark has to be on the line the tag
// opens on. When it isn't, the block is what VS Code makes of it without this
// extension - JS - rather than anything broken
test("a tag whose lang is on a later line falls back to VS Code's JS", async () => {
  const tokens = await html(`<script\n  :setup="{ step = 1 }"\n  lang="ts"\n>\n  let n = 0\n</script>\n<p></p>`)
  assertIn(tokens, "n", "source.js")
  assertIn(tokens, "p", "entity.name.tag.html")
  assertNotIn(tokens, "p", "source.js")
})

test("not inside an HTML comment", async () => {
  const tokens = await html(`<!-- <script lang="ts"> let n: number = 0 </script> -->\n<p></p>`)
  assert.ok(!tokens.some(({ scopes }) => has(scopes, "source.ts")), dump(tokens))
  assertIn(tokens, "p", "entity.name.tag.html")
})

// ------------------------------------------------------------------ <style>

test("<style lang> in the language it names", async () => {
  const scss = await html(`<style lang="scss" scoped>\n  $gap: 4px;\n  .a { .b { gap: $gap; } }\n</style>`)
  assertIn(scss, "$gap", "source.css.scss")
  assertIn(scss, "scoped", "entity.other.attribute-name")

  const less = await html(`<style lang="less">\n  @gap: 4px;\n</style>`)
  assertIn(less, "gap", "source.css.less")
  assertIn(less, "gap", "variable.other.readwrite")
})

test("a style without lang is VS Code's CSS, and the markup after a lang one is HTML", async () => {
  const tokens = await html(`<style>\n  .a { color: red }\n</style>\n<style lang="scss">\n  .b { color: red }\n</style>\n<p></p>`)
  assertIn(tokens, "color", "source.css", 0)
  assertNotIn(tokens, "color", "source.css.scss", 0)
  assertIn(tokens, "color", "source.css.scss", 1)
  assertNotIn(tokens, "p", "source.css")
})

test("a block that opens and closes on one line", async () => {
  const tokens = await html(`<style lang="scss">.a { .b { color: red } }</style><p></p>`)
  assertIn(tokens, "color", "source.css.scss")
  assertIn(tokens, "p", "entity.name.tag.html")
  assertNotIn(tokens, "p", "source.css.scss")
})

test("sass and stylus are colored by their own extension's grammar, when there is one", async () => {
  // test/fixtures/source.stylus.json stands in for an installed extension
  const stylus = await html(`<style lang="styl">\n  .a\n    color red\n</style>`)
  assertIn(stylus, "color", "support.type.property-name.stylus")

  // and nothing provides source.sass: the block goes uncolored, not wrong -
  // the tag keeps its scopes and the markup after it is HTML
  const sass = await html(`<style lang="sass">\n  .a\n    color: red\n</style>\n<p></p>`)
  assertIn(sass, "\"", "punctuation.definition.string.end.html", 1)
  assertIn(sass, ">", "punctuation.definition.tag.end.html")
  assertNotIn(sass, ".a", "source.css")
  assertIn(sass, "p", "entity.name.tag.html")
})

// ------------------------------------------------------------------ template literals

test("the source passed to Component79 is HTML", async () => {
  const tokens = await js([
    "new Component79(`",
    "  <ul>",
    "    <li :each=\"user of users\"><UserCard :user></UserCard></li>",
    "  </ul>",
    "`).mount(document.body)",
  ].join("\n"))
  assertIn(tokens, "ul", "text.html.basic")
  assertIn(tokens, "ul", "entity.name.tag.html")
  assertIn(tokens, "UserCard", "entity.name.tag.html")
  assertNotIn(tokens, "UserCard", "invalid")
  assertIn(tokens, "mount", "entity.name.function")
  assertNotIn(tokens, "mount", "text.html.basic")
})

test("…in a TypeScript file too, and without new", async () => {
  const tokens = await ts("const list = Component79( `<ul></ul>` )")
  assertIn(tokens, "ul", "entity.name.tag.html")
})

test("…and its own <script lang=\"ts\"> and <style lang=\"scss\"> blocks", async () => {
  const tokens = await js([
    "new Component79(`",
    "  <script :setup lang=\"ts\">",
    "    let n: number = 0",
    "  </script>",
    "  <style lang=\"scss\">",
    "    $gap: 4px;",
    "  </style>",
    "  <p>{{ n }}</p>",
    "`)",
  ].join("\n"))
  assertIn(tokens, "number", "source.ts")
  assertIn(tokens, "$gap", "source.css.scss")
  assertIn(tokens, "p", "entity.name.tag.html")
})

test("a component string in a <script> of an .html page", async () => {
  const tokens = await html("<script type=\"module\">\n  new Component79(`<p class=\"a\"></p>`)\n</script>")
  assertIn(tokens, "p", "entity.name.tag.html")
  assertIn(tokens, "class", "entity.other.attribute-name")
})

test("tagged literals: html, css, scss, less, js, ts", async () => {
  const tokens = await js([
    "const a = html`<p></p>`",
    "const b = css`.a { color: red }`",
    "const c = scss`.a { .b { color: red } }`",
    "const d = less`@gap: 4px;`",
    "const e = js`let x = 1;`",
    "const f = ts`let y: number = 1;`",
  ].join("\n"))
  assertIn(tokens, "p", "entity.name.tag.html")
  assertIn(tokens, "html", "entity.name.function.tagged-template")
  assertIn(tokens, "color", "source.css", 0)
  assertIn(tokens, "color", "source.css.scss", 1)
  assertIn(tokens, "gap", "source.css.less")
  assertIn(tokens, "x", "meta.embedded.block.js")
  assertIn(tokens, "number", "source.ts")
})

// the one fragment that runs past its backtick is a one-line statement left
// open (js`let x = 1`): the JS grammar's rule for it is still open there, and
// only the outermost rule's end can close the literal. A `;`, or the backtick
// on a line of its own, closes the statement first
test("js and ts literals, one statement per line or closed with ;", async () => {
  const tokens = await ts([
    "const a = ts`",
    "  const n: number = 1",
    "`",
    "let after = 1",
  ].join("\n"))
  assertIn(tokens, "number", "meta.embedded.block.ts")
  assertIn(tokens, "after", "variable.other.readwrite")
  assertNotIn(tokens, "after", "meta.embedded.template-literal.jq79")
})

test("${…} is JS at any depth, an attribute value included", async () => {
  const tokens = await js("html`<p class=\"${cls}\">${label}</p>`")
  assertIn(tokens, "cls", "meta.template.expression")
  assertIn(tokens, "cls", "variable.other.readwrite")
  assertIn(tokens, "label", "meta.template.expression")
})

test("an escaped backtick or ${ doesn't end or open anything", async () => {
  const tokens = await js("html`<p>\\` \\${x}</p>`; after")
  assertIn(tokens, "\\`", "constant.character.escape")
  assertNotIn(tokens, "{x}", "meta.template.expression")
  assertIn(tokens, "after", "variable.other.readwrite")
  assertNotIn(tokens, "after", "meta.embedded.template-literal.jq79")
})

test("the literal ends at its backtick, and the code after it is code", async () => {
  const tokens = await js("let a = html`<p></p>`, b = 1")
  assertIn(tokens, "b", "variable.other.readwrite")
  assertNotIn(tokens, "b", "text.html.basic")
})

test("a nested literal inside ${…}", async () => {
  const tokens = await js("html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`")
  assertIn(tokens, "li", "entity.name.tag.html")
  assertIn(tokens, "i", "meta.template.expression", 1)
})

test("not inside strings or comments, nor a name that only ends in a tag", async () => {
  const tokens = await js("'html`<p>`' // html`<p>`\nmyhtml`<p>`")
  const tags = tokens.filter(({ scopes }) => has(scopes, "entity.name.tag.html"))
  assert.deepEqual(tags, [], dump(tokens))
})
