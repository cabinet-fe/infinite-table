// 填充生成：对标 ultra-ui generateFill 的参考实现。
// 四类模式（按列/行独立推断）：数字线性序列（多格等差推断步长、单格步长 1）、
// Date 日期序列（按天）、文本尾数字序列（保留前导零）、复制兜底（非序列值循环复制）。
// 只依赖 core 公开入口；写路径由宿主提供（配合 batchUpdate 收敛），内核不产生写值行为。

import { normalizeRange } from '@infinite-table/core'
import type { FillDragEndEvent, ListTable, RangeBounds } from '@infinite-table/core'

/** 填充生成的单个目标格 */
export interface FillCell {
  col: number
  row: number
  value: unknown
}

/** 源值读取（一般来自 SheetStore.getValue） */
export type FillRead = (col: number, row: number) => unknown

const DAY_MS = 24 * 60 * 60 * 1000
/** 文本尾数字：结尾数字段（含前导零），前缀可为空 */
const TAIL_NUMBER = /^(.*?)(\d+)$/

/**
 * 生成填充值：target 为拖拽目标范围（含 anchor），填充区 = target − anchor。
 * 返回按行优先排列的目标格值（不含 anchor 区）；无扩展区返回空数组。
 */
export function generateFill(anchor: RangeBounds, target: RangeBounds, read: FillRead): FillCell[] {
  const cells: FillCell[] = []
  const downEnd = target.maxRow > anchor.maxRow ? target.maxRow : null
  const upStart = target.minRow < anchor.minRow ? target.minRow : null
  const rightEnd = target.maxCol > anchor.maxCol ? target.maxCol : null
  const leftStart = target.minCol < anchor.minCol ? target.minCol : null

  // 纵向扩展：按列独立推断（列源值取 anchor 行范围）
  if (downEnd !== null || upStart !== null) {
    for (let col = anchor.minCol; col <= anchor.maxCol; col++) {
      const sources = readSources(read, 'col', col, anchor)
      if (downEnd !== null) {
        pushSeries(cells, col, sources, anchor.maxRow + 1, downEnd, false)
      }
      if (upStart !== null) {
        pushSeries(cells, col, sources, upStart, anchor.minRow - 1, true)
      }
    }
  }
  // 横向扩展：按行独立推断（行源值取 anchor 列范围）
  if (rightEnd !== null || leftStart !== null) {
    for (let row = anchor.minRow; row <= anchor.maxRow; row++) {
      const sources = readSources(read, 'row', row, anchor)
      if (rightEnd !== null) {
        pushSeries(cells, null, sources, anchor.maxCol + 1, rightEnd, false, row)
      }
      if (leftStart !== null) {
        pushSeries(cells, null, sources, leftStart, anchor.minCol - 1, true, row)
      }
    }
  }
  return cells
}

/** 按填充方向收集 anchor 区内的源值序列（纵向取列、横向取行） */
function readSources(
  read: FillRead,
  axis: 'col' | 'row',
  index: number,
  anchor: RangeBounds,
): unknown[] {
  const sources: unknown[] = []
  const from = axis === 'col' ? anchor.minRow : anchor.minCol
  const to = axis === 'col' ? anchor.maxRow : anchor.maxCol
  for (let i = from; i <= to; i++) {
    sources.push(axis === 'col' ? read(index, i) : read(i, index))
  }
  return sources
}

/**
 * 沿单轴生成一段序列并收集目标格：
 * vertical 时 index 为列、start..end 为行区间；horizontal 时 index 为行、start..end 为列区间。
 * backward（向上/向左）时生成值按远离源方向逆推（最靠近源的目标格取第一步）。
 */
function pushSeries(
  cells: FillCell[],
  col: number | null,
  sources: unknown[],
  start: number,
  end: number,
  backward: boolean,
  row?: number,
): void {
  const count = end - start + 1
  // nextValues 已按「远离源 → 靠近源」的数组序返回（backward 时内部反转），
  // 与 start..end 的升序坐标一一对应
  const values = nextValues(sources, count, backward)
  for (let i = 0; i < count; i++) {
    const value = values[i]
    if (col === null) {
      cells.push({ col: start + i, row: row!, value })
    } else {
      cells.push({ col, row: start + i, value })
    }
  }
}

/**
 * 序列推断主入口：数字等差 → 日期按天 → 文本尾数字 → 复制循环。
 * 返回按「远离源 → 靠近源」数组序的 count 个值（backward 时内部反转对齐坐标升序）：
 * forward 以源序列末值为基向后延展；backward 以源序列首值为基向前逆推。
 */
function nextValues(sources: unknown[], count: number, backward: boolean): unknown[] {
  const n = sources.length

  // 数字等差：全部为 number 且相邻差恒定（单格步长 1）
  if (sources.every((v) => typeof v === 'number')) {
    const nums = sources as number[]
    const step = n >= 2 && hasConstantStep(nums) ? nums[1]! - nums[0]! : 1
    const values: number[] = []
    for (let i = 1; i <= count; i++) {
      values.push(backward ? nums[0]! - step * i : nums[n - 1]! + step * i)
    }
    return backward ? values.reverse() : values
  }

  // 日期序列：全部为 Date 且相邻差按天恒定（单格步长 1 天）
  if (sources.every((v) => v instanceof Date)) {
    const times = (sources as Date[]).map((date) => date.getTime())
    const stepDays =
      n >= 2 && hasConstantStep(times) ? Math.round((times[1]! - times[0]!) / DAY_MS) : 1
    const values: Date[] = []
    for (let i = 1; i <= count; i++) {
      const base = backward ? times[0]! : times[n - 1]!
      const offset = backward ? -stepDays * i : stepDays * i
      values.push(new Date(base + offset * DAY_MS))
    }
    return backward ? values.reverse() : values
  }

  // 文本尾数字：全部为以数字结尾的字符串（'Item 1' / 'A-07'），数字段等差且保留前导零
  const tails = sources.map((v) => (typeof v === 'string' ? TAIL_NUMBER.exec(v) : null))
  if (n > 0 && tails.every((match) => match !== null)) {
    const matches = tails as RegExpExecArray[]
    const width = matches[0]![2]!.length
    const prefix = matches[0]![1]!
    const nums = matches.map((match) => Number(match[2]))
    if (hasSamePrefix(matches, prefix) && (n === 1 || hasConstantStep(nums))) {
      const step = n >= 2 ? nums[1]! - nums[0]! : 1
      const values: string[] = []
      for (let i = 1; i <= count; i++) {
        const base = backward ? nums[0]! : nums[n - 1]!
        const next = backward ? base - step * i : base + step * i
        values.push(prefix + String(next).padStart(width, '0'))
      }
      return backward ? values.reverse() : values
    }
  }

  // 复制兜底：源值按块循环复制（forward 自首源起 a,b,a…；backward 自末源起 b,a…，反转后与坐标对齐）
  const values: unknown[] = []
  for (let i = 0; i < count; i++) {
    values.push(sources[backward ? n - 1 - (i % n) : i % n])
  }
  return backward ? values.reverse() : values
}

/** 相邻差是否全部恒定（长度 ≥2 才有意义） */
function hasConstantStep(nums: number[]): boolean {
  const step = nums[1]! - nums[0]!
  for (let i = 1; i < nums.length - 1; i++) {
    if (nums[i + 1]! - nums[i]! !== step) {
      return false
    }
  }
  return true
}

/** 文本尾数字序列要求前缀一致（'Item 1' 与 'A-2' 不构成序列） */
function hasSamePrefix(matches: RegExpExecArray[], prefix: string): boolean {
  return matches.every((match) => match[1] === prefix)
}

/** 空值判定：SheetStore/SheetModel 的空格（undefined/null）与空串都视为无数据 */
function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * 双击填充柄的自动填充目标（Excel 语义）：按锚定段相邻列（左邻优先、其次右邻）的
 * 连续数据块末行，把锚定段向下延展成新目标；相邻列在锚定段行范围内无数据、
 * 或数据块未越出锚定段底行时返回 null（无填充）。
 */
export function resolveAutoFillTarget(
  anchor: RangeBounds,
  read: FillRead,
  rowCount: number,
): RangeBounds | null {
  for (const refCol of [anchor.minCol - 1, anchor.maxCol + 1]) {
    if (refCol < 0) {
      continue
    }
    // 数据块与选区的接点：锚定段行范围内参考列第一个非空格
    let seed = -1
    for (let row = anchor.minRow; row <= anchor.maxRow; row++) {
      if (!isEmptyValue(read(refCol, row))) {
        seed = row
        break
      }
    }
    if (seed < 0) {
      continue
    }
    // 从接点向下扩到连续数据块末尾（越界读取天然为空，rowCount 夹取只是少扫空行）
    let endRow = seed
    while (endRow + 1 < rowCount && !isEmptyValue(read(refCol, endRow + 1))) {
      endRow++
    }
    if (endRow > anchor.maxRow) {
      return { minCol: anchor.minCol, minRow: anchor.minRow, maxCol: anchor.maxCol, maxRow: endRow }
    }
  }
  return null
}

/** 填充生成接线选项：read 一般取 SheetStore.getValue；write 内建议用 batchUpdate 收敛失效 */
export interface FillGenerationOptions {
  table: ListTable
  read: FillRead
  /** 生成值写入（宿主负责落 Store/模型并用 batchUpdate 收敛） */
  write: (cells: FillCell[], event: FillDragEndEvent) => void
  /** 自定义生成器（缺省 generateFill） */
  generate?: typeof generateFill
  /** 双击填充柄自动填充：提供行数即启用（按相邻列连续数据块末行向下填充） */
  autoComplete?: { rowCount: () => number }
}

/**
 * 接线填充柄拖拽结束事件：anchor 与 target 的差集区经 generateFill 生成后交给 write；
 * 写入后选区扩展到锚定段 ∪ 扩展区（对标 ultra-ui：填充完成选区跟随覆盖源区与新区）。
 * 提供 autoComplete 时同时接线双击填充柄（相邻数据块末行的向下自动填充）。
 * 返回退订函数。
 */
export function bindFillGeneration(options: FillGenerationOptions): () => void {
  const generate = options.generate ?? generateFill
  // 拖拽结束与双击自动填充共用的生成-写入-扩选主体（双击的 target 由相邻数据块解析）
  const applyFill = (anchor: RangeBounds, target: RangeBounds): void => {
    const cells = generate(anchor, target, options.read)
    if (cells.length === 0) {
      return
    }
    options.write(cells, { anchor, target })
    options.table.selectCells([
      {
        start: {
          col: Math.min(anchor.minCol, target.minCol),
          row: Math.min(anchor.minRow, target.minRow),
        },
        end: {
          col: Math.max(anchor.maxCol, target.maxCol),
          row: Math.max(anchor.maxRow, target.maxRow),
        },
      },
    ])
  }
  const offDragEnd = options.table.onFillDragEnd((event) => {
    applyFill(event.anchor, event.target)
  })
  const autoComplete = options.autoComplete
  if (!autoComplete) {
    return offDragEnd
  }
  const offDoubleClick = options.table.onFillHandleDoubleClick((event) => {
    const anchor = normalizeRange(event.range)
    const target = resolveAutoFillTarget(anchor, options.read, autoComplete.rowCount())
    if (target) {
      applyFill(anchor, target)
    }
  })
  return () => {
    offDragEnd()
    offDoubleClick()
  }
}
