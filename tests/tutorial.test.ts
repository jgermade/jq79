
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Component79 } from "../src/jq79"
// the highlighter the tutorial page loads (build-site.mjs bundles this very
// entry into site/assets/hljs.js), so the app is mounted here with the same
// render data the shell hands it
import hljs from "../scripts/hljs-browser.js"

// The tutorial's exercises are real components, so they're tested like any
// other: every starting file must parse and mount (a broken starting point is
// worse than no exercise), and every solution must actually do what its README
// promises. Mounting mirrors what the tutorial page does at runtime - entry
// file compiled with the sibling files as its `modules` map - so these tests
// cover the same path the browser takes.

const TUTORIAL = join(__dirname, "..", "tutorial")
const ENTRY = "app.html"

type Exercise = {
  path: string
  files: Record<string, string>
  solution: Record<string, string>
}

// mirrors build-site.mjs, entry file first - the tutorial opens on that tab, and
// readdir order is not something to rely on
const sources = (dir: string): Record<string, string> => {
  let entries: string[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".html"))
      .map(entry => entry.name)
      .sort((a, b) => (a === ENTRY ? -1 : b === ENTRY ? 1 : a.localeCompare(b)))
  } catch {
    return {}
  }
  return Object.fromEntries(entries.map(name => [name, readFileSync(join(dir, name), "utf8")]))
}

const exercises: Exercise[] = readdirSync(TUTORIAL, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.startsWith("_"))
  .flatMap(section =>
    readdirSync(join(TUTORIAL, section.name), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(exercise => {
        const dir = join(TUTORIAL, section.name, exercise.name)
        return {
          path: `${section.name}/${exercise.name}`,
          files: sources(dir),
          solution: sources(join(dir, "solution")),
        }
      })
  )

// the tutorial's own preview logic, condensed: sibling files become the entry's
// pre-resolved modules, so `await import("./Greeting.html")` finds the file the
// user is editing instead of hitting the network
const mount = (files: Record<string, string>, host: HTMLElement): Component79 => {
  const modules: Record<string, Component79> = {}
  Object.entries(files)
    .filter(([name]) => name !== ENTRY)
    .forEach(([name, source]) => { modules[`./${name}`] = new Component79(source) })

  return new Component79(files[ENTRY], { modules }).mountShadow(host)
}

// the scoped-styles lesson is the one exercise whose point the shadow-rooted
// preview can't show (mountShadow ignores `scoped`), so its behaviour tests
// mount into the document head the way its README describes - and clean up
// after themselves, since head styles outlive the host element
const mountHead = (files: Record<string, string>, host: HTMLElement): Component79 => {
  const modules: Record<string, Component79> = {}
  Object.entries(files)
    .filter(([name]) => name !== ENTRY)
    .forEach(([name, source]) => { modules[`./${name}`] = new Component79(source) })

  return new Component79(files[ENTRY], { modules }).mount(host)
}

// setup scripts that `await` (the nested-components exercise) render on a
// microtask, so the DOM settles a tick after mount
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

// The no-bundle exercises import a component the editor doesn't hold - it sits
// on the host that serves the tutorial, at /tutorial/examples/. A specifier
// that isn't in the pre-resolved `modules` map above falls through to the
// runtime, which fetches it; in a browser that's a real request to the page's
// own origin, and here the same files answer it off disk. Mocking the network
// is the only stand-in: what's under test is that the import reaches for it
const EXAMPLES = join(TUTORIAL, "_app", "examples")

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    const requested = String(url)
    const file = join(EXAMPLES, requested.split("/").pop() ?? "")
    const served = requested.includes("/examples/") && existsSync(file)
    // Component79.fetch() only reads .ok and .text(), and throws on a 404 the
    // way it would against a host that doesn't have the file
    return served
      ? { ok: true, text: async () => readFileSync(file, "utf8") }
      : { ok: false, status: 404, text: async () => "not found" }
  })
})

afterAll(() => vi.unstubAllGlobals())

describe("tutorial", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  it("finds the exercises on disk", () => {
    expect(exercises.length).toBeGreaterThan(0)
  })

  // a lesson with no solution/ is a demonstration: the app hides its solution
  // button and swaps the live preview for the resulting-html pane. The list is
  // deliberate - a solution *forgotten* on a real exercise still fails here
  const DEMOS = new Set(["03-components/04-scoped-styles"])

  describe.each(exercises)("$path", ({ path, files, solution }) => {
    it(`has an ${ENTRY} to mount, and a solution unless it's a demo`, () => {
      expect(Object.keys(files)).toContain(ENTRY)
      if (DEMOS.has(path)) expect(Object.keys(solution)).toHaveLength(0)
      else expect(Object.keys(solution).length).toBeGreaterThan(0)
    })

    it("mounts its starting files without throwing", async () => {
      expect(() => mount(files, host)).not.toThrow()
      await tick()
    })

    it("mounts its solution without throwing", async () => {
      expect(() => mount({ ...files, ...solution }, host)).not.toThrow()
      await tick()
    })
  })

  // what each solution is supposed to teach, asserted on the rendered output

  const solutionOf = (path: string) => {
    const exercise = exercises.find(candidate => candidate.path === path)!
    return { ...exercise.files, ...exercise.solution }
  }

  it("01-basics/01: interpolates the greeting", () => {
    mount(solutionOf("01-basics/01-your-first-component"), host)

    expect(host.shadowRoot?.querySelector("h1")?.textContent).toBe("Hello jq79!")
  })

  it("01-basics/02: counts clicks and keeps `doubled` in sync", () => {
    mount(solutionOf("01-basics/02-reactive-state"), host)
    const button = host.shadowRoot!.querySelector("button")!

    expect(button.textContent).toContain("clicked 0 times")

    button.click()
    button.click()

    expect(button.textContent).toContain("clicked 2 times")
    expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("doubled: 4")
  })

  it("01-basics/03: renders the list and reacts to toggling a todo", () => {
    mount(solutionOf("01-basics/03-lists-and-conditions"), host)
    const items = host.shadowRoot!.querySelectorAll("li")

    expect(items.length).toBe(3)
    expect(items[0].className).toBe("done")
    expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("2 left to go")

    items[1].click()
    items[2].click()

    expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("all done!")
  })

  it("03-components/01: renders one child component per user, with its props", async () => {
    mount(solutionOf("03-components/01-nested-components"), host)
    await tick()

    const cards = host.shadowRoot!.querySelectorAll("article")

    expect(cards.length).toBe(2)
    expect(cards[0].querySelector("strong")?.textContent).toBe("Ada")
    expect(cards[0].querySelector("span")?.textContent).toBe("admin")
    expect(cards[1].querySelector("strong")?.textContent).toBe("Linus")
  })

  it("01-basics/04: drives the button's attributes, the status text and its class", () => {
    mount(solutionOf("01-basics/04-attributes"), host)
    const button = host.shadowRoot!.querySelector("button")!
    const status = host.shadowRoot!.querySelector(".status")!

    expect(button.hasAttribute("disabled")).toBe(false)
    expect(status.textContent).toBe("idle")
    expect(status.classList.contains("busy")).toBe(false)

    button.click()

    expect(button.hasAttribute("disabled")).toBe(true)
    expect(button.getAttribute("title")).toContain("already in flight")
    expect(status.textContent).toBe("saving…")
    // :class adds busy on top of the static class - both are there
    expect(status.classList.contains("busy")).toBe(true)
    expect(status.classList.contains("status")).toBe(true)
  })

  it("01-basics/05: writes through :with, and keeps the browser from submitting the form", () => {
    mount(solutionOf("01-basics/05-forms-and-scope"), host)
    const root = host.shadowRoot!
    const field = (selector: string, value: string) => {
      const input = root.querySelector(selector) as HTMLInputElement
      input.value = value
      input.dispatchEvent(new Event("input"))
    }

    // `name = …` inside :with="draft" writes draft.name, and the preview reads it
    // back through the same narrowed scope
    field(".name", "Ada")
    field(".email", "ada@lovelace.dev")

    expect(root.querySelector(".preview")?.textContent).toBe("Ada — ada@lovelace.dev")
    expect(root.querySelector(".saved")).toBeFalsy()

    const submit = new Event("submit", { bubbles: true, cancelable: true })
    root.querySelector("form")!.dispatchEvent(submit)

    expect(submit.defaultPrevented).toBe(true)
    expect(root.querySelector(".saved")?.textContent).toBe("saved: Ada (ada@lovelace.dev)")
  })

  it("04-scripts/03: renders a loading state, then the users it fetched", async () => {
    mount(solutionOf("04-scripts/03-loading-data"), host)

    // the point of the exercise: there is DOM before the request resolves
    expect(host.shadowRoot?.querySelector(".loading")?.textContent).toBe("loading…")
    expect(host.shadowRoot?.querySelector(".users")).toBeFalsy()

    await new Promise(resolve => setTimeout(resolve, 700))

    expect(host.shadowRoot?.querySelector(".loading")).toBeFalsy()
    expect([...host.shadowRoot!.querySelectorAll(".users li")].map(li => li.textContent)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Alan Turing",
    ])
  })

  it("04-scripts/04: debounces the search - one run for a burst of keystrokes", async () => {
    mount(solutionOf("04-scripts/04-keeping-state-out-of-the-store"), host)
    const input = host.shadowRoot!.querySelector(".search") as HTMLInputElement

    // with `timer` still in the store, the second of these would re-enter the
    // effect that wrote it and recurse until the stack blew
    for (const query of ["b", "be", "ber"]) {
      input.value = query
      input.dispatchEvent(new Event("input"))
    }

    await new Promise(resolve => setTimeout(resolve, 400))

    expect(host.shadowRoot?.querySelector(".count")?.textContent).toBe("1 searches run")
    expect([...host.shadowRoot!.querySelectorAll(".matches li")].map(li => li.textContent)).toEqual([
      "blueberry",
      "cranberry",
    ])
  })

  it("03-components/02: bubbles each child's $emit payload up to the parent", async () => {
    mount(solutionOf("03-components/02-component-events"), host)
    await tick()

    const steppers = host.shadowRoot!.querySelectorAll("button")
    const readout = () => host.shadowRoot!.querySelector("p")?.textContent

    expect(steppers.length).toBe(2)
    expect(readout()).toBe("last value emitted: 0")

    steppers[0].click()
    steppers[0].click()

    expect(readout()).toBe("last value emitted: 2")

    // the second stepper has its own store, so it starts from 1 again
    steppers[1].click()

    expect(readout()).toBe("last value emitted: 1")
  })

  it("02-no-bundle/01: renders a component no bundler resolved, fetched from the host", async () => {
    mount(solutionOf("02-no-bundle/01-no-build-step"), host)

    // the template is up before the request is: the <Sticker> tags render
    // nothing while the import is in flight, and fill in when it lands
    expect(host.shadowRoot?.querySelectorAll("li").length).toBe(3)
    expect(host.shadowRoot?.querySelector(".sticker")).toBeFalsy()

    await vi.waitFor(() =>
      expect([...host.shadowRoot!.querySelectorAll(".sticker")].map(el => el.textContent)).toEqual([
        "NO COMPILER",
        "NO BUNDLER",
        "NO CONFIG",
      ])
    )
  })

  it("02-no-bundle/02: fetches the chart on the first click, and not before", async () => {
    mount(solutionOf("02-no-bundle/02-loading-on-demand"), host)
    await tick()

    // nothing asked for it, so it isn't there
    expect(host.shadowRoot?.querySelector(".chart")).toBeFalsy()
    expect(host.shadowRoot?.querySelector(".loading")).toBeFalsy()
    ;(host.shadowRoot!.querySelector(".show") as HTMLButtonElement).click()

    // the gap the exercise is about: the request is out, and the component says so
    expect(host.shadowRoot?.querySelector(".loading")?.textContent).toBe("loading…")

    await vi.waitFor(() => expect(host.shadowRoot!.querySelectorAll(".chart li").length).toBe(4))

    expect(host.shadowRoot?.querySelector(".loading")).toBeFalsy()
    expect(host.shadowRoot?.querySelector(".show")).toBeFalsy()
    expect(host.shadowRoot?.querySelector(".chart .value")?.textContent).toBe("32")
  })

  it("04-scripts/01: focuses its own search box once mounted", async () => {
    mount(solutionOf("04-scripts/01-reaching-the-dom"), host)
    await tick()

    expect(host.shadowRoot!.activeElement).toBe(host.shadowRoot!.querySelector(".search"))
  })

  it("04-scripts/02: wires the factory's methods and $effect", () => {
    mount(solutionOf("04-scripts/02-factory-scripts"), host)
    const [inc, reset] = [...host.shadowRoot!.querySelectorAll("button")]
    const readout = () => host.shadowRoot!.querySelector("p")?.textContent

    inc.click()
    inc.click()

    expect(inc.textContent).toContain("clicked 2 times")
    expect(readout()).toBe("double: 4")

    reset.click()

    expect(inc.textContent).toContain("clicked 0 times")
    expect(readout()).toBe("double: 0")
  })

  // these lessons stage a failure before fixing it, so their *starting* files
  // carry claims of their own - a library change that made keyless reorders
  // keep DOM state, plain objects shared, :html reject destinations by
  // default, or a copied-once prop stay live, would gut the lesson without
  // breaking its solution

  const startOf = (path: string) => exercises.find(candidate => candidate.path === path)!.files

  it("01-basics/06: without :key, a reorder rebuilds the rows and typing is lost", () => {
    mount(startOf("01-basics/06-keys-and-identity"), host)
    const root = host.shadowRoot!
    const inputs = () => [...root.querySelectorAll("input")] as HTMLInputElement[]

    inputs()[0].value = "captain"
    root.querySelector("button")!.click()

    expect([...root.querySelectorAll(".name")].map(el => el.textContent)).toEqual(["Alan", "Grace", "Ada"])
    expect(inputs().map(input => input.value)).toEqual(["", "", ""])
  })

  it("01-basics/06: with :key, the row travels with its player, typing intact", () => {
    mount(solutionOf("01-basics/06-keys-and-identity"), host)
    const root = host.shadowRoot!
    const inputs = () => [...root.querySelectorAll("input")] as HTMLInputElement[]

    inputs()[0].value = "captain"
    root.querySelector("button")!.click()

    expect([...root.querySelectorAll(".name")].map(el => el.textContent)).toEqual(["Alan", "Grace", "Ada"])
    expect(inputs().map(input => input.value)).toEqual(["", "", "captain"])
  })

  it("01-basics/07: iterates the object's entries, touching only the written key", () => {
    mount(solutionOf("01-basics/07-objects-and-entries"), host)
    const root = host.shadowRoot!
    const rows = () => [...root.querySelectorAll("li")].map(li => li.textContent)

    expect(rows()).toEqual(["pears: 3", "melons: 1", "plums: 8"])

    const untouched = root.querySelectorAll("li")[1]
    ;(root.querySelectorAll("li")[0] as HTMLElement).click()
    root.querySelector("button")!.click()

    // a bumped count and a brand-new key, each landing on its own row - the
    // melons row is still the same node
    expect(rows()).toEqual(["pears: 4", "melons: 1", "plums: 8", "figs: 5"])
    expect(root.querySelectorAll("li")[1]).toBe(untouched)
  })

  it("01-basics/08: without a policy, clean-protocol destinations sail through", () => {
    mount(startOf("01-basics/08-untrusted-html"), host)
    const root = host.shadowRoot!

    // mallory's executable bits never made it in - that's the sanitizer's
    // default, no policy involved - but her text survives
    expect(root.querySelector('a[href^="javascript:"]')).toBeFalsy()
    expect(root.querySelector("[onclick]")).toBeFalsy()
    expect(root.querySelectorAll(".body")[1].textContent).toContain("claim yours")

    // the staged failure: trudy's phishing link and tracking pixel are live
    expect(root.querySelector('a[href*="evil.example"]')).toBeTruthy()
    expect(root.querySelector('img[src*="tracker.evil.example"]')).toBeTruthy()
  })

  it("01-basics/08: the policy keeps ada's docs link and strips every other destination", () => {
    mount(solutionOf("01-basics/08-untrusted-html"), host)
    const root = host.shadowRoot!

    // *.germade.dev covers docs.germade.dev - the one href left standing
    const kept = [...root.querySelectorAll("a[href]")].map(a => a.getAttribute("href"))
    expect(kept).toEqual(["https://docs.germade.dev/reactive-data"])

    // the rejected link survives as text without a destination, and the pixel
    // keeps its element but loses its src
    expect(root.querySelectorAll(".body")[2].textContent).toContain("here")
    expect(root.querySelector('a[href*="evil.example"]')).toBeFalsy()
    expect(root.querySelector("img")).toBeTruthy()
    expect(root.querySelector("img")?.hasAttribute("src")).toBe(false)
  })

  it("03-components/05: a prop copied once at setup hears neither direction afterward", async () => {
    mount(startOf("03-components/05-two-way-binding"), host)
    await tick()
    const root = host.shadowRoot!
    const input = root.querySelector("input") as HTMLInputElement

    expect(input.value).toBe("Ada")

    input.value = "Grace"
    input.dispatchEvent(new Event("input"))

    // typed into the child's own copy - the parent never hears it
    expect(root.querySelector("p")?.textContent).toBe('the store says: "Ada"')

    root.querySelector("button")!.click()

    // the parent's reset lands on `initial`, which the field copied once and
    // never looks at again
    expect(input.value).toBe("Grace")
  })

  it("03-components/05: :model drives the field both ways - typing and reset alike", async () => {
    mount(solutionOf("03-components/05-two-way-binding"), host)
    await tick()
    const root = host.shadowRoot!
    const input = root.querySelector("input") as HTMLInputElement

    input.value = "Grace"
    input.dispatchEvent(new Event("input"))

    expect(root.querySelector("p")?.textContent).toBe('the store says: "Grace"')

    root.querySelector("button")!.click()

    expect(input.value).toBe("Ada")
    expect(root.querySelector("p")?.textContent).toBe('the store says: "Ada"')
  })

  it("03-components/03: a plain object passed to both children falls out of sync", async () => {
    mount(startOf("03-components/03-shared-state"), host)
    await tick()
    const root = host.shadowRoot!

    ;(root.querySelector(".lines button") as HTMLButtonElement).click()

    // the writer updated, the reader and the parent kept the old value
    expect(root.querySelectorAll(".lines li").length).toBe(1)
    expect(root.querySelector(".total")?.textContent).toBe("0 in the cart")
    expect(root.querySelector("h3")?.textContent).toBe("cart (0)")
  })

  // the demo lesson's two tabs, head-mounted the way its output pane does it:
  // the shadow-rooted preview can't show `scoped` (mountShadow ignores it), so
  // these hold the README's "what reaches the page" story to a real mount()

  it("03-components/04: unscoped, the card's CSS lands in the head as written", () => {
    const files = startOf("03-components/04-scoped-styles")
    const before = document.head.querySelectorAll("style").length
    const added = () => [...document.head.querySelectorAll("style")].slice(before)

    const instance = mountHead({ [ENTRY]: files[ENTRY] }, host)

    expect(added().map(style => style.textContent).join("\n")).toContain(".title {")
    expect(added().map(style => style.textContent).join("\n")).not.toContain("data-jq79")
    expect(host.querySelector(".card .title")?.hasAttribute("data-jq79")).toBe(false)

    instance.destroy()
    expect(added()).toHaveLength(0)
  })

  it("03-components/04: scoped, the card is stamped and its CSS rewritten to require it", () => {
    const files = startOf("03-components/04-scoped-styles")
    const before = document.head.querySelectorAll("style").length
    const added = () => [...document.head.querySelectorAll("style")].slice(before)

    const instance = mountHead({ [ENTRY]: files["scoped.html"] }, host)

    const stamp = host.querySelector(".card .title")?.getAttribute("data-jq79")
    expect(stamp).toBeTruthy()
    expect(added().map(style => style.textContent).join("\n")).toContain(`.title[data-jq79="${stamp}"]`)

    // one refcounted <style>, gone with the last instance
    instance.destroy()
    expect(added()).toHaveLength(0)
  })

  it("03-components/03: every holder of the store sees a child's write", async () => {
    mount(solutionOf("03-components/03-shared-state"), host)
    await tick()
    const root = host.shadowRoot!
    const [pear, melon] = [...root.querySelectorAll(".lines button")] as HTMLButtonElement[]

    pear.click()
    melon.click()

    expect([...root.querySelectorAll(".lines li")].map(li => li.textContent)).toEqual(["a pear", "a melon"])
    expect(root.querySelector(".total")?.textContent).toBe("2 in the cart")
    expect(root.querySelector("h3")?.textContent).toBe("cart (2)")
  })
})

// The tutorial page is itself a jq79 component, driven here the way a reader
// drives it: pick an exercise, type in the editor, hit solution. The manifest
// is rebuilt from disk rather than read from site/ (which is generated and
// gitignored) - only `html` differs, and the app just dumps that into :html.
describe("the tutorial app", () => {
  const app = readFileSync(join(TUTORIAL, "_app", "Tutorial.html"), "utf8")

  // the app's panes: on the site they are fetched (the app is served next to
  // them), here they are pre-resolved the same way an exercise's sibling files
  // are - `await import("./components/Editor.html")` finds the file on disk
  const panes = Object.fromEntries(
    readdirSync(join(TUTORIAL, "_app", "components"))
      .filter(name => name.endsWith(".html"))
      .map(name => [
        `./components/${name}`,
        new Component79(readFileSync(join(TUTORIAL, "_app", "components", name), "utf8")),
      ])
  )

  // the manifest, grouped the way build-site.mjs groups it: `index` is the flat
  // position across all sections, and the title is the path so a test can find
  // an exercise's entry in the table of contents by name
  const sections = [...new Set(exercises.map(exercise => exercise.path.split("/")[0]))].map(slug => ({
    slug,
    title: slug,
    exercises: exercises
      .filter(exercise => exercise.path.startsWith(`${slug}/`))
      .map(exercise => ({
        ...exercise,
        index: exercises.indexOf(exercise),
        title: exercise.path,
        html: "",
      })),
  }))

  const linkTo = (host: HTMLElement, path: string) =>
    [...host.querySelectorAll(".link")].find(link => link.textContent === path) as HTMLButtonElement

  // long enough to clear the editor's 250ms recompile debounce
  const settle = () => new Promise(resolve => setTimeout(resolve, 320))

  // mounting the app is not a matter of waiting a fixed slice of time: the panes
  // are imported (which crosses a macrotask) and then mounted, and on a loaded
  // machine that costs more than the debounce a settle() allows for - which is
  // what used to fail this suite on CI and never here. Wait for the app instead
  const until = async (ready: () => boolean, what: string, timeout = 5000) => {
    const deadline = Date.now() + timeout
    while (!ready()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  const type = (host: HTMLElement, source: string) => {
    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    editor.value = source
    editor.dispatchEvent(new Event("input"))
  }

  const previewRoot = (host: HTMLElement) => host.querySelector(".stage")!.shadowRoot!

  const ghostButton = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll(".ghost")].find(
      button => button.textContent === label
    ) as HTMLButtonElement

  // the solution is proposed as a diff and only lands once it's accepted, so
  // most of these want both halves of it
  const solve = async (host: HTMLElement) => {
    ghostButton(host, "solution").click()
    await settle()
    ;(host.querySelector(".accept") as HTMLButtonElement).click()
    await settle()
  }

  let host: HTMLDivElement
  let instance: Component79

  beforeEach(async () => {
    location.hash = ""
    host = document.createElement("div")
    document.body.appendChild(host)
    // the same `sections` object, mount after mount: each store keeps its own
    // view of it rather than rewriting it in place (see the sharing tests in
    // reactive.test.ts - this used to compound until it hung)
    instance = new Component79(app, { modules: panes }).mount(host, { sections, Component79, hljs })
    // the preview is the last thing to land: its pane is imported, mounted, and
    // only then does it compile the exercise, so a stage on screen means the
    // whole app is up
    await until(() => !!host.querySelector(".stage"), "the tutorial to mount")
  })

  // each test leaves a live app behind otherwise - effects still running, still
  // answering hashchange - and the next test's navigation drives all of them too
  afterEach(() => {
    instance.destroy()
    host.remove()
  })

  it("opens on the first exercise, with its files in the editor and its preview mounted", () => {
    expect(host.querySelectorAll(".link").length).toBe(exercises.length)
    expect(host.querySelector(".link.active")?.textContent).toBe("01-basics/01-your-first-component")
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("Hello world!")
    expect(previewRoot(host).querySelector("h1")?.textContent).toBe("Hello world!")
  })

  it("recompiles the preview from what the editor holds", async () => {
    type(host, `<script :setup>\n  const name = "jq79"\n</script>\n<h1>Hello {{ name }}!</h1>`)
    await settle()

    expect(previewRoot(host).querySelector("h1")?.textContent).toBe("Hello jq79!")
    expect(host.querySelector(".error")).toBeFalsy()
  })

  it("empties the preview the moment another exercise is opened", async () => {
    expect(previewRoot(host).querySelector("h1")?.textContent).toBe("Hello world!")

    linkTo(host, "01-basics/02-reactive-state").click()

    // no settle(): the recompile is debounced, and until it runs there is
    // nothing to show - what was on screen belonged to the exercise just closed
    expect(host.querySelector(".stage")).toBeFalsy()

    await settle()

    expect(previewRoot(host).querySelector("button")?.textContent).toContain("clicked")
  })

  it("reports a broken component instead of taking the page down with it", async () => {
    type(host, `<script :setup>\n  const oops = (\n</script>\n<p>never</p>`)
    await settle()

    expect(host.querySelector(".error")?.textContent).toBeTruthy()
    // the tutorial's own UI is still there and still usable
    expect(host.querySelectorAll(".link").length).toBe(exercises.length)
  })

  it("mounts a multi-file exercise's solution, wiring the imported component", async () => {
    linkTo(host, "03-components/01-nested-components").click()
    await settle()

    expect([...host.querySelectorAll(".tab")].map(tab => tab.textContent)).toEqual([ENTRY, "Greeting.html"])

    await solve(host)

    const names = [...previewRoot(host).querySelectorAll("article strong")].map(node => node.textContent)

    expect(names).toEqual(["Ada", "Linus"])
  })

  it("keeps an exercise's styles inside the preview, nested components included", async () => {
    const headBefore = document.head.querySelectorAll("style").length

    linkTo(host, "03-components/01-nested-components").click()
    await settle()
    await solve(host)

    // the exercise mounts into a shadow root, and so does everything it renders:
    // Greeting.html's <style> would otherwise land in document.head, where it
    // can't reach the component it belongs to but can restyle the tutorial
    const shadowCss = [...previewRoot(host).querySelectorAll("style")].map(el => el.textContent).join("\n")

    expect(shadowCss).toContain("article {")
    expect(document.head.querySelectorAll("style").length).toBe(headBefore)
  })

  it("switches the editor between an exercise's files, and resets them", async () => {
    linkTo(host, "03-components/01-nested-components").click()
    await settle()
    await solve(host)

    ;(host.querySelectorAll(".tab")[1] as HTMLButtonElement).click()
    await settle()

    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toContain("user.name")

    ghostButton(host, "reset").click()
    await settle()

    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).not.toContain("user.name")
  })

  it("keeps a highlight layer in step with what the editor holds", async () => {
    type(host, `<script :setup>\n  const name = "jq79"\n</script>\n<h1>Hello {{ name }}!</h1>`)
    await settle()

    const shadow = host.querySelector(".editor-highlight") as HTMLElement

    // same text as the textarea (that's what makes the two layers line up), and
    // colored: the <script> block comes out as javascript, the markup as tags
    expect(shadow.textContent?.trim()).toBe(
      (host.querySelector("textarea") as HTMLTextAreaElement).value.trim()
    )
    expect(shadow.querySelector(".hljs-keyword")?.textContent).toBe("const")
    expect(shadow.querySelector(".hljs-name")?.textContent).toBe("script")
  })

  it("proposes the solution as a diff, and touches nothing until it's accepted", async () => {
    const before = (host.querySelector("textarea") as HTMLTextAreaElement).value

    ghostButton(host, "solution").click()
    await settle()

    // the added lines are there to read, highlighted like the editor is
    const added = [...host.querySelectorAll(".row.add")]
    expect(added.length).toBeGreaterThan(0)
    expect(host.querySelector(".row.add .hljs-name")).toBeTruthy()
    // the diff has no label of its own: it shows whichever file the active tab
    // names, which on open is the entry
    expect(host.querySelector(".tab.active")?.textContent).toBe(ENTRY)

    // but the editor still holds the user's code, and can't be typed into behind
    // the overlay
    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    expect(editor.value).toBe(before)
    expect(editor.readOnly).toBe(true)

    ghostButton(host, "cancel").click()
    await settle()

    expect(host.querySelector(".diff")).toBeFalsy()
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(before)
    expect(editor.readOnly).toBe(false)
  })

  it("applies the solution once it's accepted, and re-renders the preview", async () => {
    linkTo(host, "01-basics/02-reactive-state").click()
    await settle()

    await solve(host)

    expect(host.querySelector(".diff")).toBeFalsy()

    const editor = host.querySelector("textarea") as HTMLTextAreaElement
    expect(editor.value).toBe(exercises[1].solution[ENTRY])
    expect(editor.readOnly).toBe(false)

    // and the preview is running the solution: its button counts clicks
    const button = previewRoot(host).querySelector("button") as HTMLButtonElement
    button.click()
    await settle()

    expect(previewRoot(host).textContent).toContain("1")
  })

  it("swaps a demo lesson's preview for the resulting html, per selected file", async () => {
    linkTo(host, "03-components/04-scoped-styles").click()
    await settle()

    // nothing to solve: no solution button, no live stage - the pane is for reading
    expect(ghostButton(host, "solution")).toBeFalsy()
    expect(host.querySelector(".stage")).toBeFalsy()

    const result = () => host.querySelector(".result")?.textContent ?? ""
    expect(result()).toContain('<span class="title">')
    expect(result()).toContain(".title {")
    expect(result()).not.toContain("data-jq79")

    // the scoped tab: the same card, stamped and rewritten - and mounting it
    // to read it left nothing behind in the page's own head
    const headBefore = document.head.querySelectorAll("style").length
    const scopedTab = [...host.querySelectorAll(".tab")].find(tab => tab.textContent === "scoped.html")
    ;(scopedTab as HTMLButtonElement).click()
    await settle()

    expect(result()).toMatch(/\.title\[data-jq79="[^"]+"\]/)
    expect(result()).toContain("document.head")
    expect(document.head.querySelectorAll("style").length).toBe(headBefore)

    // the head copy arrives reserialized onto one line per rule; the pane
    // breaks it back open - a declaration sits on its own indented line
    expect(result()).toMatch(/\n\s+border-radius: 8px;\n/)
  })

  it("offers no apply when the code already matches the solution", async () => {
    await solve(host)
    ghostButton(host, "solution").click()
    await settle()

    // the diff still opens on the active file, but every line is unchanged: no
    // additions or deletions to read
    expect(host.querySelector(".diff")).toBeTruthy()
    expect(host.querySelectorAll(".row.add, .row.del").length).toBe(0)
    // nothing to accept, so the only way out is dismissing it
    expect(host.querySelector(".accept")).toBeFalsy()
    expect(ghostButton(host, "cancel")).toBeTruthy()
  })
})
