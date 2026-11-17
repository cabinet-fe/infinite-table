// 合并单元格：cell-range 的归一化、覆盖查询与主格判定。
// 纯数据结构，不参与渲染；ListTable 据此做合并区布局、取值与命中。

import type { CellRange } from '@infinitable/protocol'

export type { CellRange }

/** 归一化：交换使 start ≤ end */
export function normalizeCellRange(range: CellRange): CellRange {
  return {
    startCol: Math.min(range.startCol, range.endCol),
    startRow: Math.min(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
  }
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

/** 逐格展开写入 byCoord 的单元格数量阈值；超过此阈值的合并区改走稀疏行分桶索引 */
const SMALL_MERGE_CELL_LIMIT = 64
/** 行分桶大小（每桶 256 行） */
const ROW_BUCKET_SIZE = 256
/** 单条合并区允许分桶的最大跨度（约 100 万行）；超出时退化到 hugeMerges 列表，防超大区间分配过量桶 */
const MAX_BUCKET_SPAN = 4096

function bucketOfRow(row: number): number {
  return Math.max(0, Math.floor(row / ROW_BUCKET_SIZE))
}

function rangeCellCount(range: CellRange): number {
  return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1)
}

function rangesOverlap(a: CellRange, b: CellRange): boolean {
  return (
    a.startRow <= b.endRow &&
    a.endRow >= b.startRow &&
    a.startCol <= b.endCol &&
    a.endCol >= b.startCol
  )
}

function containsCoord(range: CellRange, col: number, row: number): boolean {
  return (
    col >= range.startCol && col <= range.endCol && row >= range.startRow && row <= range.endRow
  )
}

function pushToBuckets(
  buckets: Map<number, CellRange[]>,
  startRow: number,
  endRow: number,
  range: CellRange,
): void {
  const startBucket = bucketOfRow(startRow)
  const endBucket = bucketOfRow(endRow)
  for (let b = startBucket; b <= endBucket; b++) {
    let list = buckets.get(b)
    if (!list) {
      list = []
      buckets.set(b, list)
    }
    list.push(range)
  }
}

function collectFromBuckets(
  buckets: Map<number, CellRange[]>,
  startBucket: number,
  endBucket: number,
  seen: Set<CellRange> | null,
  visit: (range: CellRange) => void,
): void {
  for (let b = startBucket; b <= endBucket; b++) {
    const list = buckets.get(b)
    if (!list) continue
    for (const range of list) {
      if (seen) {
        if (seen.has(range)) continue
        seen.add(range)
      }
      visit(range)
    }
  }
}

/**
 * 稀疏分桶合并索引（MergeCellMap 与 sanitizeMerges 共用）：
 * - 小合并区（<= 64 格）：逐格写入 byCoord（O(1) 查询）并按行分桶入 smallBuckets（区间查询用）
 * - 大合并区（> 64 格）：不展开逐格，按 256 行分桶入 largeBuckets（跨百万行以上进 hugeMerges）
 */
class SparseMergeIndex {
  readonly ranges: CellRange[] = []
  private readonly byCoord = new Map<number, CellRange>()
  private readonly smallBuckets = new Map<number, CellRange[]>()
  private readonly largeBuckets = new Map<number, CellRange[]>()
  private readonly hugeMerges: CellRange[] = []
  private hasLarge = false

  add(range: CellRange): void {
    this.ranges.push(range)
    const startBucket = bucketOfRow(range.startRow)
    const endBucket = bucketOfRow(range.endRow)
    if (rangeCellCount(range) <= SMALL_MERGE_CELL_LIMIT) {
      for (let row = range.startRow; row <= range.endRow; row++) {
        for (let col = range.startCol; col <= range.endCol; col++) {
          this.byCoord.set(cellKey(col, row), range)
        }
      }
      pushToBuckets(this.smallBuckets, range.startRow, range.endRow, range)
      return
    }
    this.hasLarge = true
    if (endBucket - startBucket + 1 <= MAX_BUCKET_SPAN) {
      pushToBuckets(this.largeBuckets, range.startRow, range.endRow, range)
    } else {
      this.hugeMerges.push(range)
    }
  }

  rangeAt(col: number, row: number): CellRange | null {
    const direct = this.byCoord.get(cellKey(col, row))
    if (direct) {
      return direct
    }
    if (!this.hasLarge) {
      return null
    }
    const bucket = this.largeBuckets.get(bucketOfRow(row))
    if (bucket) {
      for (const range of bucket) {
        if (containsCoord(range, col, row)) {
          return range
        }
      }
    }
    for (const range of this.hugeMerges) {
      if (containsCoord(range, col, row)) {
        return range
      }
    }
    return null
  }

  rangesInBounds(minCol: number, minRow: number, maxCol: number, maxRow: number): CellRange[] {
    if (maxCol < minCol || maxRow < minRow || this.ranges.length === 0) {
      return []
    }
    const result: CellRange[] = []
    this.forEachRowCandidate(minRow, maxRow, true, (range) => {
      if (
        range.endCol >= minCol &&
        range.startCol <= maxCol &&
        range.endRow >= minRow &&
        range.startRow <= maxRow
      ) {
        result.push(range)
      }
    })
    return result
  }

  /**
   * 按行主序找出与 incoming 首个冲突格（保留与逐格扫描完全一致的 coord 与 existing 判定）：
   * - 小范围（<= 64 格）：直接按行主序查 byCoord + 大合并区，避免大量同桶小合并区的线性扫描
   * - 大范围（> 64 格）：走桶索引筛选候选，取 (overlapRow, overlapCol) 字典序最小者
   */
  findFirstConflict(incoming: CellRange): MergeConflict | null {
    if (this.ranges.length === 0) {
      return null
    }
    let bestExisting: CellRange | null = null
    let bestRow = Infinity
    let bestCol = Infinity

    const recordCandidate = (existing: CellRange): void => {
      if (!rangesOverlap(existing, incoming)) {
        return
      }
      const row = Math.max(existing.startRow, incoming.startRow)
      const col = Math.max(existing.startCol, incoming.startCol)
      if (row < bestRow || (row === bestRow && col < bestCol)) {
        bestRow = row
        bestCol = col
        bestExisting = existing
      }
    }

    if (rangeCellCount(incoming) <= SMALL_MERGE_CELL_LIMIT) {
      smallScan: for (let row = incoming.startRow; row <= incoming.endRow; row++) {
        for (let col = incoming.startCol; col <= incoming.endCol; col++) {
          const existing = this.byCoord.get(cellKey(col, row))
          if (existing) {
            bestRow = row
            bestCol = col
            bestExisting = existing
            break smallScan
          }
        }
      }
      if (this.hasLarge) {
        this.forEachRowCandidate(incoming.startRow, incoming.endRow, false, recordCandidate)
      }
    } else {
      this.forEachRowCandidate(incoming.startRow, incoming.endRow, true, recordCandidate)
    }

    return bestExisting
      ? { coord: { col: bestCol, row: bestRow }, range: incoming, existing: bestExisting }
      : null
  }

  private forEachRowCandidate(
    startRow: number,
    endRow: number,
    includeSmall: boolean,
    visit: (range: CellRange) => void,
  ): void {
    const startBucket = bucketOfRow(startRow)
    const endBucket = bucketOfRow(endRow)
    if (includeSmall && endBucket - startBucket + 1 > this.ranges.length) {
      for (const range of this.ranges) {
        visit(range)
      }
      return
    }
    const seen = startBucket === endBucket ? null : new Set<CellRange>()
    if (includeSmall) {
      collectFromBuckets(this.smallBuckets, startBucket, endBucket, seen, visit)
    }
    if (this.hasLarge) {
      collectFromBuckets(this.largeBuckets, startBucket, endBucket, seen, visit)
      for (const range of this.hugeMerges) {
        if (seen) {
          if (seen.has(range)) continue
          seen.add(range)
        }
        visit(range)
      }
    }
  }
}

function buildMergeIndex(
  ranges: readonly CellRange[],
  throwOnConflict: boolean,
): { index: SparseMergeIndex; conflicts: MergeConflict[] } {
  const index = new SparseMergeIndex()
  const conflicts: MergeConflict[] = []
  for (const raw of ranges) {
    const range = normalizeCellRange(raw)
    if (isSingleCell(range)) {
      continue
    }
    const conflict = index.findFirstConflict(range)
    if (conflict) {
      if (throwOnConflict) {
        throw new MergeOverlapError(conflict)
      }
      conflicts.push(conflict)
      continue
    }
    index.add(range)
  }
  return { index, conflicts }
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
  const { index, conflicts } = buildMergeIndex(ranges, false)
  return { ranges: index.ranges, conflicts }
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
  private readonly index: SparseMergeIndex

  constructor(ranges: readonly CellRange[] = []) {
    const { index } = buildMergeIndex(ranges, true)
    this.index = index
    this.ranges = index.ranges
  }

  get size(): number {
    return this.ranges.length
  }

  /** 覆盖 (col, row) 的合并区；未覆盖返回 null */
  rangeAt(col: number, row: number): CellRange | null {
    return this.index.rangeAt(col, row)
  }

  /** 查询与闭区间边界 [minCol..maxCol, minRow..maxRow] 相交的合并区列表 */
  rangesInBounds(
    minCol: number,
    minRow: number,
    maxCol: number,
    maxRow: number,
  ): readonly CellRange[] {
    return this.index.rangesInBounds(minCol, minRow, maxCol, maxRow)
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
