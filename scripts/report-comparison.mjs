// Renders frameworks/keyed/comparison-results.json as a markdown table, for a
// CI job summary or a paste into an issue. The JSON stays the source of truth
// (the site's /benchmark/comparison/ page reads it); this is only a reading of
// it that survives in a log.
//
// Usage: node scripts/report-comparison.mjs [path/to/comparison-results.json]

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const path = process.argv[2] ?? fileURLToPath(new URL("../frameworks/keyed/comparison-results.json", import.meta.url))
const data = JSON.parse(await readFile(path, "utf8"))

const ids = data.frameworks.map(f => f.id)
const ops = data.frameworks[0].operations.map(op => ({ id: op.id, label: op.label }))
const medians = {}
for (const framework of data.frameworks) {
  for (const op of framework.operations) (medians[op.id] ??= {})[framework.id] = op.median
}

// every framework as a multiple of the fastest on that row: the absolute
// milliseconds belong to whatever machine produced them, the ratios travel
const relative = (opId, id) => {
  const row = Object.values(medians[opId])
  const best = Math.min(...row)
  return best > 0 ? (medians[opId][id] / best).toFixed(1) : "-"
}

const lines = []
lines.push(`# Framework comparison`)
lines.push("")
lines.push(`- **generated** ${data.generatedAt}`)
lines.push(`- **cpu** ${data.cpu}`)
lines.push(`- **samples** ${data.samples} per operation, medians below`)
lines.push(`- **versions** ${data.frameworks.map(f => `${f.label} ${f.version ?? "-"}`).join(" · ")}`)
lines.push("")
lines.push(`| operation | ${data.frameworks.map(f => f.label).join(" | ")} |`)
lines.push(`|---|${ids.map(() => "---:").join("|")}|`)
for (const op of ops) {
  lines.push(`| ${op.label} | ${ids.map(id => `${medians[op.id][id]?.toFixed(1) ?? "-"}` ).join(" | ")} |`)
}
lines.push("")
lines.push(`Relative to the fastest on each row:`)
lines.push("")
lines.push(`| operation | ${data.frameworks.map(f => f.label).join(" | ")} |`)
lines.push(`|---|${ids.map(() => "---:").join("|")}|`)
for (const op of ops) {
  lines.push(`| ${op.label} | ${ids.map(id => `${relative(op.id, id)}x`).join(" | ")} |`)
}

console.log(lines.join("\n"))
