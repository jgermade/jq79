// jq79-check as its users run it: dist/check.mjs in a process of its own, its
// output and its exit code. What it reports is check.mjs's; this is the
// command line around it, which is the public part of the jq79-check package
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const cli = join(root, "dist/check.mjs")

const run = (cwd, ...args) => {
  const { stdout, stderr, status } = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" })
  return { out: stdout.trim().split("\n").filter(Boolean), err: stderr, status }
}

const project = files => {
  const dir = mkdtempSync(join(tmpdir(), "jq79-cli-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  return dir
}

const BROKEN = `<script :setup>let count = 0</script>\n<p>{{ cuont }}</p>`
const CLEAN = `<script :setup>let count = 0</script>\n<p>{{ count }}</p>`

test("--version is the jq79-check package's", () => {
  const { version } = JSON.parse(readFileSync(join(root, "../check/package.json"), "utf8"))
  assert.deepEqual(run(root, "--version").out, [version])
})

test("--help, and a wrong command line exits 2 with it", () => {
  assert.match(run(root, "--help").out[0], /^jq79-check - /)
  for (const args of [["--bogus"], ["--format", "xml"], ["--project"], ["-p", "tsconfig.json", "src"], ["missing"]]) {
    const { status, err } = run(root, ...args)
    assert.equal(status, 2, args.join(" "))
    assert.match(err, /^jq79-check: /)
  }
})

test("a directory: every .html, and every script with a component literal; errors exit 1", () => {
  const dir = project({
    "src/Broken.html": BROKEN,
    "src/Clean.html": CLEAN,
    "src/app.js": "new Component79(`<p>{{ x }}</p>`)\n",
    "src/plain.js": "export const n = 1\n",
    "node_modules/dep/Ignored.html": BROKEN,
  })
  const { out, status } = run(dir)
  assert.equal(status, 1)
  assert.deepEqual(out, [
    "src/Broken.html:2:7 - error TS2552: Cannot find name 'cuont'. Did you mean 'count'?",
    "3 file(s) checked: 1 error(s), 0 warning(s)",
  ])
})

test("paths narrow it, and no error exits 0", () => {
  const dir = project({ "a/Broken.html": BROKEN, "b/Clean.html": CLEAN })
  const { out, status } = run(dir, "b")
  assert.equal(status, 0)
  assert.deepEqual(out, ["1 file(s) checked: 0 error(s), 0 warning(s)"])
  assert.equal(run(dir, "a/Broken.html", "b").status, 1)
})

test("--format github: one annotation per problem, on one line", () => {
  const dir = project({ "Broken.html": BROKEN })
  assert.deepEqual(run(dir, "--format", "github").out[0],
    "::error file=Broken.html,line=2,col=7,title=jq79-check TS2552::Cannot find name 'cuont'. Did you mean 'count'?")
})

test("--project: what the tsconfig includes, with its options", () => {
  const dir = project({
    "tsconfig.json": JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true, strict: true, noEmit: true }, include: ["src/**/*.html", "src/**/*.ts"] }),
    "src/Card.html": `<script :setup>let count = 0\ncount = "x"</script>\n<p>{{ count }}</p>`,
    "other/Broken.html": BROKEN,
  })
  const { out, status } = run(dir, "--project", "tsconfig.json")
  assert.equal(status, 1)
  assert.deepEqual(out, [
    "src/Card.html:2:1 - error TS2322: Type 'string' is not assignable to type 'number'.",
    "1 file(s) checked: 1 error(s), 0 warning(s)",
  ])
})

test("--project: an include said by the config it extends, and a tsconfig with comments", () => {
  const dir = project({
    "tsconfig.base.json": `{\n  // what the app compiles\n  "include": ["src"],\n  "compilerOptions": { "noEmit": true, },\n}`,
    "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json", compilerOptions: { allowJs: true } }),
    "src/deep/Broken.html": BROKEN,
    "other/Broken.html": BROKEN,
  })
  const { out, status } = run(dir, "-p", "tsconfig.json")
  assert.equal(status, 1)
  assert.deepEqual(out, [
    "src/deep/Broken.html:2:7 - error TS2552: Cannot find name 'cuont'. Did you mean 'count'?",
    "1 file(s) checked: 1 error(s), 0 warning(s)",
  ])
})

test("a file's problems in the order they are in it", () => {
  const dir = project({ "Card.html": `<script :setup lang="ts">\n  const s: string = 1\n</script>\n<p>{{ nope }}</p>\n<p>{{ also }}</p>` })
  assert.deepEqual(run(dir).out.slice(0, 3).map(line => line.split(" - ")[0]), ["Card.html:2:9", "Card.html:4:7", "Card.html:5:7"])
})
