import { describe, it, expect } from "vitest"
import { transformSetupScript, transformFactoryScript, parsePropsPattern, parseFactoryProps } from "../src/transform"

// the scanner is not a parser: on malformed input it must still terminate and
// hand the (broken) source to the JS engine, which reports the real SyntaxError
describe("setup script scanner on unterminated input", () => {
  it("consumes an unterminated string to the end of the source", () => {
    const { vars, code } = transformSetupScript(`let name = "Ada`)

    expect(vars).toEqual(["name"])
    expect(code).toBe(`name = "Ada`)
  })

  it("consumes an unterminated block comment to the end of the source", () => {
    const { vars, code } = transformSetupScript(`let count = 1\n/* trailing`)

    expect(vars).toEqual(["count"])
    expect(code).toBe(`count = 1\n/* trailing`)
  })

  it("ends a reactive statement at the end of the source when there is no newline or `;`", () => {
    const { vars, code } = transformSetupScript(`$: doubled = count * 2`)

    expect(vars).toEqual(["doubled"])
    expect(code).toBe(`$__effect(() => { doubled = count * 2 });`)
  })

  it("ends a reactive statement at the end of the source when a bracket is left open", () => {
    const { code } = transformSetupScript(`$: total = sum([1, 2`)

    expect(code).toBe(`$__effect(() => { total = sum([1, 2 });`)
  })

  it("consumes an unterminated regex to the end of the source", () => {
    const { vars, code } = transformSetupScript(`let re = /never closed`)

    expect(vars).toEqual(["re"])
    expect(code).toBe(`re = /never closed`)
  })

  it("stops an unclosed regex at its line end, so the damage stays on that line", () => {
    // a literal can't contain an unescaped newline: the skip bails there and
    // the next line is scanned normally - one broken line, not a cascade
    const { vars, code } = transformSetupScript(`let re = /never closed\nlet after = 1`)

    expect(vars).toEqual(["re", "after"])
    expect(code).toBe(`re = /never closed\nafter = 1`)
  })
})

describe("setup script scanner", () => {
  it("keeps an escaped quote from ending a string", () => {
    const { vars, code } = transformSetupScript(`let quote = "she said \\"hi\\""\nlet after = 1`)

    expect(vars).toEqual(["quote", "after"])
    expect(code).toBe(`quote = "she said \\"hi\\""\nafter = 1`)
  })

  it("keeps a reactive statement together across comments and brackets", () => {
    const { code } = transformSetupScript(
      `$: total = sum([\n  1, // one\n  2, /* two */\n]) + count`
    )

    expect(code).toBe(
      `$__effect(() => { total = sum([\n  1, // one\n  2, /* two */\n]) + count });`
    )
  })

  it("leaves a `$:` label that is not an assignment as a tracked statement", () => {
    const { vars, code } = transformSetupScript(`$: console.log(count)`)

    expect(vars).toEqual([]) // nothing declared, but the body still re-runs
    expect(code).toBe(`$__effect(() => { console.log(count) });`)
  })

  it("keeps a leading-dot method chain in the same reactive statement", () => {
    const { vars, code } = transformSetupScript(`$: names = users\n  .filter(u => u.active)\n  .map(u => u.name)\nlet after = 1`)

    expect(vars).toEqual(["names", "after"])
    expect(code).toBe(
      `$__effect(() => { names = users\n  .filter(u => u.active)\n  .map(u => u.name) });\nafter = 1`
    )
  })

  it("keeps multi-line operator, ternary and optional-chaining continuations together", () => {
    expect(transformSetupScript(`$: total = a\n  + b\n  - c`).code).toBe(
      `$__effect(() => { total = a\n  + b\n  - c });`
    )
    expect(transformSetupScript(`$: label = ok\n  ? "yes"\n  : "no"`).code).toBe(
      `$__effect(() => { label = ok\n  ? "yes"\n  : "no" });`
    )
    expect(transformSetupScript(`$: city = user\n  ?.address\n  ?? "unknown"`).code).toBe(
      `$__effect(() => { city = user\n  ?.address\n  ?? "unknown" });`
    )
  })

  it("continues across a comment line before the chained call", () => {
    const { code } = transformSetupScript(`$: names = users\n  // only the active ones\n  .filter(u => u.active)`)

    expect(code).toBe(`$__effect(() => { names = users\n  // only the active ones\n  .filter(u => u.active) });`)
  })

  it("ends the statement when the next line starts a new one", () => {
    const { code } = transformSetupScript(`$: doubled = n * 2\nconsole.log(doubled)`)

    expect(code).toBe(`$__effect(() => { doubled = n * 2 });\nconsole.log(doubled)`)
  })

  it("ends the statement before a line starting with a unary operator, as JS does", () => {
    const { code } = transformSetupScript(`$: flag = a\n!function () {}()`)

    expect(code).toBe(`$__effect(() => { flag = a });\n!function () {}()`)
  })

  it("preserves line numbers", () => {
    const src = `let a = 1\n$: b = a\n  + 1\n$: c = b\nfn(c)`
    const { code } = transformSetupScript(src)

    expect(code.split("\n")).toHaveLength(src.split("\n").length)
  })
})

// ---------------------------------------------------------------------------
// regex literals (2026-07-15 review). A regex walked as code used to poison
// the scanners: `/\//` put two slashes side by side (a line comment, as far
// as a scanner knew) and the bracket after them went uncounted; `/[(]/`
// inflated the depth for good. The scanners now consume a regex whole,
// deciding regex-vs-division by the last meaningful token (division needs a
// completed expression on its left; everywhere else a `/` can only open a
// regex). See TODOS/2026-07-15.scanner-regex-literals.md
// ---------------------------------------------------------------------------
describe("regex literals", () => {
  it("keeps a statement whole when a regex hides `//` before its closing bracket", () => {
    const { vars, code } = transformSetupScript(`$: segments = path.split(/\\//).length\nlet after = 1`)

    expect(vars).toEqual(["segments", "after"])
    expect(code).toBe(`$__effect(() => { segments = path.split(/\\//).length });\nafter = 1`)
  })

  it("keeps counting brackets after a `//` lookalike in a plain declaration", () => {
    const { vars, code } = transformSetupScript(`const parts = s.split(/\\//)\nlet flag = true`)

    expect(vars).toEqual(["parts", "flag"])
    expect(code).toBe(`parts = s.split(/\\//)\nflag = true`)
  })

  it("keeps depth balanced through an unbalanced bracket inside a character class", () => {
    const { vars, code } = transformSetupScript(`$: opens = s.split(/[(]/).length\nlet after = 1`)

    expect(vars).toEqual(["opens", "after"])
    expect(code).toBe(`$__effect(() => { opens = s.split(/[(]/).length });\nafter = 1`)
  })

  it("still detects a factory script past a regex that used to corrupt the depth", () => {
    const code = transformFactoryScript(`const clean = url.split(/\\//)\nexport default (_, { $data }) => ({ clean })`)

    expect(code).not.toBeNull()
    expect(code).toContain("$__exports.default =")
  })

  it("keeps the statement together when the regex tail carries the call", () => {
    const { vars, code } = transformSetupScript(`$: isUrl = /^https:\\/\\//.test(link)\nlet after = 1`)

    expect(vars).toEqual(["isUrl", "after"])
    expect(code).toBe(`$__effect(() => { isUrl = /^https:\\/\\//.test(link) });\nafter = 1`)
  })

  it("skips a regex after a reserved word", () => {
    // `return` admits a regex; the `(` inside the class must not count
    const { vars, code } = transformSetupScript(`const check = s => { return /[(]/.test(s) }\nlet after = 1`)

    expect(vars).toEqual(["check", "after"])
    expect(code).toBe(`check = s => { return /[(]/.test(s) }\nafter = 1`)
  })

  it("consumes the flags with the literal", () => {
    const { code } = transformSetupScript(`$: parts = path.split(/\\//g)\nlet after = 1`)

    expect(code).toBe(`$__effect(() => { parts = path.split(/\\//g) });\nafter = 1`)
  })

  it("still reads division when a block comment sits before the slash", () => {
    const { code } = transformSetupScript(`$: half = total /* halved */ / 2\nlet after = 1`)

    expect(code).toBe(`$__effect(() => { half = total /* halved */ / 2 });\nafter = 1`)
  })

  it("reads a regex default in a props pattern, commas and colons included", () => {
    expect(parsePropsPattern(`{ sep = /[,:]/, label = "x" }`)).toEqual([
      { name: "sep", default: "/[,:]/" },
      { name: "label", default: `"x"` },
    ])
  })

  it("skips quantifier braces and a lone `}` inside a literal", () => {
    // `{2,3}` used to count as real braces (balanced, by luck); a lone `}`
    // used to clamp the depth AND flip atStatementStart mid-expression
    expect(transformSetupScript(`$: ok = /^a{2,3}$/.test(s)\nlet after = 1`).code).toBe(
      `$__effect(() => { ok = /^a{2,3}$/.test(s) });\nafter = 1`
    )
    expect(transformSetupScript(`let m = s.split(/}/)\nlet after = 1`).vars).toEqual(["m", "after"])
  })

  it("is not fooled by comment lookalikes inside the literal", () => {
    // `/a\/*/` contains the two characters of a block-comment opener
    const { vars, code } = transformSetupScript(`let m = s.match(/a\\/*/)\nlet after = 1`)

    expect(vars).toEqual(["m", "after"])
    expect(code).toBe(`m = s.match(/a\\/*/)\nafter = 1`)
  })

  it("keeps an escaped `]` from closing the character class", () => {
    // the class is `[\]/]` - the escaped bracket stays inside, so the `/`
    // after it must not close the literal
    const { vars, code } = transformSetupScript(`$: m = s.match(/[\\]/]/)\nlet after = 1`)

    expect(vars).toEqual(["m", "after"])
    expect(code).toBe(`$__effect(() => { m = s.match(/[\\]/]/) });\nafter = 1`)
  })

  it("handles two slash-heavy literals in one expression", () => {
    const { code } = transformSetupScript(`$: both = /a\\//.test(x) && /b\\//.test(y)\nlet after = 1`)

    expect(code).toBe(`$__effect(() => { both = /a\\//.test(x) && /b\\//.test(y) });\nafter = 1`)
  })

  it("reads a regex and a division in the same statement", () => {
    // the first `/` follows `=` (regex), the second follows `)` (division)
    const { code } = transformSetupScript(`$: ratio = /\\d+\\//.test(s) / len\nlet after = 1`)

    expect(code).toBe(`$__effect(() => { ratio = /\\d+\\//.test(s) / len });\nafter = 1`)
  })

  it("admits a regex after typeof, and at the very start of the script", () => {
    expect(transformSetupScript(`$: kind = typeof /\\//`).code).toBe(
      `$__effect(() => { kind = typeof /\\// });`
    )
    // nothing before the `/`: an expression can start here
    expect(transformSetupScript(`/^#/.test(h) && init()\nlet after = 1`).vars).toEqual(["after"])
  })

  it("leaves a regex inside a template interpolation to the string skip", () => {
    const { vars, code } = transformSetupScript("let t = `has ${s.split(/\\//).length} parts`\nlet after = 1")

    expect(vars).toEqual(["t", "after"])
    expect(code).toBe("t = `has ${s.split(/\\//).length} parts`\nafter = 1")
  })

  it("leaves division alone", () => {
    // any future regex-awareness must keep classifying these as plain code:
    // division follows a completed expression (identifier, `)`, postfix ++)
    expect(transformSetupScript(`$: half = total / 2\nlet after = 1`).code).toBe(
      `$__effect(() => { half = total / 2 });\nafter = 1`
    )
    expect(transformSetupScript(`$: avg = (a + b) / (c - d)`).code).toBe(
      `$__effect(() => { avg = (a + b) / (c - d) });`
    )
    expect(transformSetupScript(`let half = n++ / 2`).code).toBe(`half = n++ / 2`)
  })

  it("passes a character-class slash through", () => {
    // `/[/]/` has no adjacent slashes and balanced brackets, so it works
    // today - and a future skipRegex must know a class slash doesn't close
    // the literal, or fixing the cases above would break this one
    const { vars, code } = transformSetupScript(`$: seg = path.split(/[/]/).length\nlet after = 1`)

    expect(vars).toEqual(["seg", "after"])
    expect(code).toBe(`$__effect(() => { seg = path.split(/[/]/).length });\nafter = 1`)
  })
})

// the gaps the regex heuristic leaves open on purpose (see the plan's
// "Rejected"/"Open" sections): a regex where only a parser could tell it from
// division. These pins measure each gap's blast radius as much as its
// existence - if a smarter heuristic ever rescues one, the pin flips and gets
// updated, which is exactly the reminder wanted
describe("the gaps left deliberately open", () => {
  it("misreads a regex right after an if-header `)`, radius: the rest of its line", () => {
    // after `)` the heuristic must say division (`(a + b) / 2`), so the
    // literal is walked as code and its `\//` reads as a line comment. With
    // closers in the swallowed tail the depth sticks and the next `let`
    // silently stays local - this is the harmful shape
    const swallowed = transformSetupScript(
      `items.forEach(item => { if (item.ok) /a\\//.test(item.s) && mark(item) })\nlet flag = true`
    )
    expect(swallowed.vars).toEqual([])
    expect(swallowed.code).toContain("let flag = true")

    // with a bracket-balanced tail the same misread costs nothing
    const balanced = transformSetupScript(`if (ok) /a\\//.test(s) && go()\nlet after = 1`)
    expect(balanced.vars).toEqual(["after"])
    expect(balanced.code).toBe(`if (ok) /a\\//.test(s) && go()\nafter = 1`)
  })

  it("survives the lookback landing on a comment's last word", () => {
    // the backward scan can't tell a line comment's tail from code, so
    // "return" up there admits a "regex" that is really a division - but
    // skipRegex bails at the line end, the text is copied verbatim, and the
    // output comes out correct anyway: radius zero in this shape
    const { vars, code } = transformSetupScript(`$: half = a // never return\n  / 2\nlet after = 1`)

    expect(vars).toEqual(["half", "after"])
    expect(code).toBe(`$__effect(() => { half = a // never return\n  / 2 });\nafter = 1`)
  })

  it("does not rescue `for (x of /re/)`, because `of` may be a variable", () => {
    // the price of the gap: iterating a regex (nonsense anyway) misreads
    const gap = transformSetupScript(`for (const m of /a\\//.exec(s)) use(m)\nlet after = 1`)
    expect(gap.vars).toEqual([])

    // what keeping `of` off the reserved list buys: `of` as a plain
    // variable, dividing like any other name
    const paid = transformSetupScript(`const of = 4\nlet r = of / 2`)
    expect(paid.vars).toEqual(["of", "r"])
    expect(paid.code).toBe(`of = 4\nr = of / 2`)
  })
})

// boundaries that already hold and that any scanner change must not disturb -
// notably: a blank line is NOT a statement delimiter (it legitimately lives
// inside multi-line object/array literals), so it can't serve as a recovery
// signal for the corruption above
describe("boundaries a scanner fix must respect", () => {
  it("keeps a blank line inside an open bracket from ending the statement", () => {
    const { code } = transformSetupScript(`$: config = {\n  a: 1,\n\n  b: 2,\n}\nlet after = 1`)

    expect(code).toBe(`$__effect(() => { config = {\n  a: 1,\n\n  b: 2,\n} });\nafter = 1`)
  })

  it("keeps `//` inside a string from starting a comment", () => {
    const { vars, code } = transformSetupScript(`let url = "https://x.com"\nlet after = 1`)

    expect(vars).toEqual(["url", "after"])
    expect(code).toBe(`url = "https://x.com"\nafter = 1`)
  })

  it("walks nested template literals without losing depth", () => {
    // skipString ends at the *inner* opening backtick, so the interpolation
    // is scanned as code - it balances out today, and must keep doing so
    const { vars, code } = transformSetupScript("let msg = `${ok ? `yes` : `no`}`\nlet after = 1")

    expect(vars).toEqual(["msg", "after"])
    expect(code).toBe("msg = `${ok ? `yes` : `no`}`\nafter = 1")
  })

  it("hands a trailing-operator line to the engine as it stands", () => {
    // trailing operators are outside the continuation contract (chains are
    // written leading-dot/leading-operator, as the docs show): the statement
    // ends at the newline and the engine reports whatever is wrong with the
    // pieces. Pinned here because a comment after the dangling `+` also eats
    // the injected `});` - if the contract ever changes, this is the case
    const { code } = transformSetupScript(`$: sum = a + // parts\n  b`)

    expect(code).toBe(`$__effect(() => { sum = a + // parts });\n  b`)
  })

  it("keeps a for-header `let` as the loop-local it is", () => {
    // depth 1 inside the parens: the declaration rewrite must not reach it
    const { vars, code } = transformSetupScript(`for (let i = 0; i < 3; i++) log(i)\nlet after = 1`)

    expect(vars).toEqual(["after"])
    expect(code).toBe(`for (let i = 0; i < 3; i++) log(i)\nafter = 1`)
  })

  it("rewrites a destructuring declaration into a reactive assignment pattern", () => {
    // `([a, b] = pair)` inside `with` writes both bindings through the scope
    // proxy; the `;` keeps the `(` from gluing onto the previous line
    const { vars, code } = transformSetupScript(`let [a, b] = pair\nlet after = 1`)

    expect(vars).toEqual(["a", "b", "after"])
    expect(code).toBe(`;([a, b] = pair)\nafter = 1`)
  })

  it("registers every name of a multi-declarator statement", () => {
    const { vars, code } = transformSetupScript(`let a = 1, b = 2\nlet after = 1`)

    expect(vars).toEqual(["a", "b", "after"])
    expect(code).toBe(`a = 1, b = 2\nafter = 1`)
  })

  it("ignores declarations hidden in a block comment", () => {
    const { vars, code } = transformSetupScript(`/* let hidden = 1 */\nlet real = 2`)

    expect(vars).toEqual(["real"])
    expect(code).toBe(`/* let hidden = 1 */\nreal = 2`)
  })

  it("wraps a `$:` member assignment as an effect without declaring a var", () => {
    const { vars, code } = transformSetupScript(`$: user.name = fullName.split(" ")[0]`)

    expect(vars).toEqual([])
    expect(code).toBe(`$__effect(() => { user.name = fullName.split(" ")[0] });`)
  })

  it("wraps a compound assignment without declaring its target", () => {
    // `+=` is not the declaring form (`=` alone is): the effect still wraps
    const { vars, code } = transformSetupScript(`$: count += step`)

    expect(vars).toEqual([])
    expect(code).toBe(`$__effect(() => { count += step });`)
  })

  it("reads the compact `$:x=y` form", () => {
    const { vars, code } = transformSetupScript(`$:x=doubled`)

    expect(vars).toEqual(["x"])
    expect(code).toBe(`$__effect(() => { x=doubled });`)
  })

  it("keeps an arrow with a block body inside one `$:` statement", () => {
    const { vars, code } = transformSetupScript(`$: handler = () => { if (open) close() }\nlet after = 1`)

    expect(vars).toEqual(["handler", "after"])
    expect(code).toBe(`$__effect(() => { handler = () => { if (open) close() } });\nafter = 1`)
  })

  it("wraps a Svelte-style destructuring `$:` without declaring vars", () => {
    // `({ a, b } = obj)` assigns through the scope at runtime; no name is
    // captured because the statement doesn't start with `identifier =`
    const { vars, code } = transformSetupScript(`$: ({ a, b } = obj)\nlet after = 1`)

    expect(vars).toEqual(["after"])
    expect(code).toBe(`$__effect(() => { ({ a, b } = obj) });\nafter = 1`)
  })

  it("splits two `$:` statements sharing a line at their semicolon", () => {
    const { vars, code } = transformSetupScript(`$: a = 1; $: b = a + 1`)

    expect(vars).toEqual(["a", "b"])
    expect(code).toBe(`$__effect(() => { a = 1 });; $__effect(() => { b = a + 1 });`)
  })

  it("ends a `$:` statement at a CRLF line ending", () => {
    // the `\r` rides along inside the effect as whitespace; the next line
    // still starts a fresh statement
    const { vars, code } = transformSetupScript(`$: x = a\r\nlet after = 1`)

    expect(vars).toEqual(["x", "after"])
    expect(code).toBe(`$__effect(() => { x = a\r });\nafter = 1`)
  })

  it("passes `await` in a `$:` through for the engine to reject", () => {
    // a known limit, pinned: the effect callback is a sync arrow, so the
    // compiled script throws "await is only valid in async functions" - the
    // transform hands the statement over as written rather than guessing
    const { code } = transformSetupScript(`$: data = await fetchData()`)

    expect(code).toBe(`$__effect(() => { data = await fetchData() });`)
  })

  it("does not pre-declare an accented identifier (but no longer registers a garbage stem)", () => {
    // a known limit, pinned: the identifier regexes are ASCII (`\w`), so
    // `café` registers nothing - the emitted code is intact and the store
    // key appears on first assignment through the scope, but a template
    // reading it before that first write won't resolve the name. (It used
    // to pre-declare `caf`, which helped nobody)
    const { vars, code } = transformSetupScript(`let café = 1`)

    expect(vars).toEqual([])
    expect(code).toBe(`café = 1`)
  })
})

// the import() -> $__import rewrite: only real calls, wherever they sit
describe("the import() rewrite", () => {
  it("rewrites a call in a plain statement", () => {
    expect(transformSetupScript(`const C = await import("./x.html")`).code).toBe(
      `C = await $__import("./x.html")`
    )
  })

  it("rewrites a call inside a `$:` statement", () => {
    // the body used to be sliced into the effect raw, so an import() there
    // kept the native form - bypassing the bundler map and the .html loader
    const { code } = transformSetupScript(`$: comp = import("./x.html")`)

    expect(code).toBe(`$__effect(() => { comp = $__import("./x.html") });`)
  })

  it("leaves strings, comments, member calls and lookalike names alone", () => {
    const src = [
      `let s = "import('./a.html')"`,
      `// import("./b.html")`,
      `loader.import("./c.html")`,
      `important("./d.html")`,
    ].join("\n")
    const { code } = transformSetupScript(src)

    expect(code).not.toContain("$__import")
  })
})

describe("transformFactoryScript", () => {
  it("returns null for a script with no top-level export default", () => {
    expect(transformFactoryScript(`let count = 1\n$: doubled = count * 2`)).toBeNull()
  })

  it("does not treat `export default` inside a string or comment as a factory", () => {
    expect(transformFactoryScript(`const s = "export default x"`)).toBeNull()
    expect(transformFactoryScript(`// export default x`)).toBeNull()
  })

  it("skips comments while scanning, still finding the export default after them", () => {
    const code = transformFactoryScript(
      `// a line comment with "quotes"\n/* a block\n   comment */\nexport default () => ({ a: 1 })`
    )

    expect(code).toContain("$__exports.default = () => ({ a: 1 })")
  })

  it("rewrites a namespace import without unwrapping a default", () => {
    const code = transformFactoryScript(`import * as helpers from "./helpers.js"\nexport default (_, ctx) => helpers`)

    expect(code).toContain(`const helpers = await $__import("./helpers.js")`)
    expect(code).not.toContain("$__default(")
  })

  it("rewrites a multi-line named import, keeping its line count", () => {
    const src = `import {\n  count,\n  total\n} from "./stats.js"\nexport default (_, ctx) => count + total`
    const code = transformFactoryScript(src)!

    expect(code).toContain(`const {\n  count,\n  total\n} = await $__import("./stats.js")`)
    expect(code.split("\n").length).toBe(src.split("\n").length)
  })

  it("rewrites a mixed default + namespace clause through one shared module", () => {
    const code = transformFactoryScript(`import Card, * as extras from "./card.js"\nexport default (_, ctx) => Card`)

    expect(code).toContain(
      `const $__mod0 = await $__import("./card.js"), Card = $__default($__mod0), extras = $__mod0`
    )
  })

  it("rewrites a side-effect import (no clause) into a bare await", () => {
    const code = transformFactoryScript(`import "./styles.css"\nexport default () => ({})`)

    expect(code).toContain(`await $__import("./styles.css")`)
    expect(code).not.toContain("const  =")
  })
})

describe("parsePropsPattern", () => {
  it("reads names and defaults", () => {
    expect(parsePropsPattern("{ label = 'Total', step = 1, user }")).toEqual([
      { name: "label", default: "'Total'" },
      { name: "step", default: "1" },
      { name: "user" },
    ])
  })

  it("declares nothing when the pattern isn't an object one", () => {
    expect(parsePropsPattern("_")).toBeNull()
    expect(parsePropsPattern("props")).toBeNull()
    expect(parsePropsPattern(undefined)).toBeNull()
    expect(parsePropsPattern("")).toBeNull()
  })

  it("reads `{}` as a closed signature: zero props, not an absent one", () => {
    expect(parsePropsPattern("{}")).toEqual([])
  })

  it("splits on commas the default values own", () => {
    expect(parsePropsPattern("{ items = [1, 2], fn = (a, b) => a + b, text = 'a, b' }")).toEqual([
      { name: "items", default: "[1, 2]" },
      { name: "fn", default: "(a, b) => a + b" },
      { name: "text", default: "'a, b'" },
    ])
  })

  it("keeps a division default as code and reads the `=` past a regex one", () => {
    // `total / 2` must not be mistaken for a regex; the `=` inside `/a=b/`
    // must not be mistaken for the default's own
    expect(parsePropsPattern(`{ half = total / 2, eq = /a=b/ }`)).toEqual([
      { name: "half", default: "total / 2" },
      { name: "eq", default: "/a=b/" },
    ])
  })

  it("keeps a comment from closing the pattern early", () => {
    // the `}` inside the comment must not end the pattern: `b` used to
    // vanish and `a`'s default came back truncated as "1 /*"
    expect(parsePropsPattern(`{ a = 1 /* } */, b = 2 }`)).toEqual([
      { name: "a", default: "1 /* } */" },
      { name: "b", default: "2" },
    ])
  })

  it("stops at the pattern's own brace, ignoring a parameter default", () => {
    expect(parsePropsPattern("{ label = 'Total' } = {}")).toEqual([{ name: "label", default: "'Total'" }])
  })

  it("names the key, whatever the pattern binds it to", () => {
    expect(parsePropsPattern("{ user: renamed, config: { theme }, ...rest }")).toEqual([
      { name: "user" },
      { name: "config" },
    ])
  })
})

describe("parseFactoryProps", () => {
  it("reads the first parameter, not the ctx", () => {
    expect(parseFactoryProps(`export default ({ label = "Total" }, { $data }) => {}`)).toEqual([
      { name: "label", default: '"Total"' },
    ])
  })

  it("reads an async factory, and a function-expression one", () => {
    expect(parseFactoryProps(`export default async ({ user }) => {}`)).toEqual([{ name: "user" }])
    expect(parseFactoryProps(`export default function ({ user }, ctx) {}`)).toEqual([{ name: "user" }])
  })

  it("keeps a comment from closing the parameter list early", () => {
    // the `)` inside the comment must not end the list
    expect(parseFactoryProps(`export default ({ retries = 3 /* ) */ }, ctx) => retries`)).toEqual([
      { name: "retries", default: "3 /* ) */" },
    ])
  })

  it("reads a regex default in the first parameter, comma included", () => {
    // the comma inside /,/ must not split the parameter list or the pattern
    expect(parseFactoryProps(`export default ({ sep = /,/, label = "x" }, { $data }) => sep`)).toEqual([
      { name: "sep", default: "/,/" },
      { name: "label", default: `"x"` },
    ])
  })

  it("declares nothing when the first parameter isn't a pattern", () => {
    expect(parseFactoryProps(`export default (_, { $data }) => {}`)).toBeNull()
    expect(parseFactoryProps(`export default () => ({})`)).toBeNull()
    expect(parseFactoryProps(`const f = () => {}\nexport default f`)).toBeNull()
    expect(parseFactoryProps(`let count = 1`)).toBeNull()
  })

  it("throws the migration error when the ctx is destructured as the first parameter", () => {
    expect(() => parseFactoryProps(`export default ({ $data, $effect }) => {}`))
      .toThrow(/the factory signature is \(props, ctx\)/)
  })
})

// destructuring declarations: rewritten into assignment patterns, which is
// what makes their bindings reactive inside `with` - see the plan in
// TODOS/2026-07-15.setup-destructuring.md
describe("setup script scanner on destructuring declarations", () => {
  it("rewrites an object pattern and registers its bindings", () => {
    const { vars, code } = transformSetupScript(`let { a, b } = obj`)

    expect(vars).toEqual(["a", "b"])
    expect(code).toBe(`;({ a, b } = obj)`)
  })

  it("rewrites an array pattern and registers its bindings", () => {
    const { vars, code } = transformSetupScript(`const [x, y] = pair`)

    expect(vars).toEqual(["x", "y"])
    expect(code).toBe(`;([x, y] = pair)`)
  })

  it("registers the *bound* names of renamed, nested and defaulted entries", () => {
    // `{ a: x }` binds x, `{ b: { c } }` binds c, `{ d = 1 }` binds d - the
    // keys stay keys; only bindings become store variables
    const { vars, code } = transformSetupScript(`let { a: x, b: { c }, d = 1, ...rest } = obj`)

    expect(vars).toEqual(["x", "c", "d", "rest"])
    expect(code).toBe(`;({ a: x, b: { c }, d = 1, ...rest } = obj)`)
  })

  it("handles a pattern glued to the keyword", () => {
    const { vars, code } = transformSetupScript(`const{ a } = obj`)

    expect(vars).toEqual(["a"])
    expect(code).toBe(`;({ a } = obj)`)
  })

  it("mixes identifier and pattern declarators in one statement", () => {
    // starts with an identifier, so no leading `;` is needed
    const { vars, code } = transformSetupScript(`let a = 1, { b } = obj`)

    expect(vars).toEqual(["a", "b"])
    expect(code).toBe(`a = 1, ({ b } = obj)`)
  })

  it("keeps a multi-line declarator list whole across its trailing commas", () => {
    // a line ending in `,` can't end a statement - the same ASI call the
    // scanner already made for leading tokens, now made from the other side
    const { vars, code } = transformSetupScript(`let a = 1,\n    b = 2\nlet after = 3`)

    expect(vars).toEqual(["a", "b", "after"])
    expect(code).toBe(`a = 1,\n    b = 2\nafter = 3`)
  })

  it("closes the pattern's paren before a trailing line comment", () => {
    const { vars, code } = transformSetupScript(`let { a } = obj // note`)

    expect(vars).toEqual(["a"])
    expect(code).toBe(`;({ a } = obj) // note`)
  })

  it("rewrites an import() inside a declarator's initializer", () => {
    const { vars, code } = transformSetupScript(`const { mount } = await import("./widget.html")`)

    expect(vars).toEqual(["mount"])
    expect(code).toBe(`;({ mount } = await $__import("./widget.html"))`)
  })

  it("copies a template literal with nested backticks through unchanged", () => {
    // skipString stops at the first unescaped backtick, so the nested parts
    // alternate string/code - the content survives by parity, and this test
    // holds that: nothing inside may be rewritten
    const src = "const s = `a ${ok ? `x` : `y`} c`\nlet z = 1"
    const { vars, code } = transformSetupScript(src)

    expect(vars).toEqual(["s", "z"])
    expect(code).toBe("s = `a ${ok ? `x` : `y`} c`\nz = 1")
  })
})
