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
