// 右键菜单（简化集）：插入/删除行列、清空选区、合并/取消合并。
// onContextMenu 事件驱动；结构操作走 ops.ts（Store 语义），引擎运行时 API 随后同步。

import { normalizeRange, type ListTable } from '@infinite-table/core'

import type { SheetStore } from '@infinite-table/plugins'

import {
  clearValues,
  deleteCol,
  deleteRow,
  insertCol,
  insertRow,
  mergeBounds,
  refreshAllGrid,
  syncMergesToTable,
  unmergeAt,
} from './ops'

export interface ContextMenuHandle {
  destroy(): void
}

export function mountContextMenu(
  section: HTMLElement,
  ctx: { table: () => ListTable; store: () => SheetStore; status: HTMLElement },
): ContextMenuHandle {
  let menu: HTMLDivElement | null = null

  const close = (): void => {
    menu?.remove()
    menu = null
  }

  const addItem = (label: string, onClick: () => void): void => {
    if (!menu) {
      return
    }
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'sheet-menu-item'
    item.textContent = label
    item.addEventListener('click', () => {
      onClick()
      close()
    })
    menu.appendChild(item)
  }

  const unsubscribe = ctx.table().onContextMenu((event) => {
    close()
    const table = ctx.table()
    const store = ctx.store()
    const hit = event.cell
    const selection = normalizeRange(
      table.getSelectedCellRanges()[0] ?? {
        start: hit ?? { col: 0, row: 0 },
        end: hit ?? { col: 0, row: 0 },
      },
    )

    menu = document.createElement('div')
    menu.className = 'sheet-menu'
    section.appendChild(menu)

    addItem(`在行 ${selection.minRow + 1} 上插入行`, () => {
      insertRow(store, selection.minRow)
      syncMergesToTable(table, store, (error) => {
        ctx.status.textContent = `合并区同步被拒绝：${error.message}`
      })
      refreshAllGrid(table)
      ctx.status.textContent = `已在行 ${selection.minRow + 1} 上插入行`
    })
    addItem(`在列 ${String.fromCharCode(65 + selection.minCol)} 左侧插入列`, () => {
      insertCol(store, selection.minCol)
      syncMergesToTable(table, store, (error) => {
        ctx.status.textContent = `合并区同步被拒绝：${error.message}`
      })
      refreshAllGrid(table)
      ctx.status.textContent = `已在列 ${String.fromCharCode(65 + selection.minCol)} 左侧插入列`
    })
    addItem(`删除行 ${selection.minRow + 1}`, () => {
      deleteRow(store, selection.minRow)
      syncMergesToTable(table, store, (error) => {
        ctx.status.textContent = `合并区同步被拒绝：${error.message}`
      })
      refreshAllGrid(table)
      ctx.status.textContent = `已删除行 ${selection.minRow + 1}`
    })
    addItem(`删除列 ${String.fromCharCode(65 + selection.minCol)}`, () => {
      deleteCol(store, selection.minCol)
      syncMergesToTable(table, store, (error) => {
        ctx.status.textContent = `合并区同步被拒绝：${error.message}`
      })
      refreshAllGrid(table)
      ctx.status.textContent = `已删除列 ${String.fromCharCode(65 + selection.minCol)}`
    })
    addItem('清空选区内容', () => {
      clearValues(store, selection)
      refreshAllGrid(table)
      ctx.status.textContent = '已清空选区内容'
    })
    addItem('合并选区单元格', () => {
      try {
        table.setMergeCells([...store.getMerges(), mergeBounds(selection)])
        store.setMerges([...store.getMerges(), mergeBounds(selection)])
        ctx.status.textContent = '已合并选区'
      } catch (error) {
        ctx.status.textContent = `已拒绝：${(error as Error).message}`
      }
    })
    addItem('取消选区内合并', () => {
      const kept = unmergeAt(store, selection)
      table.setMergeCells([...kept])
      refreshAllGrid(table)
      ctx.status.textContent = '已取消选区内合并'
    })

    // 定位：场景事件坐标 + section 视口偏移，夹取在窗口内
    menu.style.position = 'fixed'
    const rect = section.getBoundingClientRect()
    const x = Math.min(rect.left + event.x, window.innerWidth - 190)
    const y = Math.min(rect.top + event.y, window.innerHeight - 280)
    menu.style.left = `${Math.max(0, x)}px`
    menu.style.top = `${Math.max(0, y)}px`
  })

  // 点击其它处关闭（菜单内 pointerdown 跳过，保证菜单项 click 先于关闭触发）
  const onDocClick = (domEvent: Event): void => {
    if (menu && domEvent.target instanceof Node && menu.contains(domEvent.target)) {
      return
    }
    close()
  }
  document.addEventListener('pointerdown', onDocClick)

  return {
    destroy() {
      unsubscribe()
      document.removeEventListener('pointerdown', onDocClick)
      close()
    },
  }
}
