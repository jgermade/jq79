# vanillajs (keyed) — js-framework-benchmark implementation

The no-framework baseline: direct DOM manipulation, a row template cloned per
row, rows tracked in a `Map<id, <tr>>`. See
[`frameworks/keyed/README.md`](../README.md) for how this fits alongside the
other implementations.

```sh
npm install
npm run dev     # vite dev server
npm run build   # → dist/
```
