
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

const evalExpr = (expr: string, scope: Record<string, any>): any => {
  try {
    return new Function(...Object.keys(scope), `return (${expr})`)(...Object.values(scope))
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

export const createReactiveDeepData = <T extends Record<string, any>>(data: T): ReactiveDeepData<T> => {
  const exactListeners = new Map<string, Set<ChangeListener>>()
  const anyListeners = new Set<AnyChangeListener>()

  const notify = (dotKey: string, value: any) => {
    exactListeners.get(dotKey)?.forEach(listener => listener(value, dotKey))
    anyListeners.forEach(listener => listener(dotKey, value))
  }

  const makeReactive = (obj: Record<string, any>, path: string): Record<string, any> => {
    Object.entries(obj).forEach(([key, value]) => {
      if (value && typeof value === "object") {
        obj[key] = makeReactive(value, path ? `${path}.${key}` : key)
      }
    })

    return new Proxy(obj, {
      set(target, key: string, value) {
        const dotKey = path ? `${path}.${key}` : key
        if (value && typeof value === "object") {
          value = makeReactive(value, dotKey)
        }
        target[key] = value
        notify(dotKey, value)
        return true
      }
    })
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

  Object.defineProperty(reactive, "$on", { value: $on, enumerable: false })
  Object.defineProperty(reactive, "$onAny", { value: $onAny, enumerable: false })

  return reactive
}

const CONTROL_ATTRS = new Set([":bind", ":if", ":elseif", ":else", ":each"])
const EACH_PATTERN = /^\s*(\w+)\s+in\s+(.+)$/

type ConditionalBranch = { expr?: string; node: TemplateNode }

const buildScope = (data: ReactiveDeepData<any>, overrides: Record<string, any>): Record<string, any> => ({
  ...data,
  ...overrides,
})

// renders a single element node: static attrs, a reactive :bind object, and its
// (reactive) children. :if/:elseif/:else/:each are handled by renderNodes, which
// decides *whether*/*how many times* a node is rendered before calling this
const renderNode = (node: TemplateNode, data: ReactiveDeepData<any>, overrides: Record<string, any>): Node => {
  const el = document.createElement(node.tag)

  Object.entries(node.attrs).forEach(([key, value]) => {
    if (!CONTROL_ATTRS.has(key)) el.setAttribute(key, value)
  })

  const bindExpr = node.attrs[":bind"]
  if (bindExpr !== undefined) {
    let boundKeys: string[] = []

    const applyBind = () => {
      boundKeys.forEach(key => el.removeAttribute(key))
      const bound = evalExpr(bindExpr, buildScope(data, overrides))
      boundKeys = bound && typeof bound === "object" ? Object.keys(bound) : []
      boundKeys.forEach(key => {
        const value = bound[key]
        if (value != null && value !== false) el.setAttribute(key, String(value))
      })
    }

    applyBind()
    data.$onAny(() => applyBind())
  }

  el.appendChild(renderNodes(node.children, data, overrides))

  return el
}

// a :if/:elseif*/:else? chain sharing one anchor comment so the active branch
// can be swapped in place without disturbing sibling positions
const renderConditional = (
  branches: ConditionalBranch[],
  data: ReactiveDeepData<any>,
  overrides: Record<string, any>
): Node => {
  const anchor = document.createComment("if")
  const wrapper = document.createDocumentFragment()
  wrapper.appendChild(anchor)

  let current: Node | null = null

  const apply = () => {
    if (current) current.parentNode?.removeChild(current)
    current = null

    const scope = buildScope(data, overrides)
    const active = branches.find(branch => branch.expr === undefined || evalExpr(branch.expr, scope))
    if (!active) return

    current = renderNode(active.node, data, overrides)
    anchor.parentNode!.insertBefore(current, anchor.nextSibling)
  }

  apply()
  data.$onAny(() => apply())

  return wrapper
}

// :each="item in items" - re-renders the whole list on any change, keyed only
// by position (no diffing), which keeps things simple at the cost of throwing
// away list item DOM/state on unrelated data changes
const renderEach = (node: TemplateNode, data: ReactiveDeepData<any>, overrides: Record<string, any>): Node => {
  const match = node.attrs[":each"].match(EACH_PATTERN)
  if (!match) return document.createComment(`invalid :each expression "${node.attrs[":each"]}"`)

  const [, itemName, listExpr] = match
  const { [":each"]: _each, ...itemAttrs } = node.attrs
  const itemNode: TemplateNode = { ...node, attrs: itemAttrs }

  const anchor = document.createComment("each")
  const wrapper = document.createDocumentFragment()
  wrapper.appendChild(anchor)

  let current: Node[] = []

  const apply = () => {
    current.forEach(n => n.parentNode?.removeChild(n))

    const list = evalExpr(listExpr, buildScope(data, overrides))
    const items = Array.isArray(list) ? list : []

    const insertionPoint = anchor.nextSibling
    current = items.map((item, index) =>
      renderNode(itemNode, data, { ...overrides, [itemName]: item, $index: index })
    )
    current.forEach(n => anchor.parentNode!.insertBefore(n, insertionPoint))
  }

  apply()
  data.$onAny(() => apply())

  return wrapper
}

// renders a list of sibling template nodes (text + elements), grouping
// consecutive :if/:elseif/:else nodes into a single conditional block
const renderNodes = (
  nodes: (TemplateNode | string)[],
  data: ReactiveDeepData<any>,
  overrides: Record<string, any>
): DocumentFragment => {
  const fragment = document.createDocumentFragment()
  let i = 0

  while (i < nodes.length) {
    const node = nodes[i]

    if (typeof node === "string") {
      const textNode = document.createTextNode(interpolate(node, buildScope(data, overrides)))
      data.$onAny(() => { textNode.textContent = interpolate(node, buildScope(data, overrides)) })
      fragment.appendChild(textNode)
      i++
      continue
    }

    if (":each" in node.attrs) {
      fragment.appendChild(renderEach(node, data, overrides))
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

      fragment.appendChild(renderConditional(branches, data, overrides))
      continue
    }

    fragment.appendChild(renderNode(node, data, overrides))
    i++
  }

  return fragment
}

export const renderComponent = (component: Component79, data: ReactiveDeepData<Record<string, any>>): Node =>
  renderNodes(component.template, data, {})

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

