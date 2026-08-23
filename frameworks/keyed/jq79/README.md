# jq79 (keyed) — js-framework-benchmark implementation

A [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
implementation of the standard "1,000/10,000 rows" benchmark, built with jq79.
The whole app is one `.html` component ([`src/App.html`](src/App.html)) — no
compiler, fine-grained proxy reactivity for the row updates, `:each`/`:key` for
keyed diffing on create/append/swap/remove.

Row generation (ids, the adjective/colour/noun words) and the update/swap
algorithms match the reference
[vanillajs implementation](https://github.com/krausest/js-framework-benchmark/tree/master/frameworks/keyed/vanillajs)
exactly — shared with every other implementation in
[`frameworks/keyed/`](..) via [`_shared/data.js`](../_shared/data.js), so a
comparison run builds the exact same rows regardless of which framework
produced them.

See [`frameworks/keyed/README.md`](../README.md) for how this fits alongside
the other implementations and how the `/benchmark/comparison/` numbers are
generated.

## Running it

```sh
npm install
npm run dev     # vite dev server
npm run build   # → dist/, matches the "build-prod" script the benchmark harness runs
```

## Submitting upstream

To drop this into a `js-framework-benchmark` checkout as a real submission:

1. Copy this directory to `frameworks/keyed/jq79/`.
2. Point `publicDir` (in `vite.config.js`) at the harness's own shared
   `css/currentStyle.css` instead of `../_shared/public`.
3. Add `jq79` to `webdriver-ts/src/common.ts`'s framework list, per the
   [`justify your addition` guidelines](https://github.com/krausest/js-framework-benchmark/blob/master/justify-your-addition.md).

None of that is needed to run the benchmark locally against this repo's copy
of jq79.
