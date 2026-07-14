# Loading on demand

If a component is fetched when its `import()` runs, then an `import()` that runs
later is a component that arrives later. That's code splitting, and there is
nothing to configure: the chunk is the file, and it's already sitting on the host.

```html
<script :setup>
  let Chart = null

  const show = async () => {
    Chart = await import("./examples/Chart.html")
  }
</script>

<button @click="show">show the chart</button>
<Chart :data="sales" />
```

The `<Chart>` tag can sit in the template from the very first render, because a
component tag whose variable isn't a component *renders nothing* — that's the
same rule that lets a component with a top-level `await` render before its import
resolves. `Chart` is an ordinary reactive variable, so assigning the fetched
component to it is what puts the chart on screen.

Which leaves the gap in between. A fetch takes as long as it takes, and a button
that does nothing visible when clicked reads as a broken button — so say it out
loud: flip a `loading` flag before the `await` and clear it after. That is the
shape every request in a setup script takes, and the one
[loading data](#04-scripts/03-loading-data) comes back to with data instead of a
component.

> **Your turn:** fetch `./examples/Chart.html` on the first click and render it
> with `sales`, showing "loading…" while it's in flight. It's a file on the host,
> in none of your tabs, and it isn't requested until you ask for it.
