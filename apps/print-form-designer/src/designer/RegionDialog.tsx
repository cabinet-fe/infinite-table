// 数据块设置弹框（v4）：顶部 tab 分组——基本 / 数据源 / 分组。
//
// 设计口径：
// - **范围不用输入框调**：基本页只读展示范围，调整走画布（拖边缘/角，或框选后
//   右键「把数据块调整为选区大小」）；
// - 数据源两档：数据集（重塑表达式 + 列表路径）或**数组型**聚合（取 agg.{name} 的
//   返回列表循环；下拉只列数组型，非数组型聚合不能作数据块数据源——迁移可能留下
//   旧选中，就地警示并允许清空/换选），实时预览条数（与打印同一条
//   reshape/loopArrayAt/runAggregations 管线）；
// - 分组页（向下展开区）：场景化说明（用当前字段举例）+ 分组字段 chips（按循环条目采样）
//   + 迷你示意（组头→明细×N→小计→…→合计的教学小表格）+ 「每一行打印什么」角色表
//   （明细/组头/小计/合计；画布行头右键也能设；首次配分组字段时管线自动预填典型布局）；
// - 所有改动即时写 doc（天然可撤销），弹框只承载表单——没有「确定/应用」按钮。
import { useEffect, useMemo, useRef, useState } from 'react'

import { colIndexToName } from '@infinitable/sheet'

import { api, toSourceRows, type DatasetRow } from '../data/api'
import type { SourceRow } from '../transform/reshape'
import { InfoBubble } from './InfoBubble'
import { runAggregations } from './aggregation'
import { loopArrayAt, reshapeDatasetData } from './binding'
import { REGION_EXPAND_COLORS } from './canvas-overlay'
import type { FormDoc } from './form-doc'
import {
  REGION_EXPAND_OPTIONS,
  REGION_ROW_ROLES,
  regionRowRoleOf,
  type FormRegion,
  type RegionExpand,
  type RegionRowRole,
} from './template'
import { IconClose, IconTrash } from '../ui/icons'
import { describeError, runGuarded } from '../errors'

interface RegionDialogProps {
  doc: FormDoc
  /** 目标数据块下标 */
  index: number
  onClose: () => void
}

type DialogTab = 'basic' | 'source' | 'group'

const TABS: { value: DialogTab; label: string }[] = [
  { value: 'basic', label: '基本' },
  { value: 'source', label: '数据源' },
  { value: 'group', label: '分组' },
]

export function RegionDialog({ doc, index, onClose }: RegionDialogProps) {
  // 数据块从 doc 现读：改动即时落库，弹框只做展示与输入
  const region = doc.regions[index]
  const [tab, setTab] = useState<DialogTab>('basic')
  const [error, setError] = useState('')
  const [datasets, setDatasets] = useState<DatasetRow[] | null>(null)
  /** 数据集原始行缓存（数据源预览与聚合试运行共用；按 datasetId 记忆） */
  const [rowsByDataset, setRowsByDataset] = useState<Map<string, SourceRow[]>>(new Map())
  const [rowsError, setRowsError] = useState('')

  // 名称 / 表达式 / 路径是文本输入：草稿态 + 失焦提交，避免每敲一个字进一次撤销链
  const [nameDraft, setNameDraft] = useState(region?.name ?? '')
  const [expressionDraft, setExpressionDraft] = useState(
    region?.source?.kind === 'dataset' ? (region.source.expression ?? '') : '',
  )
  const [pathDraft, setPathDraft] = useState(region?.source?.path ?? '')

  /**
   * 草稿同步键：数据块下标 + doc 里那三项的值。
   * doc 只在失焦提交时变（等于刚输入的草稿），所以这里回填不会打断打字；
   * 换数据块、撤销、换模板则能立刻把草稿拉回模型值。
   */
  const syncKey = [
    index,
    region?.name ?? '',
    region?.source?.kind === 'dataset' ? (region.source.expression ?? '') : '',
    region?.source?.path ?? '',
  ].join('\u0000')
  const syncedRef = useRef('')
  useEffect(() => {
    if (syncedRef.current === syncKey) return
    syncedRef.current = syncKey
    setNameDraft(doc.regions[index]?.name ?? '')
    setExpressionDraft(
      doc.regions[index]?.source?.kind === 'dataset'
        ? (doc.regions[index]!.source as { expression?: string }).expression ?? ''
        : '',
    )
    setPathDraft(doc.regions[index]?.source?.path ?? '')
  }, [doc, index, syncKey])

  useEffect(() => {
    api
      .listDatasets()
      .then((list) => setDatasets(list))
      .catch((cause: unknown) => setError(describeError(cause)))
  }, [])

  /** 当前数据源用到的数据集 id 集合（dataset 来源一个；agg 来源 = 该聚合全部入参） */
  const neededDatasetIds = useMemo(() => {
    const source = region?.source
    if (!source) return []
    if (source.kind === 'dataset') return [source.datasetId]
    const agg = doc.aggregations.find((item) => item.name === source.aggName)
    return agg ? agg.params.map((param) => param.datasetId) : []
  }, [region?.source, doc.aggregations])

  // 数据源变化时取原始行（缺哪个取哪个，已缓存的不再请求）
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
        setRowsError('')
      })
      .catch((cause: unknown) => {
        if (!cancelled) setRowsError(describeError(cause))
      })
    return () => {
      cancelled = true
    }
  }, [neededDatasetIds, rowsByDataset])

  /** 数据源在当前输入下的循环数组（数据集：重塑管线；聚合：全量聚合后取结果） */
  const loopPreview = useMemo<
    { array: unknown[] | undefined; error: string } | { array: undefined; error: string }
  >(() => {
    const source = region?.source
    if (!source || neededDatasetIds.some((id) => !rowsByDataset.has(id))) {
      return { array: undefined, error: rowsError }
    }
    try {
      if (source.kind === 'dataset') {
        const rows = rowsByDataset.get(source.datasetId) ?? []
        return { array: loopArrayAt(reshapeDatasetData(expressionDraft, rows), pathDraft), error: '' }
      }
      const agg = runAggregations(doc.aggregations, rowsByDataset)
      return { array: loopArrayAt(agg[source.aggName], pathDraft), error: '' }
    } catch (cause) {
      return { array: undefined, error: describeError(cause) }
    }
  }, [region?.source, neededDatasetIds, rowsByDataset, rowsError, expressionDraft, pathDraft, doc.aggregations])

  /** 循环条目的采样键（分组字段 chips 用；条目是对象才有的列） */
  const sampleKeys = useMemo(() => {
    const sample = loopPreview.array?.find((item) => item !== null && item !== undefined)
    return sample && typeof sample === 'object' && !Array.isArray(sample)
      ? Object.keys(sample as Record<string, unknown>).sort()
      : []
  }, [loopPreview])

  // ESC 关闭 + 打开时锁住底层滚动（与打印弹框同族行为）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (!region) return null

  /** 所有会抛错的改动都过这里：就地展示错误，不让异常冒到 React */
  const guard = (action: () => void): void => runGuarded(setError, action)

  const label = region.name?.trim() || `数据块 ${index + 1}`
  const sourceKind: 'dataset' | 'agg' = region.source?.kind ?? 'dataset'
  /** 当前聚合源（agg 档才有）；选了非数组型聚合（迁移可能留下）时下拉就地警示 */
  const aggSource = region.source?.kind === 'agg' ? region.source : undefined
  const selectedAggIsValue =
    aggSource !== undefined &&
    doc.aggregations.find((agg) => agg.name === aggSource.aggName)?.type === 'value'
  const groupingEnabled = region.expand === 'down'
  /** 分组说明里代入的字段名：第一个已选分组字段 → 最像「分类」的字段（客户/名称/类型…，
   * 避免拿金额、数量当分类举例）→ 条目第一个字段 → 通用「客户」 */
  const categoricalKey = sampleKeys.find(
    (key) => /(customer|client|name|type|categor|status|dept|_no)$/i.test(key) && !/(qty|amount|price|count)/i.test(key),
  )
  const exampleField = region.groupBy?.[0] ?? categoricalKey ?? sampleKeys[0] ?? '客户'

  /** 提交数据源；无内容则清空 source（数据块内绑定随之清除，doc 守卫） */
  const commitSource = (patch: {
    kind?: 'dataset' | 'agg'
    datasetId?: string
    aggName?: string
    expression?: string
    path?: string
  }): void => {
    const nextKind = patch.kind ?? sourceKind
    if (nextKind === 'dataset') {
      const nextDatasetId =
        patch.datasetId ??
        (region.source?.kind === 'dataset' ? region.source.datasetId : '')
      if (!nextDatasetId) {
        guard(() => doc.setRegionSource(index, undefined))
        return
      }
      const expression = (patch.expression ?? expressionDraft).trim()
      guard(() =>
        doc.setRegionSource(index, {
          kind: 'dataset',
          datasetId: nextDatasetId,
          expression: expression || undefined,
          path: patch.path ?? pathDraft,
        }),
      )
      return
    }
    const nextAggName = patch.aggName ?? (region.source?.kind === 'agg' ? region.source.aggName : '')
    if (!nextAggName) {
      guard(() => doc.setRegionSource(index, undefined))
      return
    }
    guard(() =>
      doc.setRegionSource(index, {
        kind: 'agg',
        aggName: nextAggName,
        path: patch.path ?? pathDraft,
      }),
    )
  }

  /** 切换来源类型：换成另一档的空态（路径草稿保留，两边语义一致） */
  const switchSourceKind = (kind: 'dataset' | 'agg'): void => {
    if (kind === sourceKind) return
    if (kind === 'dataset') {
      guard(() => doc.setRegionSource(index, undefined))
    } else {
      // 数据块数据源只认数组型聚合（非数组型返回单个值/对象，没有可循环的列表）
      const first = doc.aggregations.find((agg) => agg.type === 'array')
      if (!first) {
        setError('还没有数组型聚合：先去「聚合」tab 新建一个（数组型）')
        return
      }
      guard(() => doc.setRegionSource(index, { kind: 'agg', aggName: first.name, path: pathDraft }))
    }
  }

  /** 分组字段切换（chips 点选） */
  const toggleGroupBy = (path: string): void => {
    const current = region.groupBy ?? []
    const next = current.includes(path)
      ? current.filter((item) => item !== path)
      : [...current, path]
    guard(() => doc.setRegionGroupBy(index, next.length ? next : undefined))
  }

  const rangeText = `第 ${region.startRow + 1}-${region.endRow + 1} 行 · ${colIndexToName(region.startCol)}-${colIndexToName(region.endCol)} 列`

  return (
    <div className="region-dialog-overlay" onClick={onClose}>
      <div
        className="region-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${label} 设置`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="region-dialog-bar">
          <span
            className="region-dialog-dot"
            style={{ backgroundColor: REGION_EXPAND_COLORS[region.expand] }}
            aria-hidden="true"
          />
          <h2>{label}</h2>
          <span className="meta">{rangeText}</span>
          <button type="button" className="bar-close" onClick={onClose} title="关闭设置（Esc）">
            <IconClose />
            关闭
          </button>
        </div>

        <div className="region-dialog-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={item.value === tab}
              className={item.value === tab ? 'active' : ''}
              onClick={() => setTab(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="region-dialog-body">
          {error ? <p className="status error">{error}</p> : null}

          {tab === 'basic' ? (
            <section className="region-dialog-group">
              <label className="field-col">
                <span className="field-label">数据块名（留空显示「数据块 {index + 1}」；函数里用名字引用它）</span>
                <input
                  value={nameDraft}
                  placeholder={`数据块 ${index + 1}`}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={() => {
                    const next = nameDraft.trim()
                    if (next === (doc.regions[index]?.name ?? '')) return
                    guard(() => doc.renameRegion(index, next))
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
              </label>

              <div className="region-dialog-row">
                <span className="field-label">范围</span>
                <span className="region-rows">{rangeText}</span>
                <span className="hint">
                  调整范围：画布上拖数据块边缘/角，或框选后右键「把数据块调整为选区大小」。
                </span>
              </div>

              <label className="field-col">
                <span className="field-label">列表方式</span>
                <select
                  value={region.expand}
                  onChange={(event) =>
                    guard(() => doc.setRegionExpand(index, event.target.value as RegionExpand))
                  }
                >
                  {REGION_EXPAND_OPTIONS.map((option) => {
                    // down / right 各最多一个：已被别的数据块占用就禁用并说明
                    const takenBy = doc.regions.findIndex(
                      (item, i) => i !== index && item.expand === option.value,
                    )
                    const taken = option.value !== 'none' && takenBy >= 0
                    return (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={taken}
                        title={
                          taken ? `已被数据块 ${takenBy + 1} 占用：同一模板只能有一个` : option.hint
                        }
                      >
                        {option.label}
                        {taken ? `（数据块 ${takenBy + 1} 已用）` : ''}
                      </option>
                    )
                  })}
                </select>
              </label>
              <p className="region-hint">
                {REGION_EXPAND_OPTIONS.find((option) => option.value === region.expand)?.hint}
              </p>
              {region.expand !== 'none' && !region.source ? (
                <p className="region-note">尚未绑定数据源：暂按 1 份渲染，绑定后生效。</p>
              ) : null}
            </section>
          ) : null}

          {tab === 'source' ? (
            <section className="region-dialog-group">
              <p className="hint">
                绑了数据源才按数据复制。
                <InfoBubble label="数据源口径">
                  数据块只为绑数据集或数组型聚合（逐条打印/复制）而存在；固定文字直接写在
                  格子里，不需要数据块。绑了数据源才按数据复制（取到几条就复制几份），还没
                  绑时暂按 1 份渲染；非列表的数据块绑源后，块内字段取第 1 条数据。块内的
                  格子只写「条目内字段名」，不单独选数据集；块外格可直接引用非数组聚合或
                  用函数取数。
                </InfoBubble>
              </p>

              <div className="region-source-kind" role="tablist">
                <button
                  type="button"
                  className={sourceKind === 'dataset' ? 'active' : ''}
                  onClick={() => switchSourceKind('dataset')}
                >
                  数据集
                </button>
                <button
                  type="button"
                  className={sourceKind === 'agg' ? 'active' : ''}
                  onClick={() => switchSourceKind('agg')}
                  title="把模板「聚合」加工过的数组型结果当作数据源（替代重塑表达式的重活）"
                >
                  聚合
                </button>
              </div>

              {sourceKind === 'dataset' ? (
                <>
                  <label className="field-col">
                    <span className="field-label">数据集</span>
                    <select
                      value={region.source?.kind === 'dataset' ? region.source.datasetId : ''}
                      onChange={(event) => {
                        commitSource({ datasetId: event.target.value, kind: 'dataset' })
                      }}
                    >
                      <option value="">不设数据源</option>
                      {datasets?.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field-col">
                    <span className="field-label">重塑表达式（JS，入参 rows；留空 = 原始行数组）</span>
                    <textarea
                      rows={3}
                      className="mono"
                      value={expressionDraft}
                      placeholder={'如 rows.reduce(...)；复杂加工建议改用「聚合」'}
                      onChange={(event) => setExpressionDraft(event.target.value)}
                      onBlur={() => commitSource({})}
                    />
                  </label>
                </>
              ) : (
                <label className="field-col">
                  <span className="field-label">聚合（agg.变量名；只列数组型——非数组型返回单个值/对象，没有可循环的列表）</span>
                  <select
                    value={aggSource?.aggName ?? ''}
                    onChange={(event) => commitSource({ aggName: event.target.value, kind: 'agg' })}
                  >
                    <option value="">不设数据源</option>
                    {doc.aggregations
                      .filter((agg) => agg.type === 'array')
                      .map((agg) => (
                        <option key={agg.name} value={agg.name}>
                          agg.{agg.name}
                          {agg.params.length
                            ? `（${agg.params.map((p) => p.varName).join(', ')}）`
                            : ''}
                        </option>
                      ))}
                    {/* 迁移可能留下非数组型旧选中：保留在选项里可见可换，下方警示不抛死 */}
                    {aggSource && selectedAggIsValue ? (
                      <option value={aggSource.aggName}>agg.{aggSource.aggName}（非数组型）</option>
                    ) : null}
                  </select>
                  {aggSource && selectedAggIsValue ? (
                    <p className="status error">
                      agg.{aggSource.aggName} 是非数组型，不能作数据块数据源，请换一个或选「不设数据源」。
                    </p>
                  ) : null}
                </label>
              )}

              {(region.source?.kind === 'dataset' || region.source?.kind === 'agg') && (
                <label className="field-col">
                  <span className="field-label">列表路径</span>
                  <input
                    value={pathDraft}
                    placeholder="如 items / [0].items；留空 = 取数结果根就是数组"
                    onChange={(event) => setPathDraft(event.target.value)}
                    onBlur={() => commitSource({})}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                </label>
              )}

              <p className="region-dialog-preview">
                {rowsError ? (
                  <span className="error">{rowsError}</span>
                ) : loopPreview.error ? (
                  <span className="error">{loopPreview.error}</span>
                ) : loopPreview.array === undefined ? (
                  <span className="meta">
                    {region.source ? '取数中…' : '未设数据源：暂按 1 份渲染；数据块内要绑字段需先设数据源'}
                  </span>
                ) : (
                  <span className={loopPreview.array.length === 0 ? 'error' : undefined}>
                    取到 {loopPreview.array.length} 条
                    {loopPreview.array.length === 0 ? '（空数组，列表区会被塌缩）' : ''}
                  </span>
                )}
              </p>
            </section>
          ) : null}

          {tab === 'group' ? (
            <section className="region-dialog-group">
              {!groupingEnabled ? (
                <p className="region-note">
                  本页需要数据块「纵向列表」：先去「基本」页把列表方式改为纵向列表。
                  <InfoBubble label="分组是什么">
                    分组 = 把数据按某个字段的值归类打印（比如按客户归类：同一客户的明细行挨在一起，
                    每组末尾带小计，最后垫一行合计）。
                  </InfoBubble>
                </p>
              ) : (
                <>
                  <p className="hint">
                    分组 = 按字段值归类，每一类打印一小块。
                    <InfoBubble label="分组怎么打印">
                      比如按「{exampleField}」分组、数据里有 3 个值（A / B / C），就会打印
                      3 小块：每块先是组头（显示该值），中间是这一类的明细行，块尾是小计
                      （这一类的合计）；所有块结束后最后一行是合计（全部数据的总计）。
                    </InfoBubble>
                  </p>

                  <div className="field-col">
                    <span className="field-label">按哪个字段归类（点选，可多选）</span>
                    {sampleKeys.length > 0 ? (
                      <div className="field-chips">
                        {sampleKeys.map((key) => {
                          const active = region.groupBy?.includes(key)
                          return (
                            <button
                              key={key}
                              type="button"
                              className={active ? 'field-chip active' : 'field-chip'}
                              onClick={() => toggleGroupBy(key)}
                            >
                              <span className="field-chip-name">{key}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="hint">先在「数据源」页选好数据集与列表路径，这里会列出数据的字段。</p>
                    )}
                    <p className="hint">
                      上面的列表只列顶层字段；要按嵌套字段（如 customer.name）分组就在这里补写、回车加入：
                      <input
                        className="region-groupby-add"
                        placeholder="嵌套字段路径，如 customer.name"
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return
                          const value = event.currentTarget.value.trim()
                          if (!value || region.groupBy?.includes(value)) return
                          event.currentTarget.value = ''
                          guard(() => doc.setRegionGroupBy(index, [...(region.groupBy ?? []), value]))
                        }}
                      />
                    </p>
                  </div>

                  <div className="field-col">
                    <span className="field-label">
                      数据块里的每一行打印什么
                      <InfoBubble label="行角色怎么配">
                        画布行头右键也能设。选第一个分组字段时，下面会自动按典型布局配好
                        （第 1 行组头、最后一行合计），可随意改。小计/合计行的格子：在单元格
                        tab 选函数（如小计）后，点到画布上的明细数值格即可。
                      </InfoBubble>
                    </span>

                    {/* 迷你示意（教学用，不随数据块行数/角色变化）：一眼看懂「一小块长什么样」 */}
                    <div className="region-group-demo">
                      <p className="demo-caption">按「{exampleField}」分组时，打印出来大致长这样：</p>
                      <div className="demo-row demo-header">
                        <span className="demo-role">组头</span>
                        <span>A</span>
                      </div>
                      <div className="demo-row demo-detail">
                        <span className="demo-role">明细</span>
                        <span>A 的数据 · 第 1 条</span>
                      </div>
                      <div className="demo-row demo-detail">
                        <span className="demo-role">明细</span>
                        <span>A 的数据 · 第 2 条 …</span>
                      </div>
                      <div className="demo-row demo-footer">
                        <span className="demo-role">小计</span>
                        <span>A 的合计</span>
                      </div>
                      <p className="demo-ellipsis">B、C … 每个值再重复同样一块</p>
                      <div className="demo-row demo-summary">
                        <span className="demo-role">合计</span>
                        <span>全部数据的总计</span>
                      </div>
                    </div>

                    <div className="region-role-table">
                      {Array.from(
                        { length: region.endRow - region.startRow + 1 },
                        (_, offset) => region.startRow + offset,
                      ).map((row) => {
                        const role = regionRowRoleOf(region, row)
                        return (
                          <div key={row} className="region-role-row">
                            <span className="region-role-label">第 {row + 1} 行</span>
                            <div className="mode-buttons">
                              {REGION_ROW_ROLES.map((item) => {
                                const needsGroup =
                                  item.value === 'groupHeader' || item.value === 'groupFooter'
                                const disabled = needsGroup && !region.groupBy?.length
                                return (
                                  <button
                                    key={item.value}
                                    type="button"
                                    className="mode-button"
                                    aria-pressed={item.value === role}
                                    title={
                                      disabled
                                        ? '先在上方点选分组字段，才能设组头/小计'
                                        : `第 ${row + 1} 行 · ${item.label}：${item.hint}`
                                    }
                                    disabled={disabled}
                                    onClick={() =>
                                      guard(() =>
                                        doc.setRegionRowRole(index, row, item.value as RegionRowRole),
                                      )
                                    }
                                  >
                                    {item.label}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </section>
          ) : null}
        </div>

        <div className="region-dialog-foot">
          <button
            type="button"
            className="ghost danger"
            title="只移除数据块标记，画布内容保留（数据块内的字段绑定一并清除）"
            onClick={() => {
              guard(() => doc.removeRegion(index))
              onClose()
            }}
          >
            <IconTrash />
            删除数据块
          </button>
          <span className="meta">改动已即时保存，可随时撤销</span>
          <button type="button" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
