// The skeleton differential test a third time, with rowEffects off: a compiled
// skeleton then gives every binding its own effect instead of sharing one per
// instance. Both are kept, so both are held to the interpreted render.
// RECORD/2026-11-17.closing-the-gap-with-svelte.md, E2
import { Component79 } from "../src/jq79"

Component79.debug({ rowEffects: false })
await import("./skeleton.test")
