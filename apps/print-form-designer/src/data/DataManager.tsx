// 数据管理视图：持有数据源/数据集两份清单作为唯一数据源，两个面板的增删改经 onChanged 统一刷新。
import { useCallback, useEffect, useState } from 'react'
import { api, type DatasetRow, type DatasourceRow } from './api'
import { DatasourcePanel } from './DatasourcePanel'
import { DatasetPanel } from './DatasetPanel'
import { describeError } from '../errors'

export function DataManager() {
  const [datasources, setDatasources] = useState<DatasourceRow[] | null>(null)
  const [datasets, setDatasets] = useState<DatasetRow[] | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    Promise.all([api.listDatasources(), api.listDatasets()])
      .then(([nextDatasources, nextDatasets]) => {
        setDatasources(nextDatasources)
        setDatasets(nextDatasets)
        setError('')
      })
      .catch((cause: unknown) => setError(describeError(cause)))
  }, [])

  useEffect(reload, [reload])

  return (
    <>
      <div className="data-view">
        <div className="data-header">
          <h2>数据</h2>
          <span className="hint">
            先建数据源（SQLite 文件），再在其上定义数据集（只读 SQL）；模板单元格绑定到数据集字段。
          </span>
        </div>

        {error ? <p className="page-error">{error}（请确认后端已启动：bun run dev）</p> : null}

        <div className="data-grid">
          <DatasourcePanel datasources={datasources} onChanged={reload} />
          <DatasetPanel datasources={datasources} datasets={datasets} onChanged={reload} />
        </div>
      </div>
    </>
  )
}
