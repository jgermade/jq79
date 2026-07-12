
export const $ = (selectorOrEl: string | Element, selector?: string) => 
  typeof selectorOrEl === "string"
    ? document.querySelector(selectorOrEl)
    : selectorOrEl.querySelector(selector || "")

export const $$ = (selectorOrEl: string | Element, selector?: string) => Array.from(
  typeof selectorOrEl === "string"
    ? document.querySelectorAll(selectorOrEl)
    : selectorOrEl.querySelectorAll(selector || "")
)

type TemplateNode = {
  tag: string
  attrs: Record<string, string>
  children: (TemplateNode | string)[]
}

type TagBlock = {
  attrs: Record<string, string>
  content: string
}

const elementAttrs = (el: Element): Record<string, string> =>
  Object.fromEntries(Array.from(el.attributes).map(attr => [attr.name, attr.value]))

const elementToAST = (el: Element): TemplateNode => ({
  tag: el.tagName.toLowerCase(),
  attrs: elementAttrs(el),
  children: Array.from(el.childNodes).flatMap((node): (TemplateNode | string)[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim() ?? ""
      return text ? [text] : []
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      return [elementToAST(node as Element)]
    }
    return []
  })
})

// evaluated with `with` (rather than passing scope keys as positional params)
// so only the identifiers an expression actually references are read from
// `scope` - which is what makes dependency tracking in createReactiveDeepData
// precise instead of "read everything up front"
const evalExpr = (expr: string, scope: Record<string, any>): any => {
  try {
    return new Function("$scope", `with ($scope) { return (${expr}); }`)(scope)
  } catch {
    return undefined
  }
}

const interpolate = (template: string, scope: Record<string, any>): string =>
  template.replace(/{{\s*(.+?)\s*}}/g, (_, expr) => evalExpr(expr, scope) ?? "")

type ChangeListener = (value: any, dotKey: string) => void
type AnyChangeListener = (dotKey: string, value: any) => void
type ListenerOptions = { immediate?: boolean }
type Unsubscribe = () => void

type ReactiveDeepData<T> = T & {
  $on: (dotKey: string, listener: ChangeListener, options?: ListenerOptions) => Unsubscribe
  $onAny: (listener: AnyChangeListener, options?: ListenerOptions) => Unsubscribe
  // runs `run` immediately, recording every dotKey it reads off this store, then
  // re-runs it whenever a changed dotKey overlaps one of those - see pathsOverlap
  $effect: (run: () => void) => Unsubscribe
}

const getByPath = (obj: Record<string, any>, dotKey: string): any =>
  dotKey.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)

const walkLeaves = (obj: Record<string, any>, path: string, visit: (dotKey: string, value: any) => void) => {
  Object.entries(obj).forEach(([key, value]) => {
    const dotKey = path ? `${path}.${key}` : key
    if (value && typeof value === "object") walkLeaves(value, dotKey, visit)
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

type Effect = { deps: Set<string>; run: () => void }

export const createReactiveDeepData = <T extends Record<string, any>>(data: T): ReactiveDeepData<T> => {
  const exactListeners = new Map<string, Set<ChangeListener>>()
  const anyListeners = new Set<AnyChangeListener>()
  const effects = new Set<Effect>()
  // every proxy this store has ever handed out, so re-assigning an object
  // that's already reactive (e.g. `data.list = [data.list[1], data.list[0]]`)
  // doesn't wrap it a second time - which would hand out a *new* object
  // identity for the same logical item, breaking reference-equality checks
  // like :each's keyed diffing
  const reactiveProxies = new WeakSet<object>()

  const notify = (dotKey: string, value: any) => {
    exactListeners.get(dotKey)?.forEach(listener => listener(value, dotKey))
    anyListeners.forEach(listener => listener(dotKey, value))
    effects.forEach(effect => {
      if (Array.from(effect.deps).some(dep => pathsOverlap(dep, dotKey))) effect.run()
    })
  }

  const makeReactive = (obj: Record<string, any>, path: string): Record<string, any> => {
    if (reactiveProxies.has(obj)) return obj

    Object.entries(obj).forEach(([key, value]) => {
      if (value && typeof value === "object") {
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
        const dotKey = path ? `${path}.${key}` : key
        if (value && typeof value === "object") {
          value = makeReactive(value, dotKey)
        }
        // Reflect.set (not target[key] = value) so that writes delegated up
        // the prototype chain from an unrelated object - e.g. Object.assign on
        // an :each item scope created via Object.create(rootScope) - land on
        // that object (the receiver) instead of clobbering this store
        const result = Reflect.set(target, key, value, receiver)
        notify(dotKey, value)
        return result
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

const CONTROL_ATTRS = new Set([":bind", ":if", ":elseif", ":else", ":each", ":key"])
const EACH_PATTERN = /^\s*(\w+)\s+in\s+(.+)$/

type ConditionalBranch = { expr?: string; node: TemplateNode }

// groups the disposers of every $effect created for one rendered subtree
// (an :if branch, an :each item, ...) so the whole subtree's bindings can be
// torn down in one call when that subtree is replaced/removed. `scope.$effect`
// resolves through the prototype chain up to the root store no matter how
// many nested :each scopes sit in between (see renderEach's itemScope)
type EffectScope = { effect: (run: () => void) => void; dispose: () => void }

const createEffectScope = (scope: Record<string, any>): EffectScope => {
  const unsubscribes: Unsubscribe[] = []
  return {
    effect: run => { unsubscribes.push(scope.$effect(run)) },
    dispose: () => { unsubscribes.splice(0).forEach(unsubscribe => unsubscribe()) },
  }
}

// renders a single element node: static attrs, a reactive :bind object, and its
// (reactive) children. :if/:elseif/:else/:each are handled by renderNodes, which
// decides *whether*/*how many times* a node is rendered before calling this
const renderNode = (node: TemplateNode, scope: Record<string, any>, fx: EffectScope): Node => {
  const el = document.createElement(node.tag)

  Object.entries(node.attrs).forEach(([key, value]) => {
    if (!CONTROL_ATTRS.has(key)) el.setAttribute(key, value)
  })

  const bindExpr = node.attrs[":bind"]
  if (bindExpr !== undefined) {
    let boundKeys: string[] = []

    fx.effect(() => {
      boundKeys.forEach(key => el.removeAttribute(key))
      const bound = evalExpr(bindExpr, scope)
      boundKeys = bound && typeof bound === "object" ? Object.keys(bound) : []
      boundKeys.forEach(key => {
        const value = bound[key]
        if (value != null && value !== false) el.setAttribute(key, String(value))
      })
    })
  }

  el.appendChild(renderNodes(node.children, scope, fx))

  return el
}

// a :if/:elseif*/:else? chain sharing one anchor comment so the active branch
// can be swapped in place without disturbing sibling positions. Only depends
// on whatever the branch expressions read (e.g. "score"), and skips
// rebuilding entirely when the active branch hasn't actually changed
const renderConditional = (branches: ConditionalBranch[], scope: Record<string, any>, fx: EffectScope): Node => {
  const anchor = document.createComment("if")
  const wrapper = document.createDocumentFragment()
  wrapper.appendChild(anchor)

  let current: Node | null = null
  let activeBranch: ConditionalBranch | null = null
  let branchFx: EffectScope | null = null

  fx.effect(() => {
    const next = branches.find(branch => branch.expr === undefined || evalExpr(branch.expr, scope)) ?? null
    if (next === activeBranch) return

    branchFx?.dispose()
    if (current) current.parentNode?.removeChild(current)
    current = null
    activeBranch = next
    if (!next) return

    branchFx = createEffectScope(scope)
    current = renderNode(next.node, scope, branchFx)
    anchor.parentNode!.insertBefore(current, anchor.nextSibling)
  })

  return wrapper
}

// defines a loop-local binding directly as `scope`'s own property. Plain
// assignment (scope[key] = value) would only do this if the key isn't
// already own on `scope` *or anywhere up its prototype chain* - if it isn't,
// JS delegates the [[Set]] to whatever's up there, which for us is another
// reactive proxy's `set` trap: it would wrap `value` as if it were a genuine
// store mutation and fire a bogus notify() under a name (e.g. "item") shared
// by every unrelated item in every :each on the page. defineProperty always
// writes to `scope` itself, never delegating, so this can't happen
const defineScopeVar = (scope: Record<string, any>, key: string, value: any) => {
  Object.defineProperty(scope, key, { value, writable: true, enumerable: true, configurable: true })
}

type EachEntry = { key: any; item: any; scope: Record<string, any>; node: Node; fx: EffectScope }

// :each="item in items", optionally keyed with :key="expr". Only depends on
// the list expression itself (e.g. "items"), and on each run diffs by key:
// unchanged items (same key, same item reference) keep their DOM/effects,
// changed/added ones are (re)rendered, removed ones are disposed. Without
// :key, position is used as the key, so reordering rebuilds every item after
// the first change - add :key for anything that gets reordered or filtered.
// Each item gets its own scope via Object.create(scope), so `item`/`$index`
// shadow same-named outer bindings without copying the parent scope's keys
const renderEach = (node: TemplateNode, scope: Record<string, any>, fx: EffectScope): Node => {
  const match = node.attrs[":each"].match(EACH_PATTERN)
  if (!match) return document.createComment(`invalid :each expression "${node.attrs[":each"]}"`)

  const [, itemName, listExpr] = match
  const keyExpr = node.attrs[":key"]
  const { [":each"]: _each, [":key"]: _key, ...itemAttrs } = node.attrs
  const itemNode: TemplateNode = { ...node, attrs: itemAttrs }

  const anchor = document.createComment("each")
  const wrapper = document.createDocumentFragment()
  wrapper.appendChild(anchor)

  let entries: EachEntry[] = []

  fx.effect(() => {
    const list = evalExpr(listExpr, scope)
    const items = Array.isArray(list) ? list : []
    const previous = new Map(entries.map(entry => [entry.key, entry]))

    const nextEntries = items.map((item, index): EachEntry => {
      const itemScope = Object.create(scope)
      defineScopeVar(itemScope, itemName, item)
      defineScopeVar(itemScope, "$index", index)
      const key = keyExpr !== undefined ? evalExpr(keyExpr, itemScope) : index
      const existing = previous.get(key)

      if (existing && Object.is(existing.item, item)) {
        defineScopeVar(existing.scope, "$index", index)
        return existing
      }

      existing?.fx.dispose()
      existing?.node.parentNode?.removeChild(existing.node)

      const itemFx = createEffectScope(scope)
      return { key, item, scope: itemScope, fx: itemFx, node: renderNode(itemNode, itemScope, itemFx) }
    })

    const nextKeys = new Set(nextEntries.map(entry => entry.key))
    entries.forEach(entry => {
      if (!nextKeys.has(entry.key)) {
        entry.fx.dispose()
        entry.node.parentNode?.removeChild(entry.node)
      }
    })

    let prevNode: Node = anchor
    nextEntries.forEach(entry => {
      if (prevNode.nextSibling !== entry.node) anchor.parentNode!.insertBefore(entry.node, prevNode.nextSibling)
      prevNode = entry.node
    })

    entries = nextEntries
  })

  return wrapper
}

// renders a list of sibling template nodes (text + elements), grouping
// consecutive :if/:elseif/:else nodes into a single conditional block
const renderNodes = (nodes: (TemplateNode | string)[], scope: Record<string, any>, fx: EffectScope): DocumentFragment => {
  const fragment = document.createDocumentFragment()
  let i = 0

  while (i < nodes.length) {
    const node = nodes[i]

    if (typeof node === "string") {
      const textNode = document.createTextNode("")
      fx.effect(() => { textNode.textContent = interpolate(node, scope) })
      fragment.appendChild(textNode)
      i++
      continue
    }

    if (":each" in node.attrs) {
      fragment.appendChild(renderEach(node, scope, fx))
      i++
      continue
    }

    if (":if" in node.attrs) {
      const branches: ConditionalBranch[] = [{ expr: node.attrs[":if"], node }]
      i++
      while (i < nodes.length && typeof nodes[i] !== "string" && ":elseif" in (nodes[i] as TemplateNode).attrs) {
        const elseifNode = nodes[i] as TemplateNode
        branches.push({ expr: elseifNode.attrs[":elseif"], node: elseifNode })
        i++
      }
      if (i < nodes.length && typeof nodes[i] !== "string" && ":else" in (nodes[i] as TemplateNode).attrs) {
        branches.push({ node: nodes[i] as TemplateNode })
        i++
      }

      fragment.appendChild(renderConditional(branches, scope, fx))
      continue
    }

    fragment.appendChild(renderNode(node, scope, fx))
    i++
  }

  return fragment
}

export const renderComponent = (component: Component79, data: ReactiveDeepData<Record<string, any>>): Node =>
  renderNodes(component.template, data, createEffectScope(data))

class Component79 {
    constructor(public template: TemplateNode[], public scripts: TagBlock[], public styles: TagBlock[]) {
        this.template = template
        this.scripts = scripts
        this.styles = styles
    }
}

// converts a string of HTML into a AST (Abstract Syntax Tree) representation of the component
// Returns an object with the following properties:
// - template: the template of the component in a AST representation
// - scripts: {
//   attrs: the attributes of the script tag
//   content: the content of the script tag
// }[]
// - styles: {
//   attrs: the attributes of the style tag
//   content: the content of the style tag
// }[]
export const parseComponent = (component: string) => {
  // example
  // <script :setup="{ fname, lname }">
  //   const fullName = `${fname} ${lname}`
  // </script>
  //
  // <div :bind="{ fullName }" />
  // <div class="full-name">
  //  {{ fullName }}
  // </div>
  //
  // <style>
  // .full-name {
  //  color: red;
  // }
  // </style>

  // parsed as the content of a <template> so leading <script>/<style> tags
  // aren't reparented into <head> by the HTML parser
  const parsedDOM = new DOMParser().parseFromString(`<template>${component}</template>`, "text/html")
  const root = parsedDOM.querySelector("template") as HTMLTemplateElement

  const scripts: TagBlock[] = []
  const styles: TagBlock[] = []
  const template: TemplateNode[] = []

  Array.from(root.content.children).forEach(el => {
    const block = { attrs: elementAttrs(el), content: el.textContent ?? "" }

    if (el.tagName === "SCRIPT") scripts.push(block)
    else if (el.tagName === "STYLE") styles.push(block)
    else template.push(elementToAST(el))
  })

  return new Component79(template, scripts, styles)
}

