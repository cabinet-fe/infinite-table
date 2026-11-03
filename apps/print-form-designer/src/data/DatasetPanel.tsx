// 数据集面板：创建/编辑表单（SQL 文本）与「执行预览」原始行表格。
// 预览口径：先保存当前表单（新建走创建、编辑走更新），再执行该数据集取原始行——预览永远对应已保存的 SQL。
import { useState } from 'react'
import {
  api,
  type DatasetInput,
  type DatasetRow,
  type DatasourceRow,
  type QueryResult,
} from './api'
import { IconDataset, IconEdit, IconPlus, IconTable, IconTrash } from '../ui/icons'

interface Props {
  datasources: DatasourceRow[] | null
  datasets: DatasetRow[] | null
  onChanged: () => void
}

const BLANK_FORM: DatasetInput = { name: '', datasource_id: '', sql: '' }

function formFromRow(row: DatasetRow): DatasetInput {
  const { name, datasource_id, sql } = row
  return { name, datasource_id, sql }
}

export function DatasetPanel({ datasources, datasets, onChanged }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<DatasetInput>(BLANK_FORM)
  const [preview, setPreview] = useState<QueryResult | null>(null)
  const [status, setStatus] = useState<{ text: string; error: boolean }>({ text: '', error: false })
  const [busy, setBusy] = useState(false)

  function resetForm(): void {
    setEditingId(null)
    setForm({ ...BLANK_FORM, datasource_id: datasources?.[0]?.id ?? '' })
    setPreview(null)
  }

  async function run(action: () => Promise<string>): Promise<void> {
    setBusy(true)
    try {
      setStatus({ text: await action(), error: false })
      onChanged()
    } catch (cause: unknown) {
      setStatus({ text: cause instanceof Error ? cause.message : String(cause), error: true })
    } finally {
      setBusy(false)
    }
  }

  function persist(): Promise<string> {
    const saved = editingId === null ? api.createDataset(form) : api.updateDataset(editingId, form)
    return saved.then((row) => {
      setEditingId(row.id)
      return row.id
    })
  }

  const formInvalid = form.name.trim() === '' || form.datasource_id === '' || form.sql.trim() === ''
  const noDatasource = datasources !== null && datasources.length === 0

  return (
    <section className="card data-card">
      <div className="card-head">
        <h3>
          <IconDataset className="head-icon" />
          数据集
        </h3>
        <span className="meta">{datasets === null ? '读取中…' : `共 ${datasets.length} 个`}</span>
        <button type="button" onClick={resetForm} title="清空表单，开始新建数据集">
          <IconPlus />
          新建数据集
        </button>
      </div>

      <div className="data-form">
        <label className="field-col">
          <span className="field-label">名称</span>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="如：销售明细（列表样）"
          />
        </label>
        <label className="field-col">
          <span className="field-label">数据源</span>
          <select
            value={form.datasource_id}
            onChange={(e) => setForm({ ...form, datasource_id: e.target.value })}
            disabled={noDatasource}
          >
            {noDatasource ? <option value="">请先创建数据源</option> : null}
            {datasources?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-col">
          <span className="field-label">SQL（只读单条查询）</span>
          <textarea
            value={form.sql}
            onChange={(e) => setForm({ ...form, sql: e.target.value })}
            placeholder="SELECT ... FROM ..."
          />
        </label>
        <div className="button-row">
          <button
            type="button"
            className="primary"
            disabled={busy || noDatasource || formInvalid}
            onClick={() =>
              run(async () => {
                await persist()
                return '数据集已保存'
              })
            }
          >
            保存
          </button>
          <button
            type="button"
            disabled={busy || noDatasource || formInvalid}
            onClick={() =>
              run(async () => {
                const id = await persist()
                const result = await api.executeDataset(id)
                setPreview(result)
                return `执行成功：返回 ${result.rows.length} 行原始行`
              })
            }
          >
            <IconTable />
            执行预览
          </button>
          {editingId !== null ? <span className="meta">正在编辑已保存的数据集</span> : null}
        </div>
        <p className={status.error ? 'status error' : 'status'}>{status.text}</p>
      </div>

      {preview !== null ? <PreviewTable result={preview} /> : null}

      <ul className="data-list">
        {datasets?.length === 0 ? <li className="empty">还没有数据集</li> : null}
        {datasets?.map((row) => (
          <li key={row.id}>
            <span className="item-main">
              <span className="item-title">{row.name}</span>
              <span className="item-sub">
                {datasources?.find((source) => source.id === row.datasource_id)?.name ??
                  '数据源缺失'}
              </span>
            </span>
            <span className="item-actions">
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                title="编辑该数据集"
                onClick={() => {
                  setEditingId(row.id)
                  setForm(formFromRow(row))
                  setPreview(null)
                }}
              >
                <IconEdit />
              </button>
              <button
                type="button"
                className="icon-button danger"
                disabled={busy}
                title="删除该数据集"
                onClick={() => {
                  if (!window.confirm(`删除数据集「${row.name}」？`)) return
                  void run(async () => {
                    await api.deleteDataset(row.id)
                    if (editingId === row.id) resetForm()
                    return '数据集已删除'
                  })
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

function PreviewTable({ result }: { result: QueryResult }) {
  return (
    <div className="preview">
      <div className="preview-head">
        <span className="section-label">执行结果</span>
        <span className="meta">
          {result.rows.length} 行 · {result.columns.length} 列
        </span>
      </div>
      <div className="preview-scroll">
        <table>
          <thead>
            <tr>
              {result.columns.map((column, index) => (
                <th key={index}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell === null || cell === undefined ? '' : String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
