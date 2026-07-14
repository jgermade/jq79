# Components

## Lifecycle

```js
// src: string, or { template, scripts, styles }
const jq79 = new Component79(src)

// subscribe to the component's $emit events
jq79.on("submit", (e, payload) => {})  
    .off("submit", listener) // unsubscribe

// render (reactive DOM, setup scripts, styles) + attach
// el: Element or selector string; data is optional
jq79.mount(el, data)

// detach, keeping state — mount(el) re-attaches, with
// any updates that happened while detached applied
jq79.detach()                          
   .destroy() // dispose all effects and remove injected styles
```

- `mount(el, data?)` renders on the first mount, and re-renders fresh whenever `data` is passed. `mount(el)` on an already-rendered component just re-attaches, keeping its state — the `detach()`/`mount()` round trip. Styles go into `document.head`.
- `mountShadow(el, data?)` instead attaches a shadow root to the target and injects content and styles there, so CSS stays scoped to the component.
- `render(data)` / `renderShadow(data)` are also available standalone, for rendering while detached (effects keep the detached DOM up to date; a later `mount(el)` attaches it).
- `jq79.data` is the live reactive store — mutate it from outside and the DOM follows.
- `on(eventName, (event, payload) => …)` hears the events the component emits with `$emit` — see [setup scripts](setup-scripts.md).

## Styles

A `<style>` block goes into `document.head` as-is, shared globally. Add `scoped` and its rules only reach the elements this component rendered:

```html
<div class="card">
  <span class="title">{{ title }}</span>
</div>

<style scoped>
  .card .title { color: rebeccapurple; }
</style>
```

Every element of the component's template is stamped with a `data-jq79="<hash>"` attribute, and the CSS is rewritten to require it:

```css
.card .title[data-jq79="1a2b3c"] { color: rebeccapurple; }
```

The hash comes from the component source, so all instances of a definition share one scope and one refcounted `<style>` in the head. The rewrite happens at parse time in the browser, so it works the same whether the component was bundled by the [Vite plugin](vite-plugin.md) or fetched at runtime.

Notes:

- **Scoping stops at the component boundary.** A nested component's elements carry their own scope, not the parent's, so a parent's scoped rules can't style a child's internals. Vue's `:deep()` escape hatch is not supported (it isn't real CSS — the browser drops the rule — and jq79 warns if it sees one).
- `@keyframes` are left untouched, so animation names are still global: prefix them if two components might collide.
- Pseudo-elements stay last (`.a::before` → `.a[data-jq79="…"]::before`), and `@media`/`@supports`/`@container` blocks are scoped inside.
- **`mountShadow` ignores `scoped`.** A shadow root already scopes, so it gets the CSS as written — which is also what lets `:host { … }` keep working (the host element is outside the template, so it never carries the stamp, and a scoped `:host[data-jq79="…"]` would match nothing). The same component can be mounted both ways: head-mounted instances get the scoped rewrite, shadow-mounted ones get the source.
- **`mountShadow` covers the whole tree.** Nested components render inside their parent's shadow root, so their `<style>` goes in there with them (inline, next to the DOM it styles) rather than into `document.head` — which couldn't style them anyway, and would leak their CSS onto the page around the host. The trade-off is that a shadow tree's styles aren't refcounted: N instances of the same child inject N `<style>` tags inside the root, and they go away with them.
- `mountShadow` remains the stronger option overall: a shadow root also blocks outside CSS from coming *in*, which `scoped` deliberately doesn't.
- `<style lang="scss">` (and `less`/`stylus`) is compiled by the [Vite plugin](vite-plugin.md#style-lang--css-preprocessors) and composes with `scoped` — but it only works for components that go through the bundler, unlike everything else here.

## Loading remote components

```js
const jq79 = await Component79.fetch("/components/user-card.html")
jq79.mount("#app", { userId: 42 })
```
