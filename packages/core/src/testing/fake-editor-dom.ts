// 测试用编辑器 DOM 假实现：记录监听/挂载/焦点，无真实 DOM 依赖（node 环境可跑）

import type {
  EditorKeyEvent,
  TextEditorDoc,
  TextEditorElement,
  TextEditorElementStyle,
  TextEditorHost,
} from '../editing/text-editor'

export class FakeEditorElement implements TextEditorElement {
  value = ''
  readonly style: TextEditorElementStyle = {
    position: '',
    left: '',
    top: '',
    width: '',
    height: '',
  }
  focusCalls = 0
  readonly listeners = new Map<string, Set<(event: EditorKeyEvent) => void>>()

  constructor(readonly tagName: 'input' | 'textarea') {}

  focus(): void {
    this.focusCalls++
  }

  addEventListener(type: string, listener: (event: EditorKeyEvent) => void): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: (event: EditorKeyEvent) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  /** 派发键盘事件；返回拦截行为记录（preventDefault/stopPropagation 是否被调用） */
  dispatchKey(key: string): { prevented: boolean; stopped: boolean } {
    let prevented = false
    let stopped = false
    for (const listener of this.listeners.get('keydown') ?? []) {
      listener({
        key,
        preventDefault: () => {
          prevented = true
        },
        stopPropagation: () => {
          stopped = true
        },
      })
    }
    return { prevented, stopped }
  }
}

export class FakeEditorHost implements TextEditorHost {
  readonly children: FakeEditorElement[] = []
  focusCalls = 0

  focus(): void {
    this.focusCalls++
  }

  appendChild(child: FakeEditorElement): void {
    this.children.push(child)
  }

  removeChild(child: FakeEditorElement): void {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
    }
  }
}

/** 建假文档：记录创建过的元素，供测试取回编辑器元素 */
export function createFakeDoc(): { doc: TextEditorDoc; created: FakeEditorElement[] } {
  const created: FakeEditorElement[] = []
  const doc: TextEditorDoc = {
    createElement: (tag) => {
      const element = new FakeEditorElement(tag)
      created.push(element)
      return element
    },
  }
  return { doc, created }
}
