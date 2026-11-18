// ListTable 内部状态分组定义：将约 70 个裸 @internal 字段收敛为几何、场景、媒体、交互 4 个内聚状态容器。
// 仅供包内 list-table 主类与协作模块（scene/media/interaction）与单测消费，不进公共入口。

import type {
  ColResizeEndEvent,
  InertiaScroller,
  LoadedImage,
  MergeCellMap,
  NativeScrollbarHost,
  PainterRegistry,
  RangeBounds,
  ResizeSession,
  RowResizeEndEvent,
  ScrollbarConfig,
  ScrollbarDragSession,
  SelectionState,
  TouchScrollTracker,
  WindowRange,
} from '@infinitable/grid'
import type { PainterSlot } from '@infinitable/protocol'
import { SceneNode, type LayerHandle, type Region, type RenderContext } from '@infinitable/render'

import type { CellNode, TextAdvanceTable } from '../cell-node'
import type { CellStyle } from '../cell-style'
import type {
  FillDragEndListener,
  FillDragState,
  FillHandleDoubleClickListener,
  FillHandleDownListener,
} from '../fill-handle'
import type { HighlightRange, InteractionOverlay, ResizeLine } from '../interaction-overlay'
import type { ScrollFrameListener } from '../list-table'
import type { HeaderDragState } from '../list-table-interaction'
import type { ChartCellNode } from '../media/chart-cell-node'
import type { ImageCellNode } from '../media/image-cell-node'
import type { MediaCache } from '../media/media-cache'
import type {
  BottomCellClickListener,
  CellAddress,
  CellChangeEvent,
  CellLinkClickListener,
  CellLinkHoverListener,
  CellLinkLeaveListener,
  ColHeaderClickListener,
  ContextMenuListener,
  EditEndEvent,
  EditStartEvent,
  ImageLinkClickListener,
} from '../types'

/** 整层绘制器承载节点基类：不可拾取、跳过子遍历，委托 PainterRegistry 按槽位绘制 */
class SlotPaintersNode extends SceneNode {
  constructor(
    private readonly painters: PainterRegistry,
    private readonly slot: PainterSlot,
  ) {
    super({ pickable: false, hitTestChildren: false })
  }

  override paint(ctx: RenderContext): void {
    this.painters.paint(this.slot, ctx, { width: this.width, height: this.height })
  }
}

/** ground 层整层绘制器承载节点（'underlay' 槽位） */
export class GroundPaintersNode extends SlotPaintersNode {
  constructor(painters: PainterRegistry) {
    super(painters, 'underlay')
  }
}

/** sky 层整层绘制器承载节点（'overlay' 槽位，位于交互浮层下方） */
export class OverlayPaintersNode extends SlotPaintersNode {
  constructor(painters: PainterRegistry) {
    super(painters, 'overlay')
  }
}

/** 裁剪容器组：clipRect 非空时按该矩形裁剪全部子节点绘制，置空无额外开销 */
export class ClippedContainerNode extends SceneNode {
  clipRect: Region | null

  constructor(width: number, height: number, clipRect: Region | null = null) {
    super({ pickable: false, hitTestChildren: false, width, height })
    this.clipRect = clipRect
  }

  override paint(ctx: RenderContext): void {
    if (!this.clipRect) {
      return
    }
    ctx.beginPath()
    ctx.rect(this.clipRect.x, this.clipRect.y, this.clipRect.width, this.clipRect.height)
    ctx.clip()
  }
}

/** body 场景树固定层级容器组（按绘制 z 序排列，全部 pickable:false / hitTestChildren:false） */
export interface TableBodyGroups {
  readonly underlayNode: SceneNode
  readonly scrollableGroup: ClippedContainerNode
  readonly scrollableOverflowGroup: ClippedContainerNode
  readonly frozenGroup: ClippedContainerNode
  readonly frozenOverflowGroup: ClippedContainerNode
  readonly crossMergeGroup: ClippedContainerNode
  readonly headerGroup: SceneNode
  readonly scrollableHeadersGroup: SceneNode
  readonly frozenHeadersGroup: SceneNode
  readonly bottomFrozenGroup: ClippedContainerNode
  readonly bottomScrollableGroup: SceneNode
  readonly bottomFrozenColsGroup: SceneNode
  readonly frameNode: SceneNode
}

/** media 场景树固定层级容器组（按绘制 z 序排列，全部 pickable:false / hitTestChildren:false） */
export interface TableMediaGroups {
  readonly scrollableMediaGroup: SceneNode
  readonly frozenMediaGroup: SceneNode
  readonly crossMergeMediaGroup: SceneNode
}

/** 几何状态：行列偏移/尺寸、冻结区、合并区、可视窗口、列级样式缓存 */
export interface TableGeometryState {
  colOffsets: number[]
  colWidths: number[]
  readonly rowHeights: Map<number, number>
  rowOffsets: number[]
  frozenColCount: number
  frozenRowCount: number
  frozenBottomRowCount: number
  frozenColsWidth: number
  frozenRowsHeight: number
  bottomRowOffsets: number[]
  frozenBottomRowsHeight: number
  mergeCells: MergeCellMap
  rows: WindowRange
  cols: WindowRange
  readonly columnStyles: Map<number, CellStyle>
}

/** 场景与绘制状态：层句柄、固定容器组、节点索引、整层绘制器、文本快测表、批处理失效队列 */
export interface TableSceneState {
  readonly body: LayerHandle
  readonly sky: LayerHandle
  ground: LayerHandle | null
  media: LayerHandle | null
  groups: TableBodyGroups | null
  mediaGroups: TableMediaGroups | null
  readonly cellNodes: Map<number, CellNode>
  readonly colHeaderNodes: Map<number, CellNode>
  readonly rowHeaderNodes: Map<number, CellNode>
  readonly bottomCellNodes: Map<number, CellNode>
  readonly bottomRowHeaderNodes: Map<number, CellNode>
  cornerNode: CellNode | null
  readonly painters: PainterRegistry
  underlayPaintersNode: GroundPaintersNode | null
  overlayPaintersNode: OverlayPaintersNode | null
  readonly textAdvances: TextAdvanceTable
  batchDepth: number
  readonly batchRegions: Region[]
  colOffsetsDirty: boolean
  rowOffsetsDirty: boolean
  geometryDirty: boolean
}

/** 媒体状态：cell 级位图 LRU、窗口内图片/图表格节点、出图单飞、宿主 DPR */
export interface TableMediaState {
  readonly mediaCache: MediaCache<LoadedImage>
  readonly imageCellNodes: Map<number, ImageCellNode>
  readonly chartCellNodes: Map<number, ChartCellNode>
  readonly chartRenderTasks: Map<string, Promise<LoadedImage | null>>
  hostDpr: number
}

/** 交互状态：选区/浮层/滚动条/拖拽/悬停/点击状态与全部事件监听集合 */
export interface TableInteractionState {
  readonly selection: SelectionState
  readonly overlay: InteractionOverlay
  readonly touchTracker: TouchScrollTracker
  readonly inertia: InertiaScroller
  resizeSession: ResizeSession | null
  resizeLine: ResizeLine | null
  scrollbarDrag: ScrollbarDragSession | null
  readonly scrollbarConfig: ScrollbarConfig
  readonly nativeScrollbar: NativeScrollbarHost | null
  scrollbarVisible: boolean
  scrollbarHover: 'vertical' | 'horizontal' | null
  scrollbarHideTimer: ReturnType<typeof setTimeout> | null
  pointerSessionRelease: (() => void) | null
  selecting: boolean
  dragAnchor: CellAddress | null
  headerDrag: HeaderDragState | null
  headerHighlightSignature: string
  overlayHadContent: boolean
  highlightRanges: readonly HighlightRange[]
  selectionAnchor: RangeBounds | null
  fillDrag: FillDragState | null
  lastFillHandleTap: { key: string; time: number } | null
  fillHandleDoubleTap: boolean
  linkHover: CellAddress | null
  pointerDownCell: CellAddress | null
  pointerDownColHeader: number | null
  pointerDownColHeaderHitId: string | null
  pointerDownBottomCell: CellAddress | null
  lastTap: { col: number; row: number; x: number; y: number; time: number } | null
  pointerDownAt: { x: number; y: number } | null
  editPickMode: boolean
  readonly eventUnsubscribers: Array<() => void>
  readonly contextMenuListeners: Set<ContextMenuListener>
  readonly cellLinkHoverListeners: Set<CellLinkHoverListener>
  readonly cellLinkLeaveListeners: Set<CellLinkLeaveListener>
  readonly cellLinkClickListeners: Set<CellLinkClickListener>
  readonly imageLinkClickListeners: Set<ImageLinkClickListener>
  readonly scrollFrameListeners: Set<ScrollFrameListener>
  readonly cellChangeListeners: Set<(change: CellChangeEvent) => void>
  readonly editStartListeners: Set<(event: EditStartEvent) => void>
  readonly editEndListeners: Set<(event: EditEndEvent) => void>
  readonly colResizeEndListeners: Set<(event: ColResizeEndEvent) => void>
  readonly rowResizeEndListeners: Set<(event: RowResizeEndEvent) => void>
  readonly fillHandleDownListeners: Set<FillHandleDownListener>
  readonly fillDragEndListeners: Set<FillDragEndListener>
  readonly fillHandleDoubleClickListeners: Set<FillHandleDoubleClickListener>
  readonly colHeaderClickListeners: Set<ColHeaderClickListener>
  readonly bottomCellClickListeners: Set<BottomCellClickListener>
}
