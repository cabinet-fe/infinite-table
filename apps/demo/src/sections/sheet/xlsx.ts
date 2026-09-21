// xlsx 导入导出（hucre@^1.1.0）：SheetStore + numFmt 侧车 ↔ hucre Workbook 的装配层。
// 分工（详见 xlsx-mapping.ts / xlsx.worker.ts 头注释）：
// - 重 CPU 段（zip 解压/压缩 + XML 解析/生成 + hucre↔纯数据映射）在 xlsx.worker.ts（module worker）；
//   hucre 为纯 ESM 零依赖（仅 TextEncoder/CompressionStream），可原样进 worker。
// - 主线程只留 Store/book/DOM 交互：导出时遍历 Store 产 WriteSheet 纯数据发 worker；
//   导入时收 PlainImportedSheet 批量回填新 SheetStore（Store 是类实例，过不了结构化克隆边界）。
// 映射语义移植自 ultra-ui sheet-core/src/core/io/{export,import}.ts（数据模型不同，只移植映射）：
// - 导出：值（公式格存原文去 '=' 进 formula，不写计算缓存——Excel 打开自动重算）；
//   CellStyle → hucre 样式（fill solid / font 粗斜删下字色字号字族 / align 水平垂直+wrap /
//   border 四边线型：solid 按宽度收敛 thin/medium/thick，dashed/dotted/double 直传）；
//   行高 px→pt（×0.75）、列宽 px→字符宽（(px-5)/7）；numFmt → Excel 格式码
// - 导入：值类型推断（Date → 1900 序列数 + date numFmt；错误格存错误码文本）；
//   公式补 '=' 前缀入 Store（求值链天然生效）；样式经 theme 调色板 + tint 解析；
//   边框线型收敛到引擎四线型 + 宽度；行高 pt×4/3、列宽 字符宽×7+5；numFmt 四类识别
// - 尺寸收敛：行/列数按 有值格∪合并 取高水位 + 可编辑余量（底线 40×26），硬顶 2000×256
//   （SheetModel 稠密存储，防止 Excel 极限行列撑爆内存）；超顶内容格计数丢弃并提示

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
  WriteSheet as HucreWriteSheet,
} from 'hucre'

import type { CellBorderEdge, CellStyle } from '@infinite-table/core'
import { SheetStore } from '@infinite-table/plugins'

import type { SheetBookBundle } from './book'
import type { NumFmt } from './format'
import type {
  PlainImportedBook,
  PlainImportedSheet,
  XlsxWorkerRequest,
  XlsxWorkerResponse,
} from './xlsx-mapping'
import { MAX_IMPORT_COLS, MAX_IMPORT_ROWS, numFmtToXlsx } from './xlsx-mapping'

// 纯函数自 xlsx-mapping 转出（向后兼容既有导出签名）
export { dateToSerial1900, numFmtToXlsx, xlsxNumFmtToModel } from './xlsx-mapping'

// ---- worker 客户端（惰性单例 + requestId 配对） ----

interface PendingRequest {
  resolve: (payload: never) => void
  reject: (error: Error) => void
}

let workerInstance: Worker | undefined
let nextRequestId = 1
const pendingRequests = new Map<number, PendingRequest>()

/**
 * 惰性单例 worker（首次导入/导出时创建）。
 * Worker 构造失败（如构建产物异常）不做主线程同步回退：直接抛出，
 * 由调用方 Promise reject 走既有失败 toast。
 */
function getXlsxWorker(): Worker {
  if (!workerInstance) {
    const worker = new Worker(new URL('./xlsx.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<XlsxWorkerResponse>) => {
      const response = event.data
      const pending = pendingRequests.get(response.requestId)
      if (!pending) {
        return
      }
      pendingRequests.delete(response.requestId)
      if (response.kind === 'done') {
        pending.resolve(response.payload as never)
      } else {
        pending.reject(new Error(response.message))
      }
    })
    // worker 崩溃/消息反序列化失败：全部 pending reject，实例丢弃（下次调用重建）
    const failAll = (message: string): void => {
      const pendings = [...pendingRequests.values()]
      pendingRequests.clear()
      for (const pending of pendings) {
        pending.reject(new Error(message))
      }
      worker.terminate()
      if (workerInstance === worker) {
        workerInstance = undefined
      }
    }
    worker.addEventListener('error', (event) => {
      failAll(event.message || 'xlsx worker 运行错误')
    })
    worker.addEventListener('messageerror', () => {
      failAll('xlsx worker 消息反序列化失败')
    })
    workerInstance = worker
  }
  return workerInstance
}

function requestWorker<T>(
  build: (requestId: number) => { message: XlsxWorkerRequest; transfer: Transferable[] },
): Promise<T> {
  const worker = getXlsxWorker()
  const requestId = nextRequestId++
  const { message, transfer } = build(requestId)
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: resolve as PendingRequest['resolve'],
      reject,
    })
    try {
      worker.postMessage(message, transfer)
    } catch (error) {
      pendingRequests.delete(requestId)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

// ---- 导出：模型 → hucre（Store 遍历留主线程；WriteSheet 为纯数据，可结构化克隆发 worker） ----

/** 导出输入：一张表的 Store + 表名 + numFmt 查询 */
export interface XlsxSheetSource {
  name: string
  store: SheetStore
  numFmt: (col: number, row: number) => NumFmt | undefined
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
function styleToHucre(style: CellStyle | undefined, fmt: NumFmt | undefined): HucreCellStyle {
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
  if (fmt) hucre.numFmt = numFmtToXlsx(fmt)
  return hucre
}

/** 单表 → hucre WriteSheet（rows 稠密矩形承载普通值；公式/样式/numFmt 进 cells 覆盖表） */
function sheetToWriteSheet(source: XlsxSheetSource): HucreWriteSheet {
  const { store, numFmt } = source
  // 高水位：非空值 ∪ 样式 ∪ numFmt ∪ 合并 ∪ 行列尺寸覆盖（裁剪尾部空行空列）
  let maxRow = -1
  let maxCol = -1
  const bump = (col: number, row: number): void => {
    if (row > maxRow) maxRow = row
    if (col > maxCol) maxCol = col
  }
  interface CellEntry {
    value: unknown
    style: CellStyle | undefined
    fmt: NumFmt | undefined
  }
  const entries = new Map<string, CellEntry>()
  for (let row = 0; row < store.getRowCount(); row++) {
    for (let col = 0; col < store.getColCount(); col++) {
      const value = store.getValue(col, row)
      const style = store.getStyle(col, row)
      const fmt = numFmt(col, row)
      if (value == null && style === undefined && fmt === undefined) {
        continue
      }
      entries.set(`${row},${col}`, { value, style, fmt })
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
  return sheet
}

/** 整本导出为 xlsx 字节（表序 = 入参顺序，activeIndex 为打开时的活跃表；zip 压缩在 worker） */
export async function writeBookXlsx(
  sheets: readonly XlsxSheetSource[],
  activeIndex: number,
): Promise<Uint8Array> {
  const writeSheets = sheets.map((source) => sheetToWriteSheet(source))
  return requestWorker<Uint8Array>((requestId) => ({
    message: { kind: 'export', requestId, sheets: writeSheets, activeIndex },
    transfer: [],
  }))
}

/** 导出为文件下载（与 downloadCSV 同款机制） */
export function downloadXlsx(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

// ---- 导入：worker 纯数据 → Store ----

/** 导入结果的一张表（Store + numFmt 侧车表 + 表名） */
export interface ImportedSheet {
  name: string
  store: SheetStore
  numFmt: Map<string, NumFmt>
}

export interface ImportedBook {
  sheets: ImportedSheet[]
  activeIndex: number
  /** 超出行列硬顶被丢弃的内容格数（0 = 无截断） */
  truncatedCells: number
}

/** PlainImportedSheet → ImportedSheet（批量回填新 SheetStore + numFmt 侧车表） */
function plainSheetToImported(plain: PlainImportedSheet): ImportedSheet {
  const store = new SheetStore({
    rowCount: plain.rowCount,
    colCount: plain.colCount,
    defaultColWidth: 80,
    defaultRowHeight: 28,
  })
  const numFmt = new Map<string, NumFmt>()
  for (const cell of plain.cells) {
    if (cell.style) {
      store.setStyle(cell.col, cell.row, cell.style)
    }
    if (cell.value !== undefined) {
      store.setValue(cell.col, cell.row, cell.value)
    }
    if (cell.numFmt) {
      numFmt.set(`${cell.col},${cell.row}`, cell.numFmt)
    }
  }
  if (plain.merges.length > 0) {
    store.setMerges(plain.merges)
  }
  if (plain.frozenRows > 0 || plain.frozenCols > 0) {
    store.setFrozen({ colCount: plain.frozenCols, rowCount: plain.frozenRows })
  }
  for (const { row, height } of plain.rowHeights) {
    store.setRowHeight(row, height)
  }
  for (const { col, width } of plain.colWidths) {
    store.setColWidth(col, width)
  }
  return { name: plain.name, store, numFmt }
}

/**
 * xlsx 字节 → 整本导入结果（解压/解析在 worker；解析异常向上抛，由调用方转用户可读提示）。
 * 入参字节 transfer 给 worker（零拷贝），调用后入参 detached、不应复用。
 */
export async function readBookXlsx(buffer: ArrayBuffer | Uint8Array): Promise<ImportedBook> {
  // 归一为 ArrayBuffer 再让渡：整段覆盖的视图直取底层 buffer，部分视图拷出独立段
  const transferable =
    buffer instanceof Uint8Array
      ? buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
        ? (buffer.buffer as ArrayBuffer)
        : (buffer.slice().buffer as ArrayBuffer)
      : buffer
  const plain = await requestWorker<PlainImportedBook>((requestId) => ({
    message: { kind: 'import', requestId, buffer: transferable },
    transfer: [transferable],
  }))
  return {
    sheets: plain.sheets.map(plainSheetToImported),
    activeIndex: plain.activeIndex,
    truncatedCells: plain.truncatedCells,
  }
}

// ---- 装配：SheetBook 级导出导入 ----

export interface XlsxHandle {
  /** 编程式导出整本（返回字节，不触发下载；冒烟断言用） */
  exportBook(): Promise<Uint8Array>
  /** 导出整本并触发下载 */
  downloadBook(): Promise<void>
  /** 编程式导入：xlsx 字节重建整个 SheetBook（冒烟/文件选择器共用） */
  importBuffer(buffer: ArrayBuffer | Uint8Array): Promise<void>
}

/** xlsx 句柄（按钮装配归工具栏；导入的文件选择器复用 csv.ts 的 input 分流） */
export function createXlsx(ctx: {
  bundle: SheetBookBundle
  notify: (text: string, kind?: 'info' | 'warn') => void
  /** 导入完成后的 UI 联动（tabs 重渲染 / 公式栏刷新 / 全表刷新） */
  onImported: () => void
}): XlsxHandle {
  const collectSources = (): { sheets: XlsxSheetSource[]; activeIndex: number } => {
    const ids = ctx.bundle.ids()
    const sheets = ids.map((id) => ({
      name: ctx.bundle.nameOf(id),
      store: ctx.bundle.stores.get(id)!,
      numFmt: (col: number, row: number) => ctx.bundle.getNumFmt(id, col, row),
    }))
    const activeId = ctx.bundle.book.activeId
    return { sheets, activeIndex: Math.max(0, ids.indexOf(activeId ?? '')) }
  }

  const exportBook = async (): Promise<Uint8Array> => {
    const { sheets, activeIndex } = collectSources()
    return writeBookXlsx(sheets, activeIndex)
  }

  return {
    exportBook,
    async downloadBook() {
      downloadXlsx(await exportBook(), 'sheet-export.xlsx')
    },
    async importBuffer(buffer) {
      let parsed: ImportedBook
      try {
        parsed = await readBookXlsx(buffer)
      } catch (error) {
        ctx.notify(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'warn')
        return
      }
      // 重建 SheetBook：注册全部新表 → 切到源活跃表 → 移除旧表（活跃表需先切走才能删）
      const oldIds = ctx.bundle.ids()
      const newIds = parsed.sheets.map((sheet) =>
        ctx.bundle.registerSheet(sheet.store, { name: sheet.name, numFmt: sheet.numFmt }),
      )
      ctx.bundle.switchTo(newIds[parsed.activeIndex] ?? newIds[0]!)
      for (const id of oldIds) {
        ctx.bundle.removeSheet(id)
      }
      ctx.onImported()
      const truncated =
        parsed.truncatedCells > 0
          ? `；超出 ${MAX_IMPORT_ROWS}×${MAX_IMPORT_COLS} 上限，丢弃 ${parsed.truncatedCells} 格`
          : ''
      ctx.notify(`已导入 ${parsed.sheets.length} 个工作表${truncated}`)
    },
  }
}
