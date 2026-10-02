# Changelog

The release workflow (*Release VS Code extension*) turns `## Unreleased` into
the version it publishes.

## Unreleased

The first release on the Visual Studio Marketplace and Open VSX.

- **Colors** `<script lang="ts">`, `<style lang="scss|less|sass|styl">`, the
  HTML in `` Component79(`…`) `` and tagged literals (`` html`…` ``,
  `` css`…` ``, `` ts`…` ``…), and the template syntax (`{{ }}`, `:attr`,
  `@event`, `:each`, `:setup`, `:slot`) as JavaScript or TypeScript.
- **Checks** a component's scripts as the runtime compiles them, and its
  template's expressions against the store those scripts build: in `.html`
  files and in the `` new Component79(`…`) `` literals of scripts and pages.
- **Completes and hovers** in tags: directives (`:each`, `@click.prevent`…),
  the props, events and slots a component declares, and the components in
  scope; and the store's names in every expression.
