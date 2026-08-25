# jq79 — findings

Observations from building `src/craft/` (a drag-and-drop file demo) against
`jq79@https://jgermade.github.io/jq79/jq79.js`. Line references are to
[jgermade/jq79](https://github.com/jgermade/jq79) at the version served there.

Written in English to match the repo's own docs and comments — say the word and I'll
translate it.

One of these is a functional bug (#1). The rest are footguns and reporting gaps: they
didn't break anything on their own, but each one turned a small mistake in the consuming
app into a symptom with no diagnostic trail.

---

## 1. `import()` in a script resolves against jq79's URL, not the component's

**Severity:** bug. Breaks any relative `import()` whenever jq79 is loaded cross-origin
(CDN, GitHub Pages) or from a different directory than the component.

The transform rewrites `import(…)` to `$__import(…)`
([`transform.ts:29`](https://github.com/jgermade/jq79/blob/main/src/transform.ts#L29)),
specifically so the specifier doesn't inherit `new Function`'s base URL. But `$import`
([`jq79.ts:2258`](https://github.com/jgermade/jq79/blob/main/src/jq79.ts#L2258)) forwards it
untouched to `importResource`
([`jq79.ts:1598-1599`](https://github.com/jgermade/jq79/blob/main/src/jq79.ts#L1598-L1599)):

```ts
const importResource = (url: string): Promise<any> =>
  /\.html?([?#]|$)/.test(url) ? fetchComponent(url) : import(url)
```

That bare `import(url)` lives *inside the jq79 module*, so a relative specifier resolves
against wherever `jq79.js` is hosted.

**Repro.** App served from `http://localhost:8024/craft/`, jq79 loaded from
`https://jgermade.github.io/jq79/jq79.js`:

```html
<script :setup>
  const { opfsService } = await import('./services/opfs.service.js');
</script>
```

```
Access to script at 'https://jgermade.github.io/craft/services/opfs.service.js'
from origin 'http://localhost:8024' has been blocked by CORS policy
```

**Note the asymmetry.** In the same file, `Component79.fetchAll(['./layout/header.html', …])`
resolved correctly — `fetchComponent` doesn't have this problem. Only the non-`.html`
branch, the one that reaches native `import()`, is wrong. That's a good argument for which
side is the defect.

**Suggested fix.** The component's own path is already available and unused — `this.filename`,
threaded to scripts as `at.filename` for the `sourceURL` comment
([`jq79.ts:2308`](https://github.com/jgermade/jq79/blob/main/src/jq79.ts#L2308)):

```ts
const $import = (url: string): Promise<any> =>
  modules && url in modules
    ? Promise.resolve(modules[url])
    : importResource(resolveFrom(url, this.filename))
```

where `resolveFrom` is `new URL(url, new URL(base ?? document.baseURI, document.baseURI)).href`
for relative specifiers, and passes bare specifiers (`lodash`, `@scope/pkg`) through untouched
so the import map still applies. Falling back to `document.baseURI` when a component has no
filename keeps inline components working.

**One loose end.** jq79's host explains the wrong *origin* conclusively, but I couldn't
account for the `/craft/` path segment from reading the source — resolving against
`https://jgermade.github.io/jq79/jq79.js` should give `/jq79/services/…`. Worth capturing the
exact failing request before writing the fix, in case a second base is involved.

---

## 2. Template expressions fail silently

**Severity:** reporting gap. Cost the most debugging time of anything here.

`evalExpr` discards every exception
([`jq79.ts:100-104`](https://github.com/jgermade/jq79/blob/main/src/jq79.ts#L100-L104)), and
the handler binders then treat `undefined` as "nothing to do"
([`jq79.ts:176-177`](https://github.com/jgermade/jq79/blob/main/src/jq79.ts#L176-L177)). A
typo'd name in `@click`, `:class`, `{{ }}` or a handler that was never defined produces no
error, no warning, and nothing in devtools.

The `catch` itself is correct and should stay — expressions re-evaluate per effect run and per
`:each` item, so transient `undefined` during a render has to stay quiet. But `ReferenceError`
is separable: every declared name is pre-declared on the store before the setup script runs
([`jq79.ts:2320`](https://github.com/jgermade/jq79/blob/main/src/jq79.ts#L2320)), so a name
`with` couldn't resolve is declared nowhere and cannot be transient.

Full analysis, patch, dedupe strategy and tests: **[reporting-issue.md](reporting-issue.md)**.

---

## 3. `function` declarations never reach the store

**Severity:** footgun + docs gap. Directly caused the bug that #2 then hid.

The setup transform rewrites top-level declarations into store assignments, but the pattern
covers only `let`, `var`, `const`
([`transform.ts:27`](https://github.com/jgermade/jq79/blob/main/src/transform.ts#L27)):

```js
const DECLARATION_START_RE = /(?:let|var|const)(?:\s+(?=[A-Za-z_$])|\s*(?=[{[]))/y
```

A top-level `function onFiles() {}` stays a lexical binding inside the `with` block and never
becomes a store property, so the template can't see it:

```html
<script :setup>
  function onFiles(event) { … }   <!-- invisible to the template -->
  const onFiles = (event) => { … } <!-- works -->
</script>
<DropForm @files="onFiles" />
```

Combined with #2 this fails in total silence, which is a rough first experience — `function`
and `const fn =` are interchangeable everywhere else in JS.

**Options, in increasing order of cost:**

1. **Document it.** `docs/setup-scripts.md` says *"Top-level `let` / `var` / `const`
   declarations become properties of the reactive store"* — the exclusion is implied but never
   stated. One sentence would close most of the gap.
2. **Warn.** The #2 patch already names this cause in its message, which covers it in practice.
3. **Support it.** Extend `DECLARATION_START_RE` to function declarations. Not free:
   rewriting `function f() {}` to `f = function f() {}` **loses hoisting**, so code above the
   declaration that calls `f` breaks. Consistent with `const` already not hoisting and with the
   Svelte-style ordering the docs describe, but a behavior change for existing components —
   a versioned decision, not a patch.

My suggestion: 1 + 2 now, 3 separately if at all.

---

## 4. An unparseable `:setup` signature silently means "no signature"

**Severity:** papercut, but it disables a contract without saying so.

`parsePropsPattern` returns `null` for anything that doesn't start with `{`
([`transform.ts:563-565`](https://github.com/jgermade/jq79/blob/main/src/transform.ts#L563-L565)),
and `null` means the permissive, undeclared behavior — the same as the documented `:setup="_"`.

So a signature with a typo doesn't fail, it silently opts the component out of prop checking:

```html
<script :setup=",{ Component79, $reactive }">   <!-- leading comma: parses to null -->
```

I wrote that line myself, from the factory-mode `(props, ctx)` signature, assuming `:setup`
was an injection list rather than a props signature. It looked like it worked because
`Component79` and `$reactive` come from `SETUP_HELPERS`
([`jq79.ts:2521`](https://github.com/jgermade/jq79/blob/main/src/jq79.ts#L2521)) regardless.
Nothing anywhere said the signature was being ignored.

**Suggested fix.** Warn when the attribute value is non-empty, isn't the documented `_`, and
doesn't parse as an object pattern. The rule *"what carries a `$` comes from the library; what
doesn't comes from the parent"* in `docs/components.md` is the thing that resolves the
confusion — worth putting near the `:setup` description in `docs/setup-scripts.md` too, since
that's the page you read first.

---

## 5. Handler error propagation differs by handler style

**Severity:** minor, but surprising once you know it.

Both binders evaluate the attribute, then call the result only if it's a function
([`jq79.ts:176-177`](https://github.com/jgermade/jq79/blob/main/src/jq79.ts#L176-L177) and the
element equivalent). That call happens **outside** `evalExpr`'s `try`. So:

- `@drop="on.drop"` — resolves to a function, called outside the `try`. Exceptions thrown
  inside the handler propagate to the console normally.
- `@submit="on.submit($event.target.files)"` — the call happens **during** `evalExpr`, inside
  the `try`. Any exception in the handler body is swallowed.

Two syntaxes the docs present as equivalent (*"all three styles work: a handler reference, an
inline arrow, or an inline statement"*, `docs/template-syntax.md:203`) have different
debugging behavior. Worth a sentence there, and it mostly resolves once #2 lands.

---

## What was not jq79's fault

For balance — most of what broke in the demo was the app's own doing: a handler referenced but
never defined, a service called with the wrong argument count and argument order, a list mixing
strings with `File` objects, `dragleave` firing on child elements. jq79 didn't cause any of
those. What it did was make several of them produce no output at all, which is what #2 is
about.
