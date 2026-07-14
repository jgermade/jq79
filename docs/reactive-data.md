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

// effects/listeners return an unsubscribe fn
stop()
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

A store nested inside another store (`$reactive({ inner: $reactive({ n: 1 }) })`)
stays a store — it isn't re-wrapped, and it keeps its own `$on`/`$effect`.
Class instances, `Date`s and DOM nodes pass through untouched.
