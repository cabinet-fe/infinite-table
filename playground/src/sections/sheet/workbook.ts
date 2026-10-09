// 演示工作簿播种（@infinitable/sheet Workbook 单一事实源）：
// 值/公式经 addSheet 初始数据一次写入（单命令 + 立即重算），样式/合并/行高随后播种，
// 收尾清空历史——种子是基线状态，不进 undo（Excel 模板语义，与 addSheet options.data 同口径）。

import { type AddSheetCellInput, type CellAddress, Workbook, type Sheet } from '@infinitable/sheet'

import { demoImagePngBytes } from '../../mount'

import {
  MAIN_SHEET_NAME,
  MATRIX_STYLE_SEEDS,
  SECONDARY_SHEET_NAME,
  SHEET_COL_COUNT,
  SHEET_ROW_COUNT,
  VALUE_SEEDS,
} from './constants'

/** 稀疏种子键 `${col},${row}` → 模型地址 */
function seedAddr(key: string): CellAddress {
  const [col, row] = key.split(',').map(Number)
  return { row: row!, col: col! }
}

/** 公式演示格（store.ts 旧口径）：D3 引用运算、D4 区域函数（显示求值结果、编辑见原文） */
const MAIN_FORMULA_CELLS: ReadonlyArray<{ key: string; f: string }> = [
  { key: '3,2', f: 'D1+D2' },
  { key: '3,3', f: 'SUM(D1:D2)' },
]

/** 值/公式种子 → addSheet 初始数据二维数组（'=' 原文转 f；其余原值） */
function buildSeedData(): AddSheetCellInput[][] {
  const rows: AddSheetCellInput[][] = []
  const write = (addr: CellAddress, input: AddSheetCellInput): void => {
    const row = (rows[addr.row] ??= [])
    row[addr.col] = input
  }
  for (const { key, value } of VALUE_SEEDS) {
    write(seedAddr(key), value as AddSheetCellInput)
  }
  for (const { key, f } of MAIN_FORMULA_CELLS) {
    write(seedAddr(key), { f })
  }
  return rows
}

/** 次表轻量数字网格（验证切换状态隔离） */
function buildSecondaryData(): AddSheetCellInput[][] {
  const rows: AddSheetCellInput[][] = []
  for (let row = 0; row < 6; row++) {
    const cells: AddSheetCellInput[] = []
    for (let col = 0; col < 4; col++) {
      cells[col] = col * 10 + row
    }
    rows[row] = cells
  }
  rows[8] = ['Sheet 2：切换后值/冻结/合并相互隔离']
  return rows
}

/** 主表样式矩阵 + 合并区 + 行高覆盖 + 预置浮动示例图（锚 F2~G3，字节本地生成） */
function seedMainSheetExtras(sheet: Sheet): void {
  sheet.setCellStyles(
    MATRIX_STYLE_SEEDS.map(({ key, style }) => ({ addr: seedAddr(key), partial: style })),
  )
  // 初始合并区 C12:E13（主格含 \n 多行文本）；起始列取 2：冻结列数 0/1/2 挡位切换时均不跨冻结边界
  sheet.mergeCells({ start: { row: 11, col: 2 }, end: { row: 12, col: 4 } })
  // 对齐演示行加高（尺寸事实源入模型；默认无冻结，冻结经右键菜单「冻结到当前行/列」）
  sheet.setRowHeight(3, 44)
  // 预置浮动示例图（对标 ultra-ui playground 的本地生成小图，锚 F2~G3）
  sheet.insertImage({
    data: demoImagePngBytes('demo://sheet/demo-float'),
    type: 'png',
    anchor: {
      from: { row: 1, col: 5, offsetX: 2, offsetY: 2 },
      to: { row: 2, col: 6 },
    },
    title: 'playground demo',
  })
}

/** 主表播种临时名：Workbook 构造期自带默认空表 Sheet1，且 addSheet 显式名不查重——
 *  直接以 Sheet1 播种会与默认表同名并存（getSheet/activateSheet 取首 match 绑到空表）。
 *  先以临时名播种，删默认表后归位正名，保证表序 [Sheet1, Sheet2] 且主表为初始活跃表。 */
const SEED_SHEET_NAME = 'demo-seed'

/** 演示工作簿：Sheet1 样式矩阵/合并/公式/浮动图 + Sheet2 轻量数字网格 */
export function createDemoWorkbook(): Workbook {
  const workbook = new Workbook()
  const defaultSheetName = workbook.activeSheet.name
  const main = workbook.addSheet(SEED_SHEET_NAME, {
    data: buildSeedData(),
    rows: SHEET_ROW_COUNT,
    cols: SHEET_COL_COUNT,
  })
  workbook.removeSheet(defaultSheetName)
  workbook.renameSheet(SEED_SHEET_NAME, MAIN_SHEET_NAME)
  workbook.addSheet(SECONDARY_SHEET_NAME, {
    data: buildSecondaryData(),
    rows: SHEET_ROW_COUNT,
    cols: SHEET_COL_COUNT,
  })
  seedMainSheetExtras(main)
  // 种子是基线状态：不进 undo（播种命令出栈，演示区撤销只回退用户操作）
  main.history.clear()
  return workbook
}
