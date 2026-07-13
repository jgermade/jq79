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

// active $effect() runs, innermost last - a module-level stack (rather than
// one per store) so nested effects across stores still nest correctly; reads
// during makeReactive's `get` trap are attributed to whichever run is on top
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
  // every proxy this store has ever handed out, so re-assigning an object
  // that's already reactive (e.g. `data.list = [data.list[1], data.list[0]]`)
  // doesn't wrap it a second time - which would hand out a *new* object
  // identity for the same logical item, breaking reference-equality checks
  // like :each's keyed diffing
  const reactiveProxies = new WeakSet<object>()

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

  const makeReactive = (obj: Record<string, any>, path: string): Record<string, any> => {
    if (reactiveProxies.has(obj)) return obj

    Object.entries(obj).forEach(([key, value]) => {
      if (value && typeof value === "object" && isPlainData(value)) {
        obj[key] = makeReactive(value, path ? `${path}.${key}` : key)
      }
    })

    const proxy = new Proxy(obj, {
      get(target, key, receiver) {
        if (typeof key === "string") {
          trackerStack[trackerStack.length - 1]?.add(path ? `${path}.${key}` : key)
        }
        return Reflect.get(target, key, receiver)
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
        if (value && typeof value === "object" && isPlainData(value)) {
          value = makeReactive(value, dotKey)
        }
        const isNewKey = !Object.prototype.hasOwnProperty.call(target, key)
        target[key] = value
        notify(dotKey, value, isNewKey)
        return true
      }
    })

    reactiveProxies.add(proxy)
    return proxy
  }

  const reactive = makeReactive(data, "") as ReactiveDeepData<T>

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
    const effect: Effect = {
      deps: new Set(),
      run: () => {
        const deps = new Set<string>()
        trackerStack.push(deps)
        try {
          run()
        } finally {
          trackerStack.pop()
          effect.deps = deps
        }
      },
    }
    effects.add(effect)
    effect.run()
    return () => { effects.delete(effect) }
  }

  Object.defineProperty(reactive, "$on", { value: $on, enumerable: false })
  Object.defineProperty(reactive, "$onAny", { value: $onAny, enumerable: false })
  Object.defineProperty(reactive, "$effect", { value: $effect, enumerable: false })

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
  dispose: () => void
}

export const createEffectScope = (scope: Record<string, any>): EffectScope => {
  const disposers: Unsubscribe[] = []
  return {
    effect: run => { disposers.push(scope.$effect(run)) },
    onDispose: fn => { disposers.push(fn) },
    dispose: () => { disposers.splice(0).forEach(dispose => dispose()) },
  }
}
