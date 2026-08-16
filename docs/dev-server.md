# Dev server

`jq79 dev` serves a directory of components over HTTP and hot-reloads them as you
edit. It is for the no-bundle path: a project with no build step, whose `.html`
files are fetched at runtime.

```sh
npx jq79 dev            # serve . on http://localhost:4179
npx jq79 dev site       # serve a directory
npx jq79 dev -p 8080    # (or --port; -H/--host to bind elsewhere)
npx jq79 dev -w '../ui/**'                                      # (or --watch)
npx jq79 dev --header "cross-origin-opener-policy: same-origin"
```

`-w` and `--header` are repeatable. `-w` reloads the page on a change; to *do*
something about it, [`watch`](#watch) takes a handler from a script.

Or from a script:

```js
import { devServer } from "jq79/dev"

const server = await devServer({ rootDir: ".", port: 4179 })
console.log(server.url)   // → http://localhost:4179
await server.close()
```

If you already build with Vite, you don't want this — use the
[Vite plugin](vite-plugin.md), which hot-reloads bundled components through
Vite's own dev server. `jq79/dev` exists for the case where the whole point was
not having a toolchain.

## What it does, and doesn't

It is a static file server. It serves the files as they are on disk, so **what
you develop against is what a static host would serve** — no transforms, no
bundling, no module graph, no rewritten imports. A `<style lang="scss">` is *not*
compiled (that is the one thing only the [bundler](vite-plugin.md#style-lang--css-preprocessors)
does), and neither is anything else.

If you do need a build step, [`watch`](#watch) is where you hang it: the server
calls your function and serves whatever it writes. It stays your build, and the
files it produces are still the files a static host would serve.

The one thing it adds is hot reload, and it adds it to **pages** only. A page —
what the browser navigates to — is served with a small client script injected
into its `<head>`. A component — what the runtime `fetch`es — is served
byte-for-byte, because the runtime parses whatever comes back, and an injected
`<script>` would become part of the component.

The two are told apart by `Sec-Fetch-Dest`, which the browser sets: `document`
for a navigation, `empty` for a `fetch()`.

## Hot reload

Save a component and it is swapped into the running page, in place, keeping its
data: props and store values survive. The setup script runs again, so whatever it
initializes is reset — a counter that starts at `0` goes back to `0`.

Every live instance of that file is re-rendered, including components used as
nested definitions:

```html
<!-- app.html -->
<script :setup>
  const Row = await import("./Row.html")
  let rows = ["one", "two", "three"]
</script>

<ul>
  <li :each="row in rows"><Row :label="row" /></li>
</ul>
```

Editing `Row.html` re-renders all three rows where they stand, and `rows` keeps
its value. (This is the one place the dev server does *more* than the Vite plugin,
which reaches a component through the module that imported it and so cannot find
clones it never held a reference to — there, editing a nested-only component
reloads the page.)

Anything the runtime can't place falls back to a **full page reload**:

- the page itself, and any file that isn't a component (`.css`, `.js`, images)
- a component that nothing has mounted yet
- a component that was deleted or renamed

## How the page and the runtime find each other

The injected client can't `import` the runtime: the page's copy may come from a
CDN, an import map or a local file, and a second copy would have a second, empty
registry of components. So the runtime is handed to the client instead.

The client is a *classic* script, which runs before the page's deferred module
scripts. It sets a flag; the runtime reads that flag as it loads, and only then
starts tracking instances so they can be found by filename later. Nothing about
this costs a production page anything: with no flag, no instance is ever tracked.

You can switch it on yourself — for a custom dev setup, or a bundler that isn't
Vite:

```js
import { enableHotReload, hotUpdate } from "jq79"

enableHotReload()                    // start tracking instances by filename
hotUpdate("/Row.html", newSource)    // → how many live instances re-rendered
```

`hotUpdate` returns the number of instances that were on the page and got
re-rendered. Zero means the change isn't visible anywhere, which is the signal to
reload.

## Options

```js
devServer({
  rootDir: ".",         // directory to serve and watch
  port: 4179,           // 0 picks a free one; server.port reports it
  host: "localhost",    // bind address
  headers: {},          // response headers, sent on everything
  beforeResponse: [],   // (req, res) => {} — the same, per request
  watch: [],            // { pattern, fn } — what else to watch, and what to do
})
```

Files under `node_modules/` and dotfiles are not watched. The server is deliberately
plain — it has no dependencies, and it is not meant to be deployed.

### `headers`

A static host is configured; these are that configuration. They go out on
**every** response — pages, components, the client, the event stream, the 404s —
so you can develop against the headers you will deploy behind:

```js
devServer({
  headers: {
    "cross-origin-opener-policy": "same-origin",     // SharedArrayBuffer
    "cross-origin-embedder-policy": "require-corp",
    "access-control-allow-origin": "*",
  },
})
```

Names are case-insensitive, so `Cache-Control` replaces the server's own
`cache-control` rather than arriving beside it. Two headers stay the server's:
`content-type` and `content-length` describe the bytes of the response they are
on, and a global value would contradict every one of them. For a content-type
that depends on the request, see [`beforeResponse`](#beforeresponse).

### `beforeResponse`

`headers` is the same on every response. `beforeResponse` is the version that
gets to look first: each hook is handed the request and its response before
anything has been written to it, so `res.setHeader` still applies.

```js
devServer({
  headers: { "cross-origin-opener-policy": "same-origin" },
  beforeResponse: [
    (req, res) => {
      if (req.url?.startsWith("/private/")) res.setHeader("cache-control", "no-store, private")
    },
  ],
})
```

The layers go general to specific — the server's own defaults, `headers` over
them, then each hook over the last — and names stay case-insensitive throughout,
so a hook's `Cache-Control` replaces the `cache-control` under it rather than
joining it. Hooks may be `async`, and are awaited in turn.

**A hook may set `content-type`,** which is the one thing `headers` may not. A
global content-type would contradict every response it landed on; a hook saw the
request, so it knows which response it is talking about. This is the escape
hatch for a file type the server's table doesn't carry:

```js
{ beforeResponse: [(req, res) => {
    if (req.url?.endsWith(".pak")) res.setHeader("content-type", "application/wasm")
  }] }
```

`content-length` is never yours: it is arithmetic on the bytes actually being
sent, and a wrong one truncates the body or hangs the socket.

**A hook may answer the request itself.** Write a response and the server leaves
it alone — a mocked endpoint, a stubbed login, a fixture the served tree has no
file for:

```js
{ beforeResponse: [(req, res) => {
    if (req.url !== "/api/session") return
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ user: "dev" }))
  }] }
```

There is no `next`. The hooks are awaited in order, so a hook that returns has
had its turn, and a hook that answered the request has already ended the chain
by answering it — there is nothing left to hand on. A hook that throws is
reported and the request gets a 500, because a socket nobody answers hangs the
page; the server itself stays up, like a `watch` handler that fails.

### `watch`

The root is always watched. `watch` adds to it — a glob, and what to do when
something matches it:

```js
import * as sass from "sass"

devServer({
  rootDir: "public",
  watch: [
    // the build step this server doesn't have, in the six lines it takes
    {
      pattern: "styles/**/*.scss",
      fn: async files => {
        const { css } = sass.compile("styles/app.scss")
        await writeFile("public/app.css", css)
      },
    },
    // no fn: watch it, reload the page when it changes
    { pattern: "../shared/**" },
  ],
})
```

| field | |
|---|---|
| `pattern` | a glob, or an array of them, resolved against the cwd like `rootDir`. A bare directory means everything under it. |
| `fn` | `(files: string[]) => void \| Promise<void>` — the absolute paths that changed. Optional. |

**One call per burst.** A save that touches four files calls `fn` once with all
four, because a handler is a build step and building four times is three builds
nobody asked for. If it's still running when the next batch lands, that batch
waits for it. A handler that throws is reported and the server stays up — a
build that fails is a normal morning.

**Handlers never cost you hot reload.** A file *inside* the root keeps the root's
behaviour no matter what a pattern says about it: `.html` is hot-swapped,
anything else reloads, and any matching `fn` runs as well. A pattern is a claim
on a file, not a veto.

**Outside the root, the handler is the answer.** There is no url out there for
the runtime to swap into, so a matched file runs its `fn` and stops — and
whatever the `fn` writes *into* the served directory comes back round as a change
of its own, with a url, which is what reloads the page. An entry with no `fn` has
nothing else to offer, so it reloads directly.

A single file is watched through the directory it sits in, so it survives an
editor's atomic save (which replaces the file rather than writing to it). A
pattern whose literal head does not exist (`styles/**/*.scss` with no `styles/`)
throws before the server starts, rather than leaving you with a server that
quietly watches nothing.

Globs are matched by [`path.matchesGlob`](https://nodejs.org/api/path.html#pathmatchesglobpath-pattern),
so this needs Node 22.5 or newer — no dependency, and the same syntax the rest of
the ecosystem uses.
