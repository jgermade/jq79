
# jq79

<a href="https://jgermade.github.io/jq79/">
  <img src="assets/Component79.svg" alt="jq79 logo" width="100" align="right">
</a>

[![npm](https://jgermade.github.io/jq79/badges/npm.svg)](https://www.npmjs.com/package/jq79)
[![coverage](https://jgermade.github.io/jq79/badges/coverage.svg)](https://jgermade.github.io/jq79/coverage/)
[![esm](https://jgermade.github.io/jq79/badges/esm-size.svg)](#cdn)
[![cdn](https://jgermade.github.io/jq79/badges/cjs-size.svg)](#cdn)

A independent reactive component library that ships as a single file. Svelte-style reactive scripts, fine-grained DOM updates via proxy-based dependency tracking.

**No compiler, no bundler, no dependencies.** A component is a `.html` file — the browser already knows how to fetch one. Drop the library from a CDN, serve your components from any static host, and the page works. No `npm install`, no build step, no config.

**[Take the tutorial →](https://jgermade.github.io/jq79/tutorial/)** — a handful of exercises you edit in the browser, with a live preview. Because there's no compiler, the tutorial runs the real library: the component you write is the component that mounts.

## No build step

A component is a `.html` file. The browser already knows how to fetch one — so
nothing has to happen to your components between writing them and serving them:

```html
<!doctype html>
<div id="app"></div>

<script type="module">
  import { C79 } from "https://esm.sh/jq79"

  C79.fetch("./app.html").mount("#app", { title: "Today" })
</script>
```

That is the whole deployment. The library from a CDN, the component from your
own host, no build step in between. `C79` is `Component79` under a shorter name
— the same class, the same API.

While you're writing them, `npx jq79 dev` serves that folder and hot-reloads the
components you edit, keeping their state — no build step there either. See the
[dev server](docs/dev-server.md).

## Installation

### npm

```sh
npm install jq79
```

```js
import { Component79, C79, $, $$, $reactive, $toRaw, parseComponent } from "jq79"
```

### Vite

With the bundled plugin, `.html` component files import as modules — no
runtime fetch, with HMR in dev:

```js
// vite.config.js
import { jq79 } from "jq79/vite"
export default { plugins: [jq79()] }
```

```js
import UserCard from "./UserCard.html"
UserCard.mount("#app")
```

The plugin is a pure loader (nothing inside the component is transformed), so
the same file keeps working from `public/` via `Component79.fetch` — see
[the Vite plugin docs](docs/vite-plugin.md).

### CDN

Once published to npm, the package is automatically served by every major CDN — no separate publishing step:

```html
<!-- as an ES module -->
<script type="module">
  import { Component79 } from "https://esm.sh/jq79"
  // or: https://cdn.jsdelivr.net/npm/jq79/+esm
  // or: https://unpkg.com/jq79?module
  // or, straight from this repo's GitHub Pages (latest release):
  //     https://jgermade.github.io/jq79/jq79.js
</script>

<!-- or as a classic script exposing window.jq79 -->
<script src="https://cdn.jsdelivr.net/npm/jq79/dist/jq79.global.js"></script>
<!-- or: <script src="https://jgermade.github.io/jq79/jq79.global.js"></script> -->
<script>
  const { Component79 } = jq79
</script>
```

Pin a version in production: `https://cdn.jsdelivr.net/npm/jq79@0.1.0/...` (the GitHub Pages copy always tracks the latest release).

Which is enough for a whole page: the library from a CDN, the component from your
own host, no build step in between. `C79` (short for `Component79`, the same class)
hands back a pending component you can mount right away:

```html
<main id="app"></main>

<script type="module">
  import { C79 } from "https://jgermade.github.io/jq79/jq79.js"

  C79
    .fetch("./app.html")
    .mount("#app")
</script>
```

`fetchAll([...])` fetches several at once instead. See
[loading remote components](docs/components.md#loading-remote-components).

The library also exports `parseComponent(source)` as a shorthand for
`new Component79(source)`, and `enableHotReload()` / `hotUpdate(filename, src)`
for custom dev setups — see the [dev server](docs/dev-server.md).

The source is small enough to read in a sitting: the core (parsing, rendering, components) lives in [`src/jq79.ts`](src/jq79.ts), with three leaf helpers — [`dom.ts`](src/dom.ts), [`reactive.ts`](src/reactive.ts) and [`transform.ts`](src/transform.ts). The published build is a single dependency-free file.

## Quick start

### From a CDN (no build step)

```html
<!doctype html>
<div id="app"></div>

<script type="module">
  import { C79 } from "https://esm.sh/jq79"

  C79.fetch("./app.html").mount("#app", { title: "Today" })
</script>
```

The component file is served as-is from your host — no bundler, no config.

### From npm

```js
import { Component79 } from "jq79"

const jq79 = new Component79(html`
  <script :setup>
    let firstName = null
    let lastName = null
    $: fullName = firstName && lastName ? \`\${firstName} \${lastName}\` : ""

    API.fetch("/me").then(user => {
      firstName = user.firstName
      lastName = user.lastName
    })
  </script>

  <div :if="fullName" class="user-info">
    <span>{{ fullName }}</span>
  </div>

  <style>
    .user-info { color: rebeccapurple; }
  </style>
`)

jq79.mount("#app")
```

When the fetch resolves, the assignments to `firstName`/`lastName` re-run the `$:` declaration, which flips the `:if` and renders the span — no manual wiring.

## Documentation

- [Tutorial](https://jgermade.github.io/jq79/tutorial/) — learn it by doing, in the browser.
- [Components](docs/components.md) — lifecycle (`mount`, `mountShadow`, `detach`, `destroy`), instance events (`on`/`off`), `<style scoped>`, several components in one file with `<template name>`, loading remote components with `Component79.fetch` (chainable — fetch and mount in one expression) and `fetchAll`, and `Component79.version`.
- [Template syntax](docs/template-syntax.md) — `{{ }}` interpolation, `:name` attribute bindings, `:text`/`:html`, `:if`/`:elseif`/`:else`, `:each`/`:key`, `:with`, `@event` listeners and modifiers, nested components.
- [Setup scripts](docs/setup-scripts.md) — `<script :setup>` reactive scripts, `$:` declarations, `$emit`, `await $mounted()`, `$self`/`$$self`, and `export default` factory scripts (plain-JS alternative).
- [Reactive data](docs/reactive-data.md) — the standalone `$reactive` store: `$on`, `$onAny`, `$effect`.
- [DOM helpers](docs/dom-helpers.md) — `$`, `$$` and `$create`.
- [Vite plugin](docs/vite-plugin.md) — importing `.html` components as bundled modules, HMR, options.
- [Dev server](docs/dev-server.md) — `npx jq79 dev`: serve and hot-reload components with no build step.
- [Development](docs/development.md) — running tests, building, publishing releases.

## License

ISC
