# Content Security Policy

> **Nothing changes unless you ask.** By default jq79 turns a component's
> expressions and scripts into functions with `new Function`, which a Content
> Security Policy only allows with `'unsafe-eval'`. `safeEval` is the opt-in
> way to run without it, in Vite or with no bundler at all.

A component is text: `{{ count * 2 }}`, `@click="save()"` and every `<script>`
arrive as strings, and the runtime compiles them when they first render. On a
page whose CSP leaves `'unsafe-eval'` out of `script-src`, that compilation is
refused — expressions render empty and a component with a script throws on
mount.

`safeEval` gets those functions to the page as code the browser loads — which a
CSP judges by where it comes from — and from then on the runtime never calls
`new Function`.

## Four ways, one option

|                       | `safeEval: true` · `script-src 'self'`                  | `safeEval: { nonce: true }` · `script-src 'nonce-…'` |
|-----------------------|---------------------------------------------------------|------------------------------------------------------|
| **Vite**              | [`jq79({ safeEval: true })`](#with-vite)                | [`jq79({ safeEval: { nonce: true } })`](#with-a-nonce) |
| **No bundler**        | [`await Component79.safeEval()`](#without-a-bundler)    | [`await Component79.safeEval({ nonce: true })`](#with-a-nonce) |

`true` precompiles every component, and anything that wasn't precompiled is
reported instead of evaluated. `{ nonce: true }` is for a page whose server
sends a fresh nonce with every response: what wasn't precompiled is built as a
`<script>` carrying that nonce.

## With Vite

```js
// vite.config.js
import { defineConfig } from "vite"
import { jq79 } from "jq79/vite"

export default defineConfig({
  plugins: [jq79({ safeEval: true })],
})
```

```
Content-Security-Policy: script-src 'self'
```

Your app code doesn't change. At build time every imported `.html` component
is precompiled: its functions are compiled in node, and ship as a script of
their own beside the bundle (`UserCard.html.jq79-[hash].js`). The component's
module waits for that script before it exports the component, so it can be
mounted the moment it's imported. In `vite dev` the dev server hands the same
scripts out, and an edit reloads them.

A function that doesn't compile — a typo in an expression — is reported by the
build with its file, and renders nothing on the page, as it would with eval.

The module waits with a top-level `await`. Vite 7 and later build for targets
that have it; on Vite 5 or 6, set `build.target: "es2022"`.

## Without a bundler

```html
<script type="module" src="/main.js"></script>
```

```js
// main.js
import { Component79 } from "/jq79.js"

await Component79.safeEval()
const App = await Component79.fetch("/App.html")
App.mount(document.body)
```

```
Content-Security-Policy: script-src 'self'
```

`'self'` admits your own files and nothing else: the page's script has to be a
file rather than inline, and the library has to come from your site too — or
the CSP has to name the CDN it comes from (`script-src 'self'
https://cdn.jsdelivr.net`).

Your `.html` files stay exactly what you deploy. What's added is one file,
**`jq79-sw.js`**, a service worker that has to be served by your own site — a
browser won't register one from another origin. Copy it from the package
(`node_modules/jq79/dist/jq79-sw.js`, or
`https://cdn.jsdelivr.net/npm/jq79/dist/jq79-sw.js`) to the root of your site.

`safeEval()` registers it and resolves once it controls the page. From then on,
a component fetched by URL — `Component79.fetch()`, or an `import("./Row.html")`
from a script — arrives with its functions: the worker fetches the same file
from your site and answers with a script that registers them. It only ever
compiles files from its own origin, and only writes text that parses as a
single function — so an expression can't be written to break out of the script
it ends up in.

- **Somewhere other than the root.** Pass its URL:
  `safeEval({ worker: "/app/jq79-sw.js" })`. A worker controls the directory it
  is served from and everything below it, so your components have to live there.
- **https, or localhost.** Browsers only run service workers there. Without one,
  `safeEval()` rejects and says so.
- **The first visit** waits for the worker to install — a moment, once.

## With a nonce

If your server issues a nonce with every response and your CSP names it —
`script-src 'nonce-r4nd0m…'` — jq79 can build anything that wasn't precompiled
as a `<script>` carrying that nonce. It finds the nonce on the page by itself,
on the script that loaded it.

```js
// Vite: precompiled, and the nonce for what the build never saw
jq79({ safeEval: { nonce: true } })

// no bundler: no worker, every function built through the nonce
await Component79.safeEval({ nonce: true })
```

In Vite, [`html.cspNonce`](https://vite.dev/config/shared-options#html-cspnonce)
puts a placeholder nonce on the page's own tags, for your server to replace with
each response's.

This still turns a component's text into code in the browser, as eval does —
only through a door that jq79 alone holds the key to. That is only worth
something if the nonce changes with every response: a static host serves the
same page, and the same nonce, to everyone, and a nonce everyone knows protects
nothing. On a static host, use `safeEval: true`.

With no nonce on the page, `safeEval({ nonce: true })` rejects and says so.

## What can't be precompiled

Safe mode reports what it couldn't find in the console, by name:

```
jq79: safeEval() is on, and "total * 2" was not precompiled, so it rendered as nothing.
```

- **A component built from a string** — `new Component79("<p>{{ x }}</p>")`
  — has no file to precompile. Put it in an `.html` file, or use
  `{ nonce: true }`.
- **A component from another origin** can't be compiled by your site's worker.
- **`npx jq79 dev`'s hot reload** sends new source the worker hasn't compiled;
  under `safeEval()` an edit's new expressions show up after a page reload.

## Styles

`safeEval` is about `script-src`. A component's `<style>` blocks — scoped or
not — are added to the page as `<style>` elements, which a `style-src` without
`'unsafe-inline'` refuses. For now, a page that uses component styles needs
`'unsafe-inline'` in `style-src` (or no `style-src` at all).

## Checking a page

`safeEval` works on a page with no CSP too, which makes it a way to find out
whether a page needs eval at all: turn it on, use the page, and anything that
wasn't precompiled is reported in the console by name.

## Reference

**`Component79.safeEval(options?) → Promise<void>`** — turns safe mode on for
the page, for good.

- `nonce?: boolean` — build what wasn't precompiled with the page's nonce.
- `worker?: string | false` — the service worker to register
  (default `"/jq79-sw.js"`, or none with `nonce: true`); `false` registers none,
  for a page whose functions arrive another way.

It rejects when there is no nonce to be found, or no worker to be had — and
safe mode stays on, so the page never falls back to eval.

**`jq79({ safeEval })`** — the [Vite plugin](vite-plugin.md)'s option:
`true` or `{ nonce: true }`, as above.

**`precompile(source)`**, from `jq79/precompile` — every function the runtime
would build for a component, as `[params, body]` pairs, without rendering it.
What the worker and the plugin are built on, for tooling of your own.
