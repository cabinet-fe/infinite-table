// CSV 导入导出：导出当前 Store 值矩阵（RFC 4180 简化版：含逗号/引号/换行的格加引号，引号翻倍）；
// 导入解析覆盖当前 sheet 值（超出原维度的行/列按需利用空区，不扩维度——超出截断）。
// 按钮装配归工具栏（本模块只提供编程式句柄与文件选择器）。

import type { ListTable } from '@infinite-table/core'

import type { SheetStore } from '@infinite-table/plugins'

/** 值矩阵 → CSV 字符串 */
export function toCSV(store: SheetStore): string {
  const lines: string[] = []
  for (let row = 0; row < store.getRowCount(); row++) {
    const cells: string[] = []
    for (let col = 0; col < store.getColCount(); col++) {
      cells.push(escapeCSVCell(store.getValue(col, row)))
    }
    lines.push(cells.join(','))
  }
  // 去掉末尾连续空行（演示区大量空表尾）
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.join('\n')
}

function escapeCSVCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  if (/[",\n]/.test(text)) {
    return `"${text.split('"').join('""')}"`
  }
  return text
}

/** CSV 字符串 → 值写入 Store（从 (0,0) 起）；返回写入格数 */
export function fromCSV(store: SheetStore, csv: string): number {
  const rows = parseCSV(csv)
  let count = 0
  for (let row = 0; row < Math.min(rows.length, store.getRowCount()); row++) {
    const cells = rows[row]!
    for (let col = 0; col < Math.min(cells.length, store.getColCount()); col++) {
      const text = cells[col] ?? ''
      const value = text === '' ? null : coerce(text)
      store.setValue(col, row, value)
      count++
    }
  }
  return count
}

/** 数字串 → number，其余保留字符串 */
function coerce(text: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(text.trim())) {
    return Number(text)
  }
  return text
}

/** 简化 CSV 解析（引号/逗号/换行） */
function parseCSV(csv: string): string[][] {
  const rows: string[][] = [[]]
  let cell = ''
  let inQuotes = false
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index]!
    if (inQuotes) {
      if (char === '"') {
        if (csv[index + 1] === '"') {
          cell += '"'
          index++
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      rows[rows.length - 1]!.push(cell)
      cell = ''
    } else if (char === '\n') {
      rows[rows.length - 1]!.push(cell)
      cell = ''
      rows.push([])
    } else if (char === '\r') {
      // 忽略（\r\n 归一为 \n）
    } else {
      cell += char
    }
  }
  rows[rows.length - 1]!.push(cell)
  return rows
}

/** 导出为文件下载；返回导出字符串（冒烟断言用） */
export function downloadCSV(store: SheetStore, filename: string): string {
  const csv = toCSV(store)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return csv
}

/** 导入接线（覆盖 + 全表刷新）；文件选择由调用方装配 */
export function importCSV(table: ListTable, store: SheetStore, csv: string): number {
  const count = fromCSV(store, csv)
  table.batchUpdate(() => {
    for (let col = 0; col < store.getColCount(); col++) {
      for (let row = 0; row < store.getRowCount(); row++) {
        table.refreshCell(col, row)
      }
    }
  })
  return count
}

export interface CSVHandle {
  /** 编程式导出（返回 CSV 串并触发下载） */
  exportCurrent(): string
  /** 编程式导入（CSV 文本覆盖当前 sheet） */
  importText(csv: string): number
  /** 打开系统文件选择器（.csv） */
  openPicker(): void
  destroy(): void
}

/** CSV 句柄（按钮装配归工具栏；文件 input 随句柄生命周期；.xlsx 文件经 onXlsx 分流） */
export function createCSV(ctx: {
  table: () => ListTable
  store: () => SheetStore
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

  const exportCurrent = (): string => downloadCSV(ctx.store(), 'sheet-export.csv')
  const importText = (csv: string): number => importCSV(ctx.table(), ctx.store(), csv)

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) {
      return
    }
    // 按扩展名分流：xlsx 走 hucre 整本重建，csv 走文本覆盖
    if (/\.xlsx$/i.test(file.name)) {
      ctx.onXlsx?.(file)
      fileInput.value = ''
      return
    }
    const text = await file.text()
    const count = importText(text)
    ctx.notify(`已导入 ${count} 格`)
    fileInput.value = ''
  })

  return {
    exportCurrent,
    importText,
    openPicker: () => fileInput.click(),
    destroy: () => fileInput.remove(),
  }
}
