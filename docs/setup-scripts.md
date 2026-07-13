# Setup scripts

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
- The [DOM helpers](dom-helpers.md) `$`, `$$` and `$create`, plus [`$reactive`](reactive-data.md), are automatically available in every setup script — no import or declaration needed, same as `$emit` and `$mounted`. Like globals, they are shadowed by same-named scope properties.
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

  From JS, subscribe on the instance itself with `on(eventName, (event, payload) => …)` — `payload` is the same value as `event.detail`. `on`/`off` are chainable, can be called before mounting, and survive re-renders:

```js
new Component79(src)
  .on("saved", (e, payload) => console.log(payload.id))
  .on("cancelled", () => console.log("cancelled"))
  .mount("#app")
```

  Events emitted before the component is mounted have no ancestors to bubble to, so no DOM listener hears them (`$emit` is meant for handlers and async code, not synchronous top-level setup) — but instance `on()` listeners are notified even while detached.

- `await $mounted()` suspends the script until the component is attached to the DOM, so everything below it can use `querySelector` (or `$`/`$$`) directly:

```html
<script :setup>
  let items = await fetchItems()   // runs before render

  await $mounted()

  let height = $(".list").offsetHeight   // real DOM access — still reactive
</script>
<ul class="list">
  <li :each="item in items">{{ item }}</li>
</ul>
```

  Reactivity is unaffected by where a declaration sits: variables declared after the `await` are pre-declared on the store before the first render (as `undefined`), so the template can bind to them from the start and updates when the assignment runs. If the component is never mounted, the code after `await $mounted()` never runs.

  To defer a whole script until mount, add `:mounted` to the tag — it behaves as if `await $mounted()` were its first line:

```html
<script :setup :mounted>
  $self(".list").focus()   // the component is already in the DOM
</script>
```

- `$self(selector)` and `$$self(selector)` are component-scoped versions of [`$` / `$$`](dom-helpers.md): they only search this component instance's own rendered nodes, so they can't accidentally match another component (or anything else in the page). They work even while the component is rendered but not yet mounted — but remember the template renders *after* the synchronous part of the script, so call them from post-`await $mounted()` code or from handlers/callbacks.

Only top-level code is rewritten; declarations inside callbacks/blocks behave as plain JS. `let a = 1, b = 2` multi-declarators are not supported — one declaration per statement.
