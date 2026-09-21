/// <reference lib="webworker" />
// xlsx 重 CPU 段（zip 解压/压缩 + XML 解析/生成）运行处：module worker，经结构化克隆与主线程通信。
// 协议形状见 xlsx-mapping.ts（XlsxWorkerRequest/XlsxWorkerResponse）；
// 字节入参与导出结果走 transfer 零拷贝，纯数据载荷走结构化克隆（Map/普通对象可传，类实例不可传）。

import { readXlsx, writeXlsx } from 'hucre/xlsx'

import { workbookToPlainBook, XLSX_READ_OPTIONS } from './xlsx-mapping'
import type { XlsxWorkerRequest, XlsxWorkerResponse } from './xlsx-mapping'

// webworker lib 下 self 类型为 WorkerGlobalScope（无 postMessage(transfer) 重载），收窄到专用全局
const scope = self as unknown as DedicatedWorkerGlobalScope

const post = (message: XlsxWorkerResponse, transfer: Transferable[] = []): void => {
  scope.postMessage(message, transfer)
}

scope.addEventListener('message', (event: MessageEvent<XlsxWorkerRequest>) => {
  const request = event.data
  void (async (): Promise<void> => {
    try {
      if (request.kind === 'import') {
        const workbook = await readXlsx(request.buffer, XLSX_READ_OPTIONS)
        post({ kind: 'done', requestId: request.requestId, payload: workbookToPlainBook(workbook) })
      } else {
        const bytes = await writeXlsx({
          sheets: request.sheets,
          activeSheet: request.activeIndex,
        })
        // 字节结果零拷贝回传（transfer 后 worker 侧不再持有）
        post({ kind: 'done', requestId: request.requestId, payload: bytes }, [
          bytes.buffer as ArrayBuffer,
        ])
      }
    } catch (error) {
      post({
        kind: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })()
})
