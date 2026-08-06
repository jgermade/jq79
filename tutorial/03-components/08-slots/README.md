# Slots — passing markup, not just data

Props parameterise a component by data. A **slot** parameterises it by markup: whatever
you write inside a component's tag renders inside the component, where it put a `<slot>`.

```html
<!-- Card.html -->
<section>
  <header><slot.header>Untitled</slot.header></header>
  <slot />
</section>
```

```html
<Card>
  <template :slot.header><h2>{{ title }}</h2></template>

  <p>{{ body }}</p>
</Card>
```

The children go to the default `<slot />`; a `<template :slot.header>` fills the named one.
A `<slot>` with nothing to put in it renders its own children instead, which is how
`Untitled` gets there.

## The content is yours, not the component's

`{{ title }}` above is *your* `title`, read from the file the markup was written in. The
component chooses where the content goes and whether it goes — never what the names in it
mean. Its styles don't reach it either; yours do.

## Scoped slots

A `<slot>`'s attributes are props flowing the other way — from the component out to your
markup. **List.html** hands each row to whoever fills its slot:

```html
<li :each="row in rows" :key="row.id">
  <slot :item="row" :index="$index">{{ row.label }}</slot>
</li>
```

You pick them up by naming them, with `:slot` on the tag:

```html
<List :rows="orders" :slot="{ item, index }">
  {{ index }} — {{ item.label }}
</List>
```

Naming them is the point: every bare name in your file is one *you* introduced, so a
`<slot :item>` the component adds tomorrow can't quietly capture a name you were already
using. (`:slot` also takes renames and defaults, like a prop signature does:
`:slot="{ item: row, tone = 'plain' }"`.)

`$slots` tells a component which names were filled, so it can drop a wrapper nobody used:
`<footer :if="$slots.footer">`.

> **Your turn:** in **app.html**, fill the list's slot so each row reads
> `1. Keyboard — €49.00` — the number from `index`, the label from `item`, and the price
> from `currency()`, which is **yours**, not the list's.

**List.html** already passes `item` and `index`; you only need to touch **app.html**.
Press *Empty the list* afterwards to see `<slot.empty>` take over.
