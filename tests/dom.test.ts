
import { describe, it, expect, beforeEach } from "vitest"
import { $, $$, $create } from "../src/jq79"
import { isSafeUrl, sanitizeHTML, allowedHosts } from "../src/dom"

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

  it("preserves leading whitespace (a full-document parse would drop it)", () => {
    expect(sanitizeHTML("    indented <b>x</b>")).toBe("    indented <b>x</b>")
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

  it("survives input nested up to the 512 the browser parser tolerates", () => {
    const depth = 500
    const out = sanitizeHTML("<b>".repeat(depth) + "x" + "</b>".repeat(depth))
    expect(out.startsWith("<b><b>")).toBe(true)
    expect(out).toContain("x")
  })

  it("throws a named RangeError beyond 512 levels, instead of an incidental stack overflow", () => {
    const depth = 600
    const html = "<b>".repeat(depth) + "x" + "</b>".repeat(depth)
    expect(() => sanitizeHTML(html)).toThrow(RangeError)
    expect(() => sanitizeHTML(html)).toThrow(/nests deeper than 512/)
  })
})

// the destination policy: host patterns compiled by allowedHosts, consulted
// by sanitizeHTML through the allowUrl option - always on top of the
// protocol check, never instead of it. See TODOS/2026-07-15.html-allowed.md
describe("allowedHosts", () => {
  const url = (u: string) => new URL(u)

  it("`*` matches exactly one dns label - the TLS wildcard rule, not CSP's any-depth", () => {
    const allow = allowedHosts("*.germade.dev")

    expect(allow(url("https://a.germade.dev/x"), "a", "href")).toBe(true)
    expect(allow(url("https://germade.dev/x"), "a", "href")).toBe(false)
    expect(allow(url("https://a.b.germade.dev/x"), "a", "href")).toBe(false)
    expect(allow(url("https://evilgermade.dev/x"), "a", "href")).toBe(false)
  })

  it("a literal host matches only itself, case-insensitively", () => {
    const allow = allowedHosts("germade.dev")

    expect(allow(url("https://germade.dev/"), "a", "href")).toBe(true)
    expect(allow(url("https://GERMADE.dev/"), "a", "href")).toBe(true)
    expect(allow(url("https://a.germade.dev/"), "a", "href")).toBe(false)
  })

  it("no port means any port; an explicit port must match the *effective* one", () => {
    expect(allowedHosts("germade.dev")(url("https://germade.dev:8443/"), "a", "href")).toBe(true)
    // the scheme's default port counts as the effective port
    expect(allowedHosts("germade.dev:443")(url("https://germade.dev/"), "a", "href")).toBe(true)
    expect(allowedHosts("germade.dev:443")(url("https://germade.dev:8443/"), "a", "href")).toBe(false)
    expect(allowedHosts("germade.dev:*")(url("https://germade.dev:8443/"), "a", "href")).toBe(true)
  })

  it("a comma-separated string and an array are equivalent", () => {
    const fromString = allowedHosts("*.germade.dev, *.germade.es")
    const fromArray = allowedHosts(["*.germade.dev", "*.germade.es"])

    for (const candidate of ["https://a.germade.dev/", "https://b.germade.es/", "https://evil.com/"]) {
      expect(fromString(url(candidate), "a", "href")).toBe(fromArray(url(candidate), "a", "href"))
    }
    expect(fromString(url("https://b.germade.es/"), "a", "href")).toBe(true)
  })

  it("an invalid pattern matches nothing (fails closed)", () => {
    expect(allowedHosts("germade dev")(url("https://germade.dev/"), "a", "href")).toBe(false)
    expect(allowedHosts("")(url("https://germade.dev/"), "a", "href")).toBe(false)
  })

  it("a URL with no host (mailto:) matches no pattern", () => {
    expect(allowedHosts("*.germade.dev, germade.dev")(url("mailto:x@germade.dev"), "a", "href")).toBe(false)
  })
})

describe("sanitizeHTML with a destination policy", () => {
  it("strips href/src whose destination the policy rejects, and keeps allowed ones", () => {
    const out = sanitizeHTML(
      `<a href="https://a.germade.dev/x">ok</a>` +
      `<a href="https://evil.com/x">bad</a>` +
      `<img src="https://a.germade.dev/i.png">` +
      `<img src="https://tracker.evil.com/pixel.gif">`,
      { allowUrl: allowedHosts("*.germade.dev") }
    )

    expect(out).toContain(`href="https://a.germade.dev/x"`)
    expect(out).not.toContain("evil.com")
    expect(out).toContain(`src="https://a.germade.dev/i.png"`)
    // the rejected link survives as text, without its destination
    expect(out).toContain(`<a rel="noopener noreferrer">bad</a>`)
  })

  it("the protocol check still applies before the policy - an allow-all can't re-admit javascript:", () => {
    const out = sanitizeHTML(`<a href="javascript:evil()">x</a>`, { allowUrl: () => true })

    expect(out).toBe(`<a rel="noopener noreferrer">x</a>`)
  })

  it("a throwing predicate rejects (fails closed)", () => {
    const out = sanitizeHTML(`<a href="https://germade.dev/">x</a>`, {
      allowUrl: () => { throw new Error("boom") },
    })

    expect(out).toBe(`<a rel="noopener noreferrer">x</a>`)
  })

  it("relative URLs resolve against the page, so a same-origin policy can pass them", () => {
    const out = sanitizeHTML(`<a href="/inicio">x</a><a href="https://evil.com/">y</a>`, {
      allowUrl: allowedHosts(location.hostname),
    })

    expect(out).toContain(`href="/inicio"`)
    expect(out).not.toContain("evil.com")
  })

  it("hands the predicate the parsed URL plus the tag and attribute", () => {
    const seen: string[] = []
    sanitizeHTML(`<a href="https://x.dev/">l</a><img src="https://y.dev/i.png">`, {
      allowUrl: (url, tag, attr) => { seen.push(`${tag}.${attr}=${url.hostname}`); return true },
    })

    expect(seen).toEqual(["a.href=x.dev", "img.src=y.dev"])
  })
})
