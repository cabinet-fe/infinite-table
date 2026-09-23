// SheetGrid（infinite-table 引擎版）：ultra-ui @veltra/sheet-core/grid 门面的等价实现。
//
// 职责对齐 VTable 版 SheetGrid：渲染 ultra-ui Sheet 模型（值/样式/合并/冻结/行列尺寸/
// 浮动图片）、编辑（引擎 EditManager → 模型命令栈）、选区双向同步（applyExternalSelection
// 防回环）、右键菜单三区域、填充柄（plugins generateFill）、undo/redo 键位、触控滚动（引擎内置）。
// 替换依据 docs/replace-vtable-roadmap.md 与 docs/plugin-interface-map.md（只 import
// @infinite-table/core / @infinite-table/plugins 公开入口 + ultra-ui 模型层）。

import {
  EditorRegistry,
  ListTable,
  normalizeRange,
  type CellChangeEvent,
  type CellRange as EngineCellRange,
  type CellRenderer,
  type ListTableOptions,
  type SelectionSnapshot,
  type TableModel,
  type ThemeOverride,
} from '@infinite-table/core'
import { bindFillGeneration } from '@infinite-table/plugins'
import {
  colIndexToName,
  type CellAddress,
  type CellRange,
  type CellStyle as VeltraCellStyle,
  type CellValue,
  type Sheet,
} from '@veltra/sheet-core'
import { formatByNumFmt } from '@veltra/sheet-core/core/format.js'

import { cachedCellLayoutRenderer, type CustomLayout } from './cell-layout'
import { sheetChromeTheme, veltraStyleToEngine } from './style-map'
import {
  SHEET_DEFAULT_COL_WIDTH,
  SHEET_DEFAULT_ROW_HEIGHT,
  estimateWrapRowHeight,
} from './wrap-height'

export type { CellAddress, CellRange }

/** 右键菜单区域（与 ultra-ui GridCoords 三分类一致；引擎 region 同词汇表） */
export type SheetGridContextMenuKind = 'body' | 'row-header' | 'col-header'

export interface SheetGridContextMenuInfo {
  /** 视口（client）坐标 */
  x: number
  y: number
  kind: SheetGridContextMenuKind
  addr: CellAddress | null
  row?: number
  col?: number
}

export type ResolveDisplayValue = (
  addr: CellAddress,
  base: CellValue | undefined,
) => CellValue | undefined

export type ResolveCellStyleHook = (
  addr: CellAddress,
  baseStyle?: VeltraCellStyle,
) => VeltraCellStyle | undefined

/**
 * 动态单元格渲染 Hook（ADR-0004）：仅 body 格按格分发（行号列/列头不装配 body 节点，
 * 引擎不会回调；合并格传入锚点坐标）。返回 CustomLayout 布局对象（Text/Rect 基础
 * 形态，见 ./cell-layout）即接管该格内容绘制；返回 undefined 回落默认渲染。
 * base 为格显示值（公式缓存 → numFmt → 宿主 resolveDisplayValue 的管线产物，
 * 空串/null 归一为 undefined）。纯函数、同步返回、O(1) 查找；不写模型、不进快照。
 */
export type ResolveCellRenderer = (
  addr: CellAddress,
  base: CellValue | undefined,
) => CustomLayout | undefined

export interface SheetGridOptions {
  container: HTMLElement
  sheet: Sheet
  rows?: number
  cols?: number
  resolveDisplayValue?: ResolveDisplayValue
  resolveCellStyle?: ResolveCellStyleHook
  resolveCellRenderer?: ResolveCellRenderer
  onContextMenu?: (info: SheetGridContextMenuInfo) => void
  onEditStart?: (addr: CellAddress) => void
  onEditEnd?: (addr: CellAddress) => void
  interceptSelection?: () => boolean
  onSelectionIntercept?: (range: CellRange) => void
  readonly?: boolean
  showRowHeader?: boolean
  showColHeader?: boolean
}

const EDITOR_NAME = 'veltra-sheet-input'

/** infinite-table 引擎版 SheetGrid 门面 */
export class SheetGrid {
  private readonly sheet: Sheet
  private readonly container: HTMLElement
  private readonly onContextMenu?: (info: SheetGridContextMenuInfo) => void
  private readonly onEditStartCb?: (addr: CellAddress) => void
  private readonly onEditEndCb?: (addr: CellAddress) => void
  private readonly resolveDisplayValueHook?: ResolveDisplayValue
  private readonly resolveCellStyleHook?: ResolveCellStyleHook
  private readonly resolveCellRendererHook?: ResolveCellRenderer
  private readonly interceptSelection?: () => boolean
  private readonly onSelectionIntercept?: (range: CellRange) => void
  private readonly isReadonly: boolean
  private readonly showRowHeader: boolean
  private readonly showColHeader: boolean
  private rows: number
  private cols: number

  private table: ListTable | null = null
  /** 本次 build 前容器的既有子节点（teardown 时移除引擎新增的 canvas/浮层） */
  private ownedFrom = 0
  private readonly disposers: (() => void)[] = []
  private released = false
  private editingAddr: CellAddress | null = null
  /** 模型 → 引擎选区推送期间的防回环标记 */
  private syncingSelection = false
  /** 引用拾取（fx/函数弹框打开）：手势期只记录，抬手后一次回交 */
  private picking = false
  private gestureRange: CellRange | null = null
  private detachGesture: (() => void) | undefined
  /** 隐藏实例期间的整表置脏（merge/content-reset/axis/meta 整表类） */
  private dirty = false
  private visible = true
  /** 浮动图片 blob URL（data 字节 → objectURL，随 resync 重建） */
  private readonly blobUrls = new Map<string, string>()
  private resizeObserver: ResizeObserver | undefined
  private lastSize = { width: 0, height: 0 }
  /** ListTable 建表次数（含首次）：实例标记与重建计数的共同来源 */
  private tableBuilds = 0
  /** wrap 重估挂起行集合：cell-change（编辑提交/填充批量写/样式写）按去重行收敛，一次冲刷每行只重估一次 */
  private wrapDirtyRows: Set<number> | null = null
  private wrapFlushScheduled = false

  constructor(options: SheetGridOptions) {
    this.sheet = options.sheet
    this.container = options.container
    // options 仅扩张：已声明更小的模型尺寸（删行后）不被 props 下限撑回
    this.sheet.ensureTableSize(options.rows ?? 100, options.cols ?? 26)
    this.sheet.ensureTableSize(this.sheet.rowCount, this.sheet.colCount)
    this.rows = Math.max(this.sheet.rows, 1)
    this.cols = Math.max(this.sheet.cols, 1)
    this.onContextMenu = options.onContextMenu
    this.onEditStartCb = options.onEditStart
    this.onEditEndCb = options.onEditEnd
    this.resolveDisplayValueHook = options.resolveDisplayValue
    this.resolveCellStyleHook = options.resolveCellStyle
    this.resolveCellRendererHook = options.resolveCellRenderer
    this.interceptSelection = options.interceptSelection
    this.onSelectionIntercept = options.onSelectionIntercept
    this.isReadonly = options.readonly ?? false
    this.showRowHeader = options.showRowHeader ?? true
    this.showColHeader = options.showColHeader ?? true

    // wrap 估算在建表前写入模型（行高稀疏覆盖，引擎按 O(1) 取值）
    this.applyWrapEstimates()

    this.buildTable()
    this.bindSheetEvents()
    this.bindContainerEvents()
    this.observeResize()

    this.pushSelectionToTable(this.sheet.getSelection(), { scroll: true })
  }

  // ---- 对外门面（Vue 层使用面：constructor / release / setVisible；其余调试用） ----

  getTable(): ListTable | null {
    return this.table
  }

  /** ListTable 实例标记（每次建表递增，首建为 1）：pg-spec 断言容器 resize 后实例身份不变 */
  get tableInstanceMarker(): number {
    return this.tableBuilds
  }

  /** teardown 重建次数（不含首次建表）；容器 resize 直连引擎原地 resize 后应恒为 0 */
  get tableRebuildCount(): number {
    return this.tableBuilds - 1
  }

  getImageLayer(): unknown {
    return undefined
  }

  release(): void {
    if (this.released) return
    this.released = true
    this.resizeObserver?.disconnect()
    this.detachGesture?.()
    for (const dispose of this.disposers) dispose()
    this.disposers.length = 0
    this.teardownTable()
    this.revokeBlobUrls()
  }

  destroy(): void {
    this.release()
  }

  setVisible(on: boolean): void {
    this.visible = on
    if (on && this.dirty) {
      this.dirty = false
      this.fullResync()
    }
  }

  flushPending(): void {
    if (this.dirty) {
      if (this.visible) {
        this.dirty = false
        this.fullResync()
      }
    }
  }

  syncFromModel(): void {
    this.fullResync()
  }

  hitTestSheetAddr(x: number, y: number): CellAddress | null {
    const cell = this.table?.getCellAtRelativePosition(x, y)
    return cell ? { row: cell.row, col: cell.col } : null
  }

  undo(): boolean {
    return this.sheet.undo()
  }

  redo(): boolean {
    return this.sheet.redo()
  }

  // ---- 建表 ----

  private buildTable(): void {
    const width = this.container.clientWidth || 800
    const height = this.container.clientHeight || 600
    this.lastSize = { width, height }
    this.tableBuilds++
    this.ownedFrom = this.container.childNodes.length

    const editorRegistry = new EditorRegistry()
    if (!this.isReadonly) {
      editorRegistry.registerEditor(EDITOR_NAME, { name: EDITOR_NAME })
    }

    const options: ListTableOptions = {
      width,
      height,
      columns: this.buildColumns(),
      model: this.createTableModel(),
      resolveDisplayValue: (col, row) => this.displayText(col, row),
      resolveCellStyle: (col, row) => this.projectStyle(col, row),
      // 仅宿主提供 hook 时安装分发器（ADR-0004：无 hook 保持零开销）；引擎只对
      // body 格回调，行号列/列头天然不分发；非锚点格返回 null 回落内置渲染
      resolveCellRenderer: this.resolveCellRendererHook
        ? (col, row) => this.dispatchCellLayout(col, row)
        : undefined,
      resolveEditable: (col, row) => !this.isReadonly && !this.sheet.isCellReadonly({ row, col }),
      editorRegistry,
      editorMaxLength: 50000,
      editCellOnEnter: !this.isReadonly,
      ctrlMultiSelect: false,
      showRowHeader: this.showRowHeader,
      showColHeader: this.showColHeader,
      rowHeight: 28,
      headerHeight: 28,
      rowHeaderWidth: 46,
      defaultColWidth: SHEET_DEFAULT_COL_WIDTH,
      frozenColCount: this.sheet.frozen.cols,
      frozenRowCount: this.sheet.frozen.rows,
      mergeCells: this.mapMerges(),
      canResizeCol: () => !this.isReadonly,
      canResizeRow: () => !this.isReadonly,
      theme: this.sheetTheme(),
      hostOptions: { container: this.container, dpr: window.devicePixelRatio || 1 },
    }
    this.table = new ListTable(options)

    // 模型稀疏行高（wrap 估算/导入/拖拽产物），batchUpdate 收敛为单次重建
    const table = this.table
    table.batchUpdate(() => {
      for (const [row, height] of this.sheet.getRowHeights()) {
        table.setRowHeight(row, height)
      }
    })

    this.bindTableEvents()
    this.bindFill()
    this.syncImages()
    this.bindFloatDrag()
  }

  private sheetTheme(): ThemeOverride {
    return sheetChromeTheme()
  }

  private teardownTable(): void {
    const table = this.table
    this.table = null
    table?.destroy()
    // destroy 不销毁注入的 host：把引擎挂进容器的 canvas/浮层一并移除
    while (this.container.childNodes.length > this.ownedFrom) {
      this.container.removeChild(this.container.lastChild!)
    }
  }

  private buildColumns(): ListTableOptions['columns'] {
    return Array.from({ length: this.cols }, (_, col) => ({
      field: String(col),
      title: colIndexToName(col),
      width: this.sheet.getColWidth(col) ?? SHEET_DEFAULT_COL_WIDTH,
      ...(this.isReadonly ? {} : { editor: EDITOR_NAME }),
    }))
  }

  /** ultra-ui Sheet → 引擎 TableModel：基础值（公式格 = "=原文"）+ 写回命令栈 + 变更转发 */
  private createTableModel(): TableModel {
    return {
      rowCount: this.rows,
      getCellValue: (col, row) => this.baseValue(col, row),
      setCellValue: (col, row, value) => this.commitCellWrite(col, row, value),
      onCellChange: (listener) => {
        const off = this.sheet.on('cell-change', ({ addr }) => {
          listener({ col: addr.col, row: addr.row } as CellChangeEvent)
        })
        return off
      },
    }
  }

  /** 基础值：编辑初值口径（公式格显示 =原文，其余为原始 v；引擎编辑器直接取此值） */
  private baseValue(col: number, row: number): unknown {
    const anchor = this.sheet.merges.resolveAnchor({ row, col })
    const data = this.sheet.store.peekCell(anchor)
    if (!data) return undefined
    return data.f != null ? `=${data.f}` : data.v
  }

  /** 编辑提交 → 模型命令栈（可 undo）；空提交无内容则跳过；只读格回滚显示 */
  private commitCellWrite(col: number, row: number, value: unknown): void {
    const addr = { row, col }
    if (this.isReadonly || this.sheet.isCellReadonly(addr)) {
      this.table?.refreshCell(col, row)
      return
    }
    const next = value ?? null
    const anchor = this.sheet.merges.resolveAnchor(addr)
    const data = this.sheet.store.peekCell(anchor)
    const hadContent = data != null && ((data.v != null && data.v !== '') || data.f != null)
    if ((next === null || next === '') && !hadContent) return
    this.sheet.setCellValue(addr, next as CellValue)
  }

  /** 显示值：公式缓存 v → numFmt 格式化 → 宿主 resolveDisplayValue 覆盖（空串/null 归一 undefined） */
  private displayValue(col: number, row: number): CellValue | undefined {
    const addr = { row, col }
    const raw = this.sheet.getDisplayValue(addr)
    const numFmt = typeof raw === 'number' ? this.sheet.getEffectiveStyle(addr)?.numFmt : undefined
    const base = numFmt ? formatByNumFmt(raw as number, numFmt) : raw
    let out = (base ?? undefined) as CellValue | undefined
    if (this.resolveDisplayValueHook) {
      const resolved = this.resolveDisplayValueHook(addr, out)
      if (resolved !== undefined) out = resolved
    }
    return out === '' ? undefined : out
  }

  /** 显示文本：显示值字符串化（引擎取值管线入口） */
  private displayText(col: number, row: number): string {
    return String(this.displayValue(col, row) ?? '')
  }

  /**
   * customLayout 按格分发器（ADR-0004）：命中布局对象 → 引擎渲染器（同一布局对象
   * 缓存复用，热路径零分配）；否则 null 回落内置渲染。渲染不写模型、不进快照。
   */
  private dispatchCellLayout(col: number, row: number): CellRenderer | null {
    const layout = this.resolveCellRendererHook?.({ row, col }, this.displayValue(col, row))
    return layout ? cachedCellLayoutRenderer(layout) : null
  }

  /** 逐格样式：模型合成样式（列→行→格）→ 宿主 hook 覆盖 → 引擎 CellStyle 投影 */
  private projectStyle(col: number, row: number): ReturnType<typeof veltraStyleToEngine> {
    const addr = { row, col }
    const effective = this.sheet.getEffectiveStyle(addr)
    const merged = this.resolveCellStyleHook?.(addr, effective) ?? effective
    return veltraStyleToEngine(merged)
  }

  /** 模型合并区 → 引擎 mergeCells（跨冻结边界的丢弃并告警：引擎约定禁止） */
  private mapMerges(): EngineCellRange[] {
    const frozen = this.sheet.frozen
    const out: EngineCellRange[] = []
    for (const merge of this.sheet.merges.getMerges()) {
      const crosses =
        (merge.start.col < frozen.cols && merge.end.col >= frozen.cols) ||
        (merge.start.row < frozen.rows && merge.end.row >= frozen.rows)
      if (crosses) {
        console.warn('[veltra-grid] 合并区跨冻结边界，引擎不支持，已跳过', merge)
        continue
      }
      out.push({
        startCol: merge.start.col,
        startRow: merge.start.row,
        endCol: merge.end.col,
        endRow: merge.end.row,
      })
    }
    return out
  }

  // ---- 引擎事件 → 模型 / 回调 ----

  private bindTableEvents(): void {
    const table = this.table
    if (!table) return

    // 选区：引擎 → 模型回写（防回环）；引用拾取手势收敛
    table.onSelectionChange((snapshot) => this.handleTableSelection(snapshot))

    // 编辑生命周期：公式栏镜像
    table.onEditStart((event) => {
      this.editingAddr = { row: event.row, col: event.col }
      this.onEditStartCb?.(this.editingAddr)
    })
    table.onEditEnd(() => {
      const addr = this.editingAddr
      this.editingAddr = null
      if (addr) this.refreshFacing(addr)
      this.onEditEndCb?.(addr ?? { row: 0, col: 0 })
    })

    // 右键菜单：引擎 region 三分类与 ultra-ui kind 同词汇，坐标换算到视口
    table.onContextMenu((event) => {
      const rect = this.container.getBoundingClientRect()
      const info: SheetGridContextMenuInfo = {
        x: rect.left + event.x,
        y: rect.top + event.y,
        kind: event.region,
        addr: event.cell ? { row: event.cell.row, col: event.cell.col } : null,
        row: event.cell?.row,
        col: event.cell?.col,
      }
      queueMicrotask(() => this.onContextMenu?.(info))
    })

    // 行列尺寸：引擎 resize 终值写回模型（不进 undo，与 ultra-ui 口径一致）
    table.onColResizeEnd((event) => {
      this.sheet.setColWidth(event.col, event.width)
      this.reestimateColumnWrap(event.col)
    })
    table.onRowResizeEnd((event) => {
      this.sheet.setRowHeight(event.row, event.height)
    })
  }

  /** 填充柄：plugins generateFill + 模型批量写（一次 undo 单元）；双击柄自动填充 */
  private bindFill(): void {
    const table = this.table
    if (!table || this.isReadonly) return
    bindFillGeneration({
      table,
      autoComplete: true,
      read: (col, row) => this.sheet.getDisplayValue({ row, col }),
      write: (cells) => {
        const items = cells
          .filter((cell) => !this.sheet.isCellReadonly({ row: cell.row, col: cell.col }))
          .map((cell) => ({
            addr: { row: cell.row, col: cell.col },
            data: { v: cell.value as CellValue },
          }))
        if (items.length > 0) this.sheet.setCells(items)
      },
    })
  }

  private handleTableSelection(snapshot: SelectionSnapshot): void {
    if (this.syncingSelection) return
    // 读段取焦点段（引擎焦点恒在末段焦点格），不固定取首段（对齐 ultra-ui
    // readSelectedModelRange 取 ranges 末段的口径）
    const range = snapshot.ranges[snapshot.ranges.length - 1]
    if (!range) return
    const bounds = normalizeRange(range)
    const cellRange: CellRange = {
      start: { row: bounds.minRow, col: bounds.minCol },
      end: { row: bounds.maxRow, col: bounds.maxCol },
    }
    if (this.interceptSelection?.()) {
      // 引用拾取：手势期只记录最新范围，抬手后一次回交 + 恢复模型选区视觉
      this.gestureRange = cellRange
      return
    }
    this.sheet.selectRange(cellRange, this.resolveSelectionActive(cellRange, snapshot.focus))
  }

  /**
   * 整行/整列选区的活动格落在当前视口可见边缘（Excel 语义，对齐 ultra-ui
   * resolveSelectionActive）：回推时活动格已在视口内，不把视口拽到行末/列末；
   * 其余选区保持焦点格（区域终点语义）。有冻结时取带内首格（恒可见）。
   */
  private resolveSelectionActive(
    range: CellRange,
    focus: SelectionSnapshot['focus'],
  ): CellAddress | undefined {
    const spansAllCols = range.start.col === 0 && range.end.col >= this.cols - 1
    const spansAllRows = range.start.row === 0 && range.end.row >= this.rows - 1
    if (!spansAllCols && !spansAllRows) {
      return focus &&
        focus.row >= range.start.row &&
        focus.row <= range.end.row &&
        focus.col >= range.start.col &&
        focus.col <= range.end.col
        ? { row: focus.row, col: focus.col }
        : undefined
    }
    const table = this.table
    if (!table) return undefined
    const visible = table.getBodyVisibleCellRange()
    const col = spansAllCols
      ? this.sheet.frozen.cols > 0
        ? 0
        : visible.cols.start
      : range.start.col
    const row = spansAllRows
      ? this.sheet.frozen.rows > 0
        ? 0
        : visible.rows.start
      : range.start.row
    return {
      row: Math.min(Math.max(row, range.start.row), range.end.row),
      col: Math.min(Math.max(col, range.start.col), range.end.col),
    }
  }

  /** 引用拾取手势收敛：pointerup 时回交范围并恢复模型选区（不滚动） */
  private finishPickGesture(): void {
    if (!this.picking) return
    this.picking = false
    const range = this.gestureRange
    this.gestureRange = null
    if (range) this.onSelectionIntercept?.(range)
    this.pushSelectionToTable(this.sheet.getSelection(), { scroll: false })
  }

  // ---- 模型事件 → 引擎 ----

  private bindSheetEvents(): void {
    // cell-change：编辑提交 / 填充批量写（setCells 逐格发事件）/ 单元格样式写（含 wrap
    // 标志切换）统一入队，微任务按去重行集合一次冲刷重估（见 enqueueWrapRow）
    const offCellChange = this.sheet.on('cell-change', ({ addr }) => {
      this.enqueueWrapRow(addr.row)
    })
    const offMerge = this.sheet.on('merge-change', () => this.markOrApply(() => this.applyMerges()))
    const offReset = this.sheet.on('content-reset', () => this.markOrApply(() => this.fullResync()))
    const offAxis = this.sheet.on('axis-style-change', ({ axis, index }) => {
      this.markOrApply(() => this.refreshVisibleCells())
      // 行/列默认样式切换涉及 wrap 标志时重估受影响行：行样式=该行；列样式=该列有数据行
      if (axis === 'row') {
        this.enqueueWrapRow(index)
      } else {
        for (const row of this.sheet.store.rowsForColumn(index)) {
          this.enqueueWrapRow(row)
        }
      }
    })
    const offMeta = this.sheet.on('meta-change', ({ addr }) => {
      if (addr) {
        this.table?.refreshCell(addr.col, addr.row)
      } else {
        this.markOrApply(() => this.fullResync())
      }
    })
    const offFrozen = this.sheet.on('frozen-change', () => this.applyFrozen())
    const offSelection = this.sheet.on('selection-change', (state) => {
      this.pushSelectionToTable(state, { scroll: true })
    })
    const offImages = this.sheet.on('image-change', () => this.syncImages())
    this.disposers.push(
      offCellChange,
      offMerge,
      offReset,
      offAxis,
      offMeta,
      offFrozen,
      offSelection,
      offImages,
    )
  }

  /** 隐藏实例：整表类变更只置脏，激活时一次性冲刷 */
  private markOrApply(apply: () => void): void {
    if (this.visible) {
      apply()
    } else {
      this.dirty = true
    }
  }

  private applyMerges(): void {
    const table = this.table
    if (!table) return
    table.setMergeCells(this.mapMerges())
  }

  private applyFrozen(): void {
    const table = this.table
    if (!table) return
    const frozen = this.sheet.frozen
    table.setFrozenColCount(frozen.cols)
    table.setFrozenRowCount(frozen.rows)
    // 冻结变化后既有合并区可能跨界，重放过滤
    this.applyMerges()
  }

  /** 整表重同步：合并/行列尺寸/可视格刷新/选区回驱/图片重放 */
  private fullResync(): void {
    const table = this.table
    if (!table) return
    this.applyMerges()
    for (const [col, width] of this.sheet.getColWidths()) {
      if (col < this.cols) table.setColWidth(col, width)
    }
    for (const [row, height] of this.sheet.getRowHeights()) {
      table.setRowHeight(row, height)
    }
    this.refreshVisibleCells()
    this.applyFrozen()
    this.pushSelectionToTable(this.sheet.getSelection(), { scroll: false })
    this.syncImages()
  }

  private refreshVisibleCells(): void {
    const table = this.table
    if (!table) return
    const visible = table.getBodyVisibleCellRange()
    for (let row = visible.rows.start; row <= visible.rows.end; row++) {
      for (let col = visible.cols.start; col <= visible.cols.end; col++) {
        table.refreshCell(col, row)
      }
    }
  }

  /** 邻格重刷（共享边框消费方）：addr 四周一圈 */
  private refreshFacing(addr: CellAddress): void {
    const table = this.table
    if (!table) return
    const merge = this.sheet.merges.getMergeAt(addr)
    const minCol = merge?.start.col ?? addr.col
    const maxCol = merge?.end.col ?? addr.col
    const minRow = merge?.start.row ?? addr.row
    const maxRow = merge?.end.row ?? addr.row
    for (let row = Math.max(0, minRow - 1); row <= Math.min(this.rows - 1, maxRow + 1); row++) {
      for (let col = Math.max(0, minCol - 1); col <= Math.min(this.cols - 1, maxCol + 1); col++) {
        table.refreshCell(col, row)
      }
    }
  }

  // ---- 选区模型 → 引擎 ----

  private pushSelectionToTable(
    state: { activeCell: CellAddress | null; ranges: CellRange[] },
    opts: { scroll?: boolean } = {},
  ): void {
    const table = this.table
    if (!table) return
    const range =
      state.ranges[0] ??
      (state.activeCell ? { start: state.activeCell, end: state.activeCell } : null)
    if (!range) {
      this.syncingSelection = true
      try {
        table.clearSelection()
      } finally {
        this.syncingSelection = false
      }
      return
    }
    // clamp 到网格范围（越界段钳制到表尺寸，口径同 ultra-ui pushSelectionToTable）
    const start = {
      row: Math.min(Math.max(range.start.row, 0), this.rows - 1),
      col: Math.min(Math.max(range.start.col, 0), this.cols - 1),
    }
    const end = {
      row: Math.min(Math.max(range.end.row, 0), this.rows - 1),
      col: Math.min(Math.max(range.end.col, 0), this.cols - 1),
    }
    // 整行/整列：钳制后扩满全轴（对齐 ultra-ui 的 spansAll 扩展——那边扩进行号列/列头带，
    // 本引擎表头高亮由整行/整列全覆盖段派生），保证表头带仍在选区内且高亮可见
    const spansAllCols = range.start.col === 0 && range.end.col >= this.cols - 1
    const spansAllRows = range.start.row === 0 && range.end.row >= this.rows - 1
    if (spansAllCols) {
      start.col = 0
      end.col = this.cols - 1
    }
    if (spansAllRows) {
      start.row = 0
      end.row = this.rows - 1
    }
    // 单格在合并区内 → 扩包围盒（点按合并区即整块选中）
    const isSingle = start.row === end.row && start.col === end.col
    let mergeExpanded = false
    if (isSingle) {
      const merge = this.sheet.merges.getMergeAt(start)
      if (merge) {
        start.row = merge.start.row
        start.col = merge.start.col
        end.row = merge.end.row
        end.col = merge.end.col
        mergeExpanded = true
      }
    }
    const active = state.activeCell
      ? {
          row: Math.min(Math.max(state.activeCell.row, 0), this.rows - 1),
          col: Math.min(Math.max(state.activeCell.col, 0), this.cols - 1),
        }
      : start
    // active 落在合并覆盖格上时对齐主格（焦点语义）
    const activeAnchor = this.sheet.merges.resolveAnchor(active)

    this.syncingSelection = true
    try {
      table.applyExternalSelection({
        ranges: [
          {
            start: { col: start.col, row: start.row },
            end: { col: end.col, row: end.row },
          },
        ],
        focus: { col: activeAnchor.col, row: activeAnchor.row },
      })
    } finally {
      this.syncingSelection = false
    }
    // VTable 版语义：目标格不可见时滚动跟随（applyExternalSelection 恒不滚动）
    if (opts.scroll !== false) {
      const visible = table.getBodyVisibleCellRange()
      const outside =
        activeAnchor.row < visible.rows.start ||
        activeAnchor.row > visible.rows.end ||
        activeAnchor.col < visible.cols.start ||
        activeAnchor.col > visible.cols.end
      if (outside && !mergeExpanded) {
        table.scrollToCell({ col: activeAnchor.col, row: activeAnchor.row })
      }
    }
  }

  // ---- 浮动图片：模型 → 引擎 FloatObjectLayer（展示同步）；拖拽落点写回模型 ----

  /**
   * 浮动图片交互接线（建表后一次）：只读口径透传给浮动层（只读可选中、不启用拖拽）；
   * 拖拽结束把落点换算的新锚点经 sheet.updateImage 写回模型（进命令栈可 undo），
   * image-change → syncImages 回流对齐展示。命中拦截在引擎指针路由内完成
   * （图片命中不落入单元格选区）。
   */
  private bindFloatDrag(): void {
    const table = this.table
    if (!table) return
    const layer = table.floatObjects
    layer.isReadonly = this.isReadonly
    layer.onDragEnd(({ id, anchor }) => {
      this.sheet.updateImage(id, {
        anchor: {
          from: {
            row: anchor.from.row,
            col: anchor.from.col,
            offsetX: anchor.offsetX,
            offsetY: anchor.offsetY,
          },
          to: { row: anchor.to.row, col: anchor.to.col },
        },
      })
    })
  }

  private syncImages(): void {
    const table = this.table
    if (!table) return
    const images = this.sheet.getImages()
    if (images.length === 0 && !this.blobUrls.size) return
    const layer = table.floatObjects
    const alive = new Set<string>()
    for (const image of images) {
      alive.add(image.id)
      const src = image.src ?? this.blobUrlFor(image.id, image.data, image.type)
      const anchor = {
        from: { col: image.anchor.from.col, row: image.anchor.from.row },
        to: {
          col: image.anchor.to?.col ?? image.anchor.from.col,
          row: image.anchor.to?.row ?? image.anchor.from.row,
        },
        offsetX: image.anchor.from.offsetX ?? 0,
        offsetY: image.anchor.from.offsetY ?? 0,
      }
      const extras = {
        ...(image.width != null && image.height != null
          ? { size: { width: image.width, height: image.height } }
          : {}),
        ...(image.altText != null ? { alt: image.altText } : {}),
        ...(image.title != null ? { title: image.title } : {}),
      }
      if (layer.get(image.id)) {
        layer.update(image.id, { kind: 'image', anchor, src, ...extras })
      } else {
        layer.add({ id: image.id, kind: 'image', anchor, src, ...extras })
      }
    }
    for (const id of this.blobUrls.keys()) {
      if (!alive.has(id)) {
        layer.remove(id)
        const url = this.blobUrls.get(id)
        if (url) {
          URL.revokeObjectURL(url)
          this.blobUrls.delete(id)
        }
      }
    }
  }

  private blobUrlFor(id: string, data: Uint8Array, type: string): string {
    const existing = this.blobUrls.get(id)
    if (existing) return existing
    const blob = new Blob([data], { type: `image/${type}` })
    const url = URL.createObjectURL(blob)
    this.blobUrls.set(id, url)
    return url
  }

  private revokeBlobUrls(): void {
    for (const url of this.blobUrls.values()) URL.revokeObjectURL(url)
    this.blobUrls.clear()
  }

  // ---- wrap 行高估算与动态重估 ----

  /**
   * 单行 wrap 行高扫描：行内含 wrap 格（样式 wrap 标志或文本含 \n）时返回最大估算值，
   * 否则 null。建表前（模型列宽）与动态期（引擎实测列宽）共享同一扫描。
   * 合并区只算锚点；跨行合并不估算；跨列合并宽度按跨度合计。
   */
  private scanWrapRowHeight(
    row: number,
    getColWidth: (col: number) => number,
  ): { maxHeight: number } | null {
    if (row < 0 || row >= this.rows) return null
    let maxHeight = 0
    let hasWrap = false
    for (const [col, data] of this.sheet.store.peekRow(row)) {
      if (col >= this.cols) continue
      const addr = { row, col }
      const merge = this.sheet.merges.getMergeAt(addr)
      if (merge && (merge.start.row !== row || merge.start.col !== col)) continue // 非锚点
      if (merge && merge.end.row > merge.start.row) continue // 跨行合并不估算
      const text = data.v == null ? '' : String(data.v)
      const style = this.sheet.getEffectiveStyle(addr)
      const wrap = style?.align?.wrap === true || text.includes('\n')
      if (!wrap || text === '') continue
      hasWrap = true
      let colWidth = getColWidth(col)
      if (merge && merge.end.col > merge.start.col) {
        for (let c = merge.start.col + 1; c <= merge.end.col; c++) {
          colWidth += getColWidth(c)
        }
      }
      const height = estimateWrapRowHeight({
        text,
        colWidth,
        fontSizePt: style?.font?.size,
      })
      if (height > maxHeight) maxHeight = height
    }
    return hasWrap ? { maxHeight } : null
  }

  /** 建表前：只扫稀疏行，wrap/含 \n 的行按估算抬升模型行高（只升不降） */
  private applyWrapEstimates(): void {
    for (const row of this.sheet.store.rowKeys()) {
      const scanned = this.scanWrapRowHeight(
        row,
        (col) => this.sheet.getColWidth(col) ?? SHEET_DEFAULT_COL_WIDTH,
      )
      if (!scanned) continue
      const estimated = Math.max(SHEET_DEFAULT_ROW_HEIGHT, scanned.maxHeight)
      const current = this.sheet.getRowHeight(row) ?? SHEET_DEFAULT_ROW_HEIGHT
      if (estimated > current) this.sheet.setRowHeight(row, estimated)
    }
  }

  /** 列宽拖拽后：该列有数据的行整行重估（经挂起集合微任务收敛，口径同 cell-change） */
  private reestimateColumnWrap(col: number): void {
    for (const row of this.sheet.store.rowsForColumn(col)) {
      this.enqueueWrapRow(row)
    }
  }

  /**
   * 单行动态重估（cell 编辑提交 / 填充批量写 / wrap 样式切换 / 列宽拖拽后）。
   * 行内无 wrap 格则跳过（保留手动/默认行高）；只升不降：
   * 已有行高（导入/拖拽/先前估算）不低于新估算时保留，不压矮。
   */
  private syncWrapRowHeight(row: number): void {
    const table = this.table
    if (!table) return
    const scanned = this.scanWrapRowHeight(row, (col) => table.getColWidth(col))
    if (!scanned) return
    const estimated = Math.max(SHEET_DEFAULT_ROW_HEIGHT, scanned.maxHeight)
    const current = this.sheet.getRowHeight(row) ?? SHEET_DEFAULT_ROW_HEIGHT
    if (estimated <= current) return
    this.sheet.setRowHeight(row, estimated)
    table.setRowHeight(row, estimated)
  }

  /** 挂起一行待重估；微任务冲刷（对齐 ultra-ui grid-sync-manager 批量冲刷：去重行集合一次收敛） */
  private enqueueWrapRow(row: number): void {
    if (this.released || row < 0 || row >= this.rows) return
    if (!this.wrapDirtyRows) this.wrapDirtyRows = new Set()
    this.wrapDirtyRows.add(row)
    if (this.wrapFlushScheduled) return
    this.wrapFlushScheduled = true
    queueMicrotask(() => this.flushWrapRows())
  }

  private flushWrapRows(): void {
    this.wrapFlushScheduled = false
    const rows = this.wrapDirtyRows
    this.wrapDirtyRows = null
    if (!rows || this.released) return
    for (const row of rows) this.syncWrapRowHeight(row)
  }

  // ---- 容器级接线（键盘/滚轮/焦点/拾取手势/尺寸自适应） ----

  private bindContainerEvents(): void {
    const container = this.container
    container.tabIndex = 0
    // 点画布聚焦容器（键盘导航可达）；编辑器/弹层内焦点不夺
    const onPointerDown = (): void => {
      if (!container.contains(document.activeElement)) container.focus()
      if (this.interceptSelection?.()) this.picking = true
    }
    container.addEventListener('pointerdown', onPointerDown)
    this.disposers.push(() => container.removeEventListener('pointerdown', onPointerDown))

    // 引用拾取手势结束：window 级抬起兜底（拖出容器）
    const onPointerUp = (): void => this.finishPickGesture()
    window.addEventListener('pointerup', onPointerUp)
    this.detachGesture = () => window.removeEventListener('pointerup', onPointerUp)

    // 滚轮 → scrollBy（引擎只接触控/键盘，滚轮归宿主）；shift 纵转横（Chrome 不自动换轴）
    const onWheel = (event: WheelEvent): void => {
      const table = this.table
      if (!table) return
      event.preventDefault()
      if (event.shiftKey && event.deltaX === 0 && event.deltaY !== 0) {
        table.scrollBy(event.deltaY, 0)
      } else {
        table.scrollBy(event.deltaX, event.deltaY)
      }
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    this.disposers.push(() => container.removeEventListener('wheel', onWheel))

    // 键位：Ctrl/Cmd+Z 撤销、Shift+Z / Ctrl+Y 重做、Ctrl/Cmd+A 全选（fx/编辑器输入不拦）
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        if (this.undo()) event.preventDefault()
      } else if ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey)) {
        if (this.redo()) event.preventDefault()
      } else if (key === 'a') {
        this.table?.selectAll()
        event.preventDefault()
      }
    }
    container.addEventListener('keydown', onKeyDown)
    this.disposers.push(() => container.removeEventListener('keydown', onKeyDown))
  }

  /**
   * 容器尺寸变化 → ResizeObserver 直连引擎 resize（P5 原地自适应路径）：
   * 引擎视口尺寸构造后可变（ListTable.resize），不再防抖 teardown 重建整表，
   * 滚动位置与选区由引擎在 resize 中保留。2px 阈值滤掉滚动条抖动，rAF 收敛同帧多次回调。
   */
  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return
    let frame = 0
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (
          Math.abs(width - this.lastSize.width) < 2 &&
          Math.abs(height - this.lastSize.height) < 2
        ) {
          continue
        }
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => this.applyViewportSize(width, height))
      }
    })
    this.resizeObserver.observe(this.container)
  }

  /** 应用容器新尺寸：引擎原地 resize（不 teardown 重建） */
  private applyViewportSize(width: number, height: number): void {
    if (this.released || !this.table) return
    this.lastSize = { width, height }
    this.table.resize(width, height)
  }
}
