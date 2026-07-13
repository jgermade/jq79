# Development

```sh
npm install
npm test                 # vitest + jsdom
npm run test:coverage    # + coverage report (text, html in coverage/, json-summary)
npm run build            # tsup → dist/ (runtime: ESM + CJS + IIFE, vite plugin: ESM + CJS, + .d.ts)
npm run site             # builds the GitHub Pages site into site/ (needs build + coverage first)
```

## Publishing

Releases are automated via GitHub Actions ([release.yml](../.github/workflows/release.yml)): run the **Release** workflow from the Actions tab (workflow dispatch, choosing the patch/minor/major bump). It tests, builds, bumps the version, publishes to npm with provenance, pushes the commit + tag, and creates the GitHub release with the `dist/` files attached. Requires an `NPM_TOKEN` repository secret (npm automation token). CDNs (unpkg, jsDelivr, esm.sh) pick the new version up from npm automatically.

After publishing, the `pages` job deploys the GitHub Pages site: rendered docs, the HTML coverage report, self-hosted badges (npm version + coverage), and the `dist/` files at the site root so `https://jgermade.github.io/jq79/jq79.js` works as a CDN for the latest release. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

Every push/PR to `main` also runs tests + build ([ci.yml](../.github/workflows/ci.yml)).
