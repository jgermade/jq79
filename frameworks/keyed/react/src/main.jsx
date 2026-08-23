import { StrictMode, useState, useCallback } from "react"
import { createRoot } from "react-dom/client"
import { createDataBuilder } from "../../_shared/data.js"

const buildData = createDataBuilder()

const App = () => {
  const [data, setData] = useState([])
  const [selected, setSelected] = useState(null)

  const run = useCallback(() => {
    setData(buildData(1000))
    setSelected(null)
  }, [])
  const runLots = useCallback(() => {
    setData(buildData(10000))
    setSelected(null)
  }, [])
  const add = useCallback(() => setData(data => [...data, ...buildData(1000)]), [])
  const update = useCallback(() => {
    setData(data => {
      const next = data.slice()
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + " !!!" }
      return next
    })
  }, [])
  const clear = useCallback(() => {
    setData([])
    setSelected(null)
  }, [])
  const swapRows = useCallback(() => {
    setData(data => {
      if (data.length <= 998) return data
      const next = data.slice()
      const tmp = next[1]
      next[1] = next[998]
      next[998] = tmp
      return next
    })
  }, [])
  const select = useCallback(id => setSelected(id), [])
  const remove = useCallback(id => setData(data => data.filter(row => row.id !== id)), [])

  return (
    <div className="container">
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (keyed)</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                <button type="button" className="btn btn-primary btn-block" id="run" onClick={run}>Create 1,000 rows</button>
              </div>
              <div className="col-sm-6 smallpad">
                <button type="button" className="btn btn-primary btn-block" id="runlots" onClick={runLots}>Create 10,000 rows</button>
              </div>
              <div className="col-sm-6 smallpad">
                <button type="button" className="btn btn-primary btn-block" id="add" onClick={add}>Append 1,000 rows</button>
              </div>
              <div className="col-sm-6 smallpad">
                <button type="button" className="btn btn-primary btn-block" id="update" onClick={update}>Update every 10th row</button>
              </div>
              <div className="col-sm-6 smallpad">
                <button type="button" className="btn btn-primary btn-block" id="clear" onClick={clear}>Clear</button>
              </div>
              <div className="col-sm-6 smallpad">
                <button type="button" className="btn btn-primary btn-block" id="swaprows" onClick={swapRows}>Swap Rows</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <table className="table table-hover table-striped test-data">
        <tbody id="tbody">
          {data.map(row => (
            <tr key={row.id} className={row.id === selected ? "danger" : ""}>
              <td className="col-md-1">{row.id}</td>
              <td className="col-md-4"><a onClick={() => select(row.id)}>{row.label}</a></td>
              <td className="col-md-1"><a onClick={() => remove(row.id)}><span className="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
              <td className="col-md-6"></td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
    </div>
  )
}

createRoot(document.getElementById("main")).render(
  <StrictMode>
    <App />
  </StrictMode>
)
