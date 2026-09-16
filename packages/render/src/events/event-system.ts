import { hitTest } from '../scene/hit-test';
import type { SceneNode } from '../scene/scene-node';

export type SceneEventType =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  | 'wheel'
  | 'keydown'
  | 'keyup';

/** DOM 事件的最小结构（指针/滚轮/键盘字段的并集，均为可选） */
export interface DomEventLike {
  clientX?: number;
  clientY?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
}

/** 归一化后的场景事件 */
export interface SceneEvent {
  readonly type: SceneEventType;
  /** 命中节点；键盘事件不命中，为 null */
  readonly target: SceneNode | null;
  /** 层坐标（CSS 像素）；键盘事件为 0 */
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly key: string | undefined;
  readonly originalEvent: DomEventLike;
}

export type DomListener = (event: DomEventLike) => void;

/** 事件源最小结构（真实 HTMLElement 天然满足） */
export interface EventTargetLike {
  addEventListener(type: string, listener: DomListener): void;
  removeEventListener(type: string, listener: DomListener): void;
  getBoundingClientRect?(): { left: number; top: number };
}

const EVENT_TYPES: readonly SceneEventType[] = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'wheel',
  'keydown',
  'keyup',
];

/**
 * 事件系统：把 DOM 指针/滚轮/键盘事件归一化为场景坐标，
 * 自顶向下跨层命中测试后，从命中节点沿 parent 链冒泡派发；
 * 键盘事件不命中，从最顶层场景根开始派发。
 */
export class EventSystem {
  private readonly domListeners = new Map<SceneEventType, DomListener>();

  constructor(
    private readonly target: EventTargetLike,
    /** 自顶向下（sky → media → body → ground）返回各层场景根 */
    private readonly rootsTopDown: () => readonly SceneNode[],
  ) {
    for (const type of EVENT_TYPES) {
      const listener: DomListener = (event) => this.dispatch(type, event);
      this.domListeners.set(type, listener);
      this.target.addEventListener(type, listener);
    }
  }

  private dispatch(type: SceneEventType, domEvent: DomEventLike): void {
    const roots = this.rootsTopDown();
    const isKeyboard = type === 'keydown' || type === 'keyup';
    let x = 0;
    let y = 0;
    let target: SceneNode | null = null;
    if (!isKeyboard) {
      const rect = this.target.getBoundingClientRect?.();
      x = (domEvent.clientX ?? 0) - (rect?.left ?? 0);
      y = (domEvent.clientY ?? 0) - (rect?.top ?? 0);
      for (const root of roots) {
        target = hitTest(root, x, y);
        if (target) {
          break;
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
      originalEvent: domEvent,
    };
    // 冒泡：命中节点 → 父链直至层根；未命中/键盘事件从最顶层根开始
    let node: SceneNode | null = target ?? roots[0] ?? null;
    while (node) {
      node.handleEvent(event);
      node = node.parent;
    }
  }

  dispose(): void {
    for (const [type, listener] of this.domListeners) {
      this.target.removeEventListener(type, listener);
    }
    this.domListeners.clear();
  }
}
