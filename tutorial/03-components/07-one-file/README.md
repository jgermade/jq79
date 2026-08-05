# Several components in one file

Not every component deserves a file. A row, a badge, a tree node — a `<template name="…">`
at the top level of a component file declares another component of that same file,
and every component in the file can use it by name, with no import:

```html
<ul><Row :each="label in rows" :label="label" /></ul>

<template name="Row">
  <script :setup="{ label }"></script>
  <li>{{ label }}</li>
</template>
```

Inside a `<template>` everything works as it does in a file of its own: its own
script, its own `<style>`, its own props. The name has to be PascalCase, or no tag
could reference it.

They come out of the file too — `import List, { Row } from "./list.html"` — so the file
is a module: its own component as the default, the ones it declares by name.

And because a named template can see every component in its file, **including
itself**, it can render itself:

```html
<template name="Node">
  <script :setup="{ node }"></script>
  <li>
    {{ node.label }}
    <ul :if="node.children">
      <Node :each="child in node.children" :node="child" />
    </ul>
  </li>
</template>
```

That's the one shape a component in a file of its own can't have: it would need to
import itself. Recursion stops where the data stops.

> **Your turn:** declare a `Folder` component in this same file and render the tree
> with it, so that a folder renders its own children.
