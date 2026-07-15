# Objects and entries

`:each` takes a second binding. On an array it names the index — the same value
as `$index`, but with a name of your own, which is what you want in nested
loops, where the inner `$index` shadows the outer one:

```html
<li :each="row, r in rows">
  <span :each="cell, c in row.cells">{{ r }},{{ c }}</span>
</li>
```

And a plain object iterates as its **entries**: first binding the value, second
the key (the parens are optional). No `Object.entries()` detour, and no `:key`
either — entries diff by property key out of the box, so adding, changing or
deleting one touches only its own row:

```html
<li :each="(value, key) in labels">{{ key }} = {{ value }}</li>
```

> **Your turn:** render one line per fruit — `(count, fruit) in stock` — and
> make clicking a line restock it by one. Then wire the "add figs" button to
> `stock.figs = 5`: a brand-new property is tracked like any other write, and
> its row appears without the others being touched.

Anything that is neither an array nor a plain object renders nothing — handy
while the data is still on its way.
