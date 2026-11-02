// 绑定编辑面板（P6）：数据集选择 + 重塑 JS 表达式 + 树形路径选择器 + 聚合，
// 经 FormDoc.setCellBinding 写入 cell-meta sidecar（可撤销）。路径树由数据集
// 执行原始行经 reshapeDatasetData（P7 唯一重塑管线）重塑后的形态生成，
// 嵌套数组逐层下钻；点选画布格经 P3 选区拦截入口（onCellPick）唤起本面板。
import { useEffect, useMemo, useState } from 'react'

import type { CellAddress } from '@infinitable/sheet'

import { api, toSourceRows, type DatasetRow } from '../data/api'
import type { SourceRow } from '../transform/reshape'
import {
  buildBindingTree,
  parseBindingPath,
  reshapeDatasetData,
  type BindingTreeNode,
} from './binding'
import type { FormDoc } from './form-doc'
import { bandAtRow, formatBindingPlaceholder, type FormCellBinding } from './template'

interface Props {
  doc: FormDoc
  /** 拾取模式点选的格；undefined = 尚未点选 */
  addr: CellAddress | undefined
  /** 绑定写入/清除后回画布刷新占位符 */
  onEdited: () => void
}

type Aggregate = NonNullable<FormCellBinding['aggregate']>

const AGGREGATES: { value: Aggregate | ''; label: string }[] = [
  { value: '', label: '直取' },
  { value: 'sum', label: '求和' },
  { value: 'avg', label: '平均' },
  { value: 'count', label: '计数' },
  { value: 'max', label: '最大' },
  { value: 'min', label: '最小' },
]

export function BindingEditor({ doc, addr, onEdited }: Props) {
  const [datasets, setDatasets] = useState<DatasetRow[] | null>(null)
  const [error, setError] = useState('')
  /** 已执行数据集的原始行缓存（表达式改动不重复请求） */
  const [rowsByDataset, setRowsByDataset] = useState(new Map<string, SourceRow[]>())
  const [datasetId, setDatasetId] = useState('')
  const [expression, setExpression] = useState('')
  const [path, setPath] = useState('')
  const [aggregate, setAggregate] = useState<Aggregate | ''>('')
  const [status, setStatus] = useState('')
  const [lastAddr, setLastAddr] = useState<CellAddress | undefined>(addr)

  // 数据集清单只在面板挂载时拉一次（面板随设计页常驻）
  useEffect(() => {
    api
      .listDatasets()
      .then((rows) => setDatasets(rows))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  // 数据集切换/首次选择时执行取原始行（缓存命中即免请求）
  useEffect(() => {
    if (!datasetId || rowsByDataset.has(datasetId)) return
    let cancelled = false
    api
      .executeDataset(datasetId)
      .then((result) => {
        if (cancelled) return
        setRowsByDataset((prev) => new Map(prev).set(datasetId, toSourceRows(result)))
        setError('')
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [datasetId, rowsByDataset])

  // 点选新格：渲染期回填既有绑定（无绑定时沿用上次的数据集/表达式，便于连续绑定）
  if (addr !== lastAddr) {
    setLastAddr(addr)
    const binding = addr ? doc.getCellBinding(addr) : undefined
    setDatasetId(binding?.datasetId ?? datasetId)
    setExpression(binding?.expression ?? expression)
    setPath(binding?.path ?? '')
    setAggregate(binding?.aggregate ?? '')
    setStatus('')
  }

  const sourceRows = datasetId ? rowsByDataset.get(datasetId) : undefined
  // 重塑形态：表达式改动即重算（reshapeDatasetData 内部深拷贝入参，重复求值安全）
  const { tree, reshapeError } = useMemo(() => {
    if (!sourceRows) return { tree: [] as BindingTreeNode[], reshapeError: '' }
    try {
      return {
        tree: buildBindingTree(reshapeDatasetData(expression, sourceRows)),
        reshapeError: '',
      }
    } catch (cause) {
      return {
        tree: [] as BindingTreeNode[],
        reshapeError: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }, [expression, sourceRows])

  const pathError = useMemo(() => {
    if (!path) return ''
    try {
      parseBindingPath(path)
      return ''
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  }, [path])

  const inDetail = addr !== undefined && bandAtRow(doc.bands, addr.row)?.kind === 'detail'
  const current = addr ? doc.getCellBinding(addr) : undefined

  const apply = (): void => {
    if (!addr || !datasetId || !path || pathError) return
    doc.setCellBinding(addr, {
      datasetId,
      expression: expression.trim() || undefined,
      path,
      aggregate: aggregate || undefined,
    })
    onEdited()
    setStatus('已绑定')
  }

  const clear = (): void => {
    if (!addr || !doc.getCellBinding(addr)) return
    doc.setCellBinding(addr, null)
    onEdited()
    setStatus('已清除绑定')
  }

  return (
    <div className="binding-editor">
      <h3>绑定编辑</h3>
      {!addr ? (
        <p className="meta">开启拾取模式后点选画布格</p>
      ) : (
        <p className="meta">
          目标格：行{addr.row + 1} 列{addr.col + 1}
          {inDetail ? '（明细波段，循环展开取值）' : ''}
        </p>
      )}
      {error ? <p className="status error">{error}</p> : null}
      <label className="binding-field">
        数据集{' '}
        <select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
          <option value="">请选择</option>
          {datasets?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      <label className="binding-field">
        重塑表达式（JS，入参 rows）
        <textarea
          rows={3}
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          placeholder={'如 rows.length；留空 = 原始行数组直接作形态'}
        />
      </label>
      {reshapeError ? <p className="status error">{reshapeError}</p> : null}
      <div className="binding-tree-wrap">
        {tree.length > 0 ? (
          <BindingTree nodes={tree} depth={0} onPick={setPath} />
        ) : (
          <p className="meta">{sourceRows ? '重塑形态无可选路径' : '选择数据集后生成路径树'}</p>
        )}
      </div>
      <label className="binding-field">
        路径{' '}
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="如 items[].price"
        />
      </label>
      {pathError ? <p className="status error">{pathError}</p> : null}
      <label className="binding-field">
        聚合{' '}
        <select
          value={aggregate}
          onChange={(event) => setAggregate(event.target.value as Aggregate | '')}
          disabled={inDetail}
        >
          {AGGREGATES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {addr ? (
        <div className="form-actions">
          <button className="primary" onClick={apply} disabled={!datasetId || !path || !!pathError}>
            应用绑定
          </button>
          <button onClick={clear} disabled={!current}>
            清除
          </button>
          {status ? <span className="meta">{status}</span> : null}
        </div>
      ) : null}
      {current ? <p className="meta">当前：{formatBindingPlaceholder(current)}</p> : null}
    </div>
  )
}

/** 树形路径选择器：<details> 逐层下钻，点选任意节点（含数组 `[]` / `[0]` 分支）即得路径 */
function BindingTree({
  nodes,
  depth,
  onPick,
}: {
  nodes: BindingTreeNode[]
  depth: number
  onPick: (path: string) => void
}) {
  return (
    <ul className="binding-tree">
      {nodes.map((node) => (
        <li key={node.path}>
          <details open={depth < 2}>
            <summary>
              <button type="button" className="tree-pick" onClick={() => onPick(node.path)}>
                {node.label}
                {node.kind === 'array' ? '（数组）' : node.kind === 'object' ? '（对象）' : ''}
              </button>
            </summary>
            {node.children?.length ? (
              <BindingTree nodes={node.children} depth={depth + 1} onPick={onPick} />
            ) : null}
          </details>
        </li>
      ))}
    </ul>
  )
}
