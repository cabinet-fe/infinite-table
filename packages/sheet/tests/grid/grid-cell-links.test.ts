// @vitest-environment happy-dom
// 单元格超链接接线（P10）：Sheet 模型 cell-link 载荷自动接到引擎链接渲染/事件通道
// （宿主不传任何 hook）：默认蓝字下划线（resolveCellStyle 覆盖值优先）、悬停 pointer
// 光标与 hover/leave 事件载荷、单击链接点击事件；clear / undo 后外观与事件消失；
// 框选与键盘方向键选中零派发；与嵌入图桥（GridCellImages）同格共存不互斥。

import './setup'

import { describe, expect, it, vi } from 'vitest'

import { Sheet } from '../../src/core/sheet'
import { cellX, cellY, createGrid, fire } from './grid-test-utils'

/** 链接格 (1,2)：URL + 可选显示文本 */
const LINK_CELL = { col: 1, row: 2 }
const LINK = { url: 'https://example.com', text: '示例链接' }

/** 主题口径：SHEET_GRID_THEME 未覆盖 linkColor（core 默认蓝）；body 文本色为黑 */
const THEME_LINK_COLOR = '#0563c1'
const THEME_BODY_COLOR = '#000000'

/** 悬停到数据格 (col, row) 中心偏左上（grid-test-utils 几何：列宽 80、行高 28） */
const hoverCell = (container: HTMLElement, col: number, row: number): void => {
  fire(container, 'pointermove', { clientX: cellX(col), clientY: cellY(row) })
}

/** 主键指针单击（down + up 同点） */
const clickCell = (container: HTMLElement, col: number, row: number): void => {
  fire(container, 'pointerdown', { clientX: cellX(col), clientY: cellY(row) })
  fire(container, 'pointerup', { clientX: cellX(col), clientY: cellY(row) })
}

describe('单元格超链接：SheetGrid 自动接线（宿主不传 hook）', () => {
  it('setCellLink 后该格命中默认蓝字下划线；clear 后回落普通样式', () => {
    const { grid, table } = createGrid()
    try {
      grid.setCellLink({ row: LINK_CELL.row, col: LINK_CELL.col }, LINK)
      const linked = table.resolveStyle(LINK_CELL.col, LINK_CELL.row)
      expect(linked.color).toBe(THEME_LINK_COLOR)
      expect(linked.underline).toBe(true)
      // 非链接格不受影响（SHEET_GRID_THEME body 文本色）
      const plain = table.resolveStyle(0, 0)
      expect(plain.color).toBe(THEME_BODY_COLOR)
      expect(plain.underline).toBeUndefined()

      grid.clearCellLink({ row: LINK_CELL.row, col: LINK_CELL.col })
      const cleared = table.resolveStyle(LINK_CELL.col, LINK_CELL.row)
      expect(cleared.color).toBe(THEME_BODY_COLOR)
      expect(cleared.underline).toBeUndefined()
    } finally {
      grid.release()
    }
  })

  it('resolveCellStyle 覆盖值优先：显式颜色覆盖链接蓝，未给字段保留链接下划线', () => {
    const { grid, table } = createGrid({
      resolveCellStyle: (addr) =>
        addr.row === LINK_CELL.row && addr.col === LINK_CELL.col
          ? { font: { color: 'red' } }
          : undefined,
    })
    try {
      grid.setCellLink({ row: LINK_CELL.row, col: LINK_CELL.col }, LINK)
      const style = table.resolveStyle(LINK_CELL.col, LINK_CELL.row)
      expect(style.color).toBe('red')
      expect(style.underline).toBe(true)
    } finally {
      grid.release()
    }
  })

  it('构造期模型已有链接的格首帧即命中（桥先于引擎构造就绪）', () => {
    const sheet = new Sheet()
    sheet.setCellLink({ row: 1, col: 3 }, { url: 'https://example.com/init' })
    const { grid, table } = createGrid({ sheet })
    try {
      const style = table.resolveStyle(3, 1)
      expect(style.color).toBe(THEME_LINK_COLOR)
      expect(style.underline).toBe(true)
    } finally {
      grid.release()
    }
  })

  it('悬停命中：pointer 光标 + hover 事件载荷；移出派发 leave、光标恢复', () => {
    const { grid, table, container } = createGrid()
    try {
      grid.setCellLink({ row: LINK_CELL.row, col: LINK_CELL.col }, LINK)
      const hovers: unknown[] = []
      const leaves: unknown[] = []
      table.onCellLinkHover((event) => hovers.push(event))
      table.onCellLinkLeave((event) => leaves.push(event))

      hoverCell(container, LINK_CELL.col, LINK_CELL.row)
      expect(container.style.cursor).toBe('pointer')
      expect(hovers).toHaveLength(1)
      expect(hovers[0]).toMatchObject({
        col: LINK_CELL.col,
        row: LINK_CELL.row,
        url: LINK.url,
        text: LINK.text,
      })

      hoverCell(container, 0, 0)
      expect(container.style.cursor).toBe('auto')
      expect(leaves).toEqual([{ col: LINK_CELL.col, row: LINK_CELL.row }])
    } finally {
      grid.release()
    }
  })

  it('单击命中：click 事件载荷（URL 与格坐标）；openCellLinkOnClick 透传可配', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      // 门面不传：缺省开 → 引擎默认打开（window.open 新标签 + noopener）
      const defaults = createGrid()
      try {
        defaults.grid.setCellLink({ row: LINK_CELL.row, col: LINK_CELL.col }, LINK)
        const defaultClicks: unknown[] = []
        defaults.table.onCellLinkClick((event) => defaultClicks.push(event))
        clickCell(defaults.container, LINK_CELL.col, LINK_CELL.row)
        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith(LINK.url, '_blank', 'noopener')
        expect(defaultClicks).toHaveLength(1)
        expect(defaultClicks[0]).toMatchObject({
          col: LINK_CELL.col,
          row: LINK_CELL.row,
          url: LINK.url,
        })
      } finally {
        defaults.grid.release()
      }

      open.mockClear()
      // 门面显式关闭：事件仍派发，打开行为由宿主接管
      const disabled = createGrid({ openCellLinkOnClick: false })
      try {
        disabled.grid.setCellLink({ row: LINK_CELL.row, col: LINK_CELL.col }, LINK)
        const clicks: unknown[] = []
        disabled.table.onCellLinkClick((event) => clicks.push(event))
        clickCell(disabled.container, LINK_CELL.col, LINK_CELL.row)
        expect(open).not.toHaveBeenCalled()
        expect(clicks).toHaveLength(1)
        expect(clicks[0]).toMatchObject({
          col: LINK_CELL.col,
          row: LINK_CELL.row,
          url: LINK.url,
          text: LINK.text,
        })
      } finally {
        disabled.grid.release()
      }
    } finally {
      open.mockRestore()
    }
  })

  it('框选拖选：从链接格按下拖到远处格抬起，链接点击零派发', () => {
    const { grid, table, container } = createGrid({ openCellLinkOnClick: false })
    try {
      grid.setCellLink({ row: LINK_CELL.row, col: LINK_CELL.col }, LINK)
      const clicks: unknown[] = []
      table.onCellLinkClick((event) => clicks.push(event))

      fire(container, 'pointerdown', {
        clientX: cellX(LINK_CELL.col),
        clientY: cellY(LINK_CELL.row),
      })
      fire(container, 'pointermove', { clientX: cellX(0), clientY: cellY(5) })
      fire(container, 'pointerup', { clientX: cellX(0), clientY: cellY(5) })
      expect(clicks).toEqual([])
    } finally {
      grid.release()
    }
  })

  it('键盘方向键移动选中（移入/移出链接格）：零派发', () => {
    const { grid, table, container } = createGrid({ openCellLinkOnClick: false })
    try {
      grid.setCellLink({ row: LINK_CELL.row, col: LINK_CELL.col }, LINK)
      const clicks: unknown[] = []
      table.onCellLinkClick((event) => clicks.push(event))

      table.selectCell(0, LINK_CELL.row)
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      expect(table.getSelection().focus).toEqual({ col: LINK_CELL.col, row: LINK_CELL.row })
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(clicks).toEqual([])
    } finally {
      grid.release()
    }
  })

  it('clear 后悬停与单击零派发；set 链接 undo 后同样消失（外观 + 事件）', () => {
    const { grid, table, container, sheet } = createGrid({ openCellLinkOnClick: false })
    try {
      grid.setCellLink({ row: LINK_CELL.row, col: LINK_CELL.col }, LINK)
      // clear 路径
      grid.clearCellLink({ row: LINK_CELL.row, col: LINK_CELL.col })
      let clicks = 0
      let hovers = 0
      table.onCellLinkClick(() => clicks++)
      table.onCellLinkHover(() => hovers++)
      hoverCell(container, LINK_CELL.col, LINK_CELL.row)
      clickCell(container, LINK_CELL.col, LINK_CELL.row)
      expect(container.style.cursor).toBe('auto')
      expect(hovers).toBe(0)
      expect(clicks).toBe(0)
      expect(table.resolveStyle(LINK_CELL.col, LINK_CELL.row).underline).toBeUndefined()

      // undo 路径：重新 set 后撤销（undo 回放整表替换），pull 式取值即刻失效
      grid.setCellLink({ row: LINK_CELL.row, col: LINK_CELL.col }, LINK)
      expect(table.resolveStyle(LINK_CELL.col, LINK_CELL.row).underline).toBe(true)
      expect(sheet.undo()).toBe(true)
      expect(sheet.getCellLink({ row: LINK_CELL.row, col: LINK_CELL.col })).toBeUndefined()
      hoverCell(container, LINK_CELL.col, LINK_CELL.row)
      clickCell(container, LINK_CELL.col, LINK_CELL.row)
      expect(hovers).toBe(0)
      expect(clicks).toBe(0)
      expect(table.resolveStyle(LINK_CELL.col, LINK_CELL.row).underline).toBeUndefined()
    } finally {
      grid.release()
    }
  })

  it('同一格既有嵌入图又有 cell-link：两桥共存不互斥（图片节点与链接外观/事件同在）', () => {
    const { grid, table, sheet, container } = createGrid({ openCellLinkOnClick: false })
    try {
      vi.spyOn(table.imageService, 'request').mockReturnValue('idle')
      sheet.setCellImage(
        { row: LINK_CELL.row, col: LINK_CELL.col },
        {
          src: 'https://example.com/a.png',
        },
      )
      grid.setCellLink({ row: LINK_CELL.row, col: LINK_CELL.col }, LINK)

      // 嵌入图桥：该格进入 media 请求并产出 ImageCellNode
      const node = [...table.imageCellNodes.values()].find(
        (n) => n.col === LINK_CELL.col && n.row === LINK_CELL.row,
      )
      expect(node).toBeDefined()
      // cell-link 桥：链接外观与单击事件照常
      expect(table.resolveStyle(LINK_CELL.col, LINK_CELL.row).underline).toBe(true)
      const clicks: unknown[] = []
      table.onCellLinkClick((event) => clicks.push(event))
      clickCell(container, LINK_CELL.col, LINK_CELL.row)
      expect(clicks).toHaveLength(1)
      expect(clicks[0]).toMatchObject({ col: LINK_CELL.col, row: LINK_CELL.row, url: LINK.url })
    } finally {
      grid.release()
    }
  })
})
