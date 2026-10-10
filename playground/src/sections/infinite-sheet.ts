// WPS 式无限表格演示：不指定行列数挂 SheetGrid——初始网格按视口给足
// （可视 + 滚动缓冲），滚动缓冲末端触界后模型与引擎同步扩容（SheetGrid
// growOnScroll 缺省开启），行号/列字母随滚动无限延伸；滚动条画在右/下缘
// 预留轨道上，不再遮挡表体。预置少量数据展示它是一张可编辑的活表。

import { Sheet, SheetGrid } from '@infinitable/sheet'

const VIEW_WIDTH = 880
const VIEW_HEIGHT = 420

export interface InfiniteSheetDemo {
  container: HTMLElement
  grid: SheetGrid
  sheet: Sheet
  /** 当前模型行列数（页面状态行轮询展示「网格长到哪了」） */
  getDims(): { rows: number; cols: number }
  release(): void
}

export function mountInfiniteSheet(root: HTMLElement): InfiniteSheetDemo {
  const section = document.createElement('section')
  root.appendChild(section)
  const container = document.createElement('div')
  container.className = 'table-mount'
  container.style.width = `${VIEW_WIDTH}px`
  container.style.height = `${VIEW_HEIGHT}px`
  section.appendChild(container)

  // 注意：不传 rows/cols——初始尺寸由 SheetGrid 按视口 + 缓冲计算，后续由滚动驱动增长
  const sheet = new Sheet('infinite')
  // 预置一点活数据（A1 起的小九宫 + 一条公式），其余区域空表随滚动生长
  sheet.setCellValue({ row: 0, col: 0 }, '项目')
  sheet.setCellValue({ row: 0, col: 1 }, '数值')
  sheet.setCellValue({ row: 0, col: 2 }, '公式')
  for (let row = 1; row <= 6; row++) {
    sheet.setCellValue({ row, col: 0 }, `条目 ${row}`)
    sheet.setCellValue({ row, col: 1 }, row * 100)
    sheet.setCellValue({ row, col: 2 }, `=B${row + 1}*2`)
  }

  const grid = new SheetGrid({
    container,
    sheet,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
  })

  return {
    container,
    grid,
    sheet,
    getDims: () => ({ rows: sheet.rows, cols: sheet.cols }),
    release: () => grid.release(),
  }
}
