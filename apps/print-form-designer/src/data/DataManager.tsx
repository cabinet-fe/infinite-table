// 数据管理页：持有数据源/数据集两份清单作为唯一数据源，两个面板的增删改经 onChanged 统一刷新。
import { useCallback, useEffect, useState } from 'react'
import { api, type DatasetRow, type DatasourceRow } from './api'
import { DatasourcePanel } from './DatasourcePanel'
import { DatasetPanel } from './DatasetPanel'

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
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(reload, [reload])

  return (
    <>
      {error ? <p className="page-error error">{error}（请确认后端已启动：bun run dev）</p> : null}
      <DatasourcePanel datasources={datasources} onChanged={reload} />
      <DatasetPanel datasources={datasources} datasets={datasets} onChanged={reload} />
    </>
  )
}
