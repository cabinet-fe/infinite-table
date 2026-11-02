import { useEffect, useState } from 'react'

interface DatasourceRow {
  id: string
  name: string
  type: string
}

// 应用壳（P1 底座）：验证前后端链路——页面可访问且能请求到 /api 资源接口；设计器画布在后续阶段挂入。
export function App() {
  const [datasources, setDatasources] = useState<DatasourceRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/datasources')
      .then((res) => res.json() as Promise<DatasourceRow[]>)
      .then(setDatasources)
      .catch(() => setError('后端不可达：请确认 dev 已同时启动后端（bun run dev）'))
  }, [])

  return (
    <main className="shell">
      <h1>打印单设计器</h1>
      <p className="hint">应用底座（P1）：数据源 / 数据集 / 模板管理与设计画布在后续阶段挂入</p>
      <section>
        <h2>数据源（{datasources ? datasources.length : '…'}）</h2>
        {error ? <p className="error">{error}</p> : null}
        {datasources && datasources.length === 0 ? (
          <p>暂无数据源（seed 演练库在后续阶段内置）</p>
        ) : null}
        <ul>
          {datasources?.map((datasource) => (
            <li key={datasource.id}>
              {datasource.name}（{datasource.type}）
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
