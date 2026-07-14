# Dev server

`jq79 dev` serves a directory of components over HTTP and hot-reloads them as you
edit. It is for the no-bundle path: a project with no build step, whose `.html`
files are fetched at runtime.

```sh
npx jq79 dev            # serve . on http://localhost:4179
npx jq79 dev site       # serve a directory
npx jq79 dev -p 8080    # (or --port; -H/--host to bind elsewhere)
```

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
})
```

Files under `node_modules/` and dotfiles are not watched. The server is deliberately
plain — it has no dependencies, and it is not meant to be deployed.
