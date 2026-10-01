# jq79-check

Type-check [jq79](https://github.com/jgermade/jq79) components from a terminal
or CI: their scripts, their templates and the props they pass each other, read
the way the runtime compiles them.

```sh
npx jq79-check
```

```
src/TodoList.html:12:9 - error TS2552: Cannot find name 'todoz'. Did you mean 'todos'?
src/App.html:4:7 - error TS2322: Type 'number' is not assignable to type 'string'.
14 file(s) checked: 2 error(s), 0 warning(s)
```

It is the checker of the [jq79 extension for VS Code](https://github.com/jgermade/jq79/tree/main/editors/vscode#readme),
without the editor: the same reading of a component, the same errors.

## What it checks

```html
<script :setup="{ step = 1 }: Props" lang="ts">
  interface Props { step?: number }
  let count = 0
  $: doubled = count * step               // doubled: number
</script>

<p>{{ doubled.toUpperCase() }}</p>        <!-- ✗ 'toUpperCase' does not exist on type 'number' -->
<li :each="todo in todos">{{ todo }}</li> <!-- ✗ Cannot find name 'todos' -->
<Card :titel="'x'" />                     <!-- ✗ 'titel' does not exist… Did you mean 'title'? -->
```

- **Scripts**: a setup script as the runtime runs it - its `:setup` pattern
  typing the props, `$:` declaring what it assigns, the component's other
  scripts sharing its names, `$mounted`, `$emit` and the rest in scope.
  A `lang="ts"` script is type-checked; a JavaScript one with `--checkJs`.
- **Templates**, always, JavaScript components included: every `{{ }}`,
  `:attr`, `@event`, `:each`, `:with` against the component's store.
- **Props**, against the signature of the component they are passed to.
- **Components written as literals**, `` new Component79(`…`) ``, in scripts
  and pages.

The details, and what isn't checked, are in the
[extension's README](https://github.com/jgermade/jq79/tree/main/editors/vscode#what-it-checks).

## Usage

```
jq79-check [paths…] [options]

  paths                  directories or files to check (default: the current directory).
                         A directory means every .html in it and every script with a
                         component literal (new Component79(`…`)), node_modules aside
  -p, --project <file>   check what a tsconfig.json/jsconfig.json includes, with its
                         compiler options; its "include" has to take the .html files
      --checkJs          without --project: type-check JavaScript scripts too, not only
                         templates (a template is always checked)
      --format <format>  text (default), or github: annotations a GitHub Actions run
                         shows on the pull request
  -h, --help             this
  -v, --version          the version
```

It exits 1 when there is an error, and 2 when the command line is wrong.

**With a `tsconfig.json`**, its compiler options apply (`strict`, `paths`, …)
once its `include` takes the components:

```json
{
  "compilerOptions": { "strict": true, "allowJs": true, "noEmit": true },
  "include": ["src/**/*.ts", "src/**/*.html"]
}
```

```sh
npx jq79-check --project tsconfig.json
```

**In GitHub Actions**, `--format github` puts each error on the line of the
pull request it is about:

```yaml
- run: npx jq79-check src --format github
```

## Types

The helpers (`$`, `$reactive`, `Component79`, …) are typed from the `jq79`
package when the project has it installed; without it they are `any`, and
everything else is still checked.

jq79-check runs its own TypeScript (5.9), whatever version the project uses:
it needs TypeScript's JavaScript API, which TypeScript 7 doesn't have.
