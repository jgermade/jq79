# Lists and conditions

`:each` repeats an element once per item, and `:key` tells jq79 how to identify
each one. The list is diffed by key, so reordering or filtering keeps the
existing DOM (and its state) instead of rebuilding it. `$index` is available
inside:

```html
<li :each="user in users" :key="user.id">{{ $index }}: {{ user.name }}</li>
```

`:if` / `:elseif` / `:else` on consecutive siblings form one chain — only the
active branch exists in the DOM:

```html
<div :if="score > 8">great</div>
<div :elseif="score > 4">ok</div>
<div :else>bad</div>
```

> **Your turn:** render one `<li>` per todo, keyed by `id`. Then show the
> "all done!" message only when nothing is left, and the count when something
> is — the `:if`/`:else` chain is already sketched out for you.

Clicking a todo already toggles it, because mutating a property of a reactive
object is tracked just like assigning to a variable.

There's more to `:each` — what `:key` actually buys you, a second binding, and
iterating plain objects — in [Keys and identity](#01-basics/06-keys-and-identity)
and [Objects and entries](#01-basics/07-objects-and-entries).
