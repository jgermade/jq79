
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { $, Component79 } from "../src/jq79"
import { freeIdentifiers } from "../src/transform"

// The names a template expression reads are extracted so it can be compiled
// without `with ($scope)` - see RECORD/2026-08-27.name-resolution-without-with.md.
// `null` means "keep `with`", and is the answer for everything the scanner will
// not vouch for.
describe("freeIdentifiers", () => {
  it("collects a name, and not the properties hanging off it", () => {
    expect(freeIdentifiers("row.label")).toEqual(["row"])
    expect(freeIdentifiers("a.b.c")).toEqual(["a"])
    expect(freeIdentifiers("user?.name")).toEqual(["user"])
  })

  it("tells an object-literal key from a ternary's colon", () => {
    expect(freeIdentifiers("{ danger: selected }")).toEqual(["selected"])
    expect(freeIdentifiers("{ readonly }")).toEqual(["readonly"]) // shorthand IS a read
    expect(freeIdentifiers("flag ? 1 : 2")).toEqual(["flag"])
    expect(freeIdentifiers("{ [key]: 1 }")).toEqual(["key"]) // computed: the key is a read
  })

  it("reads no name out of a literal, a comment or a regex", () => {
    expect(freeIdentifiers(`"row" + 'label'`)).toEqual([])
    expect(freeIdentifiers("n // label")).toEqual(["n"])
    expect(freeIdentifiers("/label/.test(s)")).toEqual(["s"])
    expect(freeIdentifiers("1e5 + n")).toEqual(["n"]) // not the name "e5"
    expect(freeIdentifiers("0xff | n")).toEqual(["n"])
  })

  it("reads the names inside a template literal's holes, and nothing else", () => {
    expect(freeIdentifiers("`/users/${user.id}`")).toEqual(["user"])
    expect(freeIdentifiers("`plain text`")).toEqual([])
  })

  it("keeps the words that are not names", () => {
    expect(freeIdentifiers("typeof x")).toEqual(["x"])
    expect(freeIdentifiers("true || false")).toEqual([])
    expect(freeIdentifiers("this.x")).toEqual([])
    expect(freeIdentifiers("new Thing(n)")).toBeNull() // a called name keeps `with`
  })

  it("refuses anything that writes or binds - which is where the handlers are", () => {
    expect(freeIdentifiers("count = count + 1")).toBeNull()
    expect(freeIdentifiers("count += 1")).toBeNull()
    expect(freeIdentifiers("count++")).toBeNull()
    expect(freeIdentifiers("items.map(x => x.id)")).toBeNull()
    expect(freeIdentifiers("function f() {}")).toBeNull()
    expect(freeIdentifiers("eval('x')")).toBeNull()
    expect(freeIdentifiers("$scope")).toBeNull() // the codegen's own parameter
  })

  it("refuses a name that is called, whose receiver `with` supplies", () => {
    // `add()` under `with ($scope)` runs with `this === $scope`; a const cannot
    // reproduce that, so the expression keeps `with`
    expect(freeIdentifiers("save()")).toBeNull()
    expect(freeIdentifiers("select(row.id)")).toBeNull()
    expect(freeIdentifiers("fmt( price )")).toBeNull()
    // a method call is not a free name being called: the receiver is the object
    expect(freeIdentifiers("items.map")).toEqual(["items"])
    expect(freeIdentifiers("Math.max(a, b)")).toEqual(["Math", "a", "b"])
  })

  it("keeps a comparison, which is not an assignment", () => {
    expect(freeIdentifiers("a === b")).toEqual(["a", "b"])
    expect(freeIdentifiers("a !== b")).toEqual(["a", "b"])
    expect(freeIdentifiers("a >= b")).toEqual(["a", "b"])
  })

  it("refuses a short-circuit with more than one name, because the prologue is eager", () => {
    // `a ? b : c` would read every branch's names before the expression runs:
    // one more dep than `with` tracks, and a throw for a name only the dead
    // branch mentions
    expect(freeIdentifiers("a ? b : c")).toBeNull()
    expect(freeIdentifiers("a && b")).toBeNull()
    expect(freeIdentifiers("user?.name ?? fallback")).toBeNull()
    // with one name there is no branch to be wrong about
    expect(freeIdentifiers("user ? user.name : 'none'")).toEqual(["user"])
  })
})

describe("evaluating a template expression", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    host.remove()
  })

  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  // The evidence that the compiled form actually changed, and the only
  // assertion here that fails when compileScoped stops being reached.
  //
  // `with` consults Symbol.unscopables before it resolves a name; the prologue
  // reads the property and knows nothing about the symbol. So a store that
  // hides a key from `with` renders it under the prologue and nothing under
  // `with` - the one behaviour that separates the two forms without changing
  // what a template means. (The obvious probe - a getter counting reads per
  // mention - cannot work through this API: render() spreads its data, so a
  // getter is read once there and never again.)
  it("resolves a name `with` would have refused to see", () => {
    const jq79 = new Component79(`<p class="out">{{ hidden }}</p>`)
      .render({ hidden: "resolved", [Symbol.unscopables]: { hidden: true } }).mount(host)

    expect($(host, ".out")!.textContent).toBe("resolved")
    jq79.destroy()
  })

  it("still resolves a global the store does not shadow", () => {
    const jq79 = new Component79(`<p class="out">{{ Math.max(a, b) }}</p>`)
      .render({ a: 2, b: 9 }).mount(host)

    expect($(host, ".out")!.textContent).toBe("9")
    jq79.destroy()
  })

  it("lets the store shadow a global, as `with` did", () => {
    const jq79 = new Component79(`<p class="out">{{ Number.tag }}</p>`)
      .render({ Number: { tag: "ours" } }).mount(host)

    expect($(host, ".out")!.textContent).toBe("ours")
    jq79.destroy()
  })

  it("takes the else branch for a deleted key rather than throwing at it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const jq79 = new Component79(`<p class="out">{{ user ? user.name : "none" }}</p>`)
      .render({ user: { name: "ada" } }).mount(host)

    expect($(host, ".out")!.textContent).toBe("ada")
    delete jq79.data!.user
    await flush()

    expect($(host, ".out")!.textContent).toBe("none")
    expect(warn).not.toHaveBeenCalled() // a tombstone is not a missing name
    warn.mockRestore()
    jq79.destroy()
  })

  it("still reports a name declared nowhere", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const jq79 = new Component79(`<p class="out">{{ absentName }}</p>`).render().mount(host)

    await flush()
    expect($(host, ".out")!.textContent).toBe("")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("absentName is not defined"))
    warn.mockRestore()
    jq79.destroy()
  })

  // The safety net under the extractor: the prologue resolves eagerly, so a
  // name only `typeof` would have tolerated throws where `with` returned a
  // value. The first ReferenceError demotes the expression to `with` and
  // evaluates it again, so the answer is the one it always was
  it("falls back to `with` rather than losing an answer the eager prologue cannot give", async () => {
    const jq79 = new Component79(
      `<p class="out">{{ typeof unheardOf !== "undefined" ? unheardOf : "fallback" }}</p>`
    ).render().mount(host)

    await flush()
    expect($(host, ".out")!.textContent).toBe("fallback")
    jq79.destroy()
  })

  it("still writes through an assignment in a handler", () => {
    const jq79 = new Component79(
      `<button class="go" @click="count = count + 1">+</button><p class="out">{{ count }}</p>`
    ).render({ count: 0 }).mount(host)

    ;($(host, ".go") as HTMLButtonElement).click()
    ;($(host, ".go") as HTMLButtonElement).click()

    expect(jq79.data!.count).toBe(2)
    expect($(host, ".out")!.textContent).toBe("2")
    jq79.destroy()
  })

  // The defect the call-position bail exists to prevent, and the reason it is
  // worth 5% of the coverage: `with` calls a bare name with the with-object as
  // its receiver, so a store method reaches its own siblings through `this`
  it("calls a store method with the store as its receiver", () => {
    const jq79 = new Component79(`<p class="out">{{ label }}</p>`)
      .render({ tag: "ada", who() { return this.tag }, get label() { return "x" } }).mount(host)
    jq79.destroy()

    const called = new Component79(`<p class="out">{{ who() }}</p>`)
      .render({ tag: "ada", who() { return this.tag } }).mount(host)

    expect($(host, ".out")!.textContent).toBe("ada")
    called.destroy()
  })

  it("still binds $event, which is a parameter and not a scope name", () => {
    const seen: string[] = []
    const jq79 = new Component79(`<button class="go" @click="note($event.type)">go</button>`)
      .render({ note: (type: string) => seen.push(type) }).mount(host)

    ;($(host, ".go") as HTMLButtonElement).click()
    expect(seen).toEqual(["click"])
    jq79.destroy()
  })

  it("re-renders when a name it resolved by hand changes", async () => {
    const jq79 = new Component79(`<p class="out">{{ greeting }}, {{ who }}</p>`)
      .render({ greeting: "hola", who: "mundo" }).mount(host)

    expect($(host, ".out")!.textContent).toBe("hola, mundo")
    jq79.data!.who = "ada"
    await flush()

    expect($(host, ".out")!.textContent).toBe("hola, ada")
    jq79.destroy()
  })
})

// The two forms, on one build, over the shapes that separate them. This is the
// differential the skeleton corpus is for the cloner: an expression must render
// the same answer whether its names were resolved by `with` or by the prologue.
// Component79.debug drops the compiled cache when the flag flips, so each case
// really is compiled twice
describe("`with` and the const prologue agree", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  afterEach(() => {
    Component79.debug({ scopedNames: true })
    host.remove()
  })

  const cases: Array<[string, string, Record<string, any>, string]> = [
    ["a name", `{{ who }}`, { who: "mundo" }, "mundo"],
    ["a member chain", `{{ user.name.first }}`, { user: { name: { first: "ada" } } }, "ada"],
    ["a global", `{{ Math.max(a, b) }}`, { a: 2, b: 9 }, "9"],
    ["a global the store shadows", `{{ Number.tag }}`, { Number: { tag: "ours" } }, "ours"],
    ["a template literal", "{{ `/users/${user.id}` }}", { user: { id: 7 } }, "/users/7"],
    ["an object literal", `{{ JSON.stringify({ danger: n > 1 }) }}`, { n: 2 }, `{"danger":true}`],
    ["a one-name ternary", `{{ user ? user.name : "none" }}`, { user: { name: "ada" } }, "ada"],
    ["a two-name ternary, which keeps `with`", `{{ flag ? one : two }}`, { flag: false, one: "A", two: "B" }, "B"],
    ["a regex", `{{ /a\\d/.test(code) }}`, { code: "a7" }, "true"],
    ["a number that is not a name", `{{ 1e2 + n }}`, { n: 1 }, "101"],
    ["an arrow, which keeps `with`", `{{ items.map(x => x.id).join("-") }}`, { items: [{ id: 1 }, { id: 2 }] }, "1-2"],
  ]

  for (const [label, template, data, expected] of cases) {
    it(label, () => {
      for (const scopedNames of [false, true]) {
        Component79.debug({ scopedNames })
        const jq79 = new Component79(`<p class="out">${template}</p>`)
          .render(structuredClone(data)).mount(host)
        expect($(host, ".out")!.textContent, `scopedNames: ${scopedNames}`).toBe(expected)
        jq79.destroy()
      }
    })
  }

  it("compiles the prologue only when the flag is on", () => {
    const rendered: string[] = []
    for (const scopedNames of [false, true]) {
      Component79.debug({ scopedNames })
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const jq79 = new Component79(`<p class="out">{{ hidden }}</p>`)
        .render({ hidden: "resolved", [Symbol.unscopables]: { hidden: true } }).mount(host)
      rendered.push($(host, ".out")!.textContent!)
      warn.mockRestore()
      jq79.destroy()
    }
    // `with` obeys Symbol.unscopables and finds nothing; the prologue reads the
    // property. Both forms really do get compiled
    expect(rendered).toEqual(["", "resolved"])
  })
})

// `:iff="ready"` binds an attribute named iff and renders the element
// unconditionally. There is no "unknown directive" to report in general - an
// unrecognized `:name` IS the attribute-binding feature - so the only signal
// left is a name that starts with a directive's own name
describe("a `:` name that looks like a directive", () => {
  let host: HTMLDivElement
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    host.remove()
  })

  const parse = (source: string) => new Component79(source)

  it("warns for a misspelt directive, and says what it did instead", () => {
    parse(`<p :iff="ready">hola</p>`)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(":iff is not a directive"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`bound an attribute named "iff"`))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("If you meant :if"))
  })

  it("catches the other spellings of the same mistake", () => {
    parse(`<ul><li :eachh="x in xs">a</li></ul>`)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(":eachh"))

    warn.mockClear()
    parse(`<p :texts="msg"></p>`)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(":texts"))
  })

  // `@submit.prevent` with the wrong sigil: it binds an attribute called
  // "submit.prevent" holding the handler's source text, and the form goes on
  // submitting natively. RECORD/2026-08-30.a-dotted-colon-name.md
  it("warns for a dotted `:` name, which is an event written with the wrong sigil", () => {
    parse(`<form :submit.prevent="go"><button>ok</button></form>`)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(":submit.prevent is not a directive"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`bound an attribute named "submit.prevent"`))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("if you meant @submit.prevent"))
  })

  it("says nothing for the dotted families, which all mean something", () => {
    parse(`<p :class.warn="hot" :html.allowed="md"></p>`)
    parse(`<input :model.uname /><Table><template :slot.row="row"><b>x</b></template></Table>`)
    // on a plain tag too, which is where this loop actually runs - a component
    // tag is skipped whole by the guard at the top of it
    parse(`<div :props.rest="extra" :slot.row="r"></div>`)

    expect(warn).not.toHaveBeenCalled()
  })

  it("still binds the dotted attribute it warned about", () => {
    const jq79 = parse(`<form class="f" :submit.prevent="go"></form>`)
      .render({ go: () => {} }).mount(host)

    expect($(host, ".f")!.getAttribute("submit.prevent")).toBe("() => {}")
    jq79.destroy()
  })

  it("says nothing about an ordinary attribute binding, which is the feature", () => {
    parse(`<img :src="url" /><button :disabled="busy">b</button><div :aria-expanded="open"></div>`)
    parse(`<svg :width="w" :viewBox="box"><circle :stroke-width="sw" /></svg>`)
    parse(`<input :value="v" :checked="on" /><p :class="theme" :class.warn="hot">x</p>`)

    expect(warn).not.toHaveBeenCalled()
  })

  it("says nothing on a component tag, where every `:name` is a prop", () => {
    parse(`<Chip :iff="ready" :ifLabel="x" />`)
    parse(`<my-chip :iff="ready" />`)

    expect(warn).not.toHaveBeenCalled()
  })

  it("still renders the element and writes the attribute", () => {
    const jq79 = parse(`<p class="out" :iff="ready">hola</p>`).render({ ready: false }).mount(host)

    const p = $(host, ".out")!
    expect(p.textContent).toBe("hola")       // :iff is not :if - the element renders
    expect(p.getAttribute("iff")).toBe("false")
    jq79.destroy()
  })
})

// A component's template decides its own namespace: parsed on its own, a
// template rooted at a bare <circle> is an HTML element with an SVG name, so it
// lands inside the <svg> and never draws. That is the answer this project chose
// (RECORD/2026-08-26.the-namespace-of-a-component.md) - and the failure was
// invisible until this said so
describe("a component used inside an <svg>", () => {
  let host: HTMLDivElement
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    host.remove()
  })

  const BARE = `<template name="Bare"><circle cx="8" cy="8" r="8" /></template>`
  const ROOTED = `<template name="Rooted"><svg x="10"><circle cx="8" cy="8" r="8" /></svg></template>`

  it("warns when its template starts with a bare SVG element", () => {
    const jq79 = new Component79(`<svg viewBox="0 0 100 100"><Bare /></svg>${BARE}`).render().mount(host)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("<Bare>"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("never draws"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("root it at <svg>"))
    jq79.destroy()
  })

  it("says nothing when the template roots at <svg>, which is the fix", () => {
    const jq79 = new Component79(`<svg viewBox="0 0 100 100"><Rooted /></svg>${ROOTED}`).render().mount(host)

    expect(warn).not.toHaveBeenCalled()
    jq79.destroy()
  })

  it("says nothing outside a foreign namespace, where an HTML root is the point", () => {
    const jq79 = new Component79(`<div><Chip /></div><template name="Chip"><b>hola</b></template>`)
      .render().mount(host)

    expect(warn).not.toHaveBeenCalled()
    jq79.destroy()
  })

  it("warns once for a usage site, however many instances it renders", () => {
    const jq79 = new Component79(
      `<svg viewBox="0 0 100 100"><Bare :each="n in [1, 2, 3]" :key="n" /></svg>${BARE}`
    ).render().mount(host)

    expect(warn).toHaveBeenCalledTimes(1)
    jq79.destroy()
  })
})

// :attrs was retired in favour of the single-attribute form
// (RECORD/2026-08-27.retiring-attrs.md). Removing it silently would have been
// the worst version of that: it is an ordinary `:name` now, so it would write
// attrs="[object Object]" and pass a prop nobody declared
describe("a retired directive", () => {
  let host: HTMLDivElement
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    host.remove()
  })

  it("says :attrs was removed, and what to write instead", () => {
    new Component79(`<button :attrs="{ disabled: busy }">go</button>`)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(":attrs was removed"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`:disabled="x"`))
  })

  it("binds one attribute called attrs, which is what any other `:name` does", () => {
    const jq79 = new Component79(`<button class="go" :attrs="label">go</button>`)
      .render({ label: "x" }).mount(host)

    expect($(host, ".go")!.getAttribute("attrs")).toBe("x")
    expect($(host, ".go")!.hasAttribute("disabled")).toBe(false)
    jq79.destroy()
  })

  it("is silent for every directive that still exists", () => {
    new Component79(`<div :class="theme" :text="msg"></div>`)
    new Component79(`<input :value="v" :checked="on" />`)
    new Component79(`<ul><li :each="x in xs" :key="x">{{ x }}</li></ul>`)

    expect(warn).not.toHaveBeenCalled()
  })
})
