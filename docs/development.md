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

**Identity is keyed to the object, not to its path.** A reordered list has to hand
back the same proxy for the same item, because [`:each`](template-syntax.md) diffs
by reference (`Object.is`) — key the proxy cache by path instead and every row
re-renders on every reorder. The trade is that an object's dot-path is fixed when
it's first wrapped, so after a reorder its notifications carry the old index;
effects that read the list itself still wake up (paths overlap), which is what
makes it a non-issue in practice.

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

Exercises are tested like any other component ([`tests/tutorial.test.ts`](../tests/tutorial.test.ts)):
every starting file must mount without throwing, and every solution must actually do what
its README claims — so a library change that breaks an exercise fails the build.

## Publishing

Releases are automated via GitHub Actions ([release.yml](../.github/workflows/release.yml)): run the **Release** workflow from the Actions tab (workflow dispatch, choosing the patch/minor/major bump). It tests, builds, bumps the version, publishes to npm with provenance, pushes the commit + tag, and creates the GitHub release with the `dist/` files attached. Requires an `NPM_TOKEN` repository secret (npm automation token). CDNs (unpkg, jsDelivr, esm.sh) pick the new version up from npm automatically.

After publishing, the `pages` job deploys the GitHub Pages site: rendered docs, the HTML coverage report, self-hosted badges (npm version + coverage), and the `dist/` files at the site root so `https://jgermade.github.io/jq79/jq79.js` works as a CDN for the latest release. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

Every push/PR to `main` also runs tests + build ([ci.yml](../.github/workflows/ci.yml)).
