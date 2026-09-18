// 查找替换（简化）：查找下一个 → 选中命中格并滚动可见；替换全部 → 全表字符串值替换。

import type { ListTable } from '@infinite-table/core'

import type { SheetStore } from '@infinite-table/plugins'

export interface FindReplaceHandle {
  /** 从上次命中之后查找下一个包含关键字的格；命中返回坐标并选中滚动 */
  findNext(keyword: string): { col: number; row: number } | null
  /** 全表替换（仅字符串值），返回替换次数 */
  replaceAll(keyword: string, replacement: string): number
  destroy(): void
}

export function mountFindReplace(
  section: HTMLElement,
  ctx: { table: () => ListTable; store: () => SheetStore; status: HTMLElement },
): FindReplaceHandle {
  const bar = document.createElement('div')
  bar.className = 'find-bar'
  const keywordInput = document.createElement('input')
  keywordInput.type = 'text'
  keywordInput.className = 'find-input'
  keywordInput.placeholder = '查找关键字'
  const replaceInput = document.createElement('input')
  replaceInput.type = 'text'
  replaceInput.className = 'find-input'
  replaceInput.placeholder = '替换为'
  const findButton = document.createElement('button')
  findButton.type = 'button'
  findButton.textContent = '查找下一个'
  const replaceButton = document.createElement('button')
  replaceButton.type = 'button'
  replaceButton.textContent = '替换全部'
  bar.append(keywordInput, findButton, replaceInput, replaceButton)
  section.appendChild(bar)

  let cursor: { col: number; row: number } | null = null

  /** 全表扫描（行优先）；from 之后环形扫描 */
  const scan = (
    keyword: string,
    from: { col: number; row: number } | null,
  ): { col: number; row: number } | null => {
    const store = ctx.store()
    const cols = store.getColCount()
    const rows = store.getRowCount()
    const startIndex = from ? from.row * cols + from.col + 1 : 0
    const total = cols * rows
    for (let offset = 0; offset < total; offset++) {
      const index = (startIndex + offset) % total
      const col = index % cols
      const row = Math.floor(index / cols)
      const value = store.getValue(col, row)
      if (typeof value === 'string' && !value.startsWith('=') && value.includes(keyword)) {
        return { col, row }
      }
    }
    return null
  }

  const findNext = (keyword: string): { col: number; row: number } | null => {
    if (!keyword) {
      return null
    }
    const hit = scan(keyword, cursor)
    if (!hit) {
      // 环形回到起点再扫一次
      const wrapped = scan(keyword, null)
      if (!wrapped) {
        cursor = null
        return null
      }
      cursor = wrapped
      ctx.table().selectCell(wrapped.col, wrapped.row)
      ctx.table().scrollToCell(wrapped)
      return wrapped
    }
    cursor = hit
    ctx.table().selectCell(hit.col, hit.row)
    ctx.table().scrollToCell(hit)
    return hit
  }

  const replaceAll = (keyword: string, replacement: string): number => {
    if (!keyword) {
      return 0
    }
    const store = ctx.store()
    let count = 0
    const hits: Array<{ col: number; row: number; value: string }> = []
    for (let col = 0; col < store.getColCount(); col++) {
      for (let row = 0; row < store.getRowCount(); row++) {
        const value = store.getValue(col, row)
        if (typeof value === 'string' && !value.startsWith('=') && value.includes(keyword)) {
          hits.push({ col, row, value })
        }
      }
    }
    ctx.table().batchUpdate(() => {
      for (const hit of hits) {
        store.setValue(hit.col, hit.row, hit.value.split(keyword).join(replacement))
        ctx.table().refreshCell(hit.col, hit.row)
        count++
      }
    })
    return count
  }

  findButton.addEventListener('click', () => {
    const keyword = keywordInput.value
    const hit = findNext(keyword)
    ctx.status.textContent = hit ? `命中 (${hit.col},${hit.row})` : `未找到「${keyword}」`
  })
  replaceButton.addEventListener('click', () => {
    const count = replaceAll(keywordInput.value, replaceInput.value)
    ctx.status.textContent = `已替换 ${count} 处`
  })

  return { findNext, replaceAll, destroy: () => bar.remove() }
}
