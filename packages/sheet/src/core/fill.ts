// 填充生成（填充柄拖拽语义，框架无关纯函数）
// （迁移自 sheet-core core/fill.ts；公式引用平移改用 @infinitable/formulas 的 shiftFormulaRefs）

import type { CellAddress, CellRange } from './address'
import { createRange, iterateRange } from './address'
import type { CellData, CellType } from './cell-store'
import type { SetCellValueItem } from './command/set-cell-value'
import { shiftFormulaRefs } from '@infinitable/formulas'

/** 填充柄拖拽方向（与 VTable drag_fill_handle_end 一致） */
export type FillDirection = 'top' | 'bottom' | 'left' | 'right'

export interface GenerateFillOptions {
  /** 拖拽前的源选区（模型坐标） */
  source: CellRange
  /** 需要写入的目标区（不含源区，模型坐标） */
  target: CellRange
  /** 填充方向 */
  direction: FillDirection
  /** 读取源区单元格（原始存储语义） */
  getCellData: (addr: CellAddress) => CellData | undefined
}

/**
 * 由源选区 + 拖拽后扩展选区 + 方向，计算需要填充的目标区（模型坐标）。
 * 算法对齐 VTable 官方 fill-handle 示例（扩展选区含源区，目标为扩展部分）。
 */
export function computeFillTargetRange(
  source: CellRange,
  direction: FillDirection,
  expanded: CellRange,
): CellRange | null {
  const src = createRange(source.start, source.end)
  const exp = createRange(expanded.start, expanded.end)

  if (direction === 'bottom') {
    if (exp.end.row <= src.end.row) return null
    return {
      start: { row: src.end.row + 1, col: src.start.col },
      end: { row: exp.end.row, col: src.end.col },
    }
  }
  if (direction === 'top') {
    if (exp.start.row >= src.start.row) return null
    return {
      start: { row: exp.start.row, col: src.start.col },
      end: { row: src.start.row - 1, col: src.end.col },
    }
  }
  if (direction === 'right') {
    if (exp.end.col <= src.end.col) return null
    return {
      start: { row: src.start.row, col: src.end.col + 1 },
      end: { row: src.end.row, col: exp.end.col },
    }
  }
  // left
  if (exp.start.col >= src.start.col) return null
  return {
    start: { row: src.start.row, col: exp.start.col },
    end: { row: src.end.row, col: src.start.col - 1 },
  }
}

/**
 * 生成填充写入项（tile / 数字日期等差 / 公式相对引用位移——绝对引用经
 * `@infinitable/formulas` 的 shiftFormulaRefs 锁定）。
 * 调用方一次 `sheet.setCells(items)` 即可（单 undo 单元）。
 */
export function generateFill(options: GenerateFillOptions): SetCellValueItem[] {
  const { source, target, direction, getCellData } = options
  const src = createRange(source.start, source.end)
  const tgt = createRange(target.start, target.end)
  const srcRows = src.end.row - src.start.row + 1
  const srcCols = src.end.col - src.start.col + 1
  const vertical = direction === 'top' || direction === 'bottom'

  const seriesByLane = new Map<number, SeriesInfo | null>()
  if (vertical) {
    for (let col = src.start.col; col <= src.end.col; col++) {
      const values: number[] = []
      let cellType: CellType | undefined
      let ok = true
      for (let row = src.start.row; row <= src.end.row; row++) {
        const data = getCellData({ row, col })
        const num = readSeriesNumber(data)
        if (num == null) {
          ok = false
          break
        }
        values.push(num.value)
        cellType = num.t
      }
      seriesByLane.set(col, ok ? makeSeriesInfo(values, cellType) : null)
    }
  } else {
    for (let row = src.start.row; row <= src.end.row; row++) {
      const values: number[] = []
      let cellType: CellType | undefined
      let ok = true
      for (let col = src.start.col; col <= src.end.col; col++) {
        const data = getCellData({ row, col })
        const num = readSeriesNumber(data)
        if (num == null) {
          ok = false
          break
        }
        values.push(num.value)
        cellType = num.t
      }
      seriesByLane.set(row, ok ? makeSeriesInfo(values, cellType) : null)
    }
  }

  const items: SetCellValueItem[] = []
  for (const addr of iterateRange(tgt)) {
    const rowOffset = positiveMod(addr.row - src.start.row, srcRows)
    const colOffset = positiveMod(addr.col - src.start.col, srcCols)
    const srcAddr: CellAddress = { row: src.start.row + rowOffset, col: src.start.col + colOffset }
    const srcData = getCellData(srcAddr)

    if (srcData?.f != null && srcData.f !== '') {
      const deltaRow = addr.row - srcAddr.row
      const deltaCol = addr.col - srcAddr.col
      items.push({ addr, data: { f: shiftFormulaRefs(srcData.f, deltaRow, deltaCol) } })
      continue
    }

    const lane = vertical ? srcAddr.col : srcAddr.row
    const series = seriesByLane.get(lane)
    if (series) {
      const index = vertical ? addr.row - src.start.row : addr.col - src.start.col
      const value = series.first + index * series.delta
      items.push({ addr, data: { v: value, t: series.t ?? 'n' } })
      continue
    }

    // tile 复制（含空格 → 清除）
    items.push({ addr, data: cloneCellData(srcData) })
  }
  return items
}

interface SeriesInfo {
  first: number
  delta: number
  t?: CellType
}

function makeSeriesInfo(values: number[], t?: CellType): SeriesInfo {
  const first = values[0]!
  if (values.length === 1) {
    return { first, delta: 1, t }
  }
  const delta = (values[values.length - 1]! - first) / (values.length - 1)
  return { first, delta, t }
}

/** 可参与等差序列的数字/日期格；公式格与其它类型返回 null */
function readSeriesNumber(data: CellData | undefined): { value: number; t?: CellType } | null {
  if (!data) return null
  if (data.f != null && data.f !== '') return null
  if (typeof data.v !== 'number' || !Number.isFinite(data.v)) return null
  if (data.t != null && data.t !== 'n' && data.t !== 'd') return null
  return { value: data.v, t: data.t }
}

function cloneCellData(data: CellData | undefined): CellData | undefined {
  if (!data) return undefined
  const cloned: CellData = {}
  if (data.v !== undefined) cloned.v = data.v
  if (data.t !== undefined) cloned.t = data.t
  if (data.f !== undefined) cloned.f = data.f
  return cloned
}

function positiveMod(n: number, mod: number): number {
  return ((n % mod) + mod) % mod
}
