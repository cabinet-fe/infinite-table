// ListTable 主类：布局计算、虚拟滚动窗口、冻结区域划分、合并单元格、行列头渲染，
// 经 RenderHost 窄接口提交渲染。
// 场景内容只建在可视窗口内（窗口外行列不进入场景树，合并区主格按可见性补建）；
// 滚动由 ScrollManager 唯一状态源驱动，滚动 → 窗口重建 → 按滚动方向分层 band 失效
// （冻结区不随滚动重绘）。
// 交互（P5）：选区/hover/resize 指示线绘制在 sky 浮层（不触发 body 重绘），
// 键盘导航、触控惯性滚动、contextmenu 事件、onScrollFrame 帧级同步、批量更新合并失效。
// 多选区与填充柄（P0-5/P0-6）：selectCells 多段选中、ctrlMultiSelect 开关（Ctrl/Cmd 加选），
// 填充柄挂焦点段右下角（按下/拖拽结束两个公开事件，填充生成不在内核）。
// 图片（P7）：格内图片在 L2 media 层渲染（ImageService 窗口化加载 + cell 级位图 LRU +
// 无闪协议），浮动对象层挂 sky 层最顶、随滚动帧级跟随。
// 编辑（P2/P3）：双击（含触控双击）进入编辑，EditManager 为编辑状态唯一源，
// DOM 浮层文本编辑器挂表格容器内、随锚定格视口矩形定位；
// 编辑中滚动浮层逐帧跟随锚定格，锚定格滚出视口按 Enter 语义自动提交。
// 运行时可变（P8）：冻结列数/行数与合并区开放运行时修改（「合并不跨冻结边界」
// 构造期校验延伸到运行时），resize 拖拽会话补结束事件，editCellOnEnter 键位开关。

import {
  createRenderHost,
  type LayerHandle,
  type Region,
  type RenderHost,
  type SceneEvent,
} from '@infinite-table/render'

import { CellNode } from './cell-node'
import { MergeCellMap, normalizeCellRange, rangeCrossesBoundary } from './cell-range'
import type { CellRange } from './cell-range'
import { projectCellStyle, type CellStyle } from './cell-style'
import { CellValuePipeline } from './cell-value'
import { EditManager, type EditCommitMove } from './editing/edit-manager'
import type { TextEditorHost } from './editing/text-editor'
import { EditorRegistry } from './editor-registry'
import {
  hitFillHandle,
  resolveFocusRange,
  type FillDragEndEvent,
  type FillDragEndListener,
  type FillHandleDownEvent,
  type FillHandleDownListener,
} from './fill-handle'
import {
  clampFrozenCount,
  computeColOffsets,
  computeRowOffsets,
  computeScrollableColWindow,
  computeScrollableRowWindowFromOffsets,
  findColAt,
  findRowAt,
  resolveCellX,
  resolveCellYFromOffsets,
  unionRegions,
  type WindowRange,
} from './grid-layout'
import { HoverState } from './hover-state'
import { FloatObjectLayer } from './float/float-object-layer'
import { InteractionOverlay, type ResizeLine } from './interaction-overlay'
import { nextActiveCell, revealAxis } from './keyboard-navigation'
import { ImageCellNode } from './media/image-cell-node'
import { ImageService, type ImageLoadEvent, type LoadedImage } from './media/image-service'
import { MediaCache } from './media/media-cache'
import { ModelBinding } from './model-binding'
import type { TablePlugin } from './plugin'
import {
  hitResizeHandle,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  ResizeSession,
  type ColResizeEndEvent,
  type ResizeGeometry,
  type ResizeTarget,
  type RowResizeEndEvent,
} from './resize'
import { ScrollManager, type ScrollDelta, type ScrollState } from './scroll-manager'
import {
  normalizeRange,
  SelectionState,
  type SelectionListener,
  type SelectionRange,
  type SelectionSnapshot,
} from './selection'
import { extendsTheme, type TableTheme } from './theme'
import { InertiaScroller, TouchScrollTracker } from './touch-scroll'
import type {
  CellChangeEvent,
  CellRef,
  ContextMenuListener,
  ListTableOptions,
  TableContextMenuEvent,
} from './types'

/** 行号列/表头节点用 -1 标记非数据格坐标 */
const HEADER_COORD = -1

/** onScrollFrame 帧级同步回调：滚动帧上带最新滚动位置触发（同帧多次滚动只触发一次） */
export type ScrollFrameListener = (state: ScrollState) => void

/** 图片加载窗口余量（px）：可视区域四周外扩的预挂范围，滚出即取消降级 */
const IMAGE_WINDOW_MARGIN = 240

/** 双击/双触判定窗口与位移阈值（鼠标双击与触控双击统一走指针事件流） */
const DOUBLE_TAP_MS = 400
const DOUBLE_TAP_SLOP = 10

/** 「合并不跨冻结边界」校验（构造期语义，运行时冻结/合并变更同样适用）；违规抛错，调用方保持原状 */
function assertMergesWithinBoundary(
  ranges: readonly CellRange[],
  frozenColCount: number,
  frozenRowCount: number,
): void {
  for (const range of ranges) {
    if (rangeCrossesBoundary(range, frozenColCount, frozenRowCount)) {
      throw new Error(
        `merge range [${range.startCol},${range.startRow} ~ ${range.endCol},${range.endRow}] ` +
          'crosses the frozen boundary',
      )
    }
  }
}

export class ListTable {
  private readonly host: RenderHost
  private readonly ownHost: boolean
  private readonly body: LayerHandle
  private readonly sky: LayerHandle
  private readonly pipeline: CellValuePipeline
  private readonly scroll = new ScrollManager()
  private readonly binding: ModelBinding | null = null
  private colOffsets: number[]
  private colWidths: number[]
  private readonly width: number
  private readonly height: number
  private readonly theme: TableTheme
  private readonly rowHeight: number
  private readonly headerHeight: number
  private readonly rowHeaderWidth: number
  private frozenColCount: number
  private frozenRowCount: number
  private frozenColsWidth: number
  private frozenRowsHeight: number
  private mergeCells: MergeCellMap
  /** 图片资源服务：窗口化加载 + 位图 LRU + 无闪协议状态源（public 供宿主配置/订阅事件） */
  readonly imageService: ImageService
  /** cell 级位图 LRU：按格缓存已就绪位图引用，滚动重建时命中即首帧无闪 */
  private readonly mediaCache = new MediaCache<LoadedImage>()
  /** L2 media 层：首个图片格出现时惰性创建 */
  private media: LayerHandle | null = null
  /** 当前窗口内的图片格节点，key 为 `col:row`（随窗口重建） */
  private readonly imageCellNodes = new Map<string, ImageCellNode>()
  /** 浮动对象层（首次访问 floatObjects 时惰性建承载容器，挂在已用的 sky 层最顶） */
  private floatLayer: FloatObjectLayer | null = null
  /** 已注册插件（销毁时逆序卸载） */
  private readonly plugins: TablePlugin[] = []
  /** 当前窗口内的数据格节点，key 为 `col:row`（合并区只登记主格，随窗口重建） */
  private readonly cellNodes = new Map<string, CellNode>()
  private rows: WindowRange = { start: 0, end: 0 }
  private cols: WindowRange = { start: 0, end: 0 }
  private destroyed = false
  /** 逐行高度覆盖（行 resize 产物）；缺省用 rowHeight */
  private readonly rowHeights = new Map<number, number>()
  private rowOffsets: number[]
  private readonly selection = new SelectionState()
  private readonly hoverState = new HoverState()
  private readonly overlay: InteractionOverlay
  private readonly touchTracker = new TouchScrollTracker()
  private readonly inertia: InertiaScroller
  private resizeSession: ResizeSession | null = null
  private resizeLine: ResizeLine | null = null
  private selecting = false
  private overlayHadContent = false
  private batchDepth = 0
  private readonly batchRegions: Region[] = []
  private readonly contextMenuListeners = new Set<ContextMenuListener>()
  private readonly scrollFrameListeners = new Set<ScrollFrameListener>()
  /** 编辑提交事件订阅（col/row/oldValue/newValue） */
  private readonly cellChangeListeners = new Set<(change: CellChangeEvent) => void>()
  /** 列宽拖拽会话结束事件订阅（col/width） */
  private readonly colResizeEndListeners = new Set<(event: ColResizeEndEvent) => void>()
  /** 行高拖拽会话结束事件订阅（row/height） */
  private readonly rowResizeEndListeners = new Set<(event: RowResizeEndEvent) => void>()
  /** 填充柄按下事件订阅（携带柄所在选区段） */
  private readonly fillHandleDownListeners = new Set<FillHandleDownListener>()
  /** 填充柄拖拽结束事件订阅（锚定段范围 + 拖拽目标格范围） */
  private readonly fillDragEndListeners = new Set<FillDragEndListener>()
  /** 填充柄拖拽会话：柄所在选区段 + 拖拽起点（锚定段右下角格）与终点格（填充生成不在内核） */
  private fillDrag: { range: SelectionRange; origin: CellRef; current: CellRef } | null = null
  /** 编辑状态唯一源：进入/提交/取消生命周期 */
  private readonly editManager: EditManager
  /** 编辑器注册表（可编第一级判定与格级路由），可注入或事后注册 */
  readonly editorRegistry: EditorRegistry
  /** 编辑器浮层挂载容器（hostOptions.container）；缺省离屏不落 DOM */
  private readonly container: HTMLElement | undefined
  /** 双击/双触检测：上一次落点（同格、时长与位移阈值内判定连击进编辑） */
  private lastTap: { col: number; row: number; x: number; y: number; time: number } | null = null
  /** pointerdown 落点（连击位移阈值判定用） */
  private pointerDownAt: { x: number; y: number } | null = null
  /** 挂在场景根上的事件退订（注入 host 共享场景树时销毁必须解绑） */
  private readonly eventUnsubscribers: Array<() => void> = []
  /** 稳定引用：同帧内多次滚动只收敛出一次 onScrollFrame 广播 */
  private readonly scrollFrameTask = () => {
    const state = this.scroll.state
    for (const listener of this.scrollFrameListeners) {
      listener(state)
    }
  }

  constructor(private readonly options: ListTableOptions) {
    this.width = options.width
    this.height = options.height
    // 主题接入样式管线：几何与格样式默认取自主题，显式 options 优先
    this.theme = extendsTheme(options.theme)
    this.rowHeight = options.rowHeight ?? this.theme.rowHeight
    this.headerHeight = options.headerHeight ?? this.theme.headerHeight
    this.rowHeaderWidth = options.rowHeaderWidth ?? this.theme.rowHeaderWidth
    const defaultColWidth = options.defaultColWidth ?? this.theme.defaultColWidth
    this.colWidths = options.columns.map((col) => col.width ?? defaultColWidth)
    this.colOffsets = computeColOffsets(this.colWidths)
    this.pipeline = new CellValuePipeline({
      columns: options.columns,
      records: options.records,
      model: options.model,
      resolveDisplayValue: options.resolveDisplayValue,
      rowCount: options.rowCount,
    })
    this.rowOffsets = computeRowOffsets(this.pipeline.rowCount, this.rowHeight, this.rowHeights)
    // 冻结区域划分：冻结列固定于行号列右侧，冻结行固定于列头下侧
    this.frozenColCount = clampFrozenCount(options.frozenColCount ?? 0, options.columns.length)
    this.frozenRowCount = clampFrozenCount(options.frozenRowCount ?? 0, this.pipeline.rowCount)
    this.frozenColsWidth = this.colOffsets[this.frozenColCount] ?? 0
    this.frozenRowsHeight = this.rowOffsets[this.frozenRowCount] ?? 0
    this.mergeCells = new MergeCellMap(options.mergeCells)
    assertMergesWithinBoundary(this.mergeCells.ranges, this.frozenColCount, this.frozenRowCount)
    this.host =
      options.host ??
      createRenderHost({ width: this.width, height: this.height, ...options.hostOptions })
    this.ownHost = !options.host
    this.body = this.host.createLayer({ kind: 'body' })
    this.sky = this.host.createLayer({ kind: 'sky' })
    this.imageService = new ImageService(options.imageServiceOptions)
    // 图片加载完成 → 引用它的可见格定向失效（替代整层重绘，同帧多图由失效队列收敛合并）
    this.imageService.onImageLoad((e) => this.onImageServiceLoad(e))
    this.inertia = new InertiaScroller(
      (dx, dy) => this.scroll.scrollBy(dx, dy),
      (task) => this.host.requestFrame(task),
    )
    this.overlay = new InteractionOverlay(this.sky.root, {
      cellRect: (col, row) => this.cellRectInViewport(col, row),
      bodyViewport: this.bodyViewport,
    })
    // 滚动位置定义在可滚动内容（总内容扣除冻结区）上
    this.scroll.setViewportSize(
      this.viewportWidth - this.frozenColsWidth,
      this.viewportHeight - this.frozenRowsHeight,
    )
    this.scroll.setContentSize(
      this.contentWidth - this.frozenColsWidth,
      this.contentHeight - this.frozenRowsHeight,
    )
    this.scroll.onScroll((_state, delta) => this.onScroll(delta))
    // 图片加载窗口先就位：首帧窗口外请求不发起
    this.updateImageWindow()
    if (options.model) {
      this.binding = new ModelBinding(options.model, (change) =>
        this.refreshCell(change.col, change.row),
      )
      this.binding.attach()
    }
    this.container = options.hostOptions?.container
    this.editorRegistry = options.editorRegistry ?? new EditorRegistry()
    this.editManager = new EditManager({
      columns: options.columns,
      registry: this.editorRegistry,
      resolveEditable: options.resolveEditable,
      writeTarget: {
        canWrite: (col, row) => this.canWriteCell(col, row),
        write: (col, row, value) => this.writeCell(col, row, value),
      },
      resolveValue: (col, row) => this.pipeline.resolveValue(col, row),
      cellRect: (col, row) => this.cellRectInViewport(col, row),
      refreshCell: (col, row) => this.refreshCell(col, row),
      emitChange: (change) => {
        for (const listener of this.cellChangeListeners) {
          listener(change)
        }
      },
      moveSelection: (col, row, move) => this.moveSelectionAfterCommit(col, row, move),
      restoreFocus: () => this.container?.focus(),
      // 真实容器运行时满足最小宿主结构（编辑器元素本就是真 Node）
      host: this.container as TextEditorHost | undefined,
      // 滚动帧驱动编辑跟随：浮层逐帧对齐锚定格，滚出视口自动提交
      subscribeScrollFrame: (listener) => this.onScrollFrame(listener),
    })
    this.bindInteractionEvents()
    this.rebuildScene()
    this.host.submitInvalidation('body', { type: 'full' })
    for (const plugin of options.plugins ?? []) {
      this.use(plugin)
    }
  }

  /** 当前生效主题（基于默认主题 extends 派生） */
  getTheme(): TableTheme {
    return this.theme
  }

  /** 插件统一注册路径：注册即挂载生效，销毁时逆序卸载 */
  use(plugin: TablePlugin): void {
    this.plugins.push(plugin)
    plugin.mount(this)
  }

  /**
   * 浮动对象层（格上图片/图表）：承载容器挂在 sky 层最顶（在选区/hover 浮层之上）。
   * 锚点经 resolveCellX/resolveCellYFromOffsets 换算层坐标（含冻结与滚动偏移），
   * 滚动时 syncPositions 帧级跟随。
   */
  get floatObjects(): FloatObjectLayer {
    if (!this.floatLayer) {
      this.floatLayer = new FloatObjectLayer({
        layer: this.sky,
        geometry: {
          cellOrigin: (col, row) => ({
            x: resolveCellX(
              col,
              this.scroll.state.left,
              this.colOffsets,
              this.frozenColCount,
              this.rowHeaderWidth,
            ),
            y: resolveCellYFromOffsets(
              row,
              this.scroll.state.top,
              this.rowOffsets,
              this.frozenRowCount,
              this.headerHeight,
            ),
          }),
          cellSize: (col, row) => ({ width: this.getColWidth(col), height: this.rowHeightAt(row) }),
        },
        imageService: this.imageService,
      })
    }
    return this.floatLayer
  }

  getScrollState(): ScrollState {
    return this.scroll.state
  }

  /** 当前可视窗口（[start, end) 行列区间，不含冻结区——冻结行列始终可见） */
  getVisibleRange(): { rows: WindowRange; cols: WindowRange } {
    return { rows: this.rows, cols: this.cols }
  }

  scrollTo(left: number, top: number): void {
    this.scroll.scrollTo(left, top)
  }

  scrollBy(dx: number, dy: number): void {
    this.scroll.scrollBy(dx, dy)
  }

  /** 单元格最终显示文本（经取值管线，同步 O(1)）；被合并覆盖的格取主格文本 */
  getCellText(col: number, row: number): string {
    const master = this.mergeCells.masterOf(col, row)
    return this.pipeline.resolveText(master?.col ?? col, master?.row ?? row)
  }

  /** 表格回驱模型：模型 echo 由 ModelBinding 吞掉防回环，随后本格局部刷新一次 */
  updateCell(col: number, row: number, value: unknown): void {
    if (!this.binding) {
      return
    }
    this.binding.writeBack(col, row, value)
    this.refreshCell(col, row)
  }

  /**
   * 局部刷新单格：被合并覆盖的坐标路由到主格节点；窗口内则更新节点内容、
   * 重投影样式并登记 cell 失效（合并区失效为主格包围盒），窗口外忽略；
   * 失效区并入溢出 extents：旧溢出区防文字变短残影、新溢出区补画；本格变空时
   * 向左扩到最近溢出来源格，让它的溢出收回；
   * 批量更新（batchUpdate）期间失效区域改为收集，批末合并为一次 band 提交
   */
  refreshCell(col: number, row: number): void {
    const master = this.mergeCells.masterOf(col, row)
    const masterCol = master?.col ?? col
    const masterRow = master?.row ?? row
    this.refreshImageCell(masterCol, masterRow)
    const node = this.cellNodes.get(`${masterCol}:${masterRow}`)
    if (!node) {
      return
    }
    const prevBounds = node.getGlobalBounds()
    const prevMaxX = node.textMaxX
    const prevHasText = node.text !== ''
    node.setContent(
      this.pipeline.resolveText(masterCol, masterRow),
      this.pipeline.resolveValue(masterCol, masterRow),
    )
    node.style = this.resolveStyle(masterCol, masterRow)
    node.renderer = this.options.resolveCellRenderer?.(masterCol, masterRow) ?? null
    const limitX = this.textOverflowLimitX(masterCol, masterRow, node.style, this.scroll.state.left)
    node.textMaxX = limitX === null ? node.width : limitX - node.x
    const regions: Region[] = [node.getGlobalBounds()]
    if (prevMaxX > node.width) {
      regions.push({
        x: prevBounds.x,
        y: prevBounds.y,
        width: prevMaxX,
        height: prevBounds.height,
      })
    }
    if (node.textMaxX > node.width) {
      const bounds = regions[0]!
      regions.push({ x: bounds.x, y: bounds.y, width: node.textMaxX, height: bounds.height })
    }
    // 左侧溢出来源联动：本格变空（来源格穿过本格继续溢出）、变非空（来源格溢出收回）、
    // 保持为空（本格重绘会擦掉来源格经过本格的文本）时，重算来源格右界并并入其新旧溢出区
    if (!node.text || prevHasText !== (node.text !== '')) {
      const sourceCol = this.overflowSourceCol(masterCol, masterRow)
      const sourceNode =
        sourceCol !== null ? this.cellNodes.get(`${sourceCol}:${masterRow}`) : undefined
      if (sourceCol !== null && sourceNode) {
        const oldExtent = sourceNode.textMaxX
        const sourceLimit = this.textOverflowLimitX(
          sourceCol,
          masterRow,
          sourceNode.style,
          this.scroll.state.left,
        )
        sourceNode.textMaxX = sourceLimit === null ? sourceNode.width : sourceLimit - sourceNode.x
        regions.push({
          x: sourceNode.x,
          y: sourceNode.y,
          width: Math.max(oldExtent, sourceNode.textMaxX),
          height: sourceNode.height,
        })
      }
    }
    const region = unionRegions(regions) ?? regions[0]!
    if (this.batchDepth > 0) {
      this.batchRegions.push(region)
      return
    }
    this.host.submitInvalidation('body', { type: 'cell', region })
  }

  /** 批量更新：fn 内的多次变更合并，结束时只提交一次 band 失效（一帧收敛一次渲染提交） */
  batchUpdate(fn: () => void): void {
    this.batchDepth++
    try {
      fn()
    } finally {
      this.batchDepth--
      if (this.batchDepth === 0) {
        const region = unionRegions(this.batchRegions)
        this.batchRegions.length = 0
        if (region) {
          this.host.submitInvalidation('body', { type: 'band', region })
        }
      }
    }
  }

  // ---- 选区（P5） ----

  getSelection(): SelectionSnapshot {
    return this.selection.snapshot
  }

  /** 订阅选区变更；返回退订函数 */
  onSelectionChange(listener: SelectionListener): () => void {
    return this.selection.onChange(listener)
  }

  selectCell(col: number, row: number): void {
    this.selection.selectCell(col, row)
    this.ensureCellVisible(col, row)
  }

  /** 程序化多段选中：整组替换选区段（快照含多个段，sky 浮层同帧绘制全部段），焦点落在末段焦点格 */
  selectCells(ranges: readonly SelectionRange[]): void {
    this.selection.selectCells(ranges)
  }

  /** 当前全部选区段（start 锚点 / end 焦点，可反向；返回副本） */
  getSelectedCellRanges(): SelectionRange[] {
    return this.selection.snapshot.ranges.map((range) => ({
      start: { ...range.start },
      end: { ...range.end },
    }))
  }

  selectRow(row: number): void {
    this.selection.selectRow(row, this.options.columns.length)
  }

  selectCol(col: number): void {
    this.selection.selectCol(col, this.pipeline.rowCount)
  }

  selectAll(): void {
    this.selection.selectAll(this.options.columns.length, this.pipeline.rowCount)
  }

  clearSelection(): void {
    this.selection.clear()
  }

  /** 外部模型回写选区：应用并刷新浮层但不广播，防回环 */
  applyExternalSelection(snapshot: SelectionSnapshot): void {
    this.selection.applyExternal(snapshot)
    this.refreshOverlay()
  }

  // ---- 行列 resize（P5，canResizeRow 能力见 ListTableOptions） ----

  getColWidth(col: number): number {
    return this.colWidths[col] ?? 0
  }

  getRowHeight(row: number): number {
    return this.rowHeightAt(row)
  }

  setColWidth(col: number, width: number): void {
    if (col < 0 || col >= this.colWidths.length) {
      return
    }
    this.colWidths[col] = Math.max(MIN_COL_WIDTH, width)
    this.colOffsets = computeColOffsets(this.colWidths)
    this.applyGeometryChange()
  }

  setRowHeight(row: number, height: number): void {
    if (row < 0 || row >= this.pipeline.rowCount) {
      return
    }
    this.rowHeights.set(row, Math.max(MIN_ROW_HEIGHT, height))
    this.rowOffsets = computeRowOffsets(this.pipeline.rowCount, this.rowHeight, this.rowHeights)
    this.applyGeometryChange()
  }

  // ---- 几何/滚动查询（P0-7） ----

  /** 数据格在视口中的矩形（CSS 像素）；行/列在可视窗口外返回 null */
  getCellRelativeRect(col: number, row: number): Region | null {
    return this.cellRectInViewport(col, row)
  }

  /** 视口坐标命中的数据格；点在行列头/空白处返回 null */
  getCellAtRelativePosition(x: number, y: number): CellRef | null {
    return this.cellAt(x, y)
  }

  /** 滚动到目标格完整可见（复用键盘导航 revealAxis 语义；冻结轴恒可见，跳过） */
  scrollToCell(cell: CellRef): void {
    this.ensureCellVisible(cell.col, cell.row)
  }

  getScrollLeft(): number {
    return this.scroll.state.left
  }

  getScrollTop(): number {
    return this.scroll.state.top
  }

  /** 设置横向滚动位置（自动夹取到 [0, max]，另一轴不变） */
  setScrollLeft(left: number): void {
    this.scroll.scrollTo(left, this.scroll.state.top)
  }

  /** 设置纵向滚动位置（自动夹取到 [0, max]，另一轴不变） */
  setScrollTop(top: number): void {
    this.scroll.scrollTo(this.scroll.state.left, top)
  }

  /** 画布内容区矩形（CSS 像素）：扣除行号列与列头后的数据区可绘制范围 */
  getDrawRange(): Region {
    return this.bodyViewport
  }

  /** 当前可视数据格范围（[start, end)，恒可见的冻结行列并入可视范围） */
  getBodyVisibleCellRange(): { rows: WindowRange; cols: WindowRange } {
    return {
      rows: {
        start: this.frozenRowCount > 0 ? 0 : this.rows.start,
        end: Math.max(this.rows.end, this.frozenRowCount),
      },
      cols: {
        start: this.frozenColCount > 0 ? 0 : this.cols.start,
        end: Math.max(this.cols.end, this.frozenColCount),
      },
    }
  }

  /** (col,row) 是否行号列格 */
  isSeriesNumber(col: number, row: number): boolean {
    return col === HEADER_COORD && row >= 0 && row < this.pipeline.rowCount
  }

  /** 表头层数：本表列头固定 1 层 */
  getHeaderLevelCount(): number {
    return 1
  }

  // ---- 冻结与合并运行时可变（P8） ----

  /** 当前冻结列数（数据列，不含行号列） */
  getFrozenColCount(): number {
    return this.frozenColCount
  }

  /** 当前冻结行数（数据行，不含列头） */
  getFrozenRowCount(): number {
    return this.frozenRowCount
  }

  /** 运行时修改冻结列数：夹取到 [0, 列数]；会使既有合并区跨冻结边界时抛错并保持原状 */
  setFrozenColCount(count: number): void {
    this.applyFrozenCounts(count, this.frozenRowCount)
  }

  /** 运行时修改冻结行数：夹取到 [0, 行数]；会使既有合并区跨冻结边界时抛错并保持原状 */
  setFrozenRowCount(count: number): void {
    this.applyFrozenCounts(this.frozenColCount, count)
  }

  /**
   * 运行时整体替换合并区：重叠/跨冻结边界等校验全部通过才生效（否则抛错保持原状），
   * 生效即全量重建，合并渲染与命中即时反映新集合。
   */
  setMergeCells(ranges: readonly CellRange[]): void {
    this.replaceMergeCells(new MergeCellMap(ranges))
  }

  /** 运行时新增一个合并区：与既有区间重叠或跨冻结边界时抛错并保持原状 */
  addMergeCell(range: CellRange): void {
    this.replaceMergeCells(new MergeCellMap([...this.mergeCells.ranges, range]))
  }

  /** 运行时移除一个合并区（按归一化后精确匹配）；未命中为空操作 */
  removeMergeCell(range: CellRange): void {
    const target = normalizeCellRange(range)
    const next = this.mergeCells.ranges.filter(
      (r) =>
        r.startCol !== target.startCol ||
        r.startRow !== target.startRow ||
        r.endCol !== target.endCol ||
        r.endRow !== target.endRow,
    )
    if (next.length === this.mergeCells.ranges.length) {
      return
    }
    this.replaceMergeCells(new MergeCellMap(next))
  }

  /** 冻结数运行时变更：先校验既有合并区（失败抛错原状不变），落地后走几何变更全量重建 */
  private applyFrozenCounts(frozenColCount: number, frozenRowCount: number): void {
    const nextCols = clampFrozenCount(frozenColCount, this.options.columns.length)
    const nextRows = clampFrozenCount(frozenRowCount, this.pipeline.rowCount)
    if (nextCols === this.frozenColCount && nextRows === this.frozenRowCount) {
      return
    }
    assertMergesWithinBoundary(this.mergeCells.ranges, nextCols, nextRows)
    this.frozenColCount = nextCols
    this.frozenRowCount = nextRows
    this.applyGeometryChange()
  }

  /** 合并区集合运行时替换：先校验（失败抛错原状不变），落地后走几何变更全量重建 */
  private replaceMergeCells(next: MergeCellMap): void {
    assertMergesWithinBoundary(next.ranges, this.frozenColCount, this.frozenRowCount)
    this.mergeCells = next
    this.applyGeometryChange()
  }

  // ---- 事件（P5） ----

  /** 订阅 contextmenu 事件（右键菜单 UI 为非目标，仅保留事件）；返回退订函数 */
  onContextMenu(listener: ContextMenuListener): () => void {
    this.contextMenuListeners.add(listener)
    return () => this.contextMenuListeners.delete(listener)
  }

  /** 订阅 onScrollFrame 帧级同步：滚动发生的帧上带最新位置触发一次；返回退订函数 */
  onScrollFrame(listener: ScrollFrameListener): () => void {
    this.scrollFrameListeners.add(listener)
    return () => this.scrollFrameListeners.delete(listener)
  }

  /** 订阅列宽拖拽会话结束事件（col/width，width 为夹取后的最终生效值）；返回退订函数 */
  onColResizeEnd(listener: (event: ColResizeEndEvent) => void): () => void {
    this.colResizeEndListeners.add(listener)
    return () => this.colResizeEndListeners.delete(listener)
  }

  /** 订阅行高拖拽会话结束事件（row/height，height 为夹取后的最终生效值）；返回退订函数 */
  onRowResizeEnd(listener: (event: RowResizeEndEvent) => void): () => void {
    this.rowResizeEndListeners.add(listener)
    return () => this.rowResizeEndListeners.delete(listener)
  }

  /** 订阅填充柄按下事件（range 为柄所在选区段）；返回退订函数 */
  onFillHandleDown(listener: FillHandleDownListener): () => void {
    this.fillHandleDownListeners.add(listener)
    return () => this.fillHandleDownListeners.delete(listener)
  }

  /** 订阅填充柄拖拽结束事件（anchor 锚定段范围 + target 拖拽目标格范围，均为 min/max 序）；返回退订函数 */
  onFillDragEnd(listener: FillDragEndListener): () => void {
    this.fillDragEndListeners.add(listener)
    return () => this.fillDragEndListeners.delete(listener)
  }

  // ---- 编辑（P2） ----

  /**
   * 进入编辑：可编三级判定（editor 声明/路由 ∧ 格级 editable ∧ 有回写目标）全通过才
   * 打开浮层并返回 true；不可编返回 false 且无浮层。已编辑中同格幂等。
   */
  startEdit(col: number, row: number): boolean {
    if (!this.editManager.isEditable(col, row)) {
      return false
    }
    // 锚定格先滚动跟随到完整可见（冻结轴恒可见），再按视口矩形打开浮层
    this.selection.selectCell(col, row)
    this.ensureCellVisible(col, row)
    return this.editManager.startEdit(col, row)
  }

  /** 提交当前编辑：值回写数据源、该格 cell 级失效、抛 onCellChange；无会话返回 false */
  commitEdit(): boolean {
    return this.editManager.commitEdit()
  }

  /** 取消当前编辑：不回写不抛事件，焦点交还表格；无会话为空操作 */
  cancelEdit(): void {
    this.editManager.cancelEdit()
  }

  /** 当前是否处于编辑会话中 */
  isEditing(): boolean {
    return this.editManager.isEditing()
  }

  /** 订阅编辑提交事件（col/row/oldValue/newValue，undo 可据此实现）；返回退订函数 */
  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.cellChangeListeners.add(listener)
    return () => this.cellChangeListeners.delete(listener)
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.inertia.stop()
    this.editManager.dispose()
    for (const unsubscribe of this.eventUnsubscribers) {
      unsubscribe()
    }
    this.eventUnsubscribers.length = 0
    for (let i = this.plugins.length - 1; i >= 0; i--) {
      this.plugins[i]?.unmount?.(this)
    }
    this.plugins.length = 0
    this.binding?.dispose()
    this.floatLayer?.dispose()
    this.imageService.dispose()
    if (this.ownHost) {
      this.host.destroy()
    }
  }

  private get viewportWidth(): number {
    return Math.max(0, this.width - this.rowHeaderWidth)
  }

  private get viewportHeight(): number {
    return Math.max(0, this.height - this.headerHeight)
  }

  /** 数据区在层坐标中的可绘制矩形（扣除行号列与列头，CSS 像素） */
  private get bodyViewport(): Region {
    return {
      x: this.rowHeaderWidth,
      y: this.headerHeight,
      width: this.viewportWidth,
      height: this.viewportHeight,
    }
  }

  private get contentWidth(): number {
    return this.colOffsets[this.colOffsets.length - 1] ?? 0
  }

  private get contentHeight(): number {
    return this.rowOffsets[this.pipeline.rowCount] ?? 0
  }

  private rowHeightAt(row: number): number {
    return (this.rowOffsets[row + 1] ?? 0) - (this.rowOffsets[row] ?? 0)
  }

  /** 数据格样式投影：列级 textWrap 先并入主题 body token，再由 resolveCellStyle hook 逐字段/逐边覆盖 */
  private resolveStyle(col: number, row: number): CellStyle {
    const base = this.options.columns[col]?.textWrap
      ? { ...this.theme.body, textWrap: true }
      : this.theme.body
    return projectCellStyle(base, this.options.resolveCellStyle?.(col, row))
  }

  /**
   * 滚动主循环：状态源广播 → 窗口重建 → 按滚动方向分层 band 失效。
   * 纵向滚动只重绘冻结行以下的横带（含行号列/冻结列/滚动区），
   * 横向滚动只重绘冻结列以右的纵带（含列头/冻结行/滚动区），冻结角与对侧冻结区不重绘。
   */
  private onScroll(delta: ScrollDelta): void {
    this.rebuildScene()
    if (delta.dy !== 0) {
      const y = this.headerHeight + this.frozenRowsHeight
      const band = { x: 0, y, width: this.width, height: Math.max(0, this.height - y) }
      this.host.submitInvalidation('body', { type: 'band', region: band })
      if (this.media) {
        this.host.submitInvalidation('media', { type: 'band', region: band })
      }
    }
    if (delta.dx !== 0) {
      const x = this.rowHeaderWidth + this.frozenColsWidth
      const band = { x, y: 0, width: Math.max(0, this.width - x), height: this.height }
      this.host.submitInvalidation('body', { type: 'band', region: band })
      if (this.media) {
        this.host.submitInvalidation('media', { type: 'band', region: band })
      }
    }
    // 窗口化加载调度：划入窗口的请求提权、滚出的取消；浮动对象帧级跟随
    this.updateImageWindow()
    if (this.floatLayer && this.floatLayer.size > 0) {
      this.floatLayer.syncPositions()
    }
    this.refreshOverlay()
    if (this.scrollFrameListeners.size > 0) {
      this.host.requestFrame(this.scrollFrameTask)
    }
  }

  /** 重建可视窗口场景：数据格在前、行列头在后（同层后画覆盖边缘半格） */
  private rebuildScene(): void {
    const root = this.body.root
    while (root.children.length > 0) {
      root.removeChild(root.children[0]!)
    }
    this.cellNodes.clear()
    if (this.media) {
      const mediaRoot = this.media.root
      while (mediaRoot.children.length > 0) {
        mediaRoot.removeChild(mediaRoot.children[0]!)
      }
    }
    this.imageCellNodes.clear()
    const { left, top } = this.scroll.state
    const scrollableRows = computeScrollableRowWindowFromOffsets(
      top,
      this.viewportHeight - this.frozenRowsHeight,
      this.rowOffsets,
      this.frozenRowCount,
    )
    const scrollableCols = computeScrollableColWindow(
      left,
      this.viewportWidth - this.frozenColsWidth,
      this.colOffsets,
      this.frozenColCount,
    )
    this.rows = scrollableRows
    this.cols = scrollableCols
    // 分层顺序：滚动区在最下，部分可见合并区同属滚动层，冻结条带居中，冻结角最上
    // （滚动内容滑到冻结区下方，由后画的冻结区覆盖）
    const frozenRows: WindowRange = { start: 0, end: this.frozenRowCount }
    const frozenCols: WindowRange = { start: 0, end: this.frozenColCount }
    this.appendCellBand(scrollableRows, scrollableCols, left, top)
    this.appendPartiallyVisibleMerges(
      left,
      top,
      [frozenRows, scrollableRows],
      [frozenCols, scrollableCols],
    )
    this.appendCellBand(scrollableRows, frozenCols, left, top)
    this.appendCellBand(frozenRows, scrollableCols, left, top)
    this.appendCellBand(frozenRows, frozenCols, left, top)
    this.appendHeaders(left, top, frozenRows, scrollableRows, frozenCols, scrollableCols)
  }

  /** 建一个行列带内的数据格节点；同行按列降序建（后画在上），左格溢出文本不被右格背景盖住 */
  private appendCellBand(rows: WindowRange, cols: WindowRange, left: number, top: number): void {
    for (let row = rows.start; row < rows.end; row++) {
      for (let col = cols.end - 1; col >= cols.start; col--) {
        this.appendCell(col, row, left, top)
      }
    }
  }

  /** 建单格节点：被合并覆盖的格不建节点（由主格统一取值/绘制/命中），主格跨域取完整尺寸 */
  private appendCell(col: number, row: number, left: number, top: number): void {
    const range = this.mergeCells.rangeAt(col, row)
    if (range && (range.startCol !== col || range.startRow !== row)) {
      return
    }
    const endCol = range?.endCol ?? col
    const endRow = range?.endRow ?? row
    // 图片格：body 节点只画背景/边框（文本留空），图片内容在 L2 media 层渲染
    const imageUrl = this.options.resolveCellImage?.(col, row)
    const style = this.resolveStyle(col, row)
    const node = new CellNode({
      col,
      row,
      x: resolveCellX(col, left, this.colOffsets, this.frozenColCount, this.rowHeaderWidth),
      y: resolveCellYFromOffsets(row, top, this.rowOffsets, this.frozenRowCount, this.headerHeight),
      width: (this.colOffsets[endCol + 1] ?? 0) - (this.colOffsets[col] ?? 0),
      height: (this.rowOffsets[endRow + 1] ?? 0) - (this.rowOffsets[row] ?? 0),
      text: imageUrl ? '' : this.pipeline.resolveText(col, row),
      value: this.pipeline.resolveValue(col, row),
      cellType: this.options.columns[col]?.cellType,
      style,
      renderer: this.options.resolveCellRenderer?.(col, row) ?? null,
    })
    // 文本溢出右界（Excel 式溢出到右侧空格；换行/表头/合并/图片/自定义渲染格不溢出）
    const limitX = imageUrl ? null : this.textOverflowLimitX(col, row, style, left)
    node.textMaxX = limitX === null ? node.width : limitX - node.x
    this.body.root.appendChild(node)
    this.cellNodes.set(`${col}:${row}`, node)
    if (imageUrl) {
      this.appendImageCell(col, row, imageUrl, node.x, node.y, node.width, node.height)
    }
  }

  /** 空文本数据格判定（溢出邻居扫描用）：text 类型、无图片/自定义渲染/合并覆盖、取值文本为空 */
  private isEmptyTextCell(col: number, row: number): boolean {
    return (
      (this.options.columns[col]?.cellType ?? 'text') === 'text' &&
      !this.options.resolveCellRenderer?.(col, row) &&
      !this.options.resolveCellImage?.(col, row) &&
      !this.mergeCells.rangeAt(col, row) &&
      !this.pipeline.resolveText(col, row)
    )
  }

  /**
   * 文本溢出允许的层坐标右界；null 表示该格不溢出（裁剪在本格内）。
 * Excel 规则：只溢出到右侧相邻空格，遇非空格停；换行、ellipsis/clip、checkbox、合并、图片、
 * 自定义渲染格不溢出；冻结列带不越过带边界（对齐 Excel 冻结窗格），滚动带止于最后一列。
   */
  private textOverflowLimitX(
    col: number,
    row: number,
    style: CellStyle,
    left: number,
  ): number | null {
    if (
      style.textOverflow !== undefined ||
      style.textWrap === true ||
      (this.options.columns[col]?.cellType ?? 'text') !== 'text' ||
      this.options.resolveCellRenderer?.(col, row) ||
      this.options.resolveCellImage?.(col, row) ||
      this.mergeCells.rangeAt(col, row) ||
      !this.pipeline.resolveText(col, row)
    ) {
      return null
    }
    const inFrozenBand = col < this.frozenColCount
    const bandEnd = inFrozenBand ? this.frozenColCount : this.options.columns.length
    let end = col + 1
    while (end < bandEnd && this.isEmptyTextCell(end, row)) {
      end++
    }
    if (end === col + 1) {
      return null
    }
    // 列左缘的层坐标（冻结带内不随滚动位移）
    return inFrozenBand
      ? this.rowHeaderWidth + (this.colOffsets[end] ?? 0)
      : this.rowHeaderWidth + (this.colOffsets[end] ?? 0) - left
  }

  /**
   * 左侧最近的非空格列号（溢出来源候选）：从左邻向带首扫，中间全空格无文本不可溢出，
   * 再往左被首个非空格挡住。返回后由调用方重算其溢出右界（不可溢出则收敛回本格宽）
   */
  private overflowSourceCol(col: number, row: number): number | null {
    const bandStart = col < this.frozenColCount ? 0 : this.frozenColCount
    for (let c = col - 1; c >= bandStart; c--) {
      if (!this.isEmptyTextCell(c, row)) {
        return c
      }
    }
    return null
  }

  /** L2 media 层惰性创建（无图片格不建层） */
  private mediaLayer(): LayerHandle {
    if (!this.media) {
      this.media = this.host.createLayer({ kind: 'media' })
    }
    return this.media
  }

  /**
   * 建图片格节点（media 层）。无闪协议：
   * cell 级 LRU 或 ImageService 已就绪 → 首帧直接画真实位图（无"先占位一帧再调整"）；
   * 未就绪 → 登记窗口化请求，placeholderDelay 内连占位都不画（防快速滚动占位闪烁），
   * 加载完成经 onImageServiceLoad 定向失效本格、单帧切换。
   */
  private appendImageCell(
    col: number,
    row: number,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const node = new ImageCellNode({
      col,
      row,
      x,
      y,
      width,
      height,
      url,
      placeholderAfter: Date.now() + this.imageService.placeholderDelay,
      // 边缘半格图片经 body 视口裁剪，不越界画进表头/行号列区域
      bodyViewport: this.bodyViewport,
    })
    const cacheKey = this.imageCacheKey(col, row, width, height)
    const cached = this.mediaCache.get(cacheKey)
    const image = cached ?? this.imageService.getBitmap(url)
    if (image) {
      node.setBitmap(image)
      if (!cached) {
        this.mediaCache.put(cacheKey, image, Math.round(width * height * 4))
      }
    } else {
      this.imageService.request(url, { col, row })
    }
    this.mediaLayer().root.appendChild(node)
    this.imageCellNodes.set(`${col}:${row}`, node)
  }

  /** 图片格局部刷新：URL 变化则原位重建节点；URL 消失则摘除 media 节点 */
  private refreshImageCell(col: number, row: number): void {
    const node = this.imageCellNodes.get(`${col}:${row}`)
    if (!node || !this.media) {
      return
    }
    const region = node.getGlobalBounds()
    const url = this.options.resolveCellImage?.(col, row)
    if (!url) {
      this.media.root.removeChild(node)
      this.imageCellNodes.delete(`${col}:${row}`)
    } else if (url !== node.url) {
      this.media.root.removeChild(node)
      this.imageCellNodes.delete(`${col}:${row}`)
      this.appendImageCell(col, row, url, node.x, node.y, node.width, node.height)
    }
    this.host.submitInvalidation('media', { type: 'cell', region })
  }

  /** 图片加载完成：位图写回引用它的可见格节点 + cell 级 LRU，并逐格定向失效 */
  private onImageServiceLoad(e: ImageLoadEvent): void {
    if (!this.media) {
      return
    }
    const image = this.imageService.getBitmap(e.url)
    if (!image) {
      return
    }
    for (const cell of e.cells) {
      const node = this.imageCellNodes.get(`${cell.col}:${cell.row}`)
      if (!node || node.url !== e.url) {
        continue
      }
      node.setBitmap(image)
      this.mediaCache.put(
        this.imageCacheKey(cell.col, cell.row, node.width, node.height),
        image,
        Math.round(node.width * node.height * 4),
      )
      this.host.submitInvalidation('media', { type: 'cell', region: node.getGlobalBounds() })
    }
  }

  /**
   * 图片加载窗口 = 可视区域（冻结带 + 滚动窗口）外扩 240px 余量；
   * 随滚动调度：窗口内 idle 提权加载，滚出窗口的 loading 取消降级。
   */
  private updateImageWindow(): void {
    const { left, top } = this.scroll.state
    const rows = computeScrollableRowWindowFromOffsets(
      Math.max(0, top - IMAGE_WINDOW_MARGIN),
      this.viewportHeight - this.frozenRowsHeight + IMAGE_WINDOW_MARGIN * 2,
      this.rowOffsets,
      this.frozenRowCount,
    )
    const cols = computeScrollableColWindow(
      Math.max(0, left - IMAGE_WINDOW_MARGIN),
      this.viewportWidth - this.frozenColsWidth + IMAGE_WINDOW_MARGIN * 2,
      this.colOffsets,
      this.frozenColCount,
    )
    this.imageService.updateWindow(
      (cell) =>
        (cell.row < this.frozenRowCount || (cell.row >= rows.start && cell.row < rows.end)) &&
        (cell.col < this.frozenColCount || (cell.col >= cols.start && cell.col < cols.end)),
    )
  }

  private imageCacheKey(col: number, row: number, width: number, height: number): string {
    return `image:${col}:${row}:${Math.round(width)}x${Math.round(height)}`
  }

  /** 合并区主格落在窗口外但区间部分可见时补建主格节点（位置可越出视口，绘制由 cull 裁剪） */
  private appendPartiallyVisibleMerges(
    left: number,
    top: number,
    rowBands: readonly WindowRange[],
    colBands: readonly WindowRange[],
  ): void {
    const visible = (start: number, end: number, bands: readonly WindowRange[]): boolean =>
      bands.some((band) => start < band.end && end >= band.start)
    for (const range of this.mergeCells.ranges) {
      if (this.cellNodes.has(`${range.startCol}:${range.startRow}`)) {
        continue
      }
      if (
        visible(range.startRow, range.endRow, rowBands) &&
        visible(range.startCol, range.endCol, colBands)
      ) {
        this.appendCell(range.startCol, range.startRow, left, top)
      }
    }
  }

  /** 列头（冻结列固定、其余随横向滚动）+ 行号列（冻结行固定、其余随纵向滚动）+ 左上角 */
  private appendHeaders(
    left: number,
    top: number,
    frozenRows: WindowRange,
    scrollableRows: WindowRange,
    frozenCols: WindowRange,
    scrollableCols: WindowRange,
  ): void {
    const root = this.body.root
    // 列头/行号列缺省 ellipsis（超宽标题省略号截断）；主题 header 分区显式给了 textOverflow 则以主题为准
    const headerStyle: CellStyle = { textOverflow: 'ellipsis', ...this.theme.header }
    // 滚动条带先画、冻结条带后画：滑动的行/列头被冻结头覆盖
    for (const cols of [scrollableCols, frozenCols]) {
      for (let col = cols.start; col < cols.end; col++) {
        root.appendChild(
          new CellNode({
            col,
            row: HEADER_COORD,
            x: resolveCellX(col, left, this.colOffsets, this.frozenColCount, this.rowHeaderWidth),
            y: 0,
            width: this.colWidths[col] ?? 0,
            height: this.headerHeight,
            text: this.options.columns[col]?.title ?? '',
            style: headerStyle,
          }),
        )
      }
    }
    for (const rows of [scrollableRows, frozenRows]) {
      for (let row = rows.start; row < rows.end; row++) {
        root.appendChild(
          new CellNode({
            col: HEADER_COORD,
            row,
            x: 0,
            y: resolveCellYFromOffsets(
              row,
              top,
              this.rowOffsets,
              this.frozenRowCount,
              this.headerHeight,
            ),
            width: this.rowHeaderWidth,
            height: this.rowHeightAt(row),
            text: String(row + 1),
            style: headerStyle,
          }),
        )
      }
    }
    root.appendChild(
      new CellNode({
        col: HEADER_COORD,
        row: HEADER_COORD,
        x: 0,
        y: 0,
        width: this.rowHeaderWidth,
        height: this.headerHeight,
        style: headerStyle,
      }),
    )
  }

  // ---- 交互接线（P5） ----

  /** 场景事件统一接线：指针/触摸在 body 根（sky 浮层不可拾取，事件穿透），键盘在最顶层根 */
  private bindInteractionEvents(): void {
    const bodyRoot = this.body.root
    this.eventUnsubscribers.push(
      bodyRoot.on('pointerdown', (event) => this.onPointerDown(event)),
      bodyRoot.on('pointermove', (event) => this.onPointerMove(event)),
      bodyRoot.on('pointerup', (event) => this.onPointerUp(event)),
      bodyRoot.on('contextmenu', (event) => this.onContextMenuEvent(event)),
      bodyRoot.on('touchstart', (event) => this.onTouchStart(event)),
      bodyRoot.on('touchmove', (event) => this.onTouchMove(event)),
      bodyRoot.on('touchend', (event) => this.onTouchEnd(event)),
      bodyRoot.on('touchcancel', () => this.onTouchCancel()),
      this.sky.root.on('keydown', (event) => this.onKeyDown(event)),
      this.selection.onChange(() => this.refreshOverlay()),
      this.hoverState.onChange(() => this.refreshOverlay()),
    )
  }

  private onPointerDown(event: SceneEvent): void {
    this.pointerDownAt = { x: event.x, y: event.y }
    // 编辑中点击其它格/空白：先提交当前会话（同一时刻至多一个编辑会话）
    const hit = this.cellAt(event.x, event.y)
    const editing = this.editManager.editingCell()
    if (editing && (!hit || hit.col !== editing.col || hit.row !== editing.row)) {
      this.editManager.commitEdit()
    }
    const handle = hitResizeHandle(event.x, event.y, this.resizeGeometry(), {
      canResizeCol: this.options.canResizeCol,
      canResizeRow: this.options.canResizeRow,
    })
    if (handle) {
      const startSize =
        handle.kind === 'col' ? this.getColWidth(handle.index) : this.rowHeightAt(handle.index)
      this.resizeSession = new ResizeSession(
        handle,
        startSize,
        handle.kind === 'col' ? event.x : event.y,
      )
      return
    }
    // 填充柄按下：开启拖拽会话并抛按下事件（不改选区，填充生成不在内核）
    const fillRange = this.fillHandleHit(event.x, event.y)
    if (fillRange) {
      const bounds = normalizeRange(fillRange)
      const origin = { col: bounds.maxCol, row: bounds.maxRow }
      this.fillDrag = { range: fillRange, origin, current: origin }
      const down: FillHandleDownEvent = { range: fillRange }
      for (const listener of this.fillHandleDownListeners) {
        listener(down)
      }
      return
    }
    if (event.x < this.rowHeaderWidth && event.y < this.headerHeight) {
      // 左上角：全选
      this.selection.selectAll(this.options.columns.length, this.pipeline.rowCount)
      return
    }
    if (event.y < this.headerHeight) {
      const col = findColAt(this.colOffsets, this.toContentX(event.x))
      if (col >= 0) {
        this.selection.selectCol(col, this.pipeline.rowCount)
      }
      return
    }
    if (event.x < this.rowHeaderWidth) {
      const row = findRowAt(this.rowOffsets, this.toContentY(event.y))
      if (row >= 0) {
        this.selection.selectRow(row, this.options.columns.length)
      }
      return
    }
    const cell = this.cellAt(event.x, event.y)
    if (cell) {
      // ctrlMultiSelect：Ctrl/Cmd 点选在既有选区上追加选区段（后续拖拽扩展该段）；缺省替换选区
      if (this.options.ctrlMultiSelect === true && (event.ctrlKey || event.metaKey)) {
        this.selection.addRange({
          start: { col: cell.col, row: cell.row },
          end: { col: cell.col, row: cell.row },
        })
      } else {
        this.selection.beginDrag(cell.col, cell.row)
      }
      this.selecting = true
    }
  }

  private onPointerMove(event: SceneEvent): void {
    if (this.resizeSession) {
      this.updateResizeLine(event)
      return
    }
    const cell = this.cellAt(event.x, event.y)
    if (this.fillDrag) {
      // 填充拖拽：只跟踪扫过的终点格（不更新选区，无写值）
      if (cell) {
        this.fillDrag.current = cell
      }
      return
    }
    if (this.selecting) {
      if (cell) {
        this.selection.updateDrag(cell.col, cell.row)
        this.ensureCellVisible(cell.col, cell.row)
      }
      return
    }
    if (cell) {
      this.hoverState.set(cell.col, cell.row)
    } else {
      this.hoverState.clear()
    }
  }

  private onPointerUp(event: SceneEvent): void {
    if (this.resizeSession) {
      const session = this.resizeSession
      this.resizeSession = null
      this.resizeLine = null
      const pointer = session.target.kind === 'col' ? event.x : event.y
      if (session.target.kind === 'col') {
        this.setColWidth(session.target.index, session.sizeAt(pointer))
      } else {
        this.setRowHeight(session.target.index, session.sizeAt(pointer))
      }
      // 拖拽会话成功结束：尺寸落地后按目标抛列/行结束事件（尺寸为夹取后的生效值）
      this.emitResizeEnd(session.target)
      return
    }
    if (this.fillDrag) {
      const drag = this.fillDrag
      this.fillDrag = null
      // 拖拽结束：抛锚定段范围 + 拖拽目标格范围（内核不产生任何写值行为）
      const event: FillDragEndEvent = {
        anchor: normalizeRange(drag.range),
        target: normalizeRange({ start: drag.origin, end: drag.current }),
      }
      for (const listener of this.fillDragEndListeners) {
        listener(event)
      }
      return
    }
    this.selecting = false
    this.selection.endDrag()
    this.detectDoubleTap(event)
  }

  /** 指针是否落在填充柄上：命中返回柄所在的焦点段；焦点段右下角格不可见即无柄 */
  private fillHandleHit(x: number, y: number): SelectionRange | null {
    const range = resolveFocusRange(this.selection.snapshot)
    if (!range) {
      return null
    }
    const bounds = normalizeRange(range)
    const cell = this.cellRectInViewport(bounds.maxCol, bounds.maxRow)
    if (!cell) {
      return null
    }
    return hitFillHandle(x, y, cell) ? range : null
  }

  /** 双击/双触进编辑：两次同格落点、时长与位移均在阈值内（拖拽/滚动滚出阈值不触发） */
  private detectDoubleTap(event: SceneEvent): void {
    const down = this.pointerDownAt
    const cell = this.cellAt(event.x, event.y)
    const time = Date.now()
    if (!down || !cell || Math.hypot(event.x - down.x, event.y - down.y) > DOUBLE_TAP_SLOP) {
      this.lastTap = null
      return
    }
    const prev = this.lastTap
    this.lastTap = { col: cell.col, row: cell.row, x: event.x, y: event.y, time }
    if (
      prev &&
      prev.col === cell.col &&
      prev.row === cell.row &&
      time - prev.time <= DOUBLE_TAP_MS
    ) {
      this.lastTap = null
      this.startEdit(cell.col, cell.row)
    }
  }

  /** resize 拖拽指示线跟手：目标边线随夹取后的尺寸位移，提交在 pointerup 一次生效 */
  private updateResizeLine(event: SceneEvent): void {
    const session = this.resizeSession
    if (!session) {
      return
    }
    const { left, top } = this.scroll.state
    if (session.target.kind === 'col') {
      const index = session.target.index
      const edge = resolveCellX(
        index + 1,
        left,
        this.colOffsets,
        this.frozenColCount,
        this.rowHeaderWidth,
      )
      const size = session.sizeAt(event.x)
      this.resizeLine = {
        orientation: 'vertical',
        position: edge + (size - this.getColWidth(index)),
      }
    } else {
      const index = session.target.index
      const edge = resolveCellYFromOffsets(
        index + 1,
        top,
        this.rowOffsets,
        this.frozenRowCount,
        this.headerHeight,
      )
      const size = session.sizeAt(event.y)
      this.resizeLine = {
        orientation: 'horizontal',
        position: edge + (size - this.rowHeightAt(index)),
      }
    }
    this.refreshOverlay()
  }

  /** 按拖拽目标抛列/行结束事件（订阅者集合为空时零开销） */
  private emitResizeEnd(target: ResizeTarget): void {
    if (target.kind === 'col') {
      const event: ColResizeEndEvent = { col: target.index, width: this.getColWidth(target.index) }
      for (const listener of this.colResizeEndListeners) {
        listener(event)
      }
      return
    }
    const event: RowResizeEndEvent = { row: target.index, height: this.rowHeightAt(target.index) }
    for (const listener of this.rowResizeEndListeners) {
      listener(event)
    }
  }

  private onKeyDown(event: SceneEvent): void {
    // 编辑中按键由编辑器处理（Esc/Enter/Tab 已在编辑器内拦截冒泡），场景导航让位
    if (this.editManager.isEditing()) {
      return
    }
    const focus = this.selection.snapshot.focus
    if (!focus || !event.key) {
      return
    }
    // editCellOnEnter 键位开关：开启后非编辑态按 Enter 进入焦点格编辑（编辑器内 Enter 提交
    // 并按 Enter 语义下移的既有行为不变）；关闭时非编辑态 Enter 保持现状（无操作）
    if (event.key === 'Enter' && this.options.editCellOnEnter) {
      this.startEdit(focus.col, focus.row)
      return
    }
    const next = nextActiveCell(
      event.key,
      focus,
      this.options.columns.length,
      this.pipeline.rowCount,
      event.shiftKey,
    )
    if (!next) {
      return
    }
    // shift+方向键扩展选区（焦点同步到扩展目标，sheet-core 选区修正补丁行为）；Tab 恒为单格移动
    const extend = event.shiftKey && event.key.startsWith('Arrow')
    this.selection.selectCell(next.col, next.row, extend)
    this.ensureCellVisible(next.col, next.row)
  }

  private onTouchStart(event: SceneEvent): void {
    this.inertia.stop()
    this.touchTracker.start(event.x, event.y, Date.now())
  }

  private onTouchMove(event: SceneEvent): void {
    const delta = this.touchTracker.move(event.x, event.y, Date.now())
    if (delta) {
      this.scroll.scrollBy(delta.dx, delta.dy)
    }
  }

  private onTouchEnd(event: SceneEvent): void {
    const velocity = this.touchTracker.end(event.x, event.y, Date.now())
    if (velocity) {
      this.inertia.start(velocity)
    }
  }

  private onTouchCancel(): void {
    this.touchTracker.cancel()
    this.inertia.stop()
  }

  private onContextMenuEvent(event: SceneEvent): void {
    if (this.contextMenuListeners.size === 0) {
      return
    }
    const emitted: TableContextMenuEvent = {
      cell: this.cellAt(event.x, event.y),
      x: event.x,
      y: event.y,
      originalEvent: event.originalEvent,
    }
    for (const listener of this.contextMenuListeners) {
      listener(emitted)
    }
  }

  /** 视口坐标 → 内容坐标：冻结区内不滚动，冻结区外叠加滚动位置 */
  private toContentX(x: number): number {
    const rel = x - this.rowHeaderWidth
    return rel < this.frozenColsWidth ? rel : rel + this.scroll.state.left
  }

  private toContentY(y: number): number {
    const rel = y - this.headerHeight
    return rel < this.frozenRowsHeight ? rel : rel + this.scroll.state.top
  }

  /** 视口坐标命中的数据格；行列头/空白处返回 null */
  private cellAt(x: number, y: number): CellRef | null {
    if (x < this.rowHeaderWidth || y < this.headerHeight) {
      return null
    }
    const col = findColAt(this.colOffsets, this.toContentX(x))
    const row = findRowAt(this.rowOffsets, this.toContentY(y))
    if (col < 0 || row < 0) {
      return null
    }
    return { col, row }
  }

  /** 数据格在视口中的矩形；冻结行列恒可见，其余须在可视窗口内，否则返回 null */
  private cellRectInViewport(col: number, row: number): Region | null {
    const rowVisible = row < this.frozenRowCount || (row >= this.rows.start && row < this.rows.end)
    const colVisible = col < this.frozenColCount || (col >= this.cols.start && col < this.cols.end)
    if (!rowVisible || !colVisible) {
      return null
    }
    const { left, top } = this.scroll.state
    return {
      x: resolveCellX(col, left, this.colOffsets, this.frozenColCount, this.rowHeaderWidth),
      y: resolveCellYFromOffsets(row, top, this.rowOffsets, this.frozenRowCount, this.headerHeight),
      width: this.getColWidth(col),
      height: this.rowHeightAt(row),
    }
  }

  /** 滚动跟随：非冻结轴上让目标格完整进入视口（冻结轴恒可见，跳过） */
  private ensureCellVisible(col: number, row: number): void {
    const { left, top } = this.scroll.state
    let nextLeft = left
    let nextTop = top
    if (col >= this.frozenColCount) {
      nextLeft = revealAxis(
        left,
        this.viewportWidth - this.frozenColsWidth,
        (this.colOffsets[col] ?? 0) - this.frozenColsWidth,
        this.getColWidth(col),
      )
    }
    if (row >= this.frozenRowCount) {
      nextTop = revealAxis(
        top,
        this.viewportHeight - this.frozenRowsHeight,
        (this.rowOffsets[row] ?? 0) - this.frozenRowsHeight,
        this.rowHeightAt(row),
      )
    }
    this.scroll.scrollTo(nextLeft, nextTop)
  }

  /** 该格回写目标判定：model 形态即有回写目标；records 形态需列有 field 且行对象存在 */
  private canWriteCell(col: number, row: number): boolean {
    if (this.binding) {
      return true
    }
    const field = this.options.columns[col]?.field
    return field !== undefined && this.options.records?.[row] != null
  }

  /** 写回数据源：model 形态经 ModelBinding（echo 防回环）；records 形态改行对象 field 字段 */
  private writeCell(col: number, row: number, value: unknown): void {
    if (this.binding) {
      this.binding.writeBack(col, row, value)
      return
    }
    const field = this.options.columns[col]?.field
    const record = this.options.records?.[row]
    if (field !== undefined && record) {
      record[field] = value
    }
  }

  /** 提交后选区移动：复用键盘导航求邻格（Enter 下移 / Tab 右移），越界夹取到表缘 */
  private moveSelectionAfterCommit(col: number, row: number, move: EditCommitMove): void {
    const next = nextActiveCell(
      move === 'down' ? 'ArrowDown' : 'Tab',
      { col, row },
      this.options.columns.length,
      this.pipeline.rowCount,
    )
    if (next) {
      this.selection.selectCell(next.col, next.row)
      this.ensureCellVisible(next.col, next.row)
    }
  }

  private resizeGeometry(): ResizeGeometry {
    return {
      colOffsets: this.colOffsets,
      rowOffsets: this.rowOffsets,
      rowHeaderWidth: this.rowHeaderWidth,
      headerHeight: this.headerHeight,
      toContentX: (x) => this.toContentX(x),
      toContentY: (y) => this.toContentY(y),
    }
  }

  /** 刷新 sky 浮层；仅在（或曾在）有内容时提交 sky 失效，避免空浮层空转整层重绘 */
  private refreshOverlay(): void {
    const has = this.overlay.update({
      selection: this.selection.snapshot,
      hover: this.hoverState.cell,
      resizeLine: this.resizeLine,
      // 填充柄挂在焦点段右下角（无选区为 null）
      fillHandleRange: resolveFocusRange(this.selection.snapshot),
      // 冻结行列恒可见，裁剪窗口从 0 起并到滚动窗口末
      window: {
        rows: { start: 0, end: Math.max(this.rows.end, this.frozenRowCount) },
        cols: { start: 0, end: Math.max(this.cols.end, this.frozenColCount) },
      },
    })
    if (has || this.overlayHadContent) {
      this.host.submitInvalidation('sky', { type: 'full' })
    }
    this.overlayHadContent = has
  }

  /** 几何变更（行列尺寸/冻结数/合并区运行时变更）后：冻结区尺寸/滚动边界重算，全量重建一次 */
  private applyGeometryChange(): void {
    this.frozenColsWidth = this.colOffsets[this.frozenColCount] ?? 0
    this.frozenRowsHeight = this.rowOffsets[this.frozenRowCount] ?? 0
    this.scroll.setViewportSize(
      this.viewportWidth - this.frozenColsWidth,
      this.viewportHeight - this.frozenRowsHeight,
    )
    this.scroll.setContentSize(
      this.contentWidth - this.frozenColsWidth,
      this.contentHeight - this.frozenRowsHeight,
    )
    this.rebuildScene()
    this.host.submitInvalidation('body', { type: 'full' })
    if (this.media) {
      this.host.submitInvalidation('media', { type: 'full' })
    }
    this.updateImageWindow()
    if (this.floatLayer && this.floatLayer.size > 0) {
      this.floatLayer.syncPositions()
    }
    this.refreshOverlay()
  }
}
