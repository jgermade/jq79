# Reactive data

The store used by components is available standalone:

```js
// also injected into setup scripts
import { $reactive } from "jq79"

const data = $reactive({ user: { address: { city: "NYC" } } })

data.$on("user.address.city", (value, dotKey) => { … }, { immediate: true })
data.$onAny((dotKey, value) => { … })
const stop = data.$effect(() => {
  // re-runs whenever anything it *read* changes (fine-grained, deep)
  console.log(data.user.address.city)
})

// deep mutations notify with the full dot path
data.user.address.city = "LA"

// effects/listeners return an unsubscribe fn
stop()
```
