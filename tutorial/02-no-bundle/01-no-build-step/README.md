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

  Component79.fetch("./app.html").mount("#app", { title: "Today" })
</script>
```

That is the whole deployment. No `npm install`, no bundler, no config file, no
build output — the files you wrote are the files you shipped. `Component79.fetch`
does what it says: a `fetch()`, then the same parse `new Component79(source)`
does.

It doesn't hand back the component, though — it can't, the download hasn't
finished. What you get is a *pending* component, and every call you make on it
(`mount`, `on`, `destroy`, …) queues onto the download and runs in the order you
wrote it. That's what keeps the page above to one expression. Await it when you
want the component itself:

```js
const parsed = await Component79.fetch("./app.html")           // the component
const app = await Component79.fetch("./app.html").mount("#app") // mounted

const [Header, Footer] = await Component79.fetchAll([           // several at once
  "./Header.html",
  "./Footer.html",
])
```

`fetchAll` is the plural, and only the plural: pass an array to `fetch` and it
throws, because there is no sensible component for it to hand back.

While you're writing them, `npx jq79 dev` serves that folder and hot-reloads the
components you edit, keeping their state — no build step there either, and it
serves the same bytes a static host would. See the
[dev server](../../../docs/dev-server.md).

The page you are reading is that page. It fetched `Tutorial.html` from the host,
and `Tutorial.html` fetched its own five panes — the editor you're about to type
in arrived over the network as a `.html` file.

## The same is true inside a component

A component uses another one by importing it from its setup script. The next
section is about that — here, all that matters is where the file comes from:

```html
<script :setup>
  const Card = await import("./Card.html")
</script>

<Card :title="'Today'" />
```

The import binds a PascalCase variable, and a tag with that name renders the
component; `:title="expr"` passes a prop down. What it does *not* do is instruct
a bundler: the specifier is resolved when the line runs. Under the
[Vite plugin](../../../docs/vite-plugin.md) it's pre-resolved at build time and
the import costs nothing at runtime; with no bundler, the runtime fetches the URL.
Same line, same component, either way.

The tutorial's preview pre-resolves the same way the plugin does: it hands the
entry file the *other tabs* as its modules, so `./Greeting.html` finds the file
next door. But a specifier it doesn't recognise falls through to the runtime, and
the runtime goes to the network.

So there is a component sitting on this tutorial's own host that is in none of
your tabs:

```
/tutorial/examples/Sticker.html
```

> **Your turn:** import it and render one `<Sticker :label />` per stamp. Nothing
> in your editor defines it and no bundler ever saw it — open the network tab and
> watch it arrive.
