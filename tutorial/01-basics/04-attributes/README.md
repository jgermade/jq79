# Attributes

`:attrs` takes an expression that evaluates to an object, and turns each entry
into an attribute. A `null`, `undefined` or `false` value *removes* the
attribute rather than setting it to the string `"false"` — which is what you
want for `disabled`, `hidden`, `checked` and friends:

```html
<button :attrs="{ disabled: isSaving, title: tooltip }">Save</button>
```

It's re-evaluated whenever anything it reads changes, and only the attributes
that actually changed are touched.

Classes get their own directive, because toggling one through `:attrs` means
concatenating strings. `:class` *adds to* the static `class` attribute — it
never replaces it — and takes a string, an object whose truthy-valued keys
become classes, or an array mixing both:

```html
<button class="btn" :class="{ 'btn-active': active }">go</button>
<div :class="[theme, { active }]"></div>
```

For content there's `:text` and `:html`, which replace an element's children
from an expression — `:text` sets `textContent`, `:html` sets `innerHTML` after
running the value through a sanitizer.

> **Your turn:** make the button disable itself while `saving` is true, and give
> it a `title` explaining why. Then show the status with `:text` instead of
> interpolation — and light it up while the save is in flight, by toggling the
> `busy` class with `:class`.
