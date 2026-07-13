# Development

```sh
npm install
npm test         # vitest + jsdom
npm run build    # tsup → dist/ (runtime: ESM + CJS + IIFE, vite plugin: ESM + CJS, + .d.ts)
```

## Publishing

Releases are automated via GitHub Actions ([release.yml](../.github/workflows/release.yml)):

```sh
npm version patch|minor|major   # bumps package.json and creates the vX.Y.Z tag
git push --follow-tags
```

Pushing the tag runs tests + build, creates the GitHub release with the `dist/` files attached, and publishes to npm with provenance. Requires an `NPM_TOKEN` repository secret (npm automation token). CDNs (unpkg, jsDelivr, esm.sh) pick the new version up from npm automatically.

Every push/PR to `main` also runs tests + build ([ci.yml](../.github/workflows/ci.yml)).
