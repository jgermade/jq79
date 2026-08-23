import { createDataBuilder } from "../../_shared/data.js"

const buildData = createDataBuilder()

const main = document.getElementById("main")
main.innerHTML = `
  <div class="container">
    <div class="jumbotron">
      <div class="row">
        <div class="col-md-6"><h1>vanillajs (keyed)</h1></div>
        <div class="col-md-6">
          <div class="row">
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="run">Create 1,000 rows</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="runlots">Create 10,000 rows</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="add">Append 1,000 rows</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="update">Update every 10th row</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="clear">Clear</button></div>
            <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="swaprows">Swap Rows</button></div>
          </div>
        </div>
      </div>
    </div>
    <table class="table table-hover table-striped test-data">
      <tbody id="tbody"></tbody>
    </table>
    <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
  </div>
`

const tbody = document.getElementById("tbody")
const rowTemplate = document.createElement("tr")
rowTemplate.innerHTML =
  "<td class='col-md-1'></td><td class='col-md-4'><a></a></td><td class='col-md-1'><a><span class='glyphicon glyphicon-remove' aria-hidden='true'></span></a></td><td class='col-md-6'></td>"

let data = []
let rows = new Map() // id -> <tr>
let selectedRow = null

const buildRow = row => {
  const tr = rowTemplate.cloneNode(true)
  tr.dataId = row.id
  tr.childNodes[0].textContent = row.id
  tr.childNodes[1].firstChild.textContent = row.label
  return tr
}

const removeAllRows = () => {
  tbody.textContent = ""
  rows = new Map()
}

const renderAll = list => {
  removeAllRows()
  const fragment = document.createDocumentFragment()
  for (const row of list) {
    const tr = buildRow(row)
    rows.set(row.id, tr)
    fragment.appendChild(tr)
  }
  tbody.appendChild(fragment)
}

const unselect = () => {
  if (selectedRow) {
    selectedRow.className = ""
    selectedRow = null
  }
}

const run = () => {
  data = buildData(1000)
  renderAll(data)
  unselect()
}
const runLots = () => {
  data = buildData(10000)
  renderAll(data)
  unselect()
}
const add = () => {
  const newRows = buildData(1000)
  data = data.concat(newRows)
  const fragment = document.createDocumentFragment()
  for (const row of newRows) {
    const tr = buildRow(row)
    rows.set(row.id, tr)
    fragment.appendChild(tr)
  }
  tbody.appendChild(fragment)
}
const update = () => {
  for (let i = 0; i < data.length; i += 10) {
    data[i].label += " !!!"
    rows.get(data[i].id).childNodes[1].firstChild.textContent = data[i].label
  }
}
const clear = () => {
  data = []
  removeAllRows()
  unselect()
}
const swapRows = () => {
  if (data.length <= 998) return
  const rowAt1 = data[1]
  const rowAt998 = data[998]
  const trAt1 = rows.get(rowAt1.id)
  const trAt998 = rows.get(rowAt998.id)
  // capture the anchors before moving anything, same two-insertBefore swap
  // the reference vanillajs implementation uses
  const trAt2 = trAt1.nextSibling
  const trAt999 = trAt998.nextSibling

  tbody.insertBefore(trAt998, trAt2)
  tbody.insertBefore(trAt1, trAt999)

  data[1] = rowAt998
  data[998] = rowAt1
}
const select = id => {
  unselect()
  selectedRow = rows.get(id)
  selectedRow.className = "danger"
}
const remove = id => {
  const idx = data.findIndex(row => row.id === id)
  data.splice(idx, 1)
  const tr = rows.get(id)
  tr.remove()
  rows.delete(id)
}

document.getElementById("run").addEventListener("click", run)
document.getElementById("runlots").addEventListener("click", runLots)
document.getElementById("add").addEventListener("click", add)
document.getElementById("update").addEventListener("click", update)
document.getElementById("clear").addEventListener("click", clear)
document.getElementById("swaprows").addEventListener("click", swapRows)

tbody.addEventListener("click", event => {
  let el = event.target
  while (el && el.tagName !== "TD") el = el.parentNode
  if (!el) return
  const tr = el.parentNode
  if (tr.childNodes[1] === el) select(tr.dataId)
  else if (tr.childNodes[2] === el) remove(tr.dataId)
})
