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

- The `:setup` attribute's value is the component's **prop signature**: `:setup="{ fname, lname = 'Lovelace' }"` declares the props the parent passes, with optional defaults, and the defaults are on the store before the first render. It's a declaration, not a comment — see [props](components.md#props).
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

A `$:` declaration may span several lines: a line break only ends it if the next line can't continue the expression, the same call JavaScript's semicolon insertion makes. So method chains and operator chains work as written:

```js
$: activeNames = users
  .filter(user => user.active)
  .map(user => user.name)

$: total = subtotal
  + shipping
  - discount
```

## Keeping something out of the store

An effect tracks every scope variable it *reads*, and re-runs when one of them
changes — so an effect that both reads and writes the same variable wakes itself
up, forever:

```js
let timer = null                       // top-level → a reactive scope var

const schedule = () => {
  clearTimeout(timer)                  // reads `timer`…
  timer = setTimeout(save, 250)        // …and writes it: the effect below loops
}

$: schedule(draft)
```

Worth knowing how this one fails, because it doesn't fail where you'd look: an
effect's dependencies are recorded *after* its first run, so that first pass —
the one during render — writes `timer` while the effect is still tracking
nothing, and everything looks fine. It's the **next** change to `draft` that
finds `timer` in the dependency list and re-runs the effect on repeat. The
runtime cuts the loop after 100 rounds and says so in the console (`an effect
re-woke itself 100 times in a row`) — but by then the side effects have run
100 times. A component that renders perfectly can still be carrying this.
(Re-writing the *same* primitive value doesn't count as a change, so a plain
normalizing assignment settles on its own.)

Bookkeeping like a timer handle, a cached instance or a "did I already run this"
flag isn't state the template renders — it has no business in the store. Since
only *top-level* declarations are rewritten, a closure keeps it plain JS:

```js
const schedule = (() => {
  let timer = null                     // inside a function → not reactive

  return () => {
    clearTimeout(timer)
    timer = setTimeout(save, 250)
  }
})()

$: schedule(draft)                     // re-runs when `draft` changes. Only `draft`
```

## Effects run before the template exists

`$:` declarations run where they sit, during the script — which is *before* the
component has rendered any DOM. An effect that reaches for an element gets
nothing on that first pass, and if none of its dependencies change afterwards it
never runs again:

```html
<script :setup>
  let query = ""

  // runs once, immediately, with no DOM to find - and `query` never changes on
  // its own, so this is the only time it ever runs
  $: $self(".search")?.focus()
</script>
```

The fix is to do the first pass yourself, after the DOM is there:

```html
<script :setup>
  let query = ""

  const highlight = () => {
    const box = $self(".search")
    if (!box) return                 // the setup-time pass, before there's any DOM
    box.classList.toggle("filled", query.length > 0)
  }

  $: highlight(query)                // keeps it in sync from here on

  await $mounted()

  highlight()                        // the first pass that can actually see the DOM
</script>
```

`:mounted` on the tag does the same for a whole script (it behaves as if
`await $mounted()` were its first line), which is simpler when *nothing* in the
script needs to run before render.

## Debugging a script

Setup scripts are compiled with `new Function` — they need `with`, which is a `SyntaxError` inside an ES module — so they aren't part of any bundle and no bundler source map reaches them. To keep them debuggable, each compiled script is named after the component it came from:

```
UserCard.html?jq79-script=0
```

It shows up under that name in the devtools sources tree and in stack traces, breakpoints set in it survive a reload, and a component with two `<script>` blocks gets one entry per block (`…=0`, `…=1`). The name comes from where the component was loaded: the URL for `Component79.fetch(url)`, the path relative to the project root for the [Vite plugin](vite-plugin.md). A component built from an inline string has no origin to name, so its scripts stay anonymous.

What devtools shows under that name is the *compiled* script — the rewritten code (`$__effect(…)` instead of `$:`), wrapped in the function the engine built. Its line numbers are the compiled script's own, not the `.html` file's; the engine's function header shifts everything down and a `<script>` on line 1 can't be shifted back up. Reporting the component's own lines would need the runtime to emit a source map, which it doesn't do today.

## Factory scripts (`export default`)

A `<script>` whose top level has an `export default` runs as a **plain
lexical module** instead of a setup script — for when you want standard JS
that editors, linters and type-checkers understand with no configuration:

```html
<script>
import UserCard from "./UserCard.html"

export default ({ step = 1 }, { $data, $effect, $emit }) => {
  $data.count = 0
  $effect(() => { $data.double = $data.count * 2 })

  const inc = () => { $data.count += step }

  return { UserCard, inc }
}
</script>

<button @click="inc">{{ count }} / {{ double }}</button>
<UserCard></UserCard>
```

The default export is called with **the props first and the instance context second**, and may be `async`. The first parameter is the component's [prop signature](components.md#props) — the runtime reads it from the source, so its defaults reach the template even before an async factory has run. A factory that takes no props writes `_` (permissive) or `{}` (a closed signature) in its place; the slot is where the tooling looks.

The context is everything the library provides — the `$` is what says so:

- `$data` — the reactive store (props included). **Reactivity is explicit
  here**: there's no `with` magic and no `$:` labels, so a local `count++`
  changes nothing — write `$data.count++`.
- `$props` — the same store, under the name that says what you're reading.
  Destructuring copies, so a **primitive the parent reassigns** goes stale in
  your local binding; read it through `$props` when you need the live value.
- `$effect(fn)` — re-runs `fn` when anything it reads from `$data` changes;
  disposed with the component.
- `$emit`, `$mounted`, `$self`, `$$self` — same as in setup scripts. `$`,
  `$$`, `$create` and `$reactive` are available lexically in the module body.
- The **returned object is merged into the store**, making its entries
  visible to the template — that's how imported components and methods are
  exposed (`return { UserCard, inc }`).

Details worth knowing:

- **Imports are real**: static `import` statements work (rewritten at runtime
  to awaited dynamic imports — `.html` files resolve to components via fetch,
  everything else via native `import()`; under the [Vite plugin](vite-plugin.md)
  they're bundled). Only `export default` is supported — no named exports.
- Import bindings are lexical, not scope vars: to use an imported component
  in the template, expose it via the return value or `$data`.
- A fully synchronous module body runs before the first render, like a setup
  script. Static imports and top-level `await` make it async — the template
  renders first and updates when the factory's result lands.
- `:mounted` on the tag works the same way: the whole script waits for mount.
- Mode detection is backwards-safe: `export default` was a syntax error in setup
  scripts, so no setup script can turn into a factory. `:setup` isn't going
  anywhere — the two styles coexist, even within one component.
- **Breaking change (0.4):** the ctx used to be the factory's *first* parameter.
  It's now the second, and props are the first. Arity can't tell the two apart
  (`({ user })` is a valid signature under either), so the runtime looks at the
  pattern instead: a `$`-prefixed name destructured from the first parameter
  throws an explicit migration error rather than handing you an `undefined`
  `$data`. Rewrite `({ $data }) => …` as `(_, { $data }) => …`, or name the props
  the component actually takes.
