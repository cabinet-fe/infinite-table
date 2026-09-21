// 网格右键菜单（对标 ultra-ui sheet-context-menu 的三套形态）：
// 行号右键（上/下方插入行·数量输入、删除行、冻结到当前行）；列头右键（左/右侧插入列、删除列、冻结到当前列）；
// 正文右键（合并/取消合并、插入浮动图片）。落点在选区外时先选中该格/整行/整列。

import type { ListTable } from '@infinite-table/core'

import type { SheetStore } from '@infinite-table/plugins'

import { openFixedPopup } from './popup'
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
import { colLetters } from './formula-bar'
import type { NumFmt } from './format'

export interface ContextMenuHandle {
  destroy(): void
}

export function mountContextMenu(ctx: {
  table: () => ListTable
  store: () => SheetStore
  notify: (text: string, kind?: 'info' | 'warn') => void
  /** numFmt 侧车写路径（绑定活跃 sheet；fmt undefined = 清除）。格刷新由本模块触发 */
  setNumFmt: (col: number, row: number, fmt: NumFmt | undefined) => void
}): ContextMenuHandle {
  const unsubscribe = ctx.table().onContextMenu((event) => {
    const table = ctx.table()
    const store = ctx.store()
    const hit = event.cell
    // 命中分区：y 在列头带 → 列头菜单；x 在行号带 → 行号菜单；正文格 → 正文菜单
    const onColHeader = event.y < table.headerHeight && event.x >= table.rowHeaderWidth
    const onRowHeader = event.x < table.rowHeaderWidth && event.y >= table.headerHeight

    const colAtX = (x: number): number => {
      let local = x - table.rowHeaderWidth + table.getScrollLeft()
      for (let col = 0; col < store.getColCount(); col++) {
        local -= table.getColWidth(col)
        if (local < 0) {
          return col
        }
      }
      return store.getColCount() - 1
    }
    const rowAtY = (y: number): number => {
      let local = y - table.headerHeight + table.getScrollTop()
      for (let row = 0; row < store.getRowCount(); row++) {
        local -= table.getRowHeight(row)
        if (local < 0) {
          return row
        }
      }
      return store.getRowCount() - 1
    }

    const original = event.originalEvent
    const clientX = original instanceof MouseEvent ? original.clientX : event.x
    const clientY = original instanceof MouseEvent ? original.clientY : event.y

    const boundsOf = () => {
      const range = table.getSelectedCellRanges()[0]
      return range
        ? {
            minCol: Math.min(range.start.col, range.end.col),
            maxCol: Math.max(range.start.col, range.end.col),
            minRow: Math.min(range.start.row, range.end.row),
            maxRow: Math.max(range.start.row, range.end.row),
          }
        : null
    }

    // 结构操作封装（Store 平移 + 引擎合并区同步 + 全表刷新）
    const structural = (mutate: () => void, done: string): void => {
      mutate()
      syncMergesToTable(table, store, (error) =>
        ctx.notify(`合并区同步被拒绝：${error.message}`, 'warn'),
      )
      refreshAllGrid(table, store)
      ctx.notify(done)
    }
    const insertRowsAt = (at: number, count: number): void => {
      structural(() => {
        for (let index = 0; index < count; index++) {
          insertRow(store, at)
        }
      }, `已插入 ${count} 行`)
    }
    const insertColsAt = (at: number, count: number): void => {
      structural(() => {
        for (let index = 0; index < count; index++) {
          insertCol(store, at)
        }
      }, `已插入 ${count} 列`)
    }
    const applyFrozen = (next: { colCount?: number; rowCount?: number }): void => {
      const current = store.getFrozen()
      const merged = { ...current, ...next }
      const previous = { ...current }
      store.setFrozen(merged)
      try {
        table.setFrozenColCount(merged.colCount)
        table.setFrozenRowCount(merged.rowCount)
        ctx.notify(`冻结 ${merged.rowCount} 行 × ${merged.colCount} 列`)
      } catch (error) {
        store.setFrozen(previous)
        table.setFrozenColCount(previous.colCount)
        table.setFrozenRowCount(previous.rowCount)
        ctx.notify(`已拒绝：${(error as Error).message}（冻结数保持原状）`, 'warn')
      }
    }

    if (onRowHeader) {
      const row = rowAtY(event.y)
      // 落点在选区外：先选整行
      const bounds = boundsOf()
      if (!bounds || row < bounds.minRow || row > bounds.maxRow) {
        table.selectCells([{ start: { col: 0, row }, end: { col: store.getColCount() - 1, row } }])
      }
      openFixedPopup(clientX, clientY, {
        build: (el, close) => {
          el.classList.add('sheet-popup', 'sheet-popup--menu')
          el.append(
            countItem({
              label: '在上方插入',
              unit: '行',
              onConfirm: (count) => insertRowsAt(row, count),
              close,
            }),
            countItem({
              label: '在下方插入',
              unit: '行',
              onConfirm: (count) => insertRowsAt(row + 1, count),
              close,
            }),
            actionItem(`删除行 ${row + 1}`, () =>
              structural(() => deleteRow(store, row), `已删除行 ${row + 1}`),
            ),
            separator(),
            checkedItem(`冻结到当前行`, store.getFrozen().rowCount === row + 1, () =>
              applyFrozen({ rowCount: row + 1 }),
            ),
            actionItem(
              '取消冻结',
              () => applyFrozen({ rowCount: 0, colCount: 0 }),
              store.getFrozen().rowCount === 0 && store.getFrozen().colCount === 0,
            ),
          )
        },
      })
      return
    }

    if (onColHeader) {
      const col = colAtX(event.x)
      const bounds = boundsOf()
      if (!bounds || col < bounds.minCol || col > bounds.maxCol) {
        table.selectCells([{ start: { col, row: 0 }, end: { col, row: store.getRowCount() - 1 } }])
      }
      openFixedPopup(clientX, clientY, {
        build: (el, close) => {
          el.classList.add('sheet-popup', 'sheet-popup--menu')
          el.append(
            countItem({
              label: '在左侧插入',
              unit: '列',
              onConfirm: (count) => insertColsAt(col, count),
              close,
            }),
            countItem({
              label: '在右侧插入',
              unit: '列',
              onConfirm: (count) => insertColsAt(col + 1, count),
              close,
            }),
            actionItem(`删除列 ${colLetters(col)}`, () =>
              structural(() => deleteCol(store, col), `已删除列 ${colLetters(col)}`),
            ),
            separator(),
            checkedItem('冻结到当前列', store.getFrozen().colCount === col + 1, () =>
              applyFrozen({ colCount: col + 1 }),
            ),
            actionItem(
              '取消冻结',
              () => applyFrozen({ rowCount: 0, colCount: 0 }),
              store.getFrozen().rowCount === 0 && store.getFrozen().colCount === 0,
            ),
          )
        },
      })
      return
    }

    if (!hit) {
      return
    }
    const bounds = boundsOf()
    if (
      !bounds ||
      hit.col < bounds.minCol ||
      hit.col > bounds.maxCol ||
      hit.row < bounds.minRow ||
      hit.row > bounds.maxRow
    ) {
      table.selectCell(hit.col, hit.row)
    }
    const current = boundsOf()!
    openFixedPopup(clientX, clientY, {
      build: (el) => {
        el.classList.add('sheet-popup', 'sheet-popup--menu')
        const inMerge = store
          .getMerges()
          .some(
            (range) =>
              hit.col >= range.startCol &&
              hit.col <= range.endCol &&
              hit.row >= range.startRow &&
              hit.row <= range.endRow,
          )
        const single = current.minCol === current.maxCol && current.minRow === current.maxRow
        el.append(
          actionItem(
            '合并单元格',
            () => {
              try {
                table.setMergeCells([...store.getMerges(), mergeBounds(current)])
                store.setMerges([...store.getMerges(), mergeBounds(current)])
                ctx.notify('已合并选区')
              } catch (error) {
                ctx.notify(`已拒绝：${(error as Error).message}`, 'warn')
              }
            },
            single,
          ),
          actionItem(
            '取消合并单元格',
            () => {
              const kept = unmergeAt(store, current)
              table.setMergeCells([...kept])
              ctx.notify('已取消合并')
            },
            !inMerge,
          ),
          separator(),
          numFmtSubmenu(current, ctx, table),
          separator(),
          actionItem('插入图片', () => {
            const seq = (insertImageSeq.value += 1)
            table.floatObjects.add({
              id: `sheet-menu-img-${seq}`,
              kind: 'image',
              anchor: {
                from: { col: hit.col, row: hit.row },
                to: { col: hit.col + 2, row: hit.row + 2 },
                offsetX: 2,
                offsetY: 2,
              },
              src: `demo://sheet/insert-${seq}`,
              title: '插入图片',
            })
            ctx.notify('已插入图片')
          }),
          separator(),
          actionItem('清空内容', () => {
            clearValues(store, current)
            refreshAllGrid(table, store)
            ctx.notify('已清空选区内容')
          }),
        )
      },
    })
  })

  return {
    destroy() {
      unsubscribe()
    },
  }
}

/** 菜单项计数器（插入图片 id 序号） */
const insertImageSeq = { value: 0 }

// ---- 菜单项构建 ----

function actionItem(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'sheet-menu__item'
  item.textContent = label
  item.disabled = disabled
  item.addEventListener('click', onClick)
  return item
}

function checkedItem(label: string, checked: boolean, onClick: () => void): HTMLButtonElement {
  const item = actionItem(checked ? `✓ ${label}` : label, onClick)
  return item
}

function separator(): HTMLElement {
  const sep = document.createElement('div')
  sep.className = 'sheet-menu__separator'
  return sep
}

/** 数据格式项的统一写路径：选区逐格写 numFmt 侧车 + 选区刷新（同 setStyle 模式） */
function applyNumFmtToBounds(
  bounds: { minCol: number; maxCol: number; minRow: number; maxRow: number },
  fmt: NumFmt | undefined,
  ctx: {
    setNumFmt: (col: number, row: number, fmt: NumFmt | undefined) => void
    notify: (text: string, kind?: 'info' | 'warn') => void
  },
  table: ListTable,
  label: string,
): void {
  for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      ctx.setNumFmt(col, row, fmt)
    }
  }
  table.batchUpdate(() => {
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        table.refreshCell(col, row)
      }
    }
  })
  ctx.notify(label)
}

/**
 * 「设置数据格式」子菜单（对齐 ultra-ui 右键菜单项）：日期 / 千分位金额 / 大写金额 /
 * 小数位数 0–10 / 清除格式。弹层为全局单例，点击后子菜单在项右侧弹出、主菜单随之关闭。
 */
function numFmtSubmenu(
  bounds: { minCol: number; maxCol: number; minRow: number; maxRow: number },
  ctx: {
    setNumFmt: (col: number, row: number, fmt: NumFmt | undefined) => void
    notify: (text: string, kind?: 'info' | 'warn') => void
  },
  table: ListTable,
): HTMLElement {
  const item = actionItem('设置数据格式 ▸', () => {
    const rect = item.getBoundingClientRect()
    openFixedPopup(rect.right + 2, rect.top, {
      build: (el, close) => {
        el.classList.add('sheet-popup', 'sheet-popup--menu')
        const apply = (fmt: NumFmt | undefined, label: string): void => {
          applyNumFmtToBounds(bounds, fmt, ctx, table, label)
          close()
        }
        const items: HTMLElement[] = [
          actionItem('日期', () => apply({ kind: 'date' }, '已设置数据格式：日期')),
          actionItem('千分位金额', () =>
            apply({ kind: 'thousands' }, '已设置数据格式：千分位金额'),
          ),
          actionItem('大写金额', () => apply({ kind: 'cnUpper' }, '已设置数据格式：大写金额')),
          separator(),
        ]
        for (let digits = 0; digits <= 10; digits++) {
          const fmt: NumFmt = { kind: 'fixed', digits }
          items.push(
            actionItem(`小数位数 ${digits}`, () =>
              apply(fmt, `已设置数据格式：小数位数 ${digits}`),
            ),
          )
        }
        items.push(
          separator(),
          actionItem('清除格式', () => apply(undefined, '已清除数据格式')),
        )
        el.append(...items)
      },
    })
  })
  return item
}

/** 数量输入项：「在上方插入 [3] 行」——Enter 确认执行（keepOpen，不点外不关） */
function countItem(options: {
  label: string
  unit: string
  onConfirm: (count: number) => void
  close: () => void
}): HTMLElement {
  const item = document.createElement('div')
  item.className = 'sheet-menu__count'
  const label = document.createElement('span')
  label.textContent = options.label
  const input = document.createElement('input')
  input.type = 'number'
  input.className = 'sheet-menu__count-input'
  input.min = '1'
  input.max = '100'
  input.step = '1'
  input.value = '1'
  const unit = document.createElement('span')
  unit.textContent = options.unit
  item.append(label, input, unit)
  const confirm = (): void => {
    const count = Math.max(1, Math.min(100, Math.floor(Number(input.value) || 1)))
    options.close()
    options.onConfirm(count)
  }
  input.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      confirm()
    } else if (event.key === 'Escape') {
      options.close()
    }
  })
  item.addEventListener('click', (event) => {
    if (event.target === input) {
      return
    }
    input.focus()
    input.select()
  })
  return item
}
