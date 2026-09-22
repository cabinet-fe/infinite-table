// xlsx 导入导出装配层（hucre@^1.1.0）：SheetStore + numFmt 侧车 ↔ xlsx 字节。
// 导出映射走 `@infinite-table/plugins` 公开能力（sheetToWriteSheet：Store + 合并 / 行列尺寸 /
// 浮动图 → hucre WriteSheet 纯映射，值/样式经 P5 读取 API 取数）；本文件只留装配：
// - worker 客户端（惰性单例 + requestId 配对）与 book 级导出导入编排；
// - 浮动对象列表的引擎侧收集（实例层 onChange 维护，导出源注入）；
// - 导入回填（PlainImportedSheet → SheetStore + numFmt 侧车表）。
// 重 CPU 段（zip 解压/压缩 + XML 解析/生成）在 xlsx.worker.ts（module worker）：
// hucre 为纯 ESM 零依赖（仅 TextEncoder/CompressionStream），可原样进 worker；
// 导入方向的 hucre→纯数据映射为 demo 自用，内联在 worker（见该文件头注释）。
// 映射语义移植自 ultra-ui sheet-core/src/core/io/{export,import}.ts（数据模型不同，只移植映射）：
// - 导出：公式格存原文去 '='（Excel 打开自动重算）；行高 px→pt（×0.75）、列宽 px→字符宽（(px-5)/7）；
//   numFmt → Excel 格式码；浮动图锚定几何按当前行列尺寸换算（P7 口径）
// - 导入：值类型推断（Date → 1900 序列数 + date numFmt；错误格存错误码文本）；公式补 '=' 入 Store；
//   样式经 theme 调色板 + tint 解析；行高 pt×4/3、列宽 字符宽×7+5；numFmt 四类识别
// - 尺寸收敛：行/列数按 有值格∪合并 取高水位 + 可编辑余量（底线 40×26），硬顶 2000×256
//   （SheetModel 稠密存储，防止 Excel 极限行列撑爆内存）；超顶内容格计数丢弃并提示

import type { WriteSheet as HucreWriteSheet } from 'hucre'

import type { CellStyle, FloatObject, ListTable } from '@infinite-table/core'
import {
  decodeDataUrlImage,
  sheetToWriteSheet,
  SheetStore,
  type SheetExportSource,
  type SheetImagePayload,
} from '@infinite-table/plugins'

import type { SheetBookBundle } from './book'
import type { NumFmt } from './format'

/** 行列数硬顶（导入收敛；与 worker 内联映射的硬顶成对维护） */
const MAX_IMPORT_ROWS = 2000
const MAX_IMPORT_COLS = 256

// ---- 跨 worker 边界的数据形状（导入方向；全部可结构化克隆：纯对象/数组/原始值） ----

/** 导入映射后的一格（worker 侧已解析为 Store 直存形态：公式补 '='、Date 转 1900 序列数、错误格转错误码文本） */
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

// ---- 导出：模型 → hucre（映射走 plugins；WriteSheet 为纯数据，可结构化克隆发 worker） ----

/** 整本导出为 xlsx 字节（表序 = 入参顺序，activeIndex 为打开时的活跃表；zip 压缩在 worker） */
export async function writeBookXlsx(
  sheets: readonly SheetExportSource[],
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
  /** 每 sheet 浮动对象列表（引擎侧收集：实例层 onChange 维护；持活引用，update 原地生效） */
  const floatLists = new Map<string, FloatObject[]>()
  const watchFloatObjects = (id: string, table: ListTable): void => {
    const list: FloatObject[] = []
    floatLists.set(id, list)
    table.floatObjects.onChange((change) => {
      if (change.type === 'add') {
        list.push(change.object)
      } else if (change.type === 'remove') {
        const index = list.findIndex((object) => object.id === change.id)
        if (index >= 0) {
          list.splice(index, 1)
        }
      }
      // update 变更原地改对象（层内 Object.assign），列表持活引用无需维护
    })
  }
  // 既有实例补订（sheet-1 首建早于本装配，其后插入的浮动图仍被捕获）+ 后建实例经 book 事件订阅
  for (const id of ctx.bundle.ids()) {
    const table = ctx.bundle.book.get(id)
    if (table) {
      watchFloatObjects(id, table)
    }
  }
  ctx.bundle.book.onChange((event) => {
    if (event.table && event.activeId && event.created) {
      watchFloatObjects(event.activeId, event.table)
    }
  })

  /** 单表导出源（Store + numFmt 侧车 + 浮动图；图片字节自 data: URL 解码，非 data: 源跳过） */
  const toExportSource = (id: string): SheetExportSource => ({
    name: ctx.bundle.nameOf(id),
    store: ctx.bundle.stores.get(id)!,
    numFmt: (col: number, row: number) => ctx.bundle.getNumFmt(id, col, row),
    images: floatLists.get(id) ?? [],
    imageData: (object: FloatObject): SheetImagePayload | undefined =>
      decodeDataUrlImage(object.src),
  })

  const exportBook = async (): Promise<Uint8Array> => {
    const ids = ctx.bundle.ids()
    const activeId = ctx.bundle.book.activeId
    return writeBookXlsx(ids.map(toExportSource), Math.max(0, ids.indexOf(activeId ?? '')))
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
