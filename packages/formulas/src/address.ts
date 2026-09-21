// A1 地址系统（纯函数）：坐标统一 0 基（{ col: 0, row: 0 } 即 A1）。
// `$` 绝对标记在解析时保留（供宿主做填充/移位等引用改写；v1 求值不消费）。
// 跨表引用经可选 sheet 名表达：`Sheet2!A1`（裸表名）/ `'Sheet 2'!A1`（引号表名）。

/** 单元格引用（0 基坐标 + 绝对标记 + 可选跨表名） */
export interface CellRef {
  /** 跨表引用表名；缺省 = 公式所在表（由宿主 resolver 决定缺省表） */
  sheet?: string
  col: number
  row: number
  /** `$A1` 形态：列绝对 */
  colAbsolute: boolean
  /** `A$1` 形态：行绝对 */
  rowAbsolute: boolean
}

/** 区域引用（闭区间，经规范化：start ≤ end） */
export interface RangeRef {
  /** 跨表引用表名；缺省 = 公式所在表 */
  sheet?: string
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}

/** 0 基列号 → 列字母：0 → 'A'，25 → 'Z'，26 → 'AA' */
export function colLetters(col: number): string {
  if (!Number.isInteger(col) || col < 0) {
    throw new RangeError(`列号必须是非负整数: ${col}`)
  }
  let name = ''
  let value = col
  do {
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return name
}

/** 列字母 → 0 基列号：'A' → 0，'AA' → 26；非法返回 -1 */
export function parseColLetters(letters: string): number {
  if (!/^[A-Za-z]+$/.test(letters)) {
    return -1
  }
  let index = 0
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return index - 1
}

const CELL_REF_RE = /^(\$?)([A-Za-z]+)(\$?)([1-9]\d*)$/

/** 解析 A1 记法（兼容 `$A$1` 绝对引用）→ 单元格引用；非法返回 null */
export function parseCellRef(text: string): CellRef | null {
  const match = CELL_REF_RE.exec(text.trim())
  if (!match) {
    return null
  }
  const col = parseColLetters(match[2]!)
  if (col < 0) {
    return null
  }
  return {
    col,
    row: Number.parseInt(match[4]!, 10) - 1,
    colAbsolute: match[1] === '$',
    rowAbsolute: match[3] === '$',
  }
}

/** 表名格式化：裸表名安全字符直出，其余加单引号（`''` 转义字面单引号） */
export function formatSheetName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) {
    return name
  }
  return `'${name.replaceAll("'", "''")}'`
}

/** 单元格引用 → A1 记法（含 `$` 与跨表前缀） */
export function formatCellRef(ref: CellRef): string {
  const address = `${ref.colAbsolute ? '$' : ''}${colLetters(ref.col)}${ref.rowAbsolute ? '$' : ''}${ref.row + 1}`
  return ref.sheet === undefined ? address : `${formatSheetName(ref.sheet)}!${address}`
}

/** 由两个角点构造规范化区域（start ≤ end；sheet 取起点引用） */
export function createRangeRef(a: CellRef, b: CellRef): RangeRef {
  const ref: RangeRef = {
    startCol: Math.min(a.col, b.col),
    startRow: Math.min(a.row, b.row),
    endCol: Math.max(a.col, b.col),
    endRow: Math.max(a.row, b.row),
  }
  if (a.sheet !== undefined) {
    ref.sheet = a.sheet
  }
  return ref
}

/** 区域 → 记法：单格 → 'B2'，多格 → 'B2:D5'（含 `$` 与跨表前缀） */
export function formatRangeRef(ref: RangeRef): string {
  const prefix = ref.sheet === undefined ? '' : `${formatSheetName(ref.sheet)}!`
  const start = `${colLetters(ref.startCol)}${ref.startRow + 1}`
  if (ref.startCol === ref.endCol && ref.startRow === ref.endRow) {
    return prefix + start
  }
  return `${prefix}${start}:${colLetters(ref.endCol)}${ref.endRow + 1}`
}
