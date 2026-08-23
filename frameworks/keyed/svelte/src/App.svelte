<script>
  import { createDataBuilder } from "../../_shared/data.js"

  const buildData = createDataBuilder()

  let data = $state.raw([])
  let selected = $state.raw(null)

  const run = () => { data = buildData(1000); selected = null }
  const runLots = () => { data = buildData(10000); selected = null }
  const add = () => { data = [...data, ...buildData(1000)] }
  const update = () => {
    const next = data.slice()
    for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + " !!!" }
    data = next
  }
  const clear = () => { data = []; selected = null }
  const swapRows = () => {
    if (data.length <= 998) return
    const next = data.slice()
    const tmp = next[1]
    next[1] = next[998]
    next[998] = tmp
    data = next
  }
  const select = id => { selected = id }
  const remove = row => { data = data.filter(r => r !== row) }
</script>

<div class="container">
  <div class="jumbotron">
    <div class="row">
      <div class="col-md-6">
        <h1>Svelte (keyed)</h1>
      </div>
      <div class="col-md-6">
        <div class="row">
          <div class="col-sm-6 smallpad">
            <button type="button" class="btn btn-primary btn-block" id="run" onclick={run}>Create 1,000 rows</button>
          </div>
          <div class="col-sm-6 smallpad">
            <button type="button" class="btn btn-primary btn-block" id="runlots" onclick={runLots}>Create 10,000 rows</button>
          </div>
          <div class="col-sm-6 smallpad">
            <button type="button" class="btn btn-primary btn-block" id="add" onclick={add}>Append 1,000 rows</button>
          </div>
          <div class="col-sm-6 smallpad">
            <button type="button" class="btn btn-primary btn-block" id="update" onclick={update}>Update every 10th row</button>
          </div>
          <div class="col-sm-6 smallpad">
            <button type="button" class="btn btn-primary btn-block" id="clear" onclick={clear}>Clear</button>
          </div>
          <div class="col-sm-6 smallpad">
            <button type="button" class="btn btn-primary btn-block" id="swaprows" onclick={swapRows}>Swap Rows</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <table class="table table-hover table-striped test-data">
    <tbody id="tbody">
      {#each data as row (row.id)}
        <tr class={selected === row.id ? "danger" : ""}>
          <td class="col-md-1">{row.id}</td>
          <td class="col-md-4"><a onclick={() => select(row.id)}>{row.label}</a></td>
          <td class="col-md-1"><a onclick={() => remove(row)}><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
          <td class="col-md-6"></td>
        </tr>
      {/each}
    </tbody>
  </table>
  <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
</div>
