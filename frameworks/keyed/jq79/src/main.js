import { Component79 } from "jq79"
import App from "./App.html"

// Any query parameter that names a Component79.debug flag switches it, so the
// A/B harness can pair one build against itself on whichever flag is being
// priced (`npm run benchmark:ab -- --flags <name>`). Absent, the defaults
// stand. `?clone=` stays as the older spelling of cloneSkeletons. `?raw=` is
// not a flag: App.html reads it itself, to switch how it holds its list.
const query = new URLSearchParams(location.search)
const flags = Component79.debug()
const clone = query.get("clone")
if (clone !== null) Component79.debug({ cloneSkeletons: clone !== "0" })
for (const [key, value] of query) {
  if (key in flags) Component79.debug({ [key]: value !== "0" })
}

App.mount("#main")
