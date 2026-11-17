// ListTable 主类：布局计算、虚拟滚动窗口、冻结区域划分、合并单元格、行列头渲染，
// 经 RenderHost 窄接口提交渲染，实现 TableEngine（EngineAssembly + 表格领域面）与 GridReadView。
//
// 按职责拆分的协作模块（包内实现细节，不进公共入口）：
// - internal/table-states.ts：4 个内聚状态容器（几何/场景/媒体/交互）与 slot painter 承载节点
// - list-table-scene.ts：场景全量重建与滚动帧增量窗口、固定容器组装配、行列头装配、溢出走廊支撑
// - list-table-media.ts：media 层与 ImageService 接线、图表格出图路由
// - list-table-interaction.ts：指针/触摸/键盘/contextmenu/列头点击事件接线与 sky 浮层刷新
// - list-table-internal.ts：共享常量与纯辅助（cellKey/HEADER_COORD/合并区越界校验）

import {
  clampFrozenCount,
  computeColOffsets,
  computeRowOffsets,
  extendsTheme,
  ImageService,
  InertiaScroller,
  MergeCellMap,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  NativeScrollbarHost,
  normalizeCellRange,
  PainterRegistry,
  PluginHost,
  resolveCellX,
  resolveCellYFromOffsets,
  resolveScrollbarConfig,
  sanitizeMerges,
  ScrollManager,
  SelectionState,
  themeCellBase,
  TouchScrollTracker,
  unionRegions,
  warnMergeConflicts,
  type CellRange,
  type ColResizeEndEvent,
  type LoadedImage,
  type RowResizeEndEvent,
  type ScrollDelta,
  type ScrollState,
  type SelectionListener,
  type SelectionRange,
  type SelectionSnapshot,
  type TableTheme,
  type ThemeOverride,
  type WindowRange,
} from '@infinitable/grid'
import type {
  EngineCapabilities,
  EnginePlugin,
  GridReadView,
  PainterRegistration,
  PainterSlot,
} from '@infinitable/protocol'
import { createRenderHost, type Region, type RenderHost } from '@infinitable/render'

import { TextAdvanceTable, type CellNode } from './cell-node'
import {
  cellStyleFont,
  projectCellStyle,
  type CellBorder,
  type CellBorderEdge,
  type CellStyle,
} from './cell-style'
import { CellValuePipeline } from './cell-value'
import { EditManager, type EditCommitMove } from './editing/edit-manager'
import type { TextEditorHost } from './editing/text-editor'
import { EditorRegistry } from './editor-registry'
import type { TableEngine } from './engine'
import type {
  FillDragEndListener,
  FillHandleDoubleClickListener,
  FillHandleDownListener,
} from './fill-handle'
import { FloatObjectLayer } from './float/float-object-layer'
import { InteractionOverlay, type HighlightRange } from './interaction-overlay'
import {
  GroundPaintersNode,
  OverlayPaintersNode,
  type TableGeometryState,
  type TableInteractionState,
  type TableMediaState,
  type TableSceneState,
} from './internal/table-states'
import { nextActiveCell } from './keyboard-navigation'
import {
  bindInteractionEvents,
  cellAt,
  cellRectInViewport,
  editorCellRect,
  ensureCellVisible,
  refreshOverlay,
} from './list-table-interaction'
import { assertMergesWithinTable, cellKey, HEADER_COORD } from './list-table-internal'
import {
  onImageServiceLoad,
  refreshChartCell,
  refreshImageCell,
  syncImageCellInset,
  updateImageWindow,
} from './list-table-media'
import {
  appendCell,
  dataColBands,
  effectiveBorder,
  headerStyles,
  markRowCorridorInterior,
  overflowSourceCol,
  overflowSourceColRight,
  rebuildScene,
  resizeSceneGroups,
  resolveOffWindowOverflowSource,
  syncCellGroupAndOverflowOrder,
  textOverflowLimits,
  updateSceneWindow,
} from './list-table-scene'
import { MediaCache } from './media/media-cache'
import { ModelBinding } from './model-binding'
import type {
  CanvasDocSource,
  CellChangeEvent,
  CellLinkClickListener,
  CellLinkHoverListener,
  CellLinkLeaveListener,
  CellRef,
  ColHeaderClickListener,
  ColumnDefine,
  ContextMenuListener,
  EditEndEvent,
  EditStartEvent,
  ImageLinkClickListener,
  ListTableOptions,
} from './types'

/** onScrollFrame 帧级同步回调：滚动帧上带最新滚动位置触发（同帧多次滚动只触发一次） */
export type ScrollFrameListener = (state: ScrollState) => void

/** 行高/列宽批量入参形态 */
type IndexSizeMap =
  | ReadonlyMap<number, number>
  | Iterable<readonly [number, number]>
  | Record<number, number>

/** 统一遍历 Map / Iterable<[index, size]> / Record<index, size> */
function forEachIndexSize(
  input: IndexSizeMap,
  visitor: (index: number, size: number) => void,
): void {
  if (typeof (input as Iterable<readonly [number, number]>)[Symbol.iterator] === 'function') {
    for (const entry of input as Iterable<readonly [number, number]>) {
      visitor(entry[0], entry[1])
    }
    return
  }
  const record = input as Record<string, number>
  for (const key of Object.keys(record)) {
    if (key === '') {
      continue
    }
    const index = Number(key)
    const size = record[key]
    if (Number.isInteger(index) && String(index) === key && size !== undefined) {
      visitor(index, size)
    }
  }
}

function sameBorderEdge(a: CellBorderEdge | undefined, b: CellBorderEdge | undefined): boolean {
  if (a === b) {
    return true
  }
  if (!a || !b) {
    return false
  }
  return a.width === b.width && a.color === b.color && a.style === b.style && a.grid === b.grid
}

/** 边框浅值相等判定：避免每次投影新对象时误触发邻格级联刷新 */
function sameCellBorder(a: CellBorder | undefined, b: CellBorder | undefined): boolean {
  if (a === b) {
    return true
  }
  return (
    sameBorderEdge(a?.top, b?.top) &&
    sameBorderEdge(a?.right, b?.right) &&
    sameBorderEdge(a?.bottom, b?.bottom) &&
    sameBorderEdge(a?.left, b?.left)
  )
}

/** 宿主环境 dpr 缺省读取 */
function resolveHostDpr(): number {
  const win = (globalThis as { window?: { devicePixelRatio?: number } | undefined }).window
  return win?.devicePixelRatio || 1
}

/** 溢出源节点的全局失效矩形：覆盖本格与双向溢出走廊 */
function overflowExtentRegion(node: CellNode, minX: number, maxX: number): Region {
  const left = Math.min(0, minX)
  return {
    x: node.x + left,
    y: node.y,
    width: Math.max(node.width, maxX) - left,
    height: node.height,
  }
}

export class ListTable implements TableEngine, GridReadView {
  /** 渲染宿主（注入或缺省创建） */
  readonly host: RenderHost
  private readonly ownHost: boolean
  /** @internal 取值管线 */
  readonly pipeline: CellValuePipeline
  /** @internal 唯一滚动状态源 */
  readonly scroll = new ScrollManager()
  private readonly binding: ModelBinding | null = null
  /** 列定义集合（与 options.columns 同一数组引用，运行时可变） */
  readonly columns: ColumnDefine[]
  /** @internal 滚动缓冲行/列数 */
  readonly overscanRows: number
  readonly overscanCols: number
  private tableWidth: number
  private tableHeight: number
  get width(): number {
    return this.tableWidth
  }
  get height(): number {
    return this.tableHeight
  }
  /** @internal 生效主题 */
  theme: TableTheme
  readonly rowHeight: number
  /** 列头带高 */
  readonly headerHeight: number
  /** @internal 行号列宽 */
  readonly rowHeaderWidth: number
  /** 图片资源服务 */
  readonly imageService: ImageService
  private readonly explicitHostDpr: number | undefined
  private readonly resolveDpr: () => number
  /** @internal 浮动对象层（首次访问 floatObjects 时惰性创建） */
  floatLayer: FloatObjectLayer | null = null
  /** 协议能力声明面 */
  readonly capabilities: EngineCapabilities
  /** @internal 几何状态 */
  readonly geometryState: TableGeometryState
  /** @internal 场景状态 */
  readonly sceneState: TableSceneState
  /** @internal 媒体状态 */
  readonly mediaState: TableMediaState
  /** @internal 交互状态 */
  readonly interactionState: TableInteractionState
  /** @internal 插件宿主 */
  private readonly pluginHost: PluginHost
  /** @internal 已销毁守卫 */
  destroyed = false
  /** 编辑状态唯一源 */
  readonly editManager: EditManager
  /** 编辑器注册表 */
  readonly editorRegistry: EditorRegistry
  private readonly container: HTMLElement | undefined
  private readonly cursorContainer: HTMLElement | undefined

  /** @internal 滚动条拖拽提交任务（稳定引用供帧调度去重） */
  readonly scrollbarCommitTask = () => {
    const session = this.interactionState.scrollbarDrag
    if (!session) {
      return
    }
    const target = session.pendingOffset
    if (target === undefined) {
      return
    }
    session.pendingOffset = undefined
    if (session.axis === 'vertical') {
      this.setScrollTop(target)
    } else {
      this.setScrollLeft(target)
    }
  }

  /** @internal 同帧多次滚动只收敛出一次 onScrollFrame 广播 */
  private readonly scrollFrameTask = () => {
    const state = this.scroll.state
    for (const listener of this.interactionState.scrollFrameListeners) {
      listener(state)
    }
  }

  constructor(public readonly options: ListTableOptions) {
    this.tableWidth = options.width
    this.tableHeight = options.height
    this.columns = options.columns
    this.overscanRows = Math.max(0, Math.floor(options.overscanRows ?? 0))
    this.overscanCols = Math.max(0, Math.floor(options.overscanCols ?? 0))
    this.theme = extendsTheme(options.theme)

    const scrollbarConfig = resolveScrollbarConfig(options.scrollbar)
    const nativeScrollbar =
      scrollbarConfig.mode === 'native'
        ? new NativeScrollbarHost({
            parent: options.host ? undefined : options.hostOptions?.container,
            width: this.width,
            height: this.height,
            scroll: this.scroll,
          })
        : null

    this.rowHeight = options.rowHeight ?? this.theme.rowHeight
    this.headerHeight =
      options.showColHeader === false ? 0 : (options.headerHeight ?? this.theme.headerHeight)
    this.rowHeaderWidth =
      options.showRowHeader === false ? 0 : (options.rowHeaderWidth ?? this.theme.rowHeaderWidth)

    const defaultColWidth = options.defaultColWidth ?? this.theme.defaultColWidth
    const colWidths = this.columns.map((col) => col.width ?? defaultColWidth)
    const colOffsets = computeColOffsets(colWidths)
    this.pipeline = new CellValuePipeline({
      columns: options.columns,
      records: options.records,
      model: options.model,
      resolveDisplayValue: options.resolveDisplayValue,
      rowCount: options.rowCount,
    })
    const rowHeights = new Map<number, number>()
    if (options.rowHeights) {
      forEachIndexSize(options.rowHeights, (row, height) => {
        if (!Number.isInteger(row) || row < 0 || row >= this.pipeline.rowCount) {
          return
        }
        if (!Number.isFinite(height) || height <= 0) {
          return
        }
        const next = Math.max(MIN_ROW_HEIGHT, height)
        if (next === this.rowHeight) {
          rowHeights.delete(row)
        } else {
          rowHeights.set(row, next)
        }
      })
    }
    const rowOffsets = computeRowOffsets(this.pipeline.rowCount, this.rowHeight, rowHeights)
    const frozenColCount = clampFrozenCount(options.frozenColCount ?? 0, this.columns.length)
    const frozenRowCount = clampFrozenCount(options.frozenRowCount ?? 0, this.pipeline.rowCount)
    const sanitizedMerges = sanitizeMerges(options.mergeCells)
    warnMergeConflicts(sanitizedMerges.conflicts, 'ListTable constructor')
    const mergeCells = new MergeCellMap(sanitizedMerges.ranges)
    assertMergesWithinTable(mergeCells.ranges, this.columns.length, this.pipeline.rowCount)

    this.geometryState = {
      colOffsets,
      colWidths,
      rowHeights,
      rowOffsets,
      frozenColCount,
      frozenRowCount,
      frozenColsWidth: colOffsets[frozenColCount] ?? 0,
      frozenRowsHeight: rowOffsets[frozenRowCount] ?? 0,
      mergeCells,
      rows: { start: 0, end: 0 },
      cols: { start: 0, end: 0 },
      columnStyles: new Map<number, CellStyle>(),
    }

    this.resolveDpr = options.resolveDevicePixelRatio ?? resolveHostDpr
    const hostDoc =
      options.doc ?? (globalThis as { document?: CanvasDocSource | undefined }).document ?? null
    this.host =
      options.host ??
      createRenderHost({
        width: this.width,
        height: this.height,
        dpr: this.resolveDpr(),
        ...options.hostOptions,
        createCanvas:
          options.hostOptions?.createCanvas ??
          (hostDoc ? () => hostDoc.createElement('canvas') : undefined),
        container: nativeScrollbar?.viewportElement ?? options.hostOptions?.container,
        eventsTarget: nativeScrollbar?.eventsTarget ?? options.hostOptions?.eventsTarget,
      })
    this.explicitHostDpr = options.hostOptions?.dpr
    const hostDpr = this.explicitHostDpr ?? this.resolveDpr()
    this.ownHost = !options.host

    const body = this.host.createLayer({ kind: 'body', consumption: 'regions' })
    body.root.hitTestChildren = false
    body.root.pickable = true
    body.root.width = this.width
    body.root.height = this.height
    const sky = this.host.createLayer({ kind: 'sky', consumption: 'always-full' })
    sky.root.hitTestChildren = false

    this.sceneState = {
      body,
      sky,
      ground: null,
      media: null,
      groups: null,
      mediaGroups: null,
      cellNodes: new Map(),
      colHeaderNodes: new Map(),
      rowHeaderNodes: new Map(),
      cornerNode: null,
      frameNode: null,
      headerGroup: null,
      underlayNode: null,
      painters: new PainterRegistry(),
      underlayPaintersNode: null,
      overlayPaintersNode: null,
      sceneInitialized: false,
      textAdvances: new TextAdvanceTable((char, font) => this.host.measure(char, font).width),
      batchDepth: 0,
      batchRegions: [],
      colOffsetsDirty: false,
      rowOffsetsDirty: false,
      geometryDirty: false,
    }

    this.imageService = new ImageService(options.imageServiceOptions)
    this.imageService.onImageLoad((e) => onImageServiceLoad(this, e))
    this.mediaState = {
      mediaCache: new MediaCache<LoadedImage>(),
      imageCellNodes: new Map(),
      chartCellNodes: new Map(),
      chartRenderTasks: new Map(),
      hostDpr,
    }

    const inertia = new InertiaScroller(
      (dx, dy) => this.scroll.scrollBy(dx, dy),
      (task) => this.host.requestFrame(task),
    )
    const overlay = new InteractionOverlay(
      sky.root,
      {
        cellRect: (col, row) => cellRectInViewport(this, col, row),
        bodyViewport: () => this.bodyViewport,
        canvas: () => ({ width: this.width, height: this.height }),
      },
      this.theme.interaction,
    )

    this.interactionState = {
      selection: new SelectionState(),
      overlay,
      touchTracker: new TouchScrollTracker(),
      inertia,
      resizeSession: null,
      resizeLine: null,
      scrollbarDrag: null,
      scrollbarConfig,
      nativeScrollbar,
      scrollbarVisible: scrollbarConfig.visibility === 'always',
      scrollbarHover: null,
      scrollbarHideTimer: null,
      pointerSessionRelease: null,
      selecting: false,
      dragAnchor: null,
      headerDrag: null,
      headerHighlightSignature: '',
      overlayHadContent: false,
      highlightRanges: [],
      selectionAnchor: null,
      fillDrag: null,
      lastFillHandleTap: null,
      fillHandleDoubleTap: false,
      linkHover: null,
      pointerDownCell: null,
      pointerDownColHeader: null,
      lastTap: null,
      pointerDownAt: null,
      editPickMode: false,
      eventUnsubscribers: [],
      contextMenuListeners: new Set(),
      cellLinkHoverListeners: new Set(),
      cellLinkLeaveListeners: new Set(),
      cellLinkClickListeners: new Set(),
      imageLinkClickListeners: new Set(),
      scrollFrameListeners: new Set(),
      cellChangeListeners: new Set(),
      editStartListeners: new Set(),
      editEndListeners: new Set(),
      colResizeEndListeners: new Set(),
      rowResizeEndListeners: new Set(),
      fillHandleDownListeners: new Set(),
      fillDragEndListeners: new Set(),
      fillHandleDoubleClickListeners: new Set(),
      colHeaderClickListeners: new Set(),
    }

    this.capabilities = {
      gridRead: this,
      gridData: this,
      writableGridData: this,
    }
    this.pluginHost = new PluginHost(this)

    this.scroll.setViewportSize(
      this.viewportWidth - this.geometryState.frozenColsWidth,
      this.viewportHeight - this.geometryState.frozenRowsHeight,
    )
    this.scroll.setContentSize(
      this.contentWidth - this.geometryState.frozenColsWidth,
      this.contentHeight - this.geometryState.frozenRowsHeight,
    )
    nativeScrollbar?.updateScrollRange()
    this.scroll.onScroll((_state, delta) => this.onScroll(delta))
    updateImageWindow(this)
    if (options.model) {
      this.binding = new ModelBinding(options.model, (change) =>
        this.refreshCell(change.col, change.row),
      )
      this.binding.attach()
    }

    this.container = nativeScrollbar?.viewportElement ?? options.hostOptions?.container
    this.cursorContainer = options.hostOptions?.container ?? this.container
    const restoreFocusTarget = nativeScrollbar ? options.hostOptions?.container : this.container
    this.editorRegistry = options.editorRegistry ?? new EditorRegistry()
    this.editManager = new EditManager({
      columns: options.columns,
      registry: this.editorRegistry,
      resolveEditable: options.resolveEditable,
      editorMaxLength: options.editorMaxLength,
      writeTarget: {
        canWrite: (col, row) => this.canWriteCell(col, row),
        write: (col, row, value) => this.writeCell(col, row, value),
      },
      resolveValue: (col, row) => this.pipeline.resolveValue(col, row),
      cellFont: (col, row) => cellStyleFont(this.resolveStyle(col, row)),
      cellRect: (col, row) => editorCellRect(this, col, row),
      refreshCell: (col, row) => this.refreshCell(col, row),
      emitChange: (change) => {
        for (const listener of this.interactionState.cellChangeListeners) {
          listener(change)
        }
      },
      emitStart: (event) => {
        this.setCellContentHidden(event.col, event.row, true)
        for (const listener of this.interactionState.editStartListeners) {
          listener(event)
        }
      },
      emitEnd: (event) => {
        this.setCellContentHidden(event.col, event.row, false)
        for (const listener of this.interactionState.editEndListeners) {
          listener(event)
        }
      },
      moveSelection: (col, row, move) => this.moveSelectionAfterCommit(col, row, move),
      restoreFocus: () => restoreFocusTarget?.focus(),
      resolveEditorBlur: () => (this.interactionState.editPickMode ? 'ignore' : 'commit'),
      container: this.container,
      host: this.container as TextEditorHost | undefined,
      subscribeScrollFrame: (listener) => this.onScrollFrame(listener),
    })

    bindInteractionEvents(this)
    for (const plugin of options.plugins ?? []) {
      this.use(plugin)
    }
    rebuildScene(this)
    this.host.submitInvalidation('body', { type: 'full' })
    this.sceneState.sceneInitialized = true
    refreshOverlay(this)
  }

  /** 当前生效主题 */
  getTheme(): TableTheme {
    return this.theme
  }

  /** 运行时深覆盖更新主题 */
  updateTheme(override: ThemeOverride): void {
    this.theme = extendsTheme(override, this.theme)
    this.geometryState.columnStyles.clear()
    this.interactionState.overlay.updateTheme(this.theme.interaction)
    this.scroll.setViewportSize(
      this.viewportWidth - this.geometryState.frozenColsWidth,
      this.viewportHeight - this.geometryState.frozenRowsHeight,
    )
    this.scroll.setContentSize(
      this.contentWidth - this.geometryState.frozenColsWidth,
      this.contentHeight - this.geometryState.frozenRowsHeight,
    )
    rebuildScene(this)
    this.host.submitInvalidation('body', { type: 'full' })
    refreshOverlay(this)
  }

  /** 注册整层绘制器（underlay / overlay 槽位）；返回幂等注销函数 */
  registerPainter(registration: PainterRegistration): () => void {
    const { painters } = this.sceneState
    const unregister = painters.register(registration)
    this.syncPainterSlot(registration.slot)
    let disposed = false
    return () => {
      if (disposed) {
        return
      }
      disposed = true
      const before = painters.getPainters(registration.slot)
      unregister()
      if (painters.getPainters(registration.slot) === before) {
        return
      }
      this.syncPainterSlot(registration.slot)
    }
  }

  private syncPainterSlot(slot: PainterSlot): void {
    const { sceneState, interactionState } = this
    const { painters } = sceneState
    const hasPainters = painters.has(slot)
    if (slot === 'underlay') {
      if (hasPainters) {
        const ground = (sceneState.ground ??= this.host.createLayer({
          kind: 'ground',
          consumption: 'band-full-only',
        }))
        ground.root.hitTestChildren = false
        if (!sceneState.underlayPaintersNode) {
          const node = new GroundPaintersNode(painters)
          node.width = this.width
          node.height = this.height
          ground.root.appendChild(node)
          sceneState.underlayPaintersNode = node
        }
      } else if (sceneState.underlayPaintersNode) {
        sceneState.underlayPaintersNode.removeFromParent()
        sceneState.underlayPaintersNode = null
      }
      if (sceneState.ground) {
        this.host.submitInvalidation('ground', { type: 'full' })
      }
      return
    }

    if (hasPainters) {
      if (!sceneState.overlayPaintersNode) {
        const node = new OverlayPaintersNode(painters)
        node.width = this.width
        node.height = this.height
        sceneState.sky.root.appendChild(node)
        interactionState.overlay.raiseToTop()
        sceneState.overlayPaintersNode = node
      }
    } else if (sceneState.overlayPaintersNode) {
      sceneState.overlayPaintersNode.removeFromParent()
      sceneState.overlayPaintersNode = null
    }
    this.host.submitInvalidation('sky', { type: 'full' })
  }

  /** 注册插件并立即挂载；返回卸载函数 */
  use(plugin: EnginePlugin): () => void {
    return this.pluginHost.use(plugin)
  }

  /** 卸载已注册插件（按实例或插件名） */
  unuse(plugin: EnginePlugin | string): void {
    this.pluginHost.unuse(plugin)
  }

  /** 浮动对象层（格上图片/图表；惰性创建） */
  get floatObjects(): FloatObjectLayer {
    if (!this.floatLayer) {
      const { geometryState, interactionState, sceneState } = this
      this.floatLayer = new FloatObjectLayer({
        layer: sceneState.sky,
        geometry: {
          cellOrigin: (col, row) => ({
            x: resolveCellX(
              col,
              this.scroll.state.left,
              geometryState.colOffsets,
              geometryState.frozenColCount,
              this.rowHeaderWidth,
            ),
            y: resolveCellYFromOffsets(
              row,
              this.scroll.state.top,
              geometryState.rowOffsets,
              geometryState.frozenRowCount,
              this.headerHeight,
            ),
          }),
          cellSize: (col, row) => ({ width: this.getColWidth(col), height: this.rowHeightAt(row) }),
          cellAtPoint: (x, y) => cellAt(this, x, y),
        },
        imageService: this.imageService,
        bodyViewport: this.bodyViewport,
      })
      interactionState.overlay.raiseToTop()
    }
    return this.floatLayer
  }

  getScrollState(): ScrollState {
    return this.scroll.state
  }

  get usesNativeScrollbar(): boolean {
    return this.interactionState.nativeScrollbar !== null
  }

  getVisibleRange(): { rows: WindowRange; cols: WindowRange } {
    return { rows: this.geometryState.rows, cols: this.geometryState.cols }
  }

  scrollTo(left: number, top: number): void {
    this.scroll.scrollTo(left, top)
  }

  scrollBy(dx: number, dy: number): void {
    this.scroll.scrollBy(dx, dy)
  }

  /** 单元格最终显示文本（合并区路由主格） */
  getCellText(col: number, row: number): string {
    const master = this.geometryState.mergeCells.masterOf(col, row)
    return this.pipeline.resolveText(master?.col ?? col, master?.row ?? row)
  }

  /** 单元格原始值（合并区路由主格） */
  getCellValue(col: number, row: number): unknown {
    const master = this.geometryState.mergeCells.masterOf(col, row)
    return this.pipeline.resolveValue(master?.col ?? col, master?.row ?? row)
  }

  /** 有效格样式（合并区路由主格） */
  getCellStyle(col: number, row: number): CellStyle {
    const master = this.geometryState.mergeCells.masterOf(col, row)
    return this.resolveStyle(master?.col ?? col, master?.row ?? row)
  }

  /** 单元格图片资源引用（合并区路由主格） */
  getCellImage(col: number, row: number): string | null | undefined {
    const master = this.geometryState.mergeCells.masterOf(col, row)
    return this.options.resolveCellImage?.(master?.col ?? col, master?.row ?? row)
  }

  /** 合并区集合 */
  getMergeRanges(): readonly CellRange[] {
    return this.geometryState.mergeCells.ranges
  }

  /** 引擎只读视图（与 capabilities.gridRead 同源） */
  get read(): GridReadView {
    return this
  }

  /** 表格回驱模型 */
  updateCell(col: number, row: number, value: unknown): void {
    if (!this.binding) {
      return
    }
    const echoed = this.binding.writeBack(col, row, value)
    this.refreshEchoedCells(echoed, col, row)
    this.refreshCell(col, row)
  }

  /** 局部刷新单格 */
  refreshCell(col: number, row: number): void {
    const { geometryState, sceneState } = this
    const master = geometryState.mergeCells.masterOf(col, row)
    const masterCol = master?.col ?? col
    const masterRow = master?.row ?? row
    const node = sceneState.cellNodes.get(cellKey(masterCol, masterRow))
    if (!node) {
      this.refreshOffWindowOverflowSource(masterCol, masterRow)
      return
    }
    const prevBorder = node.style.border
    this.refreshCellNodeContents(node, masterCol, masterRow)
    if (sameCellBorder(prevBorder, node.style.border)) {
      return
    }
    const range = geometryState.mergeCells.rangeAt(masterCol, masterRow)
    const startCol = range?.startCol ?? masterCol
    const startRow = range?.startRow ?? masterRow
    if (startCol > 0) {
      this.refreshCellNode(startCol - 1, startRow)
    }
    if (startRow > 0) {
      this.refreshCellNode(masterCol, startRow - 1)
    }
  }

  private refreshCellNode(col: number, row: number): void {
    const master = this.geometryState.mergeCells.masterOf(col, row)
    const masterCol = master?.col ?? col
    const masterRow = master?.row ?? row
    const node = this.sceneState.cellNodes.get(cellKey(masterCol, masterRow))
    if (!node) {
      return
    }
    this.refreshCellNodeContents(node, masterCol, masterRow)
  }

  private refreshCellNodeContents(node: CellNode, masterCol: number, masterRow: number): void {
    const { sceneState, geometryState } = this
    refreshImageCell(this, masterCol, masterRow)
    refreshChartCell(this, masterCol, masterRow)
    const prevMaxX = node.textMaxX
    const prevMinX = node.textMinX
    const prevHasText = node.text !== ''
    const imageUrl = this.options.resolveCellImage?.(masterCol, masterRow)
    const chartMedia = imageUrl
      ? null
      : (this.options.resolveCellChart?.(masterCol, masterRow) ?? null)
    node.setContent(
      imageUrl || chartMedia ? '' : this.pipeline.resolveText(masterCol, masterRow),
      this.pipeline.resolveValue(masterCol, masterRow),
    )
    node.style = this.resolveStyle(masterCol, masterRow)
    node.border = effectiveBorder(this, masterCol, masterRow, node.style)
    syncImageCellInset(this, masterCol, masterRow)
    node.renderer = this.options.resolveCellRenderer?.(masterCol, masterRow) ?? null
    const limits = textOverflowLimits(
      this,
      masterCol,
      masterRow,
      node.style,
      this.scroll.state.left,
      node,
    )
    node.textMaxX = limits === null ? node.width : limits.maxX - node.x
    node.textMinX = limits === null ? 0 : limits.minX - node.x
    let corridorChanged = node.textMaxX !== prevMaxX || node.textMinX !== prevMinX
    let builtOffWindowSource = false
    const regions: Region[] = [node.getGlobalBounds()]
    if (prevMaxX > node.width || prevMinX < 0) {
      regions.push(overflowExtentRegion(node, prevMinX, prevMaxX))
    }
    if (node.textMaxX > node.width || node.textMinX < 0) {
      regions.push(overflowExtentRegion(node, node.textMinX, node.textMaxX))
    }
    // 溢出状态变化时在 scrollableGroup <-> scrollableOverflowGroup / frozenGroup <-> frozenOverflowGroup 间迁移并维护行内排序
    syncCellGroupAndOverflowOrder(this, node, masterCol, masterRow)

    if (!node.text || prevHasText !== (node.text !== '')) {
      for (const sourceCol of [
        overflowSourceCol(this, masterCol, masterRow),
        overflowSourceColRight(this, masterCol, masterRow),
      ]) {
        if (sourceCol === null) {
          continue
        }
        let sourceNode = sceneState.cellNodes.get(cellKey(sourceCol, masterRow))
        if (!sourceNode) {
          const side = sourceCol < geometryState.cols.start ? 'left' : 'right'
          const resolved = resolveOffWindowOverflowSource(this, masterRow, side)
          if (resolved !== null && resolved.col === sourceCol && resolved.node === null) {
            appendCell(this, sourceCol, masterRow, this.scroll.state.left, this.scroll.state.top)
            sourceNode = sceneState.cellNodes.get(cellKey(sourceCol, masterRow))
            if (sourceNode) {
              builtOffWindowSource = true
              regions.push(
                overflowExtentRegion(sourceNode, sourceNode.textMinX, sourceNode.textMaxX),
              )
            }
          }
        }
        if (!sourceNode) {
          continue
        }
        const sourceOldMinX = sourceNode.textMinX
        const sourceOldMaxX = sourceNode.textMaxX
        const sourceLimits = textOverflowLimits(
          this,
          sourceCol,
          masterRow,
          sourceNode.style,
          this.scroll.state.left,
          sourceNode,
        )
        sourceNode.textMaxX =
          sourceLimits === null ? sourceNode.width : sourceLimits.maxX - sourceNode.x
        sourceNode.textMinX = sourceLimits === null ? 0 : sourceLimits.minX - sourceNode.x
        if (sourceNode.textMaxX !== sourceOldMaxX || sourceNode.textMinX !== sourceOldMinX) {
          corridorChanged = true
          regions.push(overflowExtentRegion(sourceNode, sourceOldMinX, sourceOldMaxX))
          regions.push(overflowExtentRegion(sourceNode, sourceNode.textMinX, sourceNode.textMaxX))
        }
        syncCellGroupAndOverflowOrder(this, sourceNode, sourceCol, masterRow)
      }
    }
    if (corridorChanged || builtOffWindowSource) {
      markRowCorridorInterior(this, masterRow, dataColBands(this))
    }
    const region = unionRegions(regions) ?? regions[0]!
    if (sceneState.batchDepth > 0) {
      sceneState.batchRegions.push(region)
      return
    }
    this.host.submitInvalidation('body', { type: 'region', region })
  }

  private refreshOffWindowOverflowSource(col: number, row: number): void {
    const { sceneState } = this
    for (const side of ['left', 'right'] as const) {
      const resolved = resolveOffWindowOverflowSource(this, row, side)
      if (resolved === null || resolved.col !== col || resolved.node !== null) {
        continue
      }
      appendCell(this, col, row, this.scroll.state.left, this.scroll.state.top)
      const built = sceneState.cellNodes.get(cellKey(col, row))
      if (!built) {
        continue
      }
      syncCellGroupAndOverflowOrder(this, built, col, row)
      markRowCorridorInterior(this, row, dataColBands(this))
      this.submitOffWindowRegion(overflowExtentRegion(built, built.textMinX, built.textMaxX))
      break
    }
    this.convergeRetainedOffWindowSource(col, row)
  }

  private convergeRetainedOffWindowSource(col: number, row: number): void {
    const { geometryState, sceneState } = this
    const regions: Region[] = []
    for (const sourceCol of [
      overflowSourceCol(this, col, row),
      overflowSourceColRight(this, col, row),
    ]) {
      if (
        sourceCol === null ||
        (sourceCol >= geometryState.cols.start && sourceCol < geometryState.cols.end)
      ) {
        continue
      }
      const sourceNode = sceneState.cellNodes.get(cellKey(sourceCol, row))
      if (!sourceNode) {
        continue
      }
      const oldMinX = sourceNode.textMinX
      const oldMaxX = sourceNode.textMaxX
      const limits = textOverflowLimits(
        this,
        sourceCol,
        row,
        sourceNode.style,
        this.scroll.state.left,
        sourceNode,
      )
      sourceNode.textMaxX = limits === null ? sourceNode.width : limits.maxX - sourceNode.x
      sourceNode.textMinX = limits === null ? 0 : limits.minX - sourceNode.x
      if (sourceNode.textMaxX === oldMaxX && sourceNode.textMinX === oldMinX) {
        continue
      }
      regions.push(overflowExtentRegion(sourceNode, oldMinX, oldMaxX))
      regions.push(overflowExtentRegion(sourceNode, sourceNode.textMinX, sourceNode.textMaxX))
      syncCellGroupAndOverflowOrder(this, sourceNode, sourceCol, row)
      markRowCorridorInterior(this, row, dataColBands(this))
    }
    if (regions.length === 0) {
      return
    }
    this.submitOffWindowRegion(unionRegions(regions) ?? regions[0]!)
  }

  private submitOffWindowRegion(region: Region): void {
    const { sceneState } = this
    if (sceneState.batchDepth > 0) {
      sceneState.batchRegions.push(region)
      return
    }
    this.host.submitInvalidation('body', { type: 'region', region })
  }

  /** 批量更新：fn 内的多次变更合并，结束时只提交一次几何重建或 band 失效 */
  batchUpdate(fn: () => void): void {
    const { geometryState, sceneState } = this
    sceneState.batchDepth++
    try {
      fn()
    } finally {
      sceneState.batchDepth--
      if (sceneState.batchDepth === 0) {
        if (sceneState.colOffsetsDirty) {
          sceneState.colOffsetsDirty = false
          geometryState.colOffsets = computeColOffsets(geometryState.colWidths)
        }
        if (sceneState.rowOffsetsDirty) {
          sceneState.rowOffsetsDirty = false
          geometryState.rowOffsets = computeRowOffsets(
            this.pipeline.rowCount,
            this.rowHeight,
            geometryState.rowHeights,
          )
        }
        if (sceneState.geometryDirty) {
          sceneState.geometryDirty = false
          sceneState.batchRegions.length = 0
          this.applyGeometryChange()
        } else if (sceneState.batchRegions.length > 0) {
          const region = unionRegions(sceneState.batchRegions)
          sceneState.batchRegions.length = 0
          if (region) {
            this.host.submitInvalidation('body', { type: 'band', region })
          }
        }
      }
    }
  }

  // ---- 选区 ----

  getSelection(): SelectionSnapshot {
    return this.interactionState.selection.snapshot
  }

  onSelectionChange(listener: SelectionListener): () => void {
    return this.interactionState.selection.onChange(listener)
  }

  selectCell(col: number, row: number): void {
    this.interactionState.selection.selectCell(col, row)
    ensureCellVisible(this, col, row)
  }

  selectCells(ranges: readonly SelectionRange[]): void {
    this.interactionState.selection.selectCells(ranges)
  }

  getSelectedCellRanges(): SelectionRange[] {
    return this.interactionState.selection.snapshot.ranges.map((range) => ({
      start: { ...range.start },
      end: { ...range.end },
    }))
  }

  selectRow(row: number): void {
    this.interactionState.selection.selectRow(row, this.columns.length)
  }

  selectCol(col: number): void {
    this.interactionState.selection.selectCol(col, this.pipeline.rowCount)
  }

  selectAll(): void {
    this.interactionState.selection.selectAll(this.columns.length, this.pipeline.rowCount)
  }

  clearSelection(): void {
    this.interactionState.selection.clear()
  }

  applyExternalSelection(snapshot: SelectionSnapshot): void {
    this.interactionState.selection.applyExternal(snapshot, {
      colCount: this.columns.length,
      rowCount: this.pipeline.rowCount,
    })
    refreshOverlay(this)
  }

  setHighlightRanges(ranges: readonly HighlightRange[]): void {
    this.interactionState.highlightRanges = ranges
    refreshOverlay(this)
  }

  setSelectionAnchor(anchor: CellRef | null): void {
    const { interactionState, geometryState } = this
    if (!anchor) {
      interactionState.selectionAnchor = null
    } else {
      const merge = geometryState.mergeCells.rangeAt(anchor.col, anchor.row)
      interactionState.selectionAnchor = merge
        ? {
            minCol: merge.startCol,
            minRow: merge.startRow,
            maxCol: merge.endCol,
            maxRow: merge.endRow,
          }
        : { minCol: anchor.col, minRow: anchor.row, maxCol: anchor.col, maxRow: anchor.row }
    }
    refreshOverlay(this)
  }

  /** @internal 容器光标写入 */
  setContainerCursor(cursor: string): void {
    if (this.cursorContainer?.style) {
      this.cursorContainer.style.cursor = cursor
    }
  }

  /** @internal 上屏容器 */
  getContainer(): HTMLElement | undefined {
    return this.container
  }

  /** @internal 滚动条活动脉动 */
  pokeScrollbar(): void {
    const { interactionState } = this
    if (interactionState.scrollbarConfig.visibility === 'always') {
      return
    }
    if (!interactionState.scrollbarVisible) {
      interactionState.scrollbarVisible = true
      refreshOverlay(this)
    }
    if (interactionState.scrollbarHideTimer !== null) {
      clearTimeout(interactionState.scrollbarHideTimer)
    }
    const delay =
      interactionState.scrollbarConfig.hideDelay ?? this.theme.interaction.scrollbarHideDelay
    interactionState.scrollbarHideTimer = setTimeout(() => {
      interactionState.scrollbarHideTimer = null
      if (
        this.destroyed ||
        interactionState.scrollbarDrag !== null ||
        interactionState.scrollbarHover !== null
      ) {
        return
      }
      interactionState.scrollbarVisible = false
      refreshOverlay(this)
    }, delay)
  }

  // ---- 行列 resize ----

  getColWidth(col: number): number {
    return this.geometryState.colWidths[col] ?? 0
  }

  getRowHeight(row: number): number {
    return this.rowHeightAt(row)
  }

  setColWidth(col: number, width: number): void {
    const { geometryState } = this
    if (!Number.isInteger(col) || col < 0 || col >= geometryState.colWidths.length) {
      return
    }
    if (!Number.isFinite(width)) {
      return
    }
    const next = Math.max(MIN_COL_WIDTH, width)
    if (geometryState.colWidths[col] === next) {
      return
    }
    geometryState.colWidths[col] = next
    this.commitColGeometryChange()
  }

  setColWidths(widths: IndexSizeMap): void {
    this.batchUpdate(() => {
      forEachIndexSize(widths, (col, width) => {
        this.setColWidth(col, width)
      })
    })
  }

  setRowHeight(row: number, height: number): void {
    const { geometryState } = this
    if (!Number.isInteger(row) || row < 0 || row >= this.pipeline.rowCount) {
      return
    }
    if (!Number.isFinite(height)) {
      return
    }
    const next = Math.max(MIN_ROW_HEIGHT, height)
    if (this.rowHeightAt(row) === next) {
      return
    }
    if (next === this.rowHeight) {
      geometryState.rowHeights.delete(row)
    } else {
      geometryState.rowHeights.set(row, next)
    }
    this.commitRowGeometryChange()
  }

  setRowHeights(heights: IndexSizeMap): void {
    this.batchUpdate(() => {
      forEachIndexSize(heights, (row, height) => {
        this.setRowHeight(row, height)
      })
    })
  }

  clearRowHeight(row: number): void {
    if (!this.geometryState.rowHeights.delete(row)) {
      return
    }
    this.commitRowGeometryChange()
  }

  resetRowHeights(): void {
    const { rowHeights } = this.geometryState
    if (rowHeights.size === 0) {
      return
    }
    rowHeights.clear()
    this.commitRowGeometryChange()
  }

  // ---- 行列数运行时可变 ----

  get rowCount(): number {
    return this.pipeline.rowCount
  }

  get colCount(): number {
    return this.columns.length
  }

  setRowCount(count: number): void {
    const { geometryState, sceneState } = this
    const prevPipelineCount = this.pipeline.rowCount
    const prevOffsetsCount = geometryState.rowOffsets.length - 1
    this.pipeline.setRowCountFloor(count)
    const next = this.pipeline.rowCount
    if (!sceneState.rowOffsetsDirty && next === prevOffsetsCount) {
      return
    }
    if (next < prevOffsetsCount || next < prevPipelineCount) {
      geometryState.frozenRowCount = clampFrozenCount(geometryState.frozenRowCount, next)
      this.shrinkToBounds(this.columns.length, next)
    }
    this.commitRowGeometryChange()
  }

  setColCount(count: number, template?: ColumnDefine): void {
    const { geometryState } = this
    const prev = this.columns.length
    const next = Math.max(0, Math.floor(count))
    if (next === prev) {
      return
    }
    if (next > prev) {
      const defaultColWidth = this.options.defaultColWidth ?? this.theme.defaultColWidth
      for (let col = prev; col < next; col++) {
        this.columns.push({ ...template })
        geometryState.colWidths.push(template?.width ?? defaultColWidth)
      }
    } else {
      this.columns.length = next
      geometryState.colWidths.length = next
      for (const col of geometryState.columnStyles.keys()) {
        if (col >= next) {
          geometryState.columnStyles.delete(col)
        }
      }
      geometryState.frozenColCount = clampFrozenCount(geometryState.frozenColCount, next)
      this.shrinkToBounds(next, this.pipeline.rowCount)
    }
    this.commitColGeometryChange()
  }

  private shrinkToBounds(colCount: number, rowCount: number): void {
    const { geometryState, interactionState } = this
    const bounded = geometryState.mergeCells.ranges.filter(
      (range) => range.endCol < colCount && range.endRow < rowCount,
    )
    geometryState.mergeCells = new MergeCellMap(bounded)
    interactionState.selection.applyExternal(interactionState.selection.snapshot, {
      colCount,
      rowCount,
    })
  }

  // ---- 容器 resize 原地自适应 ----

  resize(width: number, height: number): void {
    const nextWidth = Math.max(0, width)
    const nextHeight = Math.max(0, height)
    if (nextWidth === this.tableWidth && nextHeight === this.tableHeight) {
      return
    }
    this.tableWidth = nextWidth
    this.tableHeight = nextHeight
    const dpr = this.explicitHostDpr ?? this.resolveDpr()
    this.mediaState.hostDpr = dpr
    this.host.resize(nextWidth, nextHeight, dpr)
    const { sceneState, interactionState } = this
    sceneState.body.root.width = nextWidth
    sceneState.body.root.height = nextHeight
    interactionState.nativeScrollbar?.resize(nextWidth, nextHeight)
    interactionState.overlay.resize()
    if (sceneState.underlayPaintersNode) {
      sceneState.underlayPaintersNode.width = nextWidth
      sceneState.underlayPaintersNode.height = nextHeight
    }
    if (sceneState.overlayPaintersNode) {
      sceneState.overlayPaintersNode.width = nextWidth
      sceneState.overlayPaintersNode.height = nextHeight
    }
    resizeSceneGroups(this)
    if (this.floatLayer) {
      this.floatLayer.setBodyViewport(this.bodyViewport)
    }
    this.commitGeometryChange()
  }

  // ---- 几何/滚动查询 ----

  getCellRelativeRect(col: number, row: number): Region | null {
    return cellRectInViewport(this, col, row)
  }

  getCellAtRelativePosition(x: number, y: number): CellRef | null {
    return cellAt(this, x, y)
  }

  scrollToCell(cell: CellRef): void {
    ensureCellVisible(this, cell.col, cell.row)
  }

  getScrollLeft(): number {
    return this.scroll.state.left
  }

  getScrollTop(): number {
    return this.scroll.state.top
  }

  setScrollLeft(left: number): void {
    this.scroll.scrollTo(left, this.scroll.state.top)
  }

  setScrollTop(top: number): void {
    this.scroll.scrollTo(this.scroll.state.left, top)
  }

  getDrawRange(): Region {
    return this.bodyViewport
  }

  getBodyVisibleCellRange(): { rows: WindowRange; cols: WindowRange } {
    const { frozenRowCount, frozenColCount, rows, cols } = this.geometryState
    return {
      rows: {
        start: frozenRowCount > 0 ? 0 : rows.start,
        end: Math.max(rows.end, frozenRowCount),
      },
      cols: {
        start: frozenColCount > 0 ? 0 : cols.start,
        end: Math.max(cols.end, frozenColCount),
      },
    }
  }

  isSeriesNumber(col: number, row: number): boolean {
    return col === HEADER_COORD && row >= 0 && row < this.pipeline.rowCount
  }

  getHeaderLevelCount(): number {
    return 1
  }

  // ---- 冻结与合并运行时可变 ----

  getFrozenColCount(): number {
    return this.geometryState.frozenColCount
  }

  getFrozenRowCount(): number {
    return this.geometryState.frozenRowCount
  }

  setFrozenColCount(count: number): void {
    this.applyFrozenCounts(count, this.geometryState.frozenRowCount)
  }

  setFrozenRowCount(count: number): void {
    this.applyFrozenCounts(this.geometryState.frozenColCount, count)
  }

  setMergeCells(ranges: readonly CellRange[]): void {
    const sanitized = sanitizeMerges(ranges)
    warnMergeConflicts(sanitized.conflicts, 'ListTable.setMergeCells')
    this.replaceMergeCells(new MergeCellMap(sanitized.ranges))
  }

  addMergeCell(range: CellRange): void {
    this.replaceMergeCells(new MergeCellMap([...this.geometryState.mergeCells.ranges, range]))
  }

  removeMergeCell(range: CellRange): void {
    const target = normalizeCellRange(range)
    const next = this.geometryState.mergeCells.ranges.filter(
      (r) =>
        r.startCol !== target.startCol ||
        r.startRow !== target.startRow ||
        r.endCol !== target.endCol ||
        r.endRow !== target.endRow,
    )
    if (next.length === this.geometryState.mergeCells.ranges.length) {
      return
    }
    this.replaceMergeCells(new MergeCellMap(next))
  }

  private applyFrozenCounts(frozenColCount: number, frozenRowCount: number): void {
    const { geometryState } = this
    const nextCols = clampFrozenCount(frozenColCount, this.columns.length)
    const nextRows = clampFrozenCount(frozenRowCount, this.pipeline.rowCount)
    if (nextCols === geometryState.frozenColCount && nextRows === geometryState.frozenRowCount) {
      return
    }
    geometryState.frozenColCount = nextCols
    geometryState.frozenRowCount = nextRows
    this.commitGeometryChange()
  }

  private replaceMergeCells(next: MergeCellMap): void {
    assertMergesWithinTable(next.ranges, this.columns.length, this.pipeline.rowCount)
    this.geometryState.mergeCells = next
    this.commitGeometryChange()
  }

  // ---- 事件 ----

  onContextMenu(listener: ContextMenuListener): () => void {
    this.interactionState.contextMenuListeners.add(listener)
    return () => this.interactionState.contextMenuListeners.delete(listener)
  }

  onColHeaderClick(listener: ColHeaderClickListener): () => void {
    this.interactionState.colHeaderClickListeners.add(listener)
    return () => this.interactionState.colHeaderClickListeners.delete(listener)
  }

  onCellLinkHover(listener: CellLinkHoverListener): () => void {
    this.interactionState.cellLinkHoverListeners.add(listener)
    return () => this.interactionState.cellLinkHoverListeners.delete(listener)
  }

  onCellLinkLeave(listener: CellLinkLeaveListener): () => void {
    this.interactionState.cellLinkLeaveListeners.add(listener)
    return () => this.interactionState.cellLinkLeaveListeners.delete(listener)
  }

  onCellLinkClick(listener: CellLinkClickListener): () => void {
    this.interactionState.cellLinkClickListeners.add(listener)
    return () => this.interactionState.cellLinkClickListeners.delete(listener)
  }

  onImageLinkClick(listener: ImageLinkClickListener): () => void {
    this.interactionState.imageLinkClickListeners.add(listener)
    return () => this.interactionState.imageLinkClickListeners.delete(listener)
  }

  onScrollFrame(listener: ScrollFrameListener): () => void {
    this.interactionState.scrollFrameListeners.add(listener)
    return () => this.interactionState.scrollFrameListeners.delete(listener)
  }

  onColResizeEnd(listener: (event: ColResizeEndEvent) => void): () => void {
    this.interactionState.colResizeEndListeners.add(listener)
    return () => this.interactionState.colResizeEndListeners.delete(listener)
  }

  onRowResizeEnd(listener: (event: RowResizeEndEvent) => void): () => void {
    this.interactionState.rowResizeEndListeners.add(listener)
    return () => this.interactionState.rowResizeEndListeners.delete(listener)
  }

  onFillHandleDown(listener: FillHandleDownListener): () => void {
    this.interactionState.fillHandleDownListeners.add(listener)
    return () => this.interactionState.fillHandleDownListeners.delete(listener)
  }

  onFillDragEnd(listener: FillDragEndListener): () => void {
    this.interactionState.fillDragEndListeners.add(listener)
    return () => this.interactionState.fillDragEndListeners.delete(listener)
  }

  onFillHandleDoubleClick(listener: FillHandleDoubleClickListener): () => void {
    this.interactionState.fillHandleDoubleClickListeners.add(listener)
    return () => this.interactionState.fillHandleDoubleClickListeners.delete(listener)
  }

  // ---- 编辑 ----

  startEdit(col: number, row: number): boolean {
    if (!this.editManager.isEditable(col, row)) {
      return false
    }
    this.interactionState.selection.selectCell(col, row)
    ensureCellVisible(this, col, row)
    return this.editManager.startEdit(col, row)
  }

  commitEdit(): boolean {
    return this.editManager.commitEdit()
  }

  cancelEdit(): void {
    this.editManager.cancelEdit()
  }

  isEditing(): boolean {
    return this.editManager.isEditing()
  }

  private setCellContentHidden(col: number, row: number, hidden: boolean): void {
    const master = this.geometryState.mergeCells.masterOf(col, row)
    const node = this.sceneState.cellNodes.get(cellKey(master?.col ?? col, master?.row ?? row))
    if (!node || node.contentHidden === hidden) {
      return
    }
    node.contentHidden = hidden
    this.host.submitInvalidation('body', {
      type: 'region',
      region: overflowExtentRegion(node, node.textMinX, node.textMaxX),
    })
  }

  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.interactionState.cellChangeListeners.add(listener)
    return () => this.interactionState.cellChangeListeners.delete(listener)
  }

  onEditStart(listener: (event: EditStartEvent) => void): () => void {
    this.interactionState.editStartListeners.add(listener)
    return () => this.interactionState.editStartListeners.delete(listener)
  }

  onEditEnd(listener: (event: EditEndEvent) => void): () => void {
    this.interactionState.editEndListeners.add(listener)
    return () => this.interactionState.editEndListeners.delete(listener)
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    const { interactionState, sceneState } = this
    interactionState.inertia.stop()
    interactionState.scrollbarDrag = null
    interactionState.pointerSessionRelease?.()
    interactionState.pointerSessionRelease = null
    if (interactionState.scrollbarHideTimer !== null) {
      clearTimeout(interactionState.scrollbarHideTimer)
      interactionState.scrollbarHideTimer = null
    }
    this.editManager.dispose()
    for (const unsubscribe of interactionState.eventUnsubscribers) {
      unsubscribe()
    }
    interactionState.eventUnsubscribers.length = 0
    this.pluginHost.unmountAll()
    sceneState.painters.clear()
    this.binding?.dispose()
    this.floatLayer?.dispose()
    this.imageService.dispose()
    if (this.ownHost) {
      this.host.destroy()
    }
    interactionState.nativeScrollbar?.destroy()
  }

  get scrollbarGutterWidth(): number {
    const { interactionState } = this
    if (
      interactionState.nativeScrollbar ||
      !interactionState.scrollbarConfig.enabled ||
      !interactionState.scrollbarConfig.reserve
    ) {
      return 0
    }
    return this.contentHeight > this.height - this.headerHeight
      ? this.theme.interaction.scrollbarSize
      : 0
  }

  get scrollbarGutterHeight(): number {
    const { interactionState } = this
    if (
      interactionState.nativeScrollbar ||
      !interactionState.scrollbarConfig.enabled ||
      !interactionState.scrollbarConfig.reserve
    ) {
      return 0
    }
    return this.contentWidth > this.width - this.rowHeaderWidth
      ? this.theme.interaction.scrollbarSize
      : 0
  }

  get viewportWidth(): number {
    const { nativeScrollbar } = this.interactionState
    if (nativeScrollbar) {
      return Math.max(0, nativeScrollbar.clientWidth - this.rowHeaderWidth)
    }
    return Math.max(0, this.width - this.rowHeaderWidth - this.scrollbarGutterWidth)
  }

  get viewportHeight(): number {
    const { nativeScrollbar } = this.interactionState
    if (nativeScrollbar) {
      return Math.max(0, nativeScrollbar.clientHeight - this.headerHeight)
    }
    return Math.max(0, this.height - this.headerHeight - this.scrollbarGutterHeight)
  }

  get bodyViewport(): Region {
    return {
      x: this.rowHeaderWidth,
      y: this.headerHeight,
      width: this.viewportWidth,
      height: this.viewportHeight,
    }
  }

  get contentWidth(): number {
    const { colOffsets } = this.geometryState
    return colOffsets[colOffsets.length - 1] ?? 0
  }

  get contentHeight(): number {
    return this.geometryState.rowOffsets[this.pipeline.rowCount] ?? 0
  }

  rowHeightAt(row: number): number {
    if (row < 0 || row >= this.pipeline.rowCount) {
      return 0
    }
    return this.geometryState.rowHeights.get(row) ?? this.rowHeight
  }

  resolveStyle(col: number, row: number): CellStyle {
    const { columnStyles } = this.geometryState
    let colStyle = columnStyles.get(col)
    if (!colStyle) {
      const column = this.columns[col]
      const base = themeCellBase(this.theme.body)
      colStyle = projectCellStyle(
        column?.textWrap ? { ...base, textWrap: true } : base,
        column?.style,
      )
      columnStyles.set(col, colStyle)
    }
    const link = this.options.resolveCellLink?.(col, row)
    const linked = link
      ? projectCellStyle(colStyle, { color: this.theme.linkColor, underline: true })
      : colStyle
    const cellStyle = this.options.resolveCellStyle?.(col, row)
    return cellStyle ? projectCellStyle(linked, cellStyle) : linked
  }

  styleAt(col: number, row: number): CellStyle {
    if (col === HEADER_COORD || row === HEADER_COORD) {
      const styles = headerStyles(this)
      if (col === HEADER_COORD && row === HEADER_COORD) {
        return styles.corner
      }
      return row === HEADER_COORD ? styles.col : styles.row
    }
    return this.resolveStyle(col, row)
  }

  private onScroll(delta: ScrollDelta): void {
    const { geometryState, sceneState, interactionState } = this
    updateSceneWindow(this)
    if (delta.dx !== 0 || delta.dy !== 0) {
      this.pokeScrollbar()
    }
    if (delta.dy !== 0) {
      const y = this.headerHeight + geometryState.frozenRowsHeight
      const band = { x: 0, y, width: this.width, height: Math.max(0, this.height - y) }
      this.host.submitInvalidation('body', { type: 'band', region: band })
      if (sceneState.media) {
        this.host.submitInvalidation('media', { type: 'band', region: band })
      }
    }
    if (delta.dx !== 0) {
      const x = this.rowHeaderWidth + geometryState.frozenColsWidth
      const band = { x, y: 0, width: Math.max(0, this.width - x), height: this.height }
      this.host.submitInvalidation('body', { type: 'band', region: band })
      if (sceneState.media) {
        this.host.submitInvalidation('media', { type: 'band', region: band })
      }
    }
    updateImageWindow(this)
    if (this.floatLayer && this.floatLayer.size > 0) {
      this.floatLayer.syncPositions()
    }
    refreshOverlay(this)
    if (interactionState.scrollFrameListeners.size > 0) {
      this.host.requestFrame(this.scrollFrameTask)
    }
  }

  private canWriteCell(col: number, row: number): boolean {
    if (this.binding) {
      return true
    }
    const field = this.columns[col]?.field
    return field !== undefined && this.options.records?.[row] != null
  }

  private writeCell(col: number, row: number, value: unknown): void {
    if (this.binding) {
      this.refreshEchoedCells(this.binding.writeBack(col, row, value), col, row)
      return
    }
    const field = this.columns[col]?.field
    const record = this.options.records?.[row]
    if (field !== undefined && record) {
      record[field] = value
    }
  }

  private refreshEchoedCells(
    changes: readonly CellChangeEvent[],
    editedCol: number,
    editedRow: number,
  ): void {
    for (const change of changes) {
      if (change.col === editedCol && change.row === editedRow) {
        continue
      }
      this.refreshCell(change.col, change.row)
    }
  }

  private moveSelectionAfterCommit(col: number, row: number, move: EditCommitMove): void {
    const next = nextActiveCell(
      move === 'down' ? 'ArrowDown' : 'Tab',
      { col, row },
      this.columns.length,
      this.pipeline.rowCount,
    )
    if (next) {
      this.interactionState.selection.selectCell(next.col, next.row)
      ensureCellVisible(this, next.col, next.row)
    }
  }

  private commitColGeometryChange(): void {
    const { geometryState, sceneState } = this
    if (sceneState.batchDepth > 0) {
      sceneState.colOffsetsDirty = true
      sceneState.geometryDirty = true
      return
    }
    geometryState.colOffsets = computeColOffsets(geometryState.colWidths)
    this.applyGeometryChange()
  }

  private commitRowGeometryChange(): void {
    const { geometryState, sceneState } = this
    if (sceneState.batchDepth > 0) {
      sceneState.rowOffsetsDirty = true
      sceneState.geometryDirty = true
      return
    }
    geometryState.rowOffsets = computeRowOffsets(
      this.pipeline.rowCount,
      this.rowHeight,
      geometryState.rowHeights,
    )
    this.applyGeometryChange()
  }

  private commitGeometryChange(): void {
    const { sceneState } = this
    if (sceneState.batchDepth > 0) {
      sceneState.geometryDirty = true
      return
    }
    this.applyGeometryChange()
  }

  /** @internal 几何变更后：冻结区尺寸/滚动边界重算，全量重建一次 */
  applyGeometryChange(): void {
    const { geometryState, sceneState, interactionState } = this
    geometryState.frozenColsWidth = geometryState.colOffsets[geometryState.frozenColCount] ?? 0
    geometryState.frozenRowsHeight = geometryState.rowOffsets[geometryState.frozenRowCount] ?? 0
    this.scroll.setViewportSize(
      this.viewportWidth - geometryState.frozenColsWidth,
      this.viewportHeight - geometryState.frozenRowsHeight,
    )
    this.scroll.setContentSize(
      this.contentWidth - geometryState.frozenColsWidth,
      this.contentHeight - geometryState.frozenRowsHeight,
    )
    interactionState.nativeScrollbar?.updateScrollRange()
    rebuildScene(this)
    this.host.submitInvalidation('body', { type: 'full' })
    if (sceneState.media) {
      this.host.submitInvalidation('media', { type: 'full' })
    }
    updateImageWindow(this)
    if (this.floatLayer && this.floatLayer.size > 0) {
      this.floatLayer.recalcGeometry()
    }
    refreshOverlay(this)
  }
}
