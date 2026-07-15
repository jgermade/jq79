// the reactive store ($reactive): proxy-based deep reactivity with
// dot-path dependency tracking, plus the effect-scope helper the renderer
// uses to tear down a subtree's bindings in one call

type ChangeListener = (value: any, dotKey: string) => void
type AnyChangeListener = (dotKey: string, value: any) => void
type ListenerOptions = { immediate?: boolean }
type Unsubscribe = () => void

export type ReactiveDeepData<T> = T & {
  $on: (dotKey: string, listener: ChangeListener, options?: ListenerOptions) => Unsubscribe
  $onAny: (listener: AnyChangeListener, options?: ListenerOptions) => Unsubscribe
  // runs `run` immediately, recording every dotKey it reads off this store, then
  // re-runs it whenever a changed dotKey overlaps one of those - see pathsOverlap
  $effect: (run: () => void) => Unsubscribe
  // drops this store's subscriptions to the stores nested inside it (see
  // bridge). A store that outlives the one holding it - the shared-state case -
  // would otherwise keep the dead holder's listeners on its own list forever
  $dispose: () => void
}

const getByPath = (obj: Record<string, any>, dotKey: string): any =>
  dotKey.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)

// only plain objects and arrays get deep-wrapped by the reactive store;
// class instances (Component79, Date, DOM nodes, ...) pass through untouched
// so their identity, prototypes and internals stay intact
const isPlainData = (value: object): boolean => {
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const walkLeaves = (obj: Record<string, any>, path: string, visit: (dotKey: string, value: any) => void) => {
  Object.entries(obj).forEach(([key, value]) => {
    const dotKey = path ? `${path}.${key}` : key
    if (value && typeof value === "object" && isPlainData(value)) walkLeaves(value, dotKey, visit)
    else visit(dotKey, value)
  })
}

// true when `a` and `b` sit on the same ancestor/descendant line, e.g.
// "user" & "user.address.city" (a change to either affects the other) - false
// for siblings like "user.name" & "user.age"
const pathsOverlap = (a: string, b: string): boolean =>
  a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`)

// reads the raw object behind a store proxy. Module-level (not per-store) so a
// value that is already reactive - in this store or in another one - can be
// unwrapped before being wrapped again. Without it, handing the same object to
// two stores has each one wrapping the other's proxies, and since a wrap walks
// what it wraps, the nesting compounds until the process stops responding
const RAW = Symbol("jq79.raw")

const toRaw = <T>(value: T): T => {
  let raw: any = value
  while (raw !== null && typeof raw === "object" && raw[RAW]) raw = raw[RAW]
  return raw
}

// marks a store's *root* proxy. A store put inside another store (a setup
// script's `const local = $reactive(...)`) has to pass through whole: it owns
// its listeners and its $on/$effect, so unwrapping it would strip away the very
// thing it is. Nested proxies carry no such marker and are unwrapped freely
const STORE = Symbol("jq79.store")

const isStore = (value: any): boolean =>
  value !== null && typeof value === "object" && value[STORE] === true

// active $effect() runs, innermost last - a module-level stack (rather than
// one per store) so nested effects across stores still nest correctly; reads
// during a proxy's `get` trap are attributed to whichever run is on top
const trackerStack: Set<string>[] = []

// runs fn with dependency tracking suspended - reads inside it are attributed
// to a throwaway set instead of the currently running effect
export const untracked = <T>(fn: () => T): T => {
  trackerStack.push(new Set())
  try {
    return fn()
  } finally {
    trackerStack.pop()
  }
}

type Effect = { deps: Set<string>; run: () => void }

export const $reactive = <T extends Record<string, any>>(data: T): ReactiveDeepData<T> => {
  const exactListeners = new Map<string, Set<ChangeListener>>()
  const anyListeners = new Set<AnyChangeListener>()
  const effects = new Set<Effect>()

  // one proxy per raw object, for this store alone. Keyed by the *raw object*
  // rather than by its path, so identity travels with the object: :each diffs
  // its items by reference (Object.is), and a reordered list has to hand back
  // the same proxy for the same item or every row would re-render. The flip
  // side is that an object's path is fixed when it is first wrapped, so after a
  // reorder its notifications carry the old index - effects that read the list
  // itself still wake up (pathsOverlap), which is what makes it a non-issue in
  // practice
  const proxies = new WeakMap<object, Record<string, any>>()

  // $on/$onAny/$effect are served from the root proxy's `get` instead of being
  // defined on the object: a store must leave nothing behind on the data it was
  // handed, and two stores over one object would otherwise clobber each other's
  // handles. Null-prototype, so `key in storeApi` can't match Object.prototype
  const storeApi: Record<string, any> = Object.create(null)

  const notify = (dotKey: string, value: any, isNewKey = false) => {
    exactListeners.get(dotKey)?.forEach(listener => listener(value, dotKey))
    anyListeners.forEach(listener => listener(dotKey, value))
    effects.forEach(effect => {
      // a newly-created key re-runs every effect: an effect that read the
      // name while it didn't exist couldn't track it (`with` skipped the
      // store entirely), so dep matching would never wake it up
      if (isNewKey || Array.from(effect.deps).some(dep => pathsOverlap(dep, dotKey))) effect.run()
    })
  }

  const isWrappable = (value: any): value is Record<string, any> =>
    value !== null && typeof value === "object" && isPlainData(value)

  // a store nested inside this one keeps its own listeners and its own effects,
  // and this store's effects are not among them - so a write through the inner
  // store notifies nobody out here, and a component rendering `{{ cart.items }}`
  // off a `$reactive` it was handed would never update. The holder subscribes
  // instead, and re-notifies the inner store's changes under the path it sits at
  // ("items.0" -> "cart.items.0"). An effect that read through `cart` recorded
  // exactly that path's ancestor as a dependency, so pathsOverlap wakes it.
  // Chains compose: re-notifying runs this store's own $onAny listeners, which
  // is how a store two levels down still reaches the top
  const bridges = new Map<string, { store: any; unsubscribe: Unsubscribe }>()

  const bridge = (store: any, path: string) => {
    const current = bridges.get(path)
    if (current?.store === store) return
    current?.unsubscribe()
    bridges.set(path, {
      store,
      unsubscribe: store.$onAny((dotKey: string, value: any) => notify(`${path}.${dotKey}`, value)),
    })
  }

  // the key no longer holds the store it held: stop listening to it
  const unbridge = (path: string) => {
    bridges.get(path)?.unsubscribe()
    bridges.delete(path)
  }

  // the reactive view of `raw`, created on demand. Callers must hand it a raw
  // object (see toRaw at both call sites): wrapping a proxy is what compounds
  const wrap = (raw: Record<string, any>, path: string): Record<string, any> => {
    const cached = proxies.get(raw)
    if (cached) return cached

    // keys that were deleted off this object. `with ($scope)` resolves a name
    // through [[HasProperty]], so without a claim here a deleted key would fall
    // through to globalThis and the *whole* expression would die of
    // ReferenceError - `user ? user.name : "none"` must take its else branch
    // instead. The cost: `"user" in store` stays true after a delete
    let tombstones: Set<string> | null = null

    const proxy: Record<string, any> = new Proxy(raw, {
      has(target, key) {
        return Reflect.has(target, key) || (typeof key === "string" && tombstones?.has(key) === true)
      },
      get(target, key, receiver) {
        if (key === RAW) return target
        if (key === STORE) return path === ""
        if (typeof key !== "string") return Reflect.get(target, key, receiver)
        if (path === "" && key in storeApi) return storeApi[key]

        const dotKey = path ? `${path}.${key}` : key
        trackerStack[trackerStack.length - 1]?.add(dotKey)

        // nested objects are wrapped here rather than up front, so the object
        // handed to $reactive is never rewritten
        const value = Reflect.get(target, key, receiver)
        if (isStore(value)) {
          bridge(value, dotKey)
          return value
        }

        const raw = toRaw(value)
        return isWrappable(raw) ? wrap(raw, dotKey) : raw
      },
      set(target, key: string, value, receiver) {
        // an assignment delegated up the prototype chain from a derived scope
        // (Object.create(store) child, or a wrapping proxy): if the key isn't
        // a real property of this store, honor the receiver so the new binding
        // lands on the derived scope - a scope-local variable, not a store
        // mutation, so no notify. If the key IS a store property, fall through
        // and mutate the store itself regardless of receiver, so assignments
        // like @click="count = count + 1" work from any nested scope
        if (receiver !== proxy && !Object.prototype.hasOwnProperty.call(target, key)) {
          return Reflect.set(target, key, value, receiver)
        }

        const dotKey = path ? `${path}.${key}` : key
        // store the raw value, never a proxy - including one of our own, so
        // that `list = [list[1], list[0]]` doesn't write proxies back into the
        // data. Reads re-wrap it, from the cache, as the very same proxy. A
        // whole store assigned in is the exception: it stays as it is
        const stored = isStore(value) ? value : toRaw(value)
        const isNewKey = !Object.prototype.hasOwnProperty.call(target, key)
        // a primitive write that changes nothing notifies nobody: it's what
        // lets an effect write the value it just read (a normalizing
        // assignment, a prop sync) and settle instead of waking itself
        // forever. Only primitives and functions: re-writing the SAME object
        // reference stays loud, because that is the cross-store "deep touch"
        // channel - a parent's prop sync forwards `user.name = x` to the
        // child's store by re-assigning the same `user`, and the child's
        // listeners live on the child's store, not the parent's. A new key
        // always announces itself - the sweep is its whole point
        if (!isNewKey && Object.is(target[key], stored) && (stored === null || typeof stored !== "object")) return true
        target[key] = stored
        tombstones?.delete(key) // the key exists again: no claim needed
        if (isStore(stored)) bridge(stored, dotKey)
        else unbridge(dotKey)
        const notified = isStore(stored) || !isWrappable(stored) ? stored : wrap(stored, dotKey)
        notify(dotKey, notified, isNewKey)
        return true
      },
      // `delete data.user` is a plain-object mutation like any other, so it
      // notifies like one - with `undefined`, which is what a read returns
      // afterwards. Array methods that shrink (pop, splice) delete their dead
      // slots through this trap too. No new-key sweep: whoever depended on the
      // key tracked it while it existed, so dep matching wakes exactly them
      deleteProperty(target, key) {
        if (typeof key !== "string") return Reflect.deleteProperty(target, key)
        const had = Object.prototype.hasOwnProperty.call(target, key)
        const deleted = Reflect.deleteProperty(target, key)
        if (deleted && had) {
          const dotKey = path ? `${path}.${key}` : key
          ;(tombstones ??= new Set()).add(key)
          unbridge(dotKey) // a nested store it held: stop listening to it
          notify(dotKey, undefined)
        }
        return deleted
      }
    })

    proxies.set(raw, proxy)
    return proxy
  }

  const reactive = wrap(toRaw(data), "") as ReactiveDeepData<T>

  // a store handed in with the data (a prop, or render data) is bridged here
  // rather than on first read, so a listener registered before anything reads
  // the key still hears it. Only the top level is scanned: that's where a prop
  // lands, and descending would mean walking whatever else was handed in - a
  // highlighter, an API client - to its leaves. A store sitting deeper is
  // bridged when the read that reaches it wraps its parent
  Object.entries(toRaw(data)).forEach(([key, value]) => {
    if (isStore(value)) bridge(value, key)
  })

  const $on = (dotKey: string, listener: ChangeListener, { immediate = false }: ListenerOptions = {}): Unsubscribe => {
    if (!exactListeners.has(dotKey)) exactListeners.set(dotKey, new Set())
    exactListeners.get(dotKey)!.add(listener)
    if (immediate) listener(getByPath(reactive, dotKey), dotKey)
    return () => exactListeners.get(dotKey)?.delete(listener)
  }

  const $onAny = (listener: AnyChangeListener, { immediate = false }: ListenerOptions = {}): Unsubscribe => {
    anyListeners.add(listener)
    if (immediate) walkLeaves(reactive, "", (dotKey, value) => listener(dotKey, value))
    return () => anyListeners.delete(listener)
  }

  const $effect = (run: () => void): Unsubscribe => {
    // a notify landing while this effect runs (an item's render writing to
    // the store, waking the very effect that is rendering it) must not
    // re-enter mid-run - the half-done run would race its own repeat over
    // shared state, which is how :each once tripled its rows. It marks the
    // run dirty instead, and repeats *after* it finishes, against settled
    // state, until clean. Still fully synchronous: everything happens before
    // the triggering assignment returns
    let running = false
    let dirty = false
    const effect: Effect = {
      deps: new Set(),
      run: () => {
        if (running) {
          dirty = true
          return
        }
        running = true
        try {
          let cycles = 0
          do {
            dirty = false
            const deps = new Set<string>()
            trackerStack.push(deps)
            try {
              run()
            } finally {
              trackerStack.pop()
              effect.deps = deps
            }
          } while (dirty && ++cycles < 100)
          // an effect that keeps writing its own dependencies used to die by
          // stack overflow; now it is cut off and named
          if (dirty) console.error("jq79: an effect re-woke itself 100 times in a row (it writes what it reads); giving up on it settling")
        } finally {
          running = false
        }
      },
    }
    effects.add(effect)
    effect.run()
    return () => { effects.delete(effect) }
  }

  const $dispose = () => {
    bridges.forEach(({ unsubscribe }) => unsubscribe())
    bridges.clear()
  }

  storeApi.$on = $on
  storeApi.$onAny = $onAny
  storeApi.$effect = $effect
  storeApi.$dispose = $dispose

  return reactive
}
// groups the disposers of every $effect created for one rendered subtree
// (an :if branch, an :each item, ...) so the whole subtree's bindings can be
// torn down in one call when that subtree is replaced/removed. `scope.$effect`
// resolves through the prototype chain up to the root store no matter how
// many nested :each scopes sit in between (see renderEach's itemScope)
export type EffectScope = {
  effect: (run: () => void) => void
  // registers an arbitrary cleanup (e.g. destroying a nested component) to
  // run when this subtree is torn down
  onDispose: (fn: Unsubscribe) => void
  // re-runs every effect registered on this scope, nested scopes excluded:
  // how :each tells a reused, repositioned entry's dep-less bindings (the
  // `{{ $index }}`-only case) about their move. Deps stay as they were -
  // callers run it untracked
  refresh: () => void
  dispose: () => void
}

export const createEffectScope = (scope: Record<string, any>): EffectScope => {
  const disposers: Unsubscribe[] = []
  const runs: (() => void)[] = []
  return {
    effect: run => {
      disposers.push(scope.$effect(run))
      runs.push(run)
    },
    onDispose: fn => { disposers.push(fn) },
    refresh: () => { runs.forEach(run => run()) },
    dispose: () => {
      disposers.splice(0).forEach(dispose => dispose())
      runs.length = 0
    },
  }
}
