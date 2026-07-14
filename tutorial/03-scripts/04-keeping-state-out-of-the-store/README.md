# Keeping state out of the store

A `$:` effect tracks every scope variable it *reads*, and re-runs when one of
them changes. So an effect that reads **and** writes the same variable wakes
itself up — forever:

```js
let timer = null                       // top-level → a reactive scope var

const schedule = () => {
  clearTimeout(timer)                  // reads `timer`…
  timer = setTimeout(search, 250)      // …and writes it: the effect below loops
}

$: schedule(query)
```

This one is worth meeting in person, because it doesn't fail where you'd look
for it. An effect's dependencies are recorded *after* its first run, so the pass
that happens during render writes `timer` while the effect is still tracking
nothing — and everything looks fine. It's the **next** change to `query` that
finds `timer` in the dependency list and recurses until the stack blows. Type a
letter in the box below and watch it happen.

The fix isn't to fight the effect. A timer handle isn't state the template
renders — it's bookkeeping, and it has no business in the store. Since only
*top-level* declarations are rewritten, a closure keeps it plain JS:

```js
const schedule = (() => {
  let timer = null                     // inside a function → not reactive

  return () => {
    clearTimeout(timer)
    timer = setTimeout(search, 250)
  }
})()

$: schedule(query)                     // re-runs when `query` changes. Only `query`
```

The same goes for a cached instance, a "did I already run this" flag, an
AbortController — anything the DOM never reads.

> **Your turn:** move `timer` out of the store so the debounce works: one search
> after you stop typing, however many letters you typed.
