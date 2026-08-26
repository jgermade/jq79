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

An expression that throws renders as nothing rather than tearing down the render, because it is re-evaluated constantly — once per effect run, once per `:each` item. It doesn't stay a secret, though: it reaches the console as an error, once per expression. That includes a value that simply hasn't loaded yet, so write `{{ user?.name }}` (or gate the element with `:if`) when you expect one to be late. See [debugging a script](setup-scripts.md#debugging-a-script).

## Whitespace

A template is HTML, and its whitespace is HTML's: it reaches the DOM as written, and CSS decides what it's worth. Two elements on separate lines are separated by a space when they render inline — the same space you'd get from the same markup in an `.html` file — and by nothing when they're block or flex children. If you don't want the space, close the tags against each other (`</span><span>`) as you would anywhere else.

The one exception is the indentation *between* the branches of an `:if`/`:elseif`/`:else` chain, which is dropped: only one branch is ever in the DOM, so there's nothing for it to be a space between.

## `:attr` — one dynamic attribute

`:<name>="expr"` binds a single attribute, reactively:

```html
<button :disabled="isSaving">Save</button>
<a :href="`/users/${user.id}`">profile</a>
<div :aria-expanded="open"></div>
```

- `:name` alone is shorthand for `:name="name"`, like props and `:model.<name>`. The attribute keeps its written (kebab) name while the expression reads the camelCase variable, so `:aria-expanded` binds `ariaExpanded` — `aria-expanded` as an expression would be a subtraction.
- Every name listed on this page is reserved and keeps its own meaning: `:if`, `:each`, `:class`, `:text`, `:attrs`, `:model`, `:value`/`:checked`/`:selected`, and the rest. So `:value` is the form-state directive (the DOM *property*), never the `value` attribute.
- On a **component tag** `:name` is a prop, not an attribute — a jq79 component has no single root for one to land on. See [nested components](#nested-components).

### The value rule

Shared with `:attrs`, so the two forms can never disagree:

| value | boolean attribute (`disabled`, `checked`, `readonly`, …) | any other attribute |
| ----- | --- | --- |
| `null` / `undefined` | removed | removed |
| `false`, `0`, `""` | removed | written (`"false"`, `"0"`, `""`) |
| truthy | written as `""` | written as `String(value)` |

A boolean attribute counts as *present*, whatever its value — `disabled="false"` disables — so anything falsy removes it and a truthy value writes nothing. `:disabled="items.length"` enables the button on an empty list, which is what it reads like.

Everything else keeps `false` and `0`, because absent and `"false"` are different things: `aria-expanded="false"` is meaningful ARIA, and so is a `data-` flag.

The boolean names are [HTML's list](https://html.spec.whatwg.org/multipage/indices.html#attributes-3): `allowfullscreen`, `async`, `autofocus`, `autoplay`, `checked`, `controls`, `default`, `defer`, `disabled`, `formnovalidate`, `inert`, `ismap`, `itemscope`, `loop`, `multiple`, `muted`, `nomodule`, `novalidate`, `open`, `playsinline`, `readonly`, `required`, `reversed`, `selected`.

## `:attrs` — several dynamic attributes at once

Evaluates to an object; each entry becomes an attribute, under the value rule above. Reach for it when the key set is dynamic (a spread, a computed object); for one known attribute, `:attr` says it in less.

```html
<button :attrs="{ disabled: isSaving, title: tooltip }">Save</button>
<div :attrs="theme.wrapperAttrs"></div>
```

`:attrs` is wholesale — each run removes what it set and writes the new object — so don't bind the same name with both forms on one element: the `:attrs` re-run would wipe what `:attr` wrote until it happened to re-run too.

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

For the common case of one class gated by one condition, `:class.<name>="expr"` is a shorthand for `:class="{ <name>: expr }"` — it toggles the single class `<name>` on when `expr` is truthy:

```html
<div class="drop" :class.active="dropping"></div>
```

Write it kebab-case (`:class.is-active`) or camelCase (`:class.isActive`) — the two are the same name (see [name casing](#name-casing)). It coexists with `:class` and with other `:class.<name>` on the same element; the sets union.

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

### `:html.allowed` — destination policy

The sanitizer always blocks *executable* URLs (`javascript:`, `data:`), but by default it doesn't care **where** a link or image points. `:html.allowed` adds that restriction, per element — different zones of one page can trust different destinations, which is the one thing a page-wide `Content-Security-Policy` can't express:

```html
<div :html="body" :html.allowed="'*.germade.dev'"></div>
<div :html="body" :html.allowed="['*.germade.dev', '*.germade.es']"></div>
<div :html="body" :html.allowed="url => url.hostname.endsWith('.germade.dev')"></div>
```

The value is an expression, like every `:` attribute: a comma-separated string or array of host patterns, or a predicate `(url: URL, tag, attr) => boolean` called with the URL already resolved against the page (so relative URLs are judged as the same-origin destinations they are). A rejected `href`/`src` is stripped; the element and its text stay.

Pattern grammar — `host[:port]`:

- `*` matches **exactly one DNS label** (the TLS-certificate wildcard rule, not CSP's any-depth one): `*.germade.dev` matches `a.germade.dev`, but neither `germade.dev` (list both to include the apex) nor `a.b.germade.dev`.
- No port matches any port; an explicit port must equal the URL's effective port (`germade.dev:443` matches `https://germade.dev/`).
- Everything broken fails **closed**: an invalid pattern matches nothing, a policy that evaluates to `undefined` denies all destinations, a throwing predicate is a no. And no policy can re-admit what the protocol check blocked.
- Patterns speak hosts, so a URL without one (`mailto:`) never matches a pattern list — use the function form to allow it.

Without `.allowed`, `:html` keeps its default: protocol check only, any destination. For a page-wide floor, set a `Content-Security-Policy` — the two compose, and the stricter one wins.
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

A chain is **one `:if`, any number of `:elseif`, at most one `:else`**, on adjacent sibling elements — only whitespace may sit between them, and the `:else` closes the chain. Break that and the branch renders *unconditionally*, because `:elseif`/`:else` mean nothing on their own. The chains are checked when the component is **parsed**, so a broken one is reported once per definition — before any data exists, and whether or not the branch it sits in ever renders:

```html
<div :if="a">A</div>
<hr />
<div :else>B</div>            <!-- :else on <div> continues no :if: the <hr> broke the chain -->

<div :if="a">A</div>
<div :else>B</div>
<div :else>C</div>            <!-- a second :else: the chain already ended -->

<div :if="a" :else>A</div>    <!-- two on one element: only :if applies -->
```

A `:each` element between the branches breaks the chain like any other element, and `:if`/`:elseif`/`:else` **on** a `:each` element are ignored (with their own warning) — filter the list expression instead.

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

They also fail the same way: an exception thrown while handling the event reaches the console with its stack, whichever style raised it. The one exception is a name that resolves nowhere (`@click="handleClik"`), which is reported once as a warning instead — see [debugging a script](setup-scripts.md#debugging-a-script).

Modifiers (chainable, e.g. `@click.stop.once`):

| modifier   | effect                                   |
| ---------- | ---------------------------------------- |
| `.prevent` | `event.preventDefault()`                 |
| `.stop`    | `event.stopPropagation()`                |
| `.self`    | only fire when `event.target` is the element itself |
| `.once`    | listener runs at most once               |
| `.capture` | listen in the capture phase              |

### `@event` on a component tag

A component tag renders as comment anchors — there is no element to listen on — so `@event` there subscribes to that child's [`$emit`](setup-scripts.md) channel instead:

```html
<Stepper @changed="last = $event.detail" />
```

It hears exactly what *that* child emits: not a grandchild's emits (those arrive only as an explicit re-emit), and not native DOM events from the child's inner DOM — a native `submit` bubbles past the tag's anchors to real ancestors, so it's still a wrapping element's to catch (`<div @submit.prevent=…><LoginForm/></div>`, which hears `$emit`s too, since they bubble). Modifiers on this channel: `.prevent` flips the child's `$emit(...)` return to `false` — a "the parent vetoed" signal; `.stop` keeps the emit off the DOM entirely, so wrapping elements never hear it; `.once` unsubscribes after one call; `.self` and `.capture` have no meaning here and are ignored.

## `:model` — two-way component binding

Props flow down, events flow up; `:model` wires both at once. The model's name rides the modifier (an expression-valued modifier, like `:html.allowed`), and one tag can carry several:

```html
<LoginForm :model.uname="uname" :model.password="password" />
<EmailField :model="email" />
```

Each `:model[.name]="expr"` is two bindings:

- **A live prop down**, named after the model — the modifier name, camelCase in the child whichever way it was written in the attribute (like any prop, see [name casing](#name-casing)), or `model` for the bare `:model`. The child reads it like any prop, and a parent write (`email = ""`) reaches the child's input.
- **A writeback up**: the child calls [`$updateModel`](setup-scripts.md) — `$updateModel(value)` for the default model (the bare `:model`), `$updateModel(name, value)` for a named one — and the matching model's expression is assigned the value. The expression must be an assignment target (`uname`, `user.name`); it's evaluated in the parent scope, so it writes the store reactively, and through a `:with` narrowing.

The child's whole side is one call, straight from the template if it's simple enough:

```html
<!-- EmailField.html -->
<input :value="model" @input="$updateModel($event.target.value)">
```

- `:model.uname` alone is shorthand for `:model.uname="uname"`, like props.
- A `name` that nothing on the tag binds warns and writes nothing — a typo must not type into the void — as does an expression that can't be assigned to (warned when the tag renders, not on the first update that would vanish). Both make `$updateModel` return `false`.
- The echo terminates: the writeback re-runs the prop sync, but the store skips same-value writes and `:value` never rewrites the string an input already holds — the caret stays put.
- Component tags only (for now): on a plain element it warns and does nothing. The `:value` + `@input` pair above is the native-element way.

## `:props` — spreading an object as props

Passes an object's own properties to a child as props, instead of naming each one. `...expr` is sugar for it:

```html
<SdkInfo :props="sdk" />                 <!-- name, version, arch, … as props -->
<SdkInfo ...sdk />                        <!-- same thing -->
<SdkInfo ...sdk :arch="'arm64'" />        <!-- spread, then override one -->
```

- **Live**, like any prop: adding, changing or removing a property of the object updates the child, and a key that disappears un-sets the prop.
- **Precedence is source order**, the JS object-spread rule — a binding written *after* a spread wins, one written *before* it loses. `...sdk :arch="x"` is `{ ...sdk, arch: x }` (explicit wins); `:arch="x" ...sdk` is `{ ...sdk }` last (the spread wins). `:model` always wins, as its own section promises.
- **`...expr` takes an identifier or member path** (`...sdk`, `...props.user`) and **preserves camelCase exactly** — `...userData` spreads that object, and unlike a directive name it is an *expression*, so it is not kebab-normalized. It's rewritten to `:props` before HTML parsing, from the raw source, so the parser's name-lowercasing never touches it. A call (`...getProps()`) isn't taken; use the value form `:props="getProps()"`.
- **A bare `:props="x"` may appear once per tag** — two are identical attribute *names*, and the HTML parser keeps only the first. To compose several spreads use the `...` sugar (which suffixes them internally) or hand-written `:props.0`/`:props.1`: `...a ...b` merges both, `:props="a" :props="b"` silently drops the second.
- A spread whose expression isn't an object contributes nothing (fails closed, like `:with`), so an `await`-pending value spreads once it resolves.
- **Narrowed by the child's signature.** A component that declares its props takes only those, so spreading an object wider than the component is normal — see [a signature is a contract both ways](components.md#a-signature-is-a-contract-both-ways). A component with no signature takes every key.
- Component tags only, like `:model` — on a plain element it's ignored.

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
- `@event` on the tag hears the child's `$emit`s, and `:model` binds two-way — see their sections above.
- Two spellings reach a component and no others: a **capitalized** tag (`<NestedComponent />`) and a **dashed** one (`<nested-component>`). Matching ignores case and dashes, so both resolve `NestedComponent`. Prop names are normalized too — `:user-name` and `:userName` both become the `userName` prop (see [name casing](#name-casing)).
- An **undashed lowercase** tag is never a component, whatever is in scope: `<circle>` is a circle even beside a `Circle` component, and `<mychip>` is an unknown element even when `MyChip` is imported. Write `<MyChip />` or `<my-chip>`.
- Before the page is parsed, a capitalized tag is renamed to one the HTML parser cannot resolve to an element: `<Circle />` becomes `<c79-circle>`, `</UserCard>` becomes `</c79-user-card>`. You never type the prefix — it appears only where a component tag is still waiting for its name, and there it says what it is. This is what keeps `<Circle />` from being an SVG circle and `<Table />` from being a table; the cost is that a component tag can no longer sit in table-row position (`<Row />` inside a `<tbody>` is moved out of the table by the parser, as any non-`<tr>` is). Loop the `<tr>` itself with `:each` instead.
- `await import('/x.html')` returns a `Component79` (non-`.html` URLs fall through to native `import()`). While the promise is pending nothing renders; the child appears when it resolves. Under the [Vite plugin](vite-plugin.md), literal relative specifiers resolve from the bundle instead of fetching.
- Each usage site gets its own instance (own store, effects and DOM); instances are destroyed with their parent. Identical `<style>` blocks are refcounted, so N instances inject one tag.
- Self-closing tags work: jq79 expands `<MyComponent />` (and `<div />`) into explicit open+close pairs before HTML parsing, since the HTML parser would otherwise treat them as unclosed. Void elements (`<img />`, `<br />`) and `<script>`/`<style>` contents are left untouched.
- A tag can also resolve to a component the same file declares with `<template name="…">`, with no import at all — see [several components in one file](components.md#several-components-in-one-file).
- A tag's children are **content for the child's slots** — see below.

### A component renders in a box of its own

Every instance renders inside an element named after the component — one root,
several, or none:

```html
<div class="w">
  <c79-user-card data-c79-box data-jq79="1a2b3c">…the instance's DOM…</c79-user-card>
</div>
```

- **Always**, so the shape of the tree doesn't depend on what the child rendered
  this pass. A component whose only root sits behind a false `:if` is an empty
  box rather than nothing at all.
- **Named after the component, not the tag you wrote**: `<UserCard />` and
  `<user-card>` both render `<c79-user-card>`.
- **`display: contents` by default**, so the box is not a box: children stay in
  the parent's flex or grid layout. The rule is `:where([data-c79-box]) { display:
  contents }`, which has no specificity — any rule of yours wins, with no
  `!important` and whatever the stylesheet order:

  ```css
  c79-panel { display: flex; gap: 8px }   /* opts the box back into being a box */
  ```

- **It carries the parent's scope stamp**, so a parent's `<style scoped>` can
  address it by name — see [styles](components.md#styles).
- **Not inside `<svg>` or `<math>`.** SVG renders neither an unknown element nor
  its children, so a component in a foreign namespace renders inline, as it
  always did. Measured: with a box there, the drawing disappears — and
  `display: contents` makes it worse rather than better, since on an element SVG
  renders itself it computes to `none`.

A component used inside an `<svg>` has to **root its own template at `<svg>`**:

```html
<svg viewBox="0 0 100 100"><Dot /></svg>

<template name="Dot"><svg x="10" y="10"><circle cx="8" cy="8" r="8" /></svg></template>
<template name="Bare"><circle cx="8" cy="8" r="8" /></template>   <!-- draws nothing -->
```

A component's template is parsed on its own, so a bare `<circle>` at its root is
an HTML element with an SVG name — it lands in the tree and never draws, wherever
the tag was written. A root of its own `<svg>` is a foreign context of its own,
and everything inside it is in the SVG namespace as usual.

What it costs: a child or sibling combinator in **global** CSS stops crossing the
boundary (`.grid > .item` no longer matches an `.item` a component rendered), and
a parent's `:empty` stops matching when a child renders nothing. Scoped rules lose
nothing — they could never reach across that boundary anyway.

### A tag that names no component throws

`<UserCrad />` renders no markup, no styles, no children and no script. Once
every setup script has settled nothing can arrive to fill it, so jq79 throws
rather than leave a hole in the page:

```
jq79: <UserCrad> is not defined - no component of that name is in scope, and
nothing renders here. Import it in a :setup script, declare it as a prop, or add
a <template name="UserCrad"> to this file. In scope: UserCard, Button.
```

Only a tag **you capitalized** is judged this way — that's the spelling that
claims a component, and it is never valid HTML. `<my-widget>`, `<svg>` and a
plain typo like `<lable>` render as they always have. An HTML element written
in caps is judged like anything else you capitalized: `<DIV>` is a component
claim that resolves to nothing, and it throws instead of rendering a div.

It is also only about a name that resolves to *nothing*. A component variable
that is `undefined` still waits quietly — that's how an `await import(...)`
lands — and a name holding something that isn't a component stays a
`console.error`, because you can still write the right value into it:

```js
jq79.data.Card = await Component79.fetch('/Card.html')  // renders now
```

The one case where a name legitimately arrives after the first render is a
factory script that calls `await $mounted()` before returning its components.
jq79 knows that script is still running and waits for it.

## `<slot>` — content projection

A component's tag children render inside it, where it wrote a `<slot>`:

```html
<!-- Card.html -->
<section>
  <header><slot.header>Untitled</slot.header></header>
  <slot />
  <footer :if="$slots.footer"><slot.footer /></footer>
</section>
```

```html
<Card>
  <template :slot.header><h2>{{ title }}</h2></template>

  <p>{{ body }}</p>
</Card>
```

The dot marks the named variant on both sides, like `:model.<name>` and `:class.<name>`:

| written | means |
| --- | --- |
| `<slot />` | the default hole |
| `<slot.header-bar>…</slot.header-bar>` | a named hole, with fallback content |
| `<slot.row :item="item" />` | a hole that passes props to the content |
| a component tag's own children | content for the default slot |
| `:slot="{ item }"` on a component tag | names the default content binds |
| `<template :slot.row="{ item }">` | content for a named slot, and its names |

Names are camelCase where read, either casing where written: `<slot.header-bar>` and `<slot.headerBar>` are one slot, matched by `:slot.header-bar` or `:slot.headerBar`, asked about as `$slots.headerBar`.

### Scoped slots

A `<slot>`'s attributes are props for the content — which is what makes this composition rather than decoration:

```html
<!-- List.html -->
<ul>
  <li :each="item in rows" :key="item.id">
    <slot :item="item" :index="$index" />
  </li>
  <p :if="!rows.length"><slot.empty>Nothing here</slot.empty></p>
</ul>
```

```html
<List :rows="rows" :slot="{ item, index }">
  {{ index }}. <b>{{ item.label }}</b> — {{ currency(item.total) }}
</List>
```

`currency` is the parent's, `item` is the child's.

- **The content belongs to the parent**: its scope, its effects, its scoped styles. The child decides *where* it goes and *whether* it goes, never what the names in it mean.
- **Slot props are declared, not injected.** `:slot="{ item }"` is what puts `item` in scope, for the same reason `:each` writes `item in rows`. It is optional: without it the content just sees the parent's scope, and a `<slot :item>` the child adds later can't capture a name the content already had. The pattern takes renames and defaults too — `:slot="{ item: row, tone = 'plain' }"`.
- Slot props are **live**: each read re-evaluates the child's expression, so the content re-renders when either side changes. Assigning to one does nothing (and warns): it is the child's value.
- **What isn't projected isn't rendered.** No `<slot>` for it, or one behind a false `:if`, and the content's effects never exist. Remove the `<slot>` later and they are disposed.
- Every attribute that isn't a directive is a slot prop; `:if`/`:each`/`:with` on a `<slot>` mean what they mean anywhere else. `<slot :each="row in rows" :item="row" />` renders the content once per row.
- `$slots` is a static map of the names the usage site filled — `<footer :if="$slots.footer">` drops a wrapper nobody filled. Setup and factory scripts get it too.
- A `<slot>` written *inside* slot content forwards the writer's own content, so a wrapper can pass what it was handed straight through.
- Fallback content (a `<slot>`'s own children) renders in the **child's** scope — it is the child's markup.
- `<slot>` is reserved: a component named `Slot` no longer resolves from that tag.

## `<template name>` — another component in this file

At the **top level** of a component file, `<template name="Row">` declares another component of that file rather than markup:

```html
<ul><Row :each="label in rows" :label="label" /></ul>

<template name="Row">
  <li class="row">{{ label }}</li>
</template>
```

- Only the top level declares. A `<template>` nested inside the markup is not a declaration: it fills a slot when it carries `:slot.<name>` and is a direct child of a component tag, and otherwise it is a plain inert `<template>` element, children and all in its `.content`.
- The name must be PascalCase, or no tag could reference it.
- A top-level `<template>` that declares nothing usable (no name, a lowercase name, a name already taken) is dropped with a console warning — never a throw.

See [components](components.md#several-components-in-one-file) for what the declared components can see, how they are exported, and how a signature decides between one of them and a prop of the same name.

## SVG

SVG works like any other markup — interpolation, `:attr` bindings, `:each`, `:if`, events:

```html
<svg viewBox="0 0 100 100" class="chart">
  <circle :each="p in points" :key="p.id" :cx="p.x" :cy="p.y" r="3" :fill="p.color" @click="select(p)" />
  <text x="4" y="12">{{ total }} puntos</text>
</svg>
```

Elements inside an `<svg>` are built in the SVG namespace, so they draw, their case-sensitive names survive (`viewBox`, `preserveAspectRatio`, `<linearGradient>`, `<clipPath>`), and `<style scoped>` reaches them. A `<foreignObject>` hands the namespace back, so HTML inside one is real HTML.

SVG's camelCase attribute names work bound, and either spelling reaches the same one:

```html
<svg :viewBox="box">                        <!-- viewBox="0 0 10 10" -->
<svg :view-box="box">                       <!-- the same attribute -->
<feGaussianBlur :stdDeviation="blur" />     <!-- stdDeviation="3" -->
<circle :stroke-width="w" :strokeWidth="w"> <!-- stroke-width, which is its real name -->
```

You don't have to know which SVG attributes are camelCase and which are kebab — write the name however you like and jq79 resolves it against the parser's own table, the one that makes a written-out `viewBox` survive. Names outside that table (`fill`, `cx`, `stroke-width`, `clip-path`, and every `data-*` and `aria-*`) reach the DOM exactly as written.

The one place the name is yours to get right is `:attrs`, which passes its keys through untouched — the key **is** the attribute name:

```html
<svg :attrs="{ viewBox: box }" />          <!-- viewBox — correct -->
<circle :attrs="{ strokeWidth: w }" />     <!-- strokeWidth — not an SVG attribute, ignored -->
<circle :attrs="{ 'stroke-width': w }" />  <!-- stroke-width — correct -->
```

## MathML

MathML works the same way, and for the same reason — the namespace is read off the parsed tree, not guessed from a list of tag names:

```html
<math display="block">
  <mrow>
    <mi :mathcolor="color">{{ symbol }}</mi>
    <mo :each="op in ops" :key="op.id">{{ op.sign }}</mo>
  </mrow>
</math>
```

`<mtext>` and `<annotation-xml encoding="text/html">` hand the namespace back to HTML, the way `<foreignObject>` does in SVG. Attribute names are resolved the same way as in SVG, against MathML's own table — which has one entry, `definitionURL`; everything else (`mathcolor`, `linethickness`, `displaystyle`) is lowercase and arrives as written.

One sharp edge, and it belongs to the HTML parser rather than to jq79: `<annotation-xml>` holds HTML only when its `encoding` is written out as `text/html` or `application/xhtml+xml`. Bind it and the parser never sees a value it recognizes, so HTML inside is parsed **outside** the `<math>` entirely:

```html
<annotation-xml encoding="text/html"><p>…</p></annotation-xml>   <!-- fine: the <p> is inside -->
<annotation-xml :encoding="kind"><p>…</p></annotation-xml>       <!-- the <p> lands outside the <math> -->
```

## Name casing

The HTML parser lowercases attribute and tag names before jq79 ever sees them, so a name written camelCase would arrive flattened (`:firstName` → `:firstname`) and land under the wrong key. jq79 rewrites camelCase names to kebab-case in the raw source, before parsing, so **both spellings mean the same name**:

```html
<Field :userName="who" />        <!-- same as :user-name -->
<Field :model.firstName="who" /> <!-- same as :model.first-name -->
<template :slot.headerBar>…</template>
<slot.headerBar />               <!-- same as <slot.header-bar> -->
```

Whichever you write, the name is **camelCase where it's read** — the child's `userName` prop, `$slots.headerBar`. (A model name is normalized on arrival, so `$updateModel('first-name', v)` and `$updateModel('firstName', v)` find the same binding.)

Kebab-case is the house style in these docs, because it's what HTML looks like. camelCase is accepted so a prop doesn't have to change shape between the template and the script that reads it.

What the rewrite does **not** touch:

- **Expressions**, only names — a quoted value is left alone (`@click="a ? b : c"`, `style="color: red"`), and so is everything inside `<script>` and `<style>`.
- **Component tags** (`<UserCard>`), which need no help: tag matching already ignores case and dashes.
- **`...expr` spreads**, which are expressions, not names — `...userData` keeps its exact casing.
- **`@event` names**, which are literal DOM event names: `@userSaved` still arrives as `usersaved` and will not match `$emit('userSaved')`. Write events kebab-case on both sides (`@user-saved` / `$emit('user-saved')`), or subscribe with `addEventListener` from a setup script.
