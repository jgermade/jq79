# jq79 `dev` — findings

Observations from moving this repo's dev loop (`make up`) onto `jq79/dev`, replacing a
hand-rolled Python server that did the same job. Line references are to
[jgermade/jq79](https://github.com/jgermade/jq79) at `ccfb7d8` ("the dev server takes
response headers and watch handlers").

Written in English to match the repo's own docs and comments — say the word and I'll
translate it.

**The headline is that it worked.** `headers` and `watch` were exactly the two things
missing, and with them the server replaced ~320 lines of custom SSE/watcher/injection code
with a config object. What follows is one gap and one footgun found on the way in.

Context, because it shapes what this project stresses: the served tree is `dist/`, the
sources are `src/`, one of the assets is a 10 MB `.wasm`, and the page must be
cross-origin isolated or the engine will not start at all.

---

## 1. `.wasm` is missing from `CONTENT_TYPES`, and `headers` cannot fill the gap

**Severity:** bug. It defeats the server's own stated purpose for one file type, and by
design there is no way for the consumer to work around it.

`CONTENT_TYPES`
([`dev/dev.ts:58-75`](https://github.com/jgermade/jq79/blob/main/dev/dev.ts#L58-L75))
has no `.wasm` entry, so a WebAssembly module falls to the default
([`dev/dev.ts:182`](https://github.com/jgermade/jq79/blob/main/dev/dev.ts#L182)):

```ts
const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream"
```

`application/octet-stream` is precisely the one value the WebAssembly streaming APIs
reject. Emscripten's glue then reports and falls back:

```
wasm streaming compile failed: TypeError: Failed to execute 'compileStreaming' on
'WebAssembly': Incorrect response MIME type. Expected 'application/wasm'.
falling back to ArrayBuffer instantiation
```

Nothing breaks — but a 10 MB module stops compiling while it downloads and is buffered
whole instead, which is the difference the streaming API exists for.

**Why it can't be worked around.** `headers` deliberately excludes `content-type`
([`dev/dev.ts:144-149`](https://github.com/jgermade/jq79/blob/main/dev/dev.ts#L144-L149)),
and that exclusion is right: a global content-type would contradict every response it
lands on. So the table is the only place this can be fixed.

**Why it matters more than a missing mime usually would.** The server's pitch is *"what
you develop against is what a static host would serve"*. Every static host — GitHub
Pages, Netlify, nginx, `python -m http.server` — sends `application/wasm` for `.wasm`.
This is the one case where developing against the dev server is *less* faithful than
deploying, and the symptom appears only in production-shaped code.

**Suggested fix.** One line, plus two neighbours worth having for the same reason:

```ts
".wasm": "application/wasm",
".mem": "application/octet-stream",   // emscripten
".data": "application/octet-stream",  // emscripten --preload-file
```

---

## 2. A `watch` handler that copies a directory silently costs you hot reload

**Severity:** docs gap. Nothing here is wrong; it is that the obvious way to wire a build
into `fn` quietly produces the one outcome the server exists to avoid.

`docs/dev-server.md` frames `fn` as *"the build step this server doesn't have, in the six
lines it takes"*, with a sass example that writes a single file. For a project whose build
*is* a directory copy — which is the common shape for the no-bundle path this server
targets — the natural handler is:

```js
{ pattern: "src/craft/**", fn: () => execFileSync("make", ["build-craft"]) }
// where build-craft is: rm -rf dist/craft && cp -R src/craft dist/craft
```

Every edit then produced a full page reload, never a hot swap. The cause is not the
watcher, which is exact — I measured it:

| what wrote to the served tree | change events |
|---|---|
| direct write of one file | **1** |
| `cp -R` of the tree (22 files) | all of them |
| `rsync -a --delete`, one file actually different | **58** |

One `.js` or `.css` anywhere in the burst is enough: it has no instance to swap into, so
`changed()` sends `reload`
([`dev/dev.ts:314-319`](https://github.com/jgermade/jq79/blob/main/dev/dev.ts#L314-L319)),
and the reload wins over every `update` in the same batch. A whole-tree copy puts all of
them in every burst.

**rsync is not the escape hatch it looks like.** `-a` was worse than `cp -R`, and not
because it rewrites files — after a no-op sync, `rsync -ain --delete` reports nothing to
transfer and the destination's inode, mtime *and* ctime are unchanged. Yet the watcher
still sees every file. Presumably `-a` re-applies times/permissions/ownership and those
syscalls notify regardless of whether the value changed; I did not isolate which one, and
`--omit-dir-times` made no difference. Worth someone confirming before it goes in the docs
— and worth knowing that macOS ships openrsync while CI ships GNU rsync, so this is not a
behaviour to build guidance on.

**What actually works,** and what this repo now does: let the handler copy exactly the
paths it was handed. `fn(files)` gives them precisely, which turns out to be the feature
that matters most about it:

```js
const mirror = (from, to) => async (files) => {
  for (const file of files) {
    const path = relative(resolve(from), file)
    const destination = join(to, path)
    try { await stat(file) } catch {
      await rm(destination, { force: true, recursive: true })   // deleted or renamed
      continue
    }
    await mkdir(dirname(destination), { recursive: true })
    await cp(file, destination)
  }
}
```

One event per edit, and the hot swap lands.

**Suggested fix.** Docs, in the `watch` section: a sentence saying that what a handler
writes is watched like anything else, so a handler that rewrites files it did not need to
turns one edit into a burst — and that `files` is there so it doesn't have to. A second
example next to the sass one, copying `files` rather than a tree, would carry it better
than prose.

---

## What was not jq79's fault

Most of the friction was this project's own: the build target it called was a
`rm -rf && cp -R`, which is a fine build and a poor dev-loop step, and I reached for rsync
before measuring. The watcher, the burst coalescing, the page/fragment split via
`Sec-Fetch-Dest`, the `update`-then-fall-back-to-`reload` contract and the runtime
handshake all did exactly what the docs said, first time.

Two things stood out as better than what they replaced. `Sec-Fetch-Dest` is a genuinely
cleaner way to tell a page from a fetched component than sniffing for `</body>`, which is
what I had. And the round trip — a handler outside the root writes into the root, and the
write comes back round *with a url* — means nothing has to declare where a source file
ends up being served. The build already said it.
