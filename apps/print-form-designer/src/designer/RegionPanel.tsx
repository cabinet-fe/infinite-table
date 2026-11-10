// 数据块列表（紧凑版）：色点 + 名称 + 范围 + 列表方式标签 + 设置… + 删除。
//
// 详细设置全部在 RegionDialog（弹框三 tab：基本/数据源/分组）。这里只留
// 「一眼看清有几个数据块、各自框在哪、怎么展开」，入口两个：点列表项选中画布矩形、
// 点设置打开弹框。**没有「添加数据块」按钮**——创建数据块的唯一入口是画布：
// 框选 → 右键「设置为数据块」（或点数据块右下角手柄跳到这里管理）。
import { useEffect, useRef, useState } from 'react'

import { colIndexToName } from '@infinitable/sheet'

import { InfoBubble } from './InfoBubble'
import type { FormDoc } from '../domain/form-doc'
import { REGION_EXPAND_COLORS, regionExpandLabel, regionRowRoleLabel } from './labels'
import { RegionDialog } from './RegionDialog'
import { regionRowRoleOf, type FormRegion } from '../shared/template-schema'
import { IconEdit, IconTrash } from '../ui/icons'
import { runGuarded } from '../errors'

interface Props {
  doc: FormDoc
  regions: FormRegion[]
  /** 当前选中数据块下标（选区首格落在该数据块内；undefined = 未选中任何数据块） */
  activeIndex: number | undefined
  /** 宿主要聚焦的数据块下标（画布手柄点击/创建后联动：滚动到该行并闪一下） */
  focusIndex: number | undefined
  /** 宿主要打开设置弹框的数据块下标（null = 关闭；受控） */
  openIndex: number | null
  onOpenIndexChange: (index: number | null) => void
  /** 点列表项时先通知宿主（宿主据此把 tab 钉在「数据块」，不被自动切走） */
  onSelectRegion?: (index: number) => void
}

export function RegionPanel({
  doc,
  regions,
  activeIndex,
  focusIndex,
  openIndex,
  onOpenIndexChange,
  onSelectRegion,
}: Props) {
  const [error, setError] = useState('')
  /** 聚焦行 DOM 引用：focusIndex 变化时滚动 + 闪烁 */
  const focusRef = useRef<HTMLLIElement>(null)
  const [flashIndex, setFlashIndex] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (focusIndex === undefined) return
    const el = focusRef.current
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
      setFlashIndex(focusIndex)
      const timer = window.setTimeout(() => setFlashIndex(undefined), 900)
      return () => window.clearTimeout(timer)
    }
  }, [focusIndex])

  /** 点列表项 → 选中该数据块矩形（侧栏与画布联动） */
  const selectRegion = (region: FormRegion, index: number): void => {
    onSelectRegion?.(index)
    doc.sheet.selectRange({
      start: { row: region.startRow, col: region.startCol },
      end: { row: region.endRow, col: region.endCol },
    })
  }

  /** 所有会抛错的改动都过这里：就地展示错误，不让异常冒到 React */
  const guard = (action: () => void): void => runGuarded(setError, action)

  return (
    <div className="card-block">
      <ul className="region-list">
        {regions.map((region, index) => {
          const expandLabel = regionExpandLabel(region.expand)
          const roles = Array.from(
            { length: region.endRow - region.startRow + 1 },
            (_, offset) => region.startRow + offset,
          )
            .map((row) => regionRowRoleLabel(regionRowRoleOf(region, row)))
            .filter(Boolean)
          return (
            <li
              key={index}
              ref={index === focusIndex ? focusRef : undefined}
              className={
                index === activeIndex
                  ? 'region-row active'
                  : index === flashIndex
                    ? 'region-row flash'
                    : 'region-row'
              }
              onClick={() => selectRegion(region, index)}
              title={`选中画布上第 ${region.startRow + 1}-${region.endRow + 1} 行 / ${colIndexToName(region.startCol)}-${colIndexToName(region.endCol)} 列`}
            >
              <span
                className="region-dot"
                style={{ backgroundColor: REGION_EXPAND_COLORS[region.expand] }}
                aria-hidden="true"
              />
              <span className="region-row-main">
                <span className="region-title">{region.name?.trim() || `数据块 ${index + 1}`}</span>
                <span className="region-range meta">
                  第{region.startRow + 1}-{region.endRow + 1}行 · {colIndexToName(region.startCol)}-
                  {colIndexToName(region.endCol)}列
                  {roles.length ? ` · ${roles.join(' / ')}` : ''}
                </span>
              </span>
              {expandLabel ? <span className="region-row-tag">{expandLabel}</span> : null}
              <span className="region-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="icon-button"
                  title="设置数据块（基本 / 数据源 / 分组）"
                  onClick={() => onOpenIndexChange(index)}
                >
                  <IconEdit />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="只移除数据块标记，画布内容保留"
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
        <p className="hint">还没有数据块。在画布上框选一块，右键「设置为数据块」。</p>
      ) : (
        <p className="hint">
          数据块的创建与调整都在画布上完成。
          <InfoBubble label="画布操作">
            框选后右键可设数据块/合并单元格；拖数据块边缘可调范围；点数据块右下角方块跳到这里管理。
          </InfoBubble>
        </p>
      )}

      {error ? <p className="status error">{error}</p> : null}

      {openIndex !== null && regions[openIndex] ? (
        <RegionDialog doc={doc} index={openIndex} onClose={() => onOpenIndexChange(null)} />
      ) : null}
    </div>
  )
}
