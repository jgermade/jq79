// The skeleton differential test again, with compileSkeletons off: the clone
// path then interprets its plan's ops instead of running the function compiled
// from them, and that interpreter is still the fallback (safe mode with nothing
// precompiled for a plan's shape), so it keeps every check it had.
// RECORD/2026-11-17.closing-the-gap-with-svelte.md, E1
import { Component79 } from "../src/jq79"

Component79.debug({ compileSkeletons: false })
await import("./skeleton.test")
