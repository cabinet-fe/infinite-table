// FloatObjectLayer：格上浮动对象（图片/图表）的承载、定位、滚动跟随与点选/拖拽/变换交互。
// 浮动对象不进 cell 数据流，持有独立对象树（宿主层 root 下的一个容器子树，最后挂载 = 层内最顶）；
// 锚点（from 格 + 像素偏移 → to 格）经 FloatGeometry 换算层坐标，滚动后 syncPositions 帧级跟随，
// 行高/列宽 resize 后 recalcGeometry 按新行列尺寸重算锚定几何。
// 交互（对齐 ultra-ui image-layer）：点选单选（2px #2170E7 选中环）、拖拽移动（阈值 3px，
// 落点换算新锚点经 onDragEnd 抛给宿主写回模型）、只读（isReadonly）可选中不拖拽；
// 命中由宿主表格的指针路由优先接管（事件不落入单元格选区）。
// 变换（univer Transformer 思路）：选中态画 8 缩放手柄 + 顶部 1 旋转手柄（随对象 rotation 一起
// 旋转）；拖角/边手柄缩放（Shift 等比）、拖旋转手柄改 rotation（Shift 吸附 15°，归一化 0–360），
// 拖拽过程只改渲染态，结束经 onTransformEnd 抛 { id, anchor, size, rotation } 由宿主写回模型。
// 旋转渲染绕对象中心（ctx.rotate），命中沿统一逆变换路径（指针先逆旋转回未旋转局部帧再判框）。
// 变更以事件抛出（onChange/onDragEnd/onTransformEnd），undo/历史由宿主入库，本层不内置历史栈。

import { SceneNode, type LayerHandle, type Region, type RenderContext } from '@infinitable/render'

import { drawFittedImage, paintImagePlaceholder, type ImageFit } from '../media/draw-image'
import type { ImageService, LoadedImage } from '../media/image-service'
import type { CellRef } from '../types'

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
/** Shift 旋转吸附步进（度） */
const ROTATE_SNAP_DEG = 15
/** 变换最小尺寸（px）：夹取防止拖缩到零/负 */
const MIN_TRANSFORM_SIZE = 8
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

/** 弧度（顺时针度数转） */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * 局部帧内矩形绕中心旋转 θ（顺时针度数）后的轴对齐包围盒（局部帧坐标）。
 * θ = 0 即原矩形；旋转内容（图片/选中环/手柄，均在旋转帧内绘制）的覆盖都以此为界。
 */
function rotatedLocalCover(width: number, height: number, deg: number): Region {
  if (deg % 360 === 0) {
    return { x: 0, y: 0, width, height }
  }
  const rad = toRad(deg)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // 旋转后包围盒半宽/半高 = 原半边长在两轴上的投影和
  const extX = (width / 2) * Math.abs(cos) + (height / 2) * Math.abs(sin)
  const extY = (width / 2) * Math.abs(sin) + (height / 2) * Math.abs(cos)
  return {
    x: width / 2 - extX,
    y: height / 2 - extY,
    width: extX * 2,
    height: extY * 2,
  }
}

/** 度数归一化到 [0, 360) */
function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** 浮动对象（对齐 ultra-ui SheetImage 的可映射子集） */
export interface FloatObject {
  id: string
  /** image 首批；chart/dom 预留（未加载内容时画占位） */
  kind: 'image' | 'chart' | 'dom'
  anchor: { from: CellRef; to: CellRef; offsetX: number; offsetY: number }
  /** 绝对像素尺寸；缺省时由 anchor.from → anchor.to 的格范围决定 */
  size?: { width: number; height: number }
  /** 旋转角（顺时针度数，缺省 0）：渲染绕对象中心旋转，命中沿逆变换路径 */
  rotation?: number
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

/** 变换手柄：8 缩放（四角 + 四边中点，随对象 rotation 旋转）+ 顶部 1 旋转 */
export type FloatTransformHandle =
  | 'left-top'
  | 'center-top'
  | 'right-top'
  | 'left-middle'
  | 'right-middle'
  | 'left-bottom'
  | 'center-bottom'
  | 'right-bottom'
  | 'rotate'

/**
 * 8 缩放手柄的位置与轴向符号：右/下缘为 +1（拖大）、左/上缘为 -1（拖大向反侧扩展）、
 * 中点 0（该轴不变）；中心位置 = ((sx+1)/2·w, (sy+1)/2·h)（局部未旋转帧）。
 */
const SCALE_HANDLES: ReadonlyArray<{
  name: Exclude<FloatTransformHandle, 'rotate'>
  sx: -1 | 0 | 1
  sy: -1 | 0 | 1
}> = [
  { name: 'left-top', sx: -1, sy: -1 },
  { name: 'center-top', sx: 0, sy: -1 },
  { name: 'right-top', sx: 1, sy: -1 },
  { name: 'left-middle', sx: -1, sy: 0 },
  { name: 'right-middle', sx: 1, sy: 0 },
  { name: 'left-bottom', sx: -1, sy: 1 },
  { name: 'center-bottom', sx: 0, sy: 1 },
  { name: 'right-bottom', sx: 1, sy: 1 },
]

/** 变换结束事件：缩放/旋转会话抬起时抛出，宿主写回模型（拖拽过程只改渲染态不提交） */
export interface FloatTransformEndEvent {
  /** 变换的浮动对象 id */
  id: string
  /** 新锚点：按变换后对象视觉左上角反查（与拖拽移动同一口径）；反查无效时保持原锚点 */
  anchor: FloatObject['anchor']
  /** 变换后绝对像素尺寸 */
  size: { width: number; height: number }
  /** 变换后旋转角（顺时针度数，归一化 0–360） */
  rotation: number
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

/** 缩放会话：对侧锚点（层坐标）在缩放期间保持不动，旋转角不变 */
interface FloatScaleSession {
  mode: 'scale'
  id: string
  handle: Exclude<FloatTransformHandle, 'rotate'>
  startX: number
  startY: number
  moved: boolean
  /** 会话期间恒定的旋转角（度）与起始尺寸 */
  rotation: number
  width0: number
  height0: number
  /** 对侧锚点的层坐标（固定点） */
  anchorX: number
  anchorY: number
  sx: -1 | 0 | 1
  sy: -1 | 0 | 1
}

/** 旋转会话：中心不动（旋转不改变位置），角度 = 原角 + 指针方位角差值 */
interface FloatRotateSession {
  mode: 'rotate'
  id: string
  startX: number
  startY: number
  moved: boolean
  centerX: number
  centerY: number
  /** 按下时指针相对中心的方位角（弧度） */
  startAngle: number
  /** 按下时的对象旋转角（度） */
  rotation0: number
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
   * 部分不画，行列头不被浮动对象盖住；缺省不裁剪（独立宿主自行负责层序）。
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
      // 裁剪窗口画在边界外侧（选中环 + 手柄）：窗口随选中态外扩，手柄不被视口交叠裁掉。
      // 旋转对象的窗口在预旋转帧计算（此刻 CTM 与层坐标 1:1 平移），clip 在层空间固定，
      // 随后的 ctx.rotate 只旋转内容不旋转窗口——旋转后的像素不会越窗画进表头带。
      const pad = this.pad()
      const clip = this.clipWindow(viewport, pad)
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
   * 局部帧内的绘制裁剪窗口：内容覆盖（旋转 AABB + pad）∩（视口 + pad）。
   * 不相交返回 null（整体在视口外/带外，不画）。
   */
  private clipWindow(viewport: Region, pad: number): Region | null {
    const cover = inflateRegion(rotatedLocalCover(this.width, this.height, this.rotation), pad)
    const x0 = Math.max(cover.x, viewport.x - this.x - pad)
    const y0 = Math.max(cover.y, viewport.y - this.y - pad)
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
    // 选中环：四边细条填充拼 2px 实线环，整环画在对象边界外侧（CSS outline 口径）
    const t = SELECTION_WIDTH
    ctx.fillStyle = SELECTION_COLOR
    ctx.fillRect(-t, -t, this.width + t * 2, t)
    ctx.fillRect(-t, this.height, this.width + t * 2, t)
    ctx.fillRect(-t, 0, t, this.height)
    ctx.fillRect(this.width, 0, t, this.height)
    // 8 缩放手柄：白芯蓝框方块（RenderContext 无 stroke，两层 fillRect 拼边框）
    for (const { sx, sy } of SCALE_HANDLES) {
      const [hx, hy] = scaleHandleCenter(sx, sy, this.width, this.height)
      const half = HANDLE_SIZE / 2
      ctx.fillStyle = SELECTION_COLOR
      ctx.fillRect(hx - half, hy - half, HANDLE_SIZE, HANDLE_SIZE)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(hx - half + 2, hy - half + 2, HANDLE_SIZE - 4, HANDLE_SIZE - 4)
    }
    // 顶部旋转手柄：上缘中点外一杆一实心方块（中心在 (w/2, -ROTATE_HANDLE_OFFSET)）
    const rx = this.width / 2
    const half = HANDLE_SIZE / 2
    ctx.fillStyle = SELECTION_COLOR
    ctx.fillRect(rx - 1, -ROTATE_HANDLE_OFFSET + half, 2, ROTATE_HANDLE_OFFSET - half - half)
    ctx.fillRect(rx - half, -ROTATE_HANDLE_OFFSET - half, HANDLE_SIZE, HANDLE_SIZE)
  }

  /**
   * 指针层坐标逆旋转回未旋转局部帧（统一逆变换路径：旋转对象的命中/手柄判定共用）。
   * θ = 0 原样返回。
   */
  toLocalPoint(x: number, y: number): { x: number; y: number } {
    if (this.rotation % 360 === 0) {
      return { x, y }
    }
    const rad = toRad(this.rotation)
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const cx = this.x + this.width / 2
    const cy = this.y + this.height / 2
    const dx = x - cx
    const dy = y - cy
    // R(θ) 的逆矩阵：[cos, sin; -sin, cos]（y 向下，θ 为顺时针度数）
    return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos }
  }
}

/** 缩放手柄中心（局部未旋转帧坐标）：轴向符号映射到边/角位置 */
function scaleHandleCenter(
  sx: number,
  sy: number,
  width: number,
  height: number,
): [number, number] {
  return [((sx + 1) / 2) * width, ((sy + 1) / 2) * height]
}

/** 局部帧内点是否落在以 (hx, hy) 为中心的 size 方块内（手柄命中判定） */
function inHandleRect(p: { x: number; y: number }, hx: number, hy: number, size: number): boolean {
  const half = size / 2
  return p.x >= hx - half && p.x < hx + half && p.y >= hy - half && p.y < hy + half
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
    this.layer.invalidate({ type: 'cell', region })
    this.emit({ type: 'remove', id })
  }

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
      const local = node.toLocalPoint(x, y)
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
    const prev = this.coverOf(node)
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
    const next = this.resolveAnchorAt(object, node.x, node.y)
    const samePlace =
      next.from.col === object.anchor.from.col &&
      next.from.row === object.anchor.from.row &&
      next.offsetX === object.anchor.offsetX &&
      next.offsetY === object.anchor.offsetY
    if (samePlace) {
      // 回弹：恢复锚定布局（原地放下，不写模型不残留视觉位移；落点无效时
      // resolveAnchorAt 保持原锚点，同样视为原地）
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

  // ---- 变换会话（8 缩放手柄 + 旋转手柄，univer Transformer 思路） ----

  /**
   * 变换手柄命中（层坐标）：仅对当前选中对象判定（未选中/未命中返回 null），
   * 指针路由以「变换手柄 > 对象拖拽 > 单元格」的优先级消费。
   * 命中沿统一逆变换路径：指针先逆旋转回未旋转帧，再对手柄方块（层坐标口径）判定。
   */
  handleAt(x: number, y: number): FloatTransformHandle | null {
    const node = this.selectedId ? this.nodes.get(this.selectedId) : null
    if (!node) {
      return null
    }
    const local = node.toLocalPoint(x, y)
    if (inHandleRect(local, node.x + node.width / 2, node.y - ROTATE_HANDLE_OFFSET, HANDLE_SIZE)) {
      return 'rotate'
    }
    for (const { name, sx, sy } of SCALE_HANDLES) {
      const [cx, cy] = scaleHandleCenter(sx, sy, node.width, node.height)
      if (inHandleRect(local, node.x + cx, node.y + cy, HANDLE_SIZE)) {
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
   * 开启变换会话（pointerdown 命中选中对象的手柄后由指针路由调用）；只读不启用变换
   * （可选中不可改，返回 false），无选中对象同样拒绝。
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
      const cx = node.x + node.width / 2
      const cy = node.y + node.height / 2
      this.transform = {
        mode: 'rotate',
        id: node.object.id,
        startX: x,
        startY: y,
        moved: false,
        centerX: cx,
        centerY: cy,
        startAngle: Math.atan2(y - cy, x - cx),
        rotation0: node.rotation,
      }
      return true
    }
    const def = SCALE_HANDLES.find((item) => item.name === handle)
    if (!def) {
      return false
    }
    // 对侧锚点（层坐标）：缩放期间保持不动的固定点
    const au = def.sx > 0 ? 0 : def.sx < 0 ? 1 : 0.5
    const av = def.sy > 0 ? 0 : def.sy < 0 ? 1 : 0.5
    const rad = toRad(node.rotation)
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const ax = au * node.width - node.width / 2
    const ay = av * node.height - node.height / 2
    this.transform = {
      mode: 'scale',
      id: node.object.id,
      handle,
      startX: x,
      startY: y,
      moved: false,
      rotation: node.rotation,
      width0: node.width,
      height0: node.height,
      anchorX: node.x + node.width / 2 + ax * cos - ay * sin,
      anchorY: node.y + node.height / 2 + ax * sin + ay * cos,
      sx: def.sx,
      sy: def.sy,
    }
    return true
  }

  /**
   * 变换跟随：位移超阈值后生效（与拖拽移动同一阈值语义），只改渲染态（尺寸/位置/旋转），
   * 不提交事件。缩放：指针位移先逆旋转到对象坐标系，对侧锚点保持不动；Shift 拖角等比
   * （keepRatio，取两轴缩放比大者）。旋转：角度 = 原角 + 指针方位角差值（atan2），
   * Shift 吸附 15° 步进，结果归一化 0–360。
   */
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
      const angle = Math.atan2(y - session.centerY, x - session.centerX)
      let deg = session.rotation0 + ((angle - session.startAngle) * 180) / Math.PI
      if (shiftKey) {
        deg = Math.round(deg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG
      }
      // 量化到 0.01°（视觉无感），吸收 atan2 浮点尘、让提交载荷可精确断言
      node.rotation = normalizeDeg(Math.round(deg * 100) / 100)
    } else {
      const dxTotal = x - session.startX
      const dyTotal = y - session.startY
      const rad = toRad(session.rotation)
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      // 指针位移逆旋转到对象坐标系（旋转角在缩放会话期间恒定）
      const dx = dxTotal * cos + dyTotal * sin
      const dy = -dxTotal * sin + dyTotal * cos
      let width = session.width0 + session.sx * dx
      let height = session.height0 + session.sy * dy
      if (shiftKey && session.sx !== 0 && session.sy !== 0) {
        // Shift 拖角等比：按两轴缩放比大者统一（对齐主流编辑器 keepRatio 口径）
        const k = Math.max(width / session.width0, height / session.height0)
        width = session.width0 * k
        height = session.height0 * k
      }
      width = Math.max(MIN_TRANSFORM_SIZE, Math.round(width))
      height = Math.max(MIN_TRANSFORM_SIZE, Math.round(height))
      // 新中心 = 固定锚点 − R(θ)·(锚点相对新中心的局部向量)；左上角随之定
      const au = session.sx > 0 ? 0 : session.sx < 0 ? 1 : 0.5
      const av = session.sy > 0 ? 0 : session.sy < 0 ? 1 : 0.5
      const ax = au * width - width / 2
      const ay = av * height - height / 2
      const cx = session.anchorX - (ax * cos - ay * sin)
      const cy = session.anchorY - (ax * sin + ay * cos)
      node.width = width
      node.height = height
      node.x = cx - width / 2
      node.y = cy - height / 2
    }
    this.invalidateNode(node, prev)
  }

  /**
   * 结束变换（pointerup 由指针路由调用）：未成拖拽的点按到此为止；成拖拽的按对象
   * 视觉状态反查新锚点（与拖拽移动同一口径，反查无效保持原锚点），抛 onTransformEnd
   * `{ id, anchor, size, rotation }` 由宿主写回模型——拖拽过程只改了渲染态，宿主
   * 写回（update）后模型与展示对齐；宿主不写回时下次锚定重排会回弹到模型态。
   */
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
    const event: FloatTransformEndEvent = {
      id: session.id,
      anchor: this.resolveAnchorAt(node.object, node.x, node.y),
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
    this.transform = null
    this.selectedId = null
    this.container.removeFromParent()
    this.nodes.clear()
    this.listeners.clear()
    this.dragEndListeners.clear()
    this.transformEndListeners.clear()
  }

  private removeIfExists(id: string): void {
    if (this.nodes.has(id)) {
      this.remove(id)
    }
  }

  /**
   * 按层坐标位置（对象视觉左上角）反查锚点：from 平移到落点格，落点余量写偏移
   * （负值 clamp 0），to 随 delta 平移保持跨度；落点反查无效（无 cellAtPoint 或行列头带）
   * 返回原锚点。拖拽结束与变换结束共用同一口径。
   */
  private resolveAnchorAt(object: FloatObject, x: number, y: number): FloatObject['anchor'] {
    const hit = this.geometry.cellAtPoint?.(x, y) ?? null
    if (!hit) {
      return object.anchor
    }
    const origin = this.geometry.cellOrigin(hit.col, hit.row)
    const dCol = hit.col - object.anchor.from.col
    const dRow = hit.row - object.anchor.from.row
    return {
      from: { col: hit.col, row: hit.row },
      to: { col: object.anchor.to.col + dCol, row: object.anchor.to.row + dRow },
      offsetX: Math.max(0, Math.round(x - origin.x)),
      offsetY: Math.max(0, Math.round(y - origin.y)),
    }
  }

  /** 节点绘制覆盖（层坐标）：旋转 AABB + 选中态外扩（失效区域口径） */
  private coverOf(node: FloatObjectNode): Region {
    const cover = rotatedLocalCover(node.width, node.height, node.rotation)
    return {
      x: node.x + cover.x,
      y: node.y + cover.y,
      width: cover.width,
      height: cover.height,
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

  /** 节点区域定向失效（旋转 AABB + 选中态外扩）；prevRegion 给出时成对提交（双区域） */
  private invalidateNode(node: FloatObjectNode, prevRegion?: Region): void {
    const pad = node.pad()
    const region = inflateRegion(this.coverOf(node), pad)
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
    node.rotation = node.object.rotation ?? 0
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
      this.invalidateNode(node)
    })
  }

  private emit(change: FloatObjectChange): void {
    for (const listener of this.listeners) {
      listener(change)
    }
  }
}
