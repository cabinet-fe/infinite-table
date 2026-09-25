// ListTable 内部协作模块共享的常量与纯辅助。
// 仅供包内 list-table 协作模块（scene/media/interaction）与主类使用，不进入公共入口。

import type { CellRange, MergeCellMap } from './cell-range'
import { normalizeRange, type SelectionSnapshot } from './selection'

/** 行号列/表头节点用 -1 标记非数据格坐标 */
export const HEADER_COORD = -1

/**
 * 格索引数值 key：唯一定义在 cell-range.ts（无依赖底层模块，避免 import 成环），
 * 此处转出以维持协作模块的既有 import 路径。
 */
export { cellKey } from './cell-range'

/**
 * 合并区模型越界校验（构造期语义，运行时合并/几何变更同样适用）：
 * 行列范围越出表格（负坐标或越界）的合并区抛错，调用方保持原状；
 * 横跨冻结边界线的合并区合法——场景侧按主格冻结带归属钉固、整块绘制在
 * 滚动内容之上（见 list-table-scene 的跨边界主格重挂）。
 */
export function assertMergesWithinTable(
  ranges: readonly CellRange[],
  colCount: number,
  rowCount: number,
): void {
  for (const range of ranges) {
    if (
      range.startCol < 0 ||
      range.startRow < 0 ||
      range.endCol >= colCount ||
      range.endRow >= rowCount
    ) {
      throw new Error(
        `merge range [${range.startCol},${range.startRow} ~ ${range.endCol},${range.endRow}] ` +
          'is outside the table bounds',
      )
    }
  }
}

/**
 * 表头高亮判定输入：选区快照、全表尺寸与合并区一次装配，行号/列头两种判定共用。
 * 建格装配与选区变化重涂两条路径传同一来源，保证两条路径观感一致。
 */
export interface HeaderHighlightInput {
  snapshot: SelectionSnapshot
  /** 全表列数：整行形态段（列范围盖满全表）判定用 */
  colCount: number
  /** 全表行数：整列形态段（行范围盖满全表）判定用 */
  rowCount: number
  /** 合并区模型：焦点格经主格（左上角）解析；缺省视为无合并区 */
  merges?: MergeCellMap | null
}

/** 焦点格按合并区解析主格坐标（未被合并区覆盖时为焦点本身；无焦点返回 null） */
function resolveFocusMaster(input: HeaderHighlightInput): { col: number; row: number } | null {
  const focus = input.snapshot.focus
  if (!focus) {
    return null
  }
  return input.merges?.masterOf(focus.col, focus.row) ?? focus
}

/** 选区是否存在整列形态段（行范围盖满全表；selectCol/selectAll 形态） */
function hasFullRowSpan(input: HeaderHighlightInput): boolean {
  return input.snapshot.ranges.some((range) => {
    const bounds = normalizeRange(range)
    return bounds.minRow === 0 && bounds.maxRow === input.rowCount - 1
  })
}

/** 选区是否存在整行形态段（列范围盖满全表；selectRow/selectAll 形态） */
function hasFullColSpan(input: HeaderHighlightInput): boolean {
  return input.snapshot.ranges.some((range) => {
    const bounds = normalizeRange(range)
    return bounds.minCol === 0 && bounds.maxCol === input.colCount - 1
  })
}

/**
 * 行号格 row 是否高亮：整行形态段覆盖该行（selectRow/selectAll，行号带全亮），
 * 或焦点格（按合并区解析主格）落在该行。选区存在整列/全选形态段时不启用焦点源——
 * 对齐 Excel/WPS：整轴选区只在被选轴的表头带高亮，不跨轴点亮焦点格。
 */
export function isRowHeaderHighlighted(input: HeaderHighlightInput, row: number): boolean {
  const spansAll = input.snapshot.ranges.some((range) => {
    const bounds = normalizeRange(range)
    return (
      bounds.minCol === 0 &&
      bounds.maxCol === input.colCount - 1 &&
      row >= bounds.minRow &&
      row <= bounds.maxRow
    )
  })
  if (spansAll) {
    return true
  }
  if (hasFullRowSpan(input)) {
    return false
  }
  return resolveFocusMaster(input)?.row === row
}

/**
 * 列头格 col 是否高亮：整列形态段覆盖该列（selectCol/selectAll，列头带全亮），
 * 或焦点格（按合并区解析主格）落在该列。选区存在整行/全选形态段时不启用焦点源——
 * 对齐 Excel/WPS：整轴选区只在被选轴的表头带高亮，不跨轴点亮焦点格。
 */
export function isColHeaderHighlighted(input: HeaderHighlightInput, col: number): boolean {
  const spansAll = input.snapshot.ranges.some((range) => {
    const bounds = normalizeRange(range)
    return (
      bounds.minRow === 0 &&
      bounds.maxRow === input.rowCount - 1 &&
      col >= bounds.minCol &&
      col <= bounds.maxCol
    )
  })
  if (spansAll) {
    return true
  }
  if (hasFullColSpan(input)) {
    return false
  }
  return resolveFocusMaster(input)?.col === col
}
