// sheet 插件对象：sheet 插件族 10 个能力模块（Store 参考模型、快照灌回、填充生成、Excel 键位、
// 选区同步、公式显示、多 sheet 实例池、撤销栈、边框预设、xlsx 导出映射）收拢为单一 TablePlugin
// 形态对外——createSheetPlugin(options) 返回插件对象，对象同时是运行时 handle：宿主经它建 Store、
// 注册/切换 sheet、撤销重做、快照采集灌回、边框展开与 xlsx 导出映射，不再触碰任何散装函数/类。
// 两种装配形态：
// - 单表形态（options.store 给出、createHost 未给）：插件持有唯一 Store，宿主自建表
//   （model 取 handle.store.asModel()、plugins 传入本插件），mount 接线撤销记录/填充生成/选区同步；
// - 书形态（options.createHost 给出）：插件内建多 sheet 实例池，switchTo 惰性建表并随建随挂本插件；
//   Excel 键位与公式显示经构造期 options 注入为低优先级底座，宿主统一 tableOptions 与单表 options
//   逐层覆盖。各能力模块仍以包内实现形态存在于同目录（深路径可测），本文件只做装配。

import type {
  CellBorderEdge,
  ListTable,
  ListTableOptions,
  RangeBounds,
  SelectionSnapshot,
  TablePlugin,
} from '@infinitable/core'
import type { WriteSheet } from 'hucre'

import {
  borderPresetLine,
  buildBorderPresetCells,
  type BorderLineStyle,
  type BorderPreset,
  type BorderPresetCell,
} from './border-presets'
import { bindFillGeneration } from './fill'
import { createFormulaDisplay, type FormulaEvaluator } from './formula-display'
import { excelKeymapPreset } from './keymap'
import { bindSelectionSync, type SelectionSyncController } from './selection-sync'
import { SheetBook, type HostFactory, type SheetBookChangeEvent, type SheetDef } from './sheet-book'
import { SheetStore, type SheetStoreOptions } from './sheet-store'
import {
  restore,
  snapshot,
  type SheetRestoreWiring,
  type SheetSnapshot,
  type SheetSnapshotExtras,
} from './snapshot'
import { UndoStack, bindCellChangeUndo, type UndoCommand } from './undo'
import {
  decodeDataUrlImage,
  sheetToWriteSheet,
  type SheetExportSource,
  type SheetImagePayload,
} from './xlsx-export'

/** 插件名（TablePlugin 契约 name） */
export const SHEET_PLUGIN_NAME = 'sheet'

/** 单格值写入（writeValues 入参条目；value 为新值） */
export interface SheetValueWrite {
  col: number
  row: number
  value: unknown
}

/**
 * 插件配置（工厂参数）：
 * - 单表形态：`store` 给出即持唯一 Store（报表渲染、基准建表等宿主自建表场景）；
 * - 书形态：`createHost` 给出即启用多 sheet 实例池（宿主注入渲染容器，DOM 呈现归宿主）。
 */
export interface SheetPluginOptions {
  /** 单表形态：唯一 Store 的构造参数 */
  store?: SheetStoreOptions
  /** 书形态：实例构造时的宿主注入（容器/hostOptions；host 缺省由引擎自建） */
  createHost?: HostFactory
  /** 书形态：每实例统一表 options（主题/列定义/编辑器等；插件注入的键位/公式显示为更低优先级底座） */
  tableOptions?: Partial<ListTableOptions>
  /** 值命令撤销栈上限（缺省 100，超限丢最旧） */
  undoLimit?: number
  /** 只读形态：不装配写路径接线（引擎编辑提交的撤销记录 / 填充生成 / 双击自动填充） */
  readonly?: boolean
  /** 公式显示求值器（`=` 前缀格经求值渲染，未注入/失败回落原文；书形态构造期注入底座） */
  evaluate?: FormulaEvaluator
  /** Excel 键位预设（缺省启用：Enter 进焦点格编辑、关闭 Ctrl/Cmd 点选加选；书形态构造期注入底座） */
  excelKeys?: boolean
  /** 选区双向同步：表格选区 → apply 落外部模型；外部模型变化经 syncSelectionFromExternal 回流 */
  selectionSync?: {
    apply: (selection: SelectionSnapshot) => void
    get: () => SelectionSnapshot
  }
}

/**
 * 插件 handle：TablePlugin 契约 + 运行时操作面。
 * mount 时按 options 装配各能力到 table（撤销记录、填充生成、选区同步），unmount 按注册逆序拆线；
 * 构造期能力（模型挂载、键位、公式显示、实例池）经书形态 switchTo 建表或单表宿主自建表达成。
 */
export interface SheetPluginHandle extends TablePlugin {
  /** 单表形态的唯一 Store（书形态 undefined，改用 registerSheet/activeStore） */
  readonly store: SheetStore | undefined
  /** 新建 Store（注册进书，或单表宿主自建表挂模型用） */
  createStore(storeOptions: SheetStoreOptions): SheetStore

  // ---- 书形态：多 sheet 实例池 ----

  /** 注册 sheet 定义（同 id 重复注册替换定义，已建实例保留至显式移除） */
  registerSheet(def: SheetDef): void
  /** 移除定义并销毁池内实例；移除活跃 sheet 时 activeId 置空并抛事件 */
  removeSheet(id: string): void
  /** id 是否已注册 */
  has(id: string): boolean
  /** 池内实例（未创建为 undefined） */
  get(id: string): ListTable | undefined
  /** 当前活跃 sheet id（无活跃为 null） */
  readonly activeId: string | null
  /** 切换活跃 sheet：实例惰性创建（池化复用），创建即挂本插件（mount 接线） */
  switchTo(id: string): ListTable
  /** 当前活跃实例（书形态无活跃 / 单表形态未挂载为 null） */
  activeTable(): ListTable | null
  /** 当前活跃 Store（单表形态为唯一 Store；无活跃为 null） */
  activeStore(): SheetStore | null
  /** 订阅切换/创建/移除事件（宿主据其重挂 DOM）；返回退订函数 */
  onSheetChange(listener: (event: SheetBookChangeEvent) => void): () => void
  /** 销毁池内全部实例（宿主收尾用）；定义保留可重建 */
  dispose(): void

  // ---- 快照 ----

  /** 采集 Store 全量快照（九字段；images/selection 不归 Store 持有，经 extras 注入携带） */
  saveSnapshot(store: SheetStore, extras?: SheetSnapshotExtras): SheetSnapshot
  /** 快照全量灌回 Store（替换语义，经 Store.rebuild 收口汇总）；images/selection 经 wiring 由宿主接线应用 */
  restoreSnapshot(store: SheetStore, snap: SheetSnapshot, wiring?: SheetRestoreWiring): void

  // ---- 撤销 / 重做 ----

  /** 撤销栈顶命令（空栈空操作） */
  undo(): void
  /** 重做栈顶命令（空栈空操作） */
  redo(): void
  /** 撤销栈状态 */
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** 清空撤销/重做栈 */
  clearHistory(): void
  /**
   * 撤销化批量写值（填充/查找替换/清空内容等直写 Store 的内容变更共用）：
   * 同格多写末次为准、新值与现值相同的格不写不入命令；一次调用 = 一条组合值命令。
   */
  writeValues(store: SheetStore, writes: readonly SheetValueWrite[]): void

  // ---- 边框预设 ----

  /** 线型 + 颜色 → 边定义（thin/medium/thick → solid 1/2/3px；dashed/dotted 同名线型） */
  borderEdge(style: BorderLineStyle, color: string): CellBorderEdge
  /** 边框预设 → 选区逐格 border 片段集合（8 预设；none 产出清除项，调用方清边框键） */
  borderCells(bounds: RangeBounds, preset: BorderPreset, edge: CellBorderEdge): BorderPresetCell[]

  // ---- xlsx 导出通道 ----

  /** Store（+ 合并/行列尺寸/浮动图）→ xlsx 引擎写表形态（纯数据，可结构化克隆发 worker） */
  exportSheet(source: SheetExportSource): WriteSheet
  /** data: URL 图片 → 导出字节载荷（五类 MIME 之外/非 base64/解析失败返回 undefined，跳过导出） */
  decodeImage(src: string | undefined): SheetImagePayload | undefined

  // ---- 选区同步（selectionSync 接线时） ----

  /** 外部模型选区变化时回流当前活跃表（同签名零开销；未接线为空操作） */
  syncSelectionFromExternal(): void
}

export function createSheetPlugin(options: SheetPluginOptions = {}): SheetPluginHandle {
  const ownStore = options.store ? new SheetStore(options.store) : undefined
  const stack = new UndoStack(options.undoLimit ?? 100)
  const writable = options.readonly !== true
  // 构造期底座 options（键位 + 公式显示）：统一 tableOptions 与单表 def options 逐层覆盖
  const baseOptions: Partial<ListTableOptions> = {
    ...(options.excelKeys === false ? {} : excelKeymapPreset),
    ...(options.evaluate
      ? { resolveDisplayValue: createFormulaDisplay({ evaluate: options.evaluate }) }
      : {}),
  }
  const book = options.createHost
    ? new SheetBook({
        createHost: options.createHost,
        tableOptions: { ...baseOptions, ...options.tableOptions },
      })
    : null
  /** 书形态 id → Store（registerSheet 登记；switchTo 建表时关联到实例） */
  const sheetStores = new Map<string, SheetStore>()
  /** 实例 → Store（mount 接线取数；unmount 摘除） */
  const storeByTable = new Map<ListTable, SheetStore>()
  /** 实例 → 拆线清单（mount 按序登记，unmount 逆序执行） */
  const teardowns = new Map<ListTable, Array<() => void>>()
  /** 实例 → 选区同步控制器（selectionSync 接线时） */
  const selectionControllers = new Map<ListTable, SelectionSyncController>()
  /** 单表形态已挂载的宿主表（activeTable/回流取数用） */
  let singleMounted: ListTable | null = null

  const assertBook = (): SheetBook => {
    if (!book) {
      throw new Error('sheet 插件：多 sheet 实例池能力需要工厂参数 createHost（书形态）')
    }
    return book
  }

  /** mount 取本实例对应的 Store：书形态按实例反查，单表形态回落唯一 Store */
  const resolveStore = (table: ListTable): SheetStore => {
    const store = storeByTable.get(table) ?? ownStore
    if (!store) {
      throw new Error(
        'sheet 插件：mount 的表未关联 Store（书形态实例经 switchTo 创建，勿对插件外的表手动挂载）',
      )
    }
    return store
  }

  const handle: SheetPluginHandle = {
    name: SHEET_PLUGIN_NAME,
    store: ownStore,
    createStore(storeOptions) {
      return new SheetStore(storeOptions)
    },
    mount(table) {
      if (teardowns.has(table)) {
        return
      }
      const store = resolveStore(table)
      const offs: Array<() => void> = []
      if (writable) {
        // 撤销记录：引擎编辑提交 → 值命令（undo 回写旧值 / redo 回写新值）
        const undoBinding = bindCellChangeUndo({ table, store, stack })
        offs.push(() => undoBinding.dispose())
        // 填充生成：拖拽/双击柄 → 生成值经撤销化批量写 + batchUpdate 收敛失效
        offs.push(
          bindFillGeneration({
            table,
            read: (col, row) => store.getValue(col, row),
            write: (cells) => {
              table.batchUpdate(() => {
                applyValueWrites(store, stack, cells)
              })
            },
            autoComplete: { rowCount: () => store.getRowCount() },
          }),
        )
      }
      if (options.selectionSync) {
        const controller = bindSelectionSync({ table, ...options.selectionSync })
        selectionControllers.set(table, controller)
        offs.push(() => {
          controller.dispose()
          selectionControllers.delete(table)
        })
      }
      teardowns.set(table, offs)
      if (!book) {
        singleMounted = table
      }
    },
    unmount(table) {
      const offs = teardowns.get(table)
      if (!offs) {
        return
      }
      teardowns.delete(table)
      for (let i = offs.length - 1; i >= 0; i--) {
        offs[i]!()
      }
      storeByTable.delete(table)
      if (singleMounted === table) {
        singleMounted = null
      }
    },
    registerSheet(def) {
      sheetStores.set(def.id, def.store)
      assertBook().register(def)
    },
    removeSheet(id) {
      sheetStores.delete(id)
      assertBook().remove(id)
    },
    has(id) {
      return book?.has(id) ?? false
    },
    get(id) {
      return book?.get(id)
    },
    get activeId() {
      return book?.activeId ?? null
    },
    switchTo(id) {
      const activeBook = assertBook()
      const existed = activeBook.get(id) !== undefined
      const table = activeBook.switchTo(id)
      if (!existed && !teardowns.has(table)) {
        storeByTable.set(table, sheetStores.get(id)!)
        table.use(handle)
      }
      return table
    },
    activeTable() {
      return book?.activeTable ?? singleMounted
    },
    activeStore() {
      const activeId = book?.activeId
      return ownStore ?? (activeId ? (sheetStores.get(activeId) ?? null) : null)
    },
    onSheetChange(listener) {
      return assertBook().onChange(listener)
    },
    dispose() {
      book?.dispose()
    },
    saveSnapshot(store, extras) {
      return snapshot(store, extras)
    },
    restoreSnapshot(store, snap, wiring) {
      restore(store, snap, wiring)
    },
    undo() {
      stack.undo()
    },
    redo() {
      stack.redo()
    },
    get canUndo() {
      return stack.canUndo
    },
    get canRedo() {
      return stack.canRedo
    },
    clearHistory() {
      stack.clear()
    },
    writeValues(store, writes) {
      applyValueWrites(store, stack, writes)
    },
    borderEdge(style, color) {
      return borderPresetLine(style, color)
    },
    borderCells(bounds, preset, edge) {
      return buildBorderPresetCells(bounds, preset, edge)
    },
    exportSheet(source) {
      return sheetToWriteSheet(source)
    },
    decodeImage(src) {
      return decodeDataUrlImage(src)
    },
    syncSelectionFromExternal() {
      const table = book?.activeTable ?? singleMounted
      if (table) {
        selectionControllers.get(table)?.syncFromExternal()
      }
    },
  }
  return handle
}

/**
 * 批量写值并入栈一条组合值命令（整体回退/重做）。
 * 同格多写按末次为准；新值与现值相同的格不写也不入命令。
 */
function applyValueWrites(
  store: SheetStore,
  stack: UndoStack,
  writes: readonly SheetValueWrite[],
): void {
  // 末次为准：同格重复写只留最终新值
  const targets = new Map<string, SheetValueWrite>()
  for (const write of writes) {
    targets.set(`${write.col},${write.row}`, write)
  }
  const commands: UndoCommand[] = []
  for (const write of targets.values()) {
    const oldValue = store.getValue(write.col, write.row)
    if (oldValue === write.value) {
      continue
    }
    store.setValue(write.col, write.row, write.value)
    commands.push({
      undo: () => store.setValue(write.col, write.row, oldValue),
      redo: () => store.setValue(write.col, write.row, write.value),
    })
  }
  if (commands.length > 0) {
    stack.push(commands)
  }
}
