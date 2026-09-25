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
// 容器 resize 原地自适应：构造后经 resize() 调整视口尺寸，滚动位置与选区保留、不重建实例。
// 运行时可变（P8）：冻结列数/行数与合并区开放运行时修改（合并区模型越界构造期
// 校验延伸到运行时；跨冻结边界合并区合法，主格按冻结带钉固绘制），resize 拖拽
// 会话补结束事件，editCellOnEnter 键位开关。
//
// 按职责拆分的协作模块（6.6，纯移动不改行为，均为包内实现细节、不进公共入口）：
// - list-table-scene.ts：场景全量重建与滚动帧增量窗口、分带建格、行列头装配、溢出右界支撑
// - list-table-media.ts：media 层与 ImageService 接线（图片格装配/局部刷新/窗口化调度、
//   图表格出图路由：插件离屏出图位图经 cell 级缓存 blit，无闪协议同图片）
// - list-table-interaction.ts：指针/触摸/键盘/contextmenu 事件接线与 sky 浮层刷新
// - list-table-internal.ts：共享常量与纯辅助（cellKey/HEADER_COORD/合并区越界校验）
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
import { ChartCellNode } from './media/chart-cell-node'
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
  type HeaderDragState,
  ensureCellVisible,
  mergeAwareCellRect,
  refreshOverlay,
} from './list-table-interaction'
import { assertMergesWithinTable, cellKey, HEADER_COORD } from './list-table-internal'
import {
  onImageServiceLoad,
  refreshChartCell,
  refreshImageCell,
  updateImageWindow,
} from './list-table-media'
import {
  dataColBands,
  effectiveBorder,
  headerStyles,
  markRowCorridorInterior,
  overflowSourceCol,
  overflowSourceColRight,
  rebuildScene,
  textOverflowLimits,
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
  type RangeBounds,
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
  ResolveCellChart,
} from './types'
import type {
  FillDragEndListener,
  FillHandleDoubleClickListener,
  FillHandleDownListener,
} from './fill-handle'

/** onScrollFrame 帧级同步回调：滚动帧上带最新滚动位置触发（同帧多次滚动只触发一次） */
export type ScrollFrameListener = (state: ScrollState) => void

/** 宿主环境 dpr：存在全局 window 时取运行环境值，无 window 环境（headless/离屏测试）回落 1 */
function resolveHostDpr(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

/**
 * 溢出源节点的全局失效矩形：覆盖本格与双向溢出走廊（minX ≤ 0 为左溢伸出的负向段）。
 * 场景树节点 x/y 即层坐标（body root 在层原点），与 getGlobalBounds 一致。
 */
function overflowExtentRegion(node: CellNode, minX: number, maxX: number): Region {
  const left = Math.min(0, minX)
  return {
    x: node.x + left,
    y: node.y,
    width: Math.max(node.width, maxX) - left,
    height: node.height,
  }
}

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
  /** 视口尺寸（构造后经 resize 原地调整；width/height 只读透出） */
  private tableWidth: number
  private tableHeight: number
  /** 表视口宽（CSS 像素） */
  get width(): number {
    return this.tableWidth
  }
  /** 表视口高（CSS 像素） */
  get height(): number {
    return this.tableHeight
  }
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
  /** @internal L2 media 层：首个图片/图表格出现时惰性创建 */
  media: LayerHandle | null = null
  /** @internal 当前窗口内的图片格节点，key 见 cellKey（随窗口重建） */
  readonly imageCellNodes = new Map<number, ImageCellNode>()
  /** @internal 当前窗口内的图表格节点，key 见 cellKey（随窗口重建；位图经 cell 级缓存直贴） */
  readonly chartCellNodes = new Map<number, ChartCellNode>()
  /** @internal 图表媒体解析器（chart 插件 mount 注入；null=无图表格能力，core 不含图表语义） */
  chartMediaResolver: ResolveCellChart | null = null
  /** @internal 出图单飞：同缓存 key 的并发出图收敛为一次 produce */
  readonly chartRenderTasks = new Map<string, Promise<LoadedImage | null>>()
  /** @internal 出图设备像素比（构造/resize 随宿主刷新；出图物理分辨率与显示层一致） */
  hostDpr: number
  /**
   * @internal 浮动对象层（首次访问 floatObjects 时惰性建承载容器，挂在已用的 sky 层最顶）。
   * 原始字段供交互路由读写（未挂载为 null 时不强建层）；宿主面走 floatObjects getter。
   */
  floatLayer: FloatObjectLayer | null = null
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
  /** 逐行高度覆盖（行 resize 产物）；缺省用 rowHeight */
  private readonly rowHeights = new Map<number, number>()
  /** @internal 行高前缀和 */
  rowOffsets: number[]
  /** @internal 选区状态机 */
  readonly selection = new SelectionState()
  /** @internal 悬停格跟踪（主题 hover 开关关闭时整体短路） */
  readonly hoverState: HoverState
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
  /** @internal 表头拖选会话：pointerdown 命中列头/行头后开启（锚定列/行），抬起重算后结束 */
  headerDrag: HeaderDragState | null = null
  /** @internal 表头高亮选区签名（refreshHeaderHighlight 的变化守卫） */
  headerHighlightSignature = ''
  /** @internal 浮层曾有内容（清空补一次 full 防残影） */
  overlayHadContent = false
  /** @internal 宿主高亮区域（公式引用染色框等）：sky 浮层内容源之一，setHighlightRanges 写入 */
  highlightRanges: readonly HighlightRange[] = []
  /** @internal 选区锚点（编辑拾取会话中被编辑格保持的选区绘制）：sky 浮层内容源之一，setSelectionAnchor 写入 */
  selectionAnchor: RangeBounds | null = null
  private batchDepth = 0
  private readonly batchRegions: Region[] = []
  /** @internal 首次场景重建已完成；此后挂载的插件（table.use）由 mount 自行触发全量重建 */
  sceneInitialized = false
  /** @internal 已销毁（迟到结算的异步回写守卫；出图完成回写等） */
  destroyed = false
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
  /**
   * 编辑拾取模式（宿主驱动，公式引用拾取用）：编辑中指针点选/拖选其它格不提交当前会话，
   * 选区照常流动（宿主经 onSelectionChange 消费拾取段）；双击进编辑与填充柄在此模式下让位。
   * 点在行列头带/空白仍遵循既有选区行为；置回 false 恢复「点别处即提交」的缺省语义。
   */
  editPickMode = false
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
    this.tableWidth = options.width
    this.tableHeight = options.height
    // 主题接入样式管线：几何与格样式默认取自主题，显式 options 优先
    this.theme = extendsTheme(options.theme)
    this.rowHeight = options.rowHeight ?? this.theme.rowHeight
    // 行列头开关（showRowHeader/showColHeader）构造期归一化为零宽/零高：
    // 几何（视口/内容原点/冻结偏移/命中/编辑浮层定位）全部经既有 headerHeight/
    // rowHeaderWidth 路径取值，归一化后关闭侧自动退化为表体原点，无需分支扩散
    this.headerHeight =
      options.showColHeader === false ? 0 : (options.headerHeight ?? this.theme.headerHeight)
    this.rowHeaderWidth =
      options.showRowHeader === false ? 0 : (options.rowHeaderWidth ?? this.theme.rowHeaderWidth)
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
    assertMergesWithinTable(
      this.mergeCells.ranges,
      this.options.columns.length,
      this.pipeline.rowCount,
    )
    this.host =
      options.host ??
      createRenderHost({
        width: this.width,
        height: this.height,
        // 缺省透传宿主环境 dpr（hostOptions.dpr 显式注入优先）：Retina 下不再 1× 被放大上屏
        dpr: resolveHostDpr(),
        ...options.hostOptions,
      })
    // 出图 DPR 与显示层一致：显式 hostOptions.dpr 优先，缺省取宿主环境值（resize 随宿主刷新）
    this.hostDpr = options.hostOptions?.dpr ?? resolveHostDpr()
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
    // 悬停跟踪受主题 hover 开关控制：disableHover 时 set/clear 全程无操作
    this.hoverState = new HoverState(this.theme.hover.disableHover)
    this.overlay = new InteractionOverlay(
      this.sky.root,
      {
        cellRect: (col, row) => cellRectInViewport(this, col, row),
        bodyViewport: () => this.bodyViewport,
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
      editorMaxLength: options.editorMaxLength,
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
        // 编辑中锚定格内容隐藏（DOM 浮层取代内容渲染，溢出部分一并隐去）
        this.setCellContentHidden(event.col, event.row, true)
        for (const listener of this.editStartListeners) {
          listener(event)
        }
      },
      emitEnd: (event) => {
        // 会话结束恢复内容渲染（提交路径的 refreshCell 与本次失效同帧收敛）
        this.setCellContentHidden(event.col, event.row, false)
        for (const listener of this.editEndListeners) {
          listener(event)
        }
      },
      moveSelection: (col, row, move) => this.moveSelectionAfterCommit(col, row, move),
      restoreFocus: () => this.container?.focus(),
      // 失焦终止策略按当前拾取模式动态判定：公式引用拾取会话失焦不终止（宿主互锁），
      // 其余情况焦点移出画布即按提交语义结束会话（emitEnd 接线恢复 contentHidden）
      resolveEditorBlur: () => (this.editPickMode ? 'ignore' : 'commit'),
      // 真实容器运行时满足最小宿主结构（编辑器元素本就是真 Node）
      host: this.container as TextEditorHost | undefined,
      // 滚动帧驱动编辑跟随：浮层逐帧对齐锚定格，滚出视口自动提交
      subscribeScrollFrame: (listener) => this.onScrollFrame(listener),
    })
    bindInteractionEvents(this)
    // 插件先于首次场景重建挂载：图表格路由等渲染接线参与首帧（构造期注册经此路径生效）
    for (const plugin of options.plugins ?? []) {
      this.use(plugin)
    }
    rebuildScene(this)
    this.host.submitInvalidation('body', { type: 'full' })
    this.sceneInitialized = true
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
   * 绘制裁剪在 body 视口内（视口随容器 resize 经 setBodyViewport 更新）：滚动跟随平移进
   * 表头带的部分不画，行列头保持在浮动对象之上不被盖住。
   * 交互：命中由指针路由优先接管（list-table-interaction），点选选中、拖拽结束经
   * onDragEnd 抛落点换算的新锚点，宿主写回模型；只读（isReadonly）不启用拖拽。
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
          // 拖拽落点换算：视口点 → 数据格（行列头带/空白 null → 回弹），与选区命中同一口径
          cellAtPoint: (x, y) => cellAt(this, x, y),
        },
        imageService: this.imageService,
        bodyViewport: this.bodyViewport,
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

  /**
   * 表格回驱模型：回环窗口内模型同步 echo 的变更格（含同步重算的派生格）
   * 收集去重后统一逐格局部刷新；被编辑格的显式刷新与收集结果合并去重，每格恰好刷一次。
   */
  updateCell(col: number, row: number, value: unknown): void {
    if (!this.binding) {
      return
    }
    const echoed = this.binding.writeBack(col, row, value)
    // 先刷收集的派生格，再显式刷被编辑格：走廊计算读到的是已更新的邻居节点
    this.refreshEchoedCells(echoed, col, row)
    this.refreshCell(col, row)
  }

  /**
   * 局部刷新单格：被合并覆盖的坐标路由到主格节点；窗口内则更新节点内容、
   * 重投影样式并登记 cell 失效（合并区失效为主格包围盒），窗口外忽略；
   * 失效区并入溢出走廊：旧走廊防文字变短残影、新走廊补画；本格变空时向两侧扩到
   * 最近溢出来源格（左邻右溢/居中源、右邻左溢/居中源），让它们的走廊收敛或延伸；
   * 节点获得溢出能力时重挂树尾（z 序不变量：溢出源后画于同条带走廊节点）；
   * 批量更新（batchUpdate）期间失效区域改为收集，批末合并为一次 band 提交
   */
  refreshCell(col: number, row: number): void {
    const master = this.mergeCells.masterOf(col, row)
    const masterCol = master?.col ?? col
    const masterRow = master?.row ?? row
    const node = this.cellNodes.get(cellKey(masterCol, masterRow))
    if (!node) {
      // 快速退出：主格不在可视窗口（无场景节点可刷；图片节点只随数据格建，同样不存在）。
      // 批量写的绝大多数落在窗口外，模型事件→局部刷新的热路径就此一次查找收束。
      return
    }
    const prevBorder = node.style.border
    this.refreshCellNodeContents(node, masterCol, masterRow)
    // 共享边联动（shared-edges.ts）：本格 left/top 边改变左/上邻居（共享边所有者）的生效边。
    // 样式按不可变约定使用，边框引用未变则邻居生效边不变、跳过联动；
    // 联动刷新自身不再级联（各邻居生效边只依赖其自身样式与本格对侧边），无循环。
    if (node.style.border === prevBorder) {
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
    const node = this.cellNodes.get(cellKey(masterCol, masterRow))
    if (!node) {
      return
    }
    this.refreshCellNodeContents(node, masterCol, masterRow)
  }

  /**
   * 节点内容刷新主体（节点已解析出）：图片格联动、内容/样式/生效边框重投影、
   * 溢出走廊重算与两侧来源联动、失效区提交（批量更新期间改为收集）。
   */
  private refreshCellNodeContents(node: CellNode, masterCol: number, masterRow: number): void {
    refreshImageCell(this, masterCol, masterRow)
    refreshChartCell(this, masterCol, masterRow)
    const prevMaxX = node.textMaxX
    const prevMinX = node.textMinX
    const prevHasText = node.text !== ''
    node.setContent(
      this.pipeline.resolveText(masterCol, masterRow),
      this.pipeline.resolveValue(masterCol, masterRow),
    )
    node.style = this.resolveStyle(masterCol, masterRow)
    // 生效边框随样式重算（共享边裁决：本格 right/bottom 与右/下邻居对侧边取强）
    node.border = effectiveBorder(this, masterCol, masterRow, node.style)
    node.renderer = this.options.resolveCellRenderer?.(masterCol, masterRow) ?? null
    const limits = textOverflowLimits(
      this,
      masterCol,
      masterRow,
      node.style,
      this.scroll.state.left,
    )
    node.textMaxX = limits === null ? node.width : limits.maxX - node.x
    node.textMinX = limits === null ? 0 : limits.minX - node.x
    // 走廊伸缩即竖线跳画范围变化（P3）：本格走廊变化或两侧来源走廊联动变化时，
    // 整行重标走廊内部标记（先清后标，与全量重建同口径）；标记不随 contentHidden
    // 变化（走廊扫描只看取值与样式，隐藏/恢复前后标记与全量重建一致）
    let corridorChanged = node.textMaxX !== prevMaxX || node.textMinX !== prevMinX
    const regions: Region[] = [node.getGlobalBounds()]
    if (prevMaxX > node.width || prevMinX < 0) {
      regions.push(overflowExtentRegion(node, prevMinX, prevMaxX))
    }
    if (node.textMaxX > node.width || node.textMinX < 0) {
      regions.push(overflowExtentRegion(node, node.textMinX, node.textMaxX))
      // z 序不变量：源格后画于同条带全部走廊节点（左溢走廊在源格左侧，降序建格
      // 的行内次序会让走廊格画在源文本之上）
      this.remountOverflowSourceNode(node)
    }
    // 两侧溢出来源联动：本格变空（左邻右溢/居中源穿过本格、右邻左溢/居中源伸回本格）、
    // 变非空（来源格走廊收回）、保持为空（本格重绘会擦掉来源格经过本格的文本）时，
    // 重算来源格走廊并并入其新旧溢出区
    if (!node.text || prevHasText !== (node.text !== '')) {
      for (const sourceCol of [
        overflowSourceCol(this, masterCol, masterRow),
        overflowSourceColRight(this, masterCol, masterRow),
      ]) {
        if (sourceCol === null) {
          continue
        }
        const sourceNode = this.cellNodes.get(cellKey(sourceCol, masterRow))
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
        )
        sourceNode.textMaxX =
          sourceLimits === null ? sourceNode.width : sourceLimits.maxX - sourceNode.x
        sourceNode.textMinX = sourceLimits === null ? 0 : sourceLimits.minX - sourceNode.x
        if (sourceNode.textMaxX !== sourceOldMaxX || sourceNode.textMinX !== sourceOldMinX) {
          corridorChanged = true
          regions.push(overflowExtentRegion(sourceNode, sourceOldMinX, sourceOldMaxX))
          regions.push(overflowExtentRegion(sourceNode, sourceNode.textMinX, sourceNode.textMaxX))
        }
        if (sourceNode.textMaxX > sourceNode.width || sourceNode.textMinX < 0) {
          // 来源格获得/保持溢出：重挂树尾保证其走廊文本画在走廊格之上
          this.remountOverflowSourceNode(sourceNode)
        }
      }
    }
    if (corridorChanged) {
      markRowCorridorInterior(this, masterRow, dataColBands(this))
    }
    const region = unionRegions(regions) ?? regions[0]!
    if (this.batchDepth > 0) {
      this.batchRegions.push(region)
      return
    }
    this.host.submitInvalidation('body', { type: 'cell', region })
  }

  /** 溢出源节点重挂树尾（z 序不变量：源格后画于同条带全部走廊节点）；表头容器与外框随后重挂保持最上 */
  private remountOverflowSourceNode(node: CellNode): void {
    this.body.root.removeChild(node)
    this.body.root.appendChild(node)
    if (this.headerGroup) {
      this.body.root.appendChild(this.headerGroup)
    }
    if (this.frameNode) {
      this.body.root.appendChild(this.frameNode)
    }
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

  /**
   * 设置选区锚点（公式拾取等编辑会话用）：锚定格以选区样式（填充 + 边框）持续绘制，
   * 实际选区照常流动（拾取段消费为引用），被编辑格不丢选中态；合并格按整块包围盒绘制；
   * 传 null 清除（会话结束恢复常规选区行为）。
   */
  setSelectionAnchor(anchor: CellRef | null): void {
    if (!anchor) {
      this.selectionAnchor = null
    } else {
      const merge = this.mergeCells.rangeAt(anchor.col, anchor.row)
      this.selectionAnchor = merge
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

  /**
   * @internal 容器光标写入（填充柄十字光标等指针光标管理）：直写 hostOptions.container
   * 的 style.cursor；未传容器（无 DOM 环境/离屏构造）静默容错不抛错。
   */
  setContainerCursor(cursor: string): void {
    if (this.container) {
      this.container.style.cursor = cursor
    }
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

  // ---- 容器 resize 原地自适应 ----

  /**
   * 构造后原地调整视口尺寸：宿主画布经 host.resize 重设（不 teardown 重建实例），
   * 滚动位置与选区保留（滚动边界重算时仅按新视口夹取）；几何变更统一走
   * applyGeometryChange（滚动边界重算 + 场景全量重建 + 整层失效）。
   */
  resize(width: number, height: number): void {
    const nextWidth = Math.max(0, width)
    const nextHeight = Math.max(0, height)
    if (nextWidth === this.tableWidth && nextHeight === this.tableHeight) {
      return
    }
    this.tableWidth = nextWidth
    this.tableHeight = nextHeight
    // 透传当前宿主环境 dpr：core 侧几何变更路径与运行期 DPR 保持一致
    this.hostDpr = resolveHostDpr()
    this.host.resize(nextWidth, nextHeight, resolveHostDpr())
    // sky 交互浮层节点覆盖范围随新视口重设（绘制裁剪闭包实时读取）
    this.overlay.resize()
    if (this.floatLayer) {
      this.floatLayer.setBodyViewport(this.bodyViewport)
    }
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

  /** 运行时修改冻结列数：夹取到 [0, 列数]；跨冻结边界的既有合并区按新边界重钉主格（合法） */
  setFrozenColCount(count: number): void {
    this.applyFrozenCounts(count, this.frozenRowCount)
  }

  /** 运行时修改冻结行数：夹取到 [0, 行数]；跨冻结边界的既有合并区按新边界重钉主格（合法） */
  setFrozenRowCount(count: number): void {
    this.applyFrozenCounts(this.frozenColCount, count)
  }

  /**
   * 运行时整体替换合并区：重叠/模型越界等校验全部通过才生效（否则抛错保持原状），
   * 生效即全量重建，合并渲染与命中即时反映新集合；跨冻结边界的合并区合法。
   */
  setMergeCells(ranges: readonly CellRange[]): void {
    this.replaceMergeCells(new MergeCellMap(ranges))
  }

  /** 运行时新增一个合并区：与既有区间重叠或越出表格时抛错并保持原状；跨冻结边界合法 */
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

  /**
   * 冻结数运行时变更：跨冻结边界的既有合并区合法（主格按新边界重钉、场景全量
   * 重建），合并区模型不因冻结数变化而越界，无需合并校验，直接走几何变更重建。
   */
  private applyFrozenCounts(frozenColCount: number, frozenRowCount: number): void {
    const nextCols = clampFrozenCount(frozenColCount, this.options.columns.length)
    const nextRows = clampFrozenCount(frozenRowCount, this.pipeline.rowCount)
    if (nextCols === this.frozenColCount && nextRows === this.frozenRowCount) {
      return
    }
    this.frozenColCount = nextCols
    this.frozenRowCount = nextRows
    this.applyGeometryChange()
  }

  /** 合并区集合运行时替换：先做模型越界校验（失败抛错原状不变），落地后走几何变更全量重建 */
  private replaceMergeCells(next: MergeCellMap): void {
    assertMergesWithinTable(next.ranges, this.options.columns.length, this.pipeline.rowCount)
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

  /** @internal 编辑会话锚定格内容隐藏开关：编辑中不画格内容（含溢出走廊一起失效），结束恢复；节点不在窗口内为空操作 */
  private setCellContentHidden(col: number, row: number, hidden: boolean): void {
    const master = this.mergeCells.masterOf(col, row)
    const node = this.cellNodes.get(cellKey(master?.col ?? col, master?.row ?? row))
    if (!node || node.contentHidden === hidden) {
      return
    }
    node.contentHidden = hidden
    // 失效区并入溢出走廊：溢出文本画出本格两侧缘，隐藏/恢复都要覆盖整段
    this.host.submitInvalidation('body', {
      type: 'cell',
      region: overflowExtentRegion(node, node.textMinX, node.textMaxX),
    })
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

  /**
   * 写回数据源：model 形态经 ModelBinding（echo 收集去重，派生格统一刷新；
   * 被编辑格由提交方显式刷新，见 refreshEchoedCells）；records 形态改行对象 field 字段
   */
  private writeCell(col: number, row: number, value: unknown): void {
    if (this.binding) {
      this.refreshEchoedCells(this.binding.writeBack(col, row, value), col, row)
      return
    }
    const field = this.options.columns[col]?.field
    const record = this.options.records?.[row]
    if (field !== undefined && record) {
      record[field] = value
    }
  }

  /** 回驱收尾：窗口内模型 echo 的变更格统一逐格局部刷新；被编辑格由调用方显式刷新，跳过去重 */
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

  /**
   * @internal 几何变更（行列尺寸/冻结数/合并区运行时变更）后：冻结区尺寸/滚动边界重算，
   * 全量重建一次。官方插件晚挂载（table.use）时由 mount 触发，让渲染接线即时生效。
   */
  applyGeometryChange(): void {
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
