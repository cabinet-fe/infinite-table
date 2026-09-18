// 选区双向同步控制器：表格选区 ↔ 外部模型（对标 ultra-ui GridSelectionController）。
// 表格 → 外部：onSelectionChange 驱动 apply；外部 → 表格：syncFromExternal 经
// applyExternalSelection 回流（引擎侧不广播，天然断开一路回环）；选区签名判重兜住宿主侧回环。

import type { ListTable, SelectionSnapshot } from '@infinite-table/core'

export interface SelectionSyncOptions {
  table: ListTable
  /** 表格选区变化 → 落外部模型（宿主写库/状态） */
  apply: (snapshot: SelectionSnapshot) => void
  /** 外部模型当前选区（syncFromExternal 时读取） */
  get: () => SelectionSnapshot
}

export interface SelectionSyncController {
  /** 外部模型选区变化时由宿主调用：回流表格（同签名零开销） */
  syncFromExternal(): void
  /** 当前已同步选区签名（宿主诊断用） */
  signature(): string
  /** 退订表格选区监听 */
  dispose(): void
}

function snapshotSignature(snapshot: SelectionSnapshot): string {
  return JSON.stringify({ ranges: snapshot.ranges, focus: snapshot.focus })
}

export function bindSelectionSync(options: SelectionSyncOptions): SelectionSyncController {
  let lastSignature = snapshotSignature(options.table.getSelection())

  const unsubscribe = options.table.onSelectionChange((snapshot) => {
    const signature = snapshotSignature(snapshot)
    if (signature === lastSignature) {
      return
    }
    lastSignature = signature
    options.apply(snapshot)
  })

  return {
    syncFromExternal() {
      const snapshot = options.get()
      const signature = snapshotSignature(snapshot)
      if (signature === lastSignature) {
        return
      }
      lastSignature = signature
      options.table.applyExternalSelection(snapshot)
    },
    signature: () => lastSignature,
    dispose: unsubscribe,
  }
}
