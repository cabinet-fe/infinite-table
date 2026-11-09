// 单元格面板（v4）：字段绑定 + 聚合引用 + 函数。
//
// - **数据块内（带数据源）**：字段 chips 一点即绑（绑定 = 条目内相对路径，跟随数据块
//   数据源；不展开的数据块取第 1 条）。没有数据集下拉——数据源只能在「数据块」tab 配置，
//   两处概念彻底分开；
// - **数据块内（未设源）**：提示先去数据块设置配数据源；
// - **数据块外**：可以直接引用**非数组聚合**（点聚合 → 点它返回的值即绑，单据头这类值
//   不用套数据块），或用下方的函数编辑器（`agg.名['键']` 老语法保留，两套并存）；
// - 函数（替代「作用方式」）：任何单元格都可设（数据块内外的合计、小计、计算列），
//   与字段绑定互斥，写入自动替换；参数 = 选函数后到画布上点参数格（数据块/字段由
//   被点格子推导，见 cell-function.ts 的 deriveParamCell），本面板只触发与展示。
//   条目采样按**全部带源的数据块**缓存一份，绑定 chips 用它给字段。
import { useEffect, useMemo, useState } from 'react'

import type { CellAddress } from '@infinitable/sheet'

import { api, toSourceRows } from '../data/api'
import type { SourceRow } from '../transform/reshape'
import { InfoBubble } from './InfoBubble'
import { runAggregations } from './aggregation'
import { buildBindingTree, loopArrayAt, reshapeDatasetData } from './binding'
import { BindingFieldChips, BindingPathTree, BindingTargetBar } from './binding-fields'
import { CellFunctionEditor, type FnPickState } from './cell-function-editor'
import type { FormDoc } from './form-doc'
import {
  formatBindingPlaceholder,
  formatFunctionPlaceholder,
  isAggBinding,
  regionLabel,
  regionsAt,
  type CellFnName,
  type FormCellFunction,
} from './template'
import { describeError } from '../errors'

interface Props {
  doc: FormDoc
  /** 当前选区活动格（画布常规选区即绑定目标） */
  addr: CellAddress | undefined
  /** 绑定/函数写入/清除后回画布刷新占位符 */
  onEdited: () => void
  /** 单元格函数点选状态（宿主 DesignerPage 持有；仅目标格与本格一致时透传给编辑器） */
  fnPick: FnPickState | null
  /** 选定函数 → 进入画布点选参数格 */
  onFnPickStart: (fn: CellFnName, targetAddr: CellAddress) => void
  /** 取消点选（面板按钮；Esc 走宿主全局监听） */
  onFnPickCancel: () => void
}

export function BindingEditor({
  doc,
  addr,
  onEdited,
  fnPick,
  onFnPickStart,
  onFnPickCancel,
}: Props) {
  const [error, setError] = useState('')
  /** 数据集原始行缓存（条目字段采样用；按 datasetId 记忆） */
  const [rowsByDataset, setRowsByDataset] = useState<Map<string, SourceRow[]>>(new Map())

  const region = addr ? regionsAt(doc.regions, addr.row, addr.col) : undefined
  const regionIndex = region ? doc.regions.indexOf(region) : -1
  const binding = addr ? doc.getCellBinding(addr) : undefined
  const fn = addr ? doc.getCellFunction(addr) : undefined

  /** 全部带源数据块的取数并集（条目采样：当前数据块绑定 chips 与函数参数下拉共用一份缓存） */
  const neededDatasetIds = useMemo(() => {
    const ids = new Set<string>()
    for (const source of doc.regions.flatMap((item) => (item.source ? [item.source] : []))) {
      if (source.kind === 'dataset') {
        ids.add(source.datasetId)
      } else {
        for (const agg of doc.aggregations) {
          if (agg.name === source.aggName) {
            for (const param of agg.params) ids.add(param.datasetId)
          }
        }
      }
    }
    return [...ids]
  }, [doc.regions, doc.aggregations])

  useEffect(() => {
    const missing = neededDatasetIds.filter((id) => !rowsByDataset.has(id))
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(
      missing.map(async (id) => [id, toSourceRows(await api.executeDataset(id))] as const),
    )
      .then((entries) => {
        if (cancelled) return
        setRowsByDataset((prev) => {
          const next = new Map(prev)
          for (const [id, rows] of entries) next.set(id, rows)
          return next
        })
        setError('')
      })
      .catch((cause: unknown) => setError(describeError(cause)))
    return () => {
      cancelled = true
    }
  }, [neededDatasetIds, rowsByDataset])

  /**
   * 各数据块循环条目（与打印同一条管线：重塑/聚合 → 列表路径）。
   * 覆盖全部带源的数据块而不只当前数据块——字段 chips 按当前数据块给字段。
   */
  const itemsByRegion = useMemo(() => {
    const loading = neededDatasetIds.some((id) => !rowsByDataset.has(id))
    const aggResults =
      loading || doc.aggregations.length === 0
        ? undefined
        : (() => {
            try {
              return runAggregations(doc.aggregations, rowsByDataset)
            } catch {
              return undefined
            }
          })()
    const map = new Map<number, unknown[]>()
    doc.regions.forEach((item, index) => {
      const source = item.source
      if (!source) return
      if (source.kind === 'dataset') {
        if (!rowsByDataset.has(source.datasetId)) return // 取数中
        try {
          map.set(
            index,
            loopArrayAt(
              reshapeDatasetData(source.expression, rowsByDataset.get(source.datasetId) ?? []),
              source.path,
            ) ?? [],
          )
        } catch {
          // 取不到循环数组：不进表（chips / 参数下拉按「暂无字段」呈现）
        }
        return
      }
      if (!aggResults) return // 取数中或聚合求值失败
      map.set(index, loopArrayAt(aggResults[source.aggName], source.path) ?? [])
    })
    return map
  }, [doc.regions, doc.aggregations, rowsByDataset, neededDatasetIds])

  /** 当前数据块循环条目（undefined = 无源或取数中） */
  const items = regionIndex >= 0 ? itemsByRegion.get(regionIndex) : undefined

  /** 各数据块条目字段采样（绑定 chips 的数据源；条目本身是对象才有的列） */
  const fieldsByRegion = useMemo(() => {
    const map = new Map<number, { key: string; sample: unknown }[]>()
    for (const [index, regionItems] of itemsByRegion) {
      const sample = regionItems.find((item) => item !== null && item !== undefined)
      if (!sample || typeof sample !== 'object' || Array.isArray(sample)) continue
      map.set(
        index,
        Object.entries(sample as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, sample2]) => ({ key, sample: sample2 })),
      )
    }
    return map
  }, [itemsByRegion])

  /** 当前数据块条目字段（chips 数据源；采样不出对象列 = 空数组，chips 自带空态提示） */
  const fields = regionIndex >= 0 ? (fieldsByRegion.get(regionIndex) ?? []) : []

  /** 高级层：嵌套条目的路径树（以首条条目为形状） */
  const tree = useMemo(() => (items?.[0] !== undefined ? buildBindingTree(items[0]) : []), [items])

  // ─── 块外格：直接引用非数组聚合（块内格保持相对绑定，不提供此入口） ──────────

  /** value 型聚合清单（数组型不列——数组型要绑成数据块逐条展开） */
  const valueAggs = useMemo(
    () => doc.aggregations.filter((agg) => agg.type === 'value'),
    [doc.aggregations],
  )

  /** 已绑定的聚合引用（切格/换绑跟随；块外格 UI 的「当前引用 + 可换可清」载体） */
  const boundAgg = binding && isAggBinding(binding) ? binding : undefined
  const [pickedAgg, setPickedAgg] = useState<string | undefined>(boundAgg?.aggName)
  useEffect(() => {
    setPickedAgg(boundAgg?.aggName)
  }, [addr?.row, addr?.col, boundAgg?.aggName])

  /**
   * 选中聚合的**空数据试跑**（每入参传 []、agg 传 {}，与 probeAggregationType 同口径）：
   * 返回值决定可绑 chips——对象 → 键 chips + 嵌套路径树，原始值 → 「值本身」chip。
   * memo 依赖不变只跑一次；失败显示原因、不列 chips。
   */
  const probe = useMemo<{ value: unknown; error: string } | undefined>(() => {
    if (!pickedAgg) return undefined
    const agg = doc.aggregations.find((item) => item.name === pickedAgg)
    if (!agg) return { value: undefined, error: `聚合「${pickedAgg}」不存在` }
    try {
      return { value: runAggregations([agg], new Map<string, SourceRow[]>())[pickedAgg], error: '' }
    } catch (cause) {
      return { value: undefined, error: describeError(cause) }
    }
  }, [doc.aggregations, pickedAgg])

  /** 试跑返回对象（非数组）：键 chips 与路径树的取值来源 */
  const probeRecord =
    probe && !probe.error && typeof probe.value === 'object' && probe.value !== null && !Array.isArray(probe.value)
      ? (probe.value as Record<string, unknown>)
      : undefined
  const aggFields = useMemo(
    () =>
      probeRecord
        ? Object.entries(probeRecord)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, sample]) => ({ key, sample }))
        : [],
    [probeRecord],
  )
  const aggTree = useMemo(() => (probeRecord ? buildBindingTree(probeRecord) : []), [probeRecord])

  /** 点聚合返回值里的一个路径即绑到当前格（path '' = 值本身）；写入即生效 */
  const pickAggPath = (path: string): void => {
    if (!addr || !pickedAgg) return
    doc.setCellBinding(addr, { kind: 'agg', aggName: pickedAgg, path })
    onEdited()
  }

  const pickField = (key: string): void => {
    if (!addr) return
    doc.setCellBinding(addr, { path: key })
    onEdited()
  }

  const clearCell = (): void => {
    if (!addr) return
    if (binding) doc.setCellBinding(addr, null)
    if (fn) doc.setCellFunction(addr, null)
    onEdited()
  }

  const commitFunction = (next: FormCellFunction | null): void => {
    if (!addr) return
    doc.setCellFunction(addr, next)
    onEdited()
  }

  const currentLabel = binding
    ? formatBindingPlaceholder(binding)
    : fn
      ? formatFunctionPlaceholder(fn)
      : undefined

  return (
    <div className="binding-editor">
      <BindingTargetBar
        addr={addr}
        regionLabel={region ? regionLabel(region, regionIndex) : undefined}
        inRegion={region !== undefined}
        currentLabel={currentLabel}
        onClear={clearCell}
        clearLabel={binding ? '解除绑定' : '清除函数'}
      />

      {error ? <p className="status error">{error}</p> : null}

      {region ? (
        region.source ? (
          <div className="binding-region-fields">
            <p className="hint">
              点字段即绑定到当前格。
              <InfoBubble label="字段取值规则">
                字段跟随数据块数据源（数据集或聚合，在「数据块」tab 配置）：列表区每行按条目
                取值；非列表的数据块取第 1 条数据（适合单据头字段）。
              </InfoBubble>
            </p>
            {boundAgg ? (
              <p className="hint">
                本格当前是聚合引用（{formatBindingPlaceholder(boundAgg)}）：不随数据块数据源
                取值。点下面的字段可改回相对绑定。
              </p>
            ) : null}
            {items === undefined ? (
              <p className="hint">正在取数…</p>
            ) : (
              <BindingFieldChips
                fields={fields}
                boundKey={binding && !isAggBinding(binding) ? binding.path : undefined}
                disabled={!addr}
                onPick={pickField}
              />
            )}
            {tree.length > 0 ? (
              <details className="binding-advanced">
                <summary>
                  高级：嵌套条目路径
                  <span className="chevron">›</span>
                </summary>
                <div className="binding-advanced-body">
                  <p className="hint">
                    条目是嵌套对象（如带 customer 子对象）时，从树里点出条目内相对路径。
                  </p>
                  <BindingPathTree nodes={tree} depth={0} onPick={pickField} />
                </div>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="hint">
            该数据块还没有数据源，暂不能绑定字段。
            <InfoBubble label="怎么配数据源">
              字段绑定必须在绑了数据源的数据块里。去「数据块」tab 打开设置，在「数据源」页
              选择数据集或聚合。
            </InfoBubble>
          </p>
        )
      ) : addr ? (
        <div className="binding-outside">
          <p className="hint">
            这个格子在数据块之外：可直接引用非数组聚合，或在下方设置函数。
            <InfoBubble label="数据块外的格子">
              单据头这类值直接引用非数组聚合（点下面的聚合名，再点它返回的值），不用套数据
              块。数据块只为绑数据集或数组型聚合（逐条打印）而存在；固定文字直接写在格子里，
              不需要数据块。函数里 <code>agg.名['键']</code> 老语法照常可用。
            </InfoBubble>
          </p>
          {valueAggs.length === 0 ? (
            <p className="hint">还没有非数组型聚合：先去「聚合」tab 新建一个（类型选非数组型）。</p>
          ) : (
            <>
              <div className="field-col">
                <span className="field-label">引用非数组聚合</span>
                <div className="field-chips">
                  {valueAggs.map((agg) => (
                    <button
                      key={agg.name}
                      type="button"
                      className={
                        pickedAgg === agg.name ? 'field-chip mono-chip active' : 'field-chip mono-chip'
                      }
                      title={`点开 agg.${agg.name} 返回值里的可绑路径`}
                      onClick={() => setPickedAgg(agg.name)}
                    >
                      agg.{agg.name}
                    </button>
                  ))}
                </div>
              </div>
              {pickedAgg ? (
                probe?.error ? (
                  <p className="status error">空数据试跑失败，暂列不出可绑的值：{probe.error}</p>
                ) : probeRecord ? (
                  <>
                    <BindingFieldChips
                      fields={aggFields}
                      boundKey={boundAgg?.aggName === pickedAgg ? boundAgg.path : undefined}
                      disabled={!addr}
                      onPick={pickAggPath}
                    />
                    {aggTree.length > 0 ? (
                      <details className="binding-advanced">
                        <summary>
                          高级：嵌套值路径
                          <span className="chevron">›</span>
                        </summary>
                        <div className="binding-advanced-body">
                          <p className="hint">聚合返回嵌套对象时，从树里点出要取的路径。</p>
                          <BindingPathTree nodes={aggTree} depth={0} onPick={pickAggPath} />
                        </div>
                      </details>
                    ) : null}
                  </>
                ) : Array.isArray(probe?.value) ? (
                  <p className="hint">空数据试跑返回了数组：数组型产物请绑成数据块逐条打印。</p>
                ) : (
                  <div className="binding-fields">
                    <span className="field-label">
                      {probe?.value === undefined || probe?.value === null
                        ? '空数据试跑没取到值，可先绑「值本身」（真实数据可能取得到）'
                        : '这个聚合返回原始值'}
                    </span>
                    <div className="field-chips">
                      <button
                        type="button"
                        className={
                          boundAgg?.aggName === pickedAgg && boundAgg.path === ''
                            ? 'field-chip active'
                            : 'field-chip'
                        }
                        disabled={!addr}
                        onClick={() => pickAggPath('')}
                      >
                        <span className="field-chip-name">值本身</span>
                      </button>
                    </div>
                  </div>
                )
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {addr ? (
        // key = 目标格：切格即重挂载，未应用的自定义 JS 草稿随之丢弃（不跨格错绑）。
        // 点选状态只在目标格一致时下传——失败重试期间选区临时在参数格上，那格的
        // 编辑器不该显示别人的点选提示
        <CellFunctionEditor
          key={`${addr.row}:${addr.col}`}
          doc={doc}
          addr={addr}
          fn={fn}
          pick={
            fnPick && fnPick.targetAddr.row === addr.row && fnPick.targetAddr.col === addr.col
              ? fnPick
              : null
          }
          onPickStart={onFnPickStart}
          onPickCancel={onFnPickCancel}
          onCommit={commitFunction}
        />
      ) : null}
    </div>
  )
}
