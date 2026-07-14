# Component events

Props flow down; events flow up. A child announces something with `$emit`, which
dispatches a real bubbling `CustomEvent` from the child's position in the DOM:

```html
<!-- child -->
<script :setup>
  const save = () => $emit("saved", { id: 42 })
</script>
```

The parent hears it with `@event-name` on any element wrapping the child — the
payload arrives as `$event.detail`:

```html
<!-- parent -->
<div @saved="lastSaved = $event.detail.id">
  <ChildForm />
</div>
```

Because it's a native event, nothing special connects the two: it just bubbles.
From plain JS you can also subscribe on the instance with
`component.on("saved", (event, payload) => …)`.

> **Your turn:** have `Stepper.html` emit a `changed` event carrying its new
> value, and have the parent show it in `last`.

Note that each `<Stepper />` keeps its own `value` — two usage sites, two
instances, two independent stores — but a single listener on the wrapping
element hears both, because the event bubbles.
