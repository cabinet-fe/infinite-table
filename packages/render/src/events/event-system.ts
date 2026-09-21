import { hitTest } from '../scene/hit-test'
import type { SceneNode } from '../scene/scene-node'

export type SceneEventType =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  /** 预留事件：当前无场景级订阅方，滚轮由宿主直连容器接线 scrollBy（对齐 6.8 预留面口径） */
  | 'wheel'
  | 'keydown'
  | 'keyup'
  | 'contextmenu'
  | 'touchstart'
  | 'touchmove'
  | 'touchend'
  | 'touchcancel'

/** 触摸点最小结构 */
export interface TouchPointLike {
  clientX?: number
  clientY?: number
}

/** DOM 事件的最小结构（指针/滚轮/键盘/触摸字段的并集，均为可选） */
export interface DomEventLike {
  clientX?: number
  clientY?: number
  deltaX?: number
  deltaY?: number
  key?: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  /** 阻止默认行为（如 contextmenu 的浏览器原生菜单）；合成事件可缺省 */
  preventDefault?(): void
  /** 触摸事件的触点列表（取第一个触点归一化坐标） */
  changedTouches?: ArrayLike<TouchPointLike>
}

/** 归一化后的场景事件 */
export interface SceneEvent {
  readonly type: SceneEventType
  /** 命中节点；键盘事件不命中，为 null */
  readonly target: SceneNode | null
  /** 层坐标（CSS 像素）；键盘事件为 0 */
  readonly x: number
  readonly y: number
  readonly deltaX: number
  readonly deltaY: number
  readonly key: string | undefined
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly originalEvent: DomEventLike
}

export type DomListener = (event: DomEventLike) => void

/** 事件源最小结构（真实 HTMLElement 天然满足） */
export interface EventTargetLike {
  addEventListener(type: string, listener: DomListener): void
  removeEventListener(type: string, listener: DomListener): void
  getBoundingClientRect?(): { left: number; top: number }
}

const EVENT_TYPES: readonly SceneEventType[] = [
  'pointerdown',
  'pointermove',
  'pointerup',
  // 预留事件：无场景级订阅方，仍参与归一化派发（每次 wheel 执行一次跨层命中后无人消费）
  'wheel',
  'keydown',
  'keyup',
  'contextmenu',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
]

const TOUCH_TYPES: readonly SceneEventType[] = [
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
]

/**
 * 事件系统：把 DOM 指针/滚轮/键盘事件归一化为场景坐标，
 * 自顶向下跨层命中测试后，从命中节点沿 parent 链冒泡派发；
 * 键盘事件不命中，从最顶层场景根开始派发。
 */
export class EventSystem {
  private readonly domListeners = new Map<SceneEventType, DomListener>()
  /** 层根缓存：高频派发路径复用同一数组，层集合变化时由宿主通知失效 */
  private rootsCache: readonly SceneNode[] | null = null

  /**
   * @param rootsTopDown 自顶向下（sky → media → body → ground）返回各层场景根；
   *   结果经缓存复用，层集合变化时宿主须调 invalidateRoots 失效
   */
  constructor(
    private readonly target: EventTargetLike,
    private readonly rootsTopDown: () => readonly SceneNode[],
  ) {
    for (const type of EVENT_TYPES) {
      const listener: DomListener = (event) => this.dispatch(type, event)
      this.domListeners.set(type, listener)
      this.target.addEventListener(type, listener)
    }
  }

  /** 层集合变化（建层/移除层）时由 RenderHost 通知：下一次派发重建层根缓存 */
  invalidateRoots(): void {
    this.rootsCache = null
  }

  private dispatch(type: SceneEventType, domEvent: DomEventLike): void {
    const roots = (this.rootsCache ??= this.rootsTopDown())
    const isKeyboard = type === 'keydown' || type === 'keyup'
    const touch = TOUCH_TYPES.includes(type) ? domEvent.changedTouches?.[0] : undefined
    let x = 0
    let y = 0
    let target: SceneNode | null = null
    if (!isKeyboard) {
      const rect = this.target.getBoundingClientRect?.()
      x = (touch?.clientX ?? domEvent.clientX ?? 0) - (rect?.left ?? 0)
      y = (touch?.clientY ?? domEvent.clientY ?? 0) - (rect?.top ?? 0)
      for (const root of roots) {
        target = hitTest(root, x, y)
        if (target) {
          break
        }
      }
    }
    const event: SceneEvent = {
      type,
      target,
      x,
      y,
      deltaX: domEvent.deltaX ?? 0,
      deltaY: domEvent.deltaY ?? 0,
      key: domEvent.key,
      shiftKey: domEvent.shiftKey ?? false,
      ctrlKey: domEvent.ctrlKey ?? false,
      metaKey: domEvent.metaKey ?? false,
      originalEvent: domEvent,
    }
    // 冒泡：命中节点 → 父链直至层根；未命中/键盘事件从最顶层根开始
    let node: SceneNode | null = target ?? roots[0] ?? null
    while (node) {
      node.handleEvent(event)
      node = node.parent
    }
  }

  dispose(): void {
    for (const [type, listener] of this.domListeners) {
      this.target.removeEventListener(type, listener)
    }
    this.domListeners.clear()
  }
}
