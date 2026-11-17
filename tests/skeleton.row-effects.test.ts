// The skeleton differential test a third time, with rowEffects on: a compiled
// skeleton then shares one effect per instance between its guarded bindings
// instead of giving each its own. Off by default - it measured slower on select
// and update - and held to the interpreted render while it exists.
// RECORD/2026-11-17.closing-the-gap-with-svelte.md, E2
import { Component79 } from "../src/jq79"

Component79.debug({ rowEffects: true })
await import("./skeleton.test")
