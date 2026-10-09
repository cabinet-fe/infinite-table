// xlsx 导入导出装配层：重 CPU 段（zip 解压/压缩 + XML 解析/生成 + hucre↔模型映射）
// 在 xlsx.worker.ts（module worker）内完成，IO 全部走 @infinitable/sheet 公共面：
// - 导入：worker 内 importXlsx（字节 → 新 Workbook）→ 快照序列化跨线程回传；
//   主线程按快照重建 Workbook（xlsx-protocol.workbookFromSnapshots）交 bundle.adoptWorkbook 整本接管。
// - 导出：主线程收集各表快照（可结构化克隆）→ worker 内按快照重建临时 Workbook →
//   exportWorkbookXlsx 压缩出字节。
// 映射语义（值类型推断/公式原文/样式池/日期序列数/行列尺寸换算/浮动图字节）全部由
// packages/sheet 的 IO 承担，demo 不再自持第二份映射。协议与重建函数见 xlsx-protocol.ts。

import type { SheetBookBundle } from './book'
import {
  workbookFromSnapshots,
  type ImportedSnapshotBook,
  type SheetSnapshotItem,
  type XlsxWorkerRequest,
  type XlsxWorkerResponse,
} from './xlsx-protocol'

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

// ---- 导出：快照收集 → worker（重建临时 Workbook → exportWorkbookXlsx） ----

/** 导出为文件下载（与 downloadCSV 同款机制） */
function downloadXlsx(bytes: Uint8Array, filename: string): void {
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

// ---- 装配：工作簿级导出导入 ----

export interface XlsxHandle {
  /** 编程式导出整本（返回字节，不触发下载；冒烟断言用） */
  exportBook(): Promise<Uint8Array>
  /** 导出整本并触发下载 */
  downloadBook(): Promise<void>
  /** 编程式导入：xlsx 字节重建整个工作簿（冒烟/文件选择器共用） */
  importBuffer(buffer: ArrayBuffer | Uint8Array): Promise<void>
}

/** xlsx 句柄（按钮装配归工具栏；导入的文件选择器复用 csv.ts 的 input 分流） */
export function createXlsx(ctx: {
  bundle: SheetBookBundle
  notify: (text: string, kind?: 'info' | 'warn') => void
  /** 导入完成后的 UI 联动（tabs 重渲染 / 公式栏刷新） */
  onImported: () => void
}): XlsxHandle {
  const collectSnapshots = (): { sheets: SheetSnapshotItem[]; activeIndex: number } => {
    const sheets = ctx.bundle.workbook.getSheets()
    return {
      sheets: sheets.map((sheet) => ({ name: sheet.name, snapshot: sheet.snapshot() })),
      activeIndex: ctx.bundle.workbook.activeSheetIndex,
    }
  }

  const exportBook = async (): Promise<Uint8Array> => {
    const { sheets, activeIndex } = collectSnapshots()
    return requestWorker<Uint8Array>((requestId) => ({
      message: { kind: 'export', requestId, sheets, activeIndex },
      transfer: [],
    }))
  }

  return {
    exportBook,
    async downloadBook() {
      downloadXlsx(await exportBook(), 'sheet-export.xlsx')
    },
    async importBuffer(buffer) {
      // 归一为 ArrayBuffer 再让渡：整段覆盖的视图直取底层 buffer，部分视图拷出独立段
      const transferable =
        buffer instanceof Uint8Array
          ? buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
            ? (buffer.buffer as ArrayBuffer)
            : (buffer.slice().buffer as ArrayBuffer)
          : buffer
      let imported: ImportedSnapshotBook
      try {
        imported = await requestWorker<ImportedSnapshotBook>((requestId) => ({
          message: { kind: 'import', requestId, buffer: transferable },
          transfer: [transferable],
        }))
      } catch (error) {
        ctx.notify(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'warn')
        return
      }
      ctx.bundle.adoptWorkbook(workbookFromSnapshots(imported.sheets, imported.activeIndex))
      ctx.onImported()
      ctx.notify(`已导入 ${imported.sheets.length} 个工作表`)
    },
  }
}
