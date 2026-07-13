# Components

## Lifecycle

```js
const jq79 = new Component79(src)      // src: string, or { template, scripts, styles }

jq79.on("submit", (e, payload) => {})  // subscribe to the component's $emit events
   .off("submit", listener)           // unsubscribe

jq79.mount(el, data)                   // render (reactive DOM, setup scripts, styles) + attach
                                      // el: Element or selector string; data is optional

jq79.detach()                          // detach, keeping state — mount(el) re-attaches, with
                                      // any updates that happened while detached applied
   .destroy()                         // dispose all effects and remove injected styles
```

- `mount(el, data?)` renders on the first mount, and re-renders fresh whenever `data` is passed. `mount(el)` on an already-rendered component just re-attaches, keeping its state — the `detach()`/`mount()` round trip. Styles go into `document.head`.
- `mountShadow(el, data?)` instead attaches a shadow root to the target and injects content and styles there, so CSS stays scoped to the component.
- `render(data)` / `renderShadow(data)` are also available standalone, for rendering while detached (effects keep the detached DOM up to date; a later `mount(el)` attaches it).
- `jq79.data` is the live reactive store — mutate it from outside and the DOM follows.
- `on(eventName, (event, payload) => …)` hears the events the component emits with `$emit` — see [setup scripts](setup-scripts.md).

## Loading remote components

```js
const jq79 = await Component79.fetch("/components/user-card.html")
jq79.mount("#app", { userId: 42 })
```
