import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Component79, parseComponent, renderComponent, $reactive } from "../src/jq79"

// The differential test for the clone path.
//
// renderNode and the skeleton cloner are two ways of turning one template into
// DOM, and a second render path is only safe while the two cannot disagree.
// "Forgot to teach the cloner" is meant to be a failing test here, not stale
// DOM in production - so every template below is rendered BOTH WAYS and diffed,
// then mutated and diffed again (the shape proves nothing if the holes are
// wired wrong).
//
// Adding a directive to renderNode without teaching the cloner is not a bug the
// allowlist can produce - an unknown attribute makes its subtree unplannable -
// but adding one to the *allowlist* without implementing it is, and that is
// what this catches.

const setClone = (on: boolean) => Component79.debug({ cloneSkeletons: on })

// The second axis: the order the bindings are REGISTERED in, not just the DOM
// they produce.
//
// Diffing the DOM cannot see an ordering bug, because reversing plan.ops moves
// no markup - :value on a <select> picks an <option> whose existence the clone
// path guarantees either way, and the property it writes is not in innerHTML.
// So the ops grew an "after the children" phase with nothing watching it.
//
// This watches it, without a hook into the library: every value in the scope is
// an accessor that logs its own name, every effect evaluates its expression when
// it is registered, and every expression resolves its names through the store
// proxy onto this object. Where each binding in a template reads a distinct
// name, the read log IS the registration order.
//
// It compares the two paths against each other, so a change that reorders both
// identically still passes - which is the trade a differential test makes
const probe = (values: Record<string, any>): [Record<string, any>, string[]] => {
  const reads: string[] = []
  const raw: Record<string, any> = {}
  Object.keys(values).forEach(key => {
    let value = values[key]
    Object.defineProperty(raw, key, {
      enumerable: true,
      configurable: true,
      get() { reads.push(key); return value },
      set(next) { value = next },
    })
  })
  return [raw, reads]
}

// Did the clone path actually RUN?
//
// Every assertion in this file is of the form "the two paths agree", and two
// paths agree when the second one never runs. That is not hypothetical: making
// the plan on the second render took the corpus from 26 entries reaching the
// cloner to 5, with every test still green
// (TODOS/2026-08-24.plan-on-the-second-render.md). It was caught by hand.
//
// renderFromSkeleton's `plan.skeleton.cloneNode(true)` is the library's ONLY
// deep clone - the one other cloneNode in src/ is the sanitizer copying a text
// node, shallow - so counting deep clones through the prototype is exactly the
// question "did the cloner run", and nothing ships to the browser to answer it.
// A counter behind a debug flag was rejected for the reason its sibling was:
// a test that runs a configuration no page runs is how a second render path
// gets a bug only production sees.
//
// Captured before anything wraps it, and restored from here rather than from
// whatever was in place at the call - so a test that throws mid-count cannot
// leave the prototype wrapped for the tests after it (the afterEach in each
// block below is the second half of that)
const nativeCloneNode = Node.prototype.cloneNode

// Returns the stop: it puts the prototype back and hands over the count
const cloneCounter = (): (() => number) => {
  let clones = 0
  Node.prototype.cloneNode = function (this: Node, deep?: boolean) {
    if (deep === true) clones++
    return nativeCloneNode.call(this, deep)
  } as typeof Node.prototype.cloneNode
  return () => {
    Node.prototype.cloneNode = nativeCloneNode
    return clones
  }
}

// When an entry is expected to reach the clone path:
//
//   never   unplannable, or under MIN_SKELETON_ELEMENTS - the trip wires
//   second  one instance per render: the first is interpreted, the second clones
//   both    a :each - the row renders twice inside one render, so both clone
type Reach = "never" | "second" | "both"

type Entry = [name: string, template: string, data: () => Record<string, any>, mutate: (data: any) => void, reach: Reach]

const bothWays = <T>(render: () => T): [T, T] => {
  const { cloneSkeletons: was } = Component79.debug()
  try {
    setClone(false)
    const interpreted = render()
    setClone(true)
    const cloned = render()
    return [interpreted, cloned]
  } finally {
    setClone(was)
  }
}

describe("the clone path renders what the interpreted path renders", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })
  afterEach(() => {
    container.remove()
    Node.prototype.cloneNode = nativeCloneNode
  })

  // template, the data it renders against, a mutation of that data - so both
  // the initial DOM and every binding's re-run are compared - and whether this
  // entry is expected to reach the clone path at all (see Reach above)
  const CORPUS: Entry[] = [
    ["plain markup", `<div class="a"><p class="b"><span class="c">hola</span></p><hr /></div>`, () => ({}), () => {}, "second"],
    ["interpolation", `<div class="a"><p>{{ who }}</p><p>hola {{ who }} adios</p><span>{{ n + 1 }}</span></div>`,
      () => ({ who: "mundo", n: 1 }), d => { d.who = "otro"; d.n = 41 }, "second"],
    ["events", `<div class="a"><button @click="hit()">go</button><a @click="hit()"><i>x</i></a></div>`,
      () => ({ hits: 0, hit() { this.hits++ } }), () => {}, "second"],
    [":class in every spelling", `<div class="a" :class="{ on: flag }"><p class="b" :class="theme"></p><span :class.warn="flag"></span></div>`,
      () => ({ flag: false, theme: "dark" }), d => { d.flag = true; d.theme = "light" }, "second"],
    [":attr bindings", `<div class="a"><img :src="url" /><button :disabled="busy">b</button><div :aria-expanded="open"></div></div>`,
      () => ({ url: "/x.png", busy: false, open: true, ariaExpanded: true }), d => { d.url = "/y.png"; d.busy = true; d.open = false }, "second"],
    ["deep nesting", `<div class="a"><div class="b"><div class="c"><div class="d"><span>{{ v }}</span></div></div></div></div>`,
      () => ({ v: 1 }), d => { d.v = 2 }, "second"],
    ["whitespace between siblings", `<p class="a">\n  <span>uno</span>\n  <span>dos</span>\n  hola <b>{{ who }}</b> adios\n</p>`,
      () => ({ who: "mundo" }), d => { d.who = "otro" }, "second"],
    [":each of a plain row", `<ul class="a"><li :each="item in items" :key="item.id" class="row"><span class="i">{{ item.id }}</span><b>{{ item.label }}</b></li></ul>`,
      () => ({ items: [{ id: 1, label: "a" }, { id: 2, label: "b" }] }),
      d => { d.items = [{ id: 2, label: "b2" }, { id: 3, label: "c" }] }, "both"],
    [":if chain", `<div class="a"><p :if="n > 8">alto</p><p :elseif="n > 4">medio</p><p :else>bajo</p><hr /></div>`,
      () => ({ n: 1 }), d => { d.n = 6 }, "never"],
    [":with", `<div class="a"><section :with="user"><b>{{ name }}</b><i>{{ email }}</i></section></div>`,
      () => ({ user: { name: "ada", email: "a@b" } }), d => { d.user = { name: "grace", email: "g@h" } }, "never"],
    [":text and :html", `<div class="a"><p :text="v"></p><div :html="markup"></div></div>`,
      () => ({ v: "x", markup: "<b>y</b>" }), d => { d.v = "z"; d.markup = "<i>w</i>" }, "second"],
    [":attrs", `<div class="a"><button :attrs="{ title, disabled }">b</button></div>`,
      () => ({ title: "t", disabled: false }), d => { d.title = "t2"; d.disabled = true }, "never"],
    ["form state", `<form class="a"><input :value="name" /><input type="checkbox" :checked="ok" /><select :value="lang"><option value="en">en</option><option value="es">es</option></select></form>`,
      () => ({ name: "ada", ok: false, lang: "en" }), d => { d.name = "grace"; d.ok = true; d.lang = "es" }, "second"],
    ["an unknown tag stays interpreted", `<div class="a"><weird-thing class="w"><span>x</span></weird-thing></div>`,
      () => ({}), () => {}, "never"],
    ["a nested component", `<div class="a"><p class="b">{{ v }}</p><Chip :label="v" /><p class="c">{{ v }}</p></div>`,
      () => ({ v: "x", Chip: parseComponent(`<span class="chip">{{ label }}</span>`) }), d => { d.v = "y" }, "never"],
    ["a scope key that captures an HTML tag", `<table class="a"><tr><td class="c1">plano</td><td class="c2">plano</td></tr></table>`,
      () => ({ Td: parseComponent(`<span class="captured">tomado</span>`) }), () => {}, "never"],
    // the five directives the cloner learned to fill in
    // TODOS/2026-08-24.more-holes-in-the-cloner.md. They keep the container they
    // had as trip wires - a wrapper that is otherwise perfectly clonable and big
    // enough to be planned - because that is the only shape in which a hole is
    // reached through the clone path at all
    [":text in a planned subtree", `<div class="w"><span class="p">uno</span><p class="q" :text="v"></p><span class="r">dos</span></div>`,
      () => ({ v: "x" }), d => { d.v = "y" }, "second"],
    [":text over children the interpreted path never renders", `<div class="w"><span class="p">uno</span><p class="q" :text="v"><b>{{ ignored }}</b><Chip :label="v" /></p><span class="r">dos</span></div>`,
      () => ({ v: "x", ignored: "no", Chip: parseComponent(`<span class="chip">{{ label }}</span>`) }), d => { d.v = "y"; d.ignored = "still no" }, "second"],
    // :html sat in SHAPE_CORPUS proving its subtree fell through. It is a hole
    // the skeleton fills now (TODOS/2026-08-25.html-in-the-cloner.md), so what
    // it proves moved: both paths sanitize the same value into the same DOM,
    // and the children written inside it are rendered by neither
    [":html in a planned subtree", `<div class="w"><span class="p">uno</span><p class="q" :html="markup"><b>{{ ignored }}</b></p><span class="r">dos</span></div>`,
      () => ({ markup: "<b>x</b>", ignored: "no" }), d => { d.markup = "<i>y</i>"; d.ignored = "still no" }, "second"],
    [":attrs in a planned subtree", `<div class="w"><span class="p">uno</span><p class="q" :attrs="{ title }">x</p><span class="r">dos</span></div>`,
      () => ({ title: "t" }), d => { d.title = "t2" }, "second"],
    [":attrs dropping a key it set", `<div class="w"><span class="p">uno</span><p class="q" :attrs="bag">x</p><span class="r">dos</span></div>`,
      () => ({ bag: { title: "t", lang: "es" } }), d => { d.bag = { title: "t2" } }, "second"],
    [":value in a planned subtree", `<form class="w"><span class="p">uno</span><input class="q" :value="v" /><span class="r">dos</span></form>`,
      () => ({ v: "a" }), d => { d.v = "b" }, "second"],
    [":checked in a planned subtree", `<form class="w"><span class="p">uno</span><input class="q" type="checkbox" :checked="on" /><span class="r">dos</span></form>`,
      () => ({ on: false }), d => { d.on = true }, "second"],
    [":selected in a planned subtree", `<div class="w"><span class="p">uno</span><select class="q"><option value="a" :selected="pick">a</option><option value="b">b</option></select></div>`,
      () => ({ pick: true }), d => { d.pick = false }, "second"],
    // the reason the order axis exists. The select's :value must register after
    // its options' bindings; nothing about the resulting DOM says so, because
    // the property :value writes is not in innerHTML and the options exist in
    // the clone either way. The read log is what tells the two orders apart
    [":value on a select whose options are bound", `<div class="w"><span class="p">uno</span><select class="q" :value="pick"><option :attrs="{ value: a }">A</option><option :attrs="{ value: b }">B</option></select><span class="r">dos</span></div>`,
      () => ({ pick: "b", a: "a", b: "b" }), d => { d.pick = "a" }, "second"],
    // <svg> used to be rejected by plannableNode as an HTMLUnknownElement, so it
    // sat in SHAPE_CORPUS proving it fell through. It is a real namespaced
    // element now (TODOS/2026-08-24.svg-namespace.md) and therefore plannable,
    // so what it proves moved: the cloner has to build it in the same namespace
    // the interpreted path does, or the two disagree about `viewBox`
    ["an svg", `<div class="w"><span class="p">uno</span><svg class="q" viewBox="0 0 10 10"><circle cx="5" r="4" :fill="color" /></svg><span class="r">dos</span></div>`,
      () => ({ color: "red" }), d => { d.color = "blue" }, "second"],
    ["an svg with camelCase tags", `<div class="w"><span class="p">uno</span><svg class="q"><defs><linearGradient id="g"><stop :offset="at" /></linearGradient><clipPath id="c"><circle r="1" /></clipPath></defs></svg><span class="r">dos</span></div>`,
      () => ({ at: "0" }), d => { d.at = "1" }, "second"],
    ["a foreignObject hands the namespace back", `<div class="w"><span class="p">uno</span><svg class="q"><foreignObject><p>{{ v }}</p></foreignObject></svg><span class="r">dos</span></div>`,
      () => ({ v: "x" }), d => { d.v = "y" }, "second"],
    // a bound camelCase name is resolved against the parser's adjust table
    // (TODOS/2026-08-25.svg-attribute-names.md), and the resolution happens in
    // two places - once per instance interpreted, once per definition in the
    // plan. This is what says the two agree about which attribute they wrote
    ["an svg with a bound camelCase attribute", `<div class="w"><span class="p">uno</span><svg class="q" :viewBox="box"><circle r="1" :stroke-width="sw" /></svg><span class="r">dos</span></div>`,
      () => ({ box: "0 0 10 10", sw: 2 }), d => { d.box = "0 0 20 20"; d.sw = 4 }, "second"],
    // MathML rides on the same AST field <svg> does, so the cloner has to build
    // it in its own namespace for the same reason - TODOS/2026-08-24.mathml.md
    ["a math", `<div class="w"><span class="p">uno</span><math class="q" display="block"><mrow><mi :mathcolor="color">x</mi><mn>{{ n }}</mn></mrow></math><span class="r">dos</span></div>`,
      () => ({ color: "red", n: 1 }), d => { d.color = "blue"; d.n = 2 }, "second"],
    ["a mixed row", `<table class="a"><tbody><tr :each="row in rows" :key="row.id" :class="{ danger: row.id === sel }">
        <td class="c1">{{ row.id }}</td>
        <td class="c2"><a @click="sel = row.id">{{ row.label }}</a></td>
        <td class="c3"><Chip :label="row.label" /></td>
        <td class="c4"><div class="card"><span class="ico"></span><span class="ttl">{{ row.label }}</span></div></td>
      </tr></tbody></table>`,
      () => ({ rows: [{ id: 1, label: "a" }, { id: 2, label: "b" }], sel: null, Chip: parseComponent(`<span class="chip">{{ label }}</span>`) }),
      d => { d.sel = 2; d.rows[0].label = "a2" }, "both"],
  ]

  // One entry per thing that changes a subtree's SHAPE, each sitting inside a
  // container that is otherwise perfectly clonable and big enough to be planned.
  // These are the trip wires: admit any of them to plannableAttr (or to the tag
  // rules) without implementing it, and the diff fires. Written after a
  // deliberate sabotage - `:text` added to the allowlist - went unnoticed
  // because nothing in the corpus above put one inside a planned subtree.
  const SHAPE_CORPUS: Entry[] = [
    // the surviving half of the pair. :html is a hole the skeleton fills;
    // :html.allowed must go on making its subtree unplannable, because
    // renderNode is the only place its "without :html" warning may fire from
    // and an interpreted element is what keeps it there
    [":html.allowed", `<div class="w"><span class="p">uno</span><p class="q" :html="markup" :html.allowed="policy"></p><span class="r">dos</span></div>`,
      () => ({ markup: `<a href="https://x.test/a">x</a>`, policy: "x.test" }),
      d => { d.markup = `<a href="https://y.test/b">y</a>` }, "never"],
    [":if", `<div class="w"><span class="p">uno</span><p class="q" :if="on">si</p><span class="r">dos</span></div>`,
      () => ({ on: true }), d => { d.on = false }, "never"],
    [":each", `<div class="w"><span class="p">uno</span><p class="q" :each="n in ns">{{ n }}</p><span class="r">dos</span></div>`,
      () => ({ ns: [1, 2] }), d => { d.ns = [3] }, "never"],
    [":with", `<div class="w"><span class="p">uno</span><p class="q" :with="user"><b>{{ name }}</b></p><span class="r">dos</span></div>`,
      () => ({ user: { name: "ada" } }), d => { d.user = { name: "grace" } }, "never"],
    // on a plain element :model binds nothing and warns - and unlike every other
    // directive that falls through, it is not in CONTROL_ATTRS, so the allowlist
    // used to accept it as a generic `:<name>` binding and the skeleton wrote
    // `model="ada"` where the interpreted path wrote nothing. The existing entry
    // below puts :model on a component tag, which is unplannable for a different
    // reason, so it could never have caught this
    [":model on a plain element", `<div class="w"><span class="p">uno</span><input class="q" :model="who" /><span class="r">dos</span></div>`,
      () => ({ who: "ada" }), d => { d.who = "grace" }, "never"],
    [":model on a component tag", `<div class="w"><span class="p">uno</span><Field :model.name="who" /><span class="r">dos</span></div>`,
      () => ({ who: "ada", Field: parseComponent(`<script :setup>let name = ""</script><b class="f">{{ name }}</b>`) }),
      d => { d.who = "grace" }, "never"],
    ["a props spread", `<div class="w"><span class="p">uno</span><Chip ...props /><span class="r">dos</span></div>`,
      () => ({ props: { label: "x" }, Chip: parseComponent(`<span class="chip">{{ label }}</span>`) }),
      d => { d.props = { label: "y" } }, "never"],
    ["a component tag", `<div class="w"><span class="p">uno</span><Chip :label="v" /><span class="r">dos</span></div>`,
      () => ({ v: "x", Chip: parseComponent(`<span class="chip">{{ label }}</span>`) }), d => { d.v = "y" }, "never"],
    ["a dashed tag", `<div class="w"><span class="p">uno</span><drop-area class="q"><b>x</b></drop-area><span class="r">dos</span></div>`,
      () => ({}), () => {}, "never"],
    ["a nested template element", `<div class="w"><span class="p">uno</span><template class="q"><b>x</b></template><span class="r">dos</span></div>`,
      () => ({}), () => {}, "never"],
    // the upgrade watch: an unknown, undashed tag is a component that has not
    // arrived yet (an async factory writes the key in after the template has
    // rendered), and the interpreted path swaps it when it does. Nothing in a
    // clone can watch for that, which is why an unknown tag is never plannable
    ["a tag that becomes a component after mount", `<div class="w"><span class="p">uno</span><mychip></mychip><span class="r">dos</span></div>`,
      () => ({}), d => { d.MyChip = parseComponent(`<b class="chip">llegué</b>`) }, "never"],
    ["a slot", `<div class="w"><span class="p">uno</span><Panel><b class="in">dentro</b></Panel><span class="r">dos</span></div>`,
      () => ({ Panel: parseComponent(`<section class="panel"><slot /></section>`) }), () => {}, "never"],
    // the one tag in either foreign namespace with a hyphen in it. plannableNode
    // rejects a dashed tag as a possible custom element and does not make the
    // foreign exception mayUpgrade now makes, so <annotation-xml> keeps its
    // whole <math> ancestor interpreted: slower, correct, and a trip wire if
    // anybody widens that rule - TODOS/2026-08-24.mathml.md
    ["an annotation-xml", `<div class="w"><span class="p">uno</span><math class="q"><annotation-xml encoding="text/html" :id="which"><p>{{ v }}</p></annotation-xml></math><span class="r">dos</span></div>`,
      () => ({ which: "uno", v: "x" }), d => { d.which = "dos"; d.v = "y" }, "never"],
  ]

  ;[...CORPUS, ...SHAPE_CORPUS].forEach(([name, template, makeData, mutate, reach]) => {
    it(`${name}`, () => {
      const [before, after] = bothWays(() => {
        // ONE parse, rendered TWICE. The plan is built on the second render
        // (TODOS/2026-08-24.plan-on-the-second-render.md), so a template parsed
        // fresh for every render would never reach the clone path and every
        // assertion below would pass without testing anything
        const component = parseComponent(template)
        const renderOnce = () => {
          const host = document.createElement("div")
          container.appendChild(host)
          const [raw, reads] = probe(makeData())
          const data = $reactive(raw)
          const clones = cloneCounter()
          host.appendChild(renderComponent(component, data))
          const initial = host.innerHTML
          const registered = [...reads]
          mutate(data)
          return { initial, registered, mutated: host.innerHTML, cloned: clones() > 0 }
        }
        return { first: renderOnce(), second: renderOnce() }
      })

      // the first render is interpreted on both arms, so this is a control: it
      // says the pair of renders is deterministic before the second is judged
      expect(after.first.initial, "the first render already differs").toBe(before.first.initial)
      // the one that matters - interpreted, against a render built by cloning
      expect(after.second.initial).toBe(before.second.initial)
      expect(after.second.mutated).toBe(before.second.mutated)
      expect(after.second.registered, "the bindings register in a different order").toEqual(before.second.registered)

      // and the assertions the three above are worthless without: that the
      // clone path ran at all. Counted, not inferred - the manual procedure
      // this replaces was a marker attribute and a count in prose
      // (TODOS/2026-08-24.clone-path-coverage-check.md)
      expect(before.first.cloned || before.second.cloned,
        "cloning is off on this arm and something cloned anyway").toBe(false)
      expect(after.first.cloned,
        reach === "both"
          ? "this entry renders its subtree more than once per render and used to clone inside the first one"
          : "the plan is built on the SECOND render, and this one cloned on the first").toBe(reach === "both")
      expect(after.second.cloned,
        reach === "never"
          ? "this entry is a trip wire and it just became plannable - the diffs above passed, but read why it clones now"
          : "this entry no longer reaches the clone path: every assertion above it passed without exercising the cloner").toBe(reach !== "never")
    })
  })
})

// Every tutorial exercise, start and solution, is a real component someone
// wrote to be read - a better corpus than anything written to be tested
const TUTORIAL = join(__dirname, "..", "tutorial")
const ENTRY = "app.html"

const sources = (dir: string): Record<string, string> => {
  try {
    const names = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".html"))
      .map(entry => entry.name)
      .sort((a, b) => (a === ENTRY ? -1 : b === ENTRY ? 1 : a.localeCompare(b)))
    return Object.fromEntries(names.map(name => [name, readFileSync(join(dir, name), "utf8")]))
  } catch {
    return {}
  }
}

const exercises = readdirSync(TUTORIAL, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.startsWith("_"))
  .flatMap(chapter =>
    readdirSync(join(TUTORIAL, chapter.name), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(exercise => {
        const dir = join(TUTORIAL, chapter.name, exercise.name)
        const variants: [string, Record<string, string>][] = [[`${chapter.name}/${exercise.name}`, sources(dir)]]
        const solution = join(dir, "solution")
        if (existsSync(solution)) variants.push([`${chapter.name}/${exercise.name} (solution)`, sources(solution)])
        return variants
      })
  )
  .filter(([, files]) => files[ENTRY] !== undefined)

// The tutorial half of the coverage check. Five of the 43 exercises reach the
// clone path; the rest are too small, or carry a :if / a component tag / a slot
// near the root. Asserted ONE WAY - every name here must clone - because an
// exercise that newly starts cloning is coverage, not a regression, and making
// somebody update a list in a test file to add a tutorial exercise is a toll on
// the wrong people. What one-way invites is a name that quietly matches nothing;
// the last test in this block is what closes that
const CLONING_EXERCISES = new Set([
  "01-basics/05-forms-and-scope",
  "01-basics/06-keys-and-identity",
  "01-basics/06-keys-and-identity (solution)",
  "03-components/01-nested-components (solution)",
  "03-components/06-spreading-props",
])

describe("the clone path renders every tutorial exercise identically", () => {
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    error = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
    error.mockRestore()
    Node.prototype.cloneNode = nativeCloneNode
  })

  exercises.forEach(([name, files]) => {
    it(name, async () => {
      // the tutorial's own preview logic, as tests/tutorial.test.ts does it:
      // sibling files become the entry's pre-resolved modules
      // built ONCE per arm and mounted twice. The plan is built on the second
      // render of a definition, so a component reparsed per mount would never
      // reach the clone path - and this whole describe block would pass while
      // testing nothing (TODOS/2026-08-24.plan-on-the-second-render.md)
      const build = () => {
        const modules: Record<string, Component79> = {}
        Object.entries(files)
          .filter(([file]) => file !== ENTRY)
          .forEach(([file, source]) => { modules[`./${file}`] = new Component79(source) })
        return new Component79(files[ENTRY], { modules })
      }

      // A tick is not a settle. This used to read the DOM after three ticks and
      // then stop at the first pair of equal reads, which is exactly enough on
      // an idle box and not enough on a loaded one: two consecutive macrotasks
      // can both land while a component's async work is still pending, and the
      // read returns an intermediate state. Seen failing as the NULL CONTROL -
      // two interpreted mounts of 03-components/03-shared-state disagreeing -
      // reproduced by running this file with every core busy.
      //
      // So: poll on a real delay until the DOM has been unchanged for a quiet
      // period, with a deadline. The same instrument tests/tutorial.test.ts
      // uses, and the same reason (§8 of TODOS/2026-08-24.open-after-pr-12.md)
      const QUIET_POLLS = 3
      const POLL_MS = 5
      const DEADLINE_MS = 2000
      const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

      const attach = (component: Component79) => {
        const host = document.createElement("div")
        document.body.appendChild(host)
        // the `{}` is load-bearing. mountShadow only renders when it has no
        // content yet, so mounting an already-rendered instance re-ATTACHES the
        // DOM it already built - the second mount would render nothing, reach
        // no plan, and compare a moved tree against itself. Passing data forces
        // renderWith, with exactly the arguments the no-data call makes
        component.mountShadow(host, {})
        return { host, read: () => (host.shadowRoot ?? host).innerHTML }
      }

      // the first mount, whose HTML nothing is known about yet
      const mount = async (component: Component79) => {
        const { host, read } = attach(component)
        const deadline = Date.now() + DEADLINE_MS
        let html = read()
        let quiet = 0
        while (quiet < QUIET_POLLS && Date.now() < deadline) {
          await wait(POLL_MS)
          const next = read()
          quiet = next === html ? quiet + 1 : 0
          html = next
        }
        host.remove()
        return html
      }

      // every mount after it. Waiting for a known answer is both faster and
      // stricter than settling again: it returns the moment the DOM matches,
      // and only spends the deadline when the answer is genuinely different -
      // which is a failing test either way
      const mountUntil = async (component: Component79, expected: string) => {
        const { host, read } = attach(component)
        const deadline = Date.now() + DEADLINE_MS
        let html = read()
        while (html !== expected && Date.now() < deadline) {
          await wait(POLL_MS)
          html = read()
        }
        host.remove()
        return html
      }

      const { cloneSkeletons: was } = Component79.debug()
      try {
        setClone(false)
        // the null control, inside the test: two interpreted mounts of one
        // component must agree before a cloned one can be judged against them.
        // An exercise that is not deterministic across mounts fails as that,
        // not as a clone bug
        const plain = build()
        const offClones = cloneCounter()
        const interpreted = await mount(plain)
        const again = await mountUntil(plain, interpreted)
        const clonedWithCloningOff = offClones() > 0
        expect(again, "this exercise does not render the same twice").toBe(interpreted)
        expect(clonedWithCloningOff, "cloning is off on this arm and something cloned anyway").toBe(false)

        setClone(true)
        // the first mount is the definition's first sighting and is interpreted
        // whatever the flag says; the second is the one built by cloning
        const cloning = build()
        await mountUntil(cloning, interpreted)
        const onClones = cloneCounter()
        const cloned = await mountUntil(cloning, interpreted)
        const reachedTheCloner = onClones() > 0
        expect(cloned).toBe(interpreted)
        // and whether the mount just compared went anywhere near the cloner
        if (CLONING_EXERCISES.has(name)) {
          expect(reachedTheCloner,
            "this exercise no longer reaches the clone path: the comparison above passed without exercising the cloner").toBe(true)
        }
      } finally {
        setClone(was)
      }
    })
  })

  // CLONING_EXERCISES is only worth what its names are worth: a renamed or
  // deleted exercise would drop out of the check without a word, which is the
  // exact failure this whole file is being taught to catch
  it("names exercises that exist", () => {
    const known = new Set(exercises.map(([name]) => name))
    expect([...CLONING_EXERCISES].filter(name => !known.has(name)),
      "these were renamed or removed - re-measure which exercises clone rather than just deleting the names").toEqual([])
  })
})
