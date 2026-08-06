
import { $, $$, $create, sanitizeHTML, allowedHosts } from "./dom"
import type { AllowUrl } from "./dom"
import { $reactive, untracked, createEffectScope, ALSO_WAKEN_BY } from "./reactive"
import type { ReactiveDeepData, EffectScope } from "./reactive"
import { transformSetupScript, transformFactoryScript, parsePropsPattern, parseFactoryProps, type PropDecl } from "./transform"

export { $, $$, $create } from "./dom"
export { $reactive } from "./reactive"

// the package version, substituted at build time (tsup/vitest `define`, read
// from package.json - releases bump it there and nowhere else). The typeof
// guard is what keeps the raw source runnable: tests and any bundler that
// doesn't define it see a bare identifier, not a ReferenceError
declare const __JQ79_VERSION__: string
const VERSION = typeof __JQ79_VERSION__ === "string" ? __JQ79_VERSION__ : "0.0.0-dev"

type TemplateNode = {
  tag: string
  attrs: Record<string, string>
  children: (TemplateNode | string)[]
}

type TagBlock = {
  attrs: Record<string, string>
  content: string
  // <style scoped> only: `content` rewritten to require the component's scope
  // attribute. Kept beside the original rather than replacing it, because a
  // shadow root doesn't want it - see headStyle()
  scoped?: string
}

const elementAttrs = (el: Element): Record<string, string> =>
  Object.fromEntries(Array.from(el.attributes).map(attr => [attr.name, attr.value]))

// text is kept verbatim - not trimmed, not dropped when it's only whitespace.
// A template is HTML, so the space in `<span>a</span>\n<span>b</span>` is the
// same space the browser would collapse-and-render between them, and CSS gets
// to decide what it's worth (nothing in a block or flex container, one space
// between inline elements). Trimming it here, as this used to, silently glued
// siblings together and ate the spaces in `hola <b>mundo</b> adios`
//
// A <template>'s children are read from its .content fragment: that is where
// the HTML parser puts them, and its childNodes are empty. Without the descent
// they are not in the AST at all - which is where slot content is written
// (<template :slot.name>), and why a nested <template> used to render as an
// empty element whatever was inside it
const elementToAST = (el: Element): TemplateNode => ({
  tag: el.tagName.toLowerCase(),
  attrs: elementAttrs(el),
  children: Array.from((el instanceof HTMLTemplateElement ? el.content : el).childNodes).flatMap((node): (TemplateNode | string)[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ""
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
//
// Compiled functions are cached: an expression is re-evaluated on every effect
// run - once per interpolation, once per :each item - while the set of distinct
// expressions is fixed by the source. The `extras` names are part of the key,
// not just the expression: they become the function's parameters, so the same
// expression compiled with and without $event is two different functions. A
// syntactically invalid expression caches its failure (null) so it isn't
// recompiled, and rethrown as undefined, exactly as before
const compiled = new Map<string, Function | null>()

const compileExpr = (expr: string, params: string[]): Function | null => {
  const key = `${params.join(",")}|${expr}`
  let fn = compiled.get(key)
  if (fn === undefined) {
    try {
      // the newline before `)` ends a trailing line comment in the
      // expression ({{ msg // greeting }}); ASI doesn't apply inside parens,
      // so everything else is untouched. Without it the comment eats the
      // rest of this single-line body and the expression never compiles
      fn = new Function("$scope", ...params, `with ($scope) { return (${expr}\n); }`)
    } catch {
      fn = null // a syntax error: it will never compile, so don't try again
    }
    compiled.set(key, fn)
  }
  return fn
}

const evalExpr = (expr: string, scope: Record<string, any>, extras?: Record<string, any>): any => {
  const fn = compileExpr(expr, extras ? Object.keys(extras) : [])
  if (!fn) return undefined
  try {
    return fn(scope, ...(extras ? Object.values(extras) : []))
  } catch {
    return undefined
  }
}

// [\s\S] rather than `.` so an expression can span lines, like the ones in
// directive attributes (which reach evalExpr wrapped in parens either way)
const interpolate = (template: string, scope: Record<string, any>): string =>
  template.replace(/{{\s*([\s\S]+?)\s*}}/g, (_, expr) => evalExpr(expr, scope) ?? "")


const CONTROL_ATTRS = new Set([":attrs", ":class", ":value", ":checked", ":selected", ":if", ":elseif", ":else", ":each", ":key", ":with", ":text", ":html", ":html.allowed", ":props"])

// a control attribute is one the static-attr loop and nested-component prop
// collection must skip. The set holds the fixed names; `:class.<name>` (the
// single-flag shorthand) and `:props.<n>` (one spread among several) are
// open-ended, so they're matched by prefix - they can't be enumerated into the set
const isControlAttr = (attr: string): boolean =>
  CONTROL_ATTRS.has(attr) || attr.startsWith(":class.") || attr.startsWith(":props.") ||
  attr === ":slot" || attr.startsWith(":slot.")
// `item in items`, `item, i in items`, `(value, key) in props` - the second
// binding is the array index or the object key, parens optional (Vue-style).
// The list expression can span lines, so it matches [\s\S] rather than `.`
const EACH_PATTERN = /^\s*\(?\s*(\w+)\s*(?:,\s*(\w+))?\s*\)?\s+in\s+([\s\S]+)$/

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

// @event on a component tag: the tag renders as comment anchors, so there is
// no element to listen on - the attribute subscribes to the child instance's
// $emit channel (instance.on) instead, which survives the child's re-renders
// and works detached. Native DOM events from the child's inner DOM never
// arrive here: they bubble past the anchors to shared ancestors (a listener
// on a wrapping element hears those); a child that wants its native event
// heard on its tag re-emits it. .prevent flips the child's $emit() return to
// false, .stop keeps the emit off the DOM dispatch, .once unsubscribes after
// one call; .self and .capture have no meaning on this channel and are ignored
const wireTagEvent = (instance: Component79, attr: string, expr: string, scope: Record<string, any>) => {
  const [name, ...modifiers] = attr.slice(1).split(".")
  const mods = new Set(modifiers)

  const listener = (event: CustomEvent) => {
    if (mods.has("prevent")) event.preventDefault()
    if (mods.has("stop")) event.stopPropagation()
    if (mods.has("once")) instance.off(name, listener)

    // untracked, so a tag handler behaves like an element handler no matter
    // when the emit fires: an element handler never runs inside an effect,
    // but $emit can (a $: that emits, a setup-script emit inside the parent's
    // creation effect), and the handler's reads would land in that effect's
    // deps. Today that is contained - cross-store deps are never notified,
    // and the creation effect's definition guard no-ops a spurious wake - but
    // "what a handler reads is nobody's dependency" shouldn't hinge on either
    untracked(() => {
      const handler = evalExpr(expr, scope, { $event: event })
      if (typeof handler === "function") handler(event)
    })
  }
  instance.on(name, listener)
}

const kebabToCamel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

// the stable boundaries of a rendered chunk. An element is its own handle, but
// a fragment (a nested component: two anchors with the instance's DOM between
// them) empties itself into the parent on insertion - after that its identity
// answers nothing, and what stays put are its first and last children. Callers
// that reposition or remove a chunk later (:each entries, :if branches) must
// capture its bounds *before* inserting it and work on the range
type NodeRange = { first: Node; last: Node }

const boundsOf = (node: Node): NodeRange =>
  node instanceof DocumentFragment
    ? { first: node.firstChild!, last: node.lastChild! }
    : { first: node, last: node }

// removes [first..last] inclusive - the range's content is dynamic (a nested
// component's DOM comes and goes between its anchors), so it walks siblings
// rather than assuming any particular nodes in between
const removeRange = ({ first, last }: NodeRange) => {
  for (let node: Node | null = first; node; ) {
    const next: Node | null = node === last ? null : node.nextSibling
    node.parentNode?.removeChild(node)
    node = next
  }
}

// moves [first..last] inclusive so the range starts right after `prev`
const moveRangeAfter = ({ first, last }: NodeRange, prev: Node) => {
  const ref = prev.nextSibling
  for (let node: Node | null = first; node; ) {
    const next: Node | null = node === last ? null : node.nextSibling
    prev.parentNode!.insertBefore(node, ref)
    node = next
  }
}

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

// how deep a component may nest inside itself before the runtime calls it a
// cycle. Deeper than any real tree, shallower than the JS stack: a truncated
// render with an error on the console beats a stack overflow with none
const MAX_NESTING_DEPTH = 200
let nestingDepth = 0

// ---------------------------------------------------------------------------
// slots - content projection
//
// A component tag's children are content the child renders where it wrote a
// <slot>. The dot marks the named variant on both sides, like :model.<name>
// and :class.<name> already do:
//
//   <!-- Card.html -->        <!-- the parent -->
//   <section>                 <Card>
//     <header>                  <template :slot.header><h2>{{ t }}</h2></template>
//       <slot.header>?</slot.header>
//     </header>                 <p>{{ body }}</p>
//   <slot />                  </Card>
//   </section>
//
// Three rules decide everything below:
//
// 1. Content belongs to the parent - its AST, its scope, its effects, its
//    scoped styles. The child decides *where* it goes and *whether* it goes,
//    never what the names in it mean.
// 2. Slot props are declared, not injected: `:slot="{ item }"` on the usage
//    site, for the same reason :each writes `item in rows`. Every bare name in
//    the parent's file is introduced by the parent, so a `<slot :item>` the
//    child adds later can't silently capture one.
// 3. What isn't projected isn't rendered. No <slot>, or one behind a false
//    :if, and the content's effects never exist.
//
// The content travels as a thunk, not as DOM: an instance is replaced (a
// definition swap, a hot reload) and one <slot> may render many times, so a
// pre-rendered fragment would leak effects and could only be inserted once
// ---------------------------------------------------------------------------

// renders one slot's content at the position the child put the <slot>: it is
// handed the slot's props (lazy, so each read re-evaluates in the child's
// scope), that position's scope and effect scope, and the style mode the
// child renders under
type SlotRenderer = (
  props: Record<string, () => any>,
  slotScope: Record<string, any>,
  fx: EffectScope,
  shadow: boolean
) => Node

type SlotMap = Record<string, SlotRenderer>

// the content an instance was handed, by slot name. Symbol-keyed and
// non-enumerable on the store's data, like UNFILLED_PROPS: it rides the scope
// chain (so a <slot> inside an :each or a :with finds it) and never shows up
// as data - not in Object.keys, not in a snapshot spread, not in the props a
// nested component is handed
const SLOTS = Symbol("jq79.slots")

// <slot>, <slot.header-bar>: the hole and its name. Names are kebab-case where
// written (the HTML parser lowercases tag names and attribute modifiers alike)
// and camelCase where read - <slot.header-bar> is :slot.header-bar is
// $slots.headerBar
const isSlotTag = (tag: string): boolean => tag === "slot" || tag.startsWith("slot.")

const slotName = (suffix: string): string => (suffix ? kebabToCamel(suffix) : "default")

// the content of one slot, as written at the usage site
type SlotContent = { nodes: (TemplateNode | string)[]; binder?: string }

// the :slot attribute of a <template>, if it carries one
const slotAttrOf = (node: TemplateNode): string | undefined =>
  Object.keys(node.attrs).find(attr => attr === ":slot" || attr.startsWith(":slot."))

const slotAttrName = (name: string) => (name === "default" ? ":slot" : `:slot.${name}`)

// whitespace-only text between two <template :slot> blocks is the indentation
// between them and nothing else - the same call renderNodes makes between the
// branches of an :if chain. It is what decides whether a tag has default
// content at all, which is what $slots.default answers
const isMeaningful = (node: TemplateNode | string): boolean => typeof node !== "string" || node.trim() !== ""

// a component tag's children, partitioned by slot name: a direct
// <template :slot.<name>> child fills that name, everything else is the
// default slot's content. The attribute's value is the pattern the content
// binds the slot's props to - on the tag itself for the default, since the
// default content has no <template> of its own to carry it
const partitionSlots = (node: TemplateNode): Record<string, SlotContent> => {
  const contents: Record<string, SlotContent> = {}
  const loose: (TemplateNode | string)[] = []

  node.children.forEach(child => {
    const attr = typeof child === "object" && child.tag === "template" ? slotAttrOf(child) : undefined
    if (typeof child === "string" || attr === undefined) {
      loose.push(child)
      return
    }
    const name = slotName(attr.slice(":slot.".length))
    // first wins, like two <template name="X"> in one file: a duplicate is a
    // typo, and the fix is to delete one - not to guess which
    if (name in contents) {
      console.warn(`jq79: two <template ${slotAttrName(name)}> in <${node.tag}>; the second was ignored`)
      return
    }
    contents[name] = { nodes: child.children, binder: child.attrs[attr] || undefined }
  })

  const hasLoose = loose.some(isMeaningful)
  if (hasLoose && "default" in contents) {
    console.warn(
      `jq79: <${node.tag}> has both a <template :slot> and content outside it - ` +
      "the <template> is the default slot's content, and the rest was ignored"
    )
  } else if (hasLoose) {
    contents.default = { nodes: loose, binder: node.attrs[":slot"] || undefined }
  }
  return contents
}

// `:slot="{ item, index: i, total = 0 }"` - the names the content binds the
// slot's props to. The bindings are accessors, not values: each read
// re-evaluates the child's expression, so an effect that reads `item` tracks
// exactly what that expression touches, on every run (createWithScope's design)
const bindSlotProps = (scope: Record<string, any>, binder: string | undefined, props: Record<string, () => any>) => {
  parsePropsPattern(binder)?.forEach(({ name, as, default: fallback }) => {
    const local = as ?? name
    Object.defineProperty(scope, local, {
      enumerable: true,
      configurable: true,
      get: () => {
        const value = props[name]?.()
        return value === undefined && fallback !== undefined ? evalExpr(fallback, scope) : value
      },
      // a slot prop is the child's value: it arrives on every read and there
      // is nowhere for a write to go. Silence would be worse - `with` swallows
      // an assignment to a getter without a word
      set: () => console.warn(`jq79: "${local}" is a slot prop - it comes from the component, so assigning to it does nothing`),
    })
  })
}

// a <template :slot> only fills a slot as a direct child of a component tag,
// where the usage site takes it out of the children before they are ever
// rendered (see partitionSlots). Anywhere else the position is a mistake, and
// rendering the content in place - in the wrong scope, into a <template>
// nobody clones - would be a strange way to say so. A comment rather than
// nothing: an :if branch needs a node to hold on to (see boundsOf)
const misplacedSlotContent = (node: TemplateNode): Node => {
  const attr = slotAttrOf(node)
  console.warn(`jq79: <template ${attr}> fills a slot only as a direct child of a component tag; here it rendered nothing`)
  return document.createComment(`misplaced ${attr}`)
}

// what a usage site hands its instance: every slot it filled, as the thunk
// that renders it. Built once per site, and in one call - a component tag is
// on the stack while its whole subtree renders below it (a component that
// renders itself does this 200 deep), so the intermediates stay in here rather
// than in the frame that waits
const buildSlots = (node: TemplateNode, scope: Record<string, any>): SlotMap | null => {
  const contents = Object.entries(partitionSlots(node))
  if (!contents.length) return null
  const slots: SlotMap = {}
  contents.forEach(([name, content]) => { slots[name] = makeSlotRenderer(content, scope) })
  return slots
}

// the thunk one slot's content becomes: the usage site closes over its AST and
// its scope, the child calls it wherever (and however many times) it renders
// the matching <slot>
const makeSlotRenderer = (content: SlotContent, parentScope: Record<string, any>): SlotRenderer =>
  (props, slotScope, fx, shadow) => {
    // the parent's scope, plus the names the content declared for the slot's
    // props (rule 1: what the content says is decided where it was written)
    const scope: Record<string, any> = Object.create(parentScope)
    bindSlotProps(scope, content.binder, props)
    // this content reads the parent's store (its own names) and the child's
    // (through the slot props), so every effect created anywhere inside it is
    // registered with both - see ALSO_WAKEN_BY. Appended rather than assigned:
    // content forwarded through a <slot> inside slot content is still woken by
    // the store it came from
    const inherited: Record<string, any>[] = (scope as any)[ALSO_WAKEN_BY] ?? []
    Object.defineProperty(scope, ALSO_WAKEN_BY, { value: [...inherited, slotScope] })

    const contentFx = createEffectScope(scope)
    // rule 3: the <slot> is the content's lifetime. When the child's subtree at
    // this position goes - an :if turning false, the instance being replaced,
    // the whole child being destroyed - the content's effects go with it
    fx.onDispose(() => contentFx.dispose())
    return renderNodes(content.nodes, scope, contentFx, shadow)
  }

// <slot />, <slot.name>fallback</slot.name>: where the parent's content goes.
// Unfilled, the slot renders its own children instead - in this component's
// scope, since that content is this component's. Every attribute that isn't a
// directive is a slot prop: `:item="item"` evaluates here and reaches the
// content under the name it declared, a plain attribute passes a literal
// string, and there are no reserved names (the slot's own name is in the tag).
// Bracketed by anchors like a nested component, so the chunk has stable bounds
// even when it renders nothing (see boundsOf)
const renderSlot = (node: TemplateNode, scope: Record<string, any>, fx: EffectScope, shadow: boolean): Node => {
  const name = slotName(node.tag.slice("slot.".length))
  const wrapper = document.createDocumentFragment()
  const anchor = document.createComment(node.tag)
  const endAnchor = document.createComment(`/${node.tag}`)
  wrapper.append(anchor, endAnchor)

  const render = (scope as any)[SLOTS]?.[name] as SlotRenderer | undefined
  if (!render) {
    wrapper.insertBefore(renderNodes(node.children, scope, fx, shadow), endAnchor)
    return wrapper
  }

  const props: Record<string, () => any> = {}
  Object.entries(node.attrs).forEach(([attr, value]) => {
    // the scope stamp is the component's, not a prop; @events have no element
    // to bind here; and a directive means what it means everywhere else -
    // :if/:each/:with decide whether and how often this slot renders, so they
    // are the renderer's, not the content's
    if (attr === SCOPE_ATTR || isControlAttr(attr) || attr.startsWith("@")) return
    if (attr.startsWith(":")) {
      const expr = value || attr.slice(1)
      props[kebabToCamel(attr.slice(1))] = () => evalExpr(expr, scope)
    } else {
      props[kebabToCamel(attr)] = () => value
    }
  })

  wrapper.insertBefore(render(props, scope, fx, shadow), endAnchor)
  return wrapper
}

// <MyComponent :user :title="'str'"></MyComponent> - renders a child
// component instance at this position. Props: `:name="expr"` evaluates expr
// in the parent scope (`:name` alone is shorthand for `:name="name"`), plain
// attributes pass through as literal strings, and kebab-case prop names
// become camelCase. Props stay live: a parent effect re-evaluates each
// expression and writes it into the child's store. The component variable is
// reactive too - while it's undefined (e.g. an `await import(...)` still in
// flight) nothing renders, and the child appears when it resolves.
// `shadow` is the parent's style mode, carried down the whole render: a child
// of a shadow-rendered component renders inside that shadow root, so its
// <style> has to go in there with it - document.head can't reach into a shadow
// tree, and a style that never applies to its own component would still be
// restyling the page around it
const renderNestedComponent = (key: string, node: TemplateNode, scope: Record<string, any>, fx: EffectScope, shadow: boolean): Node => {
  // two anchors bracketing everything this usage site ever renders: the
  // instance's DOM is dynamic (the definition can resolve late or be swapped),
  // so a caller that needs to move or remove this chunk later can't hold any
  // of it - it holds the anchors, which never move on their own (see boundsOf)
  const anchor = document.createComment(key)
  const endAnchor = document.createComment(`/${key}`)
  const wrapper = document.createDocumentFragment()
  wrapper.append(anchor, endAnchor)

  // the tag's children, as content for the child's <slot>s. Built once per
  // usage site (the AST doesn't change) and closed over the parent's scope
  // here, so every instance this site ever renders is handed the same thunks
  const slots = buildSlots(node, scope)

  const props: Record<string, string> = {} // prop name -> expression in parent scope
  const models: Record<string, string> = {} // model name -> assignable expression in parent scope
  const events: Array<[string, string]> = [] // @attr (modifiers included) -> handler expression
  // named props AND spreads in source order - what a :props merge folds over so
  // precedence follows the JS object-spread rule (later wins). `name` absent
  // marks a spread: the whole object's properties, not one binding
  const sources: Array<{ name?: string; expr: string }> = []
  let hasSpread = false
  Object.entries(node.attrs).forEach(([attr, value]) => {
    // the parent's scope stamp is stamped on every template element, this tag
    // included - it's not a prop, and the child renders under its own scope
    if (attr === SCOPE_ATTR) return
    if (attr === ":props" || attr.startsWith(":props.")) {
      // :props="obj" spreads obj's own properties as props; :props.<n> is one
      // spread among several (the `...obj` sugar rewrites to it - see
      // expandPropsSpread), the suffix only keeping the attribute names distinct
      hasSpread = true
      sources.push({ expr: value })
      return
    }
    if (isControlAttr(attr)) return
    if (attr.startsWith("@")) {
      events.push([attr, value])
    } else if (attr === ":model" || attr.startsWith(":model.")) {
      // :model[.name]="expr" - two-way: a prop down plus a writeback listener
      // (wired below, once the instance exists). The modifier arrives
      // lowercased from the HTML parser, so names are declared kebab-case;
      // the bare :model binds the name "default"
      const name = attr === ":model" ? "default" : kebabToCamel(attr.slice(":model.".length))
      models[name] = value || (attr === ":model" ? "model" : name)
    } else if (attr.startsWith(":")) {
      const name = kebabToCamel(attr.slice(1))
      props[name] = value || name
      sources.push({ name, expr: value || name })
    } else {
      const name = kebabToCamel(attr)
      const expr = JSON.stringify(value)
      props[name] = expr
      sources.push({ name, expr })
    }
  })

  // each model is also a prop down: the child reads the value under the
  // model's name - `model` for the default, because a prop named `default`
  // could never be read from a child expression (reserved word). Without the
  // prop this isn't two-way, it's upward collection: a parent reset or an
  // initial value would never reach the child
  const modelAttr = (name: string) => (name === "default" ? ":model" : `:model.${name}`)
  const modelProp = (name: string) => (name === "default" ? "model" : name)
  // the newline keeps `= $value` out of a trailing line comment in the
  // expression (:model="uname // the username") - glued on the same line,
  // the assignment would vanish into the comment and compile as a bare read,
  // dropping every update without a word
  const assignment = (expr: string) => `${expr}\n= $value`
  Object.entries(models).forEach(([name, expr]) => {
    const prop = modelProp(name)
    if (props[prop] !== undefined) {
      console.warn(`jq79: <${node.tag}> binds prop "${prop}" through both :${prop} and ${modelAttr(name)} - ${modelAttr(name)} wins`)
    }
    props[prop] = expr
    // an expression that can't be an assignment target is a wiring mistake -
    // say so now, not on the first update that silently goes nowhere
    if (compileExpr(assignment(expr), ["$value"]) === null) {
      console.warn(`jq79: ${modelAttr(name)}="${expr}" is not assignable - updates from <${node.tag}> will be dropped`)
    }
  })

  // the full prop set the child gets, resolved in source order: each named prop
  // sets one key, each spread merges an object's own properties, later sources
  // overwriting earlier (the JS object-spread rule). :model bindings apply last,
  // so they win - the same precedence the collision warning above promises. A
  // spread expression that isn't an object contributes nothing (fail closed,
  // like :with), so an `await`-pending object spreads once it resolves
  const resolveProps = (): Record<string, any> => {
    const out: Record<string, any> = {}
    sources.forEach(({ name, expr }) => {
      if (name !== undefined) out[name] = evalExpr(expr, scope)
      else {
        const obj = evalExpr(expr, scope)
        if (obj !== null && typeof obj === "object") Object.assign(out, obj)
      }
    })
    Object.entries(models).forEach(([name, expr]) => { out[modelProp(name)] = evalExpr(expr, scope) })
    return out
  }

  let current: Component79 | null = null
  let currentDef: Component79 | null = null
  let childFx: EffectScope | null = null

  // a usage site that resolves to no component renders nothing, which is
  // deliberate - `undefined` while an `await import(...)` is in flight has to
  // wait quietly, and the child appears when it lands. Two cases can never
  // resolve, though, and both are wiring mistakes worth naming: a value that
  // isn't a component (and so will never become one by waiting), and a name
  // the component declared as a prop that the parent passed nothing for. Once
  // each, per usage site: an effect re-runs
  const reported = new Set<string>()
  const reportUnresolved = (value: any) => {
    if (value === undefined || value === null) {
      const unfilled: Set<string> | undefined = (scope as any)[UNFILLED_PROPS]
      if (!unfilled?.has(key) || reported.has("unfilled")) return
      reported.add("unfilled")
      console.error(
        `jq79: <${node.tag}> is declared as a prop and the parent passed nothing - nothing renders here. ` +
        `Pass it (:${key}="…"), or drop it from the signature to use the one declared in this file.`
      )
      return
    }
    if (reported.has("type")) return
    reported.add("type")
    console.error(`jq79: <${node.tag}> is ${typeof value}, not a component - nothing renders here`)
  }

  fx.effect(() => {
    const value = evalExpr(key, scope)
    const nextDef = value instanceof Component79 ? value : null
    if (!nextDef) reportUnresolved(value)
    if (nextDef === currentDef) return

    childFx?.dispose()
    childFx = null
    current?.destroy() // detaches its marker range, removing the child's DOM
    current = null
    currentDef = nextDef
    if (!nextDef) return

    // a fresh instance per usage site: the definition's parsed parts (and
    // pre-resolved modules) are shared, but store/effects/DOM are per instance
    const instance = new Component79({
      template: nextDef.template,
      scripts: nextDef.scripts,
      styles: nextDef.styles,
      modules: nextDef.modules,
      filename: nextDef.filename,
      // its file's other components, and which of them it is: without the
      // first a child rendered here loses the siblings its definition could
      // see, and without the second hot reload can't tell it what it is
      siblings: nextDef.siblings,
      name: nextDef.name,
    })
    // the content this site wrote inside the tag, before the first render: a
    // <slot> is resolved while rendering, so the map has to be there by then
    if (slots) instance.slots = slots
    // the writeback half of :model - one event, one contract. The name is
    // normalized like the attribute was (kebab->camel; absent means default),
    // and everything off-contract warns and does nothing: an event protocol's
    // failure mode has to be loud, or a typo'd name is an input that types
    // into the void
    if (Object.keys(models).length) {
      // each mistake is warned once per instance, not once per keystroke: an
      // input emitting a typo'd name would otherwise flood the console on
      // every character typed into it
      const warned = new Set<string>()
      const warnOnce = (key: string, message: string) => {
        if (warned.has(key)) return
        warned.add(key)
        console.warn(message)
      }
      instance.on("model:update", (_event, payload) => {
        if (payload === null || typeof payload !== "object") {
          warnOnce("payload", `jq79: model:update expects a { name?, value } payload, got ${payload === null ? "null" : typeof payload}`)
          return
        }
        const name = payload.name == null ? "default" : kebabToCamel(String(payload.name))
        const expr = models[name]
        if (expr === undefined) {
          warnOnce(name, `jq79: <${node.tag}> has no ${modelAttr(name)} - bound: ${Object.keys(models).map(modelAttr).join(", ")}`)
          return
        }
        // untracked, like the tag handlers: a child emitting from its setup
        // script runs inside the parent's *creation* effect, and the reads a
        // path assignment makes (`user` in `user.name = $value`) would land
        // in its deps - donating that effect one wasted (guard-stopped) wake
        // per later write. An imperative writeback is nobody's dependency
        untracked(() => evalExpr(assignment(expr), scope, { $value: payload.value }))
      })
    }

    // @event on the tag listens to this instance's $emit channel (and only
    // this instance's - a grandchild's emit arrives here solely as an
    // explicit re-emit)
    events.forEach(([attr, expr]) => wireTagEvent(instance, attr, expr, scope))

    const seed = untracked(resolveProps)
    // mounting into a fragment attaches no shadow root of its own: a
    // shadow-rendered child keeps its <style> elements inline, next to the DOM
    // they style, and the parent's shadow root is what scopes both
    const holder = document.createDocumentFragment()
    // rendering a child happens on this same stack, so a component that
    // renders itself recurses as deep as its data does - and a cycle in that
    // data would recurse until the JS stack gave out, ~900 identical frames
    // naming nothing. Cut and named instead, exactly like the effect runner
    // cuts an effect that wakes itself
    if (nestingDepth >= MAX_NESTING_DEPTH) {
      console.error(
        `jq79: <${node.tag}> is ${MAX_NESTING_DEPTH} levels deep inside itself; giving up here. ` +
        "A component that renders itself stops when its data stops - is there a cycle in it?"
      )
      return
    }
    nestingDepth++
    try {
      ;(shadow ? instance.renderShadow(seed) : instance.render(seed)).mount(holder)
    } finally {
      nestingDepth--
    }
    endAnchor.parentNode!.insertBefore(holder, endAnchor)

    const syncFx = createEffectScope(scope)
    // without a spread the prop set is fixed and known: one effect per prop, so
    // a change to one prop re-syncs only that prop. A spread's key set is
    // dynamic and its precedence is positional, so it can't be resolved a key at
    // a time across independent effects (whichever re-ran last would win) - one
    // effect re-merges everything in order and writes the diff, clearing keys a
    // spread has dropped since last run. Named props are always in the merge, so
    // they're never cleared; the extra cost is confined to spread-using tags
    if (hasSpread) {
      let written: string[] = []
      syncFx.effect(() => {
        const next = resolveProps()
        const nextKeys = Object.keys(next)
        written.forEach(key => { if (!(key in next)) (instance.data as Record<string, any>)[key] = undefined })
        nextKeys.forEach(key => { (instance.data as Record<string, any>)[key] = next[key] })
        written = nextKeys
      })
    } else {
      Object.entries(props).forEach(([name, expr]) => {
        syncFx.effect(() => { (instance.data as Record<string, any>)[name] = evalExpr(expr, scope) })
      })
    }

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

// what :class accepts, flattened to single class tokens: a string of
// space-separated names, an array (entries normalized recursively), or an
// object whose truthy-valued keys are the names (a key may itself hold
// several). Everything else - null, false, numbers - contributes nothing, so
// `cond && 'active'` reads naturally. The object form reads each value, so a
// store-backed flag is tracked per key
const classNames = (value: any): string[] => {
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean)
  if (Array.isArray(value)) return value.flatMap(classNames)
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([name, on]) => (on ? classNames(name) : []))
  return []
}

// what :html.allowed accepts, normalized to an AllowUrl predicate: host
// patterns (a comma-separated string or an array - see allowedHosts in
// ./dom) or a function (url: URL, tag, attr) => boolean. Anything else -
// including a policy expression that evaluates to undefined - denies every
// destination: the attribute declares the intent to restrict, so a broken
// policy fails closed, and so does a predicate that throws
const normalizeAllowUrl = (policy: any): AllowUrl => {
  if (typeof policy === "function") {
    return (url, tag, attr) => {
      try {
        return !!policy(url, tag, attr)
      } catch {
        return false
      }
    }
  }
  if (typeof policy === "string" || Array.isArray(policy)) return allowedHosts(policy)
  return () => false
}

// renders a single element node: static attrs, @event listeners, a reactive
// :attrs object, and its content - :text/:html override the element's own
// children with a reactive textContent/innerHTML, otherwise children render
// normally. :if/:elseif/:else/:each are handled by renderNodes, which decides
// *whether*/*how many times* a node is rendered before calling this. Tags
// matching a PascalCase scope variable render as nested components instead
const renderNode = (node: TemplateNode, outerScope: Record<string, any>, fx: EffectScope, shadow: boolean): Node => {
  // :with applies to the element's own bindings (@events, :attrs) and its
  // whole subtree. On a :each element the item scope is already in place, so
  // :with="item" works
  const withExpr = node.attrs[":with"]
  const scope = withExpr !== undefined ? createWithScope(withExpr, outerScope) : outerScope

  // before the component-key scan, so <slot> is <slot> even in a file that
  // happens to have a component named Slot in scope: the tag is the library's
  // now, and a name that resolved it away would be a very quiet surprise
  if (isSlotTag(node.tag)) return renderSlot(node, scope, fx, shadow)
  if (node.tag === "template" && slotAttrOf(node) !== undefined) return misplacedSlotContent(node)

  const componentKey = findComponentKey(scope, node.tag)
  if (componentKey) return renderNestedComponent(componentKey, node, scope, fx, shadow)

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
      const replacement = renderNestedComponent(key, node, scope, fx, shadow)
      // whoever tears this subtree down holds `el`, which the swap detaches -
      // so the component's anchors must remove themselves when the scope goes
      const range = boundsOf(replacement)
      fx.onDispose(() => removeRange(range))
      el.replaceWith(replacement)
    })
  }

  Object.entries(node.attrs).forEach(([key, value]) => {
    if (key.startsWith("@")) bindEvent(el, key, value, scope)
    else if (key === ":model" || key.startsWith(":model.")) {
      // :model binds component tags only (see TODOS/2026-07-15.model-directive.md;
      // the native-element form is parked there). Warn on a real element, but
      // not on a tag that may still upgrade into a component - the upgrade
      // re-renders through renderNestedComponent, models and all
      if (!(el instanceof HTMLUnknownElement || node.tag.includes("-"))) {
        console.warn(`jq79: ${key} on <${node.tag}> does nothing - :model binds component tags only (for now)`)
      }
    } else if (!isControlAttr(key)) el.setAttribute(key, value)
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

  // :class="expr" adds classes on top of the static `class` attribute, and
  // :class.<name>="expr" is the single-flag shorthand for `{ <name>: expr }`
  // (the name routed through classNames, so an empty `:class.` can't reach
  // classList.add, which throws on ""). Both feed one effect and one set of
  // added classes: only classes this binding added are ever removed, so the
  // static list survives every re-run, even when the expression names one of
  // its classes and then drops it (class="btn" :class="{ btn: cond }" keeps
  // btn on false)
  const classExpr = node.attrs[":class"]
  const classToggles = Object.entries(node.attrs)
    .filter(([key]) => key.startsWith(":class."))
    .map(([key, expr]): [string, string] => [key.slice(":class.".length), expr])
  if (classExpr !== undefined || classToggles.length) {
    const staticClasses = new Set(classNames(node.attrs.class ?? ""))
    let bound: string[] = []

    fx.effect(() => {
      const next = classExpr !== undefined ? classNames(evalExpr(classExpr, scope)) : []
      classToggles.forEach(([name, expr]) => {
        if (evalExpr(expr, scope)) next.push(...classNames(name))
      })
      bound.forEach(name => {
        if (!next.includes(name) && !staticClasses.has(name)) el.classList.remove(name)
      })
      el.classList.add(...next)
      bound = next
    })
  }

  // :text="expr" sets textContent reactively, replacing any children.
  // :html="expr" sets innerHTML reactively, sanitizing the value first so
  // untrusted content can't inject scripts/attributes (see sanitizeHTML in
  // ./dom). Both skip rendering the element's own children/interpolation.
  // :html.allowed="expr" adds a destination policy for the content's
  // href/src URLs - evaluated in the same effect, so a policy held in the
  // store is as reactive as the content itself
  const textExpr = node.attrs[":text"]
  const htmlExpr = node.attrs[":html"]
  const allowedExpr = node.attrs[":html.allowed"]
  if (allowedExpr !== undefined && htmlExpr === undefined) {
    console.warn("jq79: :html.allowed without :html on the same element does nothing")
  }
  if (textExpr !== undefined) {
    fx.effect(() => { el.textContent = String(evalExpr(textExpr, scope) ?? "") })
  } else if (htmlExpr !== undefined) {
    fx.effect(() => {
      const options = allowedExpr !== undefined ? { allowUrl: normalizeAllowUrl(evalExpr(allowedExpr, scope)) } : undefined
      el.innerHTML = sanitizeHTML(String(evalExpr(htmlExpr, scope) ?? ""), options)
    })
  } else if (el instanceof HTMLTemplateElement) {
    // a plain nested <template> stays what HTML says it is: an inert element
    // whose children live in .content, which is where whoever clones it looks
    // for them. They render (bindings and all) and go there - appended as
    // childNodes they would be in the DOM but in no document fragment, seen by
    // nothing and rendered by nobody
    el.content.appendChild(renderNodes(node.children, scope, fx, shadow))
  } else {
    el.appendChild(renderNodes(node.children, scope, fx, shadow))
  }

  // :value / :checked / :selected write the DOM *property*, not the
  // attribute - the attribute is only a form control's default, and detaches
  // the moment the user interacts (which is why :attrs="{ value }" stops
  // driving a typed-in input). One-way, store -> DOM: the way back stays an
  // explicit @input/@change. :value skips the write when the property
  // already holds the string, so an unrelated re-run can't move the caret of
  // the input the user is typing into. Registered after the children render:
  // :value on a <select> can only pick an <option> that already exists
  const valueExpr = node.attrs[":value"]
  if (valueExpr !== undefined) {
    fx.effect(() => {
      const value = String(evalExpr(valueExpr, scope) ?? "")
      if ((el as HTMLInputElement).value !== value) (el as HTMLInputElement).value = value
    })
  }
  ;([":checked", ":selected"] as const).forEach(attr => {
    const expr = node.attrs[attr]
    if (expr === undefined) return
    const prop = attr.slice(1) as "checked" | "selected"
    fx.effect(() => { (el as any)[prop] = !!evalExpr(expr, scope) })
  })

  return el
}

// a :if/:elseif*/:else? chain sharing one anchor comment so the active branch
// can be swapped in place without disturbing sibling positions. Only depends
// on whatever the branch expressions read (e.g. "score"), and skips
// rebuilding entirely when the active branch hasn't actually changed
const renderConditional = (branches: ConditionalBranch[], scope: Record<string, any>, fx: EffectScope, shadow: boolean): Node => {
  const anchor = document.createComment("if")
  const wrapper = document.createDocumentFragment()
  wrapper.appendChild(anchor)

  let current: NodeRange | null = null
  let activeBranch: ConditionalBranch | null = null
  let branchFx: EffectScope | null = null

  fx.effect(() => {
    const next = branches.find(branch => branch.expr === undefined || evalExpr(branch.expr, scope)) ?? null
    if (next === activeBranch) return

    branchFx?.dispose()
    if (current) removeRange(current)
    current = null
    activeBranch = next
    if (!next) return

    branchFx = createEffectScope(scope)
    // bounds captured before inserting: a component branch is a fragment, and
    // inserting it is what empties it (see boundsOf)
    const rendered = renderNode(next.node, scope, branchFx, shadow)
    current = boundsOf(rendered)
    anchor.parentNode!.insertBefore(rendered, anchor.nextSibling)
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

type EachEntry = { key: any; item: any; scope: Record<string, any>; range: NodeRange; fx: EffectScope }

// what :each iterates besides arrays: dictionaries, as their entries. Class
// instances, Maps and the rest stay out - the store doesn't wrap them
// (isPlainData), so their contents wouldn't be tracked and the list would go
// silently stale
const isPlainObject = (value: any): value is Record<string, any> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// :each="item in items" (or "item, i in items" / "(value, key) in props"),
// optionally keyed with :key="expr". Only depends on what the list expression
// reads, and on each run diffs by key: unchanged items (same key, same item
// reference) keep their DOM/effects, changed/added ones are (re)rendered,
// removed ones are disposed. Without :key, an array uses position - fine for
// append-only lists, wasteful for reordering - and an object uses the
// property key, which is already the stable identity. Each item gets its own
// scope via Object.create(scope), so the bindings and `$index` shadow
// same-named outer names without copying the parent scope's keys
const renderEach = (node: TemplateNode, scope: Record<string, any>, fx: EffectScope, shadow: boolean): Node => {
  const match = node.attrs[":each"].match(EACH_PATTERN)
  if (!match) return document.createComment(`invalid :each expression "${node.attrs[":each"]}"`)

  const [, itemName, atName, listExpr] = match
  const keyExpr = node.attrs[":key"]
  const { [":each"]: _each, [":key"]: _key, ...itemAttrs } = node.attrs
  const itemNode: TemplateNode = { ...node, attrs: itemAttrs }

  const anchor = document.createComment("each")
  const wrapper = document.createDocumentFragment()
  wrapper.appendChild(anchor)

  // :if on the same element is not per-item filtering, and rendering
  // everything in silence reads like a broken filter - say it out loud
  if (":if" in node.attrs || ":elseif" in node.attrs || ":else" in node.attrs) {
    console.warn("jq79: :if/:elseif/:else on a :each element is ignored; filter the list expression instead")
  }

  let entries: EachEntry[] = []
  let warnedDuplicates = false

  fx.effect(() => {
    const list = evalExpr(listExpr, scope)
    // both sources normalize to [at, item] pairs: the index for an array, the
    // property key for a plain object (insertion order). Object entries are
    // read off the store proxy, so each value is tracked under its own key -
    // adds, deletes and changes all wake this effect
    const pairs: [any, any][] = Array.isArray(list)
      ? list.map((item, index): [any, any] => [index, item])
      : isPlainObject(list) ? Object.entries(list) : []
    // buckets rather than a key->entry map: duplicate keys (a user error, but
    // one that must degrade instead of corrupt) consume entries in order of
    // appearance, so no entry is ever matched twice - matching one twice is
    // how a reused row got disposed and a removed one resurrected
    const previous = new Map<any, EachEntry[]>()
    entries.forEach(entry => {
      const bucket = previous.get(entry.key)
      if (bucket) bucket.push(entry)
      else previous.set(entry.key, [entry])
    })

    const seen = new Set<any>()
    const moved: EachEntry[] = []
    const nextEntries = pairs.map(([at, item], index): EachEntry => {
      const itemScope = Object.create(scope)
      defineScopeVar(itemScope, itemName, item)
      if (atName) defineScopeVar(itemScope, atName, at)
      defineScopeVar(itemScope, "$index", index)
      const key = keyExpr !== undefined ? evalExpr(keyExpr, itemScope) : at
      if (seen.has(key) && !warnedDuplicates) {
        warnedDuplicates = true
        console.warn(`jq79: duplicate :key in :each "${node.attrs[":each"]}"; duplicates pair up by position`)
      }
      seen.add(key)
      const existing = previous.get(key)?.shift()

      if (existing && Object.is(existing.item, item)) {
        if (existing.scope.$index !== index) moved.push(existing)
        defineScopeVar(existing.scope, "$index", index)
        if (atName) defineScopeVar(existing.scope, atName, at)
        return existing
      }

      if (existing) {
        existing.fx.dispose()
        removeRange(existing.range)
      }

      const itemFx = createEffectScope(scope)
      // bounds captured before the positioning pass inserts the entry: a
      // component entry is a fragment, which empties on insertion (see boundsOf)
      const range = boundsOf(renderNode(itemNode, itemScope, itemFx, shadow))
      return { key, item, scope: itemScope, fx: itemFx, range }
    })

    // whatever no new item consumed is gone
    previous.forEach(bucket => bucket.forEach(entry => {
      entry.fx.dispose()
      removeRange(entry.range)
    }))

    let prevNode: Node = anchor
    nextEntries.forEach(entry => {
      if (prevNode.nextSibling !== entry.range.first) moveRangeAfter(entry.range, prevNode)
      prevNode = entry.range.last
    })

    // reused entries that changed position: their tracked bindings re-run off
    // the list notification anyway, but a binding that reads only `$index` or
    // the named key tracked nothing - refresh them so the move reaches those
    // too. Untracked, so these runs don't feed this list effect's own deps
    moved.forEach(entry => untracked(() => entry.fx.refresh()))

    entries = nextEntries
  })

  return wrapper
}

// renders a list of sibling template nodes (text + elements), grouping
// consecutive :if/:elseif/:else nodes into a single conditional block
const renderNodes = (nodes: (TemplateNode | string)[], scope: Record<string, any>, fx: EffectScope, shadow = false): DocumentFragment => {
  const fragment = document.createDocumentFragment()
  let i = 0

  while (i < nodes.length) {
    const node = nodes[i]

    if (typeof node === "string") {
      const textNode = document.createTextNode(node)
      // static text is most of a template (all of its indentation, for a start):
      // only text with a {{ expression }} in it needs an effect to stay in sync
      if (node.includes("{{")) fx.effect(() => { textNode.textContent = interpolate(node, scope) })
      fragment.appendChild(textNode)
      i++
      continue
    }

    if (":each" in node.attrs) {
      fragment.appendChild(renderEach(node, scope, fx, shadow))
      i++
      continue
    }

    if (":if" in node.attrs) {
      const branches: ConditionalBranch[] = [{ expr: node.attrs[":if"], node }]
      i++

      // the branches of a chain are siblings in the AST, but the template writes
      // them on their own lines - so the whitespace between them is indentation
      // and nothing else, and it's dropped rather than rendered: only one branch
      // is ever in the DOM, so there is nothing for it to be a space *between*
      const nextBranch = (attr: string): TemplateNode | undefined => {
        let next = i
        while (next < nodes.length && typeof nodes[next] === "string" && !(nodes[next] as string).trim()) next++
        const candidate = nodes[next]
        if (typeof candidate === "object" && attr in candidate.attrs) {
          i = next + 1
          return candidate
        }
        return undefined
      }

      for (let elseif = nextBranch(":elseif"); elseif; elseif = nextBranch(":elseif")) {
        branches.push({ expr: elseif.attrs[":elseif"], node: elseif })
      }
      const elseNode = nextBranch(":else")
      if (elseNode) branches.push({ node: elseNode })

      fragment.appendChild(renderConditional(branches, scope, fx, shadow))
      continue
    }

    fragment.appendChild(renderNode(node, scope, fx, shadow))
    i++
  }

  return fragment
}

export const renderComponent = (component: Component79, data: ReactiveDeepData<Record<string, any>>, shadow = false): Node =>
  renderNodes(component.template, data, createEffectScope(data), shadow)

type ComponentParts = {
  template: TemplateNode[]
  scripts: TagBlock[]
  styles: TagBlock[]
  // pre-resolved modules for `import(...)` calls in setup scripts, keyed by
  // the literal specifier. Bundlers (the jq79/vite plugin) fill this so
  // imports resolve from the bundle instead of being fetched at runtime
  modules?: Record<string, any>
  // where this component came from (a URL for fetch(), a path for the vite
  // plugin). Names the setup scripts in devtools - see scriptSourceUrl
  filename?: string
  // the components the file's <template name="..."> blocks declared, by name.
  // Every component parsed out of one file holds this same map - itself
  // included - which is what makes a sibling usable without an import, and
  // what lets a <template name="TreeNode"> render a <TreeNode>
  siblings?: Record<string, Component79>
  // which of the file's components this is: a template's name, or undefined
  // for the file's own. The file is the hot-reload unit, so a reparse hands
  // each live instance the parts belonging to the component it is
  name?: string
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
])

// a self-closing tag with its attributes; quoted attribute values are matched
// as whole chunks so a "/>" inside one doesn't end the tag early. The tag name
// admits a dot for the named forms of a tag - <slot.header /> - which is a
// legal HTML tag name (the tokenizer reads to the first space, "/" or ">")
const SELF_CLOSING_RE = /<([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\/>/g
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

// a start tag with its attributes, quote-aware so a ">" inside a value doesn't
// end it early; and a single spread attribute in name position (preceded by
// start-or-whitespace), its expression an identifier or member path
const OPEN_TAG_RE = /<([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
const ATTR_SPREAD_RE = /"[^"]*"|'[^']*'|(^|\s)\.\.\.([A-Za-z_$][\w$.]*)/g

// `...expr` as an attribute is sugar for :props="expr" (spread an object's
// properties as props - see renderNestedComponent). Rewritten BEFORE DOM
// parsing, into a value-based :props.<n>, because the HTML parser lowercases
// attribute *names*: with the expression in the name, `...userData` would arrive
// as `...userdata` and resolve to nothing. Moving it into a value - which the
// parser leaves untouched - keeps camelCase intact. Same pre-parse string move
// as expandSelfClosingTags, with the same defenses against rewriting code that
// only looks like a spread: <script>/<style> bodies are split out (a JS `...rest`
// there is not an attribute), only a start tag's interior is scanned (text
// between tags is safe), and quoted values are consumed whole so a genuine JS
// spread in a value (@click="f(...args)", :x="{ ...a }") is skipped. The <n>
// suffix (per tag) only keeps several spreads' attribute names distinct. A call
// (`...getProps()`) stops at the paren and is left alone - use :props="expr()"
const expandPropsSpread = (src: string): string =>
  src
    .split(RAW_BLOCK_RE)
    .map((chunk, i) =>
      i % 2 === 1
        ? chunk
        : chunk.replace(OPEN_TAG_RE, (_match, tag: string, attrs: string) => {
            let n = 0
            const rewritten = attrs.replace(ATTR_SPREAD_RE, (whole, space: string | undefined, expr: string | undefined) =>
              expr === undefined ? whole : `${space}:props.${n++}="${expr}"`
            )
            return `<${tag}${rewritten}>`
          })
    )
    .join("")

// <style scoped> support. Every element of the component's own template is
// stamped with data-jq79="<hash>" and the style's selectors are rewritten to
// require that attribute, so its rules can't reach anything the component
// didn't render. Purely a runtime transform (the browser parses the CSS), so
// it works the same for a bundled component and one loaded with fetch()
const SCOPE_ATTR = "data-jq79"

// FNV-1a over the source: stable per definition (not per instance), so N
// instances of the same component share one refcounted <style> in the head
const scopeHash = (src: string): string => {
  let hash = 2166136261
  for (let i = 0; i < src.length; i++) hash = Math.imul(hash ^ src.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(36)
}

const stampScope = (nodes: (TemplateNode | string)[], scope: string) => {
  nodes.forEach(node => {
    if (typeof node === "string") return
    node.attrs[SCOPE_ATTR] = scope
    stampScope(node.children, scope)
  })
}

// the scope attribute goes on the selector's last compound - the element the
// rule actually targets - but *before* a pseudo-element, which must stay last
// (".a::before" scopes to ".a[data-jq79='x']::before", not "::before[...]")
const scopeSelector = (selectorText: string, scope: string): string =>
  selectorText
    .split(",")
    .map(part => {
      const selector = part.trim()
      const pseudoAt = selector.indexOf("::")
      const target = pseudoAt === -1 ? selector : selector.slice(0, pseudoAt)
      const pseudoElement = pseudoAt === -1 ? "" : selector.slice(pseudoAt)
      return `${target}[${SCOPE_ATTR}="${scope}"]${pseudoElement}`
    })
    .join(", ")

// CSSStyleRule is scoped in place; CSSGroupingRule (@media, @supports,
// @container) is recursed into; everything else - notably @keyframes, whose
// "selectors" are percentages - is left alone
const scopeRules = (rules: CSSRuleList, scope: string) => {
  Array.from(rules).forEach(rule => {
    if (rule instanceof CSSStyleRule) rule.selectorText = scopeSelector(rule.selectorText, scope)
    else if (rule instanceof CSSGroupingRule) scopeRules(rule.cssRules, scope)
  })
}

// the CSS parser is the browser's own (no dependency, no hand-rolled parser).
// Note browsers *silently drop* rules whose selector they can't parse, which
// is what Vue's :deep()/::v-deep/>>> escape hatches are - unsupported here,
// and warned about rather than left to vanish
const scopeCss = (css: string, scope: string): string => {
  if (/:deep\(|::v-deep|>>>/.test(css)) {
    console.warn("jq79: :deep()/::v-deep/>>> are not supported in <style scoped>; the rule will be dropped by the browser")
  }
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  scopeRules(sheet.cssRules, scope)
  return Array.from(sheet.cssRules).map(rule => rule.cssText).join("\n")
}

// a component name has to be PascalCase to be usable: findComponentKey only
// ever considers capitalized scope keys, so a lowercase name would declare a
// component no tag could reference. It is also what keeps the named exports
// from colliding with a definition's own fields, which are all lowercase
const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/

// converts a string of HTML into an AST representation of the component:
// - template: the non-script/style top-level elements, as TemplateNodes
// - scripts/styles: { attrs, content } blocks in source order
// - siblings: the components its top-level <template name="..."> declared
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
  // aren't reparented into <head> by the HTML parser. Both pre-DOM string
  // rewrites run here: `...expr` -> :props.<n>="expr" first (it reads the raw
  // camelCase before the parser can lowercase names), then self-closing tags
  const prepared = expandSelfClosingTags(expandPropsSpread(component))
  const parsedDOM = new DOMParser().parseFromString(`<template>${prepared}</template>`, "text/html")
  const root = parsedDOM.querySelector("template") as HTMLTemplateElement

  // a top-level <template> declares another component of this file; everything
  // else is this one's own
  const own: Element[] = []
  const declarations: HTMLTemplateElement[] = []
  Array.from(root.content.children).forEach(el => {
    if (el.tagName === "TEMPLATE") declarations.push(el as HTMLTemplateElement)
    else own.push(el)
  })

  // the file's own component hashes the whole file: every component in it
  // re-renders on any edit anyway (the file is the hot-reload unit), so a
  // stamp that changes when a sibling is edited costs nothing, and scopeHash
  // gets to keep hashing the source it was handed
  const parts = componentPartsFrom(own, component)

  // one map, shared by reference: it is filled below, after each definition
  // has already been handed it, so every component of the file sees all the
  // others *and itself* - which is what makes a recursive component possible
  const siblings: Record<string, Component79> = {}
  declarations.forEach(el => {
    const name = el.getAttribute("name")
    // ignored rather than fatal, like every other malformed thing here: a bad
    // save mid-typing must not take the page down, least of all under HMR
    if (name === null) {
      console.warn("jq79: a top-level <template> without a name declares nothing and was ignored")
      return
    }
    if (!COMPONENT_NAME_RE.test(name)) {
      console.warn(
        `jq79: <template name="${name}"> was ignored - a component name has to be PascalCase, ` +
        "or no tag could ever reference it (only capitalized names resolve as components)"
      )
      return
    }
    if (name in siblings) {
      console.warn(`jq79: two <template name="${name}"> in one file; the second was ignored`)
      return
    }
    // its own source is its own scope: a named template is a shadow root
    // inside a shadow root, so the file's scoped rules stop at its boundary
    // and its own stop there too
    siblings[name] = new Component79({ ...componentPartsFrom(Array.from(el.content.children), el.innerHTML), siblings, name })
  })
  if (Object.keys(siblings).length) parts.siblings = siblings

  return parts
}

// the script/style/markup split of one component's top-level elements, with
// <style scoped> resolved against the source those elements came from - the
// whole file for its own component, a <template>'s contents for a named one,
// so the two get different stamps and neither can style the other
const componentPartsFrom = (elements: Element[], hashSource: string): ComponentParts => {
  const scripts: TagBlock[] = []
  const styles: TagBlock[] = []
  const template: TemplateNode[] = []

  elements.forEach(el => {
    const block: TagBlock = { attrs: elementAttrs(el), content: el.textContent ?? "" }

    if (el.tagName === "SCRIPT") scripts.push(block)
    else if (el.tagName === "STYLE") styles.push(block)
    else template.push(elementToAST(el))
  })

  // <style lang="scss"> is compiled by the jq79/vite plugin, so a `lang` still
  // here means this component never went through it - it was fetched, loaded
  // from a URL, or built from an inline string. The browser would drop the
  // uncompiled source without a word, so say it out loud instead
  styles.forEach(style => {
    if ("lang" in style.attrs) {
      console.warn(
        `jq79: <style lang="${style.attrs.lang}"> needs the jq79/vite plugin to compile it. ` +
        "This component didn't go through the bundler, so its styles were left uncompiled and the browser will ignore them."
      )
    }
  })

  // scoping is resolved once, here: the stamped template and the scoped CSS
  // are what every instance of this definition renders and injects. An
  // uncompiled `lang` block is left as it was written - rewriting selectors
  // in something that isn't CSS yet would only garble what devtools shows
  const isScoped = (style: TagBlock) => "scoped" in style.attrs && !("lang" in style.attrs)
  if (styles.some(isScoped)) {
    const scope = scopeHash(hashSource)
    stampScope(template, scope)
    styles.forEach(style => {
      if (isScoped(style)) style.scoped = scopeCss(style.content, scope)
    })
  }

  return { template, scripts, styles }
}

// loads .html URLs as components, delegating anything else to native import().
// Goes to fetchComponent rather than Component79.fetch because an import wants
// the component, not the chainable handle the public entry point returns
const importResource = (url: string): Promise<any> =>
  /\.html?([?#]|$)/.test(url) ? fetchComponent(url) : import(url)

// ---------------------------------------------------------------------------
// naming scripts for devtools
//
// setup scripts are compiled with new Function (they need `with`, which is a
// SyntaxError in a module), so no bundler source map can reach them: they show
// up as an anonymous "VM1234" script, breakpoints don't survive a reload, and
// stack traces name nothing. A //# sourceURL comment fixes all three - the
// compiled script takes the component's name, so it is findable in the sources
// tree, keeps its breakpoints, and appears by name in stack traces.
//
// The line numbers it reports are the compiled script's own, not the .html
// file's: the engine wraps a Function body in a header ("function anonymous(
// args\n) {\n") that shifts everything down, and no amount of padding can
// shift code *up* to match a <script> sitting on line 1. Reporting the
// component's real lines would need a source map, which the runtime doesn't
// emit today
// ---------------------------------------------------------------------------

// where a script block came from: the component's filename, and its index
// among the component's scripts (two scripts in one file need distinct names,
// or devtools shows only one of them)
type ScriptLocation = { filename?: string; index?: number }

// nothing to name an inline component's scripts after, so they stay anonymous
const sourceUrlComment = (filename: string | undefined, index: number): string =>
  filename ? `\n//# sourceURL=${filename}?jq79-script=${index}` : ""

// what a <style> block injects into document.head: the scoped rewrite when it
// has one, the source otherwise. A shadow root uses `content` directly instead
// - scoping is what a shadow root already does, and doing both would break the
// `:host` rules only shadow rendering can have (`:host[data-jq79=...]` matches
// nothing: the host element is outside the template, so it carries no stamp)
const headStyle = (style: TagBlock): string => style.scoped ?? style.content

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
const runSetupScript = (code: string, scope: Record<string, any>, effect: (run: () => void) => void, instanceHelpers: Record<string, any> = {}, importer: (url: string) => Promise<any> = importResource, at: ScriptLocation = {}) => {
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
    `return (async () => { with ($scope) { ${code} } })()${sourceUrlComment(at.filename, at.index ?? 0)}`
  )(scriptScope, effect, importer, ...Object.values(helpers))
  result.catch(error => console.error("jq79: error in :setup script", error))
}

// puts a component's declared props on the store, before any script runs and
// before the first render: the names, so the template can bind to them even
// when the parent passes nothing, and the defaults, so it binds to something.
//
// A prop the parent *did* pass is already on the store (render() seeds it), so
// a default only fills an `undefined` - which is also what JS destructuring
// does with the same pattern, so both modes agree. It happens once, at setup:
// re-applying a default later would need an effect that reads and writes the
// same key, and that effect would wake itself forever.
//
// `null` props means the component declared no signature at all, which is not
// the same as declaring an empty one: it keeps today's permissive behavior
const declareProps = (store: Record<string, any>, props: PropDecl[] | null) => {
  props?.forEach(({ name, default: expr }) => {
    if (store[name] !== undefined) return
    store[name] = expr === undefined ? undefined : evalExpr(expr, store)
  })
}

// every prop name a component's scripts declare, across both script modes.
// Read before the store exists, because what a component declares decides
// which of its file's sibling components it can still see: declaring a name
// says it comes from the parent, so the file's own definition of that name is
// deliberately not in this component's scope
const declaredPropNames = (scripts: TagBlock[]): Set<string> => {
  const names = new Set<string>()
  scripts.forEach(script => {
    const declarations = parseFactoryProps(script.content) ?? parsePropsPattern(script.attrs[":setup"])
    declarations?.forEach(({ name }) => names.add(name))
  })
  return names
}

// the sibling components this one resolves by name, or null when there are
// none left to resolve. They go on the store's *prototype* rather than in it:
// the component-key scan walks the chain, so <Row> resolves; they stay out of
// the data, so Object.keys, snapshots and spreads never see them; and an own
// key shadows a prototype one, so a prop the parent did pass wins for free
const siblingsInScope = (
  siblings: Record<string, Component79> | undefined,
  declared: Set<string>
): Record<string, Component79> | null => {
  if (!siblings) return null
  // null-prototype, for the same reason storeApi is: `key in scope` must not
  // start answering true for toString, constructor and the rest
  const inScope: Record<string, Component79> = Object.create(null)
  let any = false
  Object.entries(siblings).forEach(([name, component]) => {
    if (declared.has(name)) return
    inScope[name] = component
    any = true
  })
  return any ? inScope : null
}

// names a component declared as props and the parent passed nothing for. Such
// a name can never become a component later - there is no binding on the tag
// to update it - so a <Tag> reading one is a wiring mistake that can be named
// on sight, unlike the `undefined` of an import still in flight. Symbol-keyed
// and non-enumerable: it rides the scope chain (so an :each item scope finds
// it too) without ever showing up as data
const UNFILLED_PROPS = Symbol("jq79.unfilledProps")

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
const runFactoryScript = (code: string, scope: Record<string, any>, effect: (run: () => void) => void, instanceHelpers: Record<string, any> = {}, importer: (url: string) => Promise<any> = importResource, at: ScriptLocation = {}) => {
  const helpers = { ...SETUP_HELPERS, ...instanceHelpers }
  const $__exports: { default?: (props: Record<string, any>, ctx: Record<string, any>) => any; done?: boolean } = {}
  const result: Promise<void> = new Function(
    "$__exports", "$__default", "$__import", ...Object.keys(helpers),
    `return (async () => { "use strict";\n${code}\n;$__exports.done = true })()${sourceUrlComment(at.filename, at.index ?? 0)}`
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
    // the sync path is invoked straight from render(), so a throwing factory
    // must be caught here too - not just by the `result` rejection handler
    try {
      // props first, ctx second. Both are the store: the pattern destructures
      // the props it declared (copying, as destructuring does - $props is the
      // live view for a primitive the parent reassigns later)
      const returned = factory(scope, { $data: scope, $props: scope, $effect: effect, ...instanceHelpers })
      if (returned instanceof Promise) returned.then(merge).catch(logError)
      else merge(returned)
    } catch (error) {
      logError(error)
    }
  }

  result.then(invoke, logError)
  if ($__exports.done) invoke() // fully-sync body: factory runs before first render
}

// ---------------------------------------------------------------------------
// hot reload
//
// Both delivery paths want the same thing when a .html file changes: reparse
// it, and re-render every live instance of it in place, keeping its data. The
// swap lives in the runtime (hotReplace, below) so jq79/dev and the Vite
// plugin share one implementation instead of two - and so it can reach the
// private fields it needs (the markers, the holding fragment) rather than
// poking at them from outside, which is what the plugin used to do.
//
// Finding the instances is the part only the runtime can do: a component
// fetched at runtime is reachable from nothing but the DOM it rendered. So
// instances register themselves - but only once a page opts in, before the
// runtime loads. Nothing here costs a bundled app anything: with the registry
// off, an instance is not tracked at all.
// ---------------------------------------------------------------------------

const HOT_FLAG = "__JQ79_HMR_ENABLED__"
const HOT_RUNTIME = "__JQ79_HMR__"

// live instances by filename. WeakRef because a destroyed component that the
// page has dropped must stay collectable: `:each` churns through clones
let hotRegistry: Map<string, Set<WeakRef<Component79>>> | null = null

const hotRegister = (instance: Component79) => {
  if (!hotRegistry || !instance.filename) return
  let refs = hotRegistry.get(instance.filename)
  if (!refs) hotRegistry.set(instance.filename, (refs = new Set()))
  refs.add(new WeakRef(instance))
}

// the same file reaches the runtime under different names - "./card.html" from
// an import() in a setup script, "/cards/card.html" from a fetch, "cards/card.
// html" from the dev server that watched it - and they all have to land on one
// key. Resolving against the page is what settles them
const hotKey = (filename: string): string => {
  try {
    return new URL(filename, document.baseURI).pathname
  } catch {
    return filename
  }
}

// swaps the file's new source into every instance that came from `filename`,
// and returns how many of them were *on the page* and so re-rendered. Zero
// means the change is not visible anywhere - the file is a page rather than a
// component, or nothing has mounted it yet - and the caller (a dev server)
// should fall back to reloading. Definitions and instances that have been
// destroyed but not yet collected are patched all the same; they just don't
// count, because nothing on screen changed for them
export const hotUpdate = (filename: string, src: string): number => {
  if (!hotRegistry) return 0

  const key = hotKey(filename)
  // parsed once and shared by every instance - which is already what a
  // definition and the clones :component makes from it do
  const parts = parseComponentString(src)
  // the file is the hot-reload unit, so one reparse serves every component it
  // declares: an instance is handed the parts of the component it *is*, by
  // name. A name that is no longer in the file (a <template> renamed or
  // deleted) has no parts to be given, and only a reload can fix the page
  let orphaned = false
  const partsFor = (instance: Component79): ComponentParts | null =>
    instance.name === undefined ? parts : parts.siblings?.[instance.name] ?? null

  let rerendered = 0
  for (const [name, refs] of hotRegistry) {
    if (hotKey(name) !== key) continue
    for (const ref of refs) {
      const instance = ref.deref()
      if (!instance) {
        refs.delete(ref) // collected since the last update
        continue
      }
      const next = partsFor(instance)
      if (!next) {
        orphaned = true
        continue
      }
      if (instance.hotReplace(next)) rerendered++
    }
    if (!refs.size) hotRegistry.delete(name)
  }
  return orphaned ? 0 : rerendered
}

// starts tracking instances, so hotUpdate can find them. jq79/dev's client
// calls this through the global handshake at the foot of this file; it is
// exported so a bundled app - or a test - can opt in directly
export const enableHotReload = (): void => {
  hotRegistry ??= new Map()
  ;(globalThis as any)[HOT_RUNTIME] = { update: hotUpdate }
}

type EmitListener = (event: CustomEvent, payload: any) => void

const fetchComponent = async (url: string): Promise<Component79> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`failed to fetch component from ${url}: ${response.status}`)
  // the URL names the component's scripts in devtools, and is where the
  // browser will look for the source when a breakpoint lands in one
  return new Component79(await response.text(), { filename: url })
}

// a parsed single-file component. Typical lifecycle:
//
//   const jq79 = new Component79(src)   // or await Component79.fetch(url)
//   jq79.on("submit", (e, payload) => {}) // hear this instance's $emit events
//   jq79.mount("#app", { user })        // render (reactive DOM, scripts, styles) + attach
//   ...                                 // (mountShadow mounts into a shadow root)
//   jq79.detach()                       // detach, keeping state - mount() re-attaches
//      .destroy()                      // dispose effects and remove styles
export class Component79 {
  // the version of jq79 this class came from, so a page can tell which build it
  // loaded (a CDN <script> pins nothing on its own)
  static readonly version: string = VERSION

  template: TemplateNode[]
  scripts: TagBlock[]
  styles: TagBlock[]
  // pre-resolved modules for setup-script `import(...)` calls (see
  // ComponentParts.modules); checked before falling back to fetch/import
  modules?: Record<string, any>
  // the component's origin, used to name its scripts in devtools
  filename?: string
  // the other components declared in the same file, by name (see
  // ComponentParts.siblings). They are also this definition's own properties,
  // so `const { Row } = await Component79.fetch(url)` reaches them
  siblings?: Record<string, Component79>
  // this component's name inside its file, for the components a <template>
  // declared; the file's own component has none - it is the default, and a
  // default is named by whoever imports it
  name?: string
  // the content the usage site handed this instance, by slot name (see the
  // slots section). Not part of a definition - it belongs to the tag that
  // wrote it - so renderNestedComponent sets it on the instance it creates,
  // and every render reads it from here: a hot reload re-renders from a data
  // snapshot, which a symbol on the store would not survive
  slots?: SlotMap

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

  constructor(src: string | ComponentParts, options: { modules?: Record<string, any>; filename?: string } = {}) {
    const parts = typeof src === "string" ? parseComponentString(src) : src
    this.template = parts.template
    this.scripts = parts.scripts
    this.styles = parts.styles
    this.modules = options.modules ?? (typeof src === "string" ? undefined : src.modules)
    this.filename = options.filename ?? (typeof src === "string" ? undefined : src.filename)
    this.siblings = parts.siblings
    this.name = parts.name
    this.adoptSiblings()
    hotRegister(this) // a no-op unless the page enabled hot reload
  }

  // the parser builds a file's sibling definitions before anyone has told it
  // where the file came from, so whoever holds the parse hands its origin down
  // - and keeps doing it after a hot reload, which parses the file afresh.
  // Without it a reloaded child would have no filename, and an instance with
  // no filename is not tracked: the next edit would never reach it
  private adoptSiblings() {
    if (!this.siblings) return
    Object.entries(this.siblings).forEach(([name, sibling]) => {
      sibling.filename ??= this.filename
      sibling.modules ??= this.modules
      // the file's own component also *is* the file: its named components hang
      // off it as properties, which is what `const { Row } = …` reads (and
      // what the bundler re-exports by name)
      if (!this.name) (this as any)[name] = sibling
    })
  }

  // swaps this component's parsed parts for `src`'s and, if it is on the page,
  // re-renders it where it stands - seeded with a snapshot of its data, so
  // props and store values survive (the setup script runs again, so whatever it
  // initializes is reset). Returns whether it re-rendered: an instance that was
  // never rendered is a *definition*, and patching its parts is all there is to
  // do - the clones :component made from it are instances in their own right,
  // registered under the same filename, and re-render themselves.
  //
  // Dev-only, and not part of the public API: jq79/dev and the Vite plugin call
  // it when a file changes. It re-attaches against the markers rather than
  // mountRoot on purpose - a nested clone is mounted into a fragment that is
  // then emptied into the page, so its mountRoot is a stale, detached fragment
  // while its markers sit where its DOM actually is
  hotReplace(src: string | ComponentParts): boolean {
    const parts = typeof src === "string" ? parseComponentString(src) : src
    const marker = this.startMarker
    const rendered = !!(marker && this.content)

    // where its output sits now, if it is on the page. A rendered-but-detached
    // instance (markers in the holding fragment) re-renders detached, and a
    // later mount() attaches the new output - like any update it missed away
    const live = rendered && marker!.isConnected
    const parent = live ? (marker!.parentNode as Element | ShadowRoot | DocumentFragment) : null
    const before = live ? this.endMarker!.nextSibling : null
    const data = { ...this.data }
    const shadow = this.useShadow

    // destroy() releases the styles it acquired, so it has to run while
    // this.styles is still the *old* set - swapping the parts first would leak
    // the old stylesheet into the head and release a new one nobody holds
    if (rendered) this.destroy()

    this.template = parts.template
    this.scripts = parts.scripts
    this.styles = parts.styles
    // the file's other components as they are now: the next render resolves
    // <Row> against these, so a parent picks up an edited child even when the
    // child's own instances are patched separately
    this.siblings = parts.siblings
    this.adoptSiblings()
    if (!rendered) return false // a definition: its clones re-render themselves

    this.renderWith(data, shadow)
    if (!parent) return false

    // shadow styles live inline, right before the DOM they style (attach()
    // appends them ahead of the content), so they go back the same way
    if (shadow) this.styleEls.forEach(el => parent.insertBefore(el, before))
    parent.insertBefore(this.content!, before)
    this.mountRoot = parent
    this.resolveMounted?.()
    return true
  }

  // downloads and parses a component, handing back a PendingComponent79: a
  // handle that can be mounted right away, and that awaits to this component -
  // so both of these are the whole program
  //
  //   Component79.fetch("./app.html").mount("main")
  //   const app = await Component79.fetch("./app.html")
  static fetch(url: string): PendingComponent79 {
    if (Array.isArray(url)) throw new TypeError("Component79.fetch takes one URL; use fetchAll for an array")
    return new PendingComponent79(fetchComponent(url))
  }

  // fetches them all at once and resolves to the components in the same order,
  // so one await destructures them - and, like Promise.all, the first failure
  // rejects the whole thing. A plain promise, not a handle: mounting a *list*
  // of components has no single meaning
  static fetchAll(urls: string[]): Promise<Component79[]> {
    return Promise.all(urls.map(fetchComponent))
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

    // what this component can see of its file's other components, and which of
    // its declared props arrived empty - both decided by the signature, before
    // the store exists (see siblingsInScope / UNFILLED_PROPS)
    const declared = declaredPropNames(this.scripts)
    const siblingScope = siblingsInScope(this.siblings, declared)
    const raw: Record<string, any> = siblingScope
      ? Object.assign(Object.create(siblingScope), data)
      : { ...data }
    const unfilled = new Set([...declared].filter(name => !(name in data)))
    if (unfilled.size) Object.defineProperty(raw, UNFILLED_PROPS, { value: unfilled })
    // the slot content, for the <slot>s the template renders, and the static
    // map of which names were filled, for the component to ask about
    // (`<footer :if="$slots.footer">`). Filled at the usage site, so it can
    // only change when the tag itself re-renders - which builds a new instance
    if (this.slots) Object.defineProperty(raw, SLOTS, { value: this.slots })

    const store = $reactive(raw)
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
    // generations from reaching the instance's on() listeners.
    // The on() channel runs *first* (it's where @event on a component tag is
    // wired - see wireTagEvent) so its listeners can shape the DOM dispatch:
    // stopPropagation() there keeps the event off the DOM entirely, and the
    // event is cancelable so preventDefault() - from either channel - flips
    // the return to false, telling the emitting child "the parent vetoed"
    const marker = this.startMarker
    const $emit = (eventName: string, payload?: any): boolean => {
      const event = new CustomEvent(eventName, { detail: payload, bubbles: true, composed: true, cancelable: true })
      if (marker === this.startMarker) {
        this.emitListeners.get(eventName)?.forEach(listener => listener(event, payload))
      }
      // cancelBubble is the spec's legacy name, but it's the only *readable*
      // accessor for the stop-propagation flag - hence the deprecation hint
      if (!event.cancelBubble) marker.dispatchEvent(event)
      return !event.defaultPrevented
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

    // the names a component answers on top of its store: $emit, so an inline
    // handler can emit without routing through a setup function
    // (@input="$emit('update', $event.target.value)"), and $slots, the static
    // map of the names the usage site filled, so a wrapper can be dropped when
    // nothing filled it (<footer :if="$slots.footer">). Both reach the
    // template (through templateScope, below) and both script modes (as
    // instance helpers), and a same-named store key shadows either.
    // Null-prototype, for the same reason storeApi is: `key in injected` must
    // not start answering true for toString, constructor and the rest
    const injected: Record<string, any> = Object.assign(Object.create(null), {
      $emit,
      $slots: Object.fromEntries(Object.keys(this.slots ?? {}).map(name => [name, true])),
    })

    // scripts run before the template renders so `$:` values are initialized;
    // a `:mounted` script defers entirely until mount() instead. A top-level
    // `export default` switches the script to factory mode (plain lexical JS)
    // a `:mounted` script is deferred by prepending the await on the code's own
    // first line, so deferring doesn't shift the lines devtools reports for it
    const defer = (code: string) => `await $mounted();${code}`

    this.scripts.forEach((script, index) => {
      // the file's other components are passed as parameters of the compiled
      // script, not just left on the store's prototype: a factory script runs
      // as plain lexical JS with no `with`, so a bare `Row` in one would
      // resolve to nothing at all. In setup mode this composes with `with` -
      // scriptScope's `has` declines any name that is a helper, so the
      // parameter is what the name resolves to
      const instanceHelpers = { $mounted, $self, $$self, ...injected, ...siblingScope }
      const at: ScriptLocation = { filename: this.filename, index }
      const factoryCode = transformFactoryScript(script.content)
      if (factoryCode !== null) {
        declareProps(store, parseFactoryProps(script.content))
        const body = ":mounted" in script.attrs ? defer(factoryCode) : factoryCode
        runFactoryScript(body, store, fx.effect, instanceHelpers, $import, at)
        return
      }
      const { vars, code } = transformSetupScript(script.content)
      declareProps(store, parsePropsPattern(script.attrs[":setup"]))
      // pre-declare script vars on the store so `with` resolves assignments
      // to them (and reads of them) through the reactive proxy
      vars.forEach(name => { if (!(name in store)) (store as any)[name] = undefined })
      const body = ":mounted" in script.attrs ? defer(code) : code
      runSetupScript(body, store, fx.effect, instanceHelpers, $import, at)
    })

    const content = document.createDocumentFragment()
    // the injected names, served by has/get only - never as own keys - so
    // Object.keys, snapshot spreads and the component-key scan don't see them,
    // and every read still forwards through the reactive store, keeping
    // dependency tracking intact
    const templateScope = new Proxy(store as Record<string, any>, {
      has: (target, key) => (typeof key === "string" && key in injected) || Reflect.has(target, key),
      get: (target, key, receiver) =>
        typeof key === "string" && key in injected && !Reflect.has(target, key)
          ? injected[key]
          : Reflect.get(target, key, receiver),
    })
    content.append(this.startMarker, renderNodes(this.template, templateScope, fx, shadow), this.endMarker)
    this.content = content

    if (shadow) {
      this.styleEls = this.styles.map(style => {
        const el = document.createElement("style")
        el.textContent = style.content // the source: a shadow root scopes it already
        return el
      })
    } else {
      this.styles.forEach(style => acquireStyle(headStyle(style)))
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
    // a store this component was handed (a shared `$reactive`) outlives it, and
    // holds a listener per store that nested it - drop this instance's
    this.data?.$dispose()
    this.styleEls.forEach(el => el.parentNode?.removeChild(el))
    this.styleEls = []
    if (this.ownsSharedStyles) {
      this.styles.forEach(style => releaseStyle(headStyle(style)))
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

// what Component79.fetch() hands back: a component that hasn't arrived yet.
//
// Every method queues onto the fetch and returns the handle, so a whole page
// is one expression and the calls run in the order they were written:
//
//   C79.fetch("./app.html").on("save", persist).mount("main", { user })
//
// It is also thenable, resolving to the Component79 itself - which is what
// keeps `await Component79.fetch(url)` (and importResource, and a handle
// dropped into Promise.all) working exactly as before. Queued calls keep the
// resolved value, so awaiting a chain gives the mounted component.
//
// The catch: mount() here returns the handle, not the component - there is no
// component yet to return. That's why the whole lifecycle is on the handle and
// not just mount(): nobody should have to await merely to destroy something.
export class PendingComponent79 {
  // the fetch with every queued call chained onto it, each passing the
  // component through - so `chain` always settles to the component, however
  // many calls were queued, and a failure anywhere rejects the rest
  private chain: Promise<Component79>

  constructor(component: Promise<Component79>) {
    this.chain = component
  }

  private queue(action: (component: Component79) => void): this {
    this.chain = this.chain.then(component => {
      action(component)
      return component
    })
    return this
  }

  then<TResult1 = Component79, TResult2 = never>(
    onfulfilled?: ((value: Component79) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.chain.then(onfulfilled, onrejected)
  }

  // a chain nobody awaits reports a failed fetch as an unhandled rejection,
  // like any dropped promise chain - these are for callers who'd rather handle
  // it. catch() returns a promise, not a handle: the chain ends here
  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<Component79 | TResult> {
    return this.chain.catch(onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<Component79> {
    return this.chain.finally(onfinally)
  }

  mount(parent: Element | ShadowRoot | DocumentFragment | string, data?: Record<string, any>): this {
    return this.queue(component => component.mount(parent, data))
  }

  mountShadow(parent: Element | ShadowRoot | DocumentFragment | string, data?: Record<string, any>): this {
    return this.queue(component => component.mountShadow(parent, data))
  }

  render(data: Record<string, any> = {}): this {
    return this.queue(component => component.render(data))
  }

  renderShadow(data: Record<string, any> = {}): this {
    return this.queue(component => component.renderShadow(data))
  }

  on(eventName: string, listener: EmitListener): this {
    return this.queue(component => component.on(eventName, listener))
  }

  off(eventName: string, listener: EmitListener): this {
    return this.queue(component => component.off(eventName, listener))
  }

  detach(): this {
    return this.queue(component => component.detach())
  }

  destroy(): this {
    return this.queue(component => component.destroy())
  }
}

export { Component79 as C79 }

export const parseComponent = (component: string): Component79 => new Component79(component)

// library helpers injected into setup scripts. They behave like extra
// globals: a same-named scope property (render data or a top-level
// declaration) shadows them
const SETUP_HELPERS: Record<string, any> = { $, $$, $create, $reactive, Component79 }

// the hot-reload handshake. jq79/dev serves a classic script that sets the flag
// below; classic scripts run before deferred module ones, so the flag is always
// set before this module evaluates. The page's copy of the runtime can come from
// anywhere - a CDN, an import map, dist/ - and the dev client has no way to
// import *that* copy, so the runtime hands itself to the client instead
if (typeof globalThis !== "undefined" && (globalThis as any)[HOT_FLAG]) enableHotReload()

