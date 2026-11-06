// 字段绑定面板：默认「选数据集 → 点字段 chip」一步完成绑定，高级层折叠收起重塑表达式 / 路径树 / 手写路径。
//
// 设计意图：画布常规选区就是绑定目标（没有额外开关），字段清单直接取数据集的列，
// 点一下就写入绑定；表达式、路径树、手写路径、聚合都收在「高级」折叠层里。
//
// 展开区（`region.expand !== 'none'`）内的格走另一档语义：数据源由区域自己声明
// （数据集 + 重塑表达式 + 列表路径），格绑定只记条目内的相对字段名，不选数据集、不聚合。
import { useEffect, useMemo, useState } from 'react'

import { formatAddress, type CellAddress } from '@infinitable/sheet'

import { api, toSourceRows, type DatasetRow } from '../data/api'
import type { SourceRow } from '../transform/reshape'
import { buildBindingTree, parseBindingPath, reshapeDatasetData } from './binding'
import {
  BindingAdvancedFields,
  BindingFieldChips,
  BindingModeRow,
  BindingTargetBar,
} from './binding-fields'
import {
  AGGREGATE_MODES,
  boundColumnOf,
  buildBindingPreset,
  detectAggregateMode,
  type BindingAggregateMode,
} from './binding-presets'
import type { FormDoc } from './form-doc'
import { formatBindingPlaceholder, regionLabel, regionsAt, type FormCellBinding } from './template'
import { describeError } from '../errors'

interface Props {
  doc: FormDoc
  /** 当前选区活动格（画布常规选区即绑定目标） */
  addr: CellAddress | undefined
  /** 绑定写入/清除后回画布刷新占位符 */
  onEdited: () => void
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
      .catch((cause: unknown) => setError(describeError(cause)))
  }, [])

  // 当前格所在的区域：任一 expand !== 'none' 的区域即「会被按数据份数重复复制」
  const region = addr ? regionsAt(doc.regions, addr.row, addr.col) : undefined
  const regionIndex = region ? doc.regions.indexOf(region) : -1
  const inExpandRegion = region !== undefined && region.expand !== 'none'
  /** 展开区的数据源由区域声明；格绑定只记条目内相对字段，数据集下拉禁用并显示「跟随区域 N」 */
  const regionDatasetId = inExpandRegion ? region.source?.datasetId : undefined
  const effectiveDatasetId = inExpandRegion ? (regionDatasetId ?? '') : datasetId

  // 数据集切换/首次选择时执行取列与原始行（缓存命中即免请求）；展开区换区域时也跟着取
  useEffect(() => {
    if (!effectiveDatasetId || shapes.has(effectiveDatasetId)) return
    let cancelled = false
    api
      .executeDataset(effectiveDatasetId)
      .then((result) => {
        if (cancelled) return
        setShapes((prev) =>
          new Map(prev).set(effectiveDatasetId, {
            columns: result.columns,
            rows: toSourceRows(result),
          }),
        )
        setError('')
      })
      .catch((cause: unknown) => setError(describeError(cause)))
    return () => {
      cancelled = true
    }
  }, [effectiveDatasetId, shapes])

  const current = addr ? doc.getCellBinding(addr) : undefined
  const boundColumn = boundColumnOf(current)
  const addrKey = addr ? formatAddress(addr) : undefined

  // 切换目标格：回填既有绑定的数据集 / 作用方式 / 高级层字段（无绑定则保留上次的数据集，便于连绑）
  if (addrKey !== lastAddr) {
    setLastAddr(addrKey)
    setDatasetId(current?.datasetId ?? datasetId)
    setMode(detectAggregateMode(inExpandRegion, current))
    setExpression(current?.expression ?? '')
    setPath(current?.path ?? '')
    setAggregate(current?.aggregate)
    setStatus('')
  }

  const shape = effectiveDatasetId ? shapes.get(effectiveDatasetId) : undefined
  const sourceRows = shape?.rows

  /** 写入绑定（一次点击的唯一落点）：保留当前高级层表达式，其余按预设覆盖 */
  const write = (preset: { path: string; aggregate: FormCellBinding['aggregate'] }): void => {
    if (!addr || !effectiveDatasetId) return
    // 展开区格：只写条目内相对字段，数据集/表达式继承区域 source、聚合无意义
    if (inExpandRegion) doc.setCellBinding(addr, relativeBinding(preset.path))
    else
      doc.setCellBinding(addr, {
        datasetId: effectiveDatasetId,
        expression: expression.trim() || undefined,
        path: preset.path,
        aggregate: preset.aggregate,
      })
    onEdited()
  }

  /** 点字段 chip：立即绑定（展开区按行、其它区按当前作用方式） */
  const pickField = (column: string): void => {
    if (!addr || !effectiveDatasetId) return
    const preset = buildBindingPreset(inExpandRegion, column, mode)
    write(preset)
    setPath(preset.path)
    setAggregate(preset.aggregate)
    setStatus(
      inExpandRegion
        ? `已绑定 ${column}（按明细份取值）`
        : `已绑定 ${column}（${mode === 'first' ? '取第 1 条' : AGGREGATE_MODES.find((m) => m.value === mode)?.label}）`,
    )
  }

  /** 换作用方式：已绑字段立即按新方式重绑；未绑则只记住选择，等点 chip 时生效 */
  const pickMode = (next: BindingAggregateMode): void => {
    setMode(next)
    if (!addr || !boundColumn) return
    const preset = buildBindingPreset(inExpandRegion, boundColumn, next)
    write(preset)
    setPath(preset.path)
    setAggregate(preset.aggregate)
    setStatus(
      `已改为「${AGGREGATE_MODES.find((m) => m.value === next)?.label}」：${formatBindingPlaceholder({ datasetId: effectiveDatasetId, path: preset.path, aggregate: preset.aggregate })}`,
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
    if (!sourceRows) return { tree: [], reshapeError: '' }
    try {
      return {
        tree: buildBindingTree(reshapeDatasetData(expression, sourceRows)),
        reshapeError: '',
      }
    } catch (cause) {
      return {
        tree: [],
        reshapeError: describeError(cause),
      }
    }
  }, [expression, sourceRows])

  const pathError = useMemo(() => {
    if (!path) return ''
    try {
      parseBindingPath(path)
      return ''
    } catch (cause) {
      return describeError(cause)
    }
  }, [path])

  const applyAdvanced = (): void => {
    if (!addr || !path || pathError) return
    // 展开区格：高级层只用来手写条目内相对路径（如 customer.name），不写数据集/聚合
    if (inExpandRegion) {
      doc.setCellBinding(addr, relativeBinding(path))
    } else {
      if (!effectiveDatasetId) return
      doc.setCellBinding(addr, {
        datasetId: effectiveDatasetId,
        expression: expression.trim() || undefined,
        path,
        aggregate,
      })
    }
    onEdited()
    setStatus('已应用高级绑定')
  }

  // 有表达式说明用的是嵌套重塑形态，默认展开高级层，避免用户以为「绑定丢了」；
  // 展开区里的相对路径不是裸列名时同理（用户手写过嵌套路径）
  const advancedOpenByDefault = Boolean(current?.expression) || (inExpandRegion && !boundColumn)

  return (
    <div className="binding-editor">
      <BindingTargetBar
        addr={addr}
        regionLabel={region ? regionLabel(region, regionIndex) : undefined}
        inExpandRegion={inExpandRegion}
        current={current}
        onClear={clear}
      />

      {error ? <p className="status error">{error}</p> : null}

      {datasets !== null && datasets.length === 0 && !inExpandRegion ? (
        <div className="binding-empty">
          <p>还没有数据集。去顶部「数据」页新建一个数据集，再用它的字段来填表。</p>
        </div>
      ) : (
        <>
          <label className="field-col">
            <span className="field-label">数据集</span>
            {inExpandRegion ? (
              // 展开区：数据源由区域声明，这里只读回显（改数据源去「区域」tab 的设置弹框）
              <select
                value={effectiveDatasetId}
                disabled
                title="数据源由所在区域决定，在「区域」tab 的设置弹框里修改"
              >
                <option value={effectiveDatasetId}>
                  {`跟随区域 ${regionIndex + 1}`}
                  {datasetNameOf(datasets, effectiveDatasetId)}
                </option>
              </select>
            ) : (
              <select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
                <option value="">选择数据集…</option>
                {datasets?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            )}
          </label>

          {effectiveDatasetId ? (
            shape ? (
              <BindingFieldChips
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
            <p className="hint">
              {inExpandRegion
                ? `区域 ${regionIndex + 1} 还没有设数据源：去「区域」tab 点「设置…」选数据集和列表路径。`
                : '选好数据集后，这里会列出可以绑定的字段。'}
            </p>
          )}

          {inExpandRegion ? (
            <p className="hint">
              这块区域按明细逐份复制：格子里点字段即取当前那份的同名字段，不需要聚合。
            </p>
          ) : (
            <BindingModeRow value={mode} disabled={!addr} onChange={pickMode} />
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
          {inExpandRegion ? (
            <>
              <p className="hint">
                明细条目本身是嵌套对象（例如带 customer 子对象）时才需要这里：手写条目内的相对路径，
                如 customer.name；留不下值就填裸字段名。
              </p>
              <label className="field-col">
                <span className="field-label">条目内路径</span>
                <input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="如 customer.name / item_name"
                />
              </label>
              {pathError ? <p className="status error">{pathError}</p> : null}
              <div className="binding-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={applyAdvanced}
                  disabled={!addr || !path || !!pathError}
                >
                  应用绑定
                </button>
                <button type="button" onClick={clear} disabled={!current}>
                  清除绑定
                </button>
              </div>
            </>
          ) : (
            <BindingAdvancedFields
              expression={expression}
              onExpressionChange={setExpression}
              reshapeError={reshapeError}
              tree={tree}
              sourceRows={sourceRows}
              onPickPath={setPath}
              path={path}
              onPathChange={setPath}
              pathError={pathError}
              aggregate={aggregate}
              onAggregateChange={setAggregate}
              applyDisabled={!addr || !datasetId || !path || !!pathError}
              onApply={applyAdvanced}
              onClear={clear}
              clearDisabled={!current}
            />
          )}
        </div>
      </details>
    </div>
  )
}

/** 数据集 id → 下拉里追加的括号名（跟随时让用户看清具体数据集；未收录不显示） */
function datasetNameOf(datasets: DatasetRow[] | null, datasetId: string): string {
  const row = datasets?.find((item) => item.id === datasetId)
  return row ? `（${row.name}）` : ''
}

/**
 * 展开区格的绑定载荷：只有条目内相对路径。
 * 数据集与重塑表达式继承区域 source，聚合在按份复制的语境里没有意义——
 * 因此落盘形态恒为 `{ path }`，不写 datasetId/expression/aggregate。
 */
function relativeBinding(path: string): FormCellBinding {
  return { path }
}
