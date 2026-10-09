// sheet 电子表格演示区（对标 ultra-ui playground sheet 的组件形态还原）：
// 数据面 = @infinitable/sheet（Workbook 模型/命令 + SheetGrid 实例池，装配束见 sheet/book.ts）；
// UI 面（工具栏/公式栏/tabs/右键菜单/观察区/toast）由 app/views/sheet/** 的 React + shadcn 组件承担。
// numFmt 为模型样式字段（显示走引擎显示链，模型恒存原始值）。

import type { ListTable, LoadedImage } from '@infinitable/core'

import { demoLoadImage } from '../mount'

import {
  type CellRenderer,
  type CellStyle,
  type CellStylePatch,
  type Sheet,
  type SheetGridContextMenuInfo,
} from '@infinitable/sheet'

import { createSheetBook, type EvaluatedValue, type SheetBookBundle } from './sheet/book'
import { createCSV } from './sheet/csv'
import { createXlsx, type XlsxHandle } from './sheet/xlsx'
import { MAIN_SHEET_NAME, SHEET_IMAGE_CELL } from './sheet/constants'

/**
 * 数字格式（模型样式 numFmt 字段形态；包公共面未单列该类型，经 CellStyle 索引取用）。
 * 右键菜单「设置数据格式」与冒烟驱动面共用。
 */
export type NumFmt = NonNullable<CellStyle['numFmt']>

/** 顶部 toast 消息回调（React 层注入；引擎侧接线只调它） */
export type SheetNotify = (text: string, kind?: 'info' | 'warn') => void

/** 工具栏驱动面（React 工具栏挂载后回填；冒烟 applyFragment 断言走这里） */
export interface SheetToolbarApi {
  /** 编程式样式应用（冒烟驱动用）：对当前选区逐格套用片段 */
  applyFragment(fragment: CellStylePatch, mode: 'toggle' | 'set'): void
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

/** 冒烟/控制台驱动面（全部经公开 API 组合） */
interface SheetDemoControls {
  toolbar: SheetToolbarApi
  find: SheetFindApi
  csv: ReturnType<typeof createCSV>
  /** xlsx 整本导入导出（worker，IO 走 @infinitable/sheet） */
  xlsx: XlsxHandle
  /** 活跃 sheet 的 numFmt 读写（模型样式字段；冒烟驱动右键菜单同路径） */
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
  /** 当前活跃表实例（引擎 ListTable） */
  getTable: () => ListTable
  /** 当前活跃模型（@infinitable/sheet Sheet） */
  getStore: () => Sheet
  /** 装配束（Workbook + 实例池） */
  getBundle: () => SheetBookBundle
  /** 切换 sheet（按表名） */
  switchTo: (name: string) => void
  /** sheet 名列表 */
  ids: () => string[]
  /** 撤销/重做（活跃表命令栈） */
  undo: () => void
  redo: () => void
  /** 撤销栈状态与重置（空栈断言 / 冒烟驱动） */
  history: {
    canUndo: () => boolean
    canRedo: () => boolean
    clear: () => void
  }
  /** UI 驱动面 */
  controls: SheetDemoControls
  /** 关键查询 API 一次性快照（控制台 / 自动化断言用） */
  queries: () => {
    activeName: string
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
  /** 当前活跃表实例（引擎 ListTable；tabs 切换后指向新活跃实例） */
  readonly table: ListTable
  /** 当前活跃模型（Sheet） */
  getStore: () => Sheet
  /** 装配束（Workbook + 实例池） */
  getBundle: () => SheetBookBundle
  /** UI 驱动面 */
  getControls: () => SheetDemoControls
  /** React 工具栏/查找面板挂载后回填冒烟驱动面（toolbar 与 find 槽位） */
  registerUi(ui: { toolbar?: SheetToolbarApi; find?: SheetFindApi }): void
  /** 右键菜单组件挂载后回填（SheetGrid 公共回调转发；卸载置空） */
  setContextMenuHandler(
    handler: ((name: string, info: SheetGridContextMenuInfo) => void) | null,
  ): void
  /** 顶部 toast 消息（React toast 层注入；引擎侧事件与结构操作共用） */
  readonly notify: SheetNotify
  /** 资源释放（卸载时调用） */
  destroy: () => void
}

/** F1 格内示例图（Sheet1 专属）：本地生成位图（mountSheet 持活）+ contain 适配绘制 */
function createCellImageRenderer(imageRef: {
  current: LoadedImage | null
}): (
  sheet: Sheet,
) => ((addr: { row: number; col: number }) => CellRenderer | undefined) | undefined {
  return (sheet) => {
    if (sheet.name !== MAIN_SHEET_NAME) {
      return undefined
    }
    return (addr) => {
      const image = imageRef.current
      if (addr.row !== SHEET_IMAGE_CELL.row || addr.col !== SHEET_IMAGE_CELL.col || !image) {
        return undefined
      }
      return ({ ctx, width, height }) => {
        // contain：等比缩放完整显示于格内
        const scale = Math.min(width / image.width, height / image.height)
        const drawWidth = image.width * scale
        const drawHeight = image.height * scale
        ctx.drawImage(
          image.source,
          (width - drawWidth) / 2,
          (height - drawHeight) / 2,
          drawWidth,
          drawHeight,
        )
      }
    }
  }
}

/**
 * sheet 引擎装配：网格视口（.sheet-viewport）内建实例池（每表一个 SheetGrid）；
 * 工具栏/公式栏/tabs 等由 React 层渲染并经 registerUi 回填驱动面。
 */
export function mountSheet(
  viewport: HTMLElement,
  opts: { notify: SheetNotify; onBookRebuilt?: () => void },
): SheetDemo {
  const notify = opts.notify

  /** 右键菜单处理器槽位（React 菜单组件 register；SheetGrid onContextMenu 转发到此） */
  let contextMenuHandler: ((name: string, info: SheetGridContextMenuInfo) => void) | null = null

  /** F1 格内示例图位图（加载完成后刷新对应格触发首绘） */
  const cellImage: { current: LoadedImage | null } = { current: null }
  const cellImageReady = demoLoadImage('demo://sheet/cell-img').then((loaded) => {
    cellImage.current = loaded
  })

  const bundle = createSheetBook(viewport, {
    notify,
    resolveCellRenderer: createCellImageRenderer(cellImage),
    onContextMenu: (name, info) => contextMenuHandler?.(name, info),
    onGridCreated: (name, grid) => {
      const table = grid.getTable()
      // 编辑提交 toast（引擎事件面；与旧装配同口径）
      table.onCellChange((change) => {
        notify(`编辑提交 (${change.col},${change.row})：${String(change.newValue)}`)
      })
      // 示例图异步加载完成后补一次该格重绘（pull 式渲染需要失效触发）
      if (name === MAIN_SHEET_NAME) {
        void cellImageReady.then(() => {
          table.refreshCell(SHEET_IMAGE_CELL.col, SHEET_IMAGE_CELL.row)
        })
      }
      return undefined
    },
  })

  // 首次切换（惰性创建 Sheet1 实例）先行：后续 UI 均依赖活跃实例存在
  bundle.switchTo(bundle.activeName())
  const table = (): ListTable => bundle.activeTable()
  const store = (): Sheet => bundle.activeSheet()

  /** 活跃 sheet 的 numFmt 读写（右键菜单与冒烟驱动面共用；模型样式字段） */
  const numFmtControl = {
    get: (col: number, row: number): NumFmt | undefined =>
      store().getEffectiveStyle({ row, col })?.numFmt,
    set: (col: number, row: number, fmt: NumFmt | undefined): void => {
      store().setCellStyle(
        { start: { row, col }, end: { row, col } },
        fmt ? { numFmt: fmt } : { numFmt: null },
      )
    },
  }

  // xlsx 导入重建 book 后的 UI 联动（React 层刷新 tabs/公式栏/按钮态）
  const onBookRebuilt = (): void => {
    opts.onBookRebuilt?.()
  }

  const xlsx = createXlsx({ bundle, notify, onImported: onBookRebuilt })
  const csv = createCSV({
    sheet: store,
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

  /** 结构操作：在第 at 行上方插入行（0 基；结构变更后实例由 bundle 就地重建） */
  const insertRowAt = (at: number): void => {
    store().insertRows(at)
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
      store().deleteRows(at)
      notify(`已删除行 ${at + 1}`)
    },
    /** 当前活跃 sheet 求值（公式引擎，临时求值不落模型） */
    evaluate: (formula: string): EvaluatedValue => bundle.evaluateActive(formula),
  }

  return {
    get table() {
      return table()
    },
    getStore: store,
    getBundle: () => bundle,
    getControls: () => controls,
    registerUi: (ui) => {
      Object.assign(toolbarApi, ui.toolbar)
      Object.assign(findApi, ui.find)
    },
    setContextMenuHandler: (handler) => {
      contextMenuHandler = handler
    },
    notify,
    destroy: () => {
      contextMenuHandler = null
      csv.destroy()
      bundle.dispose()
    },
  }
}

/** 调试句柄装配（SheetPage 与 SmokeMode 冒烟路径共用） */
export function createSheetHandle(demo: SheetDemo): SheetDemoHandle {
  const bundle = demo.getBundle()
  return {
    getTable: () => demo.table,
    getStore: () => demo.getStore(),
    getBundle: () => bundle,
    switchTo: (name) => demo.getBundle().switchTo(name),
    ids: () => demo.getBundle().ids(),
    undo: () => {
      demo.getStore().undo()
    },
    redo: () => {
      demo.getStore().redo()
    },
    history: {
      canUndo: () => demo.getStore().canUndo,
      canRedo: () => demo.getStore().canRedo,
      clear: () => demo.getStore().history.clear(),
    },
    controls: demo.getControls(),
    queries: () => {
      const table = demo.table
      const store = demo.getStore()
      return {
        activeName: demo.getBundle().activeName(),
        frozen: { cols: store.frozen.cols, rows: store.frozen.rows },
        selection: table.getSelectedCellRanges(),
        bodyVisible: table.getBodyVisibleCellRange(),
        drawRange: table.getDrawRange(),
        scroll: { left: table.getScrollLeft(), top: table.getScrollTop() },
        headerLevels: table.getHeaderLevelCount(),
        editing: table.isEditing(),
        cellValue: (col, row) => store.getCellData({ row, col })?.v,
        cellStyle: (col, row) =>
          store.getCellStyle({ row, col }) as Record<string, unknown> | undefined,
        colWidth: (col) => store.getColWidth(col) ?? 80,
      }
    },
  }
}
