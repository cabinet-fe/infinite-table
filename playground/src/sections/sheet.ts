// sheet 电子表格演示区（对标 ultra-ui playground sheet 的组件形态还原）：
// 数据面装配束（Store 单一事实源 + createSheetPlugin 书形态：实例池/键位/撤销栈/填充生成），
// UI 面（工具栏/公式栏/tabs/右键菜单/观察区/toast）由 app/views/sheet/** 的 React + shadcn 组件承担。
// numFmt 为 demo 级侧车通道（book.ts 按 sheet 持稀疏 Map，仅影响显示，Store 恒存原始值）。

import {
  EditorRegistry,
  normalizeRange,
  type CellStyle,
  type ListTable,
  type ListTableOptions,
  type LoadedImage,
  type RangeBounds,
  type ThemeOverride,
} from '@infinitable/core'

import type { SheetPluginHandle } from '@infinitable/plugins'

import { demoLoadImage } from '../mount'

import { createDemoBook, type SheetBookBundle, type SheetStore } from './sheet/book'
import { createCSV } from './sheet/csv'
import type { EvaluatedValue } from './sheet/evaluator'
import type { NumFmt } from './sheet/format'
import {
  deleteRow as deleteRowOp,
  insertRow as insertRowOp,
  refreshAllGrid,
  syncMergesToTable,
} from './sheet/ops'
import { bindResizePersistence } from './sheet/persist'
import { createXlsx, type XlsxHandle } from './sheet/xlsx'
import { SHEET_COL_COUNT, SHEET_IMAGE_CELL } from './sheet/constants'

/** 顶部 toast 消息回调（React 层注入；引擎侧接线只调它） */
export type SheetNotify = (text: string, kind?: 'info' | 'warn') => void

/** 工具栏驱动面（React 工具栏挂载后回填；冒烟 applyFragment 断言走这里） */
export interface SheetToolbarApi {
  /** 编程式样式应用（冒烟驱动用）：对当前选区逐格套用片段 */
  applyFragment(fragment: CellStyle, mode: 'toggle' | 'set'): void
  /** 清除当前选区格式 */
  clearFormat(): void
  /** 刷新按钮态（选区/值变化后由监听方调用） */
  refreshStates(): void
}

/** 查找替换驱动面（面板逻辑句柄；冒烟 findNext/replaceAll 断言走这里） */
export interface SheetFindApi {
  /** 查找下一个（默认按显示值、忽略大小写、非整格） */
  findNext(keyword?: string): { col: number; row: number } | null
  /** 全表替换（字符串原值替换，返回次数） */
  replaceAll(keyword?: string, replacement?: string): number
}

/**
 * 网格主题（对标 ultra-ui vtable-theme 实际生效值）：表头/行号 #F5F5F5 非粗体 12px 居中、
 * 正文 14px/#000（VTable DEFAULT bodyStyle 继承值）、格内边距 [2,6,2,6]、网格线 #E1E4E8
 * （右/下 1px 收入式）、选区 #2170E7 2px + 12% 填充、行号列 46px、行高 28、默认列宽 80。
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
interface SheetDemoControls {
  toolbar: SheetToolbarApi
  find: SheetFindApi
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

/** 调试句柄形态（SheetPage 挂载时写入 window.__SHEET_DEMO__；句柄面只含公开 API） */
interface SheetDemoHandle {
  /** 当前活跃表实例 */
  getTable: () => ListTable
  /** 当前活跃 Store */
  getStore: () => SheetStore
  /** UI 驱动面 */
  controls: SheetDemoControls
  /** sheet 插件 handle（多 sheet 注册/切换/事件/撤销栈） */
  sheet: SheetPluginHandle
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
  /** sheet 插件 handle（多 sheet 状态/撤销栈/导出） */
  getSheet: () => SheetPluginHandle
  /** 装配束（切换/新建/删除/ids/containers/stores） */
  getBundle: () => SheetBookBundle
  /** UI 驱动面 */
  getControls: () => SheetDemoControls
  /** React 工具栏/查找面板挂载后回填冒烟驱动面（toolbar 与 find 槽位） */
  registerUi(ui: { toolbar?: SheetToolbarApi; find?: SheetFindApi }): void
  /** 顶部 toast 消息（React toast 层注入；引擎侧事件与结构操作共用） */
  readonly notify: SheetNotify
  /** 资源释放（卸载时调用） */
  destroy: () => void
}

/**
 * sheet 引擎装配：网格视口（.sheet-viewport）内建书形态实例池；
 * 工具栏/公式栏/tabs 等由 React 层渲染并经 registerUi 回填驱动面。
 */
export function mountSheet(
  viewport: HTMLElement,
  opts: { notify: SheetNotify; onBookRebuilt?: () => void },
): SheetDemo {
  const notify = opts.notify

  // ---- sheet 插件装配（书形态；容器铺满网格区，尺寸以测量值为准） ----
  const registry = new EditorRegistry()
  registry.registerEditor('text', {})
  const gridWidth = viewport.clientWidth || 960
  const gridHeight = viewport.clientHeight || 420
  let bundleRef: SheetBookBundle | null = null
  const bundle = createDemoBook(viewport, {
    width: gridWidth,
    height: gridHeight,
    columns: Array.from({ length: SHEET_COL_COUNT }, (_, col) => ({
      title: String.fromCharCode(65 + (col % 26)) + (col >= 26 ? String(Math.floor(col / 26)) : ''),
      width: 80,
      editor: 'text',
    })),
    editorRegistry: registry,
    theme: SHEET_THEME,
    // Excel 键位（Enter 进编辑、关闭 Ctrl 加选）由插件构造期底座注入
    // resolveCellImage 经活跃 id 判定：格内示例图仅演示于 sheet-1 的 F1
    resolveCellImage: (col, row) =>
      bundleRef?.sheet.activeId === 'sheet-1' &&
      col === SHEET_IMAGE_CELL.col &&
      row === SHEET_IMAGE_CELL.row
        ? 'demo://sheet/cell-img'
        : null,
    imageServiceOptions: { loadImage: sheetLoadImage },
  } satisfies Partial<ListTableOptions>)
  bundleRef = bundle
  const sheet = bundle.sheet

  // ---- 每实例接线（创建时一次性绑定）：编辑/填充 toast / resize 持久化 ----
  // 撤销记录与填充写值由插件 mount 装配（switchTo 建表即挂），此处只补演示层接线
  const teardowns = new Map<string, Array<() => void>>()
  sheet.onSheetChange((event) => {
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
    teardowns.set(id, [bindResizePersistence(created, store)])
  })

  // ---- 首次切换（惰性创建 sheet-1 实例）先行：后续 UI 均依赖活跃实例存在 ----
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
      const id = sheet.activeId
      return id ? bundle.getNumFmt(id, col, row) : undefined
    },
    set: (col: number, row: number, fmt: NumFmt | undefined): void => {
      const id = sheet.activeId
      if (id) {
        bundle.setNumFmt(id, col, row, fmt)
      }
    },
  }

  // xlsx 导入重建 book 后的 UI 联动（React 层刷新 tabs/公式栏/按钮态，此处补引擎侧全表刷新）
  const onBookRebuilt = (): void => {
    opts.onBookRebuilt?.()
    refreshAllGrid(table(), store())
  }

  const xlsx = createXlsx({ bundle, notify, onImported: onBookRebuilt })
  const csv = createCSV({
    table,
    store,
    notify,
    onXlsx: (file) => {
      void file.arrayBuffer().then((buffer) => xlsx.importBuffer(buffer))
    },
  })

  /** 工具栏/查找面板槽位（React 层 registerUi 回填；未回填时调用即显式失败） */
  const notMounted = (): never => {
    throw new Error('sheet UI 面未挂载（工具栏/查找面板尚未注册）')
  }
  const toolbarApi: SheetToolbarApi = {
    applyFragment: notMounted,
    clearFormat: notMounted,
    refreshStates: () => {},
  }
  const findApi: SheetFindApi = {
    findNext: notMounted,
    replaceAll: notMounted,
  }

  /** 结构操作：在第 at 行上方插入行（0 基） */
  const insertRowAt = (at: number): void => {
    insertRowOp(store(), at)
    syncMergesToTable(table(), store(), (error) => {
      notify(`合并区同步被拒绝：${error.message}`, 'warn')
    })
    refreshAllGrid(table(), store())
    notify(`已在行 ${at + 1} 上插入行`)
  }

  /** 冒烟/控制台驱动面（全部经公开 API 组合） */
  const controls: SheetDemoControls = {
    toolbar: toolbarApi,
    find: findApi,
    csv,
    xlsx,
    numFmt: numFmtControl,
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

  return {
    get table() {
      return table()
    },
    getStore: store,
    getSheet: () => sheet,
    getBundle: () => bundle,
    getControls: () => controls,
    registerUi: (ui) => {
      Object.assign(toolbarApi, ui.toolbar)
      Object.assign(findApi, ui.find)
    },
    notify,
    destroy: () => {
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

/** 调试句柄装配（SheetPage 与 SmokeMode 冒烟路径共用） */
export function createSheetHandle(demo: SheetDemo): SheetDemoHandle {
  return {
    getTable: () => demo.table,
    getStore: () => demo.getStore(),
    sheet: demo.getSheet(),
    switchTo: (id) => demo.getBundle().switchTo(id),
    ids: () => demo.getBundle().ids(),
    undo: () => demo.getSheet().undo(),
    redo: () => demo.getSheet().redo(),
    history: {
      canUndo: () => demo.getSheet().canUndo,
      canRedo: () => demo.getSheet().canRedo,
      clear: () => demo.getSheet().clearHistory(),
    },
    controls: demo.getControls(),
    queries: () => {
      const table = demo.table
      const store = demo.getStore()
      return {
        activeId: demo.getSheet().activeId,
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
