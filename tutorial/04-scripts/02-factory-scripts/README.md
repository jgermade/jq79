# Factory scripts

A `<script>` whose top level has an `export default` runs as a **plain lexical
module** instead of a setup script — standard JavaScript that editors, linters
and type-checkers understand with no configuration. No `with`, no `$:` labels,
no rewriting.

The default export is called with the instance context:

```html
<script>
export default ({ $data, $effect }) => {
  $data.count = 0

  $effect(() => { $data.double = $data.count * 2 })

  const inc = () => { $data.count++ }

  return { inc }          // merged into the store → visible to the template
}
</script>

<button @click="inc">{{ count }} / {{ double }}</button>
```

The trade is that **reactivity is explicit**: there's no scope magic, so a local
`count++` changes nothing — it has to be `$data.count++`. And anything the
template needs (methods, imported components) has to be *returned*, because
`import` bindings and local `const`s are lexical, not scope variables.

The two styles coexist, even within one component. `:setup` isn't going
anywhere.

> **Your turn:** finish the factory — make `inc` and `reset` work on `$data`,
> and use `$effect` to keep `double` in sync.
