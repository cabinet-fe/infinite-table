// 数据集面板：创建/编辑表单（SQL 文本）、「执行预览」原始行表格与「取字段」命名表
// （跑一次查询出列名 → 逐字段起显示名 → PUT 持久化；绑定与取数始终用原始字段名）。
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
import { describeError } from '../errors'

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

/** 字段命名表状态：alias 为输入框当前值（空串 = 用原名）；sample = 取字段时的首行样例 */
interface FieldNaming {
  datasetId: string
  rows: { name: string; alias: string }[]
  sample: Record<string, unknown> | null
}

/** 已存命名 → 命名表行（编辑数据集时直接展示，不必先取字段） */
function namingFromRow(row: DatasetRow): FieldNaming {
  return {
    datasetId: row.id,
    rows: row.fields.map((field) => ({ name: field.name, alias: field.alias ?? '' })),
    sample: null,
  }
}

export function DatasetPanel({ datasources, datasets, onChanged }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<DatasetInput>(BLANK_FORM)
  const [preview, setPreview] = useState<QueryResult | null>(null)
  const [fieldNaming, setFieldNaming] = useState<FieldNaming | null>(null)
  const [status, setStatus] = useState<{ text: string; error: boolean }>({ text: '', error: false })
  const [busy, setBusy] = useState(false)

  function resetForm(): void {
    setEditingId(null)
    setForm({ ...BLANK_FORM, datasource_id: datasources?.[0]?.id ?? '' })
    setPreview(null)
    setFieldNaming(null)
  }

  async function run(action: () => Promise<string>): Promise<void> {
    setBusy(true)
    try {
      setStatus({ text: await action(), error: false })
      onChanged()
    } catch (cause: unknown) {
      setStatus({ text: describeError(cause), error: true })
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

  /** 取字段：对该数据集已保存的 SQL 跑一次查询出列名；已填别名按 name 保留（编辑中优先，其次已存） */
  function openFieldNaming(row: DatasetRow): void {
    void run(async () => {
      const result = await api.fetchDatasetFields(row.id)
      const editing = fieldNaming?.datasetId === row.id ? fieldNaming.rows : undefined
      const saved = new Map(row.fields.map((field) => [field.name, field.alias ?? '']))
      setFieldNaming({
        datasetId: row.id,
        rows: result.fields.map((name) => ({
          name,
          alias: editing?.find((item) => item.name === name)?.alias ?? saved.get(name) ?? '',
        })),
        sample: result.sample[0] ?? null,
      })
      return `已取出 ${result.fields.length} 个字段`
    })
  }

  /** 保存字段命名：名称/SQL 原样回写（不带会被后端保留），fields 空白别名归一为用原名 */
  function saveFieldNaming(): void {
    if (fieldNaming === null) return
    const row = datasets?.find((item) => item.id === fieldNaming.datasetId)
    if (row === undefined) return
    void run(async () => {
      await api.updateDataset(row.id, {
        name: row.name,
        datasource_id: row.datasource_id,
        sql: row.sql,
        fields: fieldNaming.rows.map(({ name, alias }) =>
          alias.trim() === '' ? { name } : { name, alias: alias.trim() },
        ),
      })
      return '字段命名已保存'
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

      {fieldNaming !== null ? (
        <FieldNamingTable
          title={
            datasets?.find((item) => item.id === fieldNaming.datasetId)?.name ??
            fieldNaming.datasetId
          }
          rows={fieldNaming.rows}
          sample={fieldNaming.sample}
          busy={busy}
          onAlias={(name, alias) =>
            setFieldNaming({
              ...fieldNaming,
              rows: fieldNaming.rows.map((item) =>
                item.name === name ? { ...item, alias } : item,
              ),
            })
          }
          onSave={saveFieldNaming}
        />
      ) : null}

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
                title="对该数据集跑一次查询取字段，逐个起显示名"
                onClick={() => openFieldNaming(row)}
              >
                <IconTable />
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                title="编辑该数据集"
                onClick={() => {
                  setEditingId(row.id)
                  setForm(formFromRow(row))
                  setPreview(null)
                  // 已有命名直接展示（无样例列）；没命名过则收起命名表等取字段
                  setFieldNaming(row.fields.length > 0 ? namingFromRow(row) : null)
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
                    if (fieldNaming?.datasetId === row.id) setFieldNaming(null)
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

/** 字段命名表：原始字段名只读（mono）+ 显示名输入框（留空 = 用原名）+ 首行样例值辅助辨认 */
function FieldNamingTable({
  title,
  rows,
  sample,
  busy,
  onAlias,
  onSave,
}: {
  title: string
  rows: { name: string; alias: string }[]
  sample: Record<string, unknown> | null
  busy: boolean
  onAlias: (name: string, alias: string) => void
  onSave: () => void
}) {
  return (
    <div className="preview field-naming">
      <div className="preview-head">
        <span className="section-label">字段命名 · {title}</span>
        <span className="meta">显示名只影响展示，绑定与取数仍用原始字段名</span>
        <button type="button" className="primary" disabled={busy} onClick={onSave}>
          保存字段命名
        </button>
      </div>
      <div className="preview-scroll">
        <table>
          <thead>
            <tr>
              <th>原始字段名</th>
              <th>显示名</th>
              <th>样例值</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td className="mono">{row.name}</td>
                <td>
                  <input
                    value={row.alias}
                    placeholder={row.name}
                    onChange={(e) => onAlias(row.name, e.target.value)}
                  />
                </td>
                <td>{sampleText(sample?.[row.name])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function sampleText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}
