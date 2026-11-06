// 区域面板：每个区域一张小卡（范围 / 展开方式 / 每页重复），全部改动即时生效并可撤销。
//
// 模型侧「区域」只是一个矩形 + 展开属性，没有任何类型分类——用户的原话是
// 「除了展开区之外其它的都没卵用」。所以这里只暴露三件事：这块在哪、怎么展开、是否每页重复。
import { useState } from 'react'

import { colIndexToName } from '@infinitable/sheet'

import { REGION_EXPAND_COLORS } from './canvas-overlay'
import type { FormDoc } from './form-doc'
import { REGION_EXPAND_OPTIONS, type FormRegion, type RegionExpand } from './template'
import { DraftNumberInput } from '../ui/DraftNumberInput'
import { IconPlus, IconTrash } from '../ui/icons'

interface Props {
  doc: FormDoc
  regions: FormRegion[]
  /** 当前选中区域下标（选区首格落在该区域内；undefined = 未选中任何区域） */
  activeIndex: number | undefined
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

export function RegionPanel({ doc, regions, activeIndex }: Props) {
  const [error, setError] = useState('')

  /** 点卡片 → 选中该区域矩形（侧栏与画布联动） */
  const selectRegion = (region: FormRegion): void => {
    doc.sheet.selectRange({
      start: { row: region.startRow, col: region.startCol },
      end: { row: region.endRow, col: region.endCol },
    })
  }

  /** 所有会抛错的改动都过这里：就地展示错误，不让异常冒到 React */
  const guard = (action: () => void): void => {
    try {
      action()
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const setFields = (index: number, patch: Partial<Omit<FormRegion, 'expand'>>): void =>
    guard(() => doc.setRegionFields(index, patch))

  return (
    <div className="card-block">
      <ul className="region-list">
        {regions.map((region, index) => {
          const rowCount = region.endRow - region.startRow + 1
          const leading = isLeadingRegion(regions, index)
          return (
            <li
              key={index}
              className={index === activeIndex ? 'region-item active' : 'region-item'}
              onClick={() => selectRegion(region)}
              title={`选中画布上第 ${region.startRow + 1}-${region.endRow + 1} 行 / ${colIndexToName(region.startCol)}-${colIndexToName(region.endCol)} 列`}
            >
              <div className="region-line">
                <span
                  className="region-dot"
                  style={{ backgroundColor: REGION_EXPAND_COLORS[region.expand] }}
                  aria-hidden="true"
                />
                <span className="region-title">区域 {index + 1}</span>
                <span className="region-range meta">
                  第{region.startRow + 1}-{region.endRow + 1}行 · {colIndexToName(region.startCol)}-
                  {colIndexToName(region.endCol)}列
                </span>
                <span className="region-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="icon-button"
                    title="只移除区域标记，画布内容保留"
                    onClick={() => guard(() => doc.removeRegion(index))}
                  >
                    <IconTrash />
                  </button>
                </span>
              </div>

              <div className="region-body" onClick={(event) => event.stopPropagation()}>
                <select
                  className="region-expand"
                  value={region.expand}
                  aria-label={`区域 ${index + 1} 展开方式`}
                  onChange={(event) =>
                    guard(() => doc.setRegionExpand(index, event.target.value as RegionExpand))
                  }
                >
                  {REGION_EXPAND_OPTIONS.map((option) => {
                    // down / right 各最多一个：已被别的区域占用就禁用并说明
                    const takenBy = regions.findIndex(
                      (r, i) => i !== index && r.expand === option.value,
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
                <p className="region-hint">
                  {REGION_EXPAND_OPTIONS.find((o) => o.value === region.expand)?.hint}
                </p>

                {region.expand === 'none' && leading ? (
                  <label className="switch region-repeat" title="打印时每页重复这块（含列头）">
                    <input
                      type="checkbox"
                      checked={region.repeat === true}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setFields(index, { repeat: event.target.checked })}
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

                <details className="region-fields">
                  <summary>
                    范围与行数
                    <span className="chevron">›</span>
                  </summary>
                  <div className="region-fields-body">
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
                    {/* 输入用 1 基（面向用户），内部转 0 基 */}
                    <div className="region-grid">
                      <label className="field-col">
                        <span className="field-label">起始行</span>
                        <DraftNumberInput
                          value={region.startRow + 1}
                          min={1}
                          max={999}
                          onCommit={(next) => setFields(index, { startRow: next - 1 })}
                        />
                      </label>
                      <label className="field-col">
                        <span className="field-label">结束行</span>
                        <DraftNumberInput
                          value={region.endRow + 1}
                          min={1}
                          max={999}
                          onCommit={(next) => setFields(index, { endRow: next - 1 })}
                        />
                      </label>
                      <label className="field-col">
                        <span className="field-label">起始列</span>
                        <DraftNumberInput
                          value={region.startCol + 1}
                          min={1}
                          max={99}
                          onCommit={(next) => setFields(index, { startCol: next - 1 })}
                        />
                      </label>
                      <label className="field-col">
                        <span className="field-label">结束列</span>
                        <DraftNumberInput
                          value={region.endCol + 1}
                          min={1}
                          max={99}
                          onCommit={(next) => setFields(index, { endCol: next - 1 })}
                        />
                      </label>
                    </div>
                    <p className="hint">改范围不会移动画布内容，只是重新框选。</p>
                  </div>
                </details>
              </div>
            </li>
          )
        })}
      </ul>

      {error ? <p className="status error">{error}</p> : null}

      <div className="region-add">
        <button
          type="button"
          className="accent-outline"
          title="在现有区域最下方添加一个全宽 3 行的区域"
          onClick={() => guard(() => doc.addRegion())}
        >
          <IconPlus />
          添加区域
        </button>
        <span className="meta">新区域默认全宽 3 行</span>
      </div>

      <p className="hint">
        区域只是画布上圈出来的一块 + 是否随数据复制：向下展开按条数摞、向右展开按条数并排。
        没被圈到的行列就是普通静态内容，照原样打印。
      </p>
    </div>
  )
}
