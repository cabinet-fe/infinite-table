// 字段绑定面板：默认「选数据集 → 点字段 chip」一步完成绑定，高级层折叠收起重塑表达式 / 路径树 / 手写路径。
//
// 为什么要这么改：旧版必须先开一个开关才能点选画布，且要在表达式、路径树、路径框、
// 聚合下拉之间来回填，非程序员完全不知道从哪下手。现在画布常规选区就是绑定目标，
// 字段清单直接取数据集的列，点一下就写入绑定。
import { useEffect, useMemo, useState } from 'react'

import { formatAddress, type CellAddress } from '@infinitable/sheet'

import { api, toSourceRows, type DatasetRow } from '../data/api'
import type { SourceRow } from '../transform/reshape'
import {
  buildBindingTree,
  parseBindingPath,
  reshapeDatasetData,
  type BindingTreeNode,
} from './binding'
import {
  AGGREGATE_MODES,
  boundColumnOf,
  buildBindingPreset,
  detectAggregateMode,
  type BindingAggregateMode,
} from './binding-presets'
import type { FormDoc } from './form-doc'
import {
  REGION_EXPAND_OPTIONS,
  formatBindingPlaceholder,
  regionsAt,
  type FormCellBinding,
  type FormRegion,
} from './template'

interface Props {
  doc: FormDoc
  /** 当前选区活动格（画布常规选区即绑定目标） */
  addr: CellAddress | undefined
  /** 绑定写入/清除后回画布刷新占位符 */
  onEdited: () => void
}

/** 字段类型提示：按首行取值粗判，帮用户判断该不该求和 */
function fieldKindOf(value: unknown): { text: string; title: string } {
  if (value === null || value === undefined || value === '') {
    return { text: '空', title: '首行该字段为空，取不到样例值' }
  }
  if (typeof value === 'number') return { text: '123', title: '数字，适合求和 / 平均' }
  return { text: 'Abc', title: '文本，通常直接取值' }
}

export function BindingEditor({ doc, addr, onEdited }: Props) {
  const [datasets, setDatasets] = useState<DatasetRow[] | null>(null)
  const [error, setError] = useState('')
  /** 已执行数据集的列名 + 原始行（点字段只需列名，行用于类型提示与高级层路径树） */
  const [shapes, setShapes] = useState(new Map<string, { columns: string[]; rows: SourceRow[] }>())
  const [datasetId, setDatasetId] = useState('')
  const [mode, setMode] = useState<BindingAggregateMode>('first')
  const [expression, setExpression] = useState('')
  const [path, setPath] = useState('')
  const [aggregate, setAggregate] = useState<FormCellBinding['aggregate']>(undefined)
  const [status, setStatus] = useState('')
  const [lastAddr, setLastAddr] = useState<string | undefined>(undefined)

  // 数据集清单只在面板挂载时拉一次（面板随设计页常驻）
  useEffect(() => {
    api
      .listDatasets()
      .then((rows) => setDatasets(rows))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  // 数据集切换/首次选择时执行取列与原始行（缓存命中即免请求）
  useEffect(() => {
    if (!datasetId || shapes.has(datasetId)) return
    let cancelled = false
    api
      .executeDataset(datasetId)
      .then((result) => {
        if (cancelled) return
        setShapes((prev) =>
          new Map(prev).set(datasetId, { columns: result.columns, rows: toSourceRows(result) }),
        )
        setError('')
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [datasetId, shapes])

  // 当前格所在的区域：任一 expand !== 'none' 的区域即「会被按数据份数重复复制」
  const region = addr ? regionsAt(doc.regions, addr.row, addr.col) : undefined
  const inRepeatable = region !== undefined && region.expand !== 'none'
  const current = addr ? doc.getCellBinding(addr) : undefined
  const boundColumn = boundColumnOf(current)
  const addrKey = addr ? formatAddress(addr) : undefined

  // 切换目标格：回填既有绑定的数据集 / 作用方式 / 高级层字段（无绑定则保留上次的数据集，便于连绑）
  if (addrKey !== lastAddr) {
    setLastAddr(addrKey)
    setDatasetId(current?.datasetId ?? datasetId)
    setMode(detectAggregateMode(inRepeatable, current))
    setExpression(current?.expression ?? '')
    setPath(current?.path ?? '')
    setAggregate(current?.aggregate)
    setStatus('')
  }

  const shape = datasetId ? shapes.get(datasetId) : undefined
  const sourceRows = shape?.rows

  /** 写入绑定（一次点击的唯一落点）：保留当前高级层表达式，其余按预设覆盖 */
  const write = (preset: { path: string; aggregate: FormCellBinding['aggregate'] }): void => {
    if (!addr || !datasetId) return
    doc.setCellBinding(addr, {
      datasetId,
      expression: expression.trim() || undefined,
      path: preset.path,
      aggregate: preset.aggregate,
    })
    onEdited()
  }

  /** 点字段 chip：立即绑定（展开区按行、其它区按当前作用方式） */
  const pickField = (column: string): void => {
    if (!addr || !datasetId) return
    const preset = buildBindingPreset(inRepeatable, column, mode)
    write(preset)
    setPath(preset.path)
    setAggregate(preset.aggregate)
    setStatus(
      `已绑定 ${column}（${inRepeatable ? '展开区按份取值' : mode === 'first' ? '取第 1 条' : AGGREGATE_MODES.find((m) => m.value === mode)?.label}）`,
    )
  }

  /** 换作用方式：已绑字段立即按新方式重绑；未绑则只记住选择，等点 chip 时生效 */
  const pickMode = (next: BindingAggregateMode): void => {
    setMode(next)
    if (!addr || !boundColumn) return
    const preset = buildBindingPreset(inRepeatable, boundColumn, next)
    write(preset)
    setPath(preset.path)
    setAggregate(preset.aggregate)
    setStatus(
      `已改为「${AGGREGATE_MODES.find((m) => m.value === next)?.label}」：${formatBindingPlaceholder({ datasetId, path: preset.path, aggregate: preset.aggregate })}`,
    )
  }

  const clear = (): void => {
    if (!addr || !doc.getCellBinding(addr)) return
    doc.setCellBinding(addr, null)
    onEdited()
    setPath('')
    setAggregate(undefined)
    setStatus('已解除绑定')
  }

  // 高级层：路径树由重塑形态生成（仅此层用得到，展开区的简单流程不需要）
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

  const applyAdvanced = (): void => {
    if (!addr || !datasetId || !path || pathError) return
    doc.setCellBinding(addr, {
      datasetId,
      expression: expression.trim() || undefined,
      path,
      aggregate: inRepeatable ? undefined : aggregate,
    })
    onEdited()
    setStatus('已应用高级绑定')
  }

  // 有表达式说明用的是嵌套重塑形态，默认展开高级层，避免用户以为「绑定丢了」
  const advancedOpenByDefault = Boolean(current?.expression)

  return (
    <div className="binding-editor">
      <TargetBar
        addr={addr}
        regionLabel={region ? regionTag(region, doc.regions.indexOf(region)) : undefined}
        inRepeatable={inRepeatable}
        current={current}
        onClear={clear}
      />

      {error ? <p className="status error">{error}</p> : null}

      {datasets !== null && datasets.length === 0 ? (
        <div className="binding-empty">
          <p>还没有数据集。去顶部「数据」页新建一个数据集，再用它的字段来填表。</p>
        </div>
      ) : (
        <>
          <label className="field-col">
            <span className="field-label">数据集</span>
            <select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
              <option value="">选择数据集…</option>
              {datasets?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>

          {datasetId ? (
            shape ? (
              <FieldChips
                columns={shape.columns}
                sampleRow={shape.rows[0]}
                boundColumn={boundColumn}
                disabled={!addr}
                onPick={pickField}
              />
            ) : (
              <p className="hint">正在读取字段…</p>
            )
          ) : (
            <p className="hint">选好数据集后，这里会列出可以绑定的字段。</p>
          )}

          {inRepeatable ? (
            <p className="hint">这块区域会按数据份数复制，按份取值，不需要聚合。</p>
          ) : (
            <ModeRow value={mode} disabled={!addr} onChange={pickMode} />
          )}
        </>
      )}

      {status ? <p className="status">{status}</p> : null}

      <details className="binding-advanced" open={advancedOpenByDefault}>
        <summary>
          高级：嵌套数据结构
          <span className="chevron">›</span>
        </summary>
        <div className="binding-advanced-body">
          <p className="hint">
            只有当数据集是嵌套结构（例如一个订单带多条明细）时才需要这里：写一段把数据整形成嵌套形态的表达式，
            再从路径树里点具体字段。普通「一列一个字段」的数据集用上面的字段按钮就够了。
          </p>

          <label className="field-col">
            <span className="field-label">重塑表达式（JS，入参 rows）</span>
            <textarea
              rows={3}
              value={expression}
              onChange={(event) => setExpression(event.target.value)}
              placeholder={'如 rows.reduce(...)；留空 = 原始行数组直接作形态'}
            />
          </label>
          {reshapeError ? <p className="status error">{reshapeError}</p> : null}

          <div className="binding-tree-wrap">
            {tree.length > 0 ? (
              <BindingTree nodes={tree} depth={0} onPick={setPath} />
            ) : (
              <p className="hint">
                {sourceRows ? '重塑结果暂无可选路径' : '选择数据集后生成路径树'}
              </p>
            )}
          </div>

          <div className="binding-split">
            <label className="field-col">
              <span className="field-label">路径</span>
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="如 items[].price"
              />
            </label>
            <label className="field-col">
              <span className="field-label">聚合</span>
              <select
                value={aggregate ?? ''}
                onChange={(event) =>
                  setAggregate((event.target.value || undefined) as FormCellBinding['aggregate'])
                }
                disabled={inRepeatable}
                title={inRepeatable ? '展开区按份取值，不支持聚合' : '静态格常用求和/平均等'}
              >
                <option value="">直取</option>
                {AGGREGATE_MODES.filter((item) => item.value !== 'first').map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {pathError ? <p className="status error">{pathError}</p> : null}

          <div className="binding-actions">
            <button
              type="button"
              className="primary"
              onClick={applyAdvanced}
              disabled={!addr || !datasetId || !path || !!pathError}
            >
              应用绑定
            </button>
            <button type="button" onClick={clear} disabled={!current}>
              清除绑定
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}

/** 目标格条：无选区给指引，有选区给地址 + 区域 + 当前绑定 + 解除按钮 */
function TargetBar({
  addr,
  regionLabel,
  inRepeatable,
  current,
  onClear,
}: {
  addr: CellAddress | undefined
  regionLabel: string | undefined
  inRepeatable: boolean
  current: FormCellBinding | undefined
  onClear: () => void
}) {
  if (!addr) {
    return <p className="binding-target empty">在画布上点选一个单元格，即可为它绑定数据字段。</p>
  }
  return (
    <div className="binding-target">
      <span className="addr">{formatAddress(addr)}</span>
      {regionLabel ? (
        <span className="region-tag">{regionLabel}</span>
      ) : (
        <span className="meta">静态内容</span>
      )}
      {current ? (
        <>
          <span className="binding-target-value" title="当前绑定">
            {formatBindingPlaceholder(current)}
          </span>
          <button type="button" className="binding-unbind" onClick={onClear}>
            解除绑定
          </button>
        </>
      ) : (
        <span className="meta">{inRepeatable ? '未绑定（展开区按份取值）' : '未绑定'}</span>
      )}
    </div>
  )
}

/** 字段 chip 区：点一下即绑定；已绑字段显示选中态；chip 内带极小类型提示 */
function FieldChips({
  columns,
  sampleRow,
  boundColumn,
  disabled,
  onPick,
}: {
  columns: string[]
  sampleRow: SourceRow | undefined
  boundColumn: string | undefined
  disabled: boolean
  onPick: (column: string) => void
}) {
  if (columns.length === 0) return <p className="hint">这个数据集没有返回任何列。</p>
  return (
    <div className="binding-fields">
      <span className="field-label">点一个字段即完成绑定</span>
      <div className="field-chips">
        {columns.map((column) => {
          const kind = fieldKindOf(sampleRow?.[column])
          return (
            <button
              key={column}
              type="button"
              className={column === boundColumn ? 'field-chip active' : 'field-chip'}
              disabled={disabled}
              title={`${column} · ${kind.title}${disabled ? '（先在画布上选一个格）' : ''}`}
              onClick={() => onPick(column)}
            >
              <span className="field-chip-name">{column}</span>
              <span className={kind.text === '空' ? 'field-chip-kind empty' : 'field-chip-kind'}>
                {kind.text}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 作用方式切换：一排小按钮（只对非展开区显示） */
function ModeRow({
  value,
  disabled,
  onChange,
}: {
  value: BindingAggregateMode
  disabled: boolean
  onChange: (next: BindingAggregateMode) => void
}) {
  return (
    <div className="binding-modes">
      <span className="field-label">作用方式</span>
      <div className="mode-buttons">
        {AGGREGATE_MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            className="mode-button"
            aria-pressed={item.value === value}
            disabled={disabled}
            title={item.hint}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
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

/** 区域标签文案：`区域 N · 向下展开` / `区域 N` */
function regionTag(region: FormRegion, index: number): string {
  const expand =
    region.expand === 'none'
      ? ''
      : REGION_EXPAND_OPTIONS.find((option) => option.value === region.expand)?.label
  return expand ? `区域 ${index + 1} · ${expand}` : `区域 ${index + 1}`
}
