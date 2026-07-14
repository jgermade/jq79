# Development

```sh
npm install

# vitest + jsdom
npm test

# + coverage report (text, html in coverage/, json-summary)
npm run test:coverage

# tsup → dist/ (runtime: ESM + CJS + IIFE, vite plugin: ESM + CJS, + .d.ts)
npm run build

# builds the GitHub Pages site into site/ (needs build + coverage first)
npm run site

# the same, on a watch loop with livereload → http://localhost:4179
npm run site.dev
```

## The no-bundle path

Every other test imports from `src/`, so nothing would notice if the artifacts a
CDN actually serves stopped working. [`tests/no-bundle.test.ts`](../tests/no-bundle.test.ts)
covers the delivery mode that has no build step at all: it loads `dist/jq79.global.js`
as a classic script and `dist/jq79.js` as a native ES module, serves the fixture
components in [`tests/fixtures/no-bundle/`](../tests/fixtures/no-bundle/) from a real
HTTP server, and mounts them through `Component79.fetch()` — including a nested
component that a setup script's `await import("./todo-item.html")` fetches at runtime,
with no bundler having resolved the specifier. The last test runs the fixture's
`index.html` as written, with only its `https://esm.sh/jq79` import pointed at the
local build.

It builds `dist/` itself when it's missing or older than `src/` (~0.5s), since `npm
test` runs before `npm run build`.

The [dev server](dev-server.md) that serves that path — `npx jq79 dev`, in
[`dev/dev.ts`](../dev/dev.ts) — is covered by
[`tests/devServer.test.ts`](../tests/devServer.test.ts), which runs a real server
over a real directory and asserts both ends of the seam a browser sits in: the
`{ url, src }` an SSE frame carries, and the swap the runtime makes of it. The
client script the server injects is fetched from the running server and executed,
so a typo in it fails the suite rather than the page.

## Load-bearing invariants

Things that look like implementation details but aren't — each one is held up by
tests, and each has cost real debugging at least once.

**The store never wraps a proxy.** [`$reactive`](reactive-data.md) wraps nested
objects lazily, as they're read, caching one proxy per raw object per store, and
unwraps (`toRaw`) on the way in and on the way out. This is not an optimisation:
it is the thing that makes the store safe. It used to wrap eagerly, rewriting the
object it was handed and replacing nested objects with proxies in place — so two
stores over the same object each wrapped the other's proxies, and because wrapping
walks what it wraps, the layers compounded until the tab froze. Mounting two
components with one data object, or re-mounting one, was enough to hang it.
Reverting to eager wrapping brings that straight back; `tests/reactive.test.ts`
("data shared with another store") is what stands in the way.

**A nested store is bridged, not wrapped.** A store put inside another store keeps
its own listeners and its own effects — and the holder's effects are not among
them, so a write through it would notify nobody upstairs. The holder subscribes
to it instead (`$onAny`) and re-notifies its changes under the path it sits at
(`items.0` → `cart.items.0`), which is the path an effect reading through `cart`
recorded as a dependency. That bridge is what makes a shared `$reactive` shared
*state* rather than shared data, so don't remove it in the name of the invariant
above: the fix for eager wrapping is not to re-wrap the store, it's to listen to
it. It's dropped when the holder is destroyed (`$dispose`), or a long-lived store
would collect a listener per component that ever held it.

**Identity is keyed to the object, not to its path.** A reordered list has to hand
back the same proxy for the same item, because [`:each`](template-syntax.md) diffs
by reference (`Object.is`) — key the proxy cache by path instead and every row
re-renders on every reorder. The trade is that an object's dot-path is fixed when
it's first wrapped, so after a reorder its notifications carry the old index;
effects that read the list itself still wake up (paths overlap), which is what
makes it a non-issue in practice.

**A hot swap re-attaches at the markers, and destroys before it swaps.**
`hotReplace` — the one both the [Vite plugin](vite-plugin.md) and the
[dev server](dev-server.md) drive — has two orderings that look arbitrary and are
not. It re-inserts the new output *between the component's markers*, not into
`mountRoot`, because a nested clone is mounted into a `DocumentFragment` that is
then emptied into the page: its `mountRoot` is a stale, detached fragment, and
re-mounting on it would lift the component out of the document. And it calls
`destroy()` while `this.styles` still holds the **old** style blocks — `destroy()`
releases the refcounted stylesheets it acquired, so swapping the parts in first
releases a stylesheet nobody holds and leaves the old one styling the page
forever.

**Setup scripts have two traps** that no test can catch for you, both written up in
[setup-scripts.md](setup-scripts.md): an effect that reads *and* writes the same
scope variable wakes itself forever — but only from the **second** pass, since an
effect's dependencies are recorded after its first run, so the component renders
fine and blows up later. And `$:` effects run before the template exists, so
anything that touches the DOM needs its first pass done by hand after
`await $mounted()`.

## The tutorial

`/tutorial/` on the site is a jq79 component ([`tutorial/_app/Tutorial.html`](../tutorial/_app/Tutorial.html)) that
compiles whatever is in its editor with `new Component79(...)` and mounts it into a
shadow root — no compiler to ship, and an exercise's `<style>` can't leak into the
page around it.

`Tutorial.html` is only the shell: the state (which exercise, which file, whether a
solution is being reviewed), the navigation and the layout. The panes are components
under [`tutorial/_app/components/`](../tutorial/_app/components) — `Toc`, `Lesson`,
`Editor`, `Diff`, `Preview` — imported at runtime with `await import(...)`, so the
tutorial is itself a multi-component jq79 app. None of them writes to the state it
renders: props go down, and what the user did comes back up as a `tutorial:*` `$emit`
the shell's container element listens for. The two panes that need the highlighter get
`highlight`/`languageOf` from the shell, and the preview gets a `compile` function, so
`hljs` and `Component79` stay in one file.

Adding an exercise is adding a folder — [`build-site.mjs`](../scripts/build-site.mjs) walks
`tutorial/` and emits the whole thing as one JSON manifest:

```
tutorial/
  01-basics/                     ← a section; its title comes from the folder name
    01-your-first-component/     ← an exercise, in order
      README.md                  ← the prose (its `# heading` is the exercise title)
      app.html                   ← what the editor starts with; the file that gets mounted
      solution/
        app.html                 ← what the "solution" button swaps in
```

Extra files alongside `app.html` become editable tabs *and* its importable modules, so
`await import("./Greeting.html")` inside an exercise resolves to the file in the next
tab rather than hitting the network. A `solution/` only needs the files it changes.

A specifier that *isn't* one of those tabs falls through to the runtime, which fetches
it — which is what the `04-no-bundle` exercises are about, and why
[`tutorial/_app/examples/`](../tutorial/_app/examples) exists: it rides along into
`site/tutorial/examples/`, so `await import("./examples/Sticker.html")` in an exercise
is a real request to the host serving the page, for a component no bundler ever saw.
Those exercises are the only ones that touch the network, and their tests serve the
same files off disk.

Exercises are tested like any other component ([`tests/tutorial.test.ts`](../tests/tutorial.test.ts)):
every starting file must mount without throwing, and every solution must actually do what
its README claims — so a library change that breaks an exercise fails the build.

The "solution" button doesn't swap the files in: it diffs them against whatever the editor
holds and shows that, over the editor, until the user accepts it. So an exercise's
`solution/` is read twice — once to render the diff, once to apply it — and both go through
the same merge over the starting files, which is why applying one also reverts edits made to
files the solution doesn't mention.

### Highlighting

Snippets in an exercise's prose are highlighted at build time (marked-highlight), and the
editor and the diff are highlighted in the browser as you type — by the same library, with
the same `hljs-*` class names, off the one palette the shell page carries (`HLJS_CSS` in
[`build-site.mjs`](../scripts/build-site.mjs), shared with the docs pages). highlight.js
ships as CommonJS, so the copy the tutorial loads is bundled from
[`scripts/hljs-browser.js`](../scripts/hljs-browser.js) into `site/assets/hljs.js` and handed
to the component as render data, the same way `Component79` is. That bundle is cached under
`node_modules/.cache/jq79/` and only rebuilt when the dependency's version changes — the
watch loop would otherwise pay for it on every rebuild.

The editor itself is a textarea with transparent text sitting exactly on top of a `<pre>`
holding the same text, highlighted; only the caret and the selection show through. The two
layers only line up while they wrap identically, so their font, padding and wrapping are set
together in one rule — and the `<pre>` is the one in flow, so it sizes the pane and there is
no scroll position to keep in sync.

## Publishing

Releases are automated via GitHub Actions ([release.yml](../.github/workflows/release.yml)): run the **Release** workflow from the Actions tab (workflow dispatch, choosing the patch/minor/major bump). It tests, builds, bumps the version, publishes to npm with provenance, pushes the commit + tag, and creates the GitHub release with the `dist/` files attached. Requires an `NPM_TOKEN` repository secret (npm automation token). CDNs (unpkg, jsDelivr, esm.sh) pick the new version up from npm automatically.

After publishing, the `pages` job deploys the GitHub Pages site: rendered docs, the HTML coverage report, self-hosted badges (npm version + coverage), and the `dist/` files at the site root so `https://jgermade.github.io/jq79/jq79.js` works as a CDN for the latest release. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

Every push/PR to `main` also runs tests + build ([ci.yml](../.github/workflows/ci.yml)).
