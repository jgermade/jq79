# Vite plugin

`jq79/vite` lets you import `.html` single-file components as modules, so they
travel inside your bundle instead of being fetched at runtime.

```js
// vite.config.js
import { defineConfig } from "vite"
import { jq79 } from "jq79/vite"

export default defineConfig({
  plugins: [jq79()],
})
```

```js
// app code
import UserCard from "./UserCard.html"

UserCard.mount("#app", { userId: 42 })
```

The imported value is a `Component79` built from the file's source — exactly
what `await Component79.fetch("/UserCard.html")` would resolve to, minus the
network request.

## A loader, not a compiler

The plugin inlines the file's source verbatim; nothing inside the component is
transformed. The same `.html` file works unchanged in all three delivery
modes:

- **Bundled** — placed in `src/`, imported as a module (this plugin).
- **Fetched** — placed in `public/`, loaded with `Component79.fetch(url)` or
  `import("./card.html")` from a setup script, no build required.
- **No project at all** — served from any static host and used with the CDN
  build of jq79.

## Using an imported component

The import is a component *definition* as much as an instance:

```js
import UserCard from "./UserCard.html"

// mount it directly (one live render per instance)
UserCard.mount("#app")

// use it as a nested component: each usage site gets its own instance,
// cloned from the shared parsed definition
new Component79(`
  <ul>
    <li :each="user of users">
      <UserCard :user></UserCard>
    </li>
  </ul>
`).mount("#list", { UserCard, users })

// need several independent directly-mounted copies? clone the definition
const another = new Component79(UserCard)
```

Note that ES modules are cached: every `import` of the same file yields the
same instance. Mounting that one instance in two places *moves* it — clone
with `new Component79(imported)` when you want independent copies.

## Which imports are claimed

Only imports that could not mean anything else:

- The specifier must match `include` (default: anything ending in `.html`).
- There must be an importer — entry points like `index.html` are untouched.
- Imports with an explicit query keep their built-in Vite meaning
  (`./card.html?raw`, `./card.html?url`).

### Options

```js
jq79({
  // which import specifiers are treated as components (default: /\.html$/)
  include: /\.c79\.html$/,
  // resolved absolute paths to skip even when include matches
  exclude: /\/email-templates\//,
})
```

## Imports inside setup scripts

`import(...)` calls in a component's scripts with a **literal specifier** are
hoisted into real module imports and bundled along with the component:

```html
<script :setup>
  const UserCard = await import("./UserCard.html")  // bundled component
  const { format } = await import("date-fns")       // bundled npm package
</script>
```

The setup script itself is untouched (the plugin stays a loader): the hoisted
modules are handed to `Component79` as a resolution map, which the runtime
checks before falling back to its normal behavior. The same file therefore
still works unbundled — the map simply isn't there, and the imports fetch at
runtime as always.

Left to runtime resolution on purpose:

- **Absolute paths and full URLs** (`import("/cards/promo.html")`,
  `import("https://esm.sh/x")`) — they point at served files, e.g. `public/`.
- **Dynamic specifiers** (`` import(`./cards/${name}.html`) ``) — not
  statically analyzable; keep runtime-loaded components in `public/`.

## Hot module replacement

Editing a component file updates it in place during `vite dev`:

- A component mounted directly is re-rendered where it stands, seeded with a
  snapshot of its current data (props and store values survive; the setup
  script runs again, so anything it initializes is reset).
- A component used only as a nested definition falls back to a full page
  reload — already-rendered clones can't be reached from the module.

Two caveats: a re-rendered component is re-appended to its mount target, so
its position among unrelated siblings may change; and an instance that is
both directly mounted *and* used as a nested definition only refreshes the
direct mount.
