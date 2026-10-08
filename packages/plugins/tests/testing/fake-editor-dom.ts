// 测试用编辑器 DOM 假实现（对齐 core 包内同名辅助）：记录监听/挂载/焦点，node 环境可跑。
// 仅测试基础设施；src/sheet 源码面仍只依赖 core 公开入口，编辑器契约类型经 core 包内
// 深路径取（不占公共入口，见 packages/core/src/index.ts 导出判据）。

import type {
  EditorKeyEvent,
  TextEditorDoc,
  TextEditorElement,
  TextEditorElementStyle,
  TextEditorHost,
} from '../../../core/src/editing/text-editor'

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
