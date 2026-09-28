# jq79 for VS Code

Syntax highlighting for the parts of a jq79 component that VS Code's HTML
grammar doesn't know are written in another language. Grammars only: nothing
runs, nothing is configured.

```html
<script :setup="{ step = 1 }: Props" lang="ts">   <!-- TypeScript -->
  let count: number = 0
</script>

<style lang="scss" scoped>                         <!-- SCSS -->
  $gap: 4px;
</style>
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

Which blocks count is the [Vite plugin](../../docs/vite-plugin.md)'s rule: `lang="ts"`
or `lang="typescript"`, or — only when there is no `lang` — a `type` of
`text/typescript`, `application/typescript` or their `x-` spellings. A block
the plugin wouldn't compile keeps VS Code's own coloring.

`${…}` inside a literal is colored as JavaScript at any depth, an attribute
value included.

## What it doesn't do

**It colors; it doesn't check.** The red squiggles come from VS Code's HTML
language service, which no grammar reaches. That service reads a script's
language from `type` and ignores `lang`, so:

- `lang="ts"` is colored by this extension and *checked as JavaScript* by VS
  Code: a squiggle under every annotation. Turn the check off with
  `"html.validate.scripts": false` (it goes for every inline script).
- `type="text/typescript"` is colored by this extension and checked as
  TypeScript by VS Code — which doesn't know jq79's implicit names (props,
  `$:` declarations, `$mounted`) and flags those instead.

Checking a component in its own terms needs a language server that knows those
names. That is the next phase, and its plan is in
[RECORD/2026-09-28.an-editor-extension.md](../../RECORD/2026-09-28.an-editor-extension.md).

## Limits

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
- **It applies to every `.html` file**, not only to components: there is no way
  for a grammar to tell one from the other. `lang` on a `<script>` means nothing
  to a browser, so outside jq79 it is rarely there to be matched.

## Installing it

It isn't on the Marketplace yet. From this directory:

```sh
npm run package                                  # → jq79-vscode-<version>.vsix
code --install-extension jq79-vscode-0.0.1.vsix
```

## Working on it

```sh
npm install
npm test                                         # fetches VS Code's grammars once, then tokenizes
node test/tokenize.mjs text.html.derivative some-component.html   # every token and its scopes
```

The tests tokenize with VS Code's own HTML, JS, TS and CSS grammars, pinned to
one release in [`test/fetch-grammars.mjs`](test/fetch-grammars.mjs) and wired
from this `package.json`'s `injectTo`, the way VS Code wires them.
