# Reactive data

The store used by components is available standalone:

```js
import { $reactive } from "jq79"   // also injected into setup scripts

const data = $reactive({ user: { address: { city: "NYC" } } })

data.$on("user.address.city", (value, dotKey) => { … }, { immediate: true })
data.$onAny((dotKey, value) => { … })
const stop = data.$effect(() => {
  // re-runs whenever anything it *read* changes (fine-grained, deep)
  console.log(data.user.address.city)
})

data.user.address.city = "LA"   // deep mutations notify with the full dot path
stop()                          // effects/listeners return an unsubscribe fn
```
