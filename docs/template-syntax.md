# Template syntax

## Interpolation

Any JS expression between `{{ }}`:

```html
<span>{{ user.name }}</span>
<span>{{ price * quantity }} €</span>
```

Expressions may span several lines — both here and in every directive (`:if`, `:each`, `:attrs`, `@event`, …):

```html
<span>{{ items
  .filter(item => item.active)
  .length }}</span>
```

## Whitespace

A template is HTML, and its whitespace is HTML's: it reaches the DOM as written, and CSS decides what it's worth. Two elements on separate lines are separated by a space when they render inline — the same space you'd get from the same markup in an `.html` file — and by nothing when they're block or flex children. If you don't want the space, close the tags against each other (`</span><span>`) as you would anywhere else.

The one exception is the indentation *between* the branches of an `:if`/`:elseif`/`:else` chain, which is dropped: only one branch is ever in the DOM, so there's nothing for it to be a space between.

## `:attrs` — dynamic attributes

Evaluates to an object; each entry becomes an attribute. `null`, `undefined` and `false` values remove the attribute.

```html
<button :attrs="{ disabled: isSaving, title: tooltip }">Save</button>
```

## `:text` / `:html` — content

Set an element's content directly from an expression, instead of interpolating inside its children.

```html
<span :text="user.name"></span>
<div :html="markdownToHtml(post.body)"></div>
```

- `:text` sets `textContent` — safe for any string, no markup is parsed.
- `:html` sets `innerHTML` after passing the value through `sanitizeHTML` (stripping anything not in a small allowlist of tags/attributes, and unsafe `href`/`src` protocols) — use it for untrusted or user-authored HTML.
- Either one replaces the element's own children entirely; they don't combine with nested template content.
- If both are present on the same element, `:text` wins and `:html` is ignored.
- They apply to plain elements only; on a nested-component tag they're ignored.

## `:if` / `:elseif` / `:else` — conditionals

Consecutive siblings form one chain; only the active branch is in the DOM.

```html
<div :if="score > 8">great</div>
<div :elseif="score > 4">ok</div>
<div :else>bad</div>
```

## `:each` / `:key` — lists

```html
<li :each="user in users" :key="user.id">{{ $index }}: {{ user.name }}</li>
```

The list is diffed by key: unchanged items keep their DOM (and state) when the array is reordered, filtered or extended. Without `:key`, position is used — fine for append-only lists, wasteful for reordering. `$index` is available inside each item.

## `:with` — narrowed scope

Evaluates to an object whose properties become directly addressable inside the element; anything else still resolves from the outer scope:

```html
<div :each="item in items">
  <div>{{ item.name }}</div>
  <div :with="item">
    Another way to get: {{ name }}
    Items total: {{ items.length }}
  </div>
</div>
```

- Applies to the element's own bindings (`:attrs`, `@events`) and its whole subtree; object properties shadow same-named outer scope names.
- Fully reactive: mutating a property of the object, or replacing the object itself (`user = other`), updates exactly what depends on it — the subtree is not rebuilt.
- Assignments to names the object owns write through to it (`@click="name = 'x'"` inside `:with="user"` sets `user.name`, reactively).
- If the expression isn't an object (`null`, still loading, …), names simply resolve from the outer scope.
- Combines with `:each`/`:if` on the same element: those evaluate in the outer scope first, then `:with` wraps the subtree — so `:with="item"` on the `:each` element itself works.

## `@event` — listeners

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

## Nested components

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
- `await import('/x.html')` returns a `Component79` (non-`.html` URLs fall through to native `import()`). While the promise is pending nothing renders; the child appears when it resolves. Under the [Vite plugin](vite-plugin.md), literal relative specifiers resolve from the bundle instead of fetching.
- Each usage site gets its own instance (own store, effects and DOM); instances are destroyed with their parent. Identical `<style>` blocks are refcounted, so N instances inject one tag.
- Self-closing tags work: jq79 expands `<MyComponent />` (and `<div />`) into explicit open+close pairs before HTML parsing, since the HTML parser would otherwise treat them as unclosed. Void elements (`<img />`, `<br />`) and `<script>`/`<style>` contents are left untouched.
