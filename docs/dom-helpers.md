# DOM helpers

> **No compiler, no bundler.** These are tiny wrappers around the browser's own
> DOM methods — `querySelector`, `querySelectorAll`, `createElement`. They ship
> as part of the single-file library and work identically whether the component
> was bundled or fetched at runtime.

```js
import { $, $$, $create } from "jq79"

$(".card")            // document.querySelector
$(el, ".card")        // scoped querySelector
$$(".card")           // querySelectorAll, as a real Array
$$(el, ".card")       // scoped

$create("div", {      // document.createElement + attrs
  className: ["card", "active"],   // string or array
  textContent: "hi",
  children: [$create("span")],
  "data-id": "42",                 // anything else via setAttribute
})
```

## What they return, typed

The types `querySelector`'s have, with one difference: a selector that isn't a
tag name gives an `HTMLElement`, not an `Element`, because what a component looks
up is HTML almost every time.

```ts
$("input")                   // HTMLInputElement | null  - a tag name gives its element
$("circle")                  // SVGCircleElement | null  - SVG's too
$(".search")?.focus()        // HTMLElement | null       - anything else
$<HTMLInputElement>(".q")    // HTMLInputElement | null  - or what you say it is
$$("li")                     // HTMLLIElement[]
```

A setup script's `$self` and `$$self` are typed the same way (`QueryOne`,
`QueryAll`, exported by `jq79`). An element found by a class inside an `<svg>`
is typed `HTMLElement` while it is an `SVGElement`; name its tag, or say its
type. Only the types say this: what runs is `querySelector`, whatever it finds.
