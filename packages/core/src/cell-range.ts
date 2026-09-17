// 合并单元格：cell-range 的归一化、覆盖查询与主格判定。
// 纯数据结构，不参与渲染；ListTable 据此做合并区布局、取值与命中。

/** 单元格区间（闭区间，归一化后 start ≤ end） */
export interface CellRange {
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}

/** 归一化：交换使 start ≤ end */
export function normalizeCellRange(range: CellRange): CellRange {
  return {
    startCol: Math.min(range.startCol, range.endCol),
    startRow: Math.min(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
  }
}

/** (col, row) 是否落在区间内 */
export function rangeContains(range: CellRange, col: number, row: number): boolean {
  return (
    col >= range.startCol && col <= range.endCol && row >= range.startRow && row <= range.endRow
  )
}

/**
 * 区间是否跨越冻结边界：跨界的合并区在冻结/滚动分层下无法正确布局，
 * ListTable 构造时据此拒绝。
 */
export function rangeCrossesBoundary(
  range: CellRange,
  frozenColCount: number,
  frozenRowCount: number,
): boolean {
  const crossCol = range.startCol < frozenColCount !== range.endCol < frozenColCount
  const crossRow = range.startRow < frozenRowCount !== range.endRow < frozenRowCount
  return crossCol || crossRow
}

/** 单格区间不算合并（跨域为 1x1 时无意义） */
function isSingleCell(range: CellRange): boolean {
  return range.startCol === range.endCol && range.startRow === range.endRow
}

/**
 * 格坐标数值 key（全仓唯一定义）：`row * 2^21 + col`，替代模板串 key
 * 消除逐格索引的字符串分配。合并区索引（本文件）与场景/媒体格索引
 * （list-table-internal 转出）共用同一实现，编码边界与语义由编译器保证一致。
 * 边界：col < 2^21（约 209 万列）、row < 2^32（约 42 亿行）内编码唯一精确；
 * 坐标为非负格坐标（表头/行号格 -1 坐标不入索引，负坐标不在支持范围）。
 */
const CELL_KEY_COL_BITS = 21
export function cellKey(col: number, row: number): number {
  return row * 2 ** CELL_KEY_COL_BITS + col
}

/**
 * 合并区集合：按覆盖格索引到所属区间。
 * 构造时归一化并校验互不重叠（重叠属配置错误，直接抛错而非静默错绘）。
 */
export class MergeCellMap {
  /** 归一化后的合并区列表 */
  readonly ranges: readonly CellRange[]
  private readonly byCoord = new Map<number, CellRange>()

  constructor(ranges: readonly CellRange[] = []) {
    const normalized: CellRange[] = []
    for (const raw of ranges) {
      const range = normalizeCellRange(raw)
      if (isSingleCell(range)) {
        continue
      }
      for (let row = range.startRow; row <= range.endRow; row++) {
        for (let col = range.startCol; col <= range.endCol; col++) {
          const key = cellKey(col, row)
          if (this.byCoord.has(key)) {
            throw new Error(
              `merge ranges overlap at (${col}, ${row}): ` +
                `[${range.startCol},${range.startRow} ~ ${range.endCol},${range.endRow}]`,
            )
          }
          this.byCoord.set(key, range)
        }
      }
      normalized.push(range)
    }
    this.ranges = normalized
  }

  /** 覆盖 (col, row) 的合并区；未覆盖返回 null */
  rangeAt(col: number, row: number): CellRange | null {
    return this.byCoord.get(cellKey(col, row)) ?? null
  }

  /** (col, row) 所属合并区的主格（左上角）坐标；未被任何合并区覆盖返回 null */
  masterOf(col: number, row: number): { col: number; row: number } | null {
    const range = this.rangeAt(col, row)
    return range ? { col: range.startCol, row: range.startRow } : null
  }

  /** (col, row) 是否为合并区主格（未被覆盖时视为自身即主格，返回 false） */
  isMaster(col: number, row: number): boolean {
    const range = this.rangeAt(col, row)
    return range !== null && range.startCol === col && range.startRow === row
  }
}
