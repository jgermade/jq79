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

## `:class` — reactive classes

Adds classes on top of the static `class` attribute — it never replaces it. The expression may be a string, an object, or an array:

```html
<button class="btn" :class="{ 'btn-active': active }">go</button>
<div :class="theme"></div>
<div :class="[theme, { active }]"></div>
```

- **string** — split on whitespace, each token a class.
- **object** — keys whose values are truthy become classes; a key may hold several space-separated names.
- **array** — entries normalized recursively, so strings and objects mix.
- Anything else (`null`, `undefined`, `false`, numbers) contributes nothing — so `:class="cond && 'active'"` reads naturally.

Only classes the binding added are ever removed: the static list survives every re-run, even when the expression names one of its classes and then drops it (`class="btn" :class="{ btn: cond }"` keeps `btn` when `cond` goes false).

Don't combine it with a `class` key inside `:attrs` on the same element — `:attrs` rewrites the whole attribute on each of its runs, wiping whatever `:class` added. On a nested-component tag `:class` is ignored, like `:text`/`:html`.

## `:value` / `:checked` / `:selected` — form state

These write the DOM **property**, not the attribute. The difference matters on form controls: the attribute is only the control's *default*, and detaches the moment the user interacts — `:attrs="{ value }"` stops driving an input once something has been typed into it. The property directives keep driving it:

```html
<input :value="name" @input="name = $event.target.value">
<input type="checkbox" :checked="agreed" @change="agreed = $event.target.checked">
<select :value="lang">
  <option value="en">en</option>
  <option value="es">es</option>
</select>
```

- `:value` coerces to a string (`null`/`undefined` become `""`) and skips the write when the property already holds it, so an unrelated re-run can't move the caret of the input the user is typing into. On a `<select>` it selects the matching `<option>`.
- `:checked` / `:selected` coerce to booleans.
- One-way, store → DOM. The way back is an explicit `@input`/`@change`, as above — the store stays the single source of truth.
- On a nested-component tag they're ignored, like `:class`/`:text`.

## `:text` / `:html` — content

Set an element's content directly from an expression, instead of interpolating inside its children.

```html
<span :text="user.name"></span>
<div :html="markdownToHtml(post.body)"></div>
```

- `:text` sets `textContent` — safe for any string, no markup is parsed.
- `:html` sets `innerHTML` after passing the value through `sanitizeHTML` (stripping anything not in a small allowlist of tags/attributes, and unsafe `href`/`src` protocols) — use it for untrusted or user-authored HTML. Content nested deeper than 512 elements throws a `RangeError` (browser parsers flatten beyond that anyway, so no legitimate document loses anything).
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

A second binding names the array index — handy where nested loops would shadow `$index` — and plain objects iterate as their entries, the second binding being the property key (parens optional):

```html
<li :each="item, i in items">{{ i }}: {{ item.name }}</li>
<li :each="(value, key) in labels">{{ key }} = {{ value }}</li>
```

Objects diff by property key out of the box: adding, changing or deleting a key touches only that entry. Anything that is neither an array nor a plain object renders nothing.

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
