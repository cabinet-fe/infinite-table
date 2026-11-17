// FloatObjectLayer：格上浮动对象（图片/图表）的承载、定位、滚动跟随与点选/拖拽/变换交互。
// 浮动对象不进 cell 数据流，持有独立对象树（宿主层 root 下的一个容器子树，最后挂载 = 层内最顶）；
// 锚点（from 格 + 像素偏移 → to 格）经 FloatGeometry 换算层坐标，滚动后 syncPositions 帧级跟随，
// 行高/列宽 resize 后 recalcGeometry 按新行列尺寸重算锚定几何。
// 纯几何与变换数学复用 @infinitable/grid/float-geometry（不各自维护重复数学）。

import {
  computeRotatedDeg,
  computeScaledBounds,
  createFloatRotateState,
  createFloatScaleState,
  drawFittedImage,
  hitSquare,
  layoutFloatBounds,
  paintImagePlaceholder,
  resolveAnchorAt,
  rotatedLocalCover,
  SCALE_HANDLES,
  scaleHandleCenter,
  toLocalFloatPoint,
  toRad,
  type FloatAnchor,
  type FloatGeometry,
  type FloatObjectBase,
  type FloatRotateState,
  type FloatScaleState,
  type FloatTransformHandle,
  type ImageFit,
  type ImageService,
  type LoadedImage,
} from '@infinitable/grid'
import {
  SceneNode,
  type LayerHandle,
  type Region,
  type RenderContext,
  type SceneEvent,
} from '@infinitable/render'

/** 选中环颜色（对齐 ultra-ui image-layer：VTable selectionStyle.cellBorderColor） */
const SELECTION_COLOR = '#2170E7'
/** 选中环宽度（px）：画在对象边界外侧（RenderContext 无 stroke，四边细条填充） */
const SELECTION_WIDTH = 2
/** 拖动阈值（px）：位移超过后视为拖拽而非纯点按（对齐 ultra-ui，移动/缩放/旋转共用） */
const DRAG_THRESHOLD_PX = 3
/** 缩放手柄边长（px）：四角 + 四边中点各一，白芯蓝框方块（两层 fillRect 拼边框） */
const HANDLE_SIZE = 8
/** 旋转手柄离对象上缘的距离（px，手柄中心到上缘；随对象一起旋转） */
const ROTATE_HANDLE_OFFSET = 20
/** 选中态绘制外扩（px）：选中环 + 手柄（含旋转手柄杆）超出对象边界的最大范围，
 *  失效区域与裁剪窗口统一按此外扩 */
const SELECTED_PAD = ROTATE_HANDLE_OFFSET + HANDLE_SIZE / 2 + SELECTION_WIDTH

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
export interface FloatObject extends FloatObjectBase {
  fit?: ImageFit
  /** kind === 'image' 时的图片 URL（经 ImageService 加载） */
  src?: string
  alt?: string
  title?: string
  /** 图片超链接 URL；带链接浮动图单击派发图片链接点击事件（缺省无链接，单击保持选中行为） */
  link?: string
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
  anchor: FloatAnchor
}

/** 变换结束事件：缩放/旋转会话抬起时抛出，宿主写回模型（拖拽过程只改渲染态不提交） */
export interface FloatTransformEndEvent {
  /** 变换的浮动对象 id */
  id: string
  /** 新锚点：按变换后对象视觉左上角反查（与拖拽移动同一口径）；反查无效时保持原锚点 */
  anchor: FloatAnchor
  /** 变换后绝对像素尺寸 */
  size: { width: number; height: number }
  /** 变换后旋转角（顺时针度数，归一化 0–360） */
  rotation: number
}

/** 浮动对象右键事件：contextmenu 命中浮动对象时抛出（不穿透到单元格右键事件） */
export interface FloatContextMenuEvent {
  /** 命中的浮动对象 id */
  id: string
  /** 层坐标（CSS 像素，右键落点） */
  x: number
  y: number
  originalEvent: SceneEvent['originalEvent']
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

/** 缩放会话：复用 grid 的 FloatScaleState */
interface FloatScaleSession {
  mode: 'scale'
  id: string
  handle: Exclude<FloatTransformHandle, 'rotate'>
  startX: number
  startY: number
  moved: boolean
  state: FloatScaleState
}

/** 旋转会话：复用 grid 的 FloatRotateState */
interface FloatRotateSession {
  mode: 'rotate'
  id: string
  startX: number
  startY: number
  moved: boolean
  state: FloatRotateState
}

type FloatTransformSession = FloatScaleSession | FloatRotateSession

interface FloatObjectLayerInit {
  /** 承载层（通常 sky：浮动对象在格内容之上） */
  layer: LayerHandle
  geometry: FloatGeometry
  /** 图片浮动对象的加载服务；缺省时图片对象只画占位 */
  imageService?: ImageService
  /**
   * 绘制裁剪视口（层坐标，通常为表格 body 视口）：滚动跟随平移进表头带/行号列的
   * 部分不画（行列头不被浮动对象盖住），同时是越缘落点就近换算的投影边界（pointInView）；
   * 缺省不裁剪（独立宿主自行负责层序）。
   */
  bodyViewport?: Region
}

class FloatObjectNode extends SceneNode {
  image: LoadedImage | null = null
  /** 选中态：绘制 2px #2170E7 外扩选中环 + 变换手柄（对齐 ultra-ui applySelectionStyle） */
  selected = false
  /** 渲染旋转态（object.rotation 的渲染镜像；变换会话只改这里，提交走 onTransformEnd） */
  rotation = 0

  constructor(
    readonly object: FloatObject,
    /** 绘制裁剪视口提供方（层坐标实时值）；返回 null 不裁剪 */
    private readonly viewport: () => Region | null,
  ) {
    // 不可拾取：浮动对象不参与场景命中，指针事件由宿主表格经 getAt 优先路由
    super({ pickable: false })
  }

  /** 绘制内容覆盖（局部坐标）：旋转 AABB，选中态外扩到手柄范围（脏区剔除口径） */
  override paintedBounds(): Region {
    return inflateRegion(rotatedLocalCover(this.width, this.height, this.rotation), this.pad())
  }

  override paint(ctx: RenderContext): void {
    const viewport = this.viewport()
    if (viewport) {
      const clip = this.clipWindow(viewport, this.pad())
      if (!clip) {
        return
      }
      ctx.save()
      ctx.beginPath()
      ctx.rect(clip.x, clip.y, clip.width, clip.height)
      ctx.clip()
      this.paintTransformed(ctx)
      ctx.restore()
      return
    }
    this.paintTransformed(ctx)
  }

  /** 应用旋转变换后绘制内容（θ = 0 直画，与既有未旋转路径逐字节一致） */
  private paintTransformed(ctx: RenderContext): void {
    if (this.rotation % 360 !== 0 && ctx.rotate) {
      ctx.save()
      ctx.translate(this.width / 2, this.height / 2)
      ctx.rotate(toRad(this.rotation))
      ctx.translate(-this.width / 2, -this.height / 2)
      this.paintContent(ctx)
      ctx.restore()
      return
    }
    this.paintContent(ctx)
  }

  /** 选中态外扩（选中环 + 手柄超出边界的范围） */
  pad(): number {
    return this.selected ? SELECTED_PAD : 0
  }

  /**
   * 局部帧内的绘制裁剪窗口：内容覆盖（旋转 AABB + pad）∩ 视口（严格，四边不外扩）。
   * 不相交返回 null（整体在视口外/带外，不画）。
   */
  private clipWindow(viewport: Region, pad: number): Region | null {
    const cover = inflateRegion(rotatedLocalCover(this.width, this.height, this.rotation), pad)
    const x0 = Math.max(cover.x, viewport.x - this.x)
    const y0 = Math.max(cover.y, viewport.y - this.y)
    const x1 = Math.min(cover.x + cover.width, viewport.x + viewport.width - this.x)
    const y1 = Math.min(cover.y + cover.height, viewport.y + viewport.height - this.y)
    if (x1 <= x0 || y1 <= y0) {
      return null
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
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
    this.paintSelection(ctx)
  }

  /** 选中态装饰：2px 实线环 + 8 缩放手柄 + 顶部旋转手柄（整体随 rotation 旋转） */
  private paintSelection(ctx: RenderContext): void {
    const t = SELECTION_WIDTH
    ctx.fillStyle = SELECTION_COLOR
    ctx.fillRect(-t, -t, this.width + t * 2, t)
    ctx.fillRect(-t, this.height, this.width + t * 2, t)
    ctx.fillRect(-t, 0, t, this.height)
    ctx.fillRect(this.width, 0, t, this.height)
    for (const { sx, sy } of SCALE_HANDLES) {
      const [hx, hy] = scaleHandleCenter(sx, sy, this.width, this.height)
      const half = HANDLE_SIZE / 2
      ctx.fillStyle = SELECTION_COLOR
      ctx.fillRect(hx - half, hy - half, HANDLE_SIZE, HANDLE_SIZE)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(hx - half + 2, hy - half + 2, HANDLE_SIZE - 4, HANDLE_SIZE - 4)
    }
    const rx = this.width / 2
    const half = HANDLE_SIZE / 2
    ctx.fillStyle = SELECTION_COLOR
    ctx.fillRect(rx - 1, -ROTATE_HANDLE_OFFSET + half, 2, ROTATE_HANDLE_OFFSET - half - half)
    ctx.fillRect(rx - half, -ROTATE_HANDLE_OFFSET - half, HANDLE_SIZE, HANDLE_SIZE)
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
  private readonly transformEndListeners = new Set<(event: FloatTransformEndEvent) => void>()
  private readonly contextMenuListeners = new Set<(event: FloatContextMenuEvent) => void>()
  /** 当前选中对象 id（单选；无选中为 null） */
  private selectedId: string | null = null
  /** 进行中的拖拽会话（无拖拽为 null） */
  private drag: FloatDragSession | null = null
  /** 进行中的变换会话（缩放/旋转；无变换为 null），与拖拽会话互斥 */
  private transform: FloatTransformSession | null = null
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
    this.invalidateNode(node)
    this.emit({ type: 'add', object })
  }

  remove(id: string): void {
    const node = this.nodes.get(id)
    if (!node) {
      return
    }
    const region = inflateRegion(this.coverOf(node), node.pad())
    this.container.removeChild(node)
    this.nodes.delete(id)
    if (this.selectedId === id) {
      this.selectedId = null
    }
    if (this.drag?.id === id) {
      this.drag = null
    }
    if (this.transform?.id === id) {
      this.transform = null
    }
    this.layer.invalidate({ type: 'region', region })
    this.emit({ type: 'remove', id })
  }

  /**
   * 合并补丁到既有对象（Object.assign 语义）：补丁未携带的键保持原值；
   * 要清除可选字段（如 link/alt/title），补丁须显式携带该键并置 undefined——
   * 缺键不构成删除，宿主全量同步可清除字段时不得省略键。
   */
  update(id: string, patch: Partial<Omit<FloatObject, 'id'>>): void {
    const node = this.nodes.get(id)
    if (!node) {
      return
    }
    const prev = this.coverOf(node)
    Object.assign(node.object, patch)
    this.layoutNode(node)
    if (patch.src !== undefined) {
      node.image = null
      this.requestImage(node)
    }
    this.invalidateNode(node, prev)
    this.emit({ type: 'update', object: node.object })
  }

  get(id: string): FloatObject | undefined {
    return this.nodes.get(id)?.object
  }

  /** 命中测试（层坐标）；后加的对象在上，倒序命中。旋转对象沿逆变换路径判定未旋转局部框 */
  getAt(x: number, y: number): FloatObject | null {
    const nodes = [...this.nodes.values()]
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]!
      const local = toLocalFloatPoint(x, y, node, node.rotation)
      if (
        local.x >= node.x &&
        local.x < node.x + node.width &&
        local.y >= node.y &&
        local.y < node.y + node.height
      ) {
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
    const prev = this.coverOf(node)
    node.x = session.originX + dx
    node.y = session.originY + dy
    this.invalidateNode(node, prev)
  }

  /**
   * 结束拖拽（pointerup 由指针路由调用）：未成拖拽的点按到此为止；
   * 成拖拽的以拖拽对象左上角反查落点格，换算新锚点抛 onDragEnd。
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
    const point = this.pointInView(node.x, node.y)
    const next = resolveAnchorAt(object.anchor, point.x, point.y, this.geometry)
    const samePlace =
      next.from.col === object.anchor.from.col &&
      next.from.row === object.anchor.from.row &&
      next.offsetX === object.anchor.offsetX &&
      next.offsetY === object.anchor.offsetY
    if (samePlace) {
      const prev = this.coverOf(node)
      this.layoutNode(node)
      this.invalidateNode(node, prev)
      return
    }
    const event: FloatDragEndEvent = { id: session.id, anchor: next }
    for (const listener of this.dragEndListeners) {
      listener(event)
    }
  }

  /** 订阅拖拽结束（宿主据此把新锚点写回模型；可退订） */
  onDragEnd(listener: (event: FloatDragEndEvent) => void): () => void {
    this.dragEndListeners.add(listener)
    return () => this.dragEndListeners.delete(listener)
  }

  // ---- 变换会话（8 缩放手柄 + 旋转手柄） ----

  /**
   * 变换手柄命中（层坐标）：仅对当前选中对象判定（未选中/未命中返回 null）。
   */
  handleAt(x: number, y: number): FloatTransformHandle | null {
    const node = this.selectedId ? this.nodes.get(this.selectedId) : null
    if (!node) {
      return null
    }
    const local = toLocalFloatPoint(x, y, node, node.rotation)
    if (
      hitSquare(
        local.x,
        local.y,
        node.x + node.width / 2,
        node.y - ROTATE_HANDLE_OFFSET,
        HANDLE_SIZE,
      )
    ) {
      return 'rotate'
    }
    for (const { name, sx, sy } of SCALE_HANDLES) {
      const [cx, cy] = scaleHandleCenter(sx, sy, node.width, node.height)
      if (hitSquare(local.x, local.y, node.x + cx, node.y + cy, HANDLE_SIZE)) {
        return name
      }
    }
    return null
  }

  /** 是否处于变换会话中 */
  isTransforming(): boolean {
    return this.transform !== null
  }

  /**
   * 开启变换会话（pointerdown 命中选中对象的手柄后由指针路由调用）；只读不启用变换。
   */
  beginTransform(handle: FloatTransformHandle, x: number, y: number): boolean {
    if (this.isReadonly || !this.selectedId) {
      return false
    }
    const node = this.nodes.get(this.selectedId)
    if (!node) {
      return false
    }
    if (handle === 'rotate') {
      this.transform = {
        mode: 'rotate',
        id: node.object.id,
        startX: x,
        startY: y,
        moved: false,
        state: createFloatRotateState(node, node.rotation, x, y),
      }
      return true
    }
    const state = createFloatScaleState(handle, node, node.rotation, x, y)
    if (!state) {
      return false
    }
    this.transform = {
      mode: 'scale',
      id: node.object.id,
      handle,
      startX: x,
      startY: y,
      moved: false,
      state,
    }
    return true
  }

  /** 变换跟随：位移超阈值后生效，只改渲染态，不提交事件 */
  transformMove(x: number, y: number, shiftKey: boolean): void {
    const session = this.transform
    if (!session) {
      return
    }
    if (!session.moved && Math.hypot(x - session.startX, y - session.startY) < DRAG_THRESHOLD_PX) {
      return
    }
    session.moved = true
    const node = this.nodes.get(session.id)
    if (!node) {
      this.transform = null
      return
    }
    const prev = this.coverOf(node)
    if (session.mode === 'rotate') {
      node.rotation = computeRotatedDeg(session.state, x, y, shiftKey)
    } else {
      const next = computeScaledBounds(session.state, x, y, shiftKey)
      node.x = next.x
      node.y = next.y
      node.width = next.width
      node.height = next.height
    }
    this.invalidateNode(node, prev)
  }

  /** 落点反查投影：越缘落点钳回数据区视口内就近换算；未配置视口原样返回 */
  private pointInView(x: number, y: number): { x: number; y: number } {
    const viewport = this.bodyViewport
    if (!viewport) {
      return { x, y }
    }
    return {
      x: Math.min(Math.max(x, viewport.x), viewport.x + viewport.width - 1),
      y: Math.min(Math.max(y, viewport.y), viewport.y + viewport.height - 1),
    }
  }

  /** 结束变换：成拖拽的按对象视觉状态反查新锚点，抛 onTransformEnd */
  endTransform(): void {
    const session = this.transform
    this.transform = null
    if (!session || !session.moved) {
      return
    }
    const node = this.nodes.get(session.id)
    if (!node) {
      return
    }
    const point = this.pointInView(node.x, node.y)
    const event: FloatTransformEndEvent = {
      id: session.id,
      anchor: resolveAnchorAt(node.object.anchor, point.x, point.y, this.geometry),
      size: { width: Math.round(node.width), height: Math.round(node.height) },
      rotation: node.rotation,
    }
    for (const listener of this.transformEndListeners) {
      listener(event)
    }
  }

  /** 订阅变换结束（宿主据此把新 size/rotation/锚点写回模型；可退订） */
  onTransformEnd(listener: (event: FloatTransformEndEvent) => void): () => void {
    this.transformEndListeners.add(listener)
    return () => this.transformEndListeners.delete(listener)
  }

  // ---- 右键（contextmenu 路由浮动层优先，事件不穿透到单元格） ----

  /** 派发浮动对象右键事件 */
  dispatchContextMenu(object: FloatObject, event: SceneEvent): void {
    if (this.contextMenuListeners.size === 0) {
      return
    }
    event.originalEvent.preventDefault?.()
    const emitted: FloatContextMenuEvent = {
      id: object.id,
      x: event.x,
      y: event.y,
      originalEvent: event.originalEvent,
    }
    for (const listener of this.contextMenuListeners) {
      listener(emitted)
    }
  }

  /** 订阅浮动对象右键事件 */
  onContextMenu(listener: (event: FloatContextMenuEvent) => void): () => void {
    this.contextMenuListeners.add(listener)
    return () => this.contextMenuListeners.delete(listener)
  }

  /** 滚动跟随的帧级重排 */
  syncPositions(): void {
    this.recalcGeometry()
  }

  /** 更新绘制裁剪视口（容器 resize 原地自适应路径） */
  setBodyViewport(viewport: Region): void {
    this.bodyViewport = viewport
    this.layer.invalidate({ type: 'full' })
  }

  /** 锚定几何重算（行高/列宽 resize 提交后由表格触发） */
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
    this.transform = null
    this.selectedId = null
    this.container.removeFromParent()
    this.nodes.clear()
    this.listeners.clear()
    this.dragEndListeners.clear()
    this.transformEndListeners.clear()
    this.contextMenuListeners.clear()
  }

  private removeIfExists(id: string): void {
    if (this.nodes.has(id)) {
      this.remove(id)
    }
  }

  /** 节点绘制覆盖（层坐标）：旋转 AABB */
  private coverOf(node: FloatObjectNode): Region {
    const cover = rotatedLocalCover(node.width, node.height, node.rotation)
    return {
      x: node.x + cover.x,
      y: node.y + cover.y,
      width: cover.width,
      height: cover.height,
    }
  }

  /** 选中态翻转：写节点标记 + 定向失效 */
  private applySelected(id: string | null, on: boolean): void {
    const node = id ? this.nodes.get(id) : null
    if (!node || node.selected === on) {
      return
    }
    node.selected = on
    this.invalidateNode(node)
  }

  /** 节点区域定向失效（旋转 AABB + 选中态外扩） */
  private invalidateNode(node: FloatObjectNode, prevRegion?: Region): void {
    const pad = node.pad()
    const region = inflateRegion(this.coverOf(node), pad)
    this.layer.invalidate(
      prevRegion
        ? { type: 'region', region, prevRegion: inflateRegion(prevRegion, pad) }
        : { type: 'region', region },
    )
  }

  /** 锚点 → 层坐标（复用 grid layoutFloatBounds） */
  private layoutNode(node: FloatObjectNode): void {
    const bounds = layoutFloatBounds(node.object.anchor, node.object.size, this.geometry)
    node.x = bounds.x
    node.y = bounds.y
    node.width = bounds.width
    node.height = bounds.height
    node.rotation = node.object.rotation ?? 0
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
      this.invalidateNode(node)
    })
  }

  private emit(change: FloatObjectChange): void {
    for (const listener of this.listeners) {
      listener(change)
    }
  }
}
