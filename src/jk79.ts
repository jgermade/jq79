
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

const interpolate = (template: string, data: Record<string, any>): string =>
  template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => data[key] ?? "")

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

const renderComponent = (component: Component79, data: Record<string, any> = {}): Node => {
    const fragment = document.createDocumentFragment()
    
    component.template.forEach(node => {
        const el = document.createElement(node.tag)
        Object.entries(node.attrs).forEach(([key, value]) => {
            el.setAttribute(key, value)
        })
        node.children.forEach(child => {
            if (typeof child === "string") {
                el.appendChild(document.createTextNode(interpolate(child, data)))
            } else {
                el.appendChild(renderComponent(new Component79([child], [], []), data))
            }
        })
        fragment.appendChild(el)
    })
    return fragment
}

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

