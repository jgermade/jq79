# Shared state

Props flow down, events flow up — and then two siblings need the same cart, and
neither direction helps. The missing piece is a **store**.

A plain object handed to both is shared *data*, not shared state: each
component's store notifies its own listeners, so the child that writes updates
itself and everyone else keeps rendering the old value. The starting files do
exactly that — add a pear and watch the total not move.

`$reactive` (ambient in every setup script, like `$emit`) turns the object into
a store. A store handed around isn't re-wrapped when it lands in another
component — it stays itself, and each holder subscribes to it. Every write,
whoever makes it, reaches every component that holds it:

```html
<script :setup>
  const cart = $reactive({ items: [] })   // one store…
</script>

<CartLines :cart />                       <!-- …handed to both children -->
<CartTotal :cart />
```

> **Your turn:** one line in `app.html` — make `cart` a store. Then add a pear
> and watch all three counts agree: the parent's heading, the lines, the total.

That's props doing all the wiring — no context API, no injection. And a
`$reactive` created *outside* any component works the same way, which makes an
app-wide store an ordinary module: create it in one file, import it wherever
it's needed. More in [reactive data](../../../docs/reactive-data.md).
