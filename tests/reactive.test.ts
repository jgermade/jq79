
import { describe, it, expect, vi } from "vitest"
import { $reactive, $toRaw } from "../src/jq79"

describe("$reactive", () => {
  it("keeps deep sets on the raw properties working like plain objects", () => {
    const scope = $reactive({ user: { address: { city: "NYC" } } })

    scope.user.address.city = "LA"

    expect(scope.user.address.city).toBe("LA")
  })

  describe("$on", () => {
    it("fires with (value, dotKey) on a shallow set", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a" })
      scope.$on("name", listener)

      scope.name = "b"

      expect(listener).toHaveBeenCalledWith("b", "name")
    })

    it("fires with the full dot path for a nested property present at creation", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: { address: { city: "NYC" } } })
      scope.$on("user.address.city", listener)

      scope.user.address.city = "LA"

      expect(listener).toHaveBeenCalledWith("LA", "user.address.city")
    })

    it("fires with the full dot path for a property on an object assigned after creation", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: null as any })
      scope.$on("user.address.city", listener)

      scope.user = { address: { city: "NYC" } }
      scope.user.address.city = "LA"

      expect(listener).toHaveBeenCalledWith("LA", "user.address.city")
    })

    it("supports several listeners on the same key, each unsubscribing on its own", () => {
      const first = vi.fn()
      const second = vi.fn()
      const scope = $reactive({ name: "a" })
      const off = scope.$on("name", first)
      scope.$on("name", second)

      scope.name = "b"
      expect(first).toHaveBeenCalledWith("b", "name")
      expect(second).toHaveBeenCalledWith("b", "name")

      off()
      scope.name = "c"
      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(2)
    })

    it("fires immediate with undefined when a path runs through a missing object", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: null as any })

      scope.$on("user.address.city", listener, { immediate: true })

      expect(listener).toHaveBeenCalledWith(undefined, "user.address.city")
    })

    it("fires immediate with the current value of an existing path", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: { address: { city: "NYC" } } })

      scope.$on("user.address.city", listener, { immediate: true })

      expect(listener).toHaveBeenCalledWith("NYC", "user.address.city")
    })

    it("keeps deeper paths reactive after a whole subtree is replaced", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: { address: { city: "NYC" } } })
      scope.$on("user.address.city", listener)

      scope.user.address = { city: "LA" }
      scope.user.address.city = "SF"

      expect(listener).toHaveBeenCalledWith("SF", "user.address.city")
    })

    it("does not fire for unrelated keys", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a", other: "x" })
      scope.$on("name", listener)

      scope.other = "y"

      expect(listener).not.toHaveBeenCalled()
    })

    it("calls the listener immediately with the current value when immediate: true", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: { address: { city: "NYC" } } })

      scope.$on("user.address.city", listener, { immediate: true })

      expect(listener).toHaveBeenCalledWith("NYC", "user.address.city")
    })

    it("stops firing after unsubscribing", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a" })
      const unsubscribe = scope.$on("name", listener)

      unsubscribe()
      scope.name = "b"

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("$onAny", () => {
    it("fires with (dotKey, value) for any change anywhere in the tree", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: { address: { city: "NYC" } } })
      scope.$onAny(listener)

      scope.user.address.city = "LA"

      expect(listener).toHaveBeenCalledWith("user.address.city", "LA")
    })

    it("calls the listener immediately for every current leaf value when immediate: true", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a", user: { city: "NYC" } })

      scope.$onAny(listener, { immediate: true })

      expect(listener).toHaveBeenCalledWith("name", "a")
      expect(listener).toHaveBeenCalledWith("user.city", "NYC")
      expect(listener).toHaveBeenCalledTimes(2)
    })

    it("stops firing after unsubscribing", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a" })
      const unsubscribe = scope.$onAny(listener)

      unsubscribe()
      scope.name = "b"

      expect(listener).not.toHaveBeenCalled()
    })
  })

  // `delete` used to fall through untrapped: the key vanished from the raw
  // object and nobody heard about it - effects kept rendering the dead value,
  // and a deleted nested store stayed bridged
  describe("deleting keys", () => {
    it("notifies listeners with undefined when a key is deleted", () => {
      const listener = vi.fn()
      const scope = $reactive({ user: { name: "Ada" } } as { user?: { name: string } })
      scope.$on("user", listener)

      delete scope.user

      expect(listener).toHaveBeenCalledWith(undefined, "user")
    })

    it("notifies the full dot path for a nested delete, waking effects that read it", () => {
      const scope = $reactive({ user: { name: "Ada" } as { name?: string } })
      const seen: any[] = []
      scope.$effect(() => { seen.push(scope.user.name) })

      delete scope.user.name

      expect(seen).toEqual(["Ada", undefined])
    })

    it("hears array methods that shrink through [[Delete]], like pop", () => {
      const listener = vi.fn()
      const scope = $reactive({ items: [1, 2, 3] })
      scope.$onAny(listener)

      scope.items.pop()

      expect(listener).toHaveBeenCalledWith("items.2", undefined)
      expect(listener).toHaveBeenCalledWith("items.length", 2)
    })

    it("stops listening to a nested store when its key is deleted", () => {
      const inner = $reactive({ n: 1 })
      const holder = $reactive({ inner } as { inner?: typeof inner })
      const listener = vi.fn()
      holder.$onAny(listener)

      delete holder.inner
      listener.mockClear()
      inner.n = 2

      expect(listener).not.toHaveBeenCalled()
    })

    it("notifies nobody for a key that was never there", () => {
      const listener = vi.fn()
      const scope = $reactive({ name: "a" } as { name: string; ghost?: number })
      scope.$onAny(listener)

      delete scope.ghost

      expect(listener).not.toHaveBeenCalled()
    })
  })

  it("does not expose $on/$onAny as enumerable data properties", () => {
    const scope = $reactive({ name: "a" })

    expect(Object.keys(scope)).toEqual(["name"])
  })

  // a primitive write that changes nothing notifies nobody (Object.is), so
  // an effect that writes the value it just read - a normalizing assignment,
  // a prop sync - settles instead of waking itself forever
  it("does not notify a primitive write that changes nothing", () => {
    const scope = $reactive({ n: 1 })
    const listener = vi.fn()
    scope.$onAny(listener)

    scope.n = 1

    expect(listener).not.toHaveBeenCalled()

    scope.fresh = undefined // a new key announces itself, value regardless
    expect(listener).toHaveBeenCalledWith("fresh", undefined)
  })

  it("keeps a same-reference object write loud: it is the deep-touch channel", () => {
    // a parent's prop sync forwards a deep mutation to a child store by
    // re-assigning the same object - the child's listeners live on the
    // child's store and would never hear the parent's notify otherwise
    const scope = $reactive({ list: [1] })
    const listener = vi.fn()
    scope.$onAny(listener)

    scope.list = scope.list

    expect(listener).toHaveBeenCalledWith("list", expect.anything())
  })

  // A store used to rewrite the object it was handed, replacing every nested
  // object with a proxy in place. Two stores over one object then wrapped each
  // other's proxies, and since wrapping walked what it wrapped, the nesting
  // compounded until the process stopped responding - which is what mounting
  // two components with the same data, or re-mounting one, does.
  describe("data shared with another store", () => {
    it("leaves the object it was handed untouched", () => {
      const data = { user: { address: { city: "NYC" } } }
      const user = data.user
      const address = data.user.address

      $reactive(data)

      expect(data.user).toBe(user)
      expect(data.user.address).toBe(address)
      expect(Object.keys(data)).toEqual(["user"])
    })

    it("gives each store its own view of the same object, without nesting them", () => {
      const shared = { user: { name: "Ada" } }

      const first = $reactive({ shared })
      const second = $reactive({ shared })

      // one raw object, two independent reactive views of it
      expect(first.shared).not.toBe(second.shared)
      expect(first.shared.user.name).toBe("Ada")
      expect(second.shared.user.name).toBe("Ada")

      // ...and each store still notifies its own listeners
      const heard: string[] = []
      first.$on("shared.user.name", value => heard.push(`first:${value}`))
      second.$on("shared.user.name", value => heard.push(`second:${value}`))

      first.shared.user.name = "Grace"
      second.shared.user.name = "Katherine"

      expect(heard).toEqual(["first:Grace", "second:Katherine"])
    })

    it("stays flat however many stores wrap the same data", () => {
      const shared = { rows: [{ cells: [{ deep: { deeper: 1 } }] }] }

      // this is the one that used to hang: each pass re-wrapped the last one's
      // proxies, doubling the layers, and blew up with the nesting depth
      const stores = Array.from({ length: 12 }, () => $reactive({ shared }))

      stores.forEach(store => {
        expect(store.shared.rows[0].cells[0].deep.deeper).toBe(1)
      })
    })

    it("hands back the same proxy for the same object, so :each can diff by reference", () => {
      const store = $reactive({ list: [{ id: 1 }, { id: 2 }] })
      const first = store.list[0]

      // identity is keyed to the object, not to where it sits, so a reorder
      // keeps each item's DOM instead of rebuilding the whole list
      store.list = [store.list[1], store.list[0]]

      expect(store.list[1]).toBe(first)
      expect(store.list[0].id).toBe(2)
    })

    it("keeps a store put inside another store whole", () => {
      const inner = $reactive({ n: 1 })
      const outer = $reactive({ inner })

      // `inner` is a store, not plain data: it owns its listeners, so the outer
      // store must not unwrap and re-wrap it
      expect(outer.inner).toBe(inner)

      const heard: number[] = []
      outer.inner.$on("n", value => heard.push(value))
      outer.inner.n = 7

      expect(heard).toEqual([7])
    })

    // A nested store keeps its own listeners - and the holder's effects are not
    // among them, so a write through it used to notify nobody upstairs: a
    // component rendering `{{ cart.items.length }}` off a `$reactive` it was
    // handed never updated, which left shared state with no way back up but
    // $emit. The holder subscribes to it and re-notifies under the path it sits
    // at (see bridge)
    it("wakes the holder's effects when the store inside it changes", () => {
      const cart = $reactive({ items: ["apple"] })
      const store = $reactive({ cart })

      const seen: number[] = []
      store.$effect(() => { seen.push(store.cart.items.length) })

      store.cart.items = ["apple", "pear"]
      cart.items = ["pear"]            // ...and through the inner store's own handle

      expect(seen).toEqual([1, 2, 1])
    })

    it("wakes them on a mutation of an array inside the nested store", () => {
      const cart = $reactive({ items: [] as string[] })
      const store = $reactive({ cart })

      const seen: number[] = []
      store.$effect(() => { seen.push(store.cart.items.length) })

      cart.items.push("apple")

      // a push writes the index and then the length, so an effect that read the
      // array wakes twice - it does the same for an array in the store's own
      // data, and what matters is where it lands
      expect(seen.at(-1)).toBe(1)
    })

    it("re-notifies the inner store's changes under the path it sits at", () => {
      const inner = $reactive({ user: { name: "Ada" } })
      const outer = $reactive({ session: inner })

      const heard: string[] = []
      outer.$onAny((dotKey, value) => heard.push(`${dotKey}=${value}`))
      const exact: string[] = []
      outer.$on("session.user.name", value => exact.push(value))

      inner.user.name = "Grace"

      expect(heard).toEqual(["session.user.name=Grace"])
      expect(exact).toEqual(["Grace"])
    })

    it("carries a change up through a chain of stores", () => {
      const leaf = $reactive({ n: 1 })
      const middle = $reactive({ leaf })
      const root = $reactive({ middle })

      const seen: number[] = []
      root.$effect(() => { seen.push(root.middle.leaf.n) })

      leaf.n = 2

      expect(seen).toEqual([1, 2])
    })

    it("gives every holder of one store its own view, and wakes them all", () => {
      const cart = $reactive({ items: [] as string[] })
      const first = $reactive({ cart })
      const second = $reactive({ cart })

      const seen: string[] = []
      first.$effect(() => { seen.push(`first:${first.cart.items.length}`) })
      second.$effect(() => { seen.push(`second:${second.cart.items.length}`) })

      // this is the shared-state case: two components' stores over one $reactive
      second.cart.items = ["apple"]

      expect(seen).toEqual(["first:0", "second:0", "first:1", "second:1"])
    })

    it("stops listening to a store it no longer holds", () => {
      const first = $reactive({ n: 1 })
      const second = $reactive({ n: 10 })
      const store = $reactive<{ current: any }>({ current: first })

      const seen: number[] = []
      store.$effect(() => { seen.push(store.current.n) })

      store.current = second
      first.n = 2        // the store it dropped: nobody here cares anymore
      second.n = 20

      expect(seen).toEqual([1, 10, 20])
    })

    it("drops its subscriptions on $dispose, so a shared store doesn't collect dead holders", () => {
      const cart = $reactive({ items: [] as string[] })
      const store = $reactive({ cart })

      const seen: number[] = []
      store.$effect(() => { seen.push(store.cart.items.length) })

      store.$dispose()
      cart.items.push("apple")

      expect(seen).toEqual([0])
    })

    it("passes class instances through untouched", () => {
      class Session {
        constructor(public id: number) {}
        describe() { return `session ${this.id}` }
      }
      const session = new Session(3)
      const when = new Date(0)

      const store = $reactive({ session, when })

      expect(store.session).toBe(session)
      expect(store.session.describe()).toBe("session 3")
      expect(store.when).toBe(when)
    })
  })

  describe("$toRaw", () => {
    it("hands back the object it was given, at the root and at any depth", () => {
      const data = { user: { name: "Jesús" }, items: [{ id: 1 }] }
      const store = $reactive(data)

      expect($toRaw(store)).toBe(data)
      expect($toRaw(store.user)).toBe(data.user)
      expect($toRaw(store.items)).toBe(data.items)
      expect($toRaw(store.items[0])).toBe(data.items[0])
    })

    it("leaves anything that isn't a proxy as it is", () => {
      const plain = { a: 1 }

      expect($toRaw(plain)).toBe(plain)
      expect($toRaw(42)).toBe(42)
      expect($toRaw(null)).toBeNull()
      expect($toRaw(undefined)).toBeUndefined()
    })

    it("unwraps a proxy of a proxy down to the object underneath", () => {
      const data = { user: { name: "Jesús" } }
      const outer = $reactive($reactive(data))

      expect($toRaw(outer.user)).toBe(data.user)
    })

    it("returns the live object, so writes through it notify nobody", () => {
      const store = $reactive({ count: 0 })
      const listener = vi.fn()
      store.$on("count", listener)

      $toRaw(store).count = 5

      expect(store.count).toBe(5) // the store reads it, having no copy of its own
      expect(listener).not.toHaveBeenCalled()
    })
  })
})

// the effect runner's last line of defense (see AGENTS.md: an effect that
// reads and writes the same key wakes itself only from its second pass), and
// the documented limits of dot-path tracking
describe("$effect hardening", () => {
  it("cuts off an effect that keeps re-waking itself, with a console.error, instead of hanging", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const store = $reactive({ obj: { n: 0 } as any })

    // reads obj and writes a fresh object to it: a self-waking loop. The
    // first pass settles (deps commit only after the run), so it must be
    // kicked awake from outside - which is exactly how it bites in the wild
    let runs = 0
    store.$effect(() => {
      runs++
      store.obj = { n: store.obj.n + 1 }
    })

    expect(runs).toBe(1)
    expect(spy).not.toHaveBeenCalled()

    store.obj = { n: 50 }

    // the kick plus 100 in-run repeats, then it gives up out loud - and the
    // assignment that triggered it all still returns
    expect(runs).toBe(101)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0][0])).toContain("re-woke itself 100 times")
    spy.mockRestore()
  })

  it("truncating an array via length wakes effects reading its items", () => {
    const store = $reactive({ list: [1, 2, 3] })

    let first: any
    let runs = 0
    store.$effect(() => {
      runs++
      first = store.list[0]
    })

    store.list.length = 0

    // the index reads tracked "list" on the way in, and "list.length"
    // overlaps it - so the effect re-runs even though the dead slots are
    // deleted on the raw target, below the proxy's deleteProperty trap
    expect(runs).toBe(2)
    expect(first).toBeUndefined()
    expect(store.list).toEqual([])
  })

  it("a key that contains a dot collides with the real nested path (known limit)", () => {
    const store = $reactive({ a: { b: 1 } })

    let runs = 0
    store.$effect(() => {
      runs++
      void store.a.b
    })

    // the flat key "a.b" notifies under the same dotKey as the nested a.b,
    // so the effect wakes spuriously - dot-paths cannot tell them apart.
    // Pinned as a documented limitation, not endorsed behavior
    ;(store as any)["a.b"] = 99

    expect(runs).toBe(2)
    expect(store.a.b).toBe(1)
  })
})

describe("what a write wakes", () => {
  it("leaves an effect alone when a sibling it never read changes", () => {
    const store = $reactive({ rows: [{ label: "a" }, { label: "b" }] })

    let runs = 0
    store.$effect(() => {
      runs++
      void store.rows[0].label
    })

    store.rows[1].label = "changed"

    // the whole point: a 1,000-row list costs one re-render per changed row,
    // not one per row per change
    expect(runs).toBe(1)
  })

  it("wakes it when the row it did read changes", () => {
    const store = $reactive({ rows: [{ label: "a" }, { label: "b" }] })

    let runs = 0
    store.$effect(() => {
      runs++
      void store.rows[0].label
    })

    store.rows[0].label = "changed"

    expect(runs).toBe(2)
  })

  it("wakes it when an ancestor of what it read is replaced wholesale", () => {
    const store = $reactive({ rows: [{ label: "a" }] })

    const seen: any[] = []
    store.$effect(() => { seen.push(store.rows[0]?.label) })

    store.rows = [{ label: "fresh" }]

    // downwards always: replacing the array replaced the row inside it
    expect(seen).toEqual(["a", "fresh"])
  })

  it("does not wake an effect that read an object but nothing inside it", () => {
    const store = $reactive({ user: { name: "Ada" } })

    let runs = 0
    store.$effect(() => {
      runs++
      void store.user
    })

    store.user.name = "Grace"

    // nothing this effect read changed - `user` is the same object. The cost of
    // waking for what was read rather than for what it was read through;
    // documented in docs/reactive-data.md
    expect(runs).toBe(1)
  })

  it("wakes an effect that enumerated the keys when one is added or removed", () => {
    const store = $reactive({ props: { a: 1 } as Record<string, number> })

    const seen: string[][] = []
    store.$effect(() => { seen.push(Object.keys(store.props)) })

    store.props.b = 2
    delete store.props.a

    // the effect read the key set, never a value under it - so neither change
    // touches a path it tracked, and only the ownKeys dep can carry them
    expect(seen).toEqual([["a"], ["a", "b"], ["b"]])
  })

  // the case the count comparison missed: notifyReplaced woke the key-set dep
  // only when the NUMBER of keys changed, so swapping one name for another left
  // Object.keys stale - shipped since notifyReplaced arrived, before 0.6.0
  // (TODOS/2026-08-25.two-defects-a-review-found.md)
  it("wakes it when a replacement changes which keys there are, not how many", () => {
    const store = $reactive({ props: { a: 1, b: 2, c: 3, d: 4 } as Record<string, number> })

    const seen: string[][] = []
    store.$effect(() => { seen.push(Object.keys(store.props)) })

    // same count, one name different
    store.props = { a: 1, b: 2, c: 3, e: 9 }
    expect(seen.at(-1)).toEqual(["a", "b", "c", "e"])

    // and the control the count comparison did catch, which must keep working
    store.props = { a: 1, b: 2 }
    expect(seen.at(-1)).toEqual(["a", "b"])

    // Object.keys answers in insertion order, so a rebuild that sorts the same
    // names is a different answer - and neither the count nor a membership test
    // sees it
    store.props = { b: 2, a: 1 }
    expect(seen.at(-1), "the same names in a new order is a new answer").toEqual(["b", "a"])

    // and the other direction: a replacement that changes a value and no names
    // must NOT wake it, because the effect read the key set and nothing else.
    // One key of four differs, so whatChanged does not give up and sweep -
    // which is what a wholesale replacement gets, and why this is a small edit
    store.props = { a: 1, b: 2, c: 3, e: 9 }
    const before = seen.length
    store.props = { a: 1, b: 2, c: 3, e: 10 }
    expect(seen.length, "the key set did not change and nothing read a value").toBe(before)
  })

  it("wakes a spread of the store's own keys the same way", () => {
    const store = $reactive({ a: 1 } as Record<string, number>)

    const seen: Record<string, number>[] = []
    store.$effect(() => { seen.push({ ...store }) })

    store.b = 2

    expect(seen.at(-1)).toEqual({ a: 1, b: 2 })
  })

  it("a key named like the reserved key-set segment collides with it (known limit)", () => {
    const store = $reactive({ props: {} as Record<string, unknown> })

    let runs = 0
    store.$effect(() => {
      runs++
      void (store.props as any)[" keys"]
    })

    // " keys" is where the ownKeys dep for `props` lives, so an effect reading a
    // real property of that name wakes on any key *removed* from the object
    // (an added one re-runs everything anyway). Same class as the
    // flat-key-with-a-dot collision above: pinned, not endorsed
    store.props.other = 1
    delete store.props.other

    expect(runs).toBe(3)
  })
})

describe("a splice announced as the shift it is", () => {
  // TODOS/2026-08-23.notify-a-splice.md. `data = data.filter(...)` used to look
  // like a wholesale replacement to the container diff - every index after the
  // cut holds a different object - and cost a sweep of the whole subtree
  const rows = (length: number) => Array.from({ length }, (_, id) => ({ id, label: `l${id}` }))

  it("wakes a reader of a shifted slot without waking the rows themselves", () => {
    const store = $reactive({ data: rows(10) })

    // reads the array, so it holds the slot: its answer is "whoever sits at 6"
    const bySlot: any[] = []
    store.$effect(() => { bySlot.push(store.data[6]?.label) })

    // holds the row itself, the way a `:each` item binding does - it never
    // reads the array and has no stake in where its row now sits
    const row = (store.data as any[])[6]
    let rowRuns = 0
    store.$effect(() => { rowRuns++; void row.label })

    store.data = ($toRaw(store.data) as any[]).filter(item => item.id !== 1)

    expect(bySlot).toEqual(["l6", "l7"])
    expect(rowRuns).toBe(1)
  })

  it("wakes the same slots when an element is inserted", () => {
    const store = $reactive({ data: rows(10) })

    const bySlot: any[] = []
    store.$effect(() => { bySlot.push(store.data[6]?.label) })
    const row = (store.data as any[])[6]
    let rowRuns = 0
    store.$effect(() => { rowRuns++; void row.label })

    store.data = [{ id: -1, label: "new" }, ...($toRaw(store.data) as any[])]

    expect(bySlot).toEqual(["l6", "l5"])
    expect(rowRuns).toBe(1)
  })

  it("wakes a slot reader that also read the length, through the length", () => {
    // the clause that lets `indexable` prune a slot: an effect holding
    // `data.length` hears every splice there is, because a splice always
    // changes the length and notifyReplaced announces it exactly. This is what
    // keeps the `:each` list effect - which reads the length and every slot -
    // from indexing a second dep per row. If the splice path ever stops
    // announcing the length, this test is the one that goes red
    const store = $reactive({ data: rows(10) })

    const seen: string[] = []
    store.$effect(() => { seen.push(`${store.data.length}:${store.data[6]?.label}`) })

    store.data = ($toRaw(store.data) as any[]).filter(item => item.id !== 1)

    expect(seen).toEqual(["10:l6", "9:l7"])
  })

  it("wakes an effect reading the length, and one reading the container", () => {
    const store = $reactive({ data: rows(10) })

    const lengths: number[] = []
    store.$effect(() => { lengths.push(store.data.length) })
    const containers: number[] = []
    store.$effect(() => { containers.push(($toRaw(store.data) as any[]).length) })

    store.data = ($toRaw(store.data) as any[]).filter(item => item.id !== 1)

    expect(lengths).toEqual([10, 9])
    expect(containers).toEqual([10, 9])
  })

  it("hands a slot listener the row that moved into it", () => {
    const store = $reactive({ data: rows(10) })

    const seen: any[] = []
    store.$on("data.6", value => seen.push(value?.label))

    store.data = ($toRaw(store.data) as any[]).filter(item => item.id !== 1)

    expect(seen).toEqual(["l7"])
  })

  it("leaves an untouched slot before the cut alone", () => {
    const store = $reactive({ data: rows(10) })

    let runs = 0
    store.$effect(() => { runs++; void store.data[0]?.label })

    store.data = ($toRaw(store.data) as any[]).filter(item => item.id !== 5)

    // nothing before the cut moved, so slot 0 is not among the shifted ones
    expect(runs).toBe(1)
  })

  it("still gives up when two elements go at once", () => {
    const store = $reactive({ data: rows(10) })

    const row = (store.data as any[])[6]
    let rowRuns = 0
    store.$effect(() => { rowRuns++; void row.label })

    store.data = ($toRaw(store.data) as any[]).filter(item => item.id !== 1 && item.id !== 2)

    // not a shift by one - the walk finds most of the container different and
    // the sweep comes back, which is the correct answer for a rewrite
    expect(rowRuns).toBe(2)
  })

  it("still gives up when an element is replaced as well as removed", () => {
    const store = $reactive({ data: rows(4) })

    const row = (store.data as any[])[3]
    let rowRuns = 0
    store.$effect(() => { rowRuns++; void row.label })

    const next = ($toRaw(store.data) as any[]).filter(item => item.id !== 0)
    next[0] = { id: 9, label: "fresh" }
    store.data = next

    expect(rowRuns).toBe(2)
  })
})
