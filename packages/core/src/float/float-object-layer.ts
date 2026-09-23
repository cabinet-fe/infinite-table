// FloatObjectLayer：格上浮动对象（图片/图表）的承载、定位、滚动跟随与点选/拖拽交互。
// 浮动对象不进 cell 数据流，持有独立对象树（宿主层 root 下的一个容器子树，最后挂载 = 层内最顶）；
// 锚点（from 格 + 像素偏移 → to 格）经 FloatGeometry 换算层坐标，滚动后 syncPositions 帧级跟随，
// 行高/列宽 resize 后 recalcGeometry 按新行列尺寸重算锚定几何。
// 交互（对齐 ultra-ui image-layer）：点选单选（2px #2170E7 选中环）、拖拽移动（阈值 3px，
// 落点换算新锚点经 onDragEnd 抛给宿主写回模型）、只读（isReadonly）可选中不拖拽；
// 命中由宿主表格的指针路由优先接管（事件不落入单元格选区）。
// 变更以事件抛出（onChange/onDragEnd），undo/历史由宿主入库，本层不内置历史栈。

import {
  SceneNode,
  type LayerHandle,
  type Region,
  type RenderContext,
} from '@infinite-table/render'

import { drawFittedImage, paintImagePlaceholder, type ImageFit } from '../media/draw-image'
import type { ImageService, LoadedImage } from '../media/image-service'
import type { CellRef } from '../types'

/** 选中环颜色（对齐 ultra-ui image-layer：VTable selectionStyle.cellBorderColor） */
const SELECTION_COLOR = '#2170E7'
/** 选中环宽度（px）：画在对象边界外侧（RenderContext 无 stroke，四边细条填充） */
const SELECTION_WIDTH = 2
/** 拖动阈值（px）：位移超过后视为拖拽而非纯点选（对齐 ultra-ui） */
const DRAG_THRESHOLD_PX = 3

/** 失效区域外扩 pad（选中环画在节点边界外侧） */
function inflateRegion(region: Region, pad: number): Region {
  return {
    x: region.x - pad,
    y: region.y - pad,
    width: region.width + pad * 2,
    height: region.height + pad * 2,
  }
}

/** 浮动对象（对齐 ultra-ui SheetImage 的可映射子集） */
export interface FloatObject {
  id: string
  /** image 首批；chart/dom 预留（未加载内容时画占位） */
  kind: 'image' | 'chart' | 'dom'
  anchor: { from: CellRef; to: CellRef; offsetX: number; offsetY: number }
  /** 绝对像素尺寸；缺省时由 anchor.from → anchor.to 的格范围决定 */
  size?: { width: number; height: number }
  fit?: ImageFit
  /** kind === 'image' 时的图片 URL（经 ImageService 加载） */
  src?: string
  alt?: string
  title?: string
}

/** 层坐标几何适配：由宿主表格提供（含表头偏移与滚动偏移），本层不感知表格内部 */
export interface FloatGeometry {
  /** 格左上角在层坐标系中的位置 */
  cellOrigin(col: number, row: number): { x: number; y: number }
  cellSize(col: number, row: number): { width: number; height: number }
  /**
   * 视口点 → 数据格（拖拽落点换算用，层坐标口径）；行列头带/空白返回 null（落点回弹）。
   * 缺省时拖拽只在层内跟随，抬起回弹（无落点换算能力）。
   */
  cellAtPoint?(x: number, y: number): CellRef | null
}

export type FloatObjectChange =
  | { type: 'add'; object: FloatObject }
  | { type: 'remove'; id: string }
  | { type: 'update'; object: FloatObject }

/** 拖拽结束事件：落点换算出的新锚点，宿主写回模型（image-change 回流后展示同步对齐） */
export interface FloatDragEndEvent {
  /** 拖拽的浮动对象 id */
  id: string
  /** 新锚点：from 平移到落点格，落点余量写偏移（负值 clamp 0）；to 随 delta 平移保持跨度 */
  anchor: FloatObject['anchor']
}

/** 拖拽会话：pointerdown 命中图片开启，move 跟随指针（超阈值后），up 落点换算提交 */
interface FloatDragSession {
  id: string
  startX: number
  startY: number
  /** 按下时对象的层坐标（跟随基准） */
  originX: number
  originY: number
  /** 位移已超阈值：未成拖拽的点按不提交 */
  moved: boolean
}

export interface FloatObjectLayerInit {
  /** 承载层（通常 sky：浮动对象在格内容之上） */
  layer: LayerHandle
  geometry: FloatGeometry
  /** 图片浮动对象的加载服务；缺省时图片对象只画占位 */
  imageService?: ImageService
  /**
   * 绘制裁剪视口（层坐标，通常为表格 body 视口）：滚动跟随平移进表头带/行号列的
   * 部分不画，行列头不被浮动对象盖住；缺省不裁剪（独立宿主自行负责层序）。
   */
  bodyViewport?: Region
}

class FloatObjectNode extends SceneNode {
  image: LoadedImage | null = null
  /** 选中态：绘制 2px #2170E7 外扩选中环（对齐 ultra-ui applySelectionStyle） */
  selected = false

  constructor(
    readonly object: FloatObject,
    /** 绘制裁剪视口提供方（层坐标实时值）；返回 null 不裁剪 */
    private readonly viewport: () => Region | null,
  ) {
    // 不可拾取：浮动对象不参与场景命中，指针事件由宿主表格经 getAt 优先路由
    super({ pickable: false })
  }

  override paint(ctx: RenderContext): void {
    const viewport = this.viewport()
    if (viewport) {
      // 选中环画在边界外侧 2px：裁剪窗口随选中态外扩一环，环不被视口交叠裁掉
      const pad = this.selected ? SELECTION_WIDTH : 0
      const x0 = Math.max(0, viewport.x - this.x - pad)
      const y0 = Math.max(0, viewport.y - this.y - pad)
      const x1 = Math.min(this.width + pad, viewport.x + viewport.width - this.x)
      const y1 = Math.min(this.height + pad, viewport.y + viewport.height - this.y)
      if (x1 <= x0 || y1 <= y0) {
        return
      }
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0, y0, x1 - x0, y1 - y0)
      ctx.clip()
      this.paintContent(ctx)
      ctx.restore()
      return
    }
    this.paintContent(ctx)
  }

  private paintContent(ctx: RenderContext): void {
    if (this.image) {
      drawFittedImage(ctx, this.image, this.width, this.height, this.object.fit ?? 'fill')
    } else {
      paintImagePlaceholder(ctx, this.width, this.height)
    }
    if (!this.selected) {
      return
    }
    // 选中环：四边细条填充拼 2px 实线环，整环画在对象边界外侧（CSS outline 口径）
    const t = SELECTION_WIDTH
    ctx.fillStyle = SELECTION_COLOR
    ctx.fillRect(-t, -t, this.width + t * 2, t)
    ctx.fillRect(-t, this.height, this.width + t * 2, t)
    ctx.fillRect(-t, 0, t, this.height)
    ctx.fillRect(this.width, 0, t, this.height)
  }
}

export class FloatObjectLayer {
  private readonly layer: LayerHandle
  private readonly geometry: FloatGeometry
  private readonly imageService?: ImageService
  /** 绘制裁剪视口（层坐标实时值，经 setBodyViewport 随容器 resize 更新）；null 不裁剪 */
  private bodyViewport: Region | null
  private readonly container = new SceneNode({ pickable: false })
  private readonly nodes = new Map<string, FloatObjectNode>()
  private readonly listeners = new Set<(change: FloatObjectChange) => void>()
  private readonly dragEndListeners = new Set<(event: FloatDragEndEvent) => void>()
  /** 当前选中对象 id（单选；无选中为 null） */
  private selectedId: string | null = null
  /** 进行中的拖拽会话（无拖拽为 null） */
  private drag: FloatDragSession | null = null
  private disposed = false

  /**
   * 只读口径（对齐 ultra-ui isReadonly）：图片可选中查看，不启用拖拽（不写锚点）。
   * 宿主按模型只读态写入；运行时可切换。
   */
  isReadonly = false

  constructor(init: FloatObjectLayerInit) {
    this.layer = init.layer
    this.geometry = init.geometry
    this.imageService = init.imageService
    this.bodyViewport = init.bodyViewport ?? null
    // 最后挂载：层内绘制顺序最顶
    this.layer.root.appendChild(this.container)
  }

  get size(): number {
    return this.nodes.size
  }

  add(object: FloatObject): void {
    this.removeIfExists(object.id)
    const node = new FloatObjectNode(object, () => this.bodyViewport)
    this.nodes.set(object.id, node)
    this.container.appendChild(node)
    this.layoutNode(node)
    this.requestImage(node)
    this.layer.invalidate({ type: 'cell', region: node.getGlobalBounds() })
    this.emit({ type: 'add', object })
  }

  remove(id: string): void {
    const node = this.nodes.get(id)
    if (!node) {
      return
    }
    const region = node.getGlobalBounds()
    this.container.removeChild(node)
    this.nodes.delete(id)
    this.layer.invalidate({ type: 'cell', region })
    this.emit({ type: 'remove', id })
  }

  update(id: string, patch: Partial<Omit<FloatObject, 'id'>>): void {
    const node = this.nodes.get(id)
    if (!node) {
      return
    }
    const prev = node.getGlobalBounds()
    Object.assign(node.object, patch)
    this.layoutNode(node)
    if (patch.src !== undefined) {
      node.image = null
      this.requestImage(node)
    }
    this.layer.invalidate({ type: 'cell', region: node.getGlobalBounds(), prevRegion: prev })
    this.emit({ type: 'update', object: node.object })
  }

  get(id: string): FloatObject | undefined {
    return this.nodes.get(id)?.object
  }

  /** 命中测试（层坐标）；后加的对象在上，倒序命中 */
  getAt(x: number, y: number): FloatObject | null {
    const nodes = [...this.nodes.values()]
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]!
      if (x >= node.x && x < node.x + node.width && y >= node.y && y < node.y + node.height) {
        return node.object
      }
    }
    return null
  }

  // ---- 点选与拖拽（对齐 ultra-ui image-layer 交互口径） ----

  /** 当前选中对象 id（无选中为 null） */
  getSelectedId(): string | null {
    return this.selectedId
  }

  /** 是否处于图片拖拽中 */
  isDragging(): boolean {
    return this.drag !== null
  }

  /** 点选选中（单选，重选先清旧）；选中环经定向失效落地 */
  select(id: string): void {
    if (this.selectedId === id || !this.nodes.has(id)) {
      return
    }
    const prev = this.selectedId
    this.selectedId = id
    this.applySelected(prev, false)
    this.applySelected(id, true)
  }

  /** 清除选中（点选浮动对象以外的区域时由指针路由调用） */
  clearSelection(): void {
    if (!this.selectedId) {
      return
    }
    const prev = this.selectedId
    this.selectedId = null
    this.applySelected(prev, false)
  }

  /**
   * 开启拖拽会话（pointerdown 命中图片后由指针路由调用）；只读不启用拖拽
   * （可选中不可拖，返回 false），已删除的 id 同样拒绝。
   */
  beginDrag(id: string, x: number, y: number): boolean {
    const node = this.nodes.get(id)
    if (this.isReadonly || !node) {
      return false
    }
    // 结束上一次未完成的拖（极端情况：up 事件丢失）
    this.drag = { id, startX: x, startY: y, originX: node.x, originY: node.y, moved: false }
    return true
  }

  /** 拖拽跟随：位移超阈值后对象随指针平移（视觉即节点坐标，双区域失效） */
  dragMove(x: number, y: number): void {
    const session = this.drag
    if (!session) {
      return
    }
    const dx = x - session.startX
    const dy = y - session.startY
    if (!session.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return
    }
    session.moved = true
    const node = this.nodes.get(session.id)
    if (!node) {
      this.drag = null
      return
    }
    const prev = node.getGlobalBounds()
    node.x = session.originX + dx
    node.y = session.originY + dy
    this.invalidateNode(node, prev)
  }

  /**
   * 结束拖拽（pointerup 由指针路由调用）：未成拖拽的点按到此为止（选中已在按下完成）；
   * 成拖拽的以拖拽对象左上角的视觉位置反查落点格（对齐 ultra-ui commitDrag 口径），
   * 换算新锚点抛 onDragEnd 由宿主写回模型——落点在行列头带/空白（无 cellAtPoint）
   * 或原地放下则回弹原锚点布局，不改模型。
   */
  endDrag(): void {
    const session = this.drag
    this.drag = null
    if (!session || !session.moved) {
      return
    }
    const node = this.nodes.get(session.id)
    if (!node) {
      return
    }
    const object = node.object
    const hit = this.geometry.cellAtPoint?.(node.x, node.y) ?? null
    const origin = hit ? this.geometry.cellOrigin(hit.col, hit.row) : null
    const offsetX = origin ? Math.max(0, Math.round(node.x - origin.x)) : 0
    const offsetY = origin ? Math.max(0, Math.round(node.y - origin.y)) : 0
    const dCol = hit ? hit.col - object.anchor.from.col : 0
    const dRow = hit ? hit.row - object.anchor.from.row : 0
    const samePlace =
      hit !== null &&
      dCol === 0 &&
      dRow === 0 &&
      object.anchor.offsetX === offsetX &&
      object.anchor.offsetY === offsetY
    if (!hit || samePlace) {
      // 回弹：恢复锚定布局（落点无效/原地放下，不写模型不残留视觉位移）
      const prev = node.getGlobalBounds()
      this.layoutNode(node)
      this.invalidateNode(node, prev)
      return
    }
    const event: FloatDragEndEvent = {
      id: session.id,
      anchor: {
        from: { col: hit.col, row: hit.row },
        to: { col: object.anchor.to.col + dCol, row: object.anchor.to.row + dRow },
        offsetX,
        offsetY,
      },
    }
    for (const listener of this.dragEndListeners) {
      listener(event)
    }
  }

  /** 订阅拖拽结束（宿主据此把新锚点写回模型；可退订） */
  onDragEnd(listener: (event: FloatDragEndEvent) => void): () => void {
    this.dragEndListeners.add(listener)
    return () => this.dragEndListeners.delete(listener)
  }

  /** 滚动跟随的帧级重排：滚动只改锚点换算结果（行列尺寸不变），与锚定几何重算共用同一重排 */
  syncPositions(): void {
    this.recalcGeometry()
  }

  /**
   * 更新绘制裁剪视口（容器 resize 原地自适应路径）：既有对象下次绘制按新视口裁剪，
   * 整层失效一次。
   */
  setBodyViewport(viewport: Region): void {
    this.bodyViewport = viewport
    this.layer.invalidate({ type: 'full' })
  }

  /**
   * 锚定几何重算（行高/列宽 resize 提交后由表格触发）：按当前行列尺寸从 anchor
   * （from→to + offset）重算——无显式像素尺寸的对象随新行列尺寸伸缩；
   * 有显式像素尺寸的对象只跟随锚点位置，尺寸保持不变。整层失效一次。
   */
  recalcGeometry(): void {
    for (const node of this.nodes.values()) {
      this.layoutNode(node)
    }
    this.layer.invalidate({ type: 'full' })
  }

  onChange(listener: (change: FloatObjectChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.drag = null
    this.selectedId = null
    this.container.removeFromParent()
    this.nodes.clear()
    this.listeners.clear()
    this.dragEndListeners.clear()
  }

  private removeIfExists(id: string): void {
    if (this.nodes.has(id)) {
      this.remove(id)
    }
  }

  /** 选中态翻转：写节点标记 + 定向失效（选中环随边界外扩一环宽度） */
  private applySelected(id: string | null, on: boolean): void {
    const node = id ? this.nodes.get(id) : null
    if (!node || node.selected === on) {
      return
    }
    node.selected = on
    this.invalidateNode(node)
  }

  /** 节点区域定向失效；prevRegion 给出时成对提交（拖拽跟随/回弹的双区域） */
  private invalidateNode(node: FloatObjectNode, prevRegion?: Region): void {
    const pad = node.selected ? SELECTION_WIDTH : 0
    const region = inflateRegion(node.getGlobalBounds(), pad)
    this.layer.invalidate(
      prevRegion
        ? { type: 'cell', region, prevRegion: inflateRegion(prevRegion, pad) }
        : { type: 'cell', region },
    )
  }

  /** 锚点 → 层坐标：from 格原点 + 像素偏移为左上角；尺寸取 size 或 from→to 格范围 */
  private layoutNode(node: FloatObjectNode): void {
    const { from, to, offsetX, offsetY } = node.object.anchor
    const origin = this.geometry.cellOrigin(from.col, from.row)
    node.x = origin.x + offsetX
    node.y = origin.y + offsetY
    const size = node.object.size
    if (size) {
      node.width = size.width
      node.height = size.height
      return
    }
    const toOrigin = this.geometry.cellOrigin(to.col, to.row)
    const toSize = this.geometry.cellSize(to.col, to.row)
    node.width = Math.max(0, toOrigin.x + toSize.width - node.x)
    node.height = Math.max(0, toOrigin.y + toSize.height - node.y)
  }

  /** 图片对象加载：已就绪当帧画位图（无闪）；未就绪请求加载，落定后定向失效本对象区域 */
  private requestImage(node: FloatObjectNode): void {
    const service = this.imageService
    const src = node.object.src
    if (!service || node.object.kind !== 'image' || !src) {
      return
    }
    const ready = service.getBitmap(src)
    if (ready) {
      node.image = ready
      return
    }
    service.request(src, node.object.anchor.from, (state) => {
      if (state !== 'ready' || this.disposed || !this.nodes.has(node.object.id)) {
        return
      }
      const image = service.getBitmap(src)
      if (!image) {
        return
      }
      node.image = image
      this.layer.invalidate({ type: 'cell', region: node.getGlobalBounds() })
    })
  }

  private emit(change: FloatObjectChange): void {
    for (const listener of this.listeners) {
      listener(change)
    }
  }
}
