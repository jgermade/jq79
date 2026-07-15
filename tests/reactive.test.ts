
import { describe, it, expect, vi } from "vitest"
import { $reactive } from "../src/jq79"

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
})
