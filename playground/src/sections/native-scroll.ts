// 原生滚动条演示：ListTable 与 SheetGrid 双实例原生模式（scrollbar: { mode: 'native' }）。
// 滚动条由浏览器原生渲染（OS 外观/触控板惯性/系统辅助功能），两轴 gutter 经
// scrollbar-gutter: stable 从布局预留、永不遮挡单元格；DOM 滚动与引擎滚动状态双向
// 同步，宿主滚轮接线让位不双滚（mount.ts attachWheel 判 usesNativeScrollbar 跳过）。
// SheetGrid 不指定行列数（growOnScroll 缺省开），滚动触界后网格与原生滚动范围同步扩容。
// 冒烟断言锚点常量（视口尺寸/内容规模/冻结数）集中在文件顶部导出，便于核对。

import { Sheet, SheetGrid } from '@infinitable/sheet'

import { mountTable, type DemoMount } from '../mount'

/** ListTable 原生实例视口（两轴内容远超视口，覆盖 corner 双向预留） */
export const NATIVE_LIST_VIEW_WIDTH = 880
export const NATIVE_LIST_VIEW_HEIGHT = 420
/** ListTable 列宽：冻结第 0 列 120，其余 110（14 列合计 1550 ≫ 视口，横向可滚） */
export const NATIVE_LIST_COL_WIDTH = 110
export const NATIVE_LIST_FROZEN_COL_WIDTH = 120
export const NATIVE_LIST_COL_COUNT = 14
export const NATIVE_LIST_ROW_COUNT = 1_200
/** ListTable 冻结行列（行号列与列头缺省开启） */
export const NATIVE_LIST_FROZEN_COLS = 1
export const NATIVE_LIST_FROZEN_ROWS = 1

/** SheetGrid 原生实例视口（不指定行列数：growOnScroll 缺省开，初始 100×26 起步） */
export const NATIVE_SHEET_VIEW_WIDTH = 880
export const NATIVE_SHEET_VIEW_HEIGHT = 420
/** 原生滚动容器定位锚点（引擎装配的滚动 wrapper；冒烟断言与结构核对共用口径） */
export const NATIVE_SCROLL_WRAPPER_SELECTOR = '[data-native-scroll]'

export interface NativeScrollDemo {
  list: DemoMount
  sheet: {
    container: HTMLElement
    grid: SheetGrid
    model: Sheet
  }
  release(): void
}

export function mountNativeScroll(root: HTMLElement): NativeScrollDemo {
  const section = document.createElement('section')
  root.appendChild(section)
  /** 子场景标题（样式由 global.css 的 section h3 规则承担） */
  const addHeading = (text: string): void => {
    const heading = document.createElement('h3')
    heading.textContent = text
    section.appendChild(heading)
  }

  addHeading('ListTable 原生滚动条（冻结行列 + 行号列 + 列头，两轴可滚）')
  const columns = Array.from({ length: NATIVE_LIST_COL_COUNT }, (_, col) => ({
    field: `c${col}`,
    title: `列 ${col}`,
    width: col === 0 ? NATIVE_LIST_FROZEN_COL_WIDTH : NATIVE_LIST_COL_WIDTH,
  }))
  const records = Array.from({ length: NATIVE_LIST_ROW_COUNT }, (_, row) =>
    Object.fromEntries(columns.map((column, col) => [column.field, `格 ${col}-${row}`])),
  )
  const list = mountTable(section, {
    width: NATIVE_LIST_VIEW_WIDTH,
    height: NATIVE_LIST_VIEW_HEIGHT,
    scrollbar: { mode: 'native' },
    columns,
    records,
    frozenColCount: NATIVE_LIST_FROZEN_COLS,
    frozenRowCount: NATIVE_LIST_FROZEN_ROWS,
  })

  addHeading('SheetGrid 原生滚动条（growOnScroll 缺省开，滚动触界自动扩容）')
  const sheetContainer = document.createElement('div')
  sheetContainer.className = 'table-mount'
  sheetContainer.style.width = `${NATIVE_SHEET_VIEW_WIDTH}px`
  sheetContainer.style.height = `${NATIVE_SHEET_VIEW_HEIGHT}px`
  section.appendChild(sheetContainer)
  // 不传 rows/cols：初始网格按视口给足，滚动触界后 growOnScroll 扩容（缺省开启）
  const model = new Sheet('native-scroll')
  model.setCellValue({ row: 0, col: 0 }, '项目')
  model.setCellValue({ row: 0, col: 1 }, '数值')
  for (let row = 1; row <= 6; row++) {
    model.setCellValue({ row, col: 0 }, `条目 ${row}`)
    model.setCellValue({ row, col: 1 }, row * 100)
  }
  const grid = new SheetGrid({
    container: sheetContainer,
    sheet: model,
    width: NATIVE_SHEET_VIEW_WIDTH,
    height: NATIVE_SHEET_VIEW_HEIGHT,
    scrollbar: { mode: 'native' },
  })

  return {
    list,
    sheet: { container: sheetContainer, grid, model },
    release: () => {
      list.table.destroy()
      grid.release()
    },
  }
}
