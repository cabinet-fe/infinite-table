// 演示书装配束（@infinitable/sheet）：Workbook 多表模型 + 每表 SheetGrid 实例池。
// 容器铺满网格区（absolute inset 0，见 global.css .sheet-grid-instance），按表名惰性建实例；
// 切换 = 模型 activateSheet + 容器显隐 + grid.setVisible（LRU：隐藏只置脏，切回全量同步）。
// 结构变更（行列插删）引擎维度构造期固定 → 监听 structure-change 就地重建实例（含 undo/redo 回放）。
// xlsx 导入整本换书：adoptWorkbook 释放旧实例池后接管新 Workbook 并重挂事件。

import type { ListTable } from '@infinitable/core'

import {
  evaluate,
  formulaError,
  isFormulaError,
  isFormulaErrorCode,
  type FormulaError,
  type FormulaResolver,
  type ScalarValue,
} from '@infinitable/formulas'

import {
  SheetGrid,
  Workbook,
  type CellRange,
  type ResolveCellRenderer,
  type Sheet,
  type SheetGridContextMenuInfo,
} from '@infinitable/sheet'

import { bindSheetFillEvents } from './fill'
import { SHEET_COL_COUNT, SHEET_ROW_COUNT } from './constants'
import { createDemoWorkbook } from './workbook'

/** 求值结果（错误已转错误码文本；冒烟/控制台驱动面用） */
export type EvaluatedValue = number | string | boolean

/** 每实例接线钩子（mountSheet 注入：返回退订集合，随实例释放执行） */
export interface SheetBookHooks {
  /** 格内自定义渲染（sheet.ts 用：Sheet1 F1 示例图） */
  resolveCellRenderer?: (sheet: Sheet) => ResolveCellRenderer | undefined
  /** 右键菜单（SheetGrid 公共回调；React 菜单组件经 sheet.ts 转发注册） */
  onContextMenu?: (name: string, info: SheetGridContextMenuInfo) => void
  /** 实例创建后接线（编辑 toast 等）；返回退订函数 */
  onGridCreated?: (name: string, grid: SheetGrid, sheet: Sheet) => void | (() => void)
  /** 演示通知 */
  notify: (text: string, kind?: 'info' | 'warn') => void
}

export interface SheetBookBundle {
  /** 工作簿（表名即身份；改名/跨表引用由 Workbook 编排） */
  workbook: Workbook
  /** 活跃表名（无表为 null；演示区至少保有一表，仅类型完整起见） */
  activeName(): string
  /** 活跃表模型 */
  activeSheet(): Sheet
  /** 活跃引擎表实例（实例惰性创建，切表后可用） */
  activeTable(): ListTable
  /** 活跃 grid（同上） */
  activeGrid(): SheetGrid
  /** 按名取模型 */
  sheetOf(name: string): Sheet | undefined
  /** 按名取引擎表实例（不存在为 undefined） */
  tableOf(name: string): ListTable | undefined
  /** 按名取 grid 实例（未建为 undefined；行列尺寸同步等宿主写入用） */
  gridOf(name: string): SheetGrid | undefined
  /** 切换 sheet（建实例 + 容器显隐 + LRU 可见性） */
  switchTo(name: string): void
  /** 新建空白 sheet（名自动编号）；返回新表名 */
  createSheet(): string
  /** 删除非活跃 sheet；返回是否删除成功 */
  removeSheet(name: string): boolean
  /** 重命名（Workbook 校验：空名/重名拒绝；跨表引用随改名保持有效） */
  renameSheet(oldName: string, next: string): boolean
  /** 全部表名（tabs 渲染用） */
  ids(): string[]
  /** 表名 → 展示名（Workbook 管理名即展示名） */
  nameOf(name: string): string
  /** 当前活跃 sheet 临时求值（公式引擎；错误 → 错误码文本，不进缓存） */
  evaluateActive(formula: string): EvaluatedValue
  /** id → 容器（宿主布局用；smoke 断言 data-sheet-id） */
  containers: Map<string, HTMLElement>
  /** 书级变更事件（激活切换/增删/改名聚合；换书后自动重挂） */
  onBookChange(listener: () => void): () => void
  /** 整本接管（xlsx 导入重建）：释放实例池 → 接管新 Workbook → 切到活跃表 */
  adoptWorkbook(next: Workbook): void
  dispose(): void
}

export function createSheetBook(viewport: HTMLElement, hooks: SheetBookHooks): SheetBookBundle {
  let workbook = createDemoWorkbook()
  const containers = new Map<string, HTMLElement>()
  const grids = new Map<string, SheetGrid>()
  const gridDisposers = new Map<string, Array<() => void>>()
  const bookListeners = new Set<() => void>()
  /** 当前 Workbook 的结构监听退订（换书时重挂） */
  let offStructure: Array<() => void> = []

  const fireBookChange = (): void => {
    for (const listener of bookListeners) {
      listener()
    }
  }

  /** 每表结构变更监听：引擎维度构造期固定 → 就地重建实例（未建实例无需处理） */
  const bindStructureWatch = (): void => {
    for (const off of offStructure) {
      off()
    }
    offStructure = workbook.getSheets().map((sheet) =>
      sheet.on('structure-change', () => {
        if (grids.has(sheet.name)) {
          rebuildGrid(sheet.name)
        }
      }),
    )
  }

  /** 绑定 Workbook 三事件到书级聚合事件 */
  const bindWorkbookEvents = (): void => {
    for (const type of ['active-sheet-change', 'sheets-change', 'sheet-rename'] as const) {
      workbook.on(type, fireBookChange)
    }
  }
  bindWorkbookEvents()
  bindStructureWatch()

  const activeName = (): string => workbook.activeSheet.name

  /** 惰性建实例：容器 + SheetGrid（主题/滚轮/编辑/选区/填充拖拽均由 grid 内置）+ 演示层接线 */
  const ensureGrid = (name: string): SheetGrid => {
    const existing = grids.get(name)
    if (existing) {
      return existing
    }
    const sheet = workbook.getSheet(name)
    if (!sheet) {
      throw new Error(`sheet 不存在：${name}`)
    }
    const container = document.createElement('div')
    container.className = 'sheet-grid-instance'
    container.dataset.sheetId = name
    container.style.display = 'none'
    viewport.appendChild(container)
    containers.set(name, container)
    const grid = new SheetGrid({
      container,
      sheet,
      // 声明尺寸随模型（导入表可超出演示默认）；未声明表回落演示口径
      rows: sheet.rows > 0 ? sheet.rows : SHEET_ROW_COUNT,
      cols: sheet.cols > 0 ? sheet.cols : SHEET_COL_COUNT,
      width: viewport.clientWidth || 960,
      height: viewport.clientHeight || 420,
      resolveCellRenderer: hooks.resolveCellRenderer?.(sheet),
      onContextMenu: (info) => hooks.onContextMenu?.(name, info),
    })
    grids.set(name, grid)
    const disposers = [bindSheetFillEvents(grid, sheet, hooks.notify)]
    const external = hooks.onGridCreated?.(name, grid, sheet)
    if (typeof external === 'function') {
      disposers.push(external)
    }
    gridDisposers.set(name, disposers)
    return grid
  }

  const releaseGrid = (name: string): void => {
    for (const off of gridDisposers.get(name) ?? []) {
      off()
    }
    gridDisposers.delete(name)
    grids.get(name)?.release()
    grids.delete(name)
    containers.get(name)?.remove()
    containers.delete(name)
  }

  /** 就地重建实例（结构变更后引擎维度同步；容器复用，滚动/选区按模型重驱） */
  const rebuildGrid = (name: string): void => {
    const wasActive = name === activeName()
    releaseGrid(name)
    const grid = ensureGrid(name)
    if (wasActive) {
      grid.setVisible(true)
      containers.get(name)!.style.display = 'block'
    }
  }

  // ---- 求值驱动面：formulas evaluate + 模型读格（公式格读计算缓存；错误格还原错误标记） ----

  const readCellScalar = (
    sheet: Sheet | undefined,
    col: number,
    row: number,
  ): ScalarValue | FormulaError => {
    if (!sheet) {
      return formulaError('#REF!')
    }
    const data = sheet.getCellData({ row, col })
    if (!data || data.v == null) {
      return null
    }
    if (data.t === 'e') {
      return formulaError(isFormulaErrorCode(data.v) ? data.v : '#ERROR!')
    }
    return data.v
  }

  const resolverFor = (sheet: Sheet): FormulaResolver => ({
    cell: (ref) =>
      readCellScalar(
        ref.sheet === undefined ? sheet : workbook.getSheet(ref.sheet),
        ref.col,
        ref.row,
      ),
    range: (ref) => {
      const target = ref.sheet === undefined ? sheet : workbook.getSheet(ref.sheet)
      if (!target) {
        return [formulaError('#REF!')]
      }
      const range: CellRange = {
        start: { row: ref.startRow, col: ref.startCol },
        end: { row: ref.endRow, col: ref.endCol },
      }
      // 只迭代稀疏存在的格（空格不进数组，聚合语义由函数层决定）
      const values: unknown[] = []
      for (const [, data] of target.store.entriesInRange(range)) {
        values.push(
          data.t === 'e'
            ? formulaError(isFormulaErrorCode(data.v) ? data.v : '#ERROR!')
            : (data.v ?? null),
        )
      }
      return values
    },
  })

  return {
    get workbook(): Workbook {
      return workbook
    },
    activeName,
    activeSheet: () => workbook.activeSheet,
    activeTable: (): ListTable => {
      const grid = grids.get(activeName())
      if (!grid) {
        throw new Error('无活跃 sheet 实例（先 switchTo 建实例）')
      }
      return grid.getTable()
    },
    activeGrid: (): SheetGrid => {
      const grid = grids.get(activeName())
      if (!grid) {
        throw new Error('无活跃 sheet 实例（先 switchTo 建实例）')
      }
      return grid
    },
    sheetOf: (name) => workbook.getSheet(name),
    tableOf: (name) => grids.get(name)?.getTable(),
    gridOf: (name) => grids.get(name),
    switchTo(name: string) {
      ensureGrid(name)
      workbook.activateSheet(name)
      for (const [sheetName, container] of containers) {
        const active = sheetName === name
        container.style.display = active ? 'block' : 'none'
        grids.get(sheetName)?.setVisible(active)
      }
    },
    createSheet(): string {
      const sheet = workbook.addSheet(undefined, {
        rows: SHEET_ROW_COUNT,
        cols: SHEET_COL_COUNT,
      })
      return sheet.name
    },
    removeSheet(name: string): boolean {
      // 活跃表不允许删（tabs 语义：先切走再删，由 tabs 层保证）
      if (name === activeName() || !workbook.getSheet(name)) {
        return false
      }
      releaseGrid(name)
      return workbook.removeSheet(name)
    },
    renameSheet(oldName, next) {
      return workbook.renameSheet(oldName, next)
    },
    ids: () => workbook.getSheets().map((sheet) => sheet.name),
    nameOf: (name) => name,
    containers,
    evaluateActive(formula: string): EvaluatedValue {
      const body = formula.startsWith('=') ? formula.slice(1) : formula
      // 临时求值不落模型（不进缓存）；错误 → 错误码文本
      const result = evaluate(body, resolverFor(workbook.activeSheet))
      if (isFormulaError(result)) {
        return result.code
      }
      return result ?? 0
    },
    onBookChange(listener) {
      bookListeners.add(listener)
      return () => {
        bookListeners.delete(listener)
      }
    },
    adoptWorkbook(next: Workbook) {
      for (const name of Array.from(grids.keys())) {
        releaseGrid(name)
      }
      workbook = next
      bindWorkbookEvents()
      bindStructureWatch()
      // 切到导入活跃表（建实例）并广播一次（React 面板重读新表集）
      this.switchTo(next.activeSheet.name)
      fireBookChange()
    },
    dispose() {
      for (const name of Array.from(grids.keys())) {
        releaseGrid(name)
      }
      for (const off of offStructure) {
        off()
      }
      offStructure = []
      bookListeners.clear()
    },
  }
}
