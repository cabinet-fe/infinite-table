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
 * 区间是否跨越冻结边界（纯谓词）：跨冻结边界的合并区合法——场景侧按主格所在
 * 冻结带钉固、整块绘制在滚动内容之上（list-table-scene 增量重挂）；
 * 场景与测试用它识别跨边界合并区，不再作为构造期拒绝依据。
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

/** 合并区重叠冲突（sanitizeMerges 逐条上报；MergeOverlapError 携带同一结构） */
export interface MergeConflict {
  /** 首个冲突格坐标 */
  coord: { col: number; row: number }
  /** 与既有区间重叠而被拒的区间（归一化后） */
  range: CellRange
  /** 先声明并已生效的冲突区间（归一化后） */
  existing: CellRange
}

/** 重叠合并区的类型化错误：携带冲突坐标与两条区间原文，宿主可 instanceof 定位 */
export class MergeOverlapError extends Error {
  readonly coord: MergeConflict['coord']
  /** 与既有区间重叠而被拒的区间 */
  readonly range: CellRange
  /** 先声明并已生效的冲突区间 */
  readonly existing: CellRange

  constructor(conflict: MergeConflict) {
    super(
      `merge ranges overlap at (${conflict.coord.col}, ${conflict.coord.row}): ` +
        `existing [${conflict.existing.startCol},${conflict.existing.startRow} ~ ${conflict.existing.endCol},${conflict.existing.endRow}] ` +
        `vs incoming [${conflict.range.startCol},${conflict.range.startRow} ~ ${conflict.range.endCol},${conflict.range.endRow}]`,
    )
    this.name = 'MergeOverlapError'
    this.coord = conflict.coord
    this.range = conflict.range
    this.existing = conflict.existing
  }
}

export interface SanitizedMerges {
  /** 规范化后互不重叠的区间（丢弃单格与冲突的后到项） */
  ranges: CellRange[]
  /** 被拒的重叠区间及冲突详情 */
  conflicts: MergeConflict[]
}

/**
 * 归一化 + 重叠消解（纯函数，不改输入）：逐条归一化、丢弃单格区间；
 * 重叠按声明序保留先到项、整体丢弃后到的冲突项（不裁剪、不改写区间），
 * 与 MergeCellMap 同一套归一化语义。宿主在写快照前可用它自救脏数据。
 */
export function sanitizeMerges(ranges: readonly CellRange[] = []): SanitizedMerges {
  const kept: CellRange[] = []
  const conflicts: MergeConflict[] = []
  const byCoord = new Map<number, CellRange>()
  for (const raw of ranges) {
    const range = normalizeCellRange(raw)
    if (isSingleCell(range)) {
      continue
    }
    let conflict: MergeConflict | null = null
    scan: for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        const existing = byCoord.get(cellKey(col, row))
        if (existing) {
          conflict = { coord: { col, row }, range, existing }
          break scan
        }
      }
    }
    if (conflict) {
      conflicts.push(conflict)
      continue
    }
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        byCoord.set(cellKey(col, row), range)
      }
    }
    kept.push(range)
  }
  return { ranges: kept, conflicts }
}

const warnedMergeConflicts = new Set<string>()

/**
 * 规范化冲突的 console 提示：报出调用来源、被丢区间与保留区间原文。
 * 同一冲突只提示一次（数据入口路径在 resync/undo 回放中反复进入，防刷屏）。
 */
export function warnMergeConflicts(conflicts: readonly MergeConflict[], source: string): void {
  for (const conflict of conflicts) {
    const { coord, range, existing } = conflict
    const signature = `${source} [${existing.startCol},${existing.startRow} ~ ${existing.endCol},${existing.endRow}]×[${range.startCol},${range.startRow} ~ ${range.endCol},${range.endRow}]`
    if (warnedMergeConflicts.has(signature)) {
      continue
    }
    warnedMergeConflicts.add(signature)
    console.warn(
      `[infinitable] ${source}: dropped overlapping merge range ` +
        `[${range.startCol},${range.startRow} ~ ${range.endCol},${range.endRow}] ` +
        `at (${coord.col}, ${coord.row}), kept ` +
        `[${existing.startCol},${existing.startRow} ~ ${existing.endCol},${existing.endRow}] ` +
        `(sanitize input merges via sanitizeMerges() or fix the data source)`,
    )
  }
}

/**
 * 合并区集合：按覆盖格索引到所属区间。
 * 构造时归一化并校验互不重叠——重叠属配置错误，抛 MergeOverlapError
 * （携带两条冲突区间与冲突坐标）；批量数据入口（ListTable 构造参数 /
 * setMergeCells / 快照恢复）应先经 sanitizeMerges 宽容消解，勿直接喂脏数据。
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
            throw new MergeOverlapError({
              coord: { col, row },
              range,
              existing: this.byCoord.get(key)!,
            })
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
