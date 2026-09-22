// xlsx 导出引擎化：SheetStore（+ 合并区 / 行列尺寸 / 浮动图列表）→ hucre WriteSheet 的纯映射。
// 自 demo 装配层提升（apps/demo/src/sections/sheet/xlsx.ts 导出段）；取数走 Store 公开读取面：
// 值经 getDisplayValue、样式经 getEffectiveStyle（P5 模型侧读取 API，含基础/列级/格级合成）。
// 浮动图输入对齐 P6 快照 images 字段（FloatObject[]），锚定几何按当前行列尺寸换算（P7 口径，
// 见 floatObjectsToSheetImages）。产物为纯数据（可结构化克隆发 worker），hucre 为纯 ESM 零依赖。

import type { CellBorderEdge, CellStyle, FloatObject } from '@infinite-table/core'
import type {
  AlignmentStyle as HucreAlignment,
  BorderSide as HucreBorderSide,
  Cell as HucreCell,
  CellStyle as HucreCellStyle,
  CellValue as HucreCellValue,
  ColumnDef as HucreColumnDef,
  FontStyle as HucreFont,
  MergeRange as HucreMergeRange,
  RowDef as HucreRowDef,
  SheetImage as HucreSheetImage,
  WriteSheet as HucreWriteSheet,
} from 'hucre'

import type { SheetStore } from './sheet-store'

/** 数字格式（四类；导出映射为 Excel 格式码，对齐 ultra-ui NumFmt 语义） */
export type SheetNumFmt =
  | { kind: 'date' }
  | { kind: 'thousands' }
  | { kind: 'cnUpper' }
  | { kind: 'fixed'; digits: number }

/** 浮动图字节载荷（宿主解析：data: URL 解码等；无字节的对象不导出） */
export interface SheetImagePayload {
  data: Uint8Array
  type: HucreSheetImage['type']
}

/** 单表导出源：Store + 表名 + numFmt 查询 + 浮动图（列表与字节解析分离） */
export interface SheetExportSource {
  name: string
  store: SheetStore
  /** 格 numFmt 查询（缺省无格式码） */
  numFmt?: (col: number, row: number) => SheetNumFmt | undefined
  /** 浮动对象列表（P6 快照 images 字段同构：引擎 FloatObjectLayer 侧收集） */
  images?: readonly FloatObject[]
  /** 浮动图字节解析（kind === 'image' 且解析到字节才导出；src 形态由宿主决定） */
  imageData?: (object: FloatObject) => SheetImagePayload | undefined
}

/**
 * numFmt → xlsx 格式码（Excel 规范）：
 * date → `yyyy-mm-dd`；thousands → `#,##0.00`；cnUpper → `[DBNum2][$-804]G/通用格式`；
 * fixed(digits) → `0.00…`（0 位退化为 `0`）
 */
export function numFmtToXlsxCode(fmt: SheetNumFmt): string {
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

/** 像素 → Excel points（96dpi / 72pt 精确比 0.75） */
function pxToPt(px: number): number {
  return px * 0.75
}

/** 像素列宽 → Excel 字符宽（与导入 字符宽×7+5 对称） */
function pxToExcelColWidth(px: number): number {
  return Math.max(1, Math.round((px - 5) / 7))
}

/** 引擎边 → hucre 边（solid 按宽度收敛线型档位；dashed/dotted/double 同名直传） */
function edgeToHucre(edge: CellBorderEdge): HucreBorderSide {
  let style: HucreBorderSide['style']
  const lineStyle = edge.style ?? 'solid'
  if (lineStyle === 'solid') {
    style = edge.width <= 1 ? 'thin' : edge.width <= 2 ? 'medium' : 'thick'
  } else {
    style = lineStyle
  }
  return { style, color: { rgb: edge.color.replace(/^#/, '') } }
}

/** 引擎 CellStyle + numFmt → hucre 单元格样式 */
function styleToHucre(style: CellStyle | undefined, fmt: SheetNumFmt | undefined): HucreCellStyle {
  const hucre: HucreCellStyle = {}
  if (style?.background) {
    hucre.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { rgb: style.background.replace(/^#/, '') },
    }
  }
  const font: HucreFont = {}
  if (style?.color) font.color = { rgb: style.color.replace(/^#/, '') }
  if (style?.fontWeight !== undefined) {
    const weight = style.fontWeight
    if (weight === 'bold' || weight === 'bolder' || (typeof weight === 'number' && weight >= 600)) {
      font.bold = true
    }
  }
  if (style?.fontStyle === 'italic') font.italic = true
  if (style?.underline) font.underline = true
  if (style?.lineThrough) font.strikethrough = true
  if (typeof style?.fontSize === 'number') font.size = style.fontSize
  if (style?.fontFamily) font.name = style.fontFamily
  if (Object.keys(font).length > 0) hucre.font = font
  const border: NonNullable<HucreCellStyle['border']> = {}
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const edge = style?.border?.[side]
    if (edge) {
      border[side] = edgeToHucre(edge)
    }
  }
  if (Object.keys(border).length > 0) hucre.border = border
  const alignment: HucreAlignment = {}
  if (style?.textAlign) alignment.horizontal = style.textAlign
  if (style?.verticalAlign) {
    // 引擎 middle ↔ hucre/Excel center
    alignment.vertical = style.verticalAlign === 'middle' ? 'center' : style.verticalAlign
  }
  if (style?.textWrap) alignment.wrapText = true
  if (Object.keys(alignment).length > 0) hucre.alignment = alignment
  if (fmt) hucre.numFmt = numFmtToXlsxCode(fmt)
  return hucre
}

/**
 * 单表 → hucre WriteSheet（rows 稠密矩形承载普通值；公式/样式/numFmt 进 cells 覆盖表）。
 * 值/样式经 Store 读取面取数（getDisplayValue / getEffectiveStyle，P5）；
 * 合并 / 冻结 / 行列尺寸覆盖取 Store 状态；浮动图经锚定换算落 images。
 */
export function sheetToWriteSheet(source: SheetExportSource): HucreWriteSheet {
  const { store, numFmt } = source
  // 高水位：非空值 ∪ 有效样式 ∪ numFmt ∪ 合并 ∪ 行列尺寸覆盖（裁剪尾部空行空列）
  let maxRow = -1
  let maxCol = -1
  const bump = (col: number, row: number): void => {
    if (row > maxRow) maxRow = row
    if (col > maxCol) maxCol = col
  }
  interface CellEntry {
    value: unknown
    style: CellStyle | undefined
    fmt: SheetNumFmt | undefined
  }
  const entries = new Map<string, CellEntry>()
  for (let row = 0; row < store.getRowCount(); row++) {
    for (let col = 0; col < store.getColCount(); col++) {
      const value = store.getDisplayValue(col, row)
      const style = store.getEffectiveStyle(col, row)
      const fmt = numFmt?.(col, row)
      const hasStyle = style !== undefined && Object.keys(style).length > 0
      if (value == null && !hasStyle && fmt === undefined) {
        continue
      }
      entries.set(`${row},${col}`, { value, style: hasStyle ? style : undefined, fmt })
      bump(col, row)
    }
  }
  for (const range of store.getMerges()) {
    bump(range.endCol, range.endRow)
  }
  for (const row of store.getRowHeightOverrides().keys()) {
    bump(0, row)
  }
  for (const col of store.getColWidthOverrides().keys()) {
    bump(col, 0)
  }

  const rows: HucreCellValue[][] = Array.from({ length: maxRow + 1 }, () =>
    Array.from({ length: maxCol + 1 }, () => null),
  )
  const cells = new Map<string, Partial<HucreCell>>()
  for (const [key, entry] of entries) {
    const comma = key.indexOf(',')
    const row = Number(key.slice(0, comma))
    const col = Number(key.slice(comma + 1))
    const style = styleToHucre(entry.style, entry.fmt)
    const hasStyle = Object.keys(style).length > 0
    const raw = entry.value
    if (typeof raw === 'string' && raw.startsWith('=')) {
      // 公式格：存原文去 '='（hucre 契约）；rows 置 null，不写计算缓存（Excel 打开自动重算）
      const cell: Partial<HucreCell> = { formula: raw.slice(1) }
      if (hasStyle) cell.style = style
      cells.set(key, cell)
      continue
    }
    const value: HucreCellValue =
      typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean' ? raw : null
    if (value === null && !hasStyle) {
      continue
    }
    rows[row]![col] = value
    if (hasStyle) {
      cells.set(key, { value, style })
    }
  }

  const sheet: HucreWriteSheet = { name: source.name, rows }
  if (cells.size > 0) sheet.cells = cells
  const merges = store.getMerges()
  if (merges.length > 0) {
    sheet.merges = merges.map((range): HucreMergeRange => ({
      startRow: range.startRow,
      startCol: range.startCol,
      endRow: range.endRow,
      endCol: range.endCol,
    }))
  }
  const frozen = store.getFrozen()
  if (frozen.rowCount > 0 || frozen.colCount > 0) {
    sheet.freezePane = { rows: frozen.rowCount, columns: frozen.colCount }
  }
  if (store.getRowHeightOverrides().size > 0) {
    const rowDefs = new Map<number, HucreRowDef>()
    for (const [row, height] of store.getRowHeightOverrides()) {
      rowDefs.set(row, { height: pxToPt(height) })
    }
    sheet.rowDefs = rowDefs
  }
  if (store.getColWidthOverrides().size > 0) {
    const maxWidthCol = Math.max(...store.getColWidthOverrides().keys())
    const columns: HucreColumnDef[] = Array.from({ length: maxWidthCol + 1 }, () => ({}))
    for (const [col, width] of store.getColWidthOverrides()) {
      columns[col] = { width: pxToExcelColWidth(width) }
    }
    sheet.columns = columns
  }
  const images = floatObjectsToSheetImages(source)
  if (images.length > 0) {
    sheet.images = images
  }
  return sheet
}

/** 行列前缀和（绝对像素坐标：colX(col) = 该格左边界 x；越界取末格累积） */
function prefixSums(sizes: (index: number) => number, count: number): number[] {
  const offsets = Array.from({ length: count + 1 }, () => 0)
  for (let i = 0; i < count; i++) {
    offsets[i + 1] = offsets[i]! + sizes(i)
  }
  return offsets
}

/** 含住绝对坐标 x 的行列索引（恰好落在格边界取右侧格；出网格夹回末格） */
function indexAt(offsets: number[], x: number): number {
  let index = 0
  while (index < offsets.length - 2 && x >= offsets[index + 1]!) {
    index++
  }
  return index
}

/**
 * 浮动对象 → hucre SheetImage：锚定几何按当前行列尺寸换算（与 P7 FloatObjectLayer.layoutNode
 * 同口径——左上角 = from 格原点 + 像素偏移，尺寸 = 显式 size 或 from→to 格范围；本层为纯网格
 * 前缀和，无表头/滚动偏移）。绝对像素再落回含住格为 xlsx from/to 锚（hucre 锚无亚格偏移，
 * 偏移量折入取整）；渲染尺寸以显式像素宽高写入（96dpi，与 EMU 换算一致）。
 */
function floatObjectsToSheetImages(source: SheetExportSource): HucreSheetImage[] {
  const images = source.images ?? []
  if (images.length === 0 || !source.imageData) {
    return []
  }
  const store = source.store
  const colX = prefixSums((col) => store.getColWidth(col), store.getColCount())
  const rowY = prefixSums((row) => store.getRowHeight(row), store.getRowCount())
  const result: HucreSheetImage[] = []
  for (const object of images) {
    if (object.kind !== 'image') {
      continue
    }
    const payload = source.imageData(object)
    if (!payload) {
      continue
    }
    const { from, to, offsetX, offsetY } = object.anchor
    const x = colX[from.col]! + offsetX
    const y = rowY[from.row]! + offsetY
    const size = object.size
    const width = size ? size.width : Math.max(0, colX[to.col]! + store.getColWidth(to.col) - x)
    const height = size ? size.height : Math.max(0, rowY[to.row]! + store.getRowHeight(to.row) - y)
    result.push({
      data: payload.data,
      type: payload.type,
      anchor: {
        from: { row: indexAt(rowY, y), col: indexAt(colX, x) },
        to: { row: indexAt(rowY, y + height), col: indexAt(colX, x + width) },
      },
      width,
      height,
      ...(object.alt ? { altText: object.alt } : {}),
      ...(object.title ? { title: object.title } : {}),
    })
  }
  return result
}

/** data: URL MIME → xlsx 图片类型（五类之外不支持） */
const MIME_TO_IMAGE_TYPE: Record<string, SheetImagePayload['type']> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
}

/**
 * data: URL 图片 → 导出字节载荷（`data:image/*;base64,…` 形态；MIME 不在
 * png/jpeg/gif/svg/webp 五类、非 base64 或解析失败返回 undefined，该对象跳过导出）。
 */
export function decodeDataUrlImage(src: string | undefined): SheetImagePayload | undefined {
  if (!src || !src.startsWith('data:')) {
    return undefined
  }
  const comma = src.indexOf(',')
  if (comma < 0) {
    return undefined
  }
  const meta = src.slice(5, comma)
  const type = MIME_TO_IMAGE_TYPE[meta.split(';')[0]!.toLowerCase()]
  if (!type || !meta.includes(';base64')) {
    return undefined
  }
  try {
    const binary = atob(src.slice(comma + 1))
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      data[i] = binary.charCodeAt(i)
    }
    return { data, type }
  } catch {
    return undefined
  }
}
