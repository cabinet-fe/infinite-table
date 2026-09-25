// SheetBook 装配：sheet 定义注册（Store + 每表 resolveCellStyle/显示链闭包）、
// 容器 hostOptions 注入、活跃切换时的容器显隐与滚轮接线（DOM 呈现归宿主，
// 即「切换全量重挂」的宿主侧：引擎实例池化复用，容器按活跃 id 显隐）。
// 容器铺满网格区（absolute inset 0），尺寸由调用方测量网格区后经 tableOptions 传入。
// numFmt 走 demo 级侧车（每 sheet 一张稀疏 Map，key 同格 `${col},${row}`）：
// SheetStore 是 plugins 公共面不加字段；显示链在注册定义时闭包绑定本表 numFmt Map。
// 表名注册表（xlsx 导入沿用文件名；跨表引用解析按 id → 注册名 → 默认名匹配）。

import type { ListTable, ListTableOptions } from '@infinite-table/core'

import { colLetters, type SheetCellCoord } from '@infinite-table/formulas'
import { SheetBook, SheetStore, type SheetDef } from '@infinite-table/plugins'

import { attachWheel, resolveDpr } from '../../mount'

import { createMainStore, createSecondaryStore } from './store'
import { createSheetEvaluator } from './evaluator'
import { createSheetDisplay, type NumFmt } from './format'
import { SHEET_COL_COUNT, SHEET_ROW_COUNT } from './constants'

/** sheet id → 默认展示名：sheet-1 → Sheet1（tabs 未重命名/未注册名时的名字） */
export function defaultSheetName(id: string): string {
  return id.replace(/^sheet-(\d+)$/, 'Sheet$1')
}

/** 注册附加项：导入表名 / 导入的 numFmt 侧车表 */
export interface RegisterSheetOptions {
  /** 展示名（空则回落默认名；跨表引用按此名路由） */
  name?: string
  /** numFmt 侧车表（缺省新建空表；xlsx 导入传入解析结果） */
  numFmt?: Map<string, NumFmt>
}

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
  /** 注册外部构建的 Store 为新 sheet（xlsx 导入用）；返回新 id */
  registerSheet: (store: SheetStore, options?: RegisterSheetOptions) => string
  /** 删除非活跃 sheet；返回是否删除成功 */
  removeSheet: (id: string) => boolean
  /** 全部 sheet id（tabs 渲染用） */
  ids: () => string[]
  /** id → 展示名（注册名优先，回落默认名） */
  nameOf: (id: string) => string
  /** 读格 numFmt（侧车；未设置 undefined） */
  getNumFmt: (id: string, col: number, row: number) => NumFmt | undefined
  /** 写/清格 numFmt（fmt undefined = 清除）。只写侧车表，格刷新由调用方触发（同 setStyle 模式） */
  setNumFmt: (id: string, col: number, row: number, fmt: NumFmt | undefined) => void
  /** id → 容器（宿主布局用） */
  containers: Map<string, HTMLElement>
  /** id → Store（调试句柄/冒烟用） */
  stores: Map<string, SheetStore>
  /** 当前活跃 sheet 求值（冒烟/控制台驱动面；错误 → 错误码文本） */
  evaluateActive: (formula: string) => string | number | boolean
  /** 公式缓存全量标脏（sheet 改名等跨表名解析面变化时用） */
  invalidateFormulas: () => void
  dispose: () => void
}

export function createDemoBook(
  viewport: HTMLElement,
  tableOptions: Partial<ListTableOptions>,
): SheetBookBundle {
  const containers = new Map<string, HTMLElement>()
  const stores = new Map<string, SheetStore>()
  const wheels = new Map<string, () => void>()
  const storeWatchOffs = new Map<string, () => void>()
  /** numFmt 侧车：id → 稀疏 Map（key `${col},${row}`） */
  const numFmtMaps = new Map<string, Map<string, NumFmt>>()
  /** 表名注册表：id → 展示名（xlsx 导入沿用文件名；tabs 手动重命名不写入，不跟随跨表引用） */
  const names = new Map<string, string>()
  let counter = 2

  // 公式缓存失效走 evaluator 的依赖图脏标记（value 事件逐格通知），不再需要 book 级共享版本
  const evaluator = createSheetEvaluator({
    resolveSheet(name) {
      // 大小写不敏感匹配 id / 注册名 / 默认展示名（demo 简化：tabs 手动重命名不跟随跨表引用）
      const lower = name.toLowerCase()
      for (const [id, store] of stores) {
        if (
          id.toLowerCase() === lower ||
          defaultSheetName(id).toLowerCase() === lower ||
          names.get(id)?.toLowerCase() === lower
        ) {
          return { id, store }
        }
      }
      return null
    },
  })

  const book = new SheetBook({
    createHost: (def: SheetDef) => {
      const container = document.createElement('div')
      container.className = 'sheet-grid-instance'
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

  /** 列定义按 Store 列数生成（导入表可超过演示默认 26 列；标题 A..Z/AA.. 取 formulas colLetters） */
  const buildColumns = (store: SheetStore): NonNullable<ListTableOptions['columns']> =>
    Array.from({ length: store.getColCount() }, (_, col) => ({
      title: colLetters(col),
      width: 80,
      editor: 'text',
    }))

  /** 失效格 → 画布重绘：按所属 sheet 分组，在池内实例上批量局部刷新（批内失效合并一次提交；
   *  未建实例的 sheet 切回时经全量首绘取新值；隐藏容器实例照常重绘位图，切回即见新值） */
  const repaintInvalidated = (cells: readonly SheetCellCoord[]): void => {
    const bySheet = new Map<string, SheetCellCoord[]>()
    for (const cell of cells) {
      const list = bySheet.get(cell.sheet)
      if (list) {
        list.push(cell)
      } else {
        bySheet.set(cell.sheet, [cell])
      }
    }
    for (const [sheetId, list] of bySheet) {
      const table = book.get(sheetId)
      if (!table) {
        continue
      }
      table.batchUpdate(() => {
        for (const cell of list) {
          table.refreshCell(cell.col, cell.row)
        }
      })
    }
  }

  /** 注册定义：样式 hook 与显示链（公式求值 → numFmt 格式化）都闭包绑定自己的 Store；value 事件通知 evaluator 标脏 */
  const registerWith = (id: string, store: SheetStore, options?: RegisterSheetOptions): void => {
    stores.set(id, store)
    const numFmt = options?.numFmt ?? new Map<string, NumFmt>()
    numFmtMaps.set(id, numFmt)
    if (options?.name && options.name.trim() !== '') {
      names.set(id, options.name)
    }
    storeWatchOffs.set(
      id,
      store.onChange((event) => {
        // 只有值变更影响公式结果；样式/几何/冻结/合并不触碰公式缓存。
        // 值写路径统一汇聚点：编辑提交（引擎回写）/填充/查找替换/清空内容全部经
        // Store value 事件到达这里，依赖失效 + 画布重绘一次收口
        if (event.type === 'value' && event.col !== undefined && event.row !== undefined) {
          repaintInvalidated(evaluator.notifyValueChange(id, event.col, event.row))
        }
      }),
    )
    const def: SheetDef = {
      id,
      store,
      options: {
        columns: buildColumns(store),
        resolveCellStyle: (col, row) => store.getStyle(col, row) ?? null,
        resolveDisplayValue: createSheetDisplay({
          evaluate: evaluator.forSheet(id, store),
          numFmt: (col, row) => numFmt.get(`${col},${row}`),
        }),
      },
    }
    book.register(def)
  }

  registerWith('sheet-1', createMainStore())
  registerWith('sheet-2', createSecondaryStore())

  const registerSheet = (store: SheetStore, options?: RegisterSheetOptions): string => {
    counter += 1
    const id = `sheet-${counter}`
    registerWith(id, store, options)
    return id
  }

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
      return registerSheet(
        new SheetStore({
          rowCount: SHEET_ROW_COUNT,
          colCount: SHEET_COL_COUNT,
          defaultColWidth: 80,
          defaultRowHeight: 28,
        }),
      )
    },
    registerSheet,
    removeSheet(id: string) {
      // 活跃 sheet 不允许删（tabs 语义：先切走再删，由 tabs 层保证）
      if (id === book.activeId || !book.has(id)) {
        return false
      }
      containers.get(id)?.remove()
      containers.delete(id)
      stores.delete(id)
      numFmtMaps.delete(id)
      names.delete(id)
      storeWatchOffs.get(id)?.()
      storeWatchOffs.delete(id)
      wheels.get(id)?.()
      wheels.delete(id)
      evaluator.dropSheet(id) // 连带整表标脏其余表缓存（依赖方重算出 #REF!）
      book.remove(id)
      return true
    },
    ids: () => [...stores.keys()].filter((id) => book.has(id)),
    nameOf: (id: string) => names.get(id) ?? defaultSheetName(id),
    getNumFmt(id, col, row) {
      return numFmtMaps.get(id)?.get(`${col},${row}`)
    },
    setNumFmt(id, col, row, fmt) {
      const map = numFmtMaps.get(id)
      if (!map) {
        return
      }
      const key = `${col},${row}`
      if (fmt === undefined) {
        map.delete(key)
      } else {
        map.set(key, fmt)
      }
    },
    containers,
    stores,
    evaluateActive(formula: string) {
      const id = book.activeId
      const store = id ? stores.get(id) : undefined
      if (!id || !store) {
        return '#REF!'
      }
      return evaluator.evaluateIn(id, store, formula)
    },
    invalidateFormulas() {
      evaluator.invalidateAll()
    },
    dispose() {
      for (const off of wheels.values()) {
        off()
      }
      for (const off of storeWatchOffs.values()) {
        off()
      }
      book.dispose()
    },
  }
}
