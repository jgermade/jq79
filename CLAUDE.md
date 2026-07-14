# jq79

A mini reactive component library: single-file `.html` components, Svelte-style
setup scripts, fine-grained proxy reactivity. No compiler, no virtual DOM, no
dependencies — `new Component79(src)` parses and mounts at runtime.

The source is small enough to read in a sitting: [`src/jq79.ts`](src/jq79.ts) is
the core (parsing, rendering, components), with three leaf modules —
[`dom.ts`](src/dom.ts), [`reactive.ts`](src/reactive.ts),
[`transform.ts`](src/transform.ts). Read the code before changing it; it's shorter
than the docs.

## Commands

```sh
npm test              # vitest + jsdom
npm run test:coverage # + coverage/ (the site's badge reads lines.pct)
npm run build         # tsup → dist/
npm run site.dev      # the site + tutorial on a watch loop → localhost:4179
```

CI runs `npm test` and `npm run build` on every push/PR to `main`.

## Before you change the core

[`docs/development.md`](docs/development.md#load-bearing-invariants) spells out the
invariants that look like implementation details and are not. The short version:

- **The store never wraps a proxy.** `$reactive` wraps nested objects lazily on
  read, one cached proxy per raw object per store, unwrapping (`toRaw`) at both
  ends. Wrapping eagerly — rewriting the object it was handed, as it used to —
  makes two stores over one object wrap each other's proxies until the tab
  freezes. This is a fix, not a style choice; don't "simplify" it back.
- **A proxy's identity is keyed to the object, not its path**, because `:each`
  diffs its items by reference. Key the cache by path and every reorder rebuilds
  the list.
- **Top-level `let`/`const` in a setup script become reactive store variables.**
  An effect that reads *and* writes one wakes itself forever — but only from the
  second pass, so it renders fine and dies later. Timers, cached instances and
  other bookkeeping belong in a closure, where declarations stay plain JS.
- **`$:` effects run before the template exists.** Anything reaching for the DOM
  needs its first pass done by hand after `await $mounted()`.

## Docs

Written for users, but they're where the behaviour is specified:
[components](docs/components.md), [template syntax](docs/template-syntax.md),
[setup scripts](docs/setup-scripts.md), [reactive data](docs/reactive-data.md),
[DOM helpers](docs/dom-helpers.md), [Vite plugin](docs/vite-plugin.md).

Docs and the site are generated from the repo's own markdown
([`scripts/build-site.mjs`](scripts/build-site.mjs)) — edit the `.md`, not `site/`
(which is wiped on every build and gitignored).

## The tutorial

`/tutorial/` is itself a jq79 component that compiles whatever is in its editor
and mounts it in a shadow root. Adding an exercise is adding a folder under
`tutorial/` — see [docs/development.md](docs/development.md#the-tutorial).

Every exercise is a tested component ([`tests/tutorial.test.ts`](tests/tutorial.test.ts)):
each starting file must mount without throwing, and each solution must do what its
README claims. A library change that breaks an exercise fails the build — that's
deliberate, so fix the cause rather than the exercise.
