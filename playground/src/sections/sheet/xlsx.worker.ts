/// <reference lib="webworker" />
// xlsx 重 CPU 段运行处（module worker，经结构化克隆与主线程通信）。
// 协议形状与快照重建函数见 xlsx-protocol.ts（type-only + 纯函数依赖，不拉主线程代码）。
// IO 全部走 @infinitable/sheet 公共面（本 worker 不直接碰 hucre）：
// - 导入：importXlsx（zip 解压 + XML 解析 + hucre→模型映射，全程 worker 线程）→ 各表快照回传；
// - 导出：按快照重建临时 Workbook → exportWorkbookXlsx 压缩出字节。
// 字节入参与导出结果走 transfer 零拷贝；快照为纯数据（可结构化克隆）。

import { exportWorkbookXlsx, importXlsx } from '@infinitable/sheet'

import {
  workbookFromSnapshots,
  type ImportedSnapshotBook,
  type XlsxWorkerRequest,
  type XlsxWorkerResponse,
} from './xlsx-protocol'

// webworker lib 下 self 类型为 WorkerGlobalScope（无 postMessage(transfer) 重载），收窄到专用全局
const scope = self as unknown as DedicatedWorkerGlobalScope

const post = (message: XlsxWorkerResponse, transfer: Transferable[] = []): void => {
  scope.postMessage(message, transfer)
}

scope.addEventListener('message', async (event: MessageEvent<XlsxWorkerRequest>) => {
  const request = event.data
  try {
    if (request.kind === 'import') {
      const workbook = await importXlsx(request.buffer)
      const payload: ImportedSnapshotBook = {
        sheets: workbook.getSheets().map((sheet) => ({
          name: sheet.name,
          snapshot: sheet.snapshot(),
        })),
        activeIndex: workbook.activeSheetIndex,
      }
      post({ kind: 'done', requestId: request.requestId, payload })
      return
    }
    const bytes = await exportWorkbookXlsx(
      workbookFromSnapshots(request.sheets, request.activeIndex),
    )
    post({ kind: 'done', requestId: request.requestId, payload: bytes }, [bytes.buffer])
  } catch (error) {
    post({
      kind: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
