import type { SceneEvent, SceneEventType } from '../events/event-system'
import type { Region, RenderContext } from '../types'

export type SceneEventListener = (event: SceneEvent) => void

export interface SceneNodeInit {
  x?: number
  y?: number
  width?: number
  height?: number
  visible?: boolean
  pickable?: boolean
}

/**
 * 场景树节点：持有局部坐标与尺寸，绘制自身后按序绘制子节点。
 * 事件经 EventSystem 命中后从命中节点沿 parent 链冒泡。
 */
export class SceneNode {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
  /** false 时命中测试穿透本节点（子节点仍可被命中） */
  pickable: boolean
  parent: SceneNode | null = null
  readonly children: SceneNode[] = []
  private readonly listeners = new Map<SceneEventType, Set<SceneEventListener>>()

  constructor(init: SceneNodeInit = {}) {
    this.x = init.x ?? 0
    this.y = init.y ?? 0
    this.width = init.width ?? 0
    this.height = init.height ?? 0
    this.visible = init.visible ?? true
    this.pickable = init.pickable ?? true
  }

  appendChild(child: SceneNode): void {
    if (child.parent) {
      child.parent.removeChild(child)
    }
    child.parent = this
    this.children.push(child)
  }

  removeChild(child: SceneNode): void {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
      child.parent = null
    }
  }

  removeFromParent(): void {
    this.parent?.removeChild(this)
  }

  /** 全局（层）坐标下的包围盒 */
  getGlobalBounds(): Region {
    let x = this.x
    let y = this.y
    let node = this.parent
    while (node) {
      x += node.x
      y += node.y
      node = node.parent
    }
    return { x, y, width: this.width, height: this.height }
  }

  /** 绘制自身内容（不含子节点），ctx 已平移到本节点局部原点；子类覆盖 */
  paint(_ctx: RenderContext): void {}

  /** 订阅场景事件；返回退订函数 */
  on(type: SceneEventType, listener: SceneEventListener): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
    return () => this.off(type, listener)
  }

  off(type: SceneEventType, listener: SceneEventListener): void {
    const set = this.listeners.get(type)
    if (set) {
      set.delete(listener)
      if (set.size === 0) {
        this.listeners.delete(type)
      }
    }
  }

  /** 由事件派发的冒泡路径调用，触发本节点上该类型的监听器 */
  handleEvent(event: SceneEvent): void {
    const set = this.listeners.get(event.type)
    if (set) {
      // Set 迭代对派发期退订是安全的（已删除的元素不会再被访问）
      for (const listener of set) {
        listener(event)
      }
    }
  }
}
