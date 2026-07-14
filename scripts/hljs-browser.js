// The highlighter the tutorial page loads at runtime, to color the editor and
// the solution diff as you type. Bundled into site/assets/hljs.js by
// build-site.mjs (highlight.js itself is CommonJS, so it can't be imported from
// the browser as it ships).
//
// It's the same library, and the same `hljs-*` class names, that marked-highlight
// runs over the markdown at build time - so a snippet in an exercise's prose and
// the same code in the editor come out looking identical, off one stylesheet.
//
// Only the languages an exercise can be written in are registered; the full
// bundle is an order of magnitude bigger and none of it would ever be reached.

import hljs from "highlight.js/lib/core"
import css from "highlight.js/lib/languages/css"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import xml from "highlight.js/lib/languages/xml"

// xml is what "html" resolves to, and it pulls javascript/css back in for the
// <script>/<style> blocks of a component - which is the whole point here
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("css", css)
hljs.registerLanguage("json", json)

export default hljs
