import { parseHTML, type HTMLNode, type HTMLElementNode } from "./html"
import { transformSetupScript, transformFactoryScript, parsePropsPattern, parseFactoryProps } from "./transform"
import {
  COMPONENT_NAME_RE, COMPONENT_TAG_ATTR, EACH_PATTERN, EXPR_PARAMS, INSTANCE_HELPER_NAMES, PRECOMPILED_QUEUE,
  SETUP_HELPER_NAMES, functionText,
  assignment, declaredPropNames, defer, factoryBody, factoryParams, functionKey, isControlAttr, isSlotTag,
  kebabToCamel, prepareSource, readSetupSignature, scopedBody, setupBody, setupParams, splitText, withBody,
  type TagBlock, type TemplateNode,
} from "./source"

// ---------------------------------------------------------------------------
// precompile
//
// Every function the runtime would build for a component, found without
// rendering it: each expression in its template, each of its scripts, each
// prop default - as the [params, body] pairs makeFunction would be handed, so
// a table of them answers its lookups (see "safe eval" in jq79.ts). What renders
// nothing still counts: a branch not taken, a handler never clicked, a :each
// over an empty list are all here because each *could* run.
//
// It reads a file the way parseComponentString does - the same pre-parse
// rewrites, the same split into the file's own component and its named
// <template>s - with parseHTML standing in for DOMParser, which node and a
// worker don't have. It reads a template the way the renderer does, directive
// by directive, and builds each body with the same functions the runtime
// compiles with (withBody, scopedBody, setupBody, factoryBody), so a key can
// only match. Where the renderer's answer depends on the page - which scope
// key a component tag resolves to - it takes every plausible one: an extra
// function is an entry nobody looks up. What it can't see is a miss, and safe
// mode reports a miss by name. tests/precompile.test.ts holds it against what
// the runtime actually compiles
// ---------------------------------------------------------------------------

export type Precompiled = [params: string[], body: string]

const isElementNode = (node: HTMLNode): node is HTMLElementNode => typeof node !== "string"

// mirrors elementToAST: the component stamp lifted off attrs into a field
const toTemplateNode = (el: HTMLElementNode): TemplateNode => {
  const { [COMPONENT_TAG_ATTR]: component, ...attrs } = el.attrs
  return {
    tag: el.tag,
    attrs,
    ...(component === undefined ? {} : { component }),
    children: el.children.map(child => (typeof child === "string" ? child : toTemplateNode(child))),
  }
}

const textOf = (el: HTMLElementNode): string => el.children.map(child => (typeof child === "string" ? child : textOf(child))).join("")

// the scope keys a tag can resolve to. findComponentKey matches any
// capitalized key that equals the tag once dashes and case are gone, so the
// key itself comes from the page; these are the spellings the file offers -
// the tag as written, its PascalCase, and every capitalized name the file
// declares that matches
const componentKeyCandidates = (node: TemplateNode, known: string[]): string[] => {
  const tag = node.component ?? node.tag
  const normalized = tag.replace(/-/g, "").toLowerCase()
  const keys = new Set(known.filter(name => /^[A-Z]/.test(name) && name.replace(/-/g, "").toLowerCase() === normalized))
  keys.add(node.component ?? kebabToCamel(node.tag).replace(/^./, c => c.toUpperCase()))
  return [...keys]
}

type AddExpression = (expr: string, extras?: string[]) => void

// every expression a template can evaluate, walked as renderNodes, renderNode,
// renderEach, renderConditional, renderSlot and renderNestedComponent would
// walk it - each clause names the one it follows
const collectExpressions = (nodes: (TemplateNode | string)[], known: string[], add: AddExpression) => {
  for (const node of nodes) {
    // renderNodes: text with an interpolation in it
    if (typeof node === "string") {
      if (node.includes("{{")) splitText(node).forEach(part => { if (typeof part !== "string") add(part.expr) })
      continue
    }
    const attrs = node.attrs
    // renderConditional (chainOf), renderEach, and :with in renderNode - on any node
    if (":if" in attrs) add(attrs[":if"])
    if (":elseif" in attrs) add(attrs[":elseif"])
    if (":each" in attrs) {
      const match = attrs[":each"].match(EACH_PATTERN)
      if (match) add(match[3])
      if (":key" in attrs) add(attrs[":key"])
    }
    if (":with" in attrs) add(attrs[":with"])
    // bindSlotProps: a :slot binder's defaults, on a component tag or its <template>
    for (const attr in attrs) {
      if (attr === ":slot" || attr.startsWith(":slot.")) {
        parsePropsPattern(attrs[attr] || undefined)?.forEach(({ default: fallback }) => { if (fallback !== undefined) add(fallback) })
      }
    }

    if (isSlotTag(node.tag)) {
      // renderSlot: a <slot>'s props - read by name, not camelCased
      for (const attr in attrs) {
        if (isControlAttr(attr) || attr.startsWith("@") || !attr.startsWith(":")) continue
        add(attrs[attr] || attr.slice(1))
      }
    } else {
      // renderNestedComponent, for a tag that is or may become a component: the
      // key it resolves through, its props, spreads, models and tag events
      if (node.component !== undefined || node.tag.includes("-")) {
        componentKeyCandidates(node, known).forEach(key => add(key))
        for (const attr in attrs) {
          const value = attrs[attr]
          if (attr === ":props" || attr.startsWith(":props.")) add(value)
          else if (isControlAttr(attr)) continue
          else if (attr.startsWith("@")) add(value, ["$event"])
          else if (attr === ":model" || attr.startsWith(":model.")) {
            const expr = value || (attr === ":model" ? "model" : kebabToCamel(attr.slice(":model.".length)))
            add(expr)
            add(assignment(expr), ["$value"])
          } else if (attr.startsWith(":")) add(value || kebabToCamel(attr.slice(1)))
          else add(JSON.stringify(value))
        }
      }
      // renderNode, for the element it renders as (and a component tag renders
      // as, until it resolves): events, bindings, and the control directives
      for (const attr in attrs) {
        const value = attrs[attr]
        if (attr.startsWith("@")) add(value, ["$event"])
        else if (attr === ":model" || attr.startsWith(":model.")) continue
        else if (attr === ":class" || attr.startsWith(":class.") || attr === ":text" || attr === ":html" ||
          attr === ":html.allowed" || attr === ":value" || attr === ":checked" || attr === ":selected") add(value)
        else if (isControlAttr(attr)) continue
        else if (attr.startsWith(":")) add(value || kebabToCamel(attr.slice(1)))
      }
    }
    collectExpressions(node.children, known, add)
  }
}

// every function the runtime would build for the component in `source`, as
// the [params, body] makeFunction would be handed - see the note above
export const precompile = (source: string): Precompiled[] => {
  const found = new Map<string, Precompiled>()
  const add = (params: string[], body: string) => { found.set(functionKey(params, body), [params, body]) }
  // an expression compiles to its scoped form first, and falls back to (or is
  // demoted to) the `with` form - both, where the scoped one exists
  const addExpression: AddExpression = (expr, extras = []) => {
    const params = [...EXPR_PARAMS, ...extras]
    const scoped = scopedBody(expr, extras)
    if (scoped !== null) add(params, scoped)
    add(params, withBody(expr))
  }

  // parseComponentString's split: a top-level <template> declares another
  // component of the file (a valid name, first one wins), everything else is
  // the file's own
  const top = parseHTML(prepareSource(source)).filter(isElementNode)
  const siblings: string[] = []
  const components: HTMLElementNode[][] = [top.filter(el => el.tag !== "template")]
  top.filter(el => el.tag === "template").forEach(el => {
    const name = el.attrs.name
    if (name === undefined || !COMPONENT_NAME_RE.test(name) || siblings.includes(name)) return
    siblings.push(name)
    components.push(el.children.filter(isElementNode))
  })

  components.forEach(elements => precompileComponent(elements, siblings, add, addExpression))

  return [...found.values()]
}

const precompileComponent = (
  elements: HTMLElementNode[],
  siblings: string[],
  add: (params: string[], body: string) => void,
  addExpression: AddExpression
) => {
  const scripts: TagBlock[] = elements
    .filter(el => el.tag === "script")
    .map(el => ({ attrs: el.attrs, content: textOf(el) }))
  const template = elements.filter(el => el.tag !== "script" && el.tag !== "style").map(toTemplateNode)

  // the helper names a script is compiled with: renderWith's
  // { ...SETUP_HELPERS, ...instanceHelpers }, where instanceHelpers is
  // { $mounted, $self, $$self, ...injected, ...siblingScope } - key order
  // included, because the parameters are positional (built as objects, so a
  // sibling named like a helper keeps the helper's place, as it does there)
  //
  // Reading the signatures is also the first thing renderWith does, and where
  // it refuses a component - a factory destructuring a ctx name out of props
  // throws there, before anything compiles. Such a component has nothing to
  // precompile, and returning here leaves its error to the runtime, which is
  // where the page sees it, rather than failing the build (or the worker) on
  // its behalf
  let declared: Set<string>
  try {
    declared = declaredPropNames(scripts, readSetupSignature)
  } catch {
    return
  }
  const siblingScope = Object.fromEntries(siblings.filter(name => !declared.has(name)).map(name => [name, true]))
  const helperNames = Object.keys({
    ...Object.fromEntries(SETUP_HELPER_NAMES.map(name => [name, true])),
    ...Object.fromEntries(INSTANCE_HELPER_NAMES.map(name => [name, true])),
    ...siblingScope,
  })

  // the names the file declares, for the component tags that resolve to one
  const known = [...siblings]
  scripts.forEach(script => {
    const deferred = ":mounted" in script.attrs
    const factoryCode = transformFactoryScript(script.content)
    if (factoryCode !== null) {
      const props = parseFactoryProps(script.content)
      props?.forEach(({ name, default: fallback }) => { known.push(name); if (fallback !== undefined) addExpression(fallback) })
      add(factoryParams(helperNames), factoryBody(deferred ? defer(factoryCode) : factoryCode))
    } else {
      const { vars, code } = transformSetupScript(script.content)
      known.push(...vars)
      readSetupSignature(script)?.forEach(({ name, default: fallback }) => { known.push(name); if (fallback !== undefined) addExpression(fallback) })
      add(setupParams(helperNames), setupBody(deferred ? defer(code) : code))
    }
  })

  collectExpressions(template, known, addExpression)
}

// a component's precompiled functions as the classic script that registers
// them - classic, because they compile under `with`, which is a SyntaxError in
// strict code and every module is strict.
//
// `parses` says whether a function's text parses as that one function: `new
// Function` where eval is at hand (the Vite plugin, on node), a JavaScript
// parser where it isn't (the service worker). One that doesn't parse ships as
// null - the runtime's cached syntax error, which renders nothing, as it does
// under eval. And because only text that parses as a single function is ever
// written, no expression can close its function early and run what follows
// when the script loads
export const precompiledScript = (entries: Precompiled[], parses: (params: string[], body: string) => boolean): string => {
  const items = entries.map(([params, body]) =>
    `[${JSON.stringify(params)}, ${JSON.stringify(body)}, ${parses(params, body) ? functionText(params, body) : "null"}]`
  )
  return `(self.${PRECOMPILED_QUEUE} = self.${PRECOMPILED_QUEUE} || []).push(\n${items.join(",\n")}\n)\n`
}
