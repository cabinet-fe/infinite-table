// xlsx 纯数据映射层：hucre Workbook/Sheet ↔ 可结构化克隆的纯数据（PlainImported*）。
// 无 DOM、无 SheetStore 依赖——worker 与主线程共用：
// - worker 侧：readXlsx 后经本层收敛为 PlainImportedBook 回传（类实例与 hucre 内部对象不出 worker）；
// - 主线程侧：拿 PlainImportedSheet 批量回填 SheetStore（Store 是类实例，过不了结构化克隆边界）。
// 映射语义（移植自 ultra-ui sheet-core/src/core/io）详见 xlsx.ts 头注释。

import type {
  CellStyle as HucreCellStyle,
  Cell as HucreCell,
  Sheet as HucreSheet,
  Workbook as HucreWorkbook,
  WriteSheet as HucreWriteSheet,
} from 'hucre'
import { isDateFormat } from 'hucre'

import type { CellBorderEdge, CellStyle } from '@infinite-table/core'

import { SHEET_COL_COUNT, SHEET_ROW_COUNT } from './constants'
import type { NumFmt } from './format'

/** 导入固定走 cells Map（稀疏），不铺稠密 rows */
export const XLSX_READ_OPTIONS = { readStyles: true, sparse: true } as const

/** 行列数硬顶（SheetModel 稠密二维数组；防止 Excel 极限行列文件撑爆内存） */
export const MAX_IMPORT_ROWS = 2000
export const MAX_IMPORT_COLS = 256
/** 高水位外的可编辑余量（对标演示区空表尾） */
const ROW_MARGIN = 20
const COL_MARGIN = 5

// ---- 跨 worker 边界的数据形状（全部可结构化克隆：纯对象/数组/原始值） ----

/** 导入映射后的一格（值已解析为 Store 直存形态：公式补 '='、Date 转 1900 序列数、错误格转错误码文本） */
export interface PlainImportedCell {
  col: number
  row: number
  /** 已解析的 Store 值；缺省 = 纯样式格（不写值） */
  value?: string | number | boolean
  style?: CellStyle
  numFmt?: NumFmt
}

/** 导入映射后的一张表（尺寸已收敛，合并/冻结/行列尺寸已夹取到收敛尺寸内） */
export interface PlainImportedSheet {
  name: string
  rowCount: number
  colCount: number
  /** 稀疏格数组（只含有值或有样式/numFmt 的格） */
  cells: PlainImportedCell[]
  merges: Array<{ startCol: number; startRow: number; endCol: number; endRow: number }>
  frozenRows: number
  frozenCols: number
  rowHeights: Array<{ row: number; height: number }>
  colWidths: Array<{ col: number; width: number }>
}

/** 导入映射后的整本（worker import 请求的 done 载荷） */
export interface PlainImportedBook {
  sheets: PlainImportedSheet[]
  activeIndex: number
  /** 超出行列硬顶被丢弃的内容格数（0 = 无截断） */
  truncatedCells: number
}

// ---- worker 消息协议（postMessage 结构化克隆；字节走 transfer 零拷贝） ----

export type XlsxWorkerRequest =
  | { kind: 'import'; requestId: number; buffer: ArrayBuffer }
  | { kind: 'export'; requestId: number; sheets: HucreWriteSheet[]; activeIndex: number }

export type XlsxWorkerResponse =
  | { kind: 'done'; requestId: number; payload: PlainImportedBook | Uint8Array }
  | { kind: 'error'; requestId: number; message: string }

// ---- 导出方向：numFmt → xlsx 格式码 ----

/**
 * numFmt → xlsx 格式码（Excel 规范）：
 * date → `yyyy-mm-dd`；thousands → `#,##0.00`；cnUpper → `[DBNum2][$-804]G/通用格式`；
 * fixed(digits) → `0.00…`（0 位退化为 `0`）
 */
export function numFmtToXlsx(fmt: NumFmt): string {
  switch (fmt.kind) {
    case 'date':
      return 'yyyy-mm-dd'
    case 'thousands':
      return '#,##0.00'
    case 'cnUpper':
      return '[DBNum2][$-804]G/通用格式'
    case 'fixed': {
      const digits = Math.max(0, Math.trunc(fmt.digits))
      return digits > 0 ? `0.${'0'.repeat(digits)}` : '0'
    }
  }
}

// ---- 导入方向：hucre → 纯数据 ----

/** hucre 边框线型 → 引擎边（收敛到四线型 + 宽度；对齐 ultra-ui 收敛映射） */
function hucreEdgeToModel(style: string, color: string): CellBorderEdge {
  switch (style) {
    case 'medium':
      return { width: 2, color, style: 'solid' }
    case 'thick':
      return { width: 3, color, style: 'solid' }
    case 'double':
      return { width: 2, color, style: 'double' }
    case 'dotted':
    case 'dashDotDot':
    case 'mediumDashDotDot':
      return { width: 1, color, style: 'dotted' }
    case 'dashed':
    case 'mediumDashed':
    case 'dashDot':
    case 'mediumDashDot':
    case 'slantDashDot':
      return { width: 1, color, style: 'dashed' }
    default:
      // thin / hair / 未知线型 → 细实线
      return { width: 1, color, style: 'solid' }
  }
}

/**
 * Excel SpreadsheetML theme 索引 → hucre themeColors 槽位映射：
 * DrawingML <clrScheme> 顺序（hucre 提取顺序）：[dk1, lt1, dk2, lt2, accent1..accent6, hlink, folHlink]
 * SpreadsheetML <color theme="N"/>：0→槽位1(lt1)、1→槽位0(dk1)、2→槽位3(lt2)、3→槽位2(dk2)、4..11 直映
 */
const THEME_INDEX_TO_HUCRE_SLOT = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11] as const

/** 应用 Excel tint 色调调整（-1.0 ~ 1.0） */
function applyTint(hex: string, tint?: number): string {
  if (tint == null || tint === 0) return hex.startsWith('#') ? hex : `#${hex}`
  const raw = hex.startsWith('#') ? hex.slice(1) : hex
  const r = Number.parseInt(raw.slice(0, 2), 16)
  const g = Number.parseInt(raw.slice(2, 4), 16)
  const b = Number.parseInt(raw.slice(4, 6), 16)
  const transform = (channel: number): string => {
    const result = tint < 0 ? channel * (1 + tint) : channel + (255 - channel) * tint
    return Math.round(Math.min(255, Math.max(0, result)))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${transform(r)}${transform(g)}${transform(b)}`.toUpperCase()
}

/** hucre 颜色 → CSS 颜色（'#' + rgb；theme 经主题调色板及索引映射解析）；无法解析返回 undefined */
function resolveColor(
  color: { rgb?: string; theme?: number; tint?: number } | undefined,
  themeColors?: readonly string[],
): string | undefined {
  if (color?.rgb) {
    // xlsx 原生颜色为 AARRGGBB（8 位），去掉前导 alpha，统一归一为 '#RRGGBB'
    const rgb = color.rgb.length === 8 ? color.rgb.slice(2) : color.rgb
    return rgb.startsWith('#') ? rgb : `#${rgb}`
  }
  if (color?.theme != null && themeColors) {
    const slot =
      themeColors.length >= 4 && color.theme >= 0 && color.theme < THEME_INDEX_TO_HUCRE_SLOT.length
        ? THEME_INDEX_TO_HUCRE_SLOT[color.theme]!
        : color.theme
    const theme = themeColors[slot]
    if (theme) return applyTint(theme, color.tint)
  }
  return undefined
}

/**
 * xlsx 格式码 → numFmt（与导出 numFmtToXlsx 对称）。识别四类：
 * `[DBNum2…]` → cnUpper；日期/时间格式（hucre isDateFormat）→ date；
 * 纯 `#,##0[.00…]` → thousands；纯 `0` / `0.00…` → fixed（位数 = 0 个数）。
 * 其余（百分比/货币符号/科学计数等）忽略。
 */
export function xlsxNumFmtToModel(numFmt: string | undefined): NumFmt | undefined {
  if (!numFmt) return undefined
  if (numFmt.toUpperCase().includes('[DBNUM2')) return { kind: 'cnUpper' }
  if (isDateFormat(numFmt)) return { kind: 'date' }
  // 归一化第一区段（正数段）：剥离引号字面量 / […] 段 / 转义字符 / `_x` 与 `*x` 填充
  const section = numFmt.split(';')[0]!
  const normalized = section
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
  // 纯数字模式才算 thousands / fixed——带引号字面量 / 货币符号的不在四类内，忽略
  const plain = !/["$]/.test(section)
  if (plain && /^#,##0(?:\.0+)?$/.test(normalized)) return { kind: 'thousands' }
  const fixed = plain ? /^0(?:\.(0+))?$/.exec(normalized) : null
  if (fixed) return { kind: 'fixed', digits: fixed[1]?.length ?? 0 }
  return undefined
}

/** hucre 单元格样式 → 引擎 CellStyle + numFmt（theme 色经调色板解析；四类之外 numFmt 忽略） */
function hucreStyleToModel(
  style: HucreCellStyle,
  themeColors: readonly string[] | undefined,
): { style: CellStyle; numFmt: NumFmt | undefined } {
  const model: CellStyle = {}
  const fill = style.fill
  if (fill) {
    let rgb: string | undefined
    if (fill.type === 'pattern') {
      // solid 与带前景色的条纹 pattern 都取 fgColor；none/gray125 为 Excel 默认占位无视觉
      if (fill.pattern !== 'none' && fill.pattern !== 'gray125') {
        rgb = resolveColor(fill.fgColor, themeColors)
      }
    } else if (fill.stops.length > 0) {
      rgb = resolveColor(fill.stops[0]!.color, themeColors)
    }
    if (rgb) model.background = rgb
  }
  const font = style.font
  if (font) {
    const color = resolveColor(font.color, themeColors)
    if (color) model.color = color
    if (font.bold === true) model.fontWeight = 700
    if (font.italic === true) model.fontStyle = 'italic'
    // underline 非 false 即视为 true（含 "single" / "double" 等）
    if (font.underline !== undefined && font.underline !== false) model.underline = true
    if (font.strikethrough === true) model.lineThrough = true
    if (typeof font.size === 'number' && font.size > 0) model.fontSize = font.size
    if (font.name) model.fontFamily = font.name
  }
  const alignment = style.alignment
  if (alignment) {
    if (
      alignment.horizontal === 'left' ||
      alignment.horizontal === 'center' ||
      alignment.horizontal === 'right'
    ) {
      model.textAlign = alignment.horizontal
    }
    if (alignment.vertical === 'top' || alignment.vertical === 'bottom') {
      model.verticalAlign = alignment.vertical
    } else if (alignment.vertical === 'center') {
      model.verticalAlign = 'middle'
    }
    if (alignment.wrapText === true) model.textWrap = true
  }
  const border: NonNullable<CellStyle['border']> = {}
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const edge = style.border?.[side]
    if (!edge?.style) continue
    // Excel 未指定颜色时默认黑色边框
    border[side] = hucreEdgeToModel(edge.style, resolveColor(edge.color, themeColors) ?? '#000000')
  }
  if (Object.keys(border).length > 0) model.border = border
  return { style: model, numFmt: xlsxNumFmtToModel(style.numFmt) }
}

/** Date（hucre 读回的 UTC 午夜）→ 1900 系统 Excel 序列数（含 Lotus 伪闰日修正） */
export function dateToSerial1900(date: Date): number {
  const days = (date.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000
  // serial 60 = 伪 1900-02-29：1900-03-01（days=61）起的日期序列 = 天数差本身
  return days >= 61 ? days : days - 1
}

/** 有内容的格（值或公式；纯样式格不撑尺寸、出界不计截断） */
function isContentCell(cell: HucreCell): boolean {
  return Boolean(cell.formula) || (cell.value != null && cell.value !== '')
}

/** hucre Sheet → PlainImportedSheet（值/公式/样式/合并/冻结/行高列宽/numFmt；尺寸按高水位收敛） */
export function hucreSheetToPlain(
  source: HucreSheet,
  themeColors: readonly string[] | undefined,
  truncated: { count: number },
): PlainImportedSheet {
  const cells = source.cells ?? new Map<string, HucreCell>()
  const merges = source.merges ?? []

  // 高水位：有值/公式格 ∪ 合并区（纯样式格不撑尺寸）
  let maxUsedRow = -1
  let maxUsedCol = -1
  for (const [key, cell] of cells) {
    if (!isContentCell(cell)) continue
    const comma = key.indexOf(',')
    const row = Number(key.slice(0, comma))
    const col = Number(key.slice(comma + 1))
    if (row > maxUsedRow) maxUsedRow = row
    if (col > maxUsedCol) maxUsedCol = col
  }
  for (const m of merges) {
    if (m.endRow > maxUsedRow) maxUsedRow = m.endRow
    if (m.endCol > maxUsedCol) maxUsedCol = m.endCol
  }

  // 尺寸收敛：底线保持演示区可编辑余量，硬顶防 Excel 极限行列
  const rowCount = Math.min(MAX_IMPORT_ROWS, Math.max(SHEET_ROW_COUNT, maxUsedRow + 1 + ROW_MARGIN))
  const colCount = Math.min(MAX_IMPORT_COLS, Math.max(SHEET_COL_COUNT, maxUsedCol + 1 + COL_MARGIN))
  const inBounds = (col: number, row: number): boolean => col < colCount && row < rowCount

  const plainCells: PlainImportedCell[] = []
  for (const [key, cell] of cells) {
    const comma = key.indexOf(',')
    const row = Number(key.slice(0, comma))
    const col = Number(key.slice(comma + 1))
    if (!inBounds(col, row)) {
      if (isContentCell(cell)) truncated.count++
      continue
    }
    const plainCell: PlainImportedCell = { col, row }
    if (cell.style) {
      const mapped = hucreStyleToModel(cell.style, themeColors)
      if (Object.keys(mapped.style).length > 0) {
        plainCell.style = mapped.style
      }
      if (mapped.numFmt) {
        plainCell.numFmt = mapped.numFmt
      }
    }
    if (cell.formula) {
      // 公式：补 '=' 前缀（Store 语义；求值链天然生效）；hucre 公式原文不带 '='
      plainCell.value = `=${cell.formula.replace(/^=/, '')}`
    } else if (cell.value instanceof Date) {
      // 日期：转 1900 序列数 + date numFmt（round-trip 保真；显示链按 numFmt 渲染）
      plainCell.value = dateToSerial1900(cell.value)
      plainCell.numFmt = plainCell.numFmt ?? { kind: 'date' }
    } else if (cell.type === 'error') {
      // 错误格：存错误码文本（模型无错误类型，显示即原文）
      plainCell.value = typeof cell.value === 'string' ? cell.value : String(cell.value ?? '')
    } else if (cell.value != null && cell.value !== '') {
      plainCell.value = cell.value
    }
    if (plainCell.value !== undefined || plainCell.style || plainCell.numFmt) {
      plainCells.push(plainCell)
    }
  }

  // 合并区：夹取到收敛尺寸内（跨界合并裁到边界，完全出界丢弃）
  const plainMerges = merges.flatMap((m) => {
    if (m.startRow >= rowCount || m.startCol >= colCount) return []
    return [
      {
        startCol: m.startCol,
        startRow: m.startRow,
        endCol: Math.min(m.endCol, colCount - 1),
        endRow: Math.min(m.endRow, rowCount - 1),
      },
    ]
  })

  // 冻结（夹取到尺寸内；hucre FreezePane 字段可选）
  const freeze = source.freezePane
  const frozenRows = Math.min(freeze?.rows ?? 0, rowCount)
  const frozenCols = Math.min(freeze?.columns ?? 0, colCount)

  // 行高 pt×4/3（只应用到使用范围内；hucre 会物化整表 rowDefs）
  const rowHeights: PlainImportedSheet['rowHeights'] = []
  if (source.rowDefs) {
    for (const [row, def] of source.rowDefs) {
      if (row > maxUsedRow || row >= rowCount) continue
      if (def?.height) rowHeights.push({ row, height: Math.round((def.height * 4) / 3) })
    }
  }
  // 列宽 字符宽×7+5（与导出对称；只到收敛列数，hucre 会物化 16384 长 columns[]）
  const colWidths: PlainImportedSheet['colWidths'] = []
  if (source.columns) {
    const colEnd = Math.min(source.columns.length, colCount)
    for (let col = 0; col < colEnd; col++) {
      const def = source.columns[col]
      if (def?.width) {
        colWidths.push({ col, width: Math.round(def.width * 7 + 5) })
      }
    }
  }
  return {
    name: source.name,
    rowCount,
    colCount,
    cells: plainCells,
    merges: plainMerges,
    frozenRows,
    frozenCols,
    rowHeights,
    colWidths,
  }
}

/** hucre Workbook → PlainImportedBook（worker import 请求的出口映射；无表文件在此报错） */
export function workbookToPlainBook(workbook: HucreWorkbook): PlainImportedBook {
  const truncated = { count: 0 }
  const sheets = workbook.sheets.map((sheet) =>
    hucreSheetToPlain(sheet, workbook.themeColors, truncated),
  )
  if (sheets.length === 0) {
    throw new Error('文件不含任何工作表')
  }
  return {
    sheets,
    activeIndex: Math.min(workbook.activeSheet ?? 0, sheets.length - 1),
    truncatedCells: truncated.count,
  }
}
