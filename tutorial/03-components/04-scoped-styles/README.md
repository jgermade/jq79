# Scoped styles

A component's `<style>` block lands in `document.head` as-is — global, on
purpose. Which is fine until two components have opinions about the same class:
the card below styles its `.title`, and the page's own heading turns purple
with it.

`scoped` narrows a style block to the elements this component rendered. It's
one attribute:

```html
<div class="card">
  <span class="title">a card, with opinions</span>
</div>

<style scoped>
  .title { color: rebeccapurple; }
</style>
```

There's no compiler to do this ahead of time, so it happens at parse time in
the browser: every element of the template is stamped with an attribute hashed
from the component's source, and each rule is rewritten to require it. What
actually reaches the page is this:

```html
<div class="card" data-jq79="1a2b3c">
  <span class="title" data-jq79="1a2b3c">a card, with opinions</span>
</div>
```

```css
.title[data-jq79="1a2b3c"] { color: rebeccapurple; }
```

The heading outside the component carries no stamp, so the rule can't reach it
anymore. Every instance of the definition hashes the same, so they all share
one refcounted `<style>`, gone with the last instance. And a *child*
component's elements are stamped with the child's own hash, not the parent's —
scoping stops at the component boundary, in both directions.

> **Your turn:** scope the card's style — and, for once, don't trust the
> preview. This page mounts every exercise in a shadow root, and `mountShadow`
> deliberately ignores `scoped`: a shadow root already scopes, and leaving the
> CSS as written is what keeps `:host` rules working. So the heading here stays
> purple. On a normal `mount()`, the rewrite above is exactly what lands on the
> page.

The fine print — `@keyframes` stay global, `@media` blocks are scoped inside,
what `mountShadow` does with nested components' styles — is in
[components](../../../docs/components.md#styles).
