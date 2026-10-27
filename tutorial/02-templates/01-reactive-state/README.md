# Reactive state

Top-level `let` declarations in a setup script become **reactive**: assign to
one and every part of the DOM that reads it updates — nothing else.

You wire up events with `@event`. The attribute value is evaluated on every
event, so all of these work:

```html
<button @click="onClick">a handler reference</button>
<button @click="count = count + 1">an inline statement</button>
<form @submit.prevent="$event => save($event)">an inline arrow</form>
```

`$:` marks a **reactive declaration** — it re-runs whenever anything it reads
changes, so `doubled` always trails `count`.

> **Your turn:** make the button count clicks, and add a `$:` declaration for
> `doubled` so the paragraph stays in sync.

Modifiers like `.prevent`, `.stop` and `.once` chain onto the event name
(`@click.stop.once`).
