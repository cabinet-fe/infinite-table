// SheetBook 装配：sheet 定义注册（Store + 每表 resolveCellStyle/公式显示闭包）、
// 容器 hostOptions 注入、活跃切换时的容器显隐与滚轮接线（DOM 呈现归宿主，
// 即「切换全量重挂」的宿主侧：引擎实例池化复用，容器按活跃 id 显隐）。

import type { ListTable, ListTableOptions } from '@infinite-table/core'

import { createFormulaDisplay, SheetBook, SheetStore, type SheetDef } from '@infinite-table/plugins'

import { attachWheel, resolveDpr } from '../../mount'

import { createMainStore, createSecondaryStore } from './store'
import { createStoreEvaluator } from './mini-eval'

export interface SheetBookBundle {
  book: SheetBook
  /** 当前活跃表（无活跃为 null） */
  activeTable: () => ListTable | null
  /** 当前活跃 Store */
  activeStore: () => SheetStore | null
  /** 切换 sheet（同时切换容器显隐） */
  switchTo: (id: string) => void
  /** 新建空白 sheet（id 自动编号）；返回新 id */
  createSheet: () => string
  /** 删除非活跃 sheet；返回是否删除成功 */
  removeSheet: (id: string) => boolean
  /** 全部 sheet id（tabs 渲染用） */
  ids: () => string[]
  /** id → 容器（宿主布局用） */
  containers: Map<string, HTMLElement>
  /** id → Store（调试句柄/冒烟用） */
  stores: Map<string, SheetStore>
  dispose: () => void
}

const TABLE_WIDTH = 840
const TABLE_HEIGHT = 420

export function createDemoBook(
  viewport: HTMLElement,
  tableOptions: Partial<ListTableOptions>,
): SheetBookBundle {
  const containers = new Map<string, HTMLElement>()
  const stores = new Map<string, SheetStore>()
  const wheels = new Map<string, () => void>()
  let counter = 0

  const book = new SheetBook({
    createHost: (def: SheetDef) => {
      const container = document.createElement('div')
      container.className = 'table-mount'
      container.style.width = `${TABLE_WIDTH}px`
      container.style.height = `${TABLE_HEIGHT}px`
      container.dataset.sheetId = def.id
      container.style.display = 'none'
      viewport.appendChild(container)
      containers.set(def.id, container)
      return { hostOptions: { container, dpr: resolveDpr() } }
    },
    tableOptions,
  })

  // 实例首次创建后接滚轮（每实例一次；切换复用不重复接线）
  book.onChange((event) => {
    if (!event.table || !event.activeId || !event.created || wheels.has(event.activeId)) {
      return
    }
    const container = containers.get(event.activeId)
    if (container) {
      wheels.set(event.activeId, attachWheel(container, event.table))
    }
  })

  /** 注册定义：样式 hook 与公式显示都闭包绑定自己的 Store */
  const registerWith = (id: string, store: SheetStore): void => {
    stores.set(id, store)
    const def: SheetDef = {
      id,
      store,
      options: {
        resolveCellStyle: (col, row) => store.getStyle(col, row) ?? null,
        resolveDisplayValue: createFormulaDisplay({
          evaluate: (formula) => createStoreEvaluator(store)(formula),
        }),
      },
    }
    book.register(def)
  }

  registerWith('sheet-1', createMainStore())
  registerWith('sheet-2', createSecondaryStore())

  return {
    book,
    activeTable: () => book.activeTable,
    activeStore: () => (book.activeId ? (stores.get(book.activeId) ?? null) : null),
    switchTo(id: string) {
      book.switchTo(id)
      // 容器显隐：活跃 sheet 显示、其余隐藏
      for (const [defId, container] of containers) {
        container.style.display = defId === id ? 'block' : 'none'
      }
    },
    createSheet() {
      counter += 1
      const id = `sheet-new-${counter}`
      registerWith(
        id,
        new SheetStore({ rowCount: 40, colCount: 8, defaultColWidth: 104, defaultRowHeight: 32 }),
      )
      return id
    },
    removeSheet(id: string) {
      // 活跃 sheet 不允许删（tabs 语义：先切走再删）
      if (id === book.activeId || !book.has(id)) {
        return false
      }
      containers.get(id)?.remove()
      containers.delete(id)
      stores.delete(id)
      wheels.get(id)?.()
      wheels.delete(id)
      book.remove(id)
      return true
    },
    ids: () => [...stores.keys()].filter((id) => book.has(id)),
    containers,
    stores,
    dispose() {
      for (const off of wheels.values()) {
        off()
      }
      book.dispose()
    },
  }
}
