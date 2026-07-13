// Serves site/ on localhost with livereload, rebuilding it whenever a source
// the site is generated from changes (README, docs/, assets/, the build script
// itself). Same output as `npm run site`, just on a watch loop.
//
//   npm run site.dev            → http://localhost:4179
//   PORT=8080 npm run site.dev
//
// Expects `npm run build` and `npm run test:coverage` to have run first, same
// as the one-shot build.

import { spawn } from "node:child_process"
import { watch } from "chokidar"
import { createServer } from "vite"

const PORT = Number(process.env.PORT ?? 4179)
const WATCHED = ["README.md", "docs", "assets", "scripts/build-site.mjs"]

// `mpa` serves docs/*.html at their own paths instead of falling back to a
// single index; vite injects its own hmr client into every page it serves,
// which is what makes the reload below land in the browser
const server = await createServer({
  root: "site",
  configFile: false,
  appType: "mpa",
  // the build wipes and recreates site/, so vite's own watcher would fire once
  // per generated file; ignore it and let the rebuild send the single reload
  server: { port: PORT, watch: { ignored: ["**"] } },
  optimizeDeps: { noDiscovery: true },
})

// --- rebuilds ----------------------------------------------------------------

let building = false
let queued = false
// vite buffers messages sent while no client is connected and flushes them on
// connect, so announcing the startup build would reload the first page load
let announce = false

const build = () => {
  if (building) {
    queued = true
    return
  }
  building = true
  const started = Date.now()
  const child = spawn(process.execPath, ["scripts/build-site.mjs"], { stdio: ["ignore", "ignore", "inherit"] })
  child.on("exit", code => {
    building = false
    if (code === 0) {
      if (announce) server.ws.send({ type: "full-reload", path: "*" })
      console.log(`site rebuilt in ${Date.now() - started}ms`)
    } else {
      console.error(`site build failed (exit ${code})`)
    }
    announce = true
    if (queued) {
      queued = false
      build()
    }
  })
}

// --- go ----------------------------------------------------------------------

build()

// node's fs.watch reports a single save as two `change` events up to a second
// apart on macOS, which is too far apart to debounce; chokidar stats the file
// and only reports it once it has settled
watch(WATCHED, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100 } }).on("all", build)

await server.listen()
console.log(`site.dev → http://localhost:${PORT} (watching ${WATCHED.join(", ")})`)
