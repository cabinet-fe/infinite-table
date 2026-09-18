// sheet 电子表格演示区：对齐 ultra-ui playground sheet 的功能面（UI 归下游，插件之上搭建）。
// SheetStore 为单一事实源（值/样式/尺寸/冻结/合并），样式经 resolveCellStyle hook 落引擎；
// 填充柄真实写值（bindFillGeneration + batchUpdate 收敛）、resize 持久化（Store）、
// 撤销栈（bindCellChangeUndo）、SheetBook 多 sheet 实例池 + tabs 切换、
// mini 公式求值器 + createFormulaDisplay 公式显示、excelKeymapPreset 键位预设。
// 样式矩阵 / \n 多行合并 / 格内图演示点保留。

import {
  EditorRegistry,
  normalizeRange,
  type ListTable,
  type RangeBounds,
  type SelectionRange,
  type ThemeOverride,
} from '@infinite-table/core'

import {
  bindCellChangeUndo,
  excelKeymapPreset,
  UndoStack,
  type SheetStore,
} from '@infinite-table/plugins'

import { addButton, addStatus, createSection, demoLoadImage } from '../mount'

import { mountChecklist } from './sheet/checklist'
import { createDemoBook, type SheetBookBundle } from './sheet/book'
import { mountCSV } from './sheet/csv'
import { mountContextMenu } from './sheet/context-menu'
import { mountFindReplace } from './sheet/find-replace'
import { bindStoreFill } from './sheet/fills'
import { mountFormulaBar } from './sheet/formula-bar'
import {
  deleteRow as deleteRowOp,
  insertRow as insertRowOp,
  refreshAllGrid,
  syncMergesToTable,
} from './sheet/ops'
import { bindResizePersistence } from './sheet/persist'
import { mountToolbar } from './sheet/toolbar'
import { evaluateFormula } from './sheet/mini-eval'
import {
  SHEET_FILL_SELECTION,
  SHEET_IMAGE_CELL,
  SHEET_MERGE_EXTRA_RANGE,
  SHEET_MERGE_RANGE,
} from './sheet/constants'

export {
  SHEET_COL_COUNT,
  SHEET_ROW_COUNT,
  SHEET_MERGE_RANGE,
  SHEET_MERGE_EXTRA_RANGE,
  SHEET_FILL_SELECTION,
  SHEET_IMAGE_CELL,
} from './sheet/constants'

/** 主题分区 token 演示：列头居中（行号列沿用 header 分区）+ 数据格基础字色 */
const SHEET_THEME: ThemeOverride = {
  header: { textAlign: 'center' },
  body: { color: '#334155' },
}

/** 列级样式演示：A 列行标签（覆盖主题分区 token，被 Store 按格样式覆盖） */
const LABEL_COLUMN_STYLE = { fontWeight: 600, color: '#646a73' }

function formatBounds(bounds: RangeBounds): string {
  return `(${bounds.minCol},${bounds.minRow})~(${bounds.maxCol},${bounds.maxRow})`
}

function formatSelectionRange(range: SelectionRange): string {
  return formatBounds(normalizeRange(range))
}

/** 冒烟/控制台驱动面（全部经公开 API 组合） */
export interface SheetDemoControls {
  formulaBar: ReturnType<typeof mountFormulaBar>
  toolbar: ReturnType<typeof mountToolbar>
  find: ReturnType<typeof mountFindReplace>
  csv: ReturnType<typeof mountCSV>
  insertRow: (at: number) => void
  deleteRow: (at: number) => void
  evaluate: (formula: string) => number
}

/** 调试句柄形态（SheetView 挂载时写入 window.__SHEET_DEMO__；句柄面只含公开 API） */
export interface SheetDemoHandle {
  /** 当前活跃表实例 */
  getTable: () => ListTable
  /** 当前活跃 Store */
  getStore: () => SheetStore
  /** UI 驱动面 */
  controls: SheetDemoControls
  /** SheetBook（多 sheet 注册/切换/事件） */
  book: SheetBookBundle['book']
  /** 切换 sheet */
  switchTo: (id: string) => void
  /** sheet id 列表 */
  ids: () => string[]
  /** 撤销/重做（值命令） */
  undo: () => void
  redo: () => void
  /** 关键查询 API 一次性快照（控制台 / 自动化断言用） */
  queries: () => {
    activeId: string | null
    frozen: { cols: number; rows: number }
    selection: ReturnType<ListTable['getSelectedCellRanges']>
    bodyVisible: ReturnType<ListTable['getBodyVisibleCellRange']>
    drawRange: ReturnType<ListTable['getDrawRange']>
    scroll: { left: number; top: number }
    headerLevels: number
    editing: boolean
    cellValue: (col: number, row: number) => unknown
    cellStyle: (col: number, row: number) => Record<string, unknown> | undefined
    colWidth: (col: number) => number
  }
}

declare global {
  interface Window {
    __SHEET_DEMO__?: SheetDemoHandle
  }
}

export interface SheetDemo {
  /** 当前活跃表实例（tabs 切换后指向新活跃实例） */
  readonly table: ListTable
  /** 当前活跃 Store */
  getStore: () => SheetStore
  /** SheetBook（多 sheet 状态） */
  getBook: () => SheetBookBundle['book']
  /** 装配束（切换/新建/删除/ids/containers/stores） */
  getBundle: () => SheetBookBundle
  /** 撤销栈（值命令） */
  getUndo: () => UndoStack
  /** UI 驱动面 */
  getControls: () => SheetDemoControls
  /** 资源释放（卸载时调用） */
  destroy: () => void
}

export function mountSheet(root: HTMLElement): SheetDemo {
  const section = createSection(
    root,
    'sheet 电子表格',
    '插件之上的完整 sheet 面：SheetStore 单一事实源（值/样式/尺寸/冻结/合并）、公式栏与公式显示、' +
      '样式工具栏、右键菜单、查找替换、CSV 导入导出、填充柄真实填充、resize 持久化、撤销重做、' +
      'SheetBook 多 sheet tabs、功能对照表；样式矩阵 / \\n 多行合并 / 格内图演示保留。',
  )

  // ---- tabs 栏 + 视口 ----
  const tabBar = document.createElement('div')
  tabBar.className = 'sheet-tabs'
  section.appendChild(tabBar)
  const viewport = document.createElement('div')
  viewport.className = 'sheet-viewport'
  section.appendChild(viewport)

  const registry = new EditorRegistry()
  registry.registerEditor('text', {})
  const status = addStatus(section, '就绪')

  // ---- SheetBook 装配 ----
  // resolveCellImage 经活跃 id 判定：格内示例图仅演示于 sheet-1 的 F1
  let bundleRef: SheetBookBundle | null = null
  const bundle = createDemoBook(viewport, {
    width: 840,
    height: 420,
    columns: Array.from({ length: 8 }, (_, col) => ({
      title: String.fromCharCode(65 + col),
      width: col === 0 ? 110 : 104,
      editor: 'text',
      style: col === 0 ? LABEL_COLUMN_STYLE : undefined,
    })),
    editorRegistry: registry,
    theme: SHEET_THEME,
    ...excelKeymapPreset,
    resolveCellImage: (col, row) =>
      bundleRef?.book.activeId === 'sheet-1' &&
      col === SHEET_IMAGE_CELL.col &&
      row === SHEET_IMAGE_CELL.row
        ? 'demo://sheet/cell-img'
        : null,
    imageServiceOptions: { loadImage: demoLoadImage },
  })
  bundleRef = bundle

  // ---- 每实例接线（创建时一次性绑定）：填充真实写值 / resize 持久化 / 撤销栈 ----
  const stack = new UndoStack(200)
  const teardowns = new Map<string, Array<() => void>>()
  bundle.book.onChange((event) => {
    if (!event.table || !event.created || !event.activeId) {
      return
    }
    const store = bundle.stores.get(event.activeId)
    if (!store) {
      return
    }
    const id = event.activeId
    const created = event.table
    // 容器可聚焦：键盘事件经冒泡进入容器监听
    const container = bundle.containers.get(id)
    if (container) {
      container.tabIndex = 0
      container.style.outline = 'none'
    }
    const offs = [
      bindStoreFill(created, store),
      bindResizePersistence(created, store),
      bindCellChangeUndo({ table: created, store, stack }),
    ]
    created.onCellChange((change) => {
      status.textContent = `编辑提交 (${change.col},${change.row})：${String(change.oldValue)} → ${String(change.newValue)}`
    })
    created.onFillHandleDown((fillEvent) => {
      status.textContent = `填充柄按下：选区段 ${formatSelectionRange(fillEvent.range)}`
    })
    created.onFillDragEnd((fillEvent) => {
      status.textContent = `填充生成：锚定 ${formatBounds(fillEvent.anchor)} → 写入 ${formatBounds(fillEvent.target)} 的扩展区`
    })
    // 预置选区（仅主 sheet 首建）：挂载即见填充柄方点
    if (id === 'sheet-1') {
      created.selectCells([...SHEET_FILL_SELECTION])
    }
    teardowns.set(id, offs)
  })

  // ---- tabs 渲染 ----
  const renderTabs = (): void => {
    tabBar.textContent = ''
    for (const id of bundle.ids()) {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.className = `sheet-tab${bundle.book.activeId === id ? ' active' : ''}`
      tab.textContent = id
      tab.addEventListener('click', () => {
        bundle.switchTo(id)
        renderTabs()
        controls.formulaBar.refresh()
        status.textContent = `已切换到 ${id}`
      })
      tabBar.appendChild(tab)
    }
    const addTab = document.createElement('button')
    addTab.type = 'button'
    addTab.className = 'sheet-tab add'
    addTab.textContent = '+ 新建'
    addTab.addEventListener('click', () => {
      const id = bundle.createSheet()
      bundle.switchTo(id)
      renderTabs()
      controls.formulaBar.refresh()
      status.textContent = `已新建 ${id}`
    })
    tabBar.appendChild(addTab)
    const removeTab = document.createElement('button')
    removeTab.type = 'button'
    removeTab.className = 'sheet-tab remove'
    removeTab.textContent = '删除非活跃'
    removeTab.addEventListener('click', () => {
      const active = bundle.book.activeId
      const target = bundle.ids().find((id) => id !== active)
      if (!target || !bundle.removeSheet(target)) {
        status.textContent = '无可用非活跃 sheet 可删'
        return
      }
      renderTabs()
      status.textContent = `已删除 ${target}`
    })
    tabBar.appendChild(removeTab)
  }

  // 首次切换（惰性创建 sheet-1 实例）+ tabs
  const switchAndRender = (id: string): void => {
    bundle.switchTo(id)
    renderTabs()
  }
  switchAndRender('sheet-1')

  const table = (): ListTable => {
    const active = bundle.activeTable()
    if (!active) {
      throw new Error('无活跃 sheet 实例')
    }
    return active
  }
  const store = (): SheetStore => {
    const active = bundle.activeStore()
    if (!active) {
      throw new Error('无活跃 sheet Store')
    }
    return active
  }

  // ---- UI 面：公式栏（tabs 上方）/ 工具栏 + 右键菜单（tabs 与视口之间）/ 查找替换 + CSV（视口下方） ----
  const topArea = document.createElement('div')
  section.insertBefore(topArea, tabBar)
  const formulaBar = mountFormulaBar(topArea, { table, store, status, bundle })

  const toolArea = document.createElement('div')
  section.insertBefore(toolArea, viewport)
  const toolbar = mountToolbar(toolArea, { table, store, status })
  const contextMenu = mountContextMenu(section, { table, store, status })

  const utilityArea = document.createElement('div')
  utilityArea.className = 'toolbar'
  section.appendChild(utilityArea)
  const find = mountFindReplace(utilityArea, { table, store, status })
  const csv = mountCSV(utilityArea, { table, store, status })

  /** 冒烟/控制台驱动面（全部经公开 API 组合） */
  const controls = {
    formulaBar,
    toolbar,
    find,
    csv,
    /** 结构操作：在第 at 行上方插入行（0 基） */
    insertRow: (at: number): void => {
      insertRowAt(at)
    },
    /** 结构操作：删除第 at 行（0 基） */
    deleteRow: (at: number): void => {
      deleteRowOp(store(), at)
      syncMergesToTable(table(), store(), (error) => {
        status.textContent = `合并区同步被拒绝：${error.message}`
      })
      refreshAllGrid(table())
      status.textContent = `已删除行 ${at + 1}`
    },
    /** 当前活跃 Store 求值（mini 求值器） */
    evaluate: (formula: string): number => evaluateWithStore(formula),
  }
  const insertRowAt = (at: number): void => {
    insertRowOp(store(), at)
    syncMergesToTable(table(), store(), (error) => {
      status.textContent = `合并区同步被拒绝：${error.message}`
    })
    refreshAllGrid(table())
    status.textContent = `已在行 ${at + 1} 上插入行`
  }
  const evaluateWithStore = (formula: string): number =>
    evaluateFormula(formula, (col, row) => store().getValue(col, row))

  // ---- 撤销 / 重做 ----
  addButton(section, '撤销（Ctrl+Z 同义）', () => {
    stack.undo()
    status.textContent = '已撤销'
  })
  addButton(section, '重做', () => {
    stack.redo()
    status.textContent = '已重做'
  })

  // ---- 冻结/合并面板（读写以 Store 为源） ----
  addButton(section, '冻结列 +1（0/1/2 循环）', () => {
    const current = store().getFrozen()
    const next = { ...current, colCount: (current.colCount + 1) % 3 }
    store().setFrozen(next)
    const t = table()
    try {
      t.setFrozenColCount(next.colCount)
      t.setFrozenRowCount(next.rowCount)
    } catch (error) {
      status.textContent = `已拒绝：${(error as Error).message}（冻结数保持原状）`
      store().setFrozen(current)
      t.setFrozenColCount(current.colCount)
      return
    }
    status.textContent = `冻结列数 → ${next.colCount}（冻结行数 ${next.rowCount}）`
  })
  addButton(section, '冻结行 +1（0/1/2 循环）', () => {
    const current = store().getFrozen()
    const next = { ...current, rowCount: (current.rowCount + 1) % 3 }
    store().setFrozen(next)
    const t = table()
    try {
      t.setFrozenColCount(next.colCount)
      t.setFrozenRowCount(next.rowCount)
    } catch (error) {
      status.textContent = `已拒绝：${(error as Error).message}（冻结数保持原状）`
      store().setFrozen(current)
      t.setFrozenRowCount(current.rowCount)
      return
    }
    status.textContent = `冻结行数 → ${next.rowCount}（冻结列数 ${next.colCount}）`
  })

  let mergesExpanded = false
  addButton(section, '合并区追加/还原（Store 为源）', () => {
    mergesExpanded = !mergesExpanded
    const merges = mergesExpanded
      ? [SHEET_MERGE_RANGE, SHEET_MERGE_EXTRA_RANGE]
      : [SHEET_MERGE_RANGE]
    store().setMerges(merges)
    table().setMergeCells([...merges])
    status.textContent = mergesExpanded ? '已追加合并区 G16:H17' : '已还原为单一合并区'
  })
  addButton(section, '尝试跨冻结边界的合并（应被拒绝）', () => {
    const t = table()
    const frozen = store().getFrozen()
    if (frozen.colCount === 0 && frozen.rowCount === 0) {
      status.textContent = '当前无冻结区，请先把冻结列/行调到非 0 再试'
      return
    }
    const range =
      frozen.colCount > 0
        ? { startCol: 0, startRow: 15, endCol: frozen.colCount, endRow: 16 }
        : { startCol: 5, startRow: 0, endCol: 6, endRow: frozen.rowCount }
    try {
      t.addMergeCell(range)
      status.textContent = '未拒绝？（不应出现）'
    } catch (error) {
      status.textContent = `已拒绝：${(error as Error).message}（合并区保持原状）`
    }
  })

  mountChecklist(section)

  return {
    get table() {
      return table()
    },
    getStore: store,
    getBook: () => bundle.book,
    getBundle: () => bundle,
    getUndo: () => stack,
    getControls: () => controls,
    destroy: () => {
      formulaBar.destroy()
      toolbar.destroy()
      contextMenu.destroy()
      find.destroy()
      csv.destroy()
      for (const offs of teardowns.values()) {
        for (const off of offs) {
          off()
        }
      }
      bundle.dispose()
    },
  }
}

/** 调试句柄装配（SheetView 与 App.vue 冒烟路径共用） */
export function createSheetHandle(demo: SheetDemo): SheetDemoHandle {
  return {
    getTable: () => demo.table,
    getStore: () => demo.getStore(),
    book: demo.getBook(),
    switchTo: (id) => demo.getBundle().switchTo(id),
    ids: () => demo.getBundle().ids(),
    undo: () => demo.getUndo().undo(),
    redo: () => demo.getUndo().redo(),
    controls: demo.getControls(),
    queries: () => {
      const table = demo.table
      const store = demo.getStore()
      return {
        activeId: demo.getBook().activeId,
        frozen: { cols: table.getFrozenColCount(), rows: table.getFrozenRowCount() },
        selection: table.getSelectedCellRanges(),
        bodyVisible: table.getBodyVisibleCellRange(),
        drawRange: table.getDrawRange(),
        scroll: { left: table.getScrollLeft(), top: table.getScrollTop() },
        headerLevels: table.getHeaderLevelCount(),
        editing: table.isEditing(),
        cellValue: (col, row) => store.getValue(col, row),
        cellStyle: (col, row) => store.getStyle(col, row) as Record<string, unknown> | undefined,
        colWidth: (col) => store.getColWidth(col),
      }
    },
  }
}
