# Keys and identity

[Lists and conditions](#01-basics/03-lists-and-conditions) said the list is
diffed by key. This lesson is about what that buys you, because the difference
doesn't show until the list *moves*.

Without `:key`, items pair up with rows by **position**: row 0 belongs to
whatever is first. When the array reorders, most positions now hold a different
item, and each of those rows is torn down and rebuilt — taking with it
everything the DOM was quietly holding for you: what you typed, focus, scroll
position, a playing video.

The notes boxes below aren't bound to anything — they're scratch space, DOM
state and nothing else, which is what makes them honest witnesses.

> **Your turn:** type something into a player's notes, hit "reverse", and watch
> it vanish. Then give the rows an identity — `:key="player.id"` — and try
> again: the whole row travels with its player, notes included.

Position is still a fine key for a list that only grows and shrinks at the end,
which is why `:key` is optional. It stops being fine the moment the list can
reorder, filter or insert — anywhere an item's position stops being *who it is*.
