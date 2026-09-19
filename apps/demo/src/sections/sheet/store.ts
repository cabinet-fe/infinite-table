// SheetStore 构建：演示区两个 sheet 的单一事实源（值/样式/尺寸/冻结/合并）。
// 初始值与样式矩阵种子在构造时播种；样式经 resolveCellStyle hook 落引擎。

import { SheetStore } from '@infinite-table/plugins'

import { MATRIX_STYLE_SEEDS, SHEET_COL_COUNT, SHEET_ROW_COUNT, VALUE_SEEDS } from './constants'

/** 主 sheet（Sheet1）：样式矩阵 + 合并区 + 填充演示 + 公式演示格 */
export function createMainStore(): SheetStore {
  const store = new SheetStore({
    rowCount: SHEET_ROW_COUNT,
    colCount: SHEET_COL_COUNT,
    defaultColWidth: 80,
    defaultRowHeight: 28,
  })
  // 对齐演示行加高（尺寸事实源入 Store）
  store.setRowHeight(3, 44)
  for (const { key, value } of VALUE_SEEDS) {
    const [col, row] = key.split(',').map(Number)
    store.setValue(col!, row!, value)
  }
  for (const { key, style } of MATRIX_STYLE_SEEDS) {
    const [col, row] = key.split(',').map(Number)
    store.setStyle(col!, row!, style)
  }
  // 默认无冻结（对标 ultra-ui 演示初始态；冻结经右键菜单「冻结到当前行/列」）
  store.setFrozen({ colCount: 0, rowCount: 0 })
  store.setMerges([{ startCol: 2, startRow: 11, endCol: 4, endRow: 12 }])
  // 公式演示格：D1=7、D2=5；E2 = 引用运算，E3 = 区域函数（显示求值结果、编辑见原文）
  store.setValue(3, 0, 7)
  store.setValue(3, 1, 5)
  store.setValue(3, 2, '=D1+D2')
  store.setValue(3, 3, '=SUM(D1:D2)')
  store.setValue(2, 0, '公式显示→')
  store.setStyle(2, 0, { color: '#71717a' })
  return store
}

/** 次 sheet（Sheet2）：轻量数字网格（验证切换状态隔离） */
export function createSecondaryStore(): SheetStore {
  const store = new SheetStore({
    rowCount: SHEET_ROW_COUNT,
    colCount: SHEET_COL_COUNT,
    defaultColWidth: 80,
    defaultRowHeight: 28,
  })
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 6; row++) {
      store.setValue(col, row, col * 10 + row)
    }
  }
  store.setValue(0, 8, 'Sheet 2：切换后值/冻结/合并相互隔离')
  return store
}
