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
