import { Component79 } from "jq79"
import App from "./App.html"

// `?clone=0` mounts with the skeleton clone path off, so the A/B harness can
// pair one build against itself with only that flag differing
// (`npm run benchmark:ab -- --flags`). Absent, the default stands.
const clone = new URLSearchParams(location.search).get("clone")
if (clone !== null) Component79.debug({ cloneSkeletons: clone !== "0" })

App.mount("#main")
