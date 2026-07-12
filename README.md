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

jq79.render().mount("#app")
```

When the fetch resolves, the assignments to `firstName`/`lastName` re-run the `$:` declaration, which flips the `:if` and renders the span — no manual wiring.

## Components

### Lifecycle

```js
const jq79 = new Component79(src)      // src: string, or { template, scripts, styles }

jq79.render(data)                      // build reactive DOM, run setup scripts, inject styles
   .mount(el)                         // attach; accepts an Element or a selector string

jq79.unmount()                         // detach, keeping state — mount() re-attaches, with
                                      // any updates that happened while detached applied
   .destroy()                         // dispose all effects and remove injected styles
```

- `render(data)` injects the component's `<style>` blocks into `document.head`.
- `renderShadow(data)` instead attaches a shadow root to the mount target and injects content and styles there, so CSS stays scoped to the component.
- `jq79.data` is the live reactive store — mutate it from outside and the DOM follows.

### Loading remote components

```js
const jq79 = await Component79.fetch("/components/user-card.html")
jq79.render({ userId: 42 }).mount("#app")
```

## Template syntax

### Interpolation

Any JS expression between `{{ }}`:

```html
<span>{{ user.name }}</span>
<span>{{ price * quantity }} €</span>
```

### `:bind` — dynamic attributes

Evaluates to an object; each entry becomes an attribute. `null`, `undefined` and `false` values remove the attribute.

```html
<button :bind="{ disabled: isSaving, title: tooltip }">Save</button>
```

### `:if` / `:elseif` / `:else` — conditionals

Consecutive siblings form one chain; only the active branch is in the DOM.

```html
<div :if="score > 8">great</div>
<div :elseif="score > 4">ok</div>
<div :else>bad</div>
```

### `:each` / `:key` — lists

```html
<li :each="user in users" :key="user.id">{{ $index }}: {{ user.name }}</li>
```

The list is diffed by key: unchanged items keep their DOM (and state) when the array is reordered, filtered or extended. Without `:key`, position is used — fine for append-only lists, wasteful for reordering. `$index` is available inside each item.

### `@event` — listeners

```html
<button @click="onClick">…</button>
<form @submit.prevent="$event => onSubmit($event)">…</form>
<button @click="count = count + 1">clicked {{ count }} times</button>
```

The attribute value is evaluated on every event with `$event` in scope; if it evaluates to a function, that function is called with the event. So all three styles work: a handler reference, an inline arrow, or an inline statement that mutates reactive data.

Modifiers (chainable, e.g. `@click.stop.once`):

| modifier   | effect                                   |
| ---------- | ---------------------------------------- |
| `.prevent` | `event.preventDefault()`                 |
| `.stop`    | `event.stopPropagation()`                |
| `.self`    | only fire when `event.target` is the element itself |
| `.once`    | listener runs at most once               |
| `.capture` | listen in the capture phase              |

### Nested components

A tag matching a **PascalCase scope variable** renders as a child component. Components reach the scope through render data, `:setup` props, or an `await import(...)` in the setup script:

```html
<script :setup="{ user, NestedComponent }">
  const ImportedComponent = await import('/components/foobar.html')
</script>

<div>
  <NestedComponent :user :title="'Hardcoded title'" />
  <ImportedComponent :user="user" />
</div>
```

```html
<!-- /components/foobar.html -->
<script :setup="{ user }"></script>
<div>User: {{ user.firstName }}</div>
```

- Props: `:name="expr"` evaluates in the parent scope; `:name` alone is shorthand for `:name="name"`; plain attributes pass as literal strings.
- Props are **live**: when a parent expression's dependencies change (deeply), the new value is written into the child's store.
- HTML lowercases everything, so matching ignores case and dashes: `<NestedComponent>` and `<nested-component>` both resolve `NestedComponent`, and `:user-name` becomes the `userName` prop.
- `await import('/x.html')` returns a `Component79` (non-`.html` URLs fall through to native `import()`). While the promise is pending nothing renders; the child appears when it resolves.
- Each usage site gets its own instance (own store, effects and DOM); instances are destroyed with their parent. Identical `<style>` blocks are refcounted, so N instances inject one tag.
- Self-closing tags work: jq79 expands `<MyComponent />` (and `<div />`) into explicit open+close pairs before HTML parsing, since the HTML parser would otherwise treat them as unclosed. Void elements (`<img />`, `<br />`) and `<script>`/`<style>` contents are left untouched.

## Setup scripts

`<script :setup>` blocks run against the component's reactive scope, Svelte-style:

```html
<script :setup="{ fname, lname }">
  let count = 0                    // top-level let/var/const become reactive scope vars
  const greeting = `Hi ${fname}`   // initialized once, visible to the template

  $: doubled = count * 2           // re-runs whenever `count` changes

  setInterval(() => { count++ }, 1000)   // assignments from callbacks work too
</script>
```

- Top-level `let` / `var` / `const` declarations become properties of the reactive store (also reachable from outside via `jq79.data`).
- `$: x = expr` is a reactive declaration: it re-runs whenever anything it reads changes.
- Assignments — including from `.then()` callbacks, timers, and event handlers — go through the reactive proxy and update the DOM.
- Globals (`fetch`, `console`, `Promise`, …) resolve normally; assignments to names you never declared stay on the component scope instead of leaking to `globalThis`.
- The [DOM helpers](#dom-helpers) `$`, `$$` and `$create`, plus [`$reactive`](#reactive-data), are available without importing anything — `<script :setup="{ $, $$, $create, $reactive }">`. Like globals, they are shadowed by same-named scope properties.
- `$emit(eventName, payload)` dispatches a native bubbling `CustomEvent` (with `payload` as `event.detail`) from the component's position in the DOM. Listen from a parent component with `@event-name` on any wrapping element, or with plain `addEventListener` on the mount target:

```html
<!-- child -->
<script :setup>
  const save = () => $emit("saved", { id: 42 })
</script>
<button @click="save">Save</button>

<!-- parent -->
<div @saved="lastSaved = $event.detail.id">
  <ChildForm />
</div>
```

  Events emitted before the component is mounted have no ancestors to bubble to, so nobody hears them — `$emit` is meant for handlers and async code, not synchronous top-level setup.

Only top-level code is rewritten; declarations inside callbacks/blocks behave as plain JS. `let a = 1, b = 2` multi-declarators are not supported — one declaration per statement.

## Reactive data

The store used by components is available standalone:

```js
import { $reactive } from "jq79"   // also injected into setup scripts

const data = $reactive({ user: { address: { city: "NYC" } } })

data.$on("user.address.city", (value, dotKey) => { … }, { immediate: true })
data.$onAny((dotKey, value) => { … })
const stop = data.$effect(() => {
  // re-runs whenever anything it *read* changes (fine-grained, deep)
  console.log(data.user.address.city)
})

data.user.address.city = "LA"   // deep mutations notify with the full dot path
stop()                          // effects/listeners return an unsubscribe fn
```

## DOM helpers

```js
import { $, $$, $create } from "jq79"

$(".card")            // document.querySelector
$(el, ".card")        // scoped querySelector
$$(".card")           // querySelectorAll, as a real Array
$$(el, ".card")       // scoped

$create("div", {      // document.createElement + attrs
  className: ["card", "active"],   // string or array
  textContent: "hi",
  children: [$create("span")],
  "data-id": "42",                 // anything else via setAttribute
})
```

## Development

```sh
npm install
npm test         # vitest + jsdom
npm run build    # tsup → dist/ (ESM + CJS + IIFE + .d.ts)
```

## Publishing

Releases are automated via GitHub Actions ([release.yml](.github/workflows/release.yml)):

```sh
npm version patch|minor|major   # bumps package.json and creates the vX.Y.Z tag
git push --follow-tags
```

Pushing the tag runs tests + build, creates the GitHub release with the `dist/` files attached, and publishes to npm with provenance. Requires an `NPM_TOKEN` repository secret (npm automation token). CDNs (unpkg, jsDelivr, esm.sh) pick the new version up from npm automatically.

Every push/PR to `main` also runs tests + build ([ci.yml](.github/workflows/ci.yml)).

## License

ISC
