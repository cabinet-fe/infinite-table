// CSV 导入导出：IO 收敛到 @infinitable/sheet（exportSheetCsv / importCsv），
// 本文件只留装配：导出下载、导入覆盖（值写经命令入 undo，视图刷新由模型事件联动）。
// 按钮装配归工具栏（本模块只提供编程式句柄与文件选择器）。

import { exportSheetCsv, importCsv, type Sheet } from '@infinitable/sheet'

/** 导出为文件下载；返回导出字符串（冒烟断言用） */
function downloadCsv(csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'sheet-export.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export interface CSVHandle {
  /** 编程式导出（返回 CSV 串并触发下载） */
  exportCurrent(): string
  /** 编程式导入（CSV 文本覆盖当前 sheet） */
  importText(csv: string): void
  /** 打开系统文件选择器（.csv） */
  openPicker(): void
  destroy(): void
}

/** CSV 句柄（按钮装配归工具栏；文件 input 随句柄生命周期；.xlsx 文件经 onXlsx 分流） */
export function createCSV(ctx: {
  sheet: () => Sheet
  notify: (text: string) => void
  /** 选中 .xlsx 文件时的分流回调（xlsx 导入由 xlsx.ts 承担） */
  onXlsx?: (file: File) => void
}): CSVHandle {
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept =
    '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  fileInput.style.display = 'none'
  document.body.appendChild(fileInput)

  const exportCurrent = (): string => {
    const csv = exportSheetCsv(ctx.sheet())
    downloadCsv(csv)
    return csv
  }
  const importText = (csv: string): void => {
    importCsv(csv, ctx.sheet())
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) {
      return
    }
    // 按扩展名分流：xlsx 走整本重建，csv 走文本覆盖
    if (/\.xlsx$/i.test(file.name)) {
      ctx.onXlsx?.(file)
      fileInput.value = ''
      return
    }
    const text = await file.text()
    importText(text)
    ctx.notify('已导入 CSV')
    fileInput.value = ''
  })

  return {
    exportCurrent,
    importText,
    openPicker: () => fileInput.click(),
    destroy: () => fileInput.remove(),
  }
}
