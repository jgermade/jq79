# jq79 (keyed) — js-framework-benchmark implementation

A [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
implementation of the standard "1,000/10,000 rows" benchmark, built with jq79.
The whole app is one `.html` component ([`src/App.html`](src/App.html)) — no
compiler, fine-grained proxy reactivity for the row updates, `:each`/`:key` for
keyed diffing on create/append/swap/remove.

Row generation, ids and the update/swap algorithms match the reference
[vanillajs implementation](https://github.com/krausest/js-framework-benchmark/tree/master/frameworks/keyed/vanillajs)
exactly, so results are comparable across frameworks.

## Running it

```sh
npm install
npm run dev     # vite dev server
npm run build   # → dist/, matches the "build-prod" script the benchmark harness runs
```

`public/css` vendors the exact Bootstrap 3.3.6 build (and glyphicon fonts) the
upstream benchmark repo uses, so the page looks and reads identically without
depending on the harness's shared `/css/currentStyle.css` symlink.

## Submitting upstream

To drop this into a `js-framework-benchmark` checkout as a real submission:

1. Copy this directory to `frameworks/keyed/jq79/`.
2. Replace `public/css/*` with a symlink to the shared
   `frameworks/keyed/<other-framework>/css/currentStyle.css` (all frameworks
   share the same stylesheet there instead of vendoring their own copy).
3. Add `jq79` to `webdriver-ts/src/common.ts`'s framework list, per the
   [`justify your addition` guidelines](https://github.com/krausest/js-framework-benchmark/blob/master/justify-your-addition.md).

None of that is needed to run the benchmark locally against this repo's copy
of jq79.
