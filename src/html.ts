// ---------------------------------------------------------------------------
// an HTML tree without a DOM
//
// precompile() has to read a component where there is no DOMParser - on node,
// for the Vite plugin, and in a service worker - and find every attribute and
// every text node the runtime's own parse finds. This builds that tree:
// elements with their attributes and children, and text decoded the way the
// HTML parser decodes it.
//
// It is not a conforming HTML parser and doesn't try to be. What precompile
// reads is *which* attributes and texts exist, and wherever the real parser
// would put one somewhere else - an implied end tag, a table's foster parent -
// it still exists. The places where it would read a different *value* are the
// ones that matter, and those it follows:
// - newlines normalized first (CRLF and a lone CR are LF), as the input stream is
// - character references decoded in text and attribute values, with the
//   attribute rule for a legacy reference with no semicolon
// - <html>, <head> and <body> dropped, as a template drops them
// - attribute names lowercased, and the first of two duplicates kept
// - <script>/<style> (and the other raw text elements) read verbatim to their
//   end tag, <textarea>/<title> decoded but never parsed for tags
// - comments dropped, and the text on either side kept as two texts
//
// tests/precompile.test.ts holds it against DOMParser, tree for tree
// ---------------------------------------------------------------------------

export type HTMLElementNode = { tag: string; attrs: Record<string, string>; children: HTMLNode[] }
export type HTMLNode = HTMLElementNode | string

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

// the document's own structure, which a template can't hold: inside one the
// parser drops these tags, start and end, and keeps what they wrapped
const DOCUMENT_TAGS = new Set(["html", "head", "body"])

// read verbatim up to their end tag - and, for the escapable two, decoded
const RAW_TEXT_TAGS = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes"])
const ESCAPABLE_RAW_TEXT_TAGS = new Set(["textarea", "title"])

// the named references a component plausibly writes. The HTML table has over
// two thousand; one missing here leaves its text undecoded, and that is a
// precompiled function under a key the runtime never asks for - which safe
// mode reports by name, rather than a wrong function running
const NAMED_REFERENCES: Record<string, string> = {
  apos: "'", trade: "\u2122", hellip: "\u2026", mdash: "\u2014", ndash: "\u2013",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", bull: "\u2022", euro: "\u20ac",
  larr: "\u2190", rarr: "\u2192", uarr: "\u2191", darr: "\u2193", check: "\u2713",
  lbrace: "{", rbrace: "}", lcub: "{", rcub: "}", lpar: "(", rpar: ")", lsqb: "[", rsqb: "]",
  colon: ":", comma: ",", period: ".", semi: ";", excl: "!", quest: "?", num: "#", dollar: "$",
  percnt: "%", ast: "*", plus: "+", equals: "=", sol: "/", bsol: "\\", verbar: "|", vert: "|",
  grave: "`", Hat: "^", lowbar: "_", commat: "@", Tab: "\t", NewLine: "\n",
}

// the references that also decode without their semicolon - the web before
// HTML required one - which is the whole of this list, from the standard: the
// five markup ones in both cases, and Latin-1's 96, U+00A0 to U+00FF in order.
// A name that isn't a reference is read as the longest of these it starts
// with (`&notareference;` is `¬areference;`), so all of them are needed to
// read what the parser reads
const LATIN_1 = (
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 " +
  "acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml " +
  "Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde " +
  "Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig " +
  "ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide " +
  "oslash ugrave uacute ucirc uuml yacute thorn yuml"
).split(" ")
const LEGACY_REFERENCES: Record<string, string> = {
  amp: "&", AMP: "&", lt: "<", LT: "<", gt: ">", GT: ">", quot: "\"", QUOT: "\"", COPY: "\u00a9", REG: "\u00ae",
  ...Object.fromEntries(LATIN_1.map((name, i) => [name, String.fromCharCode(0xa0 + i)])),
}
// longest first, so `&sup2` is ² and not "sup" plus a 2
const LEGACY_NAMES = Object.keys(LEGACY_REFERENCES).sort((a, b) => b.length - a.length)

const has = (table: Record<string, string>, name: string) => Object.prototype.hasOwnProperty.call(table, name)

const fromCodePoint = (code: number): string =>
  code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? "�" : String.fromCodePoint(code)

const CHARACTER_REFERENCE_RE = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]*;?)/g
const ALPHANUMERIC_RE = /[A-Za-z0-9]/

// In an attribute a legacy reference with no semicolon stays literal when the
// next character is `=` or alphanumeric - `?a=1&copy=2` is a query string, not
// a copyright sign. In text it decodes, and what follows the name stays
const decode = (text: string, inAttribute: boolean): string => {
  if (!text.includes("&")) return text
  return text.replace(CHARACTER_REFERENCE_RE, (whole: string, ref: string, offset: number) => {
    if (ref[0] === "#") {
      const hex = ref[1] === "x" || ref[1] === "X"
      const digits = ref.slice(hex ? 2 : 1).replace(/;$/, "")
      return fromCodePoint(parseInt(digits, hex ? 16 : 10))
    }
    const semicolon = ref.endsWith(";")
    const name = semicolon ? ref.slice(0, -1) : ref
    if (semicolon && has(LEGACY_REFERENCES, name)) return LEGACY_REFERENCES[name]
    if (semicolon && has(NAMED_REFERENCES, name)) return NAMED_REFERENCES[name]
    const legacy = LEGACY_NAMES.find(candidate => name.startsWith(candidate))
    if (legacy === undefined) return whole
    const after = name.length > legacy.length ? name[legacy.length] : semicolon ? ";" : text[offset + whole.length]
    if (inAttribute && after !== undefined && (after === "=" || ALPHANUMERIC_RE.test(after))) return whole
    return LEGACY_REFERENCES[legacy] + ref.slice(legacy.length)
  })
}

const TAG_NAME_RE = /[^\s/>]*/y
const ATTRIBUTE_NAME_RE = /[^\s/>][^\s/>=]*/y
const WHITESPACE_RE = /\s*/y
const UNQUOTED_VALUE_RE = /[^\s>]*/y
const END_TAG_RE = /<\/([A-Za-z][^\s/>]*)[^>]*>/y

// runs a sticky pattern at `at` and answers with the match (or "")
const readAt = (re: RegExp, src: string, at: number): string => {
  re.lastIndex = at
  return re.exec(src)?.[0] ?? ""
}

// where a raw text element's content ends: its own end tag, whatever the case,
// followed by what can end a tag name
const rawTextEnd = (src: string, from: number, tag: string): number => {
  const re = new RegExp(`</${tag}(?=[\\s/>])`, "gi")
  re.lastIndex = from
  const match = re.exec(src)
  return match ? match.index : src.length
}

// the element children of a comment are nothing, and the texts on either side
// of it stay two texts - a comment is a node in the DOM, which is what keeps
// them apart. A marker holds its place while the tree is built
const COMMENT = null

type BuildNode = { tag: string; attrs: Record<string, string>; children: (BuildNode | string | null)[] }

const finish = (node: BuildNode): HTMLElementNode => ({
  tag: node.tag,
  attrs: node.attrs,
  children: node.children.flatMap((child): HTMLNode[] =>
    child === COMMENT ? [] : typeof child === "string" ? (child ? [child] : []) : [finish(child)]
  ),
})

export const parseHTML = (input: string): HTMLNode[] => {
  const src = input.replace(/\r\n?/g, "\n")
  const root: BuildNode = { tag: "#root", attrs: {}, children: [] }
  const stack: BuildNode[] = [root]
  const current = () => stack[stack.length - 1]
  // inside <svg> or <math> a `/>` closes the element - in HTML it is ignored
  let foreignDepth = 0

  const appendText = (text: string) => {
    if (!text) return
    const children = current().children
    const last = children[children.length - 1]
    if (typeof last === "string") children[children.length - 1] = last + text
    else children.push(text)
  }

  const close = (tag: string) => {
    for (let depth = stack.length - 1; depth > 0; depth--) {
      if (stack[depth].tag !== tag) continue
      for (let popped = stack.length - 1; popped >= depth; popped--) {
        if (stack[popped].tag === "svg" || stack[popped].tag === "math") foreignDepth--
      }
      stack.length = depth
      return
    }
  }

  let at = 0
  while (at < src.length) {
    const lt = src.indexOf("<", at)
    if (lt === -1) {
      appendText(decode(src.slice(at), false))
      break
    }
    appendText(decode(src.slice(at, lt), false))
    at = lt

    // a comment - `<!-->` and `<!--->` are complete, empty ones
    if (src.startsWith("<!--", at)) {
      current().children.push(COMMENT)
      if (src.startsWith(">", at + 4)) at += 5
      else if (src.startsWith("->", at + 4)) at += 6
      else {
        const end = src.indexOf("-->", at + 4)
        at = end === -1 ? src.length : end + 3
      }
      continue
    }
    // a doctype leaves no node at all - so the texts around it are one text -
    // and a CDATA section or a processing instruction is a (bogus) comment
    if (src[at + 1] === "!" || src[at + 1] === "?") {
      const end = src.indexOf(">", at)
      if (!/^<!doctype/i.test(src.slice(at, at + 9))) current().children.push(COMMENT)
      at = end === -1 ? src.length : end + 1
      continue
    }
    if (src[at + 1] === "/") {
      END_TAG_RE.lastIndex = at
      const end = END_TAG_RE.exec(src)
      if (end) {
        if (!DOCUMENT_TAGS.has(end[1].toLowerCase())) close(end[1].toLowerCase())
        at = END_TAG_RE.lastIndex
      } else {
        // `</>` is dropped, and `</ anything>` is a bogus comment
        const gt = src.indexOf(">", at)
        at = gt === -1 ? src.length : gt + 1
      }
      continue
    }
    if (!/[A-Za-z]/.test(src[at + 1] ?? "")) {
      appendText("<")
      at++
      continue
    }

    // a start tag
    const tag = readAt(TAG_NAME_RE, src, at + 1).toLowerCase()
    const ignored = DOCUMENT_TAGS.has(tag)
    let cursor = at + 1 + tag.length
    const attrs: Record<string, string> = {}
    let selfClosing = false
    let complete = false
    while (cursor < src.length) {
      cursor += readAt(WHITESPACE_RE, src, cursor).length
      const char = src[cursor]
      if (char === ">") { cursor++; complete = true; break }
      if (char === "/") {
        if (src[cursor + 1] === ">") { selfClosing = true; cursor += 2; complete = true; break }
        cursor++
        continue
      }
      if (char === undefined) break
      const name = readAt(ATTRIBUTE_NAME_RE, src, cursor)
      cursor += name.length
      let value = ""
      const afterName = cursor + readAt(WHITESPACE_RE, src, cursor).length
      if (src[afterName] === "=") {
        cursor = afterName + 1
        cursor += readAt(WHITESPACE_RE, src, cursor).length
        const quote = src[cursor]
        if (quote === "\"" || quote === "'") {
          const close = src.indexOf(quote, cursor + 1)
          const end = close === -1 ? src.length : close
          value = src.slice(cursor + 1, end)
          cursor = end + 1
        } else {
          value = readAt(UNQUOTED_VALUE_RE, src, cursor)
          cursor += value.length
        }
        value = decode(value, true)
      }
      const key = name.toLowerCase()
      if (!(key in attrs)) attrs[key] = value
    }
    // a tag cut off by the end of the input is dropped, as the parser drops it
    if (!complete) break
    at = cursor
    if (ignored) continue

    const node: BuildNode = { tag, attrs, children: [] }
    current().children.push(node)
    if (VOID_TAGS.has(tag)) continue
    if (selfClosing && foreignDepth > 0) continue

    if (foreignDepth === 0 && (RAW_TEXT_TAGS.has(tag) || ESCAPABLE_RAW_TEXT_TAGS.has(tag))) {
      const end = rawTextEnd(src, at, tag)
      const text = src.slice(at, end)
      node.children.push(ESCAPABLE_RAW_TEXT_TAGS.has(tag) ? decode(text, false) : text)
      const gt = src.indexOf(">", end)
      at = end === src.length || gt === -1 ? src.length : gt + 1
      continue
    }

    if (tag === "svg" || tag === "math") foreignDepth++
    stack.push(node)
  }

  return finish(root).children
}
