# Loading data

The template doesn't wait for your script. A setup script that `await`s at the
top level renders as soon as it hits the `await` — with everything below it not
run yet, and every variable it declares still `undefined`. That's deliberate:
declarations made after an `await` are put on the store *before* the first
render, so the template can bind to them from the start and update when the
assignment finally runs.

What it means for a request is that awaiting buys you nothing. The component
doesn't hold back — it renders an empty list, which looks exactly like a user
who has no users, and then silently fills in.

A loading state is something you have to say out loud. Don't await: assignments
from a `.then()` callback go through the reactive proxy like any other, so the
component can render what it knows now and correct itself when the data lands.

```html
<script :setup>
  let users = []
  let loading = true

  fetchUsers().then(list => {
    users = list
    loading = false
  })
</script>

<p :if="loading">loading…</p>
<ul :else>
  <li :each="user in users" :key="user.id">{{ user.name }}</li>
</ul>
```

A failure is the same shape: `.catch()` assigns to an `error` variable and the
template grows a third branch. Nothing here is special — it's the ordinary
reactivity, driven from a callback.

> **Your turn:** this component renders an empty list for as long as its request
> is in flight. Make it say "loading…" instead, and show the list once the users
> arrive.
