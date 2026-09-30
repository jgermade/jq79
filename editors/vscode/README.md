# jq79 for VS Code

jq79 components in VS Code: their scripts checked, completed and hovered as
the runtime compiles them, and every part of them colored in its language.

```html
<script :setup="{ step = 1 }: Props" lang="ts">   <!-- TypeScript, the :setup signature too -->
  let count: number = 0
</script>

<style lang="scss" scoped>                         <!-- SCSS -->
  $gap: 4px;
</style>

<li :each="user in users" @click="pick(user)">    <!-- JS: every :attr, @event and {{ }} -->
  {{ user.name }}
</li>
```

```js
new Component79(`                                  // HTML, <script lang> and <style lang> included
  <p :class="{ done }">{{ label }}</p>
`)

html`<li class="${cls}">${label}</li>`             // html, svg, css, scss, less, js, ts
```

## What it colors

| | without the extension | with it |
|---|---|---|
| `<script lang="ts">` | JavaScript | TypeScript |
| `<script type="text/typescript">` | nothing | TypeScript |
| `<style lang="scss">` / `"less"` | CSS | SCSS / Less |
| `<style lang="sass">` / `"styl"` | CSS | Sass / Stylus, if an extension for it is installed |
| `` Component79(`…`) `` | a string | HTML |
| `` html`…` `` `` css`…` `` `` ts`…` `` … | a string | that language |
| `{{ expr }}` in text | text | JavaScript |
| `:attr="…"`, `@event="…"`, `...spread` | a string | JavaScript |
| `:each="item, i in items"` | a string | JavaScript, with `item` and `i` as bindings |
| `:setup="{ step = 1 }: Props"`, `:slot="{ item }"` | a string | TypeScript parameters, type included |

Which blocks count is the [Vite plugin](../../docs/vite-plugin.md)'s rule: `lang="ts"`
or `lang="typescript"`, or — only when there is no `lang` — a `type` of
`text/typescript`, `application/typescript` or their `x-` spellings. A block
the plugin wouldn't compile keeps VS Code's own coloring.

`${…}` inside a literal is colored as JavaScript at any depth, an attribute
value included.

## What it checks

A language server reads each component's `<script>`s the way the runtime
compiles them, and runs TypeScript over that. So a setup script is checked in
its own terms:

```html
<script :setup="{ step = 1 }: Props" lang="ts">
  interface Props { step?: number }
  let count = 0
  $: doubled = count * step          // doubled: number
  $: schedule(count)                 // the arguments are dependencies, not an error
  await $mounted()
  $emit("changed", doubled)          // $emit, $self, $reactive… typed
  count = "one"                      // ✗ Type 'string' is not assignable to type 'number'
</script>
```

| in the component | what the checker sees |
|---|---|
| `:setup="{ step = 1 }: Props"` | the props, destructured with that type (the error in the pattern is reported on the attribute) |
| `$: x = expr`, `x` declared nowhere | `let x = expr`, typed |
| a name another `<script>` of the component declares | in scope (`any`): they share one store |
| an assignment to a name declared nowhere | in scope: it goes to the store |
| a *read* of a name declared nowhere | an error: `Cannot find name` |
| `$`, `$$`, `$create`, `$reactive`, `$toRaw`, `Component79`, `$mounted`, `$self`, `$$self`, `$emit`, `$updateModel`, `$slots` | in scope, typed from the `jq79` package when the project has it |
| a `<template name="Row">` of the same file | in scope as a component, unless a prop takes the name |
| `await import("./Card.html")` | a component; `import("./util")` resolves as in any module |
| a static `import` in a setup script | an error, as it is at runtime; in a factory script, a module import |
| `export default (props, ctx) => …` | `ctx` typed: `$data`, `$effect`, `$emit`, … |
| `<style lang="scss">` / `"less"` | checked as SCSS / Less |

A `lang="ts"` script is type-checked. A JavaScript one gets completion, hover
and go-to-definition, and is type-checked when `checkJs` is on (in a
`tsconfig.json`/`jsconfig.json`, or `// @ts-check` in the script), as any JS
file. The project's `tsconfig.json` is used when it takes the `.html` files
(`"include": ["src/**/*.ts", "src/**/*.html"]`).

**It turns VS Code's own script checks off** (`"html.validate.scripts": false`),
because those read the same scripts again as plain JavaScript and report every
jq79 name as missing. That setting covers every inline script in `.html` files,
pages included, where this server doesn't check (a file with `<!doctype>`,
`<html>`, `<head>` or `<body>` is a page). Set it back to `true` to have them
there.

**What isn't checked yet:**

- **The template.** `{{ usr.name }}`, `:if`, `@click` are colored, not checked.
- **Pages, and components inside `` Component79(`…`) `` strings.** Only
  `.html` component files.
- **Plain `<style>`**, which VS Code already checks as CSS.

## Checking from a terminal

The same checks, for CI:

```sh
node editors/vscode/dist/check.js                  # every .html under the current directory
node editors/vscode/dist/check.js --checkJs        # …type-checking JavaScript components too
node editors/vscode/dist/check.js --project tsconfig.json
```

It prints one line per problem (`file:line:col - error TS2322: …`) and exits 1
when there is an error. It isn't published on its own yet; build it with
`npm run build` in this directory.

## Limits of the coloring

TextMate grammars read one line at a time and can only close the rule they are
in, which is where all of these come from:

- **The mark must be on the line the tag opens on.** `<script` with `lang="ts"`
  two lines further down is colored as VS Code would without this extension.
- **The literal must open on the line of its call or tag**: `` Component79(` ``,
  `` html` ``.
- **A one-line JS/TS statement left open runs past the backtick**:
  `` js`let x = 1` `` does, `` js`let x = 1;` `` doesn't, nor does a closing
  backtick on a line of its own. The same goes for HTML left open
  (`` html`<input` ``).
- **A `//` comment after code on the closing line swallows `</script>`** — as
  it does for plain JS in VS Code's own HTML grammar.
- **An attribute value or a `{{ }}` is read a line at a time.** That is what
  keeps an expression from running past its closing quote or `}}`; the cost is
  that a template string or a `/* */` comment that spans two lines of one value
  is colored as if each line started afresh.
- **The attribute name and its `=` must be on one line**, and `:each`'s
  bindings on the line its value opens on.
- **It applies to every `.html` file**, not only to components: there is no way
  for a grammar to tell one from the other. `lang` on a `<script>` means nothing
  to a browser, so outside jq79 it is rarely there to be matched. `{{ }}`,
  `:attr` and `@event` are there in Vue, Alpine and Angular-style templates
  too, and hold JavaScript in them as well.

## Installing it

It isn't on the Marketplace yet. From this directory:

```sh
npm run package                                  # → jq79-vscode-<version>.vsix
code --install-extension jq79-vscode-0.1.0.vsix
```

## Working on it

```sh
npm install
npm test          # builds, type-checks, then: the grammars, the checker, the server over LSP
node test/tokenize.mjs text.html.derivative some-component.html   # every token and its scopes
```

- **Grammars** (`syntaxes/`): the tests tokenize with VS Code's own HTML, JS,
  TS and CSS grammars, pinned to one release in
  [`test/fetch-grammars.mjs`](test/fetch-grammars.mjs) and wired from this
  `package.json`'s `injectTo`, the way VS Code wires them.
- **The checker** (`src/component.ts`): a component file becomes one virtual
  `.ts`/`.js` with a mapping back to the `.html`. What counts as a store name,
  a factory script or a prop is the runtime's own code, imported from
  [`src/transform.ts`](../../src/transform.ts) and
  [`src/source.ts`](../../src/source.ts). Every component in
  [`tutorial/`](../../tutorial/) must check clean
  ([`test/check.mjs`](test/check.mjs)), so a runtime change that the virtual
  code doesn't follow fails there.
- **The server** (`src/server.ts`, `src/language.ts`) is
  [Volar](https://volarjs.dev)'s, with TypeScript 5.9 shipped inside the
  extension: Volar needs TypeScript's JavaScript API, which the native
  TypeScript 7 doesn't have.
