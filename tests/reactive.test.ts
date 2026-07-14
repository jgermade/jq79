
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

  it("does not expose $on/$onAny as enumerable data properties", () => {
    const scope = $reactive({ name: "a" })

    expect(Object.keys(scope)).toEqual(["name"])
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
