<script setup>
import { ref } from "vue"
import { createDataBuilder } from "../../_shared/data.js"

const buildData = createDataBuilder()

const data = ref([])
const selected = ref(null)

const run = () => {
  data.value = buildData(1000)
  selected.value = null
}
const runLots = () => {
  data.value = buildData(10000)
  selected.value = null
}
const add = () => {
  data.value = data.value.concat(buildData(1000))
}
const update = () => {
  const rows = data.value
  for (let i = 0; i < rows.length; i += 10) rows[i].label += " !!!"
}
const clear = () => {
  data.value = []
  selected.value = null
}
const swapRows = () => {
  const rows = data.value
  if (rows.length > 998) {
    const tmp = rows[1]
    rows[1] = rows[998]
    rows[998] = tmp
  }
}
const select = id => {
  selected.value = id
}
const remove = id => {
  data.value = data.value.filter(row => row.id !== id)
}
</script>

<template>
  <div class="container">
    <div class="jumbotron">
      <div class="row">
        <div class="col-md-6">
          <h1>Vue (keyed)</h1>
        </div>
        <div class="col-md-6">
          <div class="row">
            <div class="col-sm-6 smallpad">
              <button type="button" class="btn btn-primary btn-block" id="run" @click="run">Create 1,000 rows</button>
            </div>
            <div class="col-sm-6 smallpad">
              <button type="button" class="btn btn-primary btn-block" id="runlots" @click="runLots">Create 10,000 rows</button>
            </div>
            <div class="col-sm-6 smallpad">
              <button type="button" class="btn btn-primary btn-block" id="add" @click="add">Append 1,000 rows</button>
            </div>
            <div class="col-sm-6 smallpad">
              <button type="button" class="btn btn-primary btn-block" id="update" @click="update">Update every 10th row</button>
            </div>
            <div class="col-sm-6 smallpad">
              <button type="button" class="btn btn-primary btn-block" id="clear" @click="clear">Clear</button>
            </div>
            <div class="col-sm-6 smallpad">
              <button type="button" class="btn btn-primary btn-block" id="swaprows" @click="swapRows">Swap Rows</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <table class="table table-hover table-striped test-data">
      <tbody id="tbody">
        <tr v-for="row in data" :key="row.id" :class="{ danger: row.id === selected }">
          <td class="col-md-1">{{ row.id }}</td>
          <td class="col-md-4"><a @click="select(row.id)">{{ row.label }}</a></td>
          <td class="col-md-1"><a @click="remove(row.id)"><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
          <td class="col-md-6"></td>
        </tr>
      </tbody>
    </table>
    <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
  </div>
</template>
