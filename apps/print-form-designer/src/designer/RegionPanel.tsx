// 区域列表（紧凑版）：色点 + 名称 + 范围 + 展开标签 + 设置… + 删除。
//
// 详细设置全部搬到 RegionDialog（区域细节一多，侧栏就被表单撑成流水账，扫一眼看不到有几个区域）。
// 这里只留「一眼看清有几个区域、各自框在哪、怎么展开」，以及两个入口：
// 点列表项选中画布矩形、点设置打开弹框。
import { useState } from 'react'

import { colIndexToName } from '@infinitable/sheet'

import { REGION_EXPAND_COLORS } from './canvas-overlay'
import type { FormDoc } from './form-doc'
import { RegionDialog } from './RegionDialog'
import { regionExpandLabel, type FormRegion } from './template'
import { IconEdit, IconPlus, IconTrash } from '../ui/icons'
import { runGuarded } from '../errors'

interface Props {
  doc: FormDoc
  regions: FormRegion[]
  /** 当前选中区域下标（选区首格落在该区域内；undefined = 未选中任何区域） */
  activeIndex: number | undefined
  /** 点列表项时先通知宿主（宿主据此把 tab 钉在「区域」，不被自动切走） */
  onSelectRegion?: (index: number) => void
}

export function RegionPanel({ doc, regions, activeIndex, onSelectRegion }: Props) {
  const [error, setError] = useState('')
  /** 正在设置的区域下标（null = 弹框关闭；仅 UI 态，不落 doc） */
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  /** 点列表项 → 选中该区域矩形（侧栏与画布联动） */
  const selectRegion = (region: FormRegion, index: number): void => {
    onSelectRegion?.(index)
    doc.sheet.selectRange({
      start: { row: region.startRow, col: region.startCol },
      end: { row: region.endRow, col: region.endCol },
    })
  }

  /** 所有会抛错的改动都过这里：就地展示错误，不让异常冒到 React */
  const guard = (action: () => void): void => runGuarded(setError, action)

  /** 当前选区（首个 range）设为区域：与既有区域重叠时 doc 侧抛错，这里就地显示 */
  const createFromSelection = (): void => {
    const range = doc.sheet.getSelection().ranges[0]
    if (!range) {
      setError('先在画布上框选一块区域')
      return
    }
    guard(() => doc.createRegionFromRange(range, {}))
  }

  return (
    <div className="card-block">
      <ul className="region-list">
        {regions.map((region, index) => {
          const expandLabel = regionExpandLabel(region.expand)
          return (
            <li
              key={index}
              className={index === activeIndex ? 'region-row active' : 'region-row'}
              onClick={() => selectRegion(region, index)}
              title={`选中画布上第 ${region.startRow + 1}-${region.endRow + 1} 行 / ${colIndexToName(region.startCol)}-${colIndexToName(region.endCol)} 列`}
            >
              <span
                className="region-dot"
                style={{ backgroundColor: REGION_EXPAND_COLORS[region.expand] }}
                aria-hidden="true"
              />
              <span className="region-row-main">
                <span className="region-title">{region.name?.trim() || `区域 ${index + 1}`}</span>
                <span className="region-range meta">
                  第{region.startRow + 1}-{region.endRow + 1}行 · {colIndexToName(region.startCol)}-
                  {colIndexToName(region.endCol)}列
                </span>
              </span>
              {expandLabel ? <span className="region-row-tag">{expandLabel}</span> : null}
              <span className="region-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="icon-button"
                  title="设置区域（名称 / 范围 / 展开 / 数据源）"
                  onClick={() => setOpenIndex(index)}
                >
                  <IconEdit />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="只移除区域标记，画布内容保留"
                  onClick={() => guard(() => doc.removeRegion(index))}
                >
                  <IconTrash />
                </button>
              </span>
            </li>
          )
        })}
      </ul>

      {regions.length === 0 ? (
        <p className="hint">还没有区域。框选画布后点「由选区设为区域」，或用下方的「添加区域」。</p>
      ) : null}

      {error ? <p className="status error">{error}</p> : null}

      <div className="region-add">
        <button
          type="button"
          className="accent-outline"
          title="把当前选区框成区域（选区含已有区域的单元格时会报错）"
          onClick={createFromSelection}
        >
          由选区设为区域
        </button>
        <button
          type="button"
          title="在现有区域最下方添加一个全宽 3 行的区域"
          onClick={() => guard(() => doc.addRegion(3))}
        >
          <IconPlus />
          添加区域
        </button>
      </div>

      <p className="hint">
        区域是画布上圈出来的一块 + 怎么随数据复制：展开区按数据条数摞/并排，其余照原样打印。
        画布可以无限往下长，没被圈到的行列就是普通静态内容。
      </p>

      {openIndex !== null && regions[openIndex] ? (
        <RegionDialog doc={doc} index={openIndex} onClose={() => setOpenIndex(null)} />
      ) : null}
    </div>
  )
}
