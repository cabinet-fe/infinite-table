// 数据源面板：SQLite 文件数据源的创建表单（路径相对时落应用数据目录）与列表删除。
import { useState } from 'react'
import { api, type DatasourceRow } from './api'

interface Props {
  datasources: DatasourceRow[] | null
  onChanged: () => void
}

export function DatasourcePanel({ datasources, onChanged }: Props) {
  const [form, setForm] = useState({ name: '', path: '' })
  const [status, setStatus] = useState<{ text: string; error: boolean }>({ text: '', error: false })
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>, successText: string): Promise<void> {
    setBusy(true)
    try {
      await action()
      setStatus({ text: successText, error: false })
      onChanged()
    } catch (cause: unknown) {
      setStatus({ text: cause instanceof Error ? cause.message : String(cause), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>数据源（SQLite 文件）{datasources === null ? '' : `· ${datasources.length}`}</h2>
      </div>
      <div className="form-grid">
        <label htmlFor="ds-name">名称</label>
        <input
          id="ds-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="如：销售演练库"
        />
        <label htmlFor="ds-path">文件路径</label>
        <input
          id="ds-path"
          value={form.path}
          onChange={(e) => setForm({ ...form, path: e.target.value })}
          placeholder="绝对路径；或相对应用 data 目录的文件名"
        />
        <div className="form-actions">
          <button
            className="primary"
            disabled={busy || form.name.trim() === '' || form.path.trim() === ''}
            onClick={() =>
              run(async () => {
                await api.createDatasource({ name: form.name, type: 'sqlite', path: form.path })
                setForm({ name: '', path: '' })
              }, '数据源已创建')
            }
          >
            新增数据源
          </button>
        </div>
        <p className={status.error ? 'status error' : 'status'}>{status.text}</p>
      </div>
      <ul className="item-list">
        {datasources?.map((row) => (
          <li key={row.id}>
            <span>
              {row.name}
              <span className="meta">
                （{row.type}）{row.path}
              </span>
            </span>
            <span className="item-actions">
              <button
                disabled={busy}
                onClick={() =>
                  run(() => api.deleteDatasource(row.id), '数据源已删除（其数据集一并删除）')
                }
              >
                删除
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
