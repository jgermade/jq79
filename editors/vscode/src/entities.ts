// ---------------------------------------------------------------------------
// character references, decoded where they were written
//
// The runtime reads an attribute value or a text after the HTML parser has
// decoded it: `:if="a &amp;&amp; b"` is `a && b`, `{{ a &lt; b }}` is `a < b`.
// The checker has to see the same thing, and still say where in the file each
// character was. So a value is decoded as segments - a run the file has as is,
// or one reference and the text it decodes to - each knowing its place, with
// src/html.ts's own decoder (precompile's, held against DOMParser) deciding
// what every reference is.
// ---------------------------------------------------------------------------

import { CHARACTER_REFERENCE_RE, decodeReference } from "../../../src/html"
import type { Mapping, Writer } from "./component"

// [start, end) in the file; `text` is what it decodes to - the same text, for a
// `plain` run. `at` is where `text` starts in the decoded string
export type Segment = { start: number; end: number; text: string; at: number; plain: boolean }
export type Decoded = { text: string; segments: Segment[] }

export const decodeAt = (raw: string, offset: number, inAttribute: boolean): Decoded => {
  const segments: Segment[] = []
  let text = ""
  let from = 0
  const plain = (end: number) => {
    if (end > from) segments.push({ start: offset + from, end: offset + end, text: raw.slice(from, end), at: text.length, plain: true })
    text += raw.slice(from, end)
  }
  if (raw.includes("&")) {
    for (const match of raw.matchAll(CHARACTER_REFERENCE_RE)) {
      const decoded = decodeReference(raw, match[0], match[1], match.index!, inAttribute)
      if (decoded === match[0]) continue
      plain(match.index!)
      segments.push({ start: offset + match.index!, end: offset + match.index! + match[0].length, text: decoded, at: text.length, plain: false })
      text += decoded
      from = match.index! + match[0].length
    }
  }
  plain(raw.length)
  return { text, segments }
}

// the decoded [from, to) of a value, written into `out` and mapped back: a plain
// run as a copy, a reference as its text mapped onto the whole reference - so
// an error on the `&` of `a &amp;&amp; b` lands on `&amp;`
export const copyDecoded = (out: Writer, decoded: Decoded, data: Mapping["data"], from = 0, to = decoded.text.length) => {
  for (const segment of decoded.segments) {
    const start = Math.max(from, segment.at)
    const end = Math.min(to, segment.at + segment.text.length)
    if (end <= start) continue
    if (segment.plain) {
      out.copy(segment.start + (start - segment.at), segment.start + (end - segment.at), data)
    } else if (start === segment.at && end === segment.at + segment.text.length) {
      out.mapText(segment.start, segment.end, segment.text, data)
    } else {
      out.text(segment.text.slice(start - segment.at, end - segment.at))
    }
  }
}
