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
  afterEach(() => container.remove())

  // template, the data it renders against, and a mutation of that data - so
  // both the initial DOM and every binding's re-run are compared
  const CORPUS: [name: string, template: string, data: () => Record<string, any>, mutate: (data: any) => void][] = [
    ["plain markup", `<div class="a"><p class="b"><span class="c">hola</span></p><hr /></div>`, () => ({}), () => {}],
    ["interpolation", `<div class="a"><p>{{ who }}</p><p>hola {{ who }} adios</p><span>{{ n + 1 }}</span></div>`,
      () => ({ who: "mundo", n: 1 }), d => { d.who = "otro"; d.n = 41 }],
    ["events", `<div class="a"><button @click="hit()">go</button><a @click="hit()"><i>x</i></a></div>`,
      () => ({ hits: 0, hit() { this.hits++ } }), () => {}],
    [":class in every spelling", `<div class="a" :class="{ on: flag }"><p class="b" :class="theme"></p><span :class.warn="flag"></span></div>`,
      () => ({ flag: false, theme: "dark" }), d => { d.flag = true; d.theme = "light" }],
    [":attr bindings", `<div class="a"><img :src="url" /><button :disabled="busy">b</button><div :aria-expanded="open"></div></div>`,
      () => ({ url: "/x.png", busy: false, open: true, ariaExpanded: true }), d => { d.url = "/y.png"; d.busy = true; d.open = false }],
    ["deep nesting", `<div class="a"><div class="b"><div class="c"><div class="d"><span>{{ v }}</span></div></div></div></div>`,
      () => ({ v: 1 }), d => { d.v = 2 }],
    ["whitespace between siblings", `<p class="a">\n  <span>uno</span>\n  <span>dos</span>\n  hola <b>{{ who }}</b> adios\n</p>`,
      () => ({ who: "mundo" }), d => { d.who = "otro" }],
    [":each of a plain row", `<ul class="a"><li :each="item in items" :key="item.id" class="row"><span class="i">{{ item.id }}</span><b>{{ item.label }}</b></li></ul>`,
      () => ({ items: [{ id: 1, label: "a" }, { id: 2, label: "b" }] }),
      d => { d.items = [{ id: 2, label: "b2" }, { id: 3, label: "c" }] }],
    [":if chain", `<div class="a"><p :if="n > 8">alto</p><p :elseif="n > 4">medio</p><p :else>bajo</p><hr /></div>`,
      () => ({ n: 1 }), d => { d.n = 6 }],
    [":with", `<div class="a"><section :with="user"><b>{{ name }}</b><i>{{ email }}</i></section></div>`,
      () => ({ user: { name: "ada", email: "a@b" } }), d => { d.user = { name: "grace", email: "g@h" } }],
    [":text and :html", `<div class="a"><p :text="v"></p><div :html="markup"></div></div>`,
      () => ({ v: "x", markup: "<b>y</b>" }), d => { d.v = "z"; d.markup = "<i>w</i>" }],
    [":attrs", `<div class="a"><button :attrs="{ title, disabled }">b</button></div>`,
      () => ({ title: "t", disabled: false }), d => { d.title = "t2"; d.disabled = true }],
    ["form state", `<form class="a"><input :value="name" /><input type="checkbox" :checked="ok" /><select :value="lang"><option value="en">en</option><option value="es">es</option></select></form>`,
      () => ({ name: "ada", ok: false, lang: "en" }), d => { d.name = "grace"; d.ok = true; d.lang = "es" }],
    ["an unknown tag stays interpreted", `<div class="a"><weird-thing class="w"><span>x</span></weird-thing><svg class="s"><circle /></svg></div>`,
      () => ({}), () => {}],
    ["a nested component", `<div class="a"><p class="b">{{ v }}</p><Chip :label="v" /><p class="c">{{ v }}</p></div>`,
      () => ({ v: "x", Chip: parseComponent(`<span class="chip">{{ label }}</span>`) }), d => { d.v = "y" }],
    ["a scope key that captures an HTML tag", `<table class="a"><tr><td class="c1">plano</td><td class="c2">plano</td></tr></table>`,
      () => ({ Td: parseComponent(`<span class="captured">tomado</span>`) }), () => {}],
    // the five directives the cloner learned to fill in
    // TODOS/2026-08-24.more-holes-in-the-cloner.md. They keep the container they
    // had as trip wires - a wrapper that is otherwise perfectly clonable and big
    // enough to be planned - because that is the only shape in which a hole is
    // reached through the clone path at all
    [":text in a planned subtree", `<div class="w"><span class="p">uno</span><p class="q" :text="v"></p><span class="r">dos</span></div>`,
      () => ({ v: "x" }), d => { d.v = "y" }],
    [":text over children the interpreted path never renders", `<div class="w"><span class="p">uno</span><p class="q" :text="v"><b>{{ ignored }}</b><Chip :label="v" /></p><span class="r">dos</span></div>`,
      () => ({ v: "x", ignored: "no", Chip: parseComponent(`<span class="chip">{{ label }}</span>`) }), d => { d.v = "y"; d.ignored = "still no" }],
    [":attrs in a planned subtree", `<div class="w"><span class="p">uno</span><p class="q" :attrs="{ title }">x</p><span class="r">dos</span></div>`,
      () => ({ title: "t" }), d => { d.title = "t2" }],
    [":attrs dropping a key it set", `<div class="w"><span class="p">uno</span><p class="q" :attrs="bag">x</p><span class="r">dos</span></div>`,
      () => ({ bag: { title: "t", lang: "es" } }), d => { d.bag = { title: "t2" } }],
    [":value in a planned subtree", `<form class="w"><span class="p">uno</span><input class="q" :value="v" /><span class="r">dos</span></form>`,
      () => ({ v: "a" }), d => { d.v = "b" }],
    [":checked in a planned subtree", `<form class="w"><span class="p">uno</span><input class="q" type="checkbox" :checked="on" /><span class="r">dos</span></form>`,
      () => ({ on: false }), d => { d.on = true }],
    [":selected in a planned subtree", `<div class="w"><span class="p">uno</span><select class="q"><option value="a" :selected="pick">a</option><option value="b">b</option></select></div>`,
      () => ({ pick: true }), d => { d.pick = false }],
    // the reason the order axis exists. The select's :value must register after
    // its options' bindings; nothing about the resulting DOM says so, because
    // the property :value writes is not in innerHTML and the options exist in
    // the clone either way. The read log is what tells the two orders apart
    [":value on a select whose options are bound", `<div class="w"><span class="p">uno</span><select class="q" :value="pick"><option :attrs="{ value: a }">A</option><option :attrs="{ value: b }">B</option></select><span class="r">dos</span></div>`,
      () => ({ pick: "b", a: "a", b: "b" }), d => { d.pick = "a" }],
    ["a mixed row", `<table class="a"><tbody><tr :each="row in rows" :key="row.id" :class="{ danger: row.id === sel }">
        <td class="c1">{{ row.id }}</td>
        <td class="c2"><a @click="sel = row.id">{{ row.label }}</a></td>
        <td class="c3"><Chip :label="row.label" /></td>
        <td class="c4"><div class="card"><span class="ico"></span><span class="ttl">{{ row.label }}</span></div></td>
      </tr></tbody></table>`,
      () => ({ rows: [{ id: 1, label: "a" }, { id: 2, label: "b" }], sel: null, Chip: parseComponent(`<span class="chip">{{ label }}</span>`) }),
      d => { d.sel = 2; d.rows[0].label = "a2" }],
  ]

  // One entry per thing that changes a subtree's SHAPE, each sitting inside a
  // container that is otherwise perfectly clonable and big enough to be planned.
  // These are the trip wires: admit any of them to plannableAttr (or to the tag
  // rules) without implementing it, and the diff fires. Written after a
  // deliberate sabotage - `:text` added to the allowlist - went unnoticed
  // because nothing in the corpus above put one inside a planned subtree.
  const SHAPE_CORPUS: [name: string, template: string, data: () => Record<string, any>, mutate: (data: any) => void][] = [
    [":html", `<div class="w"><span class="p">uno</span><p class="q" :html="markup"></p><span class="r">dos</span></div>`,
      () => ({ markup: "<b>x</b>" }), d => { d.markup = "<i>y</i>" }],
    [":if", `<div class="w"><span class="p">uno</span><p class="q" :if="on">si</p><span class="r">dos</span></div>`,
      () => ({ on: true }), d => { d.on = false }],
    [":each", `<div class="w"><span class="p">uno</span><p class="q" :each="n in ns">{{ n }}</p><span class="r">dos</span></div>`,
      () => ({ ns: [1, 2] }), d => { d.ns = [3] }],
    [":with", `<div class="w"><span class="p">uno</span><p class="q" :with="user"><b>{{ name }}</b></p><span class="r">dos</span></div>`,
      () => ({ user: { name: "ada" } }), d => { d.user = { name: "grace" } }],
    // on a plain element :model binds nothing and warns - and unlike every other
    // directive that falls through, it is not in CONTROL_ATTRS, so the allowlist
    // used to accept it as a generic `:<name>` binding and the skeleton wrote
    // `model="ada"` where the interpreted path wrote nothing. The existing entry
    // below puts :model on a component tag, which is unplannable for a different
    // reason, so it could never have caught this
    [":model on a plain element", `<div class="w"><span class="p">uno</span><input class="q" :model="who" /><span class="r">dos</span></div>`,
      () => ({ who: "ada" }), d => { d.who = "grace" }],
    [":model on a component tag", `<div class="w"><span class="p">uno</span><Field :model.name="who" /><span class="r">dos</span></div>`,
      () => ({ who: "ada", Field: parseComponent(`<script :setup>let name = ""</script><b class="f">{{ name }}</b>`) }),
      d => { d.who = "grace" }],
    ["a props spread", `<div class="w"><span class="p">uno</span><Chip ...props /><span class="r">dos</span></div>`,
      () => ({ props: { label: "x" }, Chip: parseComponent(`<span class="chip">{{ label }}</span>`) }),
      d => { d.props = { label: "y" } }],
    ["a component tag", `<div class="w"><span class="p">uno</span><Chip :label="v" /><span class="r">dos</span></div>`,
      () => ({ v: "x", Chip: parseComponent(`<span class="chip">{{ label }}</span>`) }), d => { d.v = "y" }],
    ["a dashed tag", `<div class="w"><span class="p">uno</span><drop-area class="q"><b>x</b></drop-area><span class="r">dos</span></div>`,
      () => ({}), () => {}],
    ["a nested template element", `<div class="w"><span class="p">uno</span><template class="q"><b>x</b></template><span class="r">dos</span></div>`,
      () => ({}), () => {}],
    ["an svg", `<div class="w"><span class="p">uno</span><svg class="q"><circle r="1" /></svg><span class="r">dos</span></div>`,
      () => ({}), () => {}],
    // the upgrade watch: an unknown, undashed tag is a component that has not
    // arrived yet (an async factory writes the key in after the template has
    // rendered), and the interpreted path swaps it when it does. Nothing in a
    // clone can watch for that, which is why an unknown tag is never plannable
    ["a tag that becomes a component after mount", `<div class="w"><span class="p">uno</span><mychip></mychip><span class="r">dos</span></div>`,
      () => ({}), d => { d.MyChip = parseComponent(`<b class="chip">llegué</b>`) }],
    ["a slot", `<div class="w"><span class="p">uno</span><Panel><b class="in">dentro</b></Panel><span class="r">dos</span></div>`,
      () => ({ Panel: parseComponent(`<section class="panel"><slot /></section>`) }), () => {}],
  ]

  ;[...CORPUS, ...SHAPE_CORPUS].forEach(([name, template, makeData, mutate]) => {
    it(`${name}`, () => {
      const [before, after] = bothWays(() => {
        const host = document.createElement("div")
        container.appendChild(host)
        const [raw, reads] = probe(makeData())
        const data = $reactive(raw)
        host.appendChild(renderComponent(parseComponent(template), data))
        const initial = host.innerHTML
        const registered = [...reads]
        mutate(data)
        return { initial, registered, mutated: host.innerHTML }
      })

      expect(after.initial).toBe(before.initial)
      expect(after.mutated).toBe(before.mutated)
      expect(after.registered, "the bindings register in a different order").toEqual(before.registered)
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

describe("the clone path renders every tutorial exercise identically", () => {
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    error = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => { warn.mockRestore(); error.mockRestore() })

  exercises.forEach(([name, files]) => {
    it(name, async () => {
      // the tutorial's own preview logic, as tests/tutorial.test.ts does it:
      // sibling files become the entry's pre-resolved modules
      const mount = async () => {
        const host = document.createElement("div")
        document.body.appendChild(host)
        const modules: Record<string, Component79> = {}
        Object.entries(files)
          .filter(([file]) => file !== ENTRY)
          .forEach(([file, source]) => { modules[`./${file}`] = new Component79(source) })
        new Component79(files[ENTRY], { modules }).mountShadow(host)
        // a setup script that awaits renders on a later tick, and one exercise
        // (03-components/08-slots) settles a tick after the first: read when the
        // DOM stops moving rather than at a fixed tick, or the comparison races
        // the component and reports it as a clone-path difference
        const read = () => (host.shadowRoot ?? host).innerHTML
        const tick = () => new Promise(resolve => setTimeout(resolve, 0))
        // a few ticks before believing anything: an await'd setup script leaves
        // the DOM empty *and stable* until it resolves, so stopping at the first
        // pair of equal reads returns the empty one
        for (let i = 0; i < 3; i++) await tick()
        let html = read()
        for (let i = 0; i < 12; i++) {
          await tick()
          const next = read()
          if (next === html) break
          html = next
        }
        host.remove()
        return html
      }

      const { cloneSkeletons: was } = Component79.debug()
      try {
        setClone(false)
        // the null control, inside the test: two interpreted mounts must agree
        // before a cloned one can be judged against them. An exercise that is
        // not deterministic across mounts fails as that, not as a clone bug
        const interpreted = await mount()
        const again = await mount()
        expect(again, "this exercise does not render the same twice").toBe(interpreted)

        setClone(true)
        const cloned = await mount()
        expect(cloned).toBe(interpreted)
      } finally {
        setClone(was)
      }
    })
  })
})
