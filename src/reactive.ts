// the reactive store ($reactive): proxy-based deep reactivity with
// dot-path dependency tracking, plus the effect-scope helper the renderer
// uses to tear down a subtree's bindings in one call

type ChangeListener = (value: any, dotKey: string) => void
type AnyChangeListener = (dotKey: string, value: any) => void
type ListenerOptions = { immediate?: boolean }
type Unsubscribe = () => void

export type EffectOptions = {
  // wake this effect for writes below its dependencies, not only on them
  deep?: boolean
  // internal: the extra stores this effect must also be registered with, so a
  // change in any of them wakes it (see ATTACH). Slot content is the only
  // thing that sets it, by way of createEffectScope - it is deliberately not
  // part of what this API tells users about
  alsoWakenBy?: Record<string, any>[]
}

export type ReactiveDeepData<T> = T & {
  $on: (dotKey: string, listener: ChangeListener, options?: ListenerOptions) => Unsubscribe
  $onAny: (listener: AnyChangeListener, options?: ListenerOptions) => Unsubscribe
  // runs `run` immediately, recording every dotKey it reads off this store, then
  // re-runs it whenever a changed dotKey overlaps one of those - see TrieNode.
  //
  // `deep` also wakes it for writes *below* what it read. It is for the one
  // shape the store cannot see into: an effect that hands a value to code
  // outside its view - a chart library, a canvas, a request - and so reads
  // nothing the proxy can record (see docs/reactive-data.md)
  $effect: (run: () => void, options?: EffectOptions) => Unsubscribe
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

// Effect deps live in a trie keyed by path segment: a write walks down its own
// segments, so the nodes it passes through are its ancestors and the subtree it
// lands on is its descendants, with no comparison against unrelated effects.
// `own` holds effects depending on this node's exact path; `deep` holds the ones
// that want everything under it too (see the `deep` flag on $effect).
//
// Which of the two directions actually wakes an effect is the thing that makes
// this fast, and it is not symmetric - see effectsFor and
// TODOS/2026-08-23.narrow-the-wake-rule.md
//
// `children`/`own`/`deep` are allocated on first use and `parent`/`segment` let
// a removal walk back up without re-splitting the path: a 10,000-row table is
// ~40,000 nodes, and three eager allocations each (a Map and two Sets, almost
// all of them staying empty) cost more than the index saves
type TrieNode = {
  children: Map<string, TrieNode> | null
  own: Set<Effect> | null
  deep: Set<Effect> | null
  parent: TrieNode | null
  segment: string
}

// the dep an `ownKeys` read records, as a reserved last segment on the
// enumerated object's own path: an ordinary trie child that no walk for a real
// key can reach, and that the subtree sweep still reaches when the whole object
// is replaced - which is correct, a new object is a new key set. A real
// property named " keys" collides with it, the same way a flat key containing
// a dot collides with the nested path of the same name (tests/reactive.test.ts)
const KEYS_SEGMENT = " keys"

const keysPath = (path: string): string => (path ? `${path}.${KEYS_SEGMENT}` : KEYS_SEGMENT)

const createTrieNode = (parent: TrieNode | null, segment: string): TrieNode =>
  ({ children: null, own: null, deep: null, parent, segment })

const isEmptyNode = (node: TrieNode): boolean =>
  !node.own?.size && !node.deep?.size && !node.children?.size

// reads the raw object behind a store proxy. Module-level (not per-store) so a
// value that is already reactive - in this store or in another one - can be
// unwrapped before being wrapped again. Without it, handing the same object to
// two stores has each one wrapping the other's proxies, and since a wrap walks
// what it wraps, the nesting compounds until the process stops responding
const RAW = Symbol("jq79.raw")

// a free function rather than a method on the store, because the store API is
// served from the root proxy alone (see storeApi): `store.$toRaw()` would work
// and `store.user.$toRaw()` would not, which is the case callers actually have.
// The RAW symbol travels on every proxy at every depth, so this works anywhere.
// What it returns is the real object, not a copy: writes to it notify nobody
export const $toRaw = <T>(value: T): T => {
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

// `reindex` holds one callback per store this effect is registered with (its
// own, plus any it was attached to), each keeping that store's trie in step
// with the deps of the last settled run. It lives on the effect rather than
// in a per-store map because `run` has to reach it without a lookup
type Effect = { deps: Set<string>; run: () => void; reindex: Set<(deps: Set<string>) => void>; deep: boolean; order: number }

// creation order, module-wide. The flat `effects` set used to give this for
// free - iterating it ran effects oldest-first, so a parent's bindings always
// went before those of a child it had rendered. Matching through the trie
// returns them in walk order instead, and the tutorial's setup scripts are
// sensitive to it (a child effect running before its parent's re-sync reads
// state the parent has not written yet). Effects are ordered explicitly rather
// than left to whatever the index happens to yield
let effectsCreated = 0

// the deps an effect has before its first run, and what indexEffect compares
// its first run against. Never written to - every run installs a fresh set -
// so one frozen instance stands in for the two empty sets each effect used to
// allocate. 30,000 effects is 60,000 of them
const NO_DEPS: ReadonlySet<string> = new Set()

// an effect lives in exactly one store's `effects` set - the one whose
// $effect created it - and only that store's notify walks it. Content that
// reads two stores at once (a component's slot content: the parent's names
// plus the slot props the child passes it) needs one record in both sets, so
// a store serves this attach handle beside $on/$effect. Tracking already
// spans stores - trackerStack is module-level, so one run's deps are whatever
// it read, wherever it read it - only the waking didn't.
//
// Named like the compiled scripts' internals ($__effect, $__import) because it
// is one: `key in store` never answers true for a storeApi name, so `with`
// can't see it and no template expression can reach it.
//
// The cost, accepted: deps are dot-paths with no store namespace, so a name
// that exists in both stores wakes the effect from either. A spurious re-run,
// never a stale render
const ATTACH = "$__attach"

// the extra stores every effect created off a scope must be attached to. Read
// by createEffectScope off the scope it is given, so a scope can hand the
// arrangement down to whatever renders inside it (nested :each item scopes,
// a nested component's prop-sync effects) without every call site knowing
export const ALSO_WAKEN_BY = Symbol("jq79.alsoWakenBy")

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
  // itself still wake up (they hold its ancestor as a dep), which is what makes it a non-issue in
  // practice
  const proxies = new WeakMap<object, Record<string, any>>()

  // $on/$onAny/$effect are served from the root proxy's `get` instead of being
  // defined on the object: a store must leave nothing behind on the data it was
  // handed, and two stores over one object would otherwise clobber each other's
  // handles. Null-prototype, so `key in storeApi` can't match Object.prototype
  const storeApi: Record<string, any> = Object.create(null)

  // this store's dep index (see TrieNode). Segments come from splitting a
  // dotKey on ".", which is also why a flat key written as "a.b" indexes
  // exactly where the nested a.b lives - the collision dot-paths have always
  // had, preserved rather than special-cased
  const depTrie = createTrieNode(null, "")

  // hands back the node it registered on, which is what lets a removal skip the
  // path entirely (see indexEffect)
  const insertDep = (dep: string, effect: Effect): TrieNode => {
    let node = depTrie
    dep.split(".").forEach(segment => {
      const children = (node.children ??= new Map())
      let child = children.get(segment)
      if (!child) {
        child = createTrieNode(node, segment)
        children.set(segment, child)
      }
      node = child
    })
    ;((effect.deep ? (node.deep ??= new Set()) : (node.own ??= new Set()))).add(effect)
    return node
  }

  // prunes the nodes it empties on the way back up, so a list that churns
  // through rows doesn't leave the trie growing over the dead ones. Follows
  // `parent` rather than re-walking from the root: tearing down a 10,000-row
  // table is 30,000 of these, and splitting each path again to find a node the
  // caller was already holding is most of what that used to cost
  const removeDep = (node: TrieNode, effect: Effect) => {
    ;(effect.deep ? node.deep : node.own)?.delete(effect)
    let current: TrieNode | null = node
    while (current?.parent && isEmptyNode(current)) {
      current.parent.children!.delete(current.segment)
      current = current.parent
    }
  }

  const nodeAt = (dep: string): TrieNode | undefined => {
    let node: TrieNode | undefined = depTrie
    for (const segment of dep.split(".")) {
      node = node.children?.get(segment)
      if (!node) return undefined
    }
    return node
  }

  // every effect this write concerns. Two directions, and they are not
  // symmetric:
  //
  // - **downwards**, always: whatever hangs off the node the walk lands on. A
  //   dep of "user.name" hears `user = {...}`, because replacing the object
  //   replaced the name with it.
  // - **upwards**, only where an ancestor dep is the only channel a change
  //   has (see `coarsePath`). A dep of "data" does NOT hear
  //   `data[5].label = x`: an effect that read the array on its way to row
  //   7's label has no stake in row 5's, and waking all of them is what made
  //   100 row writes cost 100,000 effect runs - see
  //   TODOS/2026-08-23.narrow-the-wake-rule.md
  //
  // Returned as a snapshot, so the effects it wakes can reindex themselves -
  // or dispose each other - while it drains
  const effectsFor = (dotKey: string): Set<Effect> => {
    const matched = new Set<Effect>()
    const sweep = (from: TrieNode) => {
      const pending = from.children ? [...from.children.values()] : []
      while (pending.length) {
        const next = pending.pop()!
        next.own?.forEach(effect => matched.add(effect))
        next.deep?.forEach(effect => matched.add(effect))
        next.children?.forEach(child => pending.push(child))
      }
    }

    let node: TrieNode | undefined = depTrie
    const segments = dotKey.split(".")
    let path = ""
    for (let depth = 0; depth < segments.length - 1; depth++) {
      node = node.children?.get(segments[depth])
      if (!node) return matched
      path = path ? `${path}.${segments[depth]}` : segments[depth]
      node.deep?.forEach(effect => matched.add(effect))
      // a nested store sits here: an effect that read through it holds this
      // path and nothing below it, so its own set is the whole channel
      if (bridges.has(path)) node.own?.forEach(effect => matched.add(effect))
      // ...whereas an array's length stands for the array: everything that
      // read an element has to hear a truncation, and those deps are below
      if (depth === segments.length - 2 && segments[depth + 1] === "length") {
        node.own?.forEach(effect => matched.add(effect))
        sweep(node)
      }
    }
    node = node.children?.get(segments[segments.length - 1])
    if (!node) return matched
    node.own?.forEach(effect => matched.add(effect))
    node.deep?.forEach(effect => matched.add(effect))
    sweep(node)
    return matched
  }

  // Reaching `data[5].label` reads three paths and tracks all three, but for an
  // ordinary effect the two ancestors carry no information the leaf doesn't: a
  // write to "data" or "data.5" reaches "data.5.label" through the subtree
  // sweep anyway. Dropping them is a third of the index to build, hold and tear
  // down on a list of any size.
  //
  // Not for a `deep` effect, where it is exactly backwards - a forwarding
  // effect wakes off its *ancestor* entries, so its shallowest dep is the one
  // doing the work and the leaves are the redundant ones
  const indexable = (effect: Effect, deps: Set<string>): Set<string> => {
    if (effect.deep || deps.size < 2) return deps
    // every ancestor of every dep is redundant, so mark them by walking each
    // dep's own dots rather than comparing deps against each other: a `:each`
    // over 10,000 rows tracks 10,000 deps, and the pairwise version of this
    // was 100,000,000 string comparisons
    const redundant = new Set<string>()
    deps.forEach(dep => {
      for (let dot = dep.indexOf("."); dot !== -1; dot = dep.indexOf(".", dot + 1)) {
        redundant.add(dep.slice(0, dot))
      }
    })
    if (!redundant.size) return deps
    const kept = new Set<string>()
    deps.forEach(dep => { if (!redundant.has(dep)) kept.add(dep) })
    return kept
  }

  // registers `effect` with this store's trie and keeps it in step. Each store
  // tracks what it indexed for the effect separately, because a detach must
  // clear this trie without touching the others
  const indexEffect = (effect: Effect): Unsubscribe => {
    // dep -> the node it sits on, so removal never re-walks a path: the
    // overwhelmingly common re-run has identical deps and touches the trie not
    // at all, and a disposal goes straight to the nodes it registered
    // almost every effect ends up with exactly one dep once the redundant
    // ancestors are pruned - a row binding reads one path - so the single case
    // is held in two slots and the Map is allocated only when a second arrives
    let soleDep: string | null = null
    let soleNode: TrieNode | null = null
    let indexed: Map<string, TrieNode> | null = null
    // what the last run tracked, before pruning. The comparison has to happen
    // against these rather than against what is indexed, because pruning them
    // is itself work this fast path exists to skip
    let lastTracked: ReadonlySet<string> = NO_DEPS

    const placed = (dep: string): boolean =>
      indexed ? indexed.has(dep) : soleDep === dep

    const place = (dep: string) => {
      const node = insertDep(dep, effect)
      if (indexed) indexed.set(dep, node)
      else if (soleDep === null) { soleDep = dep; soleNode = node }
      else {
        indexed = new Map([[soleDep, soleNode!], [dep, node]])
        soleDep = soleNode = null
      }
    }

    const unplaceStale = (deps: Set<string>) => {
      if (indexed) {
        indexed.forEach((node, dep) => {
          if (deps.has(dep)) return
          removeDep(node, effect)
          indexed!.delete(dep)
        })
        return
      }
      if (soleDep !== null && !deps.has(soleDep)) {
        removeDep(soleNode!, effect)
        soleDep = soleNode = null
      }
    }

    const unplaceAll = () => {
      if (indexed) indexed.forEach(node => removeDep(node, effect))
      else if (soleNode) removeDep(soleNode, effect)
      indexed = null
      soleDep = soleNode = null
    }
    const sync = (tracked: Set<string>) => {
      // an effect that re-runs almost always reads exactly what it read last
      // time, and this is on the path of every single run: same count and every
      // path seen before means nothing about the index can have changed
      if (tracked.size === lastTracked.size) {
        let unchanged = true
        tracked.forEach(dep => { unchanged &&= lastTracked.has(dep) })
        if (unchanged) return
      }
      lastTracked = tracked
      const deps = indexable(effect, tracked)
      unplaceStale(deps)
      deps.forEach(dep => { if (!placed(dep)) place(dep) })
    }
    effect.reindex.add(sync)
    sync(effect.deps) // an effect attached after it first ran arrives with deps
    return () => {
      effect.reindex.delete(sync)
      unplaceAll()
      lastTracked = NO_DEPS
    }
  }

  // wakes the effects sitting on one exact path, without the subtree sweep a
  // full notify does. Two callers want this: a key-set change (nothing under
  // the object changed, only which keys it has) and a container replaced by one
  // holding the same elements (see notifyReplaced)
  const wakeExactly = (dep: string) => {
    const node = nodeAt(dep)
    if (node) runMatched(new Set([...(node.own ?? []), ...(node.deep ?? [])]))
  }

  // an object's key set changed. Effects only - a key set isn't a value, so
  // there is nothing to hand $on/$onAny that they don't already get from the
  // key's own notification
  const notifyKeys = (path: string) => wakeExactly(keysPath(path))

  // oldest first, and re-checking membership as it goes: an effect disposed by
  // an earlier one in this same pass (a list diff tearing down the rows it just
  // woke) must not run
  const runMatched = (matched: Set<Effect>) => {
    const ordered = Array.from(matched)
    // effects are usually collected in creation order already - one node's set
    // is filled as its effects are made, and a subtree sweep of a freshly-built
    // list walks them the same way. Checking costs one pass; sorting a woken
    // set of 10,000 costs rather more
    let sorted = true
    for (let i = 1; sorted && i < ordered.length; i++) sorted = ordered[i - 1].order < ordered[i].order
    if (!sorted) ordered.sort((a, b) => a.order - b.order)
    ordered.forEach(effect => { if (effects.has(effect)) effect.run() })
  }

  const notify = (dotKey: string, value: any, isNewKey = false) => {
    exactListeners.get(dotKey)?.forEach(listener => listener(value, dotKey))
    anyListeners.forEach(listener => listener(dotKey, value))
    // a newly-created key re-runs every effect: an effect that read the
    // name while it didn't exist couldn't track it (`with` skipped the
    // store entirely), so dep matching would never wake it up
    if (isNewKey) effects.forEach(effect => effect.run())
    // `effects.has` stands in for the membership check `effects.forEach` used
    // to give for free: an effect disposed by an earlier effect in this same
    // notify (a list diff tearing down the rows it just woke) must not run
    else runMatched(effectsFor(dotKey))
  }

  // both sides are containers of the same kind, so what changed can be asked
  // rather than assumed. Not the same object - that case never gets here (a
  // same-reference write is the deep-touch channel and stays loud), and not a
  // store on either side, which passes through whole
  const replaceable = (previous: any, next: any): boolean =>
    previous !== next &&
    previous !== null && next !== null &&
    typeof previous === "object" && typeof next === "object" &&
    !isStore(previous) && !isStore(next) &&
    isPlainData(previous) && isPlainData(next) &&
    Array.isArray(previous) === Array.isArray(next)

  const keyCount = (container: any): number =>
    Array.isArray(container) ? container.length : Object.keys(container).length

  // which keys hold a different value than they did, or null when so many do
  // that notifying them one at a time would cost more than sweeping the
  // container. Arrays - the case this exists for - are walked by index, so a
  // 10,000 element list is compared without building a key array or a set of
  // them: that bookkeeping alone was costing more than it saved on every
  // replacement that ends up sweeping anyway
  const GIVE_UP: null = null

  const whatChanged = (previous: any, next: any): string[] | null => {
    if (Array.isArray(next)) {
      const before = previous.length
      const after = next.length
      // nothing on one side means nothing to reuse on the other
      if (!before || !after) return GIVE_UP
      const span = Math.max(before, after)
      const changed: string[] = []
      for (let index = 0; index < span; index++) {
        if (Object.is($toRaw(previous[index]), $toRaw(next[index]))) continue
        changed.push(String(index))
        if (changed.length * 2 >= span) return GIVE_UP
      }
      return changed
    }
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
    if (!keys.size) return GIVE_UP
    const changed: string[] = []
    keys.forEach(key => { if (!Object.is($toRaw(previous[key]), $toRaw(next[key]))) changed.push(key) })
    return changed.length * 2 >= keys.size ? GIVE_UP : changed
  }

  // A container replaced by another container: notify the elements that
  // actually differ instead of the container and everything under it.
  // `data = [...data, ...more]` holds the very same row objects at every index
  // it had before, so waking all thirty thousand of their bindings to re-render
  // identical output is ~150ms of a 208ms append - see
  // TODOS/2026-08-23.notify-the-difference.md
  //
  // One level deep on purpose: an element that differs is a changed value, and
  // notifying it sweeps its own subtree, which is what a changed value deserves
  const notifyReplaced = (dotKey: string, previous: any, next: any, notified: any) => {
    // one write, one wake: every path below contributes to a single set that
    // runs once at the end. Notifying them one at a time re-ran an effect that
    // depends on several of them once per path
    const matched = new Set<Effect>()
    const collectExact = (dep: string) => {
      const node = nodeAt(dep)
      node?.own?.forEach(effect => matched.add(effect))
      node?.deep?.forEach(effect => matched.add(effect))
    }

    const changed = whatChanged(previous, next)
    // when most of the container differs there is nothing to spare: `data = []`
    // and a wholesale replacement change every key, and reaching each one
    // through its own trie walk costs more than the single sweep it replaces.
    // whatChanged says so by giving up. The decision has to come before
    // anything is announced, or the plain notify would fire the container's
    // listeners a second time
    if (!changed) return notify(dotKey, notified)

    exactListeners.get(dotKey)?.forEach(listener => listener(notified, dotKey))
    // $onAny hears the container and nothing else, exactly as it did when this
    // was one notify. It is what a bridge re-notifies upstairs, and the holder
    // sweeps its own side off that one path - announcing each changed element
    // as well would be a thousand redundant notifications for the same news
    anyListeners.forEach(listener => listener(dotKey, notified))
    // the container itself did change: whoever read it, or forwards it whole,
    // hears that - but nothing is swept on its account
    collectExact(dotKey)

    changed.forEach(key => {
      const after = $toRaw(next[key])
      const child = `${dotKey}.${key}`
      const value = isWrappable(after) ? wrap(after, child) : after
      exactListeners.get(child)?.forEach(listener => listener(value, child))
      effectsFor(child).forEach(effect => matched.add(effect))
    })
    if (keyCount(previous) !== keyCount(next)) collectExact(keysPath(dotKey))
    // an array's length is a real dep (a `:each` reads it on its way through
    // list.map) and is not one of the keys walked above. Collected exactly:
    // the sweep a length write normally carries is for a truncation, and the
    // elements that a shrink dropped are already in `keys`
    if (Array.isArray(next) && previous.length !== next.length) {
      const lengthKey = `${dotKey}.length`
      exactListeners.get(lengthKey)?.forEach(listener => listener(next.length, lengthKey))
      collectExact(lengthKey)
    }
    runMatched(matched)
  }

  const isWrappable = (value: any): value is Record<string, any> =>
    value !== null && typeof value === "object" && isPlainData(value)

  // a store nested inside this one keeps its own listeners and its own effects,
  // and this store's effects are not among them - so a write through the inner
  // store notifies nobody out here, and a component rendering `{{ cart.items }}`
  // off a `$reactive` it was handed would never update. The holder subscribes
  // instead, and re-notifies the inner store's changes under the path it sits at
  // ("items.0" -> "cart.items.0"). An effect that read through `cart` recorded
  // exactly that path's ancestor as a dependency, so the trie walk wakes it.
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
  // object (see $toRaw at both call sites): wrapping a proxy is what compounds
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
      // reading the key set is a dependency of its own: `Object.keys(props)`,
      // `{...props}`, `for...in` and renderEach's walk of a list's keys all care
      // about which keys exist, not about what any one of them holds. It used
      // to be caught only by the coarse ancestor rule, which is now gone -
      // this is the same job Svelte gives a per-object `version` signal, held
      // as an ordinary trie child under a reserved final segment (see
      // KEYS_SEGMENT), so adds and deletes wake exactly the effects enumerating
      ownKeys(target) {
        trackerStack[trackerStack.length - 1]?.add(keysPath(path))
        return Reflect.ownKeys(target)
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

        const raw = $toRaw(value)
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
        const stored = isStore(value) ? value : $toRaw(value)
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
        const previous = target[key]
        target[key] = stored
        tombstones?.delete(key) // the key exists again: no claim needed
        if (isStore(stored)) bridge(stored, dotKey)
        else unbridge(dotKey)
        const notified = isStore(stored) || !isWrappable(stored) ? stored : wrap(stored, dotKey)
        // a new key already re-runs every effect in the store (see notify), so
        // the key set growing needs no announcement of its own - only a delete,
        // which wakes precisely, does
        if (!isNewKey && replaceable(previous, stored)) notifyReplaced(dotKey, previous, stored, notified)
        else notify(dotKey, notified, isNewKey)
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
          // the key set shrank: whoever enumerated this object hears it even
          // if it never read the key that went (see the ownKeys trap)
          notifyKeys(path)
        }
        return deleted
      }
    })

    proxies.set(raw, proxy)
    return proxy
  }

  const reactive = wrap($toRaw(data), "") as ReactiveDeepData<T>

  // a store handed in with the data (a prop, or render data) is bridged here
  // rather than on first read, so a listener registered before anything reads
  // the key still hears it. Only the top level is scanned: that's where a prop
  // lands, and descending would mean walking whatever else was handed in - a
  // highlighter, an API client - to its leaves. A store sitting deeper is
  // bridged when the read that reaches it wraps its parent
  Object.entries($toRaw(data)).forEach(([key, value]) => {
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

  const $effect = (run: () => void, { deep = false, alsoWakenBy }: EffectOptions = {}): Unsubscribe => {
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
      deps: NO_DEPS as Set<string>,
      reindex: new Set(),
      deep,
      order: effectsCreated++,
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
          // the settled deps are the only ones worth indexing: the repeats of
          // a dirty run overwrite each other, and a notify that lands mid-run
          // is queued rather than dispatched, so nothing reads the index in
          // between. In `finally` so a run that throws still leaves the index
          // matching the deps the run did commit
          effect.reindex.forEach(sync => sync(effect.deps))
        }
      },
    }
    effects.add(effect)
    const stopIndexing = indexEffect(effect)
    const forget = () => {
      effects.delete(effect)
      stopIndexing()
    }
    // the shared case is rare (only slot content asks for it) and this
    // function is on the stack for as long as whatever it renders - a
    // component that renders itself stacks 200 of these - so it keeps the
    // shape it had, and the extra bookkeeping lives in its own frame
    if (alsoWakenBy?.length) return attachAndRun(effect, alsoWakenBy, forget)
    effect.run()
    return forget
  }

  // attached before the first run, so a store that notifies during it (a setup
  // script's write, a prop sync) reaches this effect like any other
  const attachAndRun = (effect: Effect, alsoWakenBy: Record<string, any>[], forget: Unsubscribe): Unsubscribe => {
    const detach = alsoWakenBy.map(store => store?.[ATTACH]?.(effect)).filter(Boolean) as Unsubscribe[]
    effect.run()
    return () => {
      forget()
      detach.forEach(drop => drop())
    }
  }

  const $__attach = (effect: Effect): Unsubscribe => {
    effects.add(effect)
    const stopIndexing = indexEffect(effect)
    return () => {
      effects.delete(effect)
      stopIndexing()
    }
  }

  const $dispose = () => {
    bridges.forEach(({ unsubscribe }) => unsubscribe())
    bridges.clear()
  }

  storeApi.$on = $on
  storeApi.$onAny = $onAny
  storeApi.$effect = $effect
  storeApi.$dispose = $dispose
  storeApi[ATTACH] = $__attach

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

// `deep` marks every effect this scope creates as forwarding a value wholesale
// rather than reading into it - the prop-sync scope, and nothing else so far.
// See the `deep` flag on $effect
//
// A class rather than an object of closures, and its arrays built on demand,
// because a :each makes one of these *per row*: the closure form allocated the
// two arrays and four closures for every one of them, and a 10,000-row table
// is 70,000 objects that exist to hold, on the common path, three disposers.
// The prototype's methods are shared, and a row that registers nothing (a
// static template) now allocates one object and no arrays at all.
// See TODOS/2026-08-23.where-the-create-time-goes.md
//
// Prototype methods need their receiver: a caller that hands one on as a bare
// function (`runSetupScript(..., fx.effect, ...)` did) must wrap it instead
// (`run => fx.effect(run)`). Both such call sites are in renderComponent
class Scope implements EffectScope {
  // built on first use: `runs` in particular is only ever read by refresh(),
  // which only a :each whose template names a position ever calls
  private disposers: Unsubscribe[] | null = null
  private runs: (() => void)[] | null = null
  // one options object for the whole scope instead of one per effect - $effect
  // destructures it on entry and keeps nothing. Left undefined on the common
  // path, which is $effect's own fast path
  private options: EffectOptions | undefined

  constructor(private scope: Record<string, any>, deep: boolean) {
    // whatever the scope was handed (slot content is the only thing that sets
    // it today): the stores this scope's effects belong to besides their own
    const alsoWakenBy: Record<string, any>[] | undefined = (scope as any)[ALSO_WAKEN_BY]
    this.options = deep || alsoWakenBy ? { deep, alsoWakenBy } : undefined
  }

  effect(run: () => void) {
    ;(this.disposers ??= []).push(this.scope.$effect(run, this.options))
    ;(this.runs ??= []).push(run)
  }

  onDispose(fn: Unsubscribe) {
    ;(this.disposers ??= []).push(fn)
  }

  refresh() {
    this.runs?.forEach(run => run())
  }

  dispose() {
    // detached before draining, not copied out of the way with splice(0): a
    // disposer that registers another one is as lost either way, and the copy
    // was an array per row on the teardown path
    const disposers = this.disposers
    this.disposers = null
    this.runs = null
    if (disposers) for (let i = 0; i < disposers.length; i++) disposers[i]()
  }
}

export const createEffectScope = (scope: Record<string, any>, deep = false): EffectScope => new Scope(scope, deep)
