# Forms and narrowed scope

A `@event` value is evaluated on every event, with `$event` in scope. Handling a
form means stopping the browser from doing its default thing with it — which is
what the **modifiers** are for:

```html
<form @submit.prevent="save">…</form>
```

| modifier   | effect                                              |
| ---------- | --------------------------------------------------- |
| `.prevent` | `event.preventDefault()`                            |
| `.stop`    | `event.stopPropagation()`                           |
| `.self`    | only fires when `event.target` is the element itself |
| `.once`    | the listener runs at most once                      |
| `.capture` | listens in the capture phase                        |

They chain: `@click.stop.once`.

The other half of a form is the repetition. Every field of this one says `draft`
twice, which `:with` takes care of: it evaluates to an object whose properties
become directly addressable inside the element and its subtree.

```html
<fieldset :with="draft">
  <input @input="name = $event.target.value" />
  <p>{{ name }}</p>
</fieldset>
```

Names the object doesn't own still resolve from the outer scope, and assignments
to the ones it does **write through to it** — `name = "…"` inside `:with="draft"`
sets `draft.name`, reactively. Nothing is rebuilt: the subtree stays put and only
what read the property updates.

> **Your turn:** stop the form from reloading the page when it's submitted, and
> put the fields inside a `:with="draft"` so they can address `name` and `email`
> directly.
