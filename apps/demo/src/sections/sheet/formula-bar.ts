// 公式栏：选中格值显示（公式格 = 原文）、输入提交写 Store、引擎编辑会话镜像、函数建议。
// 引擎编辑内容经容器内编辑器元素（textarea/input）input 事件逐字镜像（demo 级实现）。

import { normalizeRange, type ListTable } from '@infinite-table/core'

import type { SheetBookBundle } from './book'
import type { SheetStore } from '@infinite-table/plugins'

/** 公式栏可补全的函数（简化建议集合，与 mini 求值器能力一致） */
export const FORMULA_FUNCTIONS = ['SUM', 'AVERAGE', 'COUNT', 'MIN', 'MAX'] as const

export interface FormulaBarHandle {
  /** 选区/值变化后刷新显示 */
  refresh(): void
  destroy(): void
}

export function mountFormulaBar(
  section: HTMLElement,
  ctx: {
    table: () => ListTable
    store: () => SheetStore
    status: HTMLElement
    /** SheetBook：监听随活跃实例切换重挂 */
    bundle: SheetBookBundle
  },
): FormulaBarHandle {
  const bar = document.createElement('div')
  bar.className = 'formula-bar'
  const cellLabel = document.createElement('span')
  cellLabel.className = 'formula-cell'
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'formula-input'
  input.placeholder = '输入值或 = 公式（如 =SUM(D1:D2)）'
  const suggestions = document.createElement('div')
  suggestions.className = 'formula-suggestions'
  bar.append(cellLabel, input, suggestions)
  section.appendChild(bar)

  let mirroredEditor: HTMLTextAreaElement | HTMLInputElement | null = null
  let suspended = false

  /** 当前焦点格（选区首段锚点；无选区 null） */
  const focusCell = (): { col: number; row: number } | null => {
    const range = ctx.table().getSelectedCellRanges()[0]
    if (!range) {
      return null
    }
    const bounds = normalizeRange(range)
    return { col: bounds.minCol, row: bounds.minRow }
  }

  const renderSuggestions = (): void => {
    suggestions.textContent = ''
    const match = /=\s*([A-Za-z]*)$/.exec(input.value)
    if (!match) {
      return
    }
    const prefix = match[1]!.toUpperCase()
    for (const fn of FORMULA_FUNCTIONS) {
      if (prefix && !fn.startsWith(prefix)) {
        continue
      }
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'formula-suggestion'
      item.textContent = fn
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        input.value = input.value.replace(/=[A-Za-z]*$/, `=${fn}(`)
        suggestions.textContent = ''
        input.focus()
      })
      suggestions.appendChild(item)
    }
  }

  const refresh = (): void => {
    if (suspended) {
      return
    }
    const cell = focusCell()
    if (!cell) {
      cellLabel.textContent = '-'
      input.value = ''
      return
    }
    const label = `${String.fromCharCode(65 + cell.col)}${cell.row + 1}`
    cellLabel.textContent = label
    const raw = ctx.store().getValue(cell.col, cell.row)
    input.value = raw == null ? '' : String(raw)
    suggestions.textContent = ''
  }

  // 提交：写回 Store + 局部刷新
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cell = focusCell()
      if (!cell) {
        return
      }
      suspended = true
      ctx.store().setValue(cell.col, cell.row, input.value === '' ? null : input.value)
      ctx.table().refreshCell(cell.col, cell.row)
      suspended = false
      ctx.status.textContent = `${cellLabel.textContent} 已更新`
      suggestions.textContent = ''
      input.blur()
    } else if (e.key === 'Escape') {
      refresh()
      input.blur()
    }
  })
  input.addEventListener('input', renderSuggestions)

  // 引擎编辑会话镜像：开始时锁定显示、编辑器逐字镜像；结束后解锁刷新
  const onEditorInput = (): void => {
    if (mirroredEditor) {
      input.value = mirroredEditor.value
      renderSuggestions()
    }
  }

  /** 监听随活跃实例切换重挂（切 tab 后其余 sheet 的选区/编辑会话同样生效） */
  let boundTable: ListTable | null = null
  let bindings: Array<() => void> = []
  const bindTo = (table: ListTable): void => {
    if (table === boundTable) {
      return
    }
    for (const off of bindings) {
      off()
    }
    mirroredEditor?.removeEventListener('input', onEditorInput)
    mirroredEditor = null
    bindings = [
      table.onSelectionChange(() => refresh()),
      table.onEditStart((edit) => {
        suspended = true
        cellLabel.textContent = `${String.fromCharCode(65 + edit.col)}${edit.row + 1}`
        input.value = edit.initialValue == null ? '' : String(edit.initialValue)
        // 编辑器元素在表格容器内（demo 级镜像：监听其 input 事件）
        const editor = table.options.hostOptions?.container?.querySelector('textarea, input')
        if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
          mirroredEditor = editor
          editor.addEventListener('input', onEditorInput)
        }
      }),
      table.onEditEnd(() => {
        mirroredEditor?.removeEventListener('input', onEditorInput)
        mirroredEditor = null
        suspended = false
        refresh()
      }),
    ]
    boundTable = table
  }
  bindTo(ctx.table())
  const offBookChange = ctx.bundle.book.onChange((event) => {
    if (!event.table) {
      return
    }
    suspended = false
    bindTo(event.table)
    refresh()
  })

  refresh()

  return {
    refresh,
    destroy() {
      offBookChange()
      for (const off of bindings) {
        off()
      }
      bindings = []
      mirroredEditor?.removeEventListener('input', onEditorInput)
      bar.remove()
    },
  }
}
