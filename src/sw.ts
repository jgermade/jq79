// ---------------------------------------------------------------------------
// jq79-sw.js: the service worker behind `await Component79.safeEval()`
//
// A page with no bundler and a CSP without 'unsafe-eval' still needs every
// component's functions as code the browser loaded, and a CSP judges a script
// by where it came from. This worker is where: served from the site's own
// origin, it answers `/Card.html?jq79-precompiled` - a request the runtime
// makes with a <script src> - by fetching /Card.html itself and responding
// with the script that registers its precompiled functions. `script-src
// 'self'` admits it because the URL is the site's own; the .html files stay
// exactly what gets deployed and fetched (RECORD/2026-09-23.no-unsafe-eval.md).
//
// What it compiles is only ever text it fetched from its own origin: the
// request contributes a path and nothing else, and a request for another
// origin is left alone. And it writes only functions that parse as one
// function - checked with a JavaScript parser, because a worker has no eval
// either - so no expression's text can close its function early and run
// when the script loads. A file someone else managed to put on the origin
// compiles into functions that are registered and never called, unless the
// page renders that file as a component.
//
// Built by tsup as dist/jq79-sw.js, a classic worker script with the
// generator and the parser in it. It has to be served from the site - a
// service worker can't come from another origin - at the root by default,
// which is also what makes its scope the whole site.
// ---------------------------------------------------------------------------

import { parse } from "acorn"
import { precompile, precompiledScript } from "./precompile"
import { PRECOMPILED_PARAM, functionText } from "./source"

// the text parses, and parses as exactly this one function - nothing before
// it, nothing after it. Wrapped in parens so a function *declaration* can't
// stand in, and read back by position so a body that closes the function
// early and opens another can't either
export const parsesAsOneFunction = (params: string[], body: string): boolean => {
  const text = `(${functionText(params, body)})`
  try {
    const program = parse(text, { ecmaVersion: "latest", sourceType: "script" })
    const [statement] = program.body
    return (
      program.body.length === 1 &&
      statement.type === "ExpressionStatement" &&
      statement.expression.type === "FunctionExpression" &&
      statement.expression.start === 1 &&
      statement.expression.end === text.length - 1
    )
  } catch {
    return false
  }
}

const SCRIPT_HEADERS = { "Content-Type": "text/javascript", "Cache-Control": "no-cache" }

// the answer to a `?jq79-precompiled` request: the component fetched from the
// same URL without the parameter, and its functions as a script. A component
// that isn't there answers with its status, so the <script> that asked fails
// and the runtime says which file
export const precompiledResponse = async (url: URL, fetchSource: (url: string) => Promise<Response> = fetch): Promise<Response> => {
  const source = new URL(url.href)
  source.searchParams.delete(PRECOMPILED_PARAM)
  const response = await fetchSource(source.href)
  if (!response.ok) {
    return new Response(`/* jq79: ${source.pathname} answered ${response.status} */\n`, { status: response.status, headers: SCRIPT_HEADERS })
  }
  return new Response(precompiledScript(precompile(await response.text()), parsesAsOneFunction), { headers: SCRIPT_HEADERS })
}

// only when this file runs as a service worker - imported anywhere else (the
// tests), it registers nothing
const scope = globalThis as any
if (typeof scope.ServiceWorkerGlobalScope === "function" && scope instanceof scope.ServiceWorkerGlobalScope) {
  scope.addEventListener("install", () => scope.skipWaiting())
  // the page that registered it is waiting to be controlled: claim it now,
  // rather than on its next load
  scope.addEventListener("activate", (event: any) => event.waitUntil(scope.clients.claim()))
  // a page loaded past the worker - a hard reload - asks to be claimed
  scope.addEventListener("message", (event: any) => {
    if (event.data === "jq79:claim") event.waitUntil(scope.clients.claim())
  })
  scope.addEventListener("fetch", (event: any) => {
    if (event.request.method !== "GET") return
    const url = new URL(event.request.url)
    if (url.origin !== scope.location.origin || !url.searchParams.has(PRECOMPILED_PARAM)) return
    event.respondWith(precompiledResponse(url))
  })
}
