import { devServer } from "./dev"

// the jq79 command. One subcommand so far:
//
//   npx jq79 dev [dir] [--port 4179] [--host localhost]
//
// This is the entry point the no-bundle path deserves: someone who chose jq79
// to avoid a toolchain shouldn't have to write a script to get a dev server.

const USAGE = `jq79 - a mini reactive component library

usage:
  jq79 dev [dir]        serve dir (default: .) with hot reload

options:
  -p, --port <port>     port to listen on (default: 4179)
  -H, --host <host>     host to bind (default: localhost)
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

const options: { rootDir?: string; port?: number; host?: string } = {}

for (let i = 0; i < rest.length; i++) {
  const arg = rest[i]
  if (arg === "-p" || arg === "--port") options.port = Number(rest[++i])
  else if (arg === "-H" || arg === "--host") options.host = rest[++i]
  else if (!arg.startsWith("-")) options.rootDir ??= arg // the directory to serve
  else {
    console.error(`unknown option: ${arg}\n${USAGE}`)
    process.exit(1)
  }
}

if (options.port !== undefined && !Number.isInteger(options.port)) {
  console.error("--port takes a number")
  process.exit(1)
}

const server = await devServer(options)

console.log(`jq79 dev → ${server.url}`)

const stop = () => {
  void server.close().then(() => process.exit(0))
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
