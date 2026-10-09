// 填充柄接线（宿主演示层）：拖拽生成与只读过滤由 SheetGrid 选区控制器内置
// （computeFillTargetRange + generateFill → setCells 单 undo 单元），此处只补两件事：
// - 双击柄自动填充（Excel 语义：按相邻列连续数据块末行向下延展，算法自旧 plugins/sheet
//   的 resolveAutoFillTarget 移植，读取口径改为模型 CellData）；
// - 三个填充事件的演示 toast（按下 / 拖拽扩展区 / 双击）。

import {
  computeFillTargetRange,
  generateFill,
  type CellAddress,
  type CellRange,
  type FillDirection,
  SheetGrid,
  type Sheet,
} from '@infinitable/sheet'

/** min/max 边界（引擎事件口径） */
interface Bounds {
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
}

const toRange = (bounds: Bounds): CellRange => ({
  start: { row: bounds.minRow, col: bounds.minCol },
  end: { row: bounds.maxRow, col: bounds.maxCol },
})

/** 并集（min/max 取大） */
function union(a: Bounds, b: Bounds): Bounds {
  return {
    minCol: Math.min(a.minCol, b.minCol),
    minRow: Math.min(a.minRow, b.minRow),
    maxCol: Math.max(a.maxCol, b.maxCol),
    maxRow: Math.max(a.maxRow, b.maxRow),
  }
}

const formatBounds = (bounds: Bounds): string =>
  `(${bounds.minCol},${bounds.minRow})~(${bounds.maxCol},${bounds.maxRow})`

/** 空格判定（模型口径：无数据 / 无值且无公式 / 空串） */
function isEmptyCell(sheet: Sheet, col: number, row: number): boolean {
  const data = sheet.getCellData({ row, col })
  if (!data) return true
  if (data.f != null && data.f !== '') return false
  return data.v == null || data.v === ''
}

/**
 * 双击填充柄的自动填充目标（自旧 plugins/sheet fill.ts 移植）：按锚定段相邻列
 * （左邻优先、其次右邻）的连续数据块末行，把锚定段向下延展成新目标；
 * 相邻列在锚定段行范围内无数据、或数据块未越出锚定段底行时返回 null（无填充）。
 */
export function resolveAutoFillTarget(sheet: Sheet, anchor: Bounds): Bounds | null {
  const rowCount = Math.max(sheet.rows, sheet.rowCount)
  for (const refCol of [anchor.minCol - 1, anchor.maxCol + 1]) {
    if (refCol < 0) {
      continue
    }
    // 数据块与选区的接点：锚定段行范围内参考列第一个非空格
    let seed = -1
    for (let row = anchor.minRow; row <= anchor.maxRow; row++) {
      if (!isEmptyCell(sheet, refCol, row)) {
        seed = row
        break
      }
    }
    if (seed < 0) {
      continue
    }
    // 从接点向下扩到连续数据块末尾（越界读取天然为空，rowCount 夹取只是少扫空行）
    let endRow = seed
    while (endRow + 1 < rowCount && !isEmptyCell(sheet, refCol, endRow + 1)) {
      endRow++
    }
    if (endRow > anchor.maxRow) {
      return { minCol: anchor.minCol, minRow: anchor.minRow, maxCol: anchor.maxCol, maxRow: endRow }
    }
  }
  return null
}

/** 锚定段 + 拖拽/双击目标 → 生成写值 + 选区扩展到源区∪新区（对标 ultra-ui 填充完成选区跟随） */
function commitFill(
  sheet: Sheet,
  source: CellRange,
  direction: FillDirection,
  expanded: Bounds,
): void {
  const target = computeFillTargetRange(source, direction, toRange(expanded))
  if (!target) {
    return
  }
  const items = generateFill({
    source,
    target,
    direction,
    getCellData: (addr: CellAddress) => sheet.getCellData(addr),
  })
  if (items.length === 0) {
    return
  }
  sheet.setCells(items)
  sheet.selectRange({
    start: source.start,
    end: { row: expanded.maxRow, col: expanded.maxCol },
  })
}

/** 填充柄演示接线：toast + 双击自动填充；返回退订函数（随 grid 释放） */
export function bindSheetFillEvents(
  grid: SheetGrid,
  sheet: Sheet,
  notify: (text: string, kind?: 'info' | 'warn') => void,
): () => void {
  const table = grid.getTable()
  const offs = [
    table.onFillHandleDown((event) => {
      const bounds = event.range
      notify(
        `填充柄按下：选区段 (${Math.min(bounds.start.col, bounds.end.col)},${Math.min(bounds.start.row, bounds.end.row)})~(${Math.max(bounds.start.col, bounds.end.col)},${Math.max(bounds.start.row, bounds.end.row)})`,
      )
    }),
    // 拖拽生成由 SheetGrid 选区控制器内置（同一生成算法），这里只做演示提示；
    // 无扩展区（单击柄/双击首击的空点按）不提示
    table.onFillDragEnd((event) => {
      const { anchor, target } = event
      if (
        target.minCol >= anchor.minCol &&
        target.maxCol <= anchor.maxCol &&
        target.minRow >= anchor.minRow &&
        target.maxRow <= anchor.maxRow
      ) {
        return
      }
      notify(
        `填充生成：锚定 ${formatBounds(anchor)} → 写入 ${formatBounds(union(anchor, target))} 的扩展区`,
      )
    }),
    table.onFillHandleDoubleClick((event) => {
      const bounds = {
        minCol: Math.min(event.range.start.col, event.range.end.col),
        maxCol: Math.max(event.range.start.col, event.range.end.col),
        minRow: Math.min(event.range.start.row, event.range.end.row),
        maxRow: Math.max(event.range.start.row, event.range.end.row),
      }
      notify(`填充柄双击：${formatBounds(bounds)} 按相邻数据块自动填充`)
      const auto = resolveAutoFillTarget(sheet, bounds)
      if (!auto) {
        return
      }
      commitFill(sheet, toRange(bounds), 'bottom', auto)
    }),
  ]
  return () => {
    for (const off of offs) {
      off()
    }
  }
}
