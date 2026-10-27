# Scoped styles

A component's `<style>` block lands in `document.head` as-is — global, on
purpose. Which is fine until two components have opinions about the same
class: whichever block lands last styles them both.

`scoped` narrows a style block to the elements this component rendered. It's
one attribute:

```html
<style scoped>
  .title { color: rebeccapurple; }
</style>
```

There's no compiler to do this ahead of time, so it happens at parse time in
the browser: every element of the template is stamped with an attribute hashed
from the component's source, and each rule is rewritten to require it. An
element outside the component carries no stamp, so no rule can reach it — and
a *child* component's elements are stamped with the child's own hash, so
scoping stops at the component boundary, in both directions. Every instance of
a definition hashes the same, and they all share one refcounted `<style>`,
gone with the last instance.

This lesson has nothing to solve, and the pane on the right isn't the usual
preview — it can't be: the tutorial mounts exercises into a shadow root, and
`mountShadow` deliberately ignores `scoped`, because a shadow root already
scopes. Instead the pane shows what a normal `mount()` of the selected file
actually puts on the page: the elements as rendered, and the CSS that landed
in `document.head`.

> **Your turn to read:** flip between `app.html` and `scoped.html` — the same
> card, one attribute apart — and compare what reaches the page. Then edit
> either one: the output re-runs from your source as you type.

The fine print — `@keyframes` stay global, `@media` blocks are scoped inside,
what `mountShadow` does with nested components' styles — is in
[components](../../../docs/components.md#styles).
