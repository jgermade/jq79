
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
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

// setup scripts that `await` (the nested-components exercise) render on a
// microtask, so the DOM settles a tick after mount
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe("tutorial", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  it("finds the exercises on disk", () => {
    expect(exercises.length).toBeGreaterThan(0)
  })

  describe.each(exercises)("$path", ({ files, solution }) => {
    it(`has an ${ENTRY} to mount, and a solution`, () => {
      expect(Object.keys(files)).toContain(ENTRY)
      expect(Object.keys(solution).length).toBeGreaterThan(0)
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

  it("02-components/01: renders one child component per user, with its props", async () => {
    mount(solutionOf("02-components/01-nested-components"), host)
    await tick()

    const cards = host.shadowRoot!.querySelectorAll("article")

    expect(cards.length).toBe(2)
    expect(cards[0].querySelector("strong")?.textContent).toBe("Ada")
    expect(cards[0].querySelector("span")?.textContent).toBe("admin")
    expect(cards[1].querySelector("strong")?.textContent).toBe("Linus")
  })

  it("01-basics/04: drives the button's attributes and the status text", () => {
    mount(solutionOf("01-basics/04-attributes"), host)
    const button = host.shadowRoot!.querySelector("button")!
    const status = host.shadowRoot!.querySelector(".status")!

    expect(button.hasAttribute("disabled")).toBe(false)
    expect(status.textContent).toBe("idle")

    button.click()

    expect(button.hasAttribute("disabled")).toBe(true)
    expect(button.getAttribute("title")).toContain("already in flight")
    expect(status.textContent).toBe("saving…")
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

  it("03-scripts/03: renders a loading state, then the users it fetched", async () => {
    mount(solutionOf("03-scripts/03-loading-data"), host)

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

  it("03-scripts/04: debounces the search - one run for a burst of keystrokes", async () => {
    mount(solutionOf("03-scripts/04-keeping-state-out-of-the-store"), host)
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

  it("02-components/02: bubbles each child's $emit payload up to the parent", async () => {
    mount(solutionOf("02-components/02-component-events"), host)
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

  it("03-scripts/01: focuses its own search box once mounted", async () => {
    mount(solutionOf("03-scripts/01-reaching-the-dom"), host)
    await tick()

    expect(host.shadowRoot!.activeElement).toBe(host.shadowRoot!.querySelector(".search"))
  })

  it("03-scripts/02: wires the factory's methods and $effect", () => {
    mount(solutionOf("03-scripts/02-factory-scripts"), host)
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
    await settle()
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

  it("reports a broken component instead of taking the page down with it", async () => {
    type(host, `<script :setup>\n  const oops = (\n</script>\n<p>never</p>`)
    await settle()

    expect(host.querySelector(".error")?.textContent).toBeTruthy()
    // the tutorial's own UI is still there and still usable
    expect(host.querySelectorAll(".link").length).toBe(exercises.length)
  })

  it("mounts a multi-file exercise's solution, wiring the imported component", async () => {
    linkTo(host, "02-components/01-nested-components").click()
    await settle()

    expect([...host.querySelectorAll(".tab")].map(tab => tab.textContent)).toEqual([ENTRY, "Greeting.html"])

    await solve(host)

    const names = [...previewRoot(host).querySelectorAll("article strong")].map(node => node.textContent)

    expect(names).toEqual(["Ada", "Linus"])
  })

  it("keeps an exercise's styles inside the preview, nested components included", async () => {
    const headBefore = document.head.querySelectorAll("style").length

    linkTo(host, "02-components/01-nested-components").click()
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
    linkTo(host, "02-components/01-nested-components").click()
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
    expect(host.querySelector(".diff-name")?.textContent).toBe(ENTRY)

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

  it("says so when the code already matches the solution", async () => {
    await solve(host)
    ghostButton(host, "solution").click()
    await settle()

    expect(host.querySelectorAll(".row").length).toBe(0)
    expect(host.querySelector(".diff-title")?.textContent).toContain("already matches")
    // nothing to accept, so the only way out is dismissing it
    expect(host.querySelector(".accept")).toBeFalsy()
  })
})
