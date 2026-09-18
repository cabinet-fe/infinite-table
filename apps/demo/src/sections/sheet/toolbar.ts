// 样式工具栏：按当前选区批量写 Store 格级样式（toggle 语义），batchUpdate + refreshCell 收敛。
// 覆盖面：加粗/斜体/下划线/删除线、对齐（左/中/右）、填充色板、全边框、清除格式。

import { normalizeRange, type CellStyle, type ListTable } from '@infinite-table/core'

import type { SheetStore } from '@infinite-table/plugins'

const PALETTE = ['#ffffff', '#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca'] as const

export interface ToolbarHandle {
  /** 编程式样式应用（冒烟驱动用）：对当前选区逐格套用片段 */
  applyFragment(fragment: CellStyle, mode: 'toggle' | 'set'): void
  /** 清除当前选区格式 */
  clearFormat(): void
  destroy(): void
}

export function mountToolbar(
  section: HTMLElement,
  ctx: { table: () => ListTable; store: () => SheetStore; status: HTMLElement },
): ToolbarHandle {
  const bar = document.createElement('div')
  bar.className = 'sheet-toolbar'
  section.appendChild(bar)

  const selectionBounds = () => {
    const range = ctx.table().getSelectedCellRanges()[0]
    if (!range) {
      return null
    }
    return normalizeRange(range)
  }

  const refreshSelection = (bounds: {
    minCol: number
    maxCol: number
    minRow: number
    maxRow: number
  }): void => {
    ctx.table().batchUpdate(() => {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
          ctx.table().refreshCell(col, row)
        }
      }
    })
  }

  /** 值相等判定：对象值（如 border）按结构比较（toggle 判定不依赖引用） */
  const sameValue = (a: unknown, b: unknown): boolean => {
    if (a === b) {
      return true
    }
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      return JSON.stringify(a) === JSON.stringify(b)
    }
    return false
  }

  /** 对选区逐格套用片段：mode=toggle 时若选区内全部已含同值属性则移除 */
  const applyFragment = (fragment: CellStyle, mode: 'toggle' | 'set'): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      ctx.status.textContent = '无选区'
      return
    }
    const key = Object.keys(fragment)[0]
    const store = ctx.store()
    let allMatch = mode === 'toggle'
    if (mode === 'toggle') {
      for (let col = bounds.minCol; col <= bounds.maxCol && allMatch; col++) {
        for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
          const style = store.getStyle(col, row) as Record<string, unknown> | undefined
          if (!style || !sameValue(style[key!], fragment[key! as keyof CellStyle])) {
            allMatch = false
            break
          }
        }
      }
    }
    const removing = mode === 'toggle' && allMatch
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        const base = { ...store.getStyle(col, row) } as Record<string, unknown>
        if (removing) {
          delete base[key!]
        } else {
          Object.assign(base, fragment)
        }
        if (Object.keys(base).length === 0) {
          store.clearStyle(col, row)
        } else {
          store.setStyle(col, row, base as CellStyle)
        }
      }
    }
    refreshSelection(bounds)
    ctx.status.textContent = `${removing ? '已取消' : '已应用'} ${key}`
  }

  const addButton = (label: string, onClick: () => void): void => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sheet-toolbar-btn'
    button.textContent = label
    button.addEventListener('click', onClick)
    bar.appendChild(button)
    return button
  }

  addButton('B', () => applyFragment({ fontWeight: 700 }, 'toggle')).style.fontWeight = '700'
  addButton('I', () => applyFragment({ fontStyle: 'italic' }, 'toggle')).style.fontStyle = 'italic'
  addButton('U', () => applyFragment({ underline: true }, 'toggle'))
  addButton('S', () => applyFragment({ lineThrough: true }, 'toggle'))
  addButton('左', () => applyFragment({ textAlign: 'left' }, 'set'))
  addButton('中', () => applyFragment({ textAlign: 'center' }, 'set'))
  addButton('右', () => applyFragment({ textAlign: 'right' }, 'set'))
  addButton('边框', () => {
    const edge = { width: 1, color: '#3370ff', style: 'solid' as const }
    applyFragment({ border: { top: edge, right: edge, bottom: edge, left: edge } }, 'toggle')
  })
  for (const color of PALETTE) {
    const swatch = document.createElement('button')
    swatch.type = 'button'
    swatch.className = 'sheet-swatch'
    swatch.style.background = color
    swatch.title = `填充 ${color}`
    swatch.addEventListener('click', () => applyFragment({ background: color }, 'set'))
    bar.appendChild(swatch)
  }
  addButton('清除格式', () => clearFormat())

  const clearFormat = (): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      ctx.status.textContent = '无选区'
      return
    }
    const store = ctx.store()
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        store.clearStyle(col, row)
      }
    }
    refreshSelection(bounds)
    ctx.status.textContent = '已清除选区格式'
  }

  return {
    applyFragment,
    clearFormat,
    destroy() {
      bar.remove()
    },
  }
}
