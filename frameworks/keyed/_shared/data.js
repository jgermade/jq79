// Row generation shared by every framework under frameworks/keyed/, so a
// comparison run builds the exact same rows (same words, same ids) no matter
// which framework produced them. Matches the reference vanillajs
// implementation in https://github.com/krausest/js-framework-benchmark.

const adjectives = [
  "pretty", "large", "big", "small", "tall", "short", "long", "handsome",
  "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful",
  "mushy", "odd", "unsightly", "adorable", "important", "inexpensive",
  "cheap", "expensive", "fancy"
]
const colours = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"]
const nouns = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse", "keyboard"]

const random = max => Math.round(Math.random() * 1000) % max

// each app calls this once at module scope, giving it its own id counter -
// ids only need to be unique within one page load, never across frameworks
export const createDataBuilder = () => {
  let id = 1
  return (count = 1000) => {
    const rows = new Array(count)
    for (let i = 0; i < count; i++) {
      rows[i] = {
        id: id++,
        label: `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`
      }
    }
    return rows
  }
}
