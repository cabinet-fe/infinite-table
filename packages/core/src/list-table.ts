// ListTable 主类：布局计算、虚拟滚动窗口、冻结区域划分、合并单元格、行列头渲染，
// 经 RenderHost 窄接口提交渲染。
// 场景内容只建在可视窗口内（窗口外行列不进入场景树，合并区主格按可见性补建）；
// 滚动由 ScrollManager 唯一状态源驱动，滚动 → 窗口增量更新 → 按滚动方向分层 band 失效
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
//
// 按职责拆分的协作模块（6.6，纯移动不改行为，均为包内实现细节、不进公共入口）：
// - list-table-scene.ts：场景全量重建与滚动帧增量窗口、分带建格、行列头装配、溢出右界支撑
// - list-table-media.ts：media 层与 ImageService 接线（图片格装配/局部刷新/窗口化调度）
// - list-table-interaction.ts：指针/触摸/键盘/contextmenu 事件接线与 sky 浮层刷新
// - list-table-internal.ts：共享常量与纯辅助（cellKey/HEADER_COORD/合并边界校验）
// 协作模块以 ListTable 实例为参数，只触碰标注 @internal 的内部成员；
// @internal 成员不构成公共 API（公共 API 以 src/index.ts 显式导出为准）。

import {
  createRenderHost,
  type LayerHandle,
  type Region,
  type RenderHost,
  type SceneNode,
} from '@infinite-table/render'

import type { CellNode } from './cell-node'
import { MergeCellMap, normalizeCellRange } from './cell-range'
import type { CellRange } from './cell-range'
import { cellStyleFont, projectCellStyle, type CellStyle } from './cell-style'
import { CellValuePipeline } from './cell-value'
import { EditManager, type EditCommitMove } from './editing/edit-manager'
import type { TextEditorHost } from './editing/text-editor'
import { EditorRegistry } from './editor-registry'
import {
  clampFrozenCount,
  computeColOffsets,
  computeRowOffsets,
  resolveCellX,
  resolveCellYFromOffsets,
  unionRegions,
  type WindowRange,
} from './grid-layout'
import { HoverState } from './hover-state'
import type { FillDragState } from './fill-handle'
import { FloatObjectLayer } from './float/float-object-layer'
import { InteractionOverlay, type HighlightRange, type ResizeLine } from './interaction-overlay'
import { nextActiveCell } from './keyboard-navigation'
import {
  bindInteractionEvents,
  cellAt,
  cellRectInViewport,
  ensureCellVisible,
  mergeAwareCellRect,
  refreshOverlay,
} from './list-table-interaction'
import { assertMergesWithinBoundary, cellKey, HEADER_COORD } from './list-table-internal'
import { onImageServiceLoad, refreshImageCell, updateImageWindow } from './list-table-media'
import {
  effectiveBorder,
  headerStyles,
  overflowSourceCol,
  rebuildScene,
  textOverflowLimitX,
  updateSceneWindow,
} from './list-table-scene'
import type { ImageCellNode } from './media/image-cell-node'
import { ImageService, type LoadedImage } from './media/image-service'
import { MediaCache } from './media/media-cache'
import { ModelBinding } from './model-binding'
import type { TablePlugin } from './plugin'
import {
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  type ColResizeEndEvent,
  type ResizeSession,
  type RowResizeEndEvent,
} from './resize'
import { ScrollManager, type ScrollDelta, type ScrollState } from './scroll-manager'
import {
  SelectionState,
  type SelectionListener,
  type SelectionRange,
  type SelectionSnapshot,
} from './selection'
import { extendsTheme, themeCellBase, type TableTheme } from './theme'
import { InertiaScroller, TouchScrollTracker } from './touch-scroll'
import type {
  CellChangeEvent,
  CellRef,
  ContextMenuListener,
  EditEndEvent,
  EditStartEvent,
  ListTableOptions,
} from './types'
import type {
  FillDragEndListener,
  FillHandleDoubleClickListener,
  FillHandleDownListener,
} from './fill-handle'

/** onScrollFrame 帧级同步回调：滚动帧上带最新滚动位置触发（同帧多次滚动只触发一次） */
export type ScrollFrameListener = (state: ScrollState) => void

export class ListTable {
  /** @internal 渲染宿主（注入或缺省创建） */
  readonly host: RenderHost
  private readonly ownHost: boolean
  /** @internal body 层句柄（数据格场景树） */
  readonly body: LayerHandle
  /** @internal sky 层句柄（交互浮层与浮动对象） */
  readonly sky: LayerHandle
  /** @internal 取值管线 */
  readonly pipeline: CellValuePipeline
  /** @internal 唯一滚动状态源 */
  readonly scroll = new ScrollManager()
  private readonly binding: ModelBinding | null = null
  /** @internal 列宽前缀和 */
  colOffsets: number[]
  colWidths: number[]
  readonly width: number
  readonly height: number
  /** @internal 生效主题 */
  readonly theme: TableTheme
  readonly rowHeight: number
  /** @internal 列头带高 */
  readonly headerHeight: number
  /** @internal 行号列宽 */
  readonly rowHeaderWidth: number
  /** @internal 冻结列数/行数与冻结区尺寸（运行时可变） */
  frozenColCount: number
  frozenRowCount: number
  frozenColsWidth: number
  frozenRowsHeight: number
  /** @internal 合并区集合 */
  mergeCells: MergeCellMap
  /** 图片资源服务：窗口化加载 + 位图 LRU + 无闪协议状态源（public 供宿主配置/订阅事件） */
  readonly imageService: ImageService
  /** @internal cell 级位图 LRU：按格缓存已就绪位图引用，滚动重建时命中即首帧无闪 */
  readonly mediaCache = new MediaCache<LoadedImage>()
  /** @internal L2 media 层：首个图片格出现时惰性创建 */
  media: LayerHandle | null = null
  /** @internal 当前窗口内的图片格节点，key 见 cellKey（随窗口重建） */
  readonly imageCellNodes = new Map<number, ImageCellNode>()
  /** 浮动对象层（首次访问 floatObjects 时惰性建承载容器，挂在已用的 sky 层最顶） */
  private floatLayer: FloatObjectLayer | null = null
  /** 已注册插件（销毁时逆序卸载） */
  private readonly plugins: TablePlugin[] = []
  /** @internal 当前窗口内的数据格节点，key 见 cellKey（合并区只登记主格，随窗口重建） */
  readonly cellNodes = new Map<number, CellNode>()
  /** @internal 当前窗口内的列头节点，key 为列号（滚动帧增量维护） */
  readonly colHeaderNodes = new Map<number, CellNode>()
  /** @internal 当前窗口内的行号列节点，key 为行号（滚动帧增量维护） */
  readonly rowHeaderNodes = new Map<number, CellNode>()
  /** @internal 左上角占位节点（几何固定，首次建后复用） */
  cornerNode: CellNode | null = null
  /** @internal 表格外框节点（body root 末子节点；滚动帧增量补建后重挂保持最上） */
  frameNode: SceneNode | null = null
  /**
   * @internal body 表头容器（R2-5）：恒为 body root 末子节点，表头整体在全部数据格之上；
   * 滚动帧有新建数据格时仅重挂此单节点，替代原先逐表头 removeChild+appendChild
   */
  headerGroup: SceneNode | null = null
  /** @internal 当前滚动窗口（[start, end) 行列区间，不含冻结区） */
  rows: WindowRange = { start: 0, end: 0 }
  cols: WindowRange = { start: 0, end: 0 }
  private destroyed = false
  /** 逐行高度覆盖（行 resize 产物）；缺省用 rowHeight */
  private readonly rowHeights = new Map<number, number>()
  /** @internal 行高前缀和 */
  rowOffsets: number[]
  /** @internal 选区状态机 */
  readonly selection = new SelectionState()
  /** @internal 悬停格跟踪 */
  readonly hoverState = new HoverState()
  /** @internal sky 交互浮层 */
  readonly overlay: InteractionOverlay
  /** @internal 触控滚动采样 */
  readonly touchTracker = new TouchScrollTracker()
  /** @internal 惯性滚动 */
  readonly inertia: InertiaScroller
  /** @internal resize 拖拽会话与指示线 */
  resizeSession: ResizeSession | null = null
  resizeLine: ResizeLine | null = null
  /** @internal 拖选进行中 */
  selecting = false
  /** @internal 表头高亮选区签名（refreshHeaderHighlight 的变化守卫） */
  headerHighlightSignature = ''
  /** @internal 浮层曾有内容（清空补一次 full 防残影） */
  overlayHadContent = false
  /** @internal 宿主高亮区域（公式引用染色框等）：sky 浮层内容源之一，setHighlightRanges 写入 */
  highlightRanges: readonly HighlightRange[] = []
  private batchDepth = 0
  private readonly batchRegions: Region[] = []
  /** @internal contextmenu 事件订阅 */
  readonly contextMenuListeners = new Set<ContextMenuListener>()
  private readonly scrollFrameListeners = new Set<ScrollFrameListener>()
  /** 编辑提交事件订阅（col/row/oldValue/newValue） */
  private readonly cellChangeListeners = new Set<(change: CellChangeEvent) => void>()
  /** 编辑会话开始/结束事件订阅（编辑生命周期通知） */
  private readonly editStartListeners = new Set<(event: EditStartEvent) => void>()
  private readonly editEndListeners = new Set<(event: EditEndEvent) => void>()
  /** @internal 列宽拖拽会话结束事件订阅（col/width） */
  readonly colResizeEndListeners = new Set<(event: ColResizeEndEvent) => void>()
  /** @internal 行高拖拽会话结束事件订阅（row/height） */
  readonly rowResizeEndListeners = new Set<(event: RowResizeEndEvent) => void>()
  /** @internal 填充柄按下事件订阅（携带柄所在选区段） */
  readonly fillHandleDownListeners = new Set<FillHandleDownListener>()
  /** @internal 填充柄拖拽结束事件订阅（锚定段范围 + 拖拽目标格范围） */
  readonly fillDragEndListeners = new Set<FillDragEndListener>()
  /** @internal 填充柄双击事件订阅（柄所在选区段；与拖拽结束互斥） */
  readonly fillHandleDoubleClickListeners = new Set<FillHandleDoubleClickListener>()
  /** @internal 填充柄拖拽会话：柄所在选区段 + 起点终点格（轴锁定）+ 边缘自动滚动状态（填充生成不在内核） */
  fillDrag: FillDragState | null = null
  /** @internal 上一次「点按柄」（无拖拽扩展的按下-抬起）的锚定段签名与时间（双击窗口判定用；拖拽扩展/双击成交即清零） */
  lastFillHandleTap: { key: string; time: number } | null = null
  /** @internal 本次按柄是否命中双击窗口（按下时判定，抬起时消费） */
  fillHandleDoubleTap = false
  /** 编辑状态唯一源：进入/提交/取消生命周期 */
  readonly editManager: EditManager
  /** 编辑器注册表（可编第一级判定与格级路由），可注入或事后注册 */
  readonly editorRegistry: EditorRegistry
  /** 编辑器浮层挂载容器（hostOptions.container）；缺省离屏不落 DOM */
  private readonly container: HTMLElement | undefined
  /** @internal 双击/双触检测：上一次落点（同格、时长与位移阈值内判定连击进编辑） */
  lastTap: { col: number; row: number; x: number; y: number; time: number } | null = null
  /** @internal pointerdown 落点（连击位移阈值判定用） */
  pointerDownAt: { x: number; y: number } | null = null
  /** @internal 挂在场景根上的事件退订（注入 host 共享场景树时销毁必须解绑） */
  readonly eventUnsubscribers: Array<() => void> = []
  /** 稳定引用：同帧内多次滚动只收敛出一次 onScrollFrame 广播 */
  private readonly scrollFrameTask = () => {
    const state = this.scroll.state
    for (const listener of this.scrollFrameListeners) {
      listener(state)
    }
  }
  /** 列级样式投影缓存：主题 token + 列级样式的合成按列缓存 */
  private readonly columnStyles = new Map<number, CellStyle>()

  constructor(public readonly options: ListTableOptions) {
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
    this.imageService.onImageLoad((e) => onImageServiceLoad(this, e))
    this.inertia = new InertiaScroller(
      (dx, dy) => this.scroll.scrollBy(dx, dy),
      (task) => this.host.requestFrame(task),
    )
    this.overlay = new InteractionOverlay(
      this.sky.root,
      {
        cellRect: (col, row) => cellRectInViewport(this, col, row),
        bodyViewport: this.bodyViewport,
      },
      this.theme.interaction,
    )
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
    updateImageWindow(this)
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
      cellFont: (col, row) => cellStyleFont(this.resolveStyle(col, row)),
      // 合并感知锚定：编辑合并区（主格）时浮层跨满整块包围盒
      cellRect: (col, row) => mergeAwareCellRect(this, col, row),
      refreshCell: (col, row) => this.refreshCell(col, row),
      emitChange: (change) => {
        for (const listener of this.cellChangeListeners) {
          listener(change)
        }
      },
      emitStart: (event) => {
        for (const listener of this.editStartListeners) {
          listener(event)
        }
      },
      emitEnd: (event) => {
        for (const listener of this.editEndListeners) {
          listener(event)
        }
      },
      moveSelection: (col, row, move) => this.moveSelectionAfterCommit(col, row, move),
      restoreFocus: () => this.container?.focus(),
      // 真实容器运行时满足最小宿主结构（编辑器元素本就是真 Node）
      host: this.container as TextEditorHost | undefined,
      // 滚动帧驱动编辑跟随：浮层逐帧对齐锚定格，滚出视口自动提交
      subscribeScrollFrame: (listener) => this.onScrollFrame(listener),
    })
    bindInteractionEvents(this)
    rebuildScene(this)
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
   * 滚动时 syncPositions 帧级跟随；行高/列宽 resize 提交后 recalcGeometry 随新行列尺寸重算。
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
    const prevBorder = this.cellNodes.get(cellKey(masterCol, masterRow))?.style.border
    this.refreshCellNode(col, row)
    // 共享边联动（shared-edges.ts）：本格 left/top 边改变左/上邻居（共享边所有者）的生效边。
    // 样式按不可变约定使用，边框引用未变则邻居生效边不变、跳过联动；
    // 联动刷新自身不再级联（各邻居生效边只依赖其自身样式与本格对侧边），无循环。
    const node = this.cellNodes.get(cellKey(masterCol, masterRow))
    if (!node || node.style.border === prevBorder) {
      return
    }
    const range = this.mergeCells.rangeAt(masterCol, masterRow)
    const startCol = range?.startCol ?? masterCol
    const startRow = range?.startRow ?? masterRow
    if (startCol > 0) {
      this.refreshCellNode(startCol - 1, startRow)
    }
    if (startRow > 0) {
      this.refreshCellNode(masterCol, startRow - 1)
    }
  }

  /** refreshCell 的单格实现（不级联邻居；共享边联动的邻居刷新也走这里） */
  private refreshCellNode(col: number, row: number): void {
    const master = this.mergeCells.masterOf(col, row)
    const masterCol = master?.col ?? col
    const masterRow = master?.row ?? row
    refreshImageCell(this, masterCol, masterRow)
    const node = this.cellNodes.get(cellKey(masterCol, masterRow))
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
    // 生效边框随样式重算（共享边裁决：本格 right/bottom 与右/下邻居对侧边取强）
    node.border = effectiveBorder(this, masterCol, masterRow, node.style)
    node.renderer = this.options.resolveCellRenderer?.(masterCol, masterRow) ?? null
    const limitX = textOverflowLimitX(
      this,
      masterCol,
      masterRow,
      node.style,
      this.scroll.state.left,
    )
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
      const sourceCol = overflowSourceCol(this, masterCol, masterRow)
      const sourceNode =
        sourceCol !== null ? this.cellNodes.get(cellKey(sourceCol, masterRow)) : undefined
      if (sourceCol !== null && sourceNode) {
        const oldExtent = sourceNode.textMaxX
        const sourceLimit = textOverflowLimitX(
          this,
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
    ensureCellVisible(this, col, row)
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
    refreshOverlay(this)
  }

  /**
   * 设置宿主高亮区域（公式引用染色框等）：sky 浮层四边细条边框，随滚动/选区同内容源重绘，
   * 只绘制不拦截事件、与选区语义无关；传空数组清除。
   */
  setHighlightRanges(ranges: readonly HighlightRange[]): void {
    this.highlightRanges = ranges
    refreshOverlay(this)
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
    return cellRectInViewport(this, col, row)
  }

  /** 视口坐标命中的数据格；点在行列头/空白处返回 null */
  getCellAtRelativePosition(x: number, y: number): CellRef | null {
    return cellAt(this, x, y)
  }

  /** 滚动到目标格完整可见（复用键盘导航 revealAxis 语义；冻结轴恒可见，跳过） */
  scrollToCell(cell: CellRef): void {
    ensureCellVisible(this, cell.col, cell.row)
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

  /** 订阅填充柄双击事件（range 为柄所在选区段；宿主据此做相邻数据区自动填充）；返回退订函数 */
  onFillHandleDoubleClick(listener: FillHandleDoubleClickListener): () => void {
    this.fillHandleDoubleClickListeners.add(listener)
    return () => this.fillHandleDoubleClickListeners.delete(listener)
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
    ensureCellVisible(this, col, row)
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

  /** 订阅编辑会话开始事件（col/row/初值为基础值口径；可编判定失败不抛）；返回退订函数 */
  onEditStart(listener: (event: EditStartEvent) => void): () => void {
    this.editStartListeners.add(listener)
    return () => this.editStartListeners.delete(listener)
  }

  /** 订阅编辑会话结束事件（提交在 onCellChange 后抛且带终值；取消 committed=false）；返回退订函数 */
  onEditEnd(listener: (event: EditEndEvent) => void): () => void {
    this.editEndListeners.add(listener)
    return () => this.editEndListeners.delete(listener)
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

  /** @internal 视口宽（扣除行号列） */
  get viewportWidth(): number {
    return Math.max(0, this.width - this.rowHeaderWidth)
  }

  /** @internal 视口高（扣除列头） */
  get viewportHeight(): number {
    return Math.max(0, this.height - this.headerHeight)
  }

  /** @internal 数据区在层坐标中的可绘制矩形（扣除行号列与列头，CSS 像素） */
  get bodyViewport(): Region {
    return {
      x: this.rowHeaderWidth,
      y: this.headerHeight,
      width: this.viewportWidth,
      height: this.viewportHeight,
    }
  }

  get contentWidth(): number {
    return this.colOffsets[this.colOffsets.length - 1] ?? 0
  }

  get contentHeight(): number {
    return this.rowOffsets[this.pipeline.rowCount] ?? 0
  }

  /** @internal 行 r 的高度（含逐行覆盖） */
  rowHeightAt(row: number): number {
    return (this.rowOffsets[row + 1] ?? 0) - (this.rowOffsets[row] ?? 0)
  }

  /**
   * @internal 数据格样式投影：覆盖链「主题分区 token → 列级样式 → 按格 hook」逐字段覆盖——
   * 上层给了的字段被下层覆盖、未给的沿用上层，边框逐边独立合并。
   * 列级 textWrap 旗标并入主题层（先于列级样式片段）。
   * 性能：token+列级的合成结果按列缓存（主题构造期固定、列定义为构造期快照，
   * 缓存与表实例同生命周期；CellStyle 全仓按不可变约定使用，无就地写入点），
   * 仅按格 hook 返回非空时才做第二级投影。
   */
  resolveStyle(col: number, row: number): CellStyle {
    let colStyle = this.columnStyles.get(col)
    if (!colStyle) {
      const column = this.options.columns[col]
      const base = themeCellBase(this.theme.body)
      colStyle = projectCellStyle(
        column?.textWrap ? { ...base, textWrap: true } : base,
        column?.style,
      )
      this.columnStyles.set(col, colStyle)
    }
    const cellStyle = this.options.resolveCellStyle?.(col, row)
    return cellStyle ? projectCellStyle(colStyle, cellStyle) : colStyle
  }

  /**
   * @internal 统一样式取数（共享边裁决 facing 溯源用，见 shared-edges.ts）：
   * 数据坐标走 resolveStyle；HEADER_COORD(-1) 路由到表头分区样式
   * （(-1,-1) 角格 / (col,-1) 列头 / (-1,row) 行号格）。
   */
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

  /**
   * 滚动主循环：状态源广播 → 窗口增量更新 → 按滚动方向分层 band 失效。
   * 纵向滚动只重绘冻结行以下的横带（含行号列/冻结列/滚动区），
   * 横向滚动只重绘冻结列以右的纵带（含列头/冻结行/滚动区），冻结角与对侧冻结区不重绘。
   */
  private onScroll(delta: ScrollDelta): void {
    updateSceneWindow(this)
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
    updateImageWindow(this)
    if (this.floatLayer && this.floatLayer.size > 0) {
      this.floatLayer.syncPositions()
    }
    refreshOverlay(this)
    if (this.scrollFrameListeners.size > 0) {
      this.host.requestFrame(this.scrollFrameTask)
    }
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
      ensureCellVisible(this, next.col, next.row)
    }
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
    rebuildScene(this)
    this.host.submitInvalidation('body', { type: 'full' })
    if (this.media) {
      this.host.submitInvalidation('media', { type: 'full' })
    }
    updateImageWindow(this)
    if (this.floatLayer && this.floatLayer.size > 0) {
      // 行高/列宽 resize 提交路径（setColWidth/setRowHeight/拖拽会话）都收敛到本方法：
      // 锚定浮动对象随新行列尺寸重算几何（无显式像素尺寸的对象伸缩）
      this.floatLayer.recalcGeometry()
    }
    refreshOverlay(this)
  }
}
