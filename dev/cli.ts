import { devServer, type WatchEntry } from "./dev"

// the jq79 command. One subcommand so far:
//
//   npx jq79 dev [dir] [--port 4179] [--host localhost]
//
// This is the entry point the no-bundle path deserves: someone who chose jq79
// to avoid a toolchain shouldn't have to write a script to get a dev server -
// which is also why every devServer option is reachable from here.

const USAGE = `jq79 - a mini reactive component library

usage:
  jq79 dev [dir]        serve dir (default: .) with hot reload

options:
  -p, --port <port>     port to listen on (default: 4179)
  -H, --host <host>     host to bind (default: localhost)
  -w, --watch <glob>    also watch this path or glob, reloading on a change
                        (repeatable; handlers need the js api)
      --header <h>      response header, "name: value" (repeatable)
  -h, --help            show this message
`

const args = process.argv.slice(2)
const [command, ...rest] = args

if (command !== "dev" || rest.includes("-h") || rest.includes("--help")) {
  const unknown = command && command !== "dev" && !command.startsWith("-")
  if (unknown) console.error(`unknown command: ${command}\n`)
  console.log(USAGE)
  process.exit(unknown ? 1 : 0)
}

const options: {
  rootDir?: string
  port?: number
  host?: string
  watch?: WatchEntry[]
  headers?: Record<string, string>
} = {}

for (let i = 0; i < rest.length; i++) {
  const arg = rest[i]
  if (arg === "-p" || arg === "--port") options.port = Number(rest[++i])
  else if (arg === "-H" || arg === "--host") options.host = rest[++i]
  else if (arg === "-w" || arg === "--watch") {
    // no handler from here: an argument can't carry a function, and an entry
    // without one reloads the page, which is all a terminal was ever going to ask for
    const pattern = rest[++i]
    if (!pattern) {
      console.error("--watch takes a path or glob")
      process.exit(1)
    }
    ;(options.watch ??= []).push({ pattern })
  } else if (arg === "--header") {
    // split on the first colon only: a value can hold one (a url, a port)
    const [name, ...value] = (rest[++i] ?? "").split(":")
    if (!name || !value.length) {
      console.error(`--header takes "name: value"`)
      process.exit(1)
    }
    ;(options.headers ??= {})[name.trim()] = value.join(":").trim()
  } else if (!arg.startsWith("-")) options.rootDir ??= arg // the directory to serve
  else {
    console.error(`unknown option: ${arg}\n${USAGE}`)
    process.exit(1)
  }
}

if (options.port !== undefined && !Number.isInteger(options.port)) {
  console.error("--port takes a number")
  process.exit(1)
}

// a --watch path that isn't there refuses to start; the message names it, and a
// stack trace over a typo in an argument would only bury it
const server = await devServer(options).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

console.log(`jq79 dev → ${server.url}`)

const stop = () => {
  void server.close().then(() => process.exit(0))
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
