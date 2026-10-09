// xlsx worker 协议与快照重建的共享模块（主线程 xlsx.ts 与 xlsx.worker.ts 双侧共用；
// 只依赖 @infinitable/sheet 纯模型 API，无 DOM，可安全进 worker）。

import { Workbook, type SheetSnapshot } from '@infinitable/sheet'

/** 跨 worker 边界的一张表（表名 + 模型快照；快照为纯数据，可结构化克隆） */
export interface SheetSnapshotItem {
  name: string
  snapshot: SheetSnapshot
}

/** 导入方向 done 载荷（worker 侧已解析为快照；主线程按快照重建） */
export interface ImportedSnapshotBook {
  sheets: SheetSnapshotItem[]
  activeIndex: number
}

export type XlsxWorkerRequest =
  | { kind: 'import'; requestId: number; buffer: ArrayBuffer }
  | { kind: 'export'; requestId: number; sheets: SheetSnapshotItem[]; activeIndex: number }

export type XlsxWorkerResponse =
  | { kind: 'done'; requestId: number; payload: ImportedSnapshotBook | Uint8Array }
  | { kind: 'error'; requestId: number; message: string }

/**
 * 按快照重建 Workbook（导入主线程侧与 worker 导出侧共用语义；公共 API 组合）：
 * 首表承接构造期 Sheet1（改名 + restore），其余逐表 addSheet + restore，末了对齐活跃表。
 */
export function workbookFromSnapshots(
  items: readonly SheetSnapshotItem[],
  activeIndex: number,
): Workbook {
  const workbook = new Workbook()
  items.forEach((item, index) => {
    if (index === 0) {
      if (item.name !== 'Sheet1' && item.name.trim() !== '') {
        workbook.renameSheet('Sheet1', item.name)
      }
      workbook.activeSheet.restore(item.snapshot)
      return
    }
    workbook.addSheet(item.name).restore(item.snapshot)
  })
  const active = workbook.getSheets()[Math.min(Math.max(activeIndex, 0), items.length - 1)]
  if (active && active !== workbook.activeSheet) {
    workbook.activateSheet(active.name)
  }
  return workbook
}
