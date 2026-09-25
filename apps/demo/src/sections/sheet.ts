// sheet 电子表格演示区（对标 ultra-ui playground sheet 的组件形态还原）：
// 工具栏（图标分组）→ 公式栏（名称框/fx/建议）→ 网格（flex 铺满）→ 底部 tabs，
// 右键菜单三套（行号/列头/正文，正文含「设置数据格式」子菜单）、查找替换弹层、
// CSV/xlsx 导入导出（hucre）、插入浮动图片、数据结构观察区；消息走顶部 toast（无状态栏，与 ultra-ui 一致）。
// 数据面不变：SheetStore 单一事实源 + sheet 插件族（填充/选区同步/公式显示/键位/实例池/撤销栈）；
// numFmt 为 demo 级侧车通道（book.ts 按 sheet 持稀疏 Map，仅影响显示，Store 恒存原始值）。

import {
  EditorRegistry,
  normalizeRange,
  type ListTable,
  type ListTableOptions,
  type LoadedImage,
  type RangeBounds,
  type ThemeOverride,
} from '@infinite-table/core'

import {
  bindCellChangeUndo,
  excelKeymapPreset,
  UndoStack,
  type SheetStore,
} from '@infinite-table/plugins'

import { createSection, demoLoadImage } from '../mount'

import { createDemoBook, type SheetBookBundle } from './sheet/book'
import { createCSV } from './sheet/csv'
import { mountContextMenu } from './sheet/context-menu'
import { bindStoreFill } from './sheet/fills'
import { mountFormulaBar } from './sheet/formula-bar'
import type { EvaluatedValue } from './sheet/evaluator'
import type { NumFmt } from './sheet/format'
import { mountInspector } from './sheet/inspector'
import {
  deleteRow as deleteRowOp,
  insertRow as insertRowOp,
  refreshAllGrid,
  syncMergesToTable,
} from './sheet/ops'
import { bindResizePersistence } from './sheet/persist'
import { mountToolbar } from './sheet/toolbar'
import { mountTabs, type TabsHandle } from './sheet/tabs'
import { createToaster } from './sheet/toast'
import { createXlsx, type XlsxHandle } from './sheet/xlsx'
import { SHEET_COL_COUNT, SHEET_IMAGE_CELL } from './sheet/constants'

export {
  SHEET_COL_COUNT,
  SHEET_ROW_COUNT,
  SHEET_MERGE_RANGE,
  SHEET_MERGE_EXTRA_RANGE,
  SHEET_FILL_SELECTION,
  SHEET_IMAGE_CELL,
} from './sheet/constants'

/**
 * 网格主题（对标 ultra-ui vtable-theme 实际生效值）：表头/行号 #F5F5F5 非粗体 12px 居中、
 * 正文 14px/#000（VTable DEFAULT bodyStyle 继承值）、格内边距 [2,6,2,6]、网格线 #E1E4E8
 * （右/下 1px 收入式）、选区 #2170E7 2px + 12% 填充、行号列 46px、行高 28、默认列宽 80、hover 关闭。
 */
const SHEET_THEME: ThemeOverride = {
  rowHeight: 28,
  headerHeight: 28,
  rowHeaderWidth: 46,
  defaultColWidth: 80,
  body: {
    color: '#000000',
    fontSize: 14,
    padding: [2, 6, 2, 6],
    borderColor: '#E1E4E8',
  },
  header: {
    color: '#000000',
    fontSize: 12,
    padding: [2, 6, 2, 6],
    background: '#F5F5F5',
    borderColor: '#E1E4E8',
    textAlign: 'center',
  },
  underlayBackgroundColor: '#ffffff',
  interaction: {
    selectionFill: 'rgba(33, 112, 231, 0.12)',
    selectionBorder: '#2170E7',
    selectionBorderWidth: 2,
    fillHandle: '#2170E7',
    hoverCell: 'transparent',
    hoverBand: 'transparent',
    resizeLine: '#2170E7',
    headerHighlight: 'rgba(33, 112, 231, 0.1)',
    // 冻结分隔线对齐 Excel 观感（比网格线 #E1E4E8 深一档）
    freezeDividerColor: '#B6BABF',
    freezeDividerWidth: 1,
  },
  frameStyle: { lineWidth: 1, color: '#E1E4E8', shadow: false },
}

/** 预置浮动示例图（对标 ultra-ui playground 的 canvas 生成小图，锚 F2） */
function addPresetFloatImage(table: ListTable): void {
  table.floatObjects.add({
    id: 'sheet-demo-float',
    kind: 'image',
    anchor: { from: { col: 5, row: 1 }, to: { col: 6, row: 2 }, offsetX: 2, offsetY: 2 },
    src: 'demo://sheet/demo-float',
    title: 'playground demo',
  })
}

/** sheet 区图片加载器：data: URL 走真实位图（插入图片用），其余本地生成（演示零网络） */
async function sheetLoadImage(url: string): Promise<LoadedImage> {
  if (url.startsWith('data:')) {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true })
      image.addEventListener('error', () => reject(new Error(`图片加载失败：${url}`)), {
        once: true,
      })
      image.src = url
    })
    return { source: image, width: image.naturalWidth, height: image.naturalHeight }
  }
  return demoLoadImage(url)
}

function formatBounds(bounds: RangeBounds): string {
  return `(${bounds.minCol},${bounds.minRow})~(${bounds.maxCol},${bounds.maxRow})`
}

/** 冒烟/控制台驱动面（全部经公开 API 组合） */
export interface SheetDemoControls {
  toolbar: ReturnType<typeof mountToolbar>
  formulaBar: ReturnType<typeof mountFormulaBar>
  find: ReturnType<typeof mountToolbar>['find']
  csv: ReturnType<typeof createCSV>
  /** xlsx 整本导入导出（hucre） */
  xlsx: XlsxHandle
  /** 活跃 sheet 的 numFmt 侧车读写（冒烟驱动右键菜单同路径） */
  numFmt: {
    get: (col: number, row: number) => NumFmt | undefined
    set: (col: number, row: number, fmt: NumFmt | undefined) => void
  }
  insertRow: (at: number) => void
  deleteRow: (at: number) => void
  /** 当前活跃 sheet 公式求值（公式引擎；错误 → 错误码文本） */
  evaluate: (formula: string) => EvaluatedValue
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
  /** 撤销栈状态与重置（空栈断言 / 冒烟驱动） */
  history: {
    canUndo: () => boolean
    canRedo: () => boolean
    clear: () => void
  }
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
    '对标 ultra-ui playground sheet：工具栏/公式栏/底部 tabs/三套右键菜单（含数据格式）/查找替换/CSV/xlsx/插入图片/数据结构观察。' +
      'SheetStore 单一事实源 + sheet 插件族；样式矩阵 / \\n 多行合并 / 填充柄 / 格内图演示保留。',
  )

  // ---- 组件卡片（u-sheet 形态）：工具栏 → 公式栏 → 网格 → 底部 tabs ----
  const app = document.createElement('div')
  app.className = 'sheet-app'
  const toolbarArea = document.createElement('div')
  toolbarArea.className = 'sheet-app__toolbar-wrap'
  const formulaArea = document.createElement('div')
  formulaArea.className = 'sheet-app__formula-wrap'
  const gridArea = document.createElement('div')
  gridArea.className = 'sheet-app__grid sheet-viewport'
  const tabsArea = document.createElement('div')
  tabsArea.className = 'sheet-app__tabs-wrap'
  app.append(toolbarArea, formulaArea, gridArea, tabsArea)
  section.appendChild(app)

  const toaster = createToaster()
  const notify = (text: string, kind: 'info' | 'warn' = 'info'): void => {
    toaster.notify(text, kind)
  }

  // ---- SheetBook 装配（容器铺满网格区，尺寸以测量值为准） ----
  const registry = new EditorRegistry()
  registry.registerEditor('text', {})
  const gridWidth = gridArea.clientWidth || 960
  const gridHeight = gridArea.clientHeight || 420
  let bundleRef: SheetBookBundle | null = null
  const bundle = createDemoBook(gridArea, {
    width: gridWidth,
    height: gridHeight,
    columns: Array.from({ length: SHEET_COL_COUNT }, (_, col) => ({
      title: String.fromCharCode(65 + (col % 26)) + (col >= 26 ? String(Math.floor(col / 26)) : ''),
      width: 80,
      editor: 'text',
    })),
    editorRegistry: registry,
    theme: SHEET_THEME,
    ...excelKeymapPreset,
    // resolveCellImage 经活跃 id 判定：格内示例图仅演示于 sheet-1 的 F1
    resolveCellImage: (col, row) =>
      bundleRef?.book.activeId === 'sheet-1' &&
      col === SHEET_IMAGE_CELL.col &&
      row === SHEET_IMAGE_CELL.row
        ? 'demo://sheet/cell-img'
        : null,
    imageServiceOptions: { loadImage: sheetLoadImage },
  } satisfies Partial<ListTableOptions>)
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
    created.onCellChange((change) => {
      notify(
        `编辑提交 (${change.col},${change.row})：${String(change.oldValue)} → ${String(change.newValue)}`,
      )
    })
    created.onFillHandleDown((fillEvent) => {
      notify(`填充柄按下：选区段 ${formatBounds(normalizeRange(fillEvent.range))}`)
    })
    created.onFillDragEnd((fillEvent) => {
      const { anchor, target } = fillEvent
      // 无扩展区（单击柄/双击首击的空点按）不提示
      if (
        target.minCol >= anchor.minCol &&
        target.maxCol <= anchor.maxCol &&
        target.minRow >= anchor.minRow &&
        target.maxRow <= anchor.maxRow
      ) {
        return
      }
      notify(`填充生成：锚定 ${formatBounds(anchor)} → 写入 ${formatBounds(target)} 的扩展区`)
    })
    created.onFillHandleDoubleClick((fillEvent) => {
      notify(`填充柄双击：${formatBounds(normalizeRange(fillEvent.range))} 按相邻数据块自动填充`)
    })
    // 初始态对标 ultra-ui 演示：A1 选中 + F2 预置浮动示例图（仅主 sheet 首建）
    if (id === 'sheet-1') {
      created.selectCell(0, 0)
      addPresetFloatImage(created)
    }
    const undoBinding = bindCellChangeUndo({ table: created, store, stack })
    const offs = [
      bindStoreFill(created, store, stack),
      bindResizePersistence(created, store),
      () => undoBinding.dispose(),
    ]
    teardowns.set(id, offs)
  })

  // ---- UI 面：公式栏 → 工具栏（含查找/CSV/xlsx 弹层）→ tabs → 右键菜单 ----
  // 首次切换（惰性创建 sheet-1 实例）先行：后续 UI 均依赖活跃实例存在
  bundle.switchTo('sheet-1')
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

  /** 活跃 sheet 的 numFmt 侧车读写（右键菜单与冒烟驱动面共用） */
  const numFmtControl = {
    get: (col: number, row: number): NumFmt | undefined => {
      const id = bundle.book.activeId
      return id ? bundle.getNumFmt(id, col, row) : undefined
    },
    set: (col: number, row: number, fmt: NumFmt | undefined): void => {
      const id = bundle.book.activeId
      if (id) {
        bundle.setNumFmt(id, col, row, fmt)
      }
    },
  }

  // xlsx 导入重建 book 后的 UI 联动（函数声明提升：tabs 在其后定义，运行期才被回调）
  const onBookRebuilt = (): void => {
    tabs.refresh()
    formulaBar.refresh()
    toolbar.refreshStates()
    refreshAllGrid(table(), store())
  }

  const formulaBar = mountFormulaBar(formulaArea, { table, store, notify, bundle })
  const xlsx = createXlsx({ bundle, notify, onImported: onBookRebuilt })
  const csv = createCSV({
    table,
    store,
    notify,
    onXlsx: (file) => {
      void file.arrayBuffer().then((buffer) => xlsx.importBuffer(buffer))
    },
  })
  const toolbar = mountToolbar(toolbarArea, {
    table,
    store,
    notify,
    stack,
    bundle,
    csv,
    xlsx,
    formulaBar,
  })
  const tabs: TabsHandle = mountTabs(tabsArea, {
    bundle,
    notify,
    onSwitched: () => {
      formulaBar.refresh()
      toolbar.refreshStates()
    },
  })
  const contextMenu = mountContextMenu({
    table,
    store,
    stack,
    notify,
    setNumFmt: numFmtControl.set,
  })
  const inspector = mountInspector(section, {
    bundle,
    table,
    store,
    stack,
    labelOf: tabs.labelOf,
  })

  /** 冒烟/控制台驱动面（全部经公开 API 组合） */
  const controls: SheetDemoControls = {
    toolbar,
    formulaBar,
    find: toolbar.find,
    csv,
    xlsx,
    numFmt: numFmtControl,
    /** 结构操作：在第 at 行上方插入行（0 基） */
    insertRow: (at: number): void => {
      insertRowAt(at)
    },
    /** 结构操作：删除第 at 行（0 基） */
    deleteRow: (at: number): void => {
      deleteRowOp(store(), at)
      syncMergesToTable(table(), store(), (error) => {
        notify(`合并区同步被拒绝：${error.message}`, 'warn')
      })
      refreshAllGrid(table(), store())
      notify(`已删除行 ${at + 1}`)
    },
    /** 当前活跃 sheet 求值（公式引擎，按格缓存） */
    evaluate: (formula: string): EvaluatedValue => bundle.evaluateActive(formula),
  }
  const insertRowAt = (at: number): void => {
    insertRowOp(store(), at)
    syncMergesToTable(table(), store(), (error) => {
      notify(`合并区同步被拒绝：${error.message}`, 'warn')
    })
    refreshAllGrid(table(), store())
    notify(`已在行 ${at + 1} 上插入行`)
  }

  // ---- 全局快捷键（Ctrl/Cmd+Z 撤销、Shift+Z/Y 重做、F 查找；输入控件内与编辑会话中不接管撤销/重做） ----
  /** 撤销/重做接管条件：网格聚焦（焦点不在输入控件，见下方 target 过滤）且活跃表不在编辑会话 */
  const canUndoRedo = (): boolean => {
    const active = bundle.activeTable()
    return active != null && !active.isEditing()
  }
  const onKeydown = (event: KeyboardEvent): void => {
    if (!app.isConnected || !(event.ctrlKey || event.metaKey)) {
      return
    }
    const target = event.target
    if (target instanceof HTMLElement && target.closest('input, textarea, select')) {
      return
    }
    const key = event.key.toLowerCase()
    if (key === 'f') {
      event.preventDefault()
      toolbar.toggleFind()
    } else if (key === 'z' && !event.shiftKey && canUndoRedo()) {
      event.preventDefault()
      stack.undo()
      notify('已撤销')
      toolbar.refreshStates()
      inspector.refresh()
    } else if ((key === 'z' || key === 'y') && canUndoRedo()) {
      event.preventDefault()
      stack.redo()
      notify('已重做')
      toolbar.refreshStates()
      inspector.refresh()
    }
  }
  document.addEventListener('keydown', onKeydown)

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
      document.removeEventListener('keydown', onKeydown)
      toolbar.destroy()
      contextMenu.destroy()
      formulaBar.destroy()
      tabs.destroy()
      inspector.destroy()
      csv.destroy()
      for (const offs of teardowns.values()) {
        for (const off of offs) {
          off()
        }
      }
      toaster.destroy()
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
    history: {
      canUndo: () => demo.getUndo().canUndo,
      canRedo: () => demo.getUndo().canRedo,
      clear: () => demo.getUndo().clear(),
    },
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
