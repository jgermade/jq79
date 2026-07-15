
import { describe, it, expect, beforeEach } from "vitest"
import { $, $$, $create } from "../src/jq79"
import { isSafeUrl, sanitizeHTML } from "../src/dom"

describe("$", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="root">
        <span class="item">a</span>
        <span class="item">b</span>
      </div>
    `
  })

  it("queries the document when given a selector string", () => {
    expect($("#root")).not.toBeNull()
    expect($("#root")?.tagName).toBe("DIV")
  })

  it("returns null when a selector string matches nothing", () => {
    expect($("#missing")).toBeNull()
  })

  it("queries within an element when given an element + selector", () => {
    const root = document.getElementById("root")!
    expect($(root, ".item")?.textContent).toBe("a")
  })
})

describe("$$", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="root">
        <span class="item">a</span>
        <span class="item">b</span>
      </div>
    `
  })

  it("returns an array of all matches for a selector string", () => {
    const items = $$(".item")
    expect(Array.isArray(items)).toBe(true)
    expect(items).toHaveLength(2)
  })

  it("returns an empty array when nothing matches", () => {
    expect($$(".missing")).toEqual([])
  })

  it("returns matches scoped to an element when given an element + selector", () => {
    const root = document.getElementById("root")!
    const items = $$(root, ".item")
    expect(items).toHaveLength(2)
    expect(items.map(el => el.textContent)).toEqual(["a", "b"])
  })
})

describe("$create", () => {
  it("creates an element with plain attributes", () => {
    const el = $create("a", { href: "/x", title: "go" })
    expect(el.tagName).toBe("A")
    expect(el.getAttribute("href")).toBe("/x")
    expect(el.getAttribute("title")).toBe("go")
  })

  it("accepts className as a string", () => {
    const el = $create("div", { className: "a" })
    expect(el.className).toBe("a")
  })

  it("accepts className as an array of class names", () => {
    const el = $create("div", { className: ["a", "b"] })
    expect(el.className).toBe("a b")
  })

  it("sets textContent", () => {
    const el = $create("span", { textContent: "hi" })
    expect(el.textContent).toBe("hi")
  })

  it("appends children", () => {
    const child1 = $create("span", { textContent: "1" })
    const child2 = $create("span", { textContent: "2" })
    const el = $create("div", { children: [child1, child2] })
    expect(Array.from(el.children)).toEqual([child1, child2])
  })

  it("creates an element with no attrs", () => {
    const el = $create("div")
    expect(el.tagName).toBe("DIV")
    expect(el.attributes).toHaveLength(0)
  })
})

describe("isSafeUrl", () => {
  it("allows http, https and mailto URLs", () => {
    expect(isSafeUrl("http://example.com")).toBe(true)
    expect(isSafeUrl("https://example.com/path")).toBe(true)
    expect(isSafeUrl("mailto:a@example.com")).toBe(true)
  })

  it("allows protocol-relative and relative URLs (resolved as http/https)", () => {
    expect(isSafeUrl("/relative/path")).toBe(true)
    expect(isSafeUrl("//example.com/x")).toBe(true)
  })

  it("rejects javascript: and other unsafe protocols", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false)
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false)
  })

  it("rejects unparseable URLs", () => {
    expect(isSafeUrl("http://[")).toBe(false)
  })
})

describe("sanitizeHTML", () => {
  it("keeps allowed tags and text content", () => {
    expect(sanitizeHTML("<p>hello <b>world</b></p>")).toBe("<p>hello <b>world</b></p>")
  })

  it("keeps top-level text nodes alongside elements", () => {
    expect(sanitizeHTML("before <b>bold</b> after")).toBe("before <b>bold</b> after")
  })

  it("strips disallowed tags entirely, including their content markup", () => {
    expect(sanitizeHTML('<p>safe</p><script>evil()</script>')).toBe("<p>safe</p>")
  })

  it("drops disallowed attributes but keeps the element", () => {
    expect(sanitizeHTML('<p onclick="evil()">hi</p>')).toBe("<p>hi</p>")
  })

  it("keeps class as a global attribute on any allowed tag", () => {
    expect(sanitizeHTML('<p class="note">hi</p>')).toBe('<p class="note">hi</p>')
  })

  it("keeps safe href/src and drops unsafe ones", () => {
    expect(sanitizeHTML('<a href="https://example.com">link</a>')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer">link</a>'
    )
    expect(sanitizeHTML('<a href="javascript:evil()">link</a>')).toBe(
      '<a rel="noopener noreferrer">link</a>'
    )
    expect(sanitizeHTML('<img src="https://example.com/x.png">')).toBe(
      '<img src="https://example.com/x.png">'
    )
    expect(sanitizeHTML('<img src="javascript:evil()">')).toBe("<img>")
  })

  it("forces a safe rel on links and strips target", () => {
    expect(sanitizeHTML('<a href="https://example.com" target="_blank">link</a>')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer">link</a>'
    )
  })

  it("recursively sanitizes nested children", () => {
    expect(sanitizeHTML('<div><script>evil()</script><p onclick="evil()">ok</p></div>')).toBe(
      "<div><p>ok</p></div>"
    )
  })

  it("discards HTML comments", () => {
    expect(sanitizeHTML("<p>hi<!-- comment --></p>")).toBe("<p>hi</p>")
  })
})

// classic sanitizer-evasion payloads, pinned as regression tests: mutation
// vectors that abuse parser namespace switches (math/svg), raw-text elements
// (noscript), and URL obfuscation. The sanitizer's defense is structural -
// disallowed tags are dropped whole, attributes are read post-parse (entities
// already decoded) and URLs are judged by their parsed protocol - and these
// tests hold that line
describe("sanitizeHTML against evasion and mutation payloads", () => {
  it("drops math-namespace mutation vectors whole", () => {
    expect(sanitizeHTML(
      `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>hola`
    )).toBe("hola")
  })

  it("drops svg-namespace script smuggling whole", () => {
    expect(sanitizeHTML(`<svg><script>alert(1)</script></svg>after`)).toBe("after")
  })

  it("defuses the noscript raw-text escape", () => {
    const out = sanitizeHTML(`<noscript><p title="</noscript><img src=x onerror=alert(1)>">x</p></noscript>`)
    expect(out).not.toContain("onerror")
    expect(out).not.toContain("noscript")
  })

  it("rejects entity-encoded javascript: hrefs (entities are decoded before the check)", () => {
    expect(sanitizeHTML(`<a href="&#106;avascript:alert(1)">x</a>`)).toBe(
      '<a rel="noopener noreferrer">x</a>'
    )
  })

  it("rejects javascript: split by whitespace control characters", () => {
    expect(sanitizeHTML(`<a href="jav\tascript:alert(1)">x</a>`)).toBe(
      '<a rel="noopener noreferrer">x</a>'
    )
    expect(sanitizeHTML(`<a href=" javascript:alert(1)">x</a>`)).toBe(
      '<a rel="noopener noreferrer">x</a>'
    )
  })

  it("rejects mixed-case protocols, and normalizes uppercase tags/attributes", () => {
    expect(sanitizeHTML(`<A HREF="JaVaScRiPt:alert(1)" ONCLICK="x()">x</A>`)).toBe(
      '<a rel="noopener noreferrer">x</a>'
    )
    expect(sanitizeHTML(`<A HREF="https://ok.com">x</A>`)).toBe(
      '<a href="https://ok.com" rel="noopener noreferrer">x</a>'
    )
  })

  it("rejects data: URLs in img src", () => {
    expect(sanitizeHTML(`<img src="data:image/svg+xml,<svg onload=alert(1)>">`)).toBe("<img>")
  })

  it("allows protocol-relative URLs - they resolve to https", () => {
    // a decision, not an oversight: //host resolves under the page's scheme,
    // which the safe-protocol list already admits
    expect(sanitizeHTML(`<a href="//evil.com/x">x</a>`)).toBe(
      '<a href="//evil.com/x" rel="noopener noreferrer">x</a>'
    )
  })

  it("survives deeply nested input without blowing the stack", () => {
    const depth = 500
    const out = sanitizeHTML("<b>".repeat(depth) + "x" + "</b>".repeat(depth))
    expect(out.startsWith("<b><b>")).toBe(true)
    expect(out).toContain("x")
  })
})
