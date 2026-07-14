# Nested components

A tag that matches a **PascalCase name in scope** renders as a child component.
The usual way to get one into scope is to import it from the setup script:

```html
<script :setup>
  const UserCard = await import("./UserCard.html")
</script>

<UserCard :user="user" :title="'Hello'" />
```

Props are passed with `:name="expr"`, evaluated in the parent's scope. `:name`
on its own is shorthand for `:name="name"`, and a plain attribute passes a
literal string. Props are **live** — when the parent expression changes, the new
value is written into the child's store.

Each usage site gets its own instance, with its own state and DOM.

> **Your turn:** import `Greeting.html` and render one per user, passing each
> `user` down as a prop. Then, in **Greeting.html**, use the prop.

Both files are yours to edit — switch between them with the tabs above the
editor.
