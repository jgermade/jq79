# Reactive data

The store used by components is available standalone:

```js
// also injected into setup scripts
import { $reactive } from "jq79"

const data = $reactive({ user: { address: { city: "NYC" } } })

data.$on("user.address.city", (value, dotKey) => { … }, { immediate: true })
data.$onAny((dotKey, value) => { … })
const stop = data.$effect(() => {
  // re-runs whenever anything it *read* changes (fine-grained, deep)
  console.log(data.user.address.city)
})

// deep mutations notify with the full dot path
data.user.address.city = "LA"

// so does deleting a key (listeners hear undefined, same as a read afterwards)
delete data.user.address.city

// effects/listeners return an unsubscribe fn
stop()

// drops this store's subscriptions to the stores nested inside it
data.$dispose()
```

## The object you hand it is left alone

`$reactive(data)` doesn't modify `data` — it returns a reactive *view* of it.
Nested objects are wrapped as they're read, not rewritten in place, so `data`
comes back exactly as you passed it in.

Two consequences worth knowing:

- **Mutate through the handle, not the source.** Writes through the store land
  in your object (it's the proxy's target, so `data.user.name` shows the new
  value), but a write made *directly* on `data` notifies nobody — the store
  never saw it. This is the one rule: `store.user.name = "Grace"`, not
  `data.user.name = "Grace"`.
- **The same object can back several stores.** Handing one object to two
  components — `a.mount(x, { user })` and `b.mount(y, { user })` — gives each
  its own independent view, with its own listeners and effects. Neither sees the
  other's; both read and write the same underlying data.

Objects keep a stable identity within a store: reading the same object twice
hands back the same proxy, which is what lets [`:each`](template-syntax.md)
diff a reordered list by reference and keep each row's DOM.

Class instances, `Date`s and DOM nodes pass through untouched.

## Shared state: pass a store, not an object

A plain object handed to two components is shared *data*, not shared state: each
store notifies its own listeners, so a child writing to it updates the child and
leaves the parent's DOM showing the old value.

A **store** handed around is shared state. It isn't re-wrapped when it lands in
another store — it stays itself, with its own `$on`/`$effect` — and the store
holding it subscribes to it, re-notifying its changes under the path it sits at
(`items.0` inside the store becomes `cart.items.0` for the holder). So every
component that was handed it sees every write, whoever made it:

```html
<script :setup>
  const cart = $reactive({ items: [] })   // one store…
</script>

<CartLines :cart />                       <!-- …handed to both children -->
<CartTotal :cart />
```

```html
<!-- CartLines.html -->
<script :setup="{ cart }"></script>
<button @click="cart.items = [...cart.items, 'a pear']">add</button>
```

`CartTotal` updates when `CartLines` writes, the parent updates when either
does, and a write from outside the tree (`cart.items = []`, from the module that
created the store) updates all three. Which makes a `$reactive` created outside
any component a perfectly good app-wide store — import it where you need it.

A component drops its subscription to a store it was handed when it's destroyed,
so a long-lived store doesn't accumulate listeners from components that are
gone. Outside a component, `store.$dispose()` does the same by hand.
