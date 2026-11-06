// 数据源面板：SQLite 文件数据源的创建表单（路径相对时落应用数据目录）与列表删除。
// 删除会级联清掉该数据源下的全部数据集，故二次确认。
import { useState } from 'react'
import { api, type DatasourceRow } from './api'
import { IconDataSource, IconTrash } from '../ui/icons'
import { describeError } from '../errors'

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
      setStatus({ text: describeError(cause), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card data-card">
      <div className="card-head">
        <h3>
          <IconDataSource className="head-icon" />
          数据源
        </h3>
        <span className="meta">
          {datasources === null ? '读取中…' : `共 ${datasources.length} 个`}
        </span>
      </div>

      <div className="data-form">
        <label className="field-col">
          <span className="field-label">名称</span>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="如：销售演练库"
          />
        </label>
        <label className="field-col">
          <span className="field-label">文件路径</span>
          <input
            value={form.path}
            onChange={(e) => setForm({ ...form, path: e.target.value })}
            placeholder="绝对路径，或应用 data 目录下的文件名"
          />
        </label>
        <div className="button-row">
          <button
            type="button"
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

      <ul className="data-list">
        {datasources?.length === 0 ? <li className="empty">还没有数据源</li> : null}
        {datasources?.map((row) => (
          <li key={row.id}>
            <span className="item-main">
              <span className="item-title">{row.name}</span>
              <span className="item-sub">
                {row.type} · {row.path}
              </span>
            </span>
            <span className="item-actions">
              <button
                type="button"
                className="icon-button danger"
                disabled={busy}
                title="删除数据源（会一并删除其下数据集）"
                onClick={() => {
                  if (!window.confirm(`删除数据源「${row.name}」？其下所有数据集会一并删除。`))
                    return
                  void run(() => api.deleteDatasource(row.id), '数据源已删除（其数据集一并删除）')
                }}
              >
                <IconTrash />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
