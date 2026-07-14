# Reaching the DOM

A setup script runs *before* the template renders — that's how the template can
read the variables it declares. Which means there is no DOM yet to query.

`await $mounted()` suspends the script until the component is attached to the
page, so everything below it can touch real elements:

```html
<script :setup>
  let items = await fetchItems()   // still before render

  await $mounted()

  $(".list").scrollIntoView()      // the component is in the document now
</script>
```

`$self(selector)` and `$$self(selector)` are the component-scoped versions of
`$`/`$$`: they only search this instance's own nodes, so they can't accidentally
match some other component's `.search` box.

Reactivity doesn't care where a declaration sits — variables declared after the
`await` are already on the store before the first render, so the template can
bind to them from the start.

> **Your turn:** focus the search box as soon as the component mounts, using
> `$self`.

If a script needs *nothing* to run before render, put `:mounted` on the tag
(`<script :setup :mounted>`) — it behaves as if `await $mounted()` were its
first line.
