# No build step

There is no compiler. A component is a `.html` file, and a browser already knows
how to fetch one of those — so nothing has to happen to your components between
writing them and serving them. Drop them on any static host next to the library,
and the page works:

```html
<!doctype html>
<div id="app"></div>

<script type="module">
  import { Component79 } from "https://esm.sh/jq79"

  const app = await Component79.fetch("./app.html")
  app.mount("#app", { title: "Today" })
</script>
```

That is the whole deployment. No `npm install`, no bundler, no config file, no
build output — the files you wrote are the files you shipped. `Component79.fetch`
does what it says: a `fetch()`, then the same parse `new Component79(source)`
does.

While you're writing them, `npx jq79 dev` serves that folder and hot-reloads the
components you edit, keeping their state — no build step there either, and it
serves the same bytes a static host would. See the
[dev server](../../../docs/dev-server.md).

The page you are reading is that page. It fetched `Tutorial.html` from the host,
and `Tutorial.html` fetched its own five panes — the editor you're about to type
in arrived over the network as a `.html` file.

## The same is true inside a component

`await import("./Card.html")` in a setup script is not a bundler instruction —
it's resolved when it runs. Under the [Vite plugin](../../../docs/vite-plugin.md)
the specifier is pre-resolved at build time and the import costs nothing at
runtime; with no bundler, the runtime fetches the URL. Same line, same component,
either way.

The tutorial's preview is the pre-resolved case: it hands the entry file the
*other tabs* as its modules, which is why `./Greeting.html` found the file next
door two sections ago. But a specifier it doesn't recognise falls through to the
runtime, and the runtime goes to the network.

So there is a component sitting on this tutorial's own host that is in none of
your tabs:

```
/tutorial/examples/Sticker.html
```

> **Your turn:** import it and render one `<Sticker :label />` per stamp. Nothing
> in your editor defines it and no bundler ever saw it — open the network tab and
> watch it arrive.
