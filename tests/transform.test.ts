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
