
import { $, $$, $create, sanitizeHTML } from "./dom"
import { $reactive, untracked, createEffectScope } from "./reactive"
import type { ReactiveDeepData, EffectScope } from "./reactive"
import { transformSetupScript, transformFactoryScript } from "./transform"

export { $, $$, $create } from "./dom"
export { $reactive } from "./reactive"
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
// `scope` - which is what makes dependency tracking in $reactive
// precise instead of "read everything up front". `extras` are passed as
// function parameters (outside the `with`), so scope keys still win but names
// like $event resolve when the scope doesn't shadow them
const evalExpr = (expr: string, scope: Record<string, any>, extras?: Record<string, any>): any => {
  try {
    return new Function("$scope", ...Object.keys(extras ?? {}), `with ($scope) { return (${expr}); }`)(
      scope,
      ...Object.values(extras ?? {})
    )
  } catch {
    return undefined
  }
}

const interpolate = (template: string, scope: Record<string, any>): string =>
  template.replace(/{{\s*(.+?)\s*}}/g, (_, expr) => evalExpr(expr, scope) ?? "")


const CONTROL_ATTRS = new Set([":attrs", ":if", ":elseif", ":else", ":each", ":key", ":with", ":text", ":html"])
const EACH_PATTERN = /^\s*(\w+)\s+in\s+(.+)$/

type ConditionalBranch = { expr?: string; node: TemplateNode }


// @event attributes: @click="onClick", @submit.prevent="$event => onSubmit($event)",
// or an inline statement like @click="count = count + 1". The expression is
// evaluated (with `$event` in scope) on every event; if it yields a function,
// that function is then invoked with the event - so both a handler reference
// and an inline arrow/statement work. Modifiers after dots: .prevent .stop
// .self (runtime guards) and .once .capture (addEventListener options)
const bindEvent = (el: Element, attr: string, expr: string, scope: Record<string, any>) => {
  const [name, ...modifiers] = attr.slice(1).split(".")
  const mods = new Set(modifiers)

  el.addEventListener(name, event => {
    if (mods.has("self") && event.target !== el) return
    if (mods.has("prevent")) event.preventDefault()
    if (mods.has("stop")) event.stopPropagation()

    const handler = evalExpr(expr, scope, { $event: event })
    if (typeof handler === "function") handler.call(el, event)
  }, { once: mods.has("once"), capture: mods.has("capture") })
}

const kebabToCamel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

// finds the scope variable a template tag refers to. HTML parsing lowercases
// tag names, so <NestedComponent> arrives as "nestedcomponent" and matching is
// case-insensitive with dashes stripped (<nested-component> works too). Only
// PascalCase scope keys participate, so ordinary variables named like real
// elements (title, code, ...) never hijack them
const findComponentKey = (scope: Record<string, any>, tag: string): string | null => {
  const normalized = tag.replace(/-/g, "").toLowerCase()
  for (let obj: any = scope; obj && obj !== Object.prototype; obj = Object.getPrototypeOf(obj)) {
    for (const key of Object.keys(obj)) {
      if (/^[A-Z]/.test(key) && key.replace(/-/g, "").toLowerCase() === normalized) return key
    }
  }
  return null
}

// <MyComponent :user :title="'str'"></MyComponent> - renders a child
// component instance at this position. Props: `:name="expr"` evaluates expr
// in the parent scope (`:name` alone is shorthand for `:name="name"`), plain
// attributes pass through as literal strings, and kebab-case prop names
// become camelCase. Props stay live: a parent effect re-evaluates each
// expression and writes it into the child's store. The component variable is
// reactive too - while it's undefined (e.g. an `await import(...)` still in
// flight) nothing renders, and the child appears when it resolves
const renderNestedComponent = (key: string, node: TemplateNode, scope: Record<string, any>, fx: EffectScope): Node => {
  const anchor = document.createComment(key)
  const wrapper = document.createDocumentFragment()
  wrapper.appendChild(anchor)

  const props: Record<string, string> = {} // prop name -> expression in parent scope
  Object.entries(node.attrs).forEach(([attr, value]) => {
    if (CONTROL_ATTRS.has(attr) || attr.startsWith("@")) return
    if (attr.startsWith(":")) {
      const name = kebabToCamel(attr.slice(1))
      props[name] = value || name
    } else {
      props[kebabToCamel(attr)] = JSON.stringify(value)
    }
  })

  let current: Component79 | null = null
  let currentDef: Component79 | null = null
  let childFx: EffectScope | null = null

  fx.effect(() => {
    const value = evalExpr(key, scope)
    const nextDef = value instanceof Component79 ? value : null
    if (nextDef === currentDef) return

    childFx?.dispose()
    childFx = null
    current?.destroy() // detaches its marker range, removing the child's DOM
    current = null
    currentDef = nextDef
    if (!nextDef) return

    // a fresh instance per usage site: the definition's parsed parts (and
    // pre-resolved modules) are shared, but store/effects/DOM are per instance
    const instance = new Component79({ template: nextDef.template, scripts: nextDef.scripts, styles: nextDef.styles, modules: nextDef.modules })
    const seed = untracked(() =>
      Object.fromEntries(Object.entries(props).map(([name, expr]) => [name, evalExpr(expr, scope)]))
    )
    const holder = document.createDocumentFragment()
    instance.render(seed).mount(holder)
    anchor.parentNode!.insertBefore(holder, anchor.nextSibling)

    const syncFx = createEffectScope(scope)
    Object.entries(props).forEach(([name, expr]) => {
      syncFx.effect(() => { (instance.data as Record<string, any>)[name] = evalExpr(expr, scope) })
    })

    childFx = syncFx
    current = instance
  })

  fx.onDispose(() => {
    childFx?.dispose()
    current?.destroy()
  })

  return wrapper
}

// :with="expr" narrows the scope for an element and its subtree: names
// resolve against the expression's value first, then fall back to the outer
// scope. The value is re-evaluated lazily on every name lookup (never
// snapshotted), so an effect reading through this proxy tracks both the
// expression's own dependencies and the property it reads - replacing the
// object or mutating one of its properties re-renders exactly the dependents,
// without rebuilding the subtree. Assignments to names the object owns write
// through to it (reactively, if it came from a store); everything else
// behaves as if the :with weren't there
const createWithScope = (expr: string, scope: Record<string, any>): Record<string, any> => {
  const source = (): Record<string, any> | null => {
    const value = evalExpr(expr, scope)
    return value !== null && typeof value === "object" ? value : null
  }
  return new Proxy(scope, {
    has(target, key) {
      const obj = source()
      return (obj !== null && Reflect.has(obj, key)) || Reflect.has(target, key)
    },
    get(target, key) {
      const obj = source()
      if (obj !== null && Reflect.has(obj, key)) return obj[key as string]
      return Reflect.get(target, key)
    },
    set(target, key, value) {
      const obj = source()
      if (obj !== null && Reflect.has(obj, key)) {
        obj[key as string] = value
        return true
      }
      return Reflect.set(target, key, value)
    },
  })
}

// renders a single element node: static attrs, @event listeners, a reactive
// :attrs object, and its content - :text/:html override the element's own
// children with a reactive textContent/innerHTML, otherwise children render
// normally. :if/:elseif/:else/:each are handled by renderNodes, which decides
// *whether*/*how many times* a node is rendered before calling this. Tags
// matching a PascalCase scope variable render as nested components instead
const renderNode = (node: TemplateNode, outerScope: Record<string, any>, fx: EffectScope): Node => {
  // :with applies to the element's own bindings (@events, :attrs) and its
  // whole subtree. On a :each element the item scope is already in place, so
  // :with="item" works
  const withExpr = node.attrs[":with"]
  const scope = withExpr !== undefined ? createWithScope(withExpr, outerScope) : outerScope

  const componentKey = findComponentKey(scope, node.tag)
  if (componentKey) return renderNestedComponent(componentKey, node, scope, fx)

  const el = document.createElement(node.tag)

  // a tag that isn't standard HTML but has no matching scope key *yet* may be
  // a component that arrives later (e.g. an async factory script exposing an
  // imported component after `await`). Watch for the key: the effect tracks
  // no deps, so it only re-runs on the store's new-key sweep, and swaps the
  // placeholder element for the component exactly once
  if (el instanceof HTMLUnknownElement || node.tag.includes("-")) {
    let upgraded = false
    fx.effect(() => {
      if (upgraded) return
      const key = findComponentKey(scope, node.tag)
      if (!key) return
      upgraded = true
      el.replaceWith(renderNestedComponent(key, node, scope, fx))
    })
  }

  Object.entries(node.attrs).forEach(([key, value]) => {
    if (key.startsWith("@")) bindEvent(el, key, value, scope)
    else if (!CONTROL_ATTRS.has(key)) el.setAttribute(key, value)
  })

  const bindExpr = node.attrs[":attrs"]
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

  // :text="expr" sets textContent reactively, replacing any children.
  // :html="expr" sets innerHTML reactively, sanitizing the value first so
  // untrusted content can't inject scripts/attributes (see sanitizeHTML in
  // ./dom). Both skip rendering the element's own children/interpolation
  const textExpr = node.attrs[":text"]
  const htmlExpr = node.attrs[":html"]
  if (textExpr !== undefined) {
    fx.effect(() => { el.textContent = String(evalExpr(textExpr, scope) ?? "") })
  } else if (htmlExpr !== undefined) {
    fx.effect(() => { el.innerHTML = sanitizeHTML(String(evalExpr(htmlExpr, scope) ?? "")) })
  } else {
    el.appendChild(renderNodes(node.children, scope, fx))
  }

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

type ComponentParts = {
  template: TemplateNode[]
  scripts: TagBlock[]
  styles: TagBlock[]
  // pre-resolved modules for `import(...)` calls in setup scripts, keyed by
  // the literal specifier. Bundlers (the jq79/vite plugin) fill this so
  // imports resolve from the bundle instead of being fetched at runtime
  modules?: Record<string, any>
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

// a self-closing tag with its attributes; quoted attribute values are matched
// as whole chunks so a "/>" inside one doesn't end the tag early
const SELF_CLOSING_RE = /<([A-Za-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\/>/g
const RAW_BLOCK_RE = /(<script[\s\S]*?<\/script\s*>|<style[\s\S]*?<\/style\s*>)/gi

// expands self-closing tags (<MyComponent />, <div />) into explicit
// open+close pairs BEFORE DOM parsing. The HTML parser ignores the slash and
// would treat them as unclosed, swallowing the following siblings. Void
// elements keep their native behavior, and <script>/<style> contents are
// passed through untouched so code inside them is never rewritten
const expandSelfClosingTags = (src: string): string =>
  src
    .split(RAW_BLOCK_RE)
    .map((chunk, i) =>
      i % 2 === 1 // odd chunks are the captured script/style blocks
        ? chunk
        : chunk.replace(SELF_CLOSING_RE, (match, tag: string, attrs: string) =>
            VOID_ELEMENTS.has(tag.toLowerCase()) ? match : `<${tag}${attrs}></${tag}>`
          )
    )
    .join("")

// converts a string of HTML into an AST representation of the component:
// - template: the non-script/style top-level elements, as TemplateNodes
// - scripts/styles: { attrs, content } blocks in source order
const parseComponentString = (component: string): ComponentParts => {
  // example
  // <script :setup="{ fname, lname }">
  //   const fullName = `${fname} ${lname}`
  // </script>
  //
  // <div :attrs="{ fullName }"></div>
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
  const parsedDOM = new DOMParser().parseFromString(`<template>${expandSelfClosingTags(component)}</template>`, "text/html")
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

  return { template, scripts, styles }
}

// loads .html URLs as components, delegating anything else to native import()
const importResource = (url: string): Promise<any> =>
  /\.html?([?#]|$)/.test(url) ? Component79.fetch(url) : import(url)

// document.head styles are shared by content and refcounted, so N instances
// of the same component (e.g. one per :each item) inject a single <style> tag
// that goes away when the last instance is destroyed
const styleRegistry = new Map<string, { el: HTMLStyleElement; count: number }>()

const acquireStyle = (content: string) => {
  let entry = styleRegistry.get(content)
  if (!entry) {
    const el = document.createElement("style")
    el.textContent = content
    document.head.appendChild(el)
    entry = { el, count: 0 }
    styleRegistry.set(content, entry)
  }
  entry.count++
}

const releaseStyle = (content: string) => {
  const entry = styleRegistry.get(content)
  if (entry && --entry.count <= 0) {
    entry.el.remove()
    styleRegistry.delete(content)
  }
}

// library helpers injected into setup scripts. They behave like extra
// globals: a same-named scope property (render data or a top-level
// declaration) shadows them
const SETUP_HELPERS: Record<string, any> = { $, $$, $create, $reactive }

// scripts run inside `with (scriptScope)`, where scriptScope's `has` trap
// claims ownership of every name that is neither a real global, an injected
// library helper, nor one of the internal helpers. This makes `with` route ALL
// other reads/writes through the reactive store - even bare assignments to
// names never declared with let/const, which would otherwise leak onto
// globalThis - while `console`, `Promise`, `fetch`, etc. still resolve
// normally. get/set are deliberately not trapped: they default-forward to
// `scope` (the reactive proxy), preserving tracking and notify.
// The body is wrapped in an async IIFE so top-level `await` works: everything
// up to the first await runs synchronously (before the template renders), and
// later assignments update the DOM reactively when they happen
const runSetupScript = (code: string, scope: Record<string, any>, effect: (run: () => void) => void, instanceHelpers: Record<string, any> = {}, importer: (url: string) => Promise<any> = importResource) => {
  // instanceHelpers are per-component-instance additions (e.g. $emit, which
  // is bound to this instance's DOM position)
  const helpers = { ...SETUP_HELPERS, ...instanceHelpers }
  const scriptScope = new Proxy(scope, {
    has: (target, key) =>
      key !== "$__effect" && key !== "$__import" &&
      (Reflect.has(target, key) || !(key in globalThis) && !(key in helpers)),
  })
  const result: Promise<void> = new Function(
    "$scope", "$__effect", "$__import", ...Object.keys(helpers),
    `return (async () => { with ($scope) { ${code} } })()`
  )(scriptScope, effect, importer, ...Object.values(helpers))
  result.catch(error => console.error("jq79: error in :setup script", error))
}

// default-import interop for factory scripts: real modules expose .default,
// while importing an .html component resolves to the Component79 itself
const interopDefault = (mod: any) => (mod && mod.default !== undefined ? mod.default : mod)

// runs a factory script: the (rewritten) module body executes in plain
// lexical strict-mode scope - no `with`, no implicit reactivity - with the
// library helpers as parameters, then the default export is called with the
// instance context and a returned object is merged into the store. A fully
// synchronous body invokes the factory before the first render, matching
// setup-script timing; bodies with top-level await (static imports included)
// resolve later and the template updates reactively
const runFactoryScript = (code: string, scope: Record<string, any>, effect: (run: () => void) => void, instanceHelpers: Record<string, any> = {}, importer: (url: string) => Promise<any> = importResource) => {
  const helpers = { ...SETUP_HELPERS, ...instanceHelpers }
  const $__exports: { default?: (ctx: Record<string, any>) => any; done?: boolean } = {}
  const result: Promise<void> = new Function(
    "$__exports", "$__default", "$__import", ...Object.keys(helpers),
    `return (async () => { "use strict";\n${code}\n;$__exports.done = true })()`
  )($__exports, interopDefault, importer, ...Object.values(helpers))

  const logError = (error: any) => console.error("jq79: error in factory script", error)
  let invoked = false
  const invoke = () => {
    if (invoked) return
    invoked = true
    const factory = $__exports.default
    if (typeof factory !== "function") return
    const merge = (bindings: any) => {
      if (bindings && typeof bindings === "object") Object.assign(scope, bindings)
    }
    const returned = factory({ $data: scope, $effect: effect, ...instanceHelpers })
    if (returned instanceof Promise) returned.then(merge).catch(logError)
    else merge(returned)
  }

  result.then(invoke, logError)
  if ($__exports.done) invoke() // fully-sync body: factory runs before first render
}

type EmitListener = (event: CustomEvent, payload: any) => void

// a parsed single-file component. Typical lifecycle:
//
//   const jq79 = new Component79(src)   // or await Component79.fetch(url)
//   jq79.on("submit", (e, payload) => {}) // hear this instance's $emit events
//   jq79.mount("#app", { user })        // render (reactive DOM, scripts, styles) + attach
//   ...                                 // (mountShadow mounts into a shadow root)
//   jq79.detach()                       // detach, keeping state - mount() re-attaches
//      .destroy()                      // dispose effects and remove styles
export class Component79 {
  template: TemplateNode[]
  scripts: TagBlock[]
  styles: TagBlock[]
  // pre-resolved modules for setup-script `import(...)` calls (see
  // ComponentParts.modules); checked before falling back to fetch/import
  modules?: Record<string, any>

  data: ReactiveDeepData<Record<string, any>> | null = null

  private fx: EffectScope | null = null
  // holds the rendered nodes while detached; anchors keep this fragment as
  // their parentNode, so effects keep the (detached) DOM up to date and a
  // later mount() shows current state
  private content: DocumentFragment | null = null
  // markers bracketing the component's output so detach() can collect nodes
  // that :if/:each inserted next to the anchors after mounting
  private startMarker: Comment | null = null
  private endMarker: Comment | null = null
  // shadow rendering keeps per-instance <style> elements; head rendering goes
  // through the shared refcounted styleRegistry instead
  private styleEls: HTMLStyleElement[] = []
  private ownsSharedStyles = false
  private useShadow = false
  private mountRoot: Element | ShadowRoot | DocumentFragment | null = null
  // settles the $mounted() promise handed to this render generation's scripts
  private resolveMounted: (() => void) | null = null
  // instance-level listeners for $emit events, registered with on(). Kept
  // outside the render generation so they survive re-render and destroy()
  private emitListeners = new Map<string, Set<EmitListener>>()

  constructor(src: string | ComponentParts, options: { modules?: Record<string, any> } = {}) {
    const parts = typeof src === "string" ? parseComponentString(src) : src
    this.template = parts.template
    this.scripts = parts.scripts
    this.styles = parts.styles
    this.modules = options.modules ?? (typeof src === "string" ? undefined : src.modules)
  }

  static async fetch(url: string): Promise<Component79> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`failed to fetch component from ${url}: ${response.status}`)
    return new Component79(await response.text())
  }

  // subscribes to this instance's $emit events, on top of the DOM CustomEvent
  // dispatch - so it hears emits even while the component is detached (where
  // the event has no ancestors to bubble to). Chainable; can be called before
  // render()
  on(eventName: string, listener: EmitListener): this {
    if (!this.emitListeners.has(eventName)) this.emitListeners.set(eventName, new Set())
    this.emitListeners.get(eventName)!.add(listener)
    return this
  }

  off(eventName: string, listener: EmitListener): this {
    this.emitListeners.get(eventName)?.delete(listener)
    return this
  }

  render(data: Record<string, any> = {}): this {
    return this.renderWith(data, false)
  }

  // like render(), but styles are injected into a shadow root attached to the
  // mount target instead of document.head, so they don't leak globally
  renderShadow(data: Record<string, any> = {}): this {
    return this.renderWith(data, true)
  }

  private renderWith(data: Record<string, any>, shadow: boolean): this {
    this.destroy()

    const store = $reactive({ ...data })
    const fx = createEffectScope(store)
    this.data = store
    this.fx = fx
    this.useShadow = shadow

    this.startMarker = document.createComment("jq79")
    this.endMarker = document.createComment("/jq79")

    // $emit dispatches a bubbling CustomEvent from this instance's start
    // marker, so once mounted it travels up the real DOM and parents can
    // listen on any ancestor (or with @event-name on a wrapping element).
    // Captures the marker rather than `this` so a later re-render's scripts
    // can't dispatch from the wrong generation - the same guard keeps stale
    // generations from reaching the instance's on() listeners
    const marker = this.startMarker
    const $emit = (eventName: string, payload?: any): boolean => {
      const event = new CustomEvent(eventName, { detail: payload, bubbles: true, composed: true })
      const result = marker.dispatchEvent(event)
      if (marker === this.startMarker) {
        this.emitListeners.get(eventName)?.forEach(listener => listener(event, payload))
      }
      return result
    }

    // `await $mounted()` suspends a setup script until mount() attaches the
    // component, so code below it can querySelector its own DOM. Resumption
    // is a microtask, so in the usual synchronous render().mount() flow the
    // whole tree (nested components included) is in the document before the
    // script continues. If this instance is never mounted, the promise stays
    // pending and the script's tail never runs
    let resolveMounted!: () => void
    const mounted = new Promise<void>(resolve => { resolveMounted = resolve })
    this.resolveMounted = resolveMounted
    const $mounted = () => mounted

    // $self / $$self mirror $ / $$ but only search this instance's own
    // output: the sibling nodes between its markers. They work detached too
    // (the holding fragment keeps markers and rendered nodes as siblings),
    // though the template renders after the scripts run, so they only find
    // something from post-await code or callbacks
    const endMarker = this.endMarker
    const $$self = (selector: string): Element[] => {
      const found: Element[] = []
      for (let node: Node | null = marker.nextSibling; node && node !== endMarker; node = node.nextSibling) {
        if (node instanceof Element) {
          if (node.matches(selector)) found.push(node)
          found.push(...Array.from(node.querySelectorAll(selector)))
        }
      }
      return found
    }
    const $self = (selector: string): Element | null => $$self(selector)[0] ?? null

    // import() calls whose specifier was pre-resolved by a bundler (the
    // modules map) get the bundled module; everything else falls back to the
    // runtime importResource (fetch for .html, native import otherwise)
    const modules = this.modules
    const $import = (url: string): Promise<any> =>
      modules && url in modules ? Promise.resolve(modules[url]) : importResource(url)

    // scripts run before the template renders so `$:` values are initialized;
    // a `:mounted` script defers entirely until mount() instead. A top-level
    // `export default` switches the script to factory mode (plain lexical JS)
    this.scripts.forEach(script => {
      const instanceHelpers = { $emit, $mounted, $self, $$self }
      const factoryCode = transformFactoryScript(script.content)
      if (factoryCode !== null) {
        const body = ":mounted" in script.attrs ? `await $mounted();\n${factoryCode}` : factoryCode
        runFactoryScript(body, store, fx.effect, instanceHelpers, $import)
        return
      }
      const { vars, code } = transformSetupScript(script.content)
      // pre-declare script vars on the store so `with` resolves assignments
      // to them (and reads of them) through the reactive proxy
      vars.forEach(name => { if (!(name in store)) (store as any)[name] = undefined })
      const body = ":mounted" in script.attrs ? `await $mounted();\n${code}` : code
      runSetupScript(body, store, fx.effect, instanceHelpers, $import)
    })

    const content = document.createDocumentFragment()
    content.append(this.startMarker, renderNodes(this.template, store, fx), this.endMarker)
    this.content = content

    if (shadow) {
      this.styleEls = this.styles.map(style => {
        const el = document.createElement("style")
        el.textContent = style.content
        return el
      })
    } else {
      this.styles.forEach(style => acquireStyle(style.content))
      this.ownsSharedStyles = true
    }

    return this
  }

  // renders (when needed) and attaches in one call: the component is rendered
  // on the first mount, and re-rendered fresh whenever `data` is passed.
  // mount(el) on an already-rendered component just re-attaches, keeping its
  // state - the detach()/mount() round trip. Rendering here keeps whichever
  // style mode was last used (document.head unless renderShadow/mountShadow
  // chose a shadow root)
  mount(parent: Element | ShadowRoot | DocumentFragment | string, data?: Record<string, any>): this {
    const target = typeof parent === "string" ? $(parent) : parent
    if (!target) throw new Error(`mount target not found: ${parent}`)
    if (!this.content || data !== undefined) this.renderWith(data ?? {}, this.useShadow)
    return this.attach(target)
  }

  // like mount(), but renders with styles scoped to a shadow root on the
  // target instead of document.head
  mountShadow(parent: Element | ShadowRoot | DocumentFragment | string, data?: Record<string, any>): this {
    const target = typeof parent === "string" ? $(parent) : parent
    if (!target) throw new Error(`mount target not found: ${parent}`)
    if (!this.content || data !== undefined || !this.useShadow) this.renderWith(data ?? {}, true)
    return this.attach(target)
  }

  private attach(target: Element | ShadowRoot | DocumentFragment): this {
    if (this.mountRoot) this.detach()

    const root = this.useShadow && target instanceof Element
      ? target.shadowRoot ?? target.attachShadow({ mode: "open" })
      : target
    if (this.useShadow) this.styleEls.forEach(el => root.appendChild(el))
    root.appendChild(this.content!)
    this.mountRoot = root
    this.resolveMounted?.()
    return this
  }

  // detaches from the DOM while keeping all state; a later mount() re-attaches
  // with any updates that happened while detached already applied
  detach(): this {
    if (!this.mountRoot || !this.content || !this.startMarker || !this.endMarker) return this

    // move everything between the markers (inclusive) back into the holding
    // fragment - including nodes :if/:each inserted after mounting
    let node: Node | null = this.startMarker
    while (node) {
      const nextNode: Node | null = node.nextSibling
      this.content.appendChild(node)
      if (node === this.endMarker) break
      node = nextNode
    }

    this.mountRoot = null
    return this
  }

  destroy(): this {
    this.detach()
    this.fx?.dispose()
    this.fx = null
    this.styleEls.forEach(el => el.parentNode?.removeChild(el))
    this.styleEls = []
    if (this.ownsSharedStyles) {
      this.styles.forEach(style => releaseStyle(style.content))
      this.ownsSharedStyles = false
    }
    this.content = null
    this.startMarker = null
    this.endMarker = null
    this.data = null
    this.resolveMounted = null
    return this
  }
}

export const parseComponent = (component: string): Component79 => new Component79(component)

