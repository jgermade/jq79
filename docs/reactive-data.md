# Reactive data

> **No compiler, no bundler.** The reactive store is a plain JavaScript proxy —
> no code generation, no AST transforms, no virtual DOM. It works the same
> whether the component was bundled by Vite or fetched at runtime from a CDN.

The store used by components is available standalone:

```js
// also injected into setup scripts
import { $reactive } from "jq79"

const data = $reactive({ user: { address: { city: "NYC" } } })

data.$on("user.address.city", (value, dotKey) => { … }, { immediate: true })
data.$onAny((dotKey, value) => { … })
const stop = data.$effect(() => {
  // re-runs whenever a value it *read* changes - at whatever depth it read it
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

## An effect wakes for what it read, not for the object it read it through

Reaching `data.user.address.city` reads three objects on the way, but the effect
depends on the value it actually took:

```js
const data = $reactive({ rows: [{ label: "a" }, { label: "b" }] })

data.$effect(() => console.log(data.rows[0].label))

data.rows[1].label = "changed"  // silent: this effect never read row 1
data.rows[0].label = "changed"  // re-runs
data.rows = []                  // re-runs: replacing the array replaced the row
```

A write re-runs an effect when it lands on something the effect read, or
*inside* it — replacing `rows` re-runs everything that read anything under
`rows`. It does not travel the other way: touching one row does not wake an
effect that only read a different one, which is what keeps a 1,000-row list
costing one re-render per changed row rather than a thousand.

Replacing a list with a copy of itself one element longer or shorter is not a
wholesale replacement, and isn't treated as one — the rows that stay are the
same objects, so an effect that read *into* one of them is left alone, wherever
that row has ended up. What does re-run is whatever read the list itself (a
`:each`, its `length`) and whatever read a **slot** the shift moved, since
`rows[6]` means "whoever sits at slot 6":

```js
const row = data.rows[6]

data.$effect(() => console.log(row.label))           // this row, wherever it is
data.$effect(() => console.log(data.rows[6].label))  // whoever sits at slot 6

data.rows = data.rows.filter(r => r.id !== 1)        // silent / re-runs
```

Any other reshuffle — a sort, a reorder, two rows removed at once — re-runs
everything that read under the list, as a replacement does.

The case to know about is an effect that reads an object **without** reading
into it:

```js
data.$effect(() => console.log(data.user))    // logs the object itself
data.user.name = "Grace"                      // silent
```

Nothing the effect read changed — `data.user` is the same object. Read the
values you actually depend on (`data.user.name`), which is what a template
interpolation like `{{ user.name }}` does anyway.

Two things deliberately stay coarse, because nothing finer is observable:
enumerating an object (`Object.keys`, `{...spread}`, `:each` over a plain
object) re-runs when a key is added or removed, and an array's `length`
re-runs everything that read an element, since a truncation removes them
without notifying each one.

### When the effect can't read what it depends on

Reading the values you depend on is the answer almost everywhere. It stops
being possible when the effect hands a value to code the store cannot watch —
a chart library, a canvas draw, a request — because the reads then happen
somewhere the proxy is not:

```js
data.$effect(() => chart.render(data.series))   // reads `series`, nothing under it
data.series.points.push(4)                      // silent: nothing it read changed
```

`deep` opts that effect into waking for writes *below* what it read, too:

```js
data.$effect(() => chart.render(data.series), { deep: true })
data.series.points.push(4)                      // re-runs
```

Use it for exactly this — a value forwarded whole to something opaque. It is
not a general "watch everything" switch: an effect marked `deep` wakes for
every write under every path it touched, which on a large object is most
writes. A component's props already use it internally, which is why a parent's
deep mutation reaches a child that only reads the prop object.

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

## Getting the plain object back

`$toRaw(value)` returns the object behind a store proxy — at the root or at any
depth — for the code that shouldn't see a proxy at all: a library that stores
what you hand it, a `structuredClone`, an identity comparison against the
original data.

```js
// also injected into setup scripts
import { $reactive, $toRaw } from "jq79"

const data = { user: { name: "Jesús" }, items: [{ id: 1 }] }
const store = $reactive(data)

$toRaw(store)          // data
$toRaw(store.user)     // data.user
$toRaw(store.items[0]) // data.items[0]
$toRaw({ a: 1 })       // { a: 1 } — anything that isn't a proxy comes back as it is
```

It hands back the *live* object, not a copy, so the rule above applies to it:
writes made through it notify nobody.

```js
$toRaw(store).count = 5   // the value changes, nothing re-renders
store.count = 5           // ✅
```

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
