// 显示能力演示：10 万行虚拟滚动、行列头、冻结、合并、逐边边框、自定义渲染、
// text/checkbox 单元格类型、主题 extends。
// 带像素锚点的演示取值（冒烟断言依赖的坐标/颜色）集中在文件顶部常量，便于核对。

import type { CellRenderer } from '@infinite-table/core'

import { createSection, mountTable, type DemoMount } from '../mount'

/** 列宽：id 80 / name 140 / qty 80 / price 100 / rating 120 / done 80 / note 160（冻结第 0 列） */
export const DISPLAY_COL_WIDTHS = [80, 140, 80, 100, 120, 80, 160] as const

export const DISPLAY_ROW_COUNT = 100_000

/** 合并区：(2,2)~(3,3)，主格底色 #fde68a */
export const MERGED_BACKGROUND = '#fde68a'
/** 逐边边框演示格 (2,4)：左边 3px 红 / 右边 2px 蓝 */
export const BORDER_LEFT_COLOR = '#dc2626'
export const BORDER_RIGHT_COLOR = '#2563eb'
/** 自定义渲染演示列 rating（第 4 列）：紫色条形 */
export const RATING_BAR_COLOR = '#7c3aed'
/** 主题 extends 演示：列头底色覆盖 */
export const HEADER_BACKGROUND = '#dbeafe'
/** 冻结列（第 0 列）底色，滚动中保持不变可观测 */
export const FROZEN_COL_BACKGROUND = '#f5f3ff'

interface DisplayRecord {
  [key: string]: unknown
  id: string
  name: string
  qty: number
  price: number
  rating: number
  done: boolean
  note: string
}

const ratingRenderer: CellRenderer = ({ ctx, width, height, value }) => {
  const ratio = typeof value === 'number' ? value : 0
  const barWidth = Math.round((width - 16) * ratio)
  if (barWidth <= 0) {
    return
  }
  ctx.fillStyle = RATING_BAR_COLOR
  ctx.fillRect(8, (height - 10) / 2, barWidth, 10)
}

export interface DisplayDemo {
  mount: DemoMount
  records: readonly DisplayRecord[]
}

export function mountDisplay(root: HTMLElement): DisplayDemo {
  const section = createSection(
    root,
    '显示能力（10 万行）',
    '虚拟滚动窗口 + 行列头（含行号列）+ 冻结首列首行 + 合并 (2,2)~(3,3) + 逐边边框 (2,4) + ' +
      'rating 列自定义渲染 + done 列 checkbox + 主题 extends（列头底色）。滚轮/触控滚动，拖行列头边缘 resize。',
  )

  const records: DisplayRecord[] = Array.from({ length: DISPLAY_ROW_COUNT }, (_, row) => ({
    id: `ID-${row}`,
    name: `商品-${row}`,
    qty: row % 97,
    price: ((row * 13) % 500) + 1,
    rating: ((row * 7) % 10) / 10,
    done: row % 2 === 0,
    note: `备注-${row}`,
  }))

  const mount: DemoMount = mountTable(section, {
    width: 760,
    height: 420,
    columns: [
      { field: 'id', title: 'ID', width: DISPLAY_COL_WIDTHS[0] },
      { field: 'name', title: '名称', width: DISPLAY_COL_WIDTHS[1] },
      { field: 'qty', title: '数量', width: DISPLAY_COL_WIDTHS[2] },
      { field: 'price', title: '单价', width: DISPLAY_COL_WIDTHS[3] },
      { field: 'rating', title: '评分', width: DISPLAY_COL_WIDTHS[4] },
      { field: 'done', title: '完成', width: DISPLAY_COL_WIDTHS[5], cellType: 'checkbox' },
      { field: 'note', title: '备注', width: DISPLAY_COL_WIDTHS[6] },
    ],
    records,
    frozenColCount: 1,
    frozenRowCount: 1,
    mergeCells: [{ startCol: 2, startRow: 2, endCol: 3, endRow: 3 }],
    theme: { header: { background: HEADER_BACKGROUND } },
    resolveCellStyle: (col, row) => {
      if (col === 0) {
        return { background: FROZEN_COL_BACKGROUND }
      }
      if (col === 2 && row === 4) {
        return {
          border: {
            left: { width: 3, color: BORDER_LEFT_COLOR },
            right: { width: 2, color: BORDER_RIGHT_COLOR },
          },
        }
      }
      if (col === 2 && row === 2) {
        return { background: MERGED_BACKGROUND }
      }
      if (row % 2 === 1) {
        return { background: '#f8fafc' }
      }
      return null
    },
    resolveCellRenderer: (col) => (col === 4 ? ratingRenderer : null),
  })

  return { mount, records }
}
