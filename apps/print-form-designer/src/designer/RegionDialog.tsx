// 区域设置弹框：区域名 / 起止行列 / 行数 ± / 展开方式 / 数据源 / 每页重复。
//
// 为什么独立成弹框：区域细节一多，侧栏列表就被表单撑成流水账，扫一眼看不到「有几个区域」。
// 侧栏只留紧凑列表，详细设置进这里；所有改动仍然即时写 doc（天然可撤销），
// 弹框只承载表单——没有「确定/应用」按钮，关掉就等于回到列表。
import { useEffect, useMemo, useRef, useState } from 'react'

import { api, toSourceRows, type DatasetRow } from '../data/api'
import type { SourceRow } from '../transform/reshape'
import { loopArrayAt, reshapeDatasetData } from './binding'
import { REGION_EXPAND_COLORS } from './canvas-overlay'
import type { FormDoc } from './form-doc'
import { REGION_EXPAND_OPTIONS, type FormRegion, type RegionExpand } from './template'
import { DraftNumberInput } from '../ui/DraftNumberInput'
import { IconClose, IconPlus, IconTrash } from '../ui/icons'
import { describeError, runGuarded } from '../errors'

interface RegionDialogProps {
  doc: FormDoc
  /** 目标区域下标 */
  index: number
  onClose: () => void
}

/** 前导区域：从第 0 行起、连续、且都不展开——只有它们能计入「每页重复表头」 */
function isLeadingRegion(regions: readonly FormRegion[], index: number): boolean {
  let expect = 0
  for (let i = 0; i < index; i++) {
    const region = regions[i]!
    if (region.expand !== 'none' || region.startRow !== expect) return false
    expect = region.endRow + 1
  }
  const target = regions[index]!
  return target.expand === 'none' && target.startRow === expect
}

export function RegionDialog({ doc, index, onClose }: RegionDialogProps) {
  // 区域从 doc 现读：改动即时落库，弹框只做展示与输入
  const region = doc.regions[index]
  const [error, setError] = useState('')
  const [datasets, setDatasets] = useState<DatasetRow[] | null>(null)
  /** 数据集原始行（数据源预览用；未选数据集时为 null） */
  const [rows, setRows] = useState<SourceRow[] | null>(null)
  const [rowsError, setRowsError] = useState('')

  // 名称 / 表达式 / 列表路径是文本输入：草稿态 + 失焦提交，避免每敲一个字进一次撤销链
  const [nameDraft, setNameDraft] = useState(region?.name ?? '')
  const [expressionDraft, setExpressionDraft] = useState(region?.source?.expression ?? '')
  const [pathDraft, setPathDraft] = useState(region?.source?.path ?? '')
  /**
   * 草稿同步键：区域下标 + doc 里那三项的值。
   * doc 只在失焦提交时变（等于刚输入的草稿），所以这里回填不会打断打字；
   * 换区域、撤销、换模板则能立刻把草稿拉回模型值。
   */
  const syncKey = [
    index,
    region?.name ?? '',
    region?.source?.expression ?? '',
    region?.source?.path ?? '',
  ].join('\u0000')
  const syncedRef = useRef('')
  useEffect(() => {
    if (syncedRef.current === syncKey) return
    syncedRef.current = syncKey
    setNameDraft(doc.regions[index]?.name ?? '')
    setExpressionDraft(doc.regions[index]?.source?.expression ?? '')
    setPathDraft(doc.regions[index]?.source?.path ?? '')
  }, [doc, index, syncKey])

  useEffect(() => {
    api
      .listDatasets()
      .then((list) => setDatasets(list))
      .catch((cause: unknown) => setError(describeError(cause)))
  }, [])

  // 区域换数据源时取一次原始行（预览计数用同一份重塑管线）
  const datasetId = region?.source?.datasetId ?? ''
  useEffect(() => {
    if (!datasetId) {
      setRows(null)
      setRowsError('')
      return
    }
    let cancelled = false
    api
      .executeDataset(datasetId)
      .then((result) => {
        if (cancelled) return
        setRows(toSourceRows(result))
        setRowsError('')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setRows(null)
        setRowsError(describeError(cause))
      })
    return () => {
      cancelled = true
    }
  }, [datasetId])

  // 实时预览：重塑形态 → 列表路径 → 条数（与打印同一条 reshape/loopArrayAt 管线）
  const preview = useMemo<{ count: number | undefined; error: string }>(() => {
    if (!datasetId) return { count: undefined, error: '' }
    if (!rows) return { count: undefined, error: '' }
    try {
      const array = loopArrayAt(reshapeDatasetData(expressionDraft, rows), pathDraft)
      if (!array) {
        return {
          count: undefined,
          error: `列表路径「${pathDraft.trim() || '（空 = 根即数组）'}」取不到数组`,
        }
      }
      return { count: array.length, error: '' }
    } catch (cause) {
      return { count: undefined, error: describeError(cause) }
    }
  }, [datasetId, rows, expressionDraft, pathDraft])

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

  const rowCount = region.endRow - region.startRow + 1
  const leading = isLeadingRegion(doc.regions, index)
  const label = region.name?.trim() || `区域 ${index + 1}`

  /** 提交数据源（保持已选字段，只改被编辑的那一项）；无数据集则清空 source */
  const commitSource = (patch: {
    datasetId?: string
    expression?: string
    path?: string
  }): void => {
    const nextDatasetId = patch.datasetId ?? datasetId
    if (!nextDatasetId) {
      guard(() => doc.setRegionSource(index, undefined))
      return
    }
    const expression = (patch.expression ?? expressionDraft).trim()
    guard(() =>
      doc.setRegionSource(index, {
        datasetId: nextDatasetId,
        expression: expression || undefined,
        path: patch.path ?? pathDraft,
      }),
    )
  }

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
          <span className="meta">设置只改区域，不动画布内容</span>
          <button type="button" className="bar-close" onClick={onClose} title="关闭设置（Esc）">
            <IconClose />
            关闭
          </button>
        </div>

        <div className="region-dialog-body">
          {error ? <p className="status error">{error}</p> : null}

          <section className="region-dialog-group">
            <h3>基本</h3>
            <label className="field-col">
              <span className="field-label">区域名（留空显示「区域 {index + 1}」）</span>
              <input
                value={nameDraft}
                placeholder={`区域 ${index + 1}`}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => {
                  const next = nameDraft.trim()
                  if (next === (doc.regions[index]?.name ?? '')) return
                  // 空串 = 清除自定义名，列表回落到「区域 N」
                  guard(() => doc.renameRegion(index, next))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>

            <div className="region-dialog-row">
              <span className="field-label">行数</span>
              <div className="region-step">
                <button
                  type="button"
                  className="icon-button"
                  disabled={rowCount <= 1}
                  title="减少一行（从区域底部删除空行，可撤销）"
                  onClick={() => guard(() => doc.resizeRegionRows(index, rowCount - 1))}
                >
                  −
                </button>
                <span className="region-rows">{rowCount} 行</span>
                <button
                  type="button"
                  className="icon-button"
                  title="增加一行（在区域底部插入空行，可撤销）"
                  onClick={() => guard(() => doc.resizeRegionRows(index, rowCount + 1))}
                >
                  <IconPlus />
                </button>
              </div>
            </div>

            {/* 输入用 1 基（面向用户），内部转 0 基 */}
            <div className="region-grid">
              <label className="field-col">
                <span className="field-label">起始行</span>
                <DraftNumberInput
                  value={region.startRow + 1}
                  min={1}
                  max={999}
                  onCommit={(next) =>
                    guard(() => doc.setRegionFields(index, { startRow: next - 1 }))
                  }
                />
              </label>
              <label className="field-col">
                <span className="field-label">结束行</span>
                <DraftNumberInput
                  value={region.endRow + 1}
                  min={1}
                  max={999}
                  onCommit={(next) => guard(() => doc.setRegionFields(index, { endRow: next - 1 }))}
                />
              </label>
              <label className="field-col">
                <span className="field-label">起始列</span>
                <DraftNumberInput
                  value={region.startCol + 1}
                  min={1}
                  max={99}
                  onCommit={(next) =>
                    guard(() => doc.setRegionFields(index, { startCol: next - 1 }))
                  }
                />
              </label>
              <label className="field-col">
                <span className="field-label">结束列</span>
                <DraftNumberInput
                  value={region.endCol + 1}
                  min={1}
                  max={99}
                  onCommit={(next) => guard(() => doc.setRegionFields(index, { endCol: next - 1 }))}
                />
              </label>
            </div>
            <p className="hint">改范围只是重新框选，不会移动画布内容。</p>
          </section>

          <section className="region-dialog-group">
            <h3>展开</h3>
            <label className="field-col">
              <span className="field-label">展开方式</span>
              <select
                value={region.expand}
                // 还没设数据源时展开区无据可依：先让用户在下方选数据集，避免这里直接报错
                disabled={region.expand === 'none' && !region.source}
                title={
                  region.expand === 'none' && !region.source
                    ? '先在下方「数据源」里选数据集，再设展开方式'
                    : undefined
                }
                onChange={(event) =>
                  guard(() => doc.setRegionExpand(index, event.target.value as RegionExpand))
                }
              >
                {REGION_EXPAND_OPTIONS.map((option) => {
                  // down / right 各最多一个：已被别的区域占用就禁用并说明
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
                        taken ? `已被区域 ${takenBy + 1} 占用：同一模板只能有一个` : option.hint
                      }
                    >
                      {option.label}
                      {taken ? `（区域 ${takenBy + 1} 已用）` : ''}
                    </option>
                  )
                })}
              </select>
            </label>
            <p className="region-hint">
              {REGION_EXPAND_OPTIONS.find((option) => option.value === region.expand)?.hint}
            </p>
            {region.expand === 'none' && !region.source ? (
              <p className="region-note">
                展开区要先有数据源（在下方「数据源」里选数据集）：份数就是列表路径取到的条数。
              </p>
            ) : null}

            {region.expand === 'none' && leading ? (
              <label className="switch region-repeat" title="打印时每页重复这块（含列头）">
                <input
                  type="checkbox"
                  checked={region.repeat === true}
                  onChange={(event) =>
                    guard(() => doc.setRegionFields(index, { repeat: event.target.checked }))
                  }
                />
                <span className="switch-track" />
                每页重复
              </label>
            ) : (
              <p className="region-note">
                {region.expand !== 'none'
                  ? '展开区会按数据份数复制，不能设置每页重复'
                  : '只有从第 1 行起连续、且不展开的区域才能每页重复'}
              </p>
            )}
          </section>

          <section className="region-dialog-group">
            <h3>数据源</h3>
            <p className="hint">
              区域的展开份数由这里决定：数据集 →（可选）重塑表达式 → 列表路径取到几条就复制几份。
              区域里的格子只写「条目内字段名」，不单独选数据集。
            </p>
            <label className="field-col">
              <span className="field-label">数据集</span>
              <select
                value={datasetId}
                onChange={(event) => {
                  setRows(null)
                  commitSource({ datasetId: event.target.value })
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
                value={expressionDraft}
                placeholder={'如 rows.reduce(...)；留空 = 原始行数组直接作形态'}
                onChange={(event) => setExpressionDraft(event.target.value)}
                onBlur={() => commitSource({})}
              />
            </label>

            <label className="field-col">
              <span className="field-label">列表路径</span>
              <input
                value={pathDraft}
                placeholder="如 items / [0].items；留空 = 重塑结果根即数组"
                onChange={(event) => setPathDraft(event.target.value)}
                onBlur={() => commitSource({})}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>

            <p className="region-dialog-preview">
              {rowsError ? (
                <span className="error">{rowsError}</span>
              ) : preview.error ? (
                <span className="error">{preview.error}</span>
              ) : preview.count === undefined ? (
                <span className="meta">{datasetId ? '取数中…' : '未设数据源'}</span>
              ) : (
                <span className={preview.count === 0 ? 'error' : undefined}>
                  取到 {preview.count} 条{preview.count === 0 ? '（空数组，区域会被塌缩）' : ''}
                </span>
              )}
            </p>
          </section>
        </div>

        <div className="region-dialog-foot">
          <button
            type="button"
            className="ghost danger"
            title="只移除区域标记，画布内容保留"
            onClick={() => {
              guard(() => doc.removeRegion(index))
              onClose()
            }}
          >
            <IconTrash />
            删除区域
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
