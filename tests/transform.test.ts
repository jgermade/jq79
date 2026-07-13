import { describe, it, expect } from "vitest"
import { transformSetupScript, transformFactoryScript } from "../src/transform"

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
