<img src="assets/Component79.svg" alt="jq79 logo" width="140" align="right">

# jq79

A mini reactive component library in a single file. Single-file components (template + `<script :setup>` + `<style>`), Svelte-style reactive scripts, fine-grained DOM updates via proxy-based dependency tracking — no compiler, no virtual DOM, no dependencies.

## Installation

### npm

```sh
npm install jq79
```

```js
import { Component79, $, $$ } from "jq79"
```

### CDN

Once published to npm, the package is automatically served by every major CDN — no separate publishing step:

```html
<!-- as an ES module -->
<script type="module">
  import { Component79 } from "https://esm.sh/jq79"
  // or: https://cdn.jsdelivr.net/npm/jq79/+esm
  // or: https://unpkg.com/jq79?module
</script>

<!-- or as a classic script exposing window.jq79 -->
<script src="https://cdn.jsdelivr.net/npm/jq79/dist/jq79.global.js"></script>
<script>
  const { Component79 } = jq79
</script>
```

Pin a version in production: `https://cdn.jsdelivr.net/npm/jq79@0.1.0/...`.

Or grab [`src/jq79.ts`](src/jq79.ts) directly — the whole library is one file.

## Quick start

```js
import { Component79 } from "jq79"

const jq79 = new Component79(`
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

- [Components](docs/components.md) — lifecycle (`mount`, `mountShadow`, `detach`, `destroy`), instance events (`on`/`off`), loading remote components with `Component79.fetch`.
- [Template syntax](docs/template-syntax.md) — `{{ }}` interpolation, `:bind`, `:if`/`:elseif`/`:else`, `:each`/`:key`, `:with`, `@event` listeners and modifiers, nested components.
- [Setup scripts](docs/setup-scripts.md) — `<script :setup>` reactive scripts, `$:` declarations, `$emit`, `await $mounted()`, `$self`/`$$self`.
- [Reactive data](docs/reactive-data.md) — the standalone `$reactive` store: `$on`, `$onAny`, `$effect`.
- [DOM helpers](docs/dom-helpers.md) — `$`, `$$` and `$create`.
- [Development](docs/development.md) — running tests, building, publishing releases.

## License

ISC
