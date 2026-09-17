// FloatObjectLayer（docs/perf-redesign 04 §4）：格上浮动对象（图片/图表）的承载、定位与滚动跟随。
// 浮动对象不进 cell 数据流，持有独立对象树（宿主层 root 下的一个容器子树，最后挂载 = 层内最顶）；
// 锚点（from 格 + 像素偏移 → to 格）经 FloatGeometry 换算层坐标，滚动/结构变更后 syncPositions 帧级重排。
// 变更以事件抛出（onChange），undo/历史由宿主入库，本层不内置历史栈。

import { SceneNode, type LayerHandle, type RenderContext } from '@infinite-table/render'

import { drawFittedImage, paintImagePlaceholder, type ImageFit } from '../media/draw-image'
import type { ImageService, LoadedImage } from '../media/image-service'
import type { CellRef } from '../types'

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
}

export type FloatObjectChange =
  | { type: 'add'; object: FloatObject }
  | { type: 'remove'; id: string }
  | { type: 'update'; object: FloatObject }

export interface FloatObjectLayerInit {
  /** 承载层（通常 sky：浮动对象在格内容之上） */
  layer: LayerHandle
  geometry: FloatGeometry
  /** 图片浮动对象的加载服务；缺省时图片对象只画占位 */
  imageService?: ImageService
}

class FloatObjectNode extends SceneNode {
  image: LoadedImage | null = null

  constructor(readonly object: FloatObject) {
    super({})
  }

  override paint(ctx: RenderContext): void {
    if (this.image) {
      drawFittedImage(ctx, this.image, this.width, this.height, this.object.fit ?? 'fill')
      return
    }
    paintImagePlaceholder(ctx, this.width, this.height)
  }
}

export class FloatObjectLayer {
  private readonly layer: LayerHandle
  private readonly geometry: FloatGeometry
  private readonly imageService?: ImageService
  private readonly container = new SceneNode({ pickable: false })
  private readonly nodes = new Map<string, FloatObjectNode>()
  private readonly listeners = new Set<(change: FloatObjectChange) => void>()
  private disposed = false

  constructor(init: FloatObjectLayerInit) {
    this.layer = init.layer
    this.geometry = init.geometry
    this.imageService = init.imageService
    // 最后挂载：层内绘制顺序最顶
    this.layer.root.appendChild(this.container)
  }

  get size(): number {
    return this.nodes.size
  }

  add(object: FloatObject): void {
    this.removeIfExists(object.id)
    const node = new FloatObjectNode(object)
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

  /** 滚动/行列结构变更后的帧级重排：锚点重算 + 整层失效 */
  syncPositions(): void {
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
    this.container.removeFromParent()
    this.nodes.clear()
    this.listeners.clear()
  }

  private removeIfExists(id: string): void {
    if (this.nodes.has(id)) {
      this.remove(id)
    }
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
