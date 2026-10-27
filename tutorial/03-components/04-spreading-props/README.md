# Spreading props

You've been passing props one at a time — `:name="name"`, `:role="role"`. When
the parent already holds them together in an object, `:props="obj"` passes the
whole thing at once, and `...obj` is the shorthand for it:

```html
<Card :props="profile" />   <!-- name, role, status, … as props -->
<Card ...profile />          <!-- same thing -->
```

Each of the object's own properties becomes a prop, and they stay **live** —
change `profile.status` and the child updates, just like a named prop.

They mix with named props, and **source order decides** who wins, exactly like a
JavaScript object spread. A binding written *after* the spread overrides it:

```html
<Card ...profile :status="'away'" />   <!-- { ...profile, status: 'away' } -->
```

The `...` expression keeps its camelCase (`...userProfile` works), and takes an
identifier or a member path (`...user.profile`). One thing to know: a bare
`:props="x"` can appear only **once** per tag — for several spreads, use the `...`
form (`...a ...b`), which keeps them apart for you.

> **Your turn:** in **app.html**, spread `profile` into `<Card />` so the card
> shows Ada's name, role and status — without naming each prop.

**Card.html** already reads the props; you only need to touch **app.html**.
