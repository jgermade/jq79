# Two-way binding

[Component events](#03-components/02-component-events) wired one direction by
hand: a prop down, an `$emit` up, a listener on a wrapping element to close the
loop. `NameField.html` below takes a shortcut that's easy to reach for before
you've felt its cost — it copies the prop into its own `value` **once**, at
setup, and manages that copy from then on:

```html
<script :setup="{ initial }">
  let value = initial
</script>
<input :value="value" @input="value = $event.target.value">
```

That copy is why typing does nothing the parent can see, and why the "reset"
button does nothing the field shows: `initial` keeps arriving live (props
always do), but `value` never looks at it again after the first render. Two
separate directions, both broken, from the same shortcut.

`:model` is the two bindings this was always going to need, in one attribute:

```html
<NameField :model="name" />
```

```html
<!-- NameField.html -->
<input :value="model" @input="$emit('model:update', { value: $event.target.value })">
```

`:model="name"` passes `name` down as the prop `model` — live, like any prop,
so a parent write reaches the input for as long as the component holds it. The
child's `$emit('model:update', { value })` is the way back: the parent
receives it and assigns `name` for you, no listener to write by hand. Give the
model a name — `:model.uname="uname"` — and the payload names it too:
`$emit('model:update', { name: 'uname', value })`; several models can share
one tag that way.

> **Your turn:** in `app.html`, drop `:initial` for `:model="name"`. In
> `NameField.html`, drop the local `value` copy — bind the input straight to
> `model`, and emit `model:update` on input instead of assigning `value`
> directly. Then type into the field (the paragraph below should track every
> keystroke) and hit reset (the field itself should snap back to "Ada").

Same rule as ordinary props: `:model.uname` alone is shorthand for
`:model.uname="uname"`. And the echo this looks like it should create doesn't
happen — a parent write lands back in the child as the same value, which the
store's own same-value check quietly skips. More in
[template syntax](../../../docs/template-syntax.md#model--two-way-component-binding).
