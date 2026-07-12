# jq79

A mini reactive component library in a single file. Single-file components (template + `<script :setup>` + `<style>`), Svelte-style reactive scripts, fine-grained DOM updates via proxy-based dependency tracking — no compiler, no virtual DOM, no dependencies.

## Installation

```sh
npm install jq79
```

```js
import { Component79, $, $$ } from "jq79"
```

Or grab [`src/jq79.ts`](src/jq79.ts) directly — the whole library is one file.

## Quick start

```js
import { Component79 } from "jq79"

const c79 = new Component79(`
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

c79.render().mount("#app")
```

When the fetch resolves, the assignments to `firstName`/`lastName` re-run the `$:` declaration, which flips the `:if` and renders the span — no manual wiring.

## Components

### Lifecycle

```js
const c79 = new Component79(src)      // src: string, or { template, scripts, styles }

c79.render(data)                      // build reactive DOM, run setup scripts, inject styles
   .mount(el)                         // attach; accepts an Element or a selector string

c79.unmount()                         // detach, keeping state — mount() re-attaches, with
                                      // any updates that happened while detached applied
   .destroy()                         // dispose all effects and remove injected styles
```

- `render(data)` injects the component's `<style>` blocks into `document.head`.
- `renderShadow(data)` instead attaches a shadow root to the mount target and injects content and styles there, so CSS stays scoped to the component.
- `c79.data` is the live reactive store — mutate it from outside and the DOM follows.

### Loading remote components

```js
const c79 = await Component79.fetch("/components/user-card.html")
c79.render({ userId: 42 }).mount("#app")
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

- Top-level `let` / `var` / `const` declarations become properties of the reactive store (also reachable from outside via `c79.data`).
- `$: x = expr` is a reactive declaration: it re-runs whenever anything it reads changes.
- Assignments — including from `.then()` callbacks, timers, and event handlers — go through the reactive proxy and update the DOM.
- Globals (`fetch`, `console`, `Promise`, …) resolve normally; assignments to names you never declared stay on the component scope instead of leaking to `globalThis`.

Only top-level code is rewritten; declarations inside callbacks/blocks behave as plain JS. `let a = 1, b = 2` multi-declarators are not supported — one declaration per statement.

## Reactive data

The store used by components is available standalone:

```js
import { createReactiveDeepData } from "jq79"

const data = createReactiveDeepData({ user: { address: { city: "NYC" } } })

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
import { $, $$ } from "jq79"

$(".card")            // document.querySelector
$(el, ".card")        // scoped querySelector
$$(".card")           // querySelectorAll, as a real Array
$$(el, ".card")       // scoped
```

## Development

```sh
npm install
npm test        # vitest + jsdom
```

## License

ISC
