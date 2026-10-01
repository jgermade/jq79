# jq79 for VS Code

jq79 components in VS Code: their scripts and templates checked, completed and
hovered as the runtime compiles them, and every part of them colored in its
language.

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
| `` Component79(`…`) ``, `` C79(`…`) ``, `` parseComponent(`…`) `` | a string | HTML |
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
| `$`, `$$`, `$create`, `$reactive`, `$toRaw`, `Component79` | in scope, typed from the `jq79` package when the project has it (`any` when it doesn't) |
| `$mounted`, `$self`, `$$self`, `$emit`, `$updateModel`, `$slots` | in scope, typed as the library types them, whatever version is installed: `$self("input")` is an `HTMLInputElement`, `$self(".x")` an `HTMLElement` ([why](../../docs/dom-helpers.md#what-they-return-typed)) |
| a `<template name="Row">` of the same file | in scope as a component, unless a prop takes the name |
| `await import("./Card.html")` | that file's component, with the props it takes (a missing file is an error); `import("./util")` resolves as in any module |
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

### The template

Every expression in the template is checked too - `{{ }}`, `:attr`, `@event`,
`:if`, `:each`, `:key`, `:with`, a prop on a component tag - against what the
runtime evaluates it against: the component's store, typed by its scripts.

```html
<script :setup>
  let todos = [{ text: "milk", done: false }]
  function save() {}
</script>

<li :each="todo, i in todos" :key="i">{{ todo.text.toUpperCase() }}</li>
<p>{{ todoz.length }}</p>            <!-- ✗ Cannot find name 'todoz'. Did you mean 'todos'? -->
<p>{{ todo }}</p>                    <!-- ✗ Cannot find name 'todo': only inside the :each -->
<button @click="save">save</button>  <!-- ✗ Cannot find name 'save': a top-level function isn't on the store -->
```

| in the template | what it is checked against |
|---|---|
| any expression | the store: props, top-level `let`/`const`/`var`, `$:` targets, a factory's returned bindings, sibling components; `$emit`, `$updateModel`, `$slots`; the globals |
| `:each="item, i in list"` | `item` and `i` (the index, or an object's key) and `$index`, inside the element only |
| `@event="…"` | `$event`, typed by the event's name (`MouseEvent` for `click`), a `CustomEvent` for any other (a component's `$emit`); its `target` is `any`, for `$event.target.value`. An inline arrow's parameter is typed the same way |
| `:with="obj"` | the object's keys, typed from it where it has them |
| `:slot="{ item }"`, `<template :slot.row="{ row }">` | those names, in the content they fill |
| `:user` / `...user` | the name they read |

The template is checked as TypeScript **in every component**, a JavaScript one
included and without `checkJs`: a JavaScript store has the types TypeScript
infers for it (`todos` above is `{ text: string; done: boolean }[]`). A name
that doesn't exist is reported whatever the settings are. A *property* that
doesn't exist on an object a JavaScript script built is only reported with
`noImplicitAny` (or `strict`), because that is TypeScript's rule for JS object
literals: they are open, and reading what they lack is `any`.

A component that declares **no signature** (`:setup="_"`, a factory's `_`, a
script without `:setup`, no script at all) takes whatever its parent passes, so
a name its template reads and nobody declares may be a prop: it isn't reported.
One that declares a signature takes only those props, so it is.

A value or a text is checked as the runtime reads it, after the HTML parser
has decoded its character references: `:if="ready &amp;&amp; count &gt; 0"`
is `ready && count > 0`, and an error still lands where it is written. The
decoder is the one `jq79/precompile` uses (`src/html.ts`), which knows the
references a component plausibly writes; one it doesn't know is read as
written.

### Props, against the child's signature

A component tag's props are checked against the props that component declares,
when the checker can see it: a `<template name>` of the same file, or a
component imported from another one (`await import("./Card.html")` in a setup
script, `import Card from "./Card.html"` in a factory).

```html
<!-- Card.html -->
<script :setup="{ title, count = 0 }: Props" lang="ts">
  interface Props { title: string; count?: number }
</script>
```

```html
<script :setup>
  const Card = await import("./Card.html")
</script>

<Card :title="1" />          <!-- ✗ Type 'number' is not assignable to type 'string' -->
<Card :titel="'x'" />        <!-- ✗ 'titel' does not exist… Did you mean to write 'title'? -->
<Card count="3" />           <!-- ✗ a plain attribute is a string prop -->
<Card ...sdk />              <!-- spreads narrow: their extra keys are fine -->
<Crad />                     <!-- ✗ Cannot find name 'Crad' -->
```

They are read as the runtime reads them (`renderNestedComponent`): `:x` is
prop `x` (`:user-name` is `userName`), `:model.x` is prop `x`, a plain
attribute is a string prop, and `:props`/`...x` are spreads, whose extra keys
the runtime drops without a word. A prop left out is not an error: the child
sees `undefined`, which its default fills. A child without a signature takes
anything, as it does at runtime; a closed one (`:setup`, `:setup="{}"`) takes
nothing. The props' types are what the child's pattern says: its annotation,
or what TypeScript infers from it (`{ step = 1 }` takes a `number`) - a
`:setup` pattern or a factory's first parameter alike, which also types those
props in the child's own template.

**What isn't checked yet:**

- **A component that arrives as a prop** (`:setup="{ Button }"`): its props are
  the parent's business, unknown here.
- **Two bindings of one prop** (`:user` and `:model.user`): the runtime warns
  (`:model.user` wins); the checker doesn't.
- **A page's own scripts.** Only the components a page writes as literals
  (below) are this server's; the rest is the browser's.
- **A component string built at runtime**: one with `${…}` in it, or one that
  isn't a literal at all (`new Component79(source)`).
- **Plain `<style>`**, which VS Code already checks as CSS.

### Completion and hover in tags

In a component's tags the server offers what jq79 reads there, beside the
HTML attributes VS Code's own HTML service offers:

```html
<li :|                 :if  :each  :key  :with  :class  :text  :html  :value …   (snippets: :each="item in items")
<button @|             @click  @input  @submit  @keydown …
<button @click.|       .prevent  .stop  .self  .once  .capture
<Card :|               :title   title: string        ← the props Card declares, typed
                       :count   count?: number
                       :model  :props  :slot
<Card @|               @picked                       ← what Card emits ($emit("picked", …))
<Card><template :|     :slot.header                  ← the named slots Card renders
<script :|             :setup  :mounted  lang="ts"
<style |               scoped  lang
<C|                    Card  ← the components in scope
```

The same goes inside a component literal (`` new Component79(`…`) ``), in a
script or a page. An attribute already on the tag isn't offered again, and
nothing is offered in a script's or style's code, a comment or an attribute's
value (a value is an
expression, completed by TypeScript, with the store's names). Hovering a
directive (`:each`, `@click.prevent`, `:class.active`) says what it does.

### Components written as literals

A component handed to `new Component79(\`…\`)`, `C79(\`…\`)` or
`parseComponent(\`…\`)` as a literal is checked like an `.html` file -
scripts, template, props, rename - in a `.js`/`.ts` file or in a page's
`<script>`:

```js
const Counter = new Component79(`
  <script :setup="{ step = 1 }">
    let count = 0
  </script>
  <button @click="count += step">{{ cuont }}</button>   <!-- ✗ Did you mean 'count'? -->
`).mount(document.body, { title: "Hi" })                // title: in its scope
```

- **It is the string the runtime receives** that is checked: `` \` `` is a
  backtick, `<\/script>` (what a page's script has to write) is `</script>`,
  and every position still lands where it is written.
- **A literal with `${…}` in it is not checked**: what it holds depends on
  what runs.
- **Mount data.** A root reads what it is mounted with whatever its
  signature says. Where that is written beside the literal - `.mount(el, { … })`
  or `.render({ … })`, at the end of a chain of calls on it - its keys are in
  the component's scope. Data passed any other way (a variable, a helper
  function) can't be seen, and a closed root that reads it is reported.
- **In a script, the server answers only inside the literals.** The rest of
  the file is the editor's own TypeScript, which goes on serving it as
  before, so nothing is reported twice.

### One name, in the script and the template

A name a script declares and the template reads is one name to the editor:

- **Rename** it anywhere (F2) and the declaration, every use in the scripts,
  and every read in the template change together. A name one `<script>`
  declares and another uses is one name too: the scripts share one store.
  So is a key a `:with` region reads: renaming `name` under `:with="draft"`
  renames `draft.name`.
- **Go to definition** from `{{ count }}` lands on `let count` in the script.
- **Find all references** from the script lists the template's reads.

It doesn't depend on `typescript.preferences.useAliasesForRenames`.

A prop is the exception: renaming one in `:setup="{ step }"` renames it in this
component, not in the parents that pass it (`:step="…"`), which are other files'
business.

## Checking from a terminal

The same checks, for CI, are the [`jq79-check`](../check/README.md) package:

```sh
npx jq79-check                          # every .html, and every script with a component literal
npx jq79-check src --checkJs            # …type-checking JavaScript scripts too
npx jq79-check --project tsconfig.json  # what a tsconfig includes, with its options
npx jq79-check src --format github      # annotations on a pull request
```

It prints one line per problem (`file:line:col - error TS2322: …`) and exits 1
when there is an error, 2 when the command line is wrong. It is this
extension's checker, built here (`npm run build` → `dist/check.js`) and shipped
from [`editors/check/`](../check/). Until it is on npm, run it from a clone:
`node editors/vscode/dist/check.js`.

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
code --install-extension jq79-vscode-0.10.0.vsix
```

## Working on it

```sh
npm install
npm test          # builds, type-checks, then: the grammars, the checker (scripts and templates), the server over LSP
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
- **The template** (`src/template.ts`): each component's template becomes a
  function in a second virtual file, `<file>.html.template.ts`, always
  TypeScript, which imports the store's type from the first one. Its own
  HTML reader keeps offsets, which the runtime's doesn't need.
- **The server** (`src/server.ts`, `src/language.ts`) is
  [Volar](https://volarjs.dev)'s, with TypeScript 5.9 shipped inside the
  extension: Volar needs TypeScript's JavaScript API, which the native
  TypeScript 7 doesn't have.
