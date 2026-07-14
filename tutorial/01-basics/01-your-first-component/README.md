# Your first component

A jq79 component is a single `.html` file: markup, an optional `<script>` and an
optional `<style>`, in any order. There's no build step — the file *is* the
component.

Anything between `{{ }}` is a JavaScript expression, evaluated against the
component's scope and kept up to date automatically.

```html
<span>{{ user.name }}</span>
<span>{{ price * quantity }} €</span>
```

The setup script's top-level declarations become that scope, so `name` below is
visible to the template.

> **Your turn:** the heading is hardcoded. Make it greet `name` instead, so it
> reads "Hello jq79!".
