
import { describe, it, expect } from "vitest"
import { parseComponent } from "../src/jq79"

describe("parseComponent", () => {
  const component = `
    <script :setup="{ fname, lname }">
      const fullName = \`\${fname} \${lname}\`
    </script>

    <div :attrs="{ fullName }"></div>
    <div class="full-name">
      {{ fullName }}
    </div>

    <style>
    .full-name {
      color: red;
    }
    </style>
  `

  it("extracts scripts with their attrs and content", () => {
    const { scripts } = parseComponent(component)

    expect(scripts).toHaveLength(1)
    expect(scripts[0].attrs).toEqual({ ":setup": "{ fname, lname }" })
    expect(scripts[0].content).toContain("const fullName")
  })

  it("extracts styles with their attrs and content", () => {
    const { styles } = parseComponent(component)

    expect(styles).toHaveLength(1)
    expect(styles[0].attrs).toEqual({})
    expect(styles[0].content).toContain(".full-name")
  })

  it("builds a template AST excluding script/style tags", () => {
    const { template } = parseComponent(component)

    expect(template).toHaveLength(2)

    expect(template[0]).toEqual({
      tag: "div",
      attrs: { ":attrs": "{ fullName }" },
      children: [],
    })

    expect(template[1]).toEqual({
      tag: "div",
      attrs: { class: "full-name" },
      children: ["\n      {{ fullName }}\n    "],
    })
  })

  // a template is HTML: the whitespace between two elements is the space the
  // browser renders between them, so the AST keeps it and CSS decides its worth
  it("recurses into nested elements, keeping the whitespace between them", () => {
    const { template } = parseComponent(`
      <ul>
        <li>one</li>
        <li>two</li>
      </ul>
    `)

    expect(template).toEqual([
      {
        tag: "ul",
        attrs: {},
        children: [
          "\n        ",
          { tag: "li", attrs: {}, children: ["one"] },
          "\n        ",
          { tag: "li", attrs: {}, children: ["two"] },
          "\n      ",
        ],
      },
    ])
  })

  it("returns empty collections for a component with no scripts/styles", () => {
    const { scripts, styles } = parseComponent("<div>just a div</div>")

    expect(scripts).toEqual([])
    expect(styles).toEqual([])
  })

  it("drops comment nodes from the template AST", () => {
    const { template } = parseComponent(`<div><!-- a note --><span>text</span></div>`)

    expect(template).toEqual([
      { tag: "div", attrs: {}, children: [{ tag: "span", attrs: {}, children: ["text"] }] },
    ])
  })
})
