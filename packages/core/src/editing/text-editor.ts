// DOM 浮层文本编辑器：单行 input / 多行 textarea，挂载表格容器内、按锚定格视口矩形定位
// （矩形由调用方换算，含表头/行号偏移与冻结区）。DOM 依赖收敛在最小结构接口上，
// 真实 Document/HTMLElement 天然满足，无 DOM 环境可注入假实现。

import type { Region } from '@infinite-table/render'

/** 编辑器键盘事件最小结构（真实 KeyboardEvent 天然满足） */
export interface EditorKeyEvent {
  readonly key?: string
  preventDefault(): void
  stopPropagation(): void
}

/** 编辑器元素定位样式最小结构 */
export interface TextEditorElementStyle {
  position: string
  left: string
  top: string
  width: string
  height: string
  /** 基础视觉一次性写入（真实 CSSStyleDeclaration 天然支持；假实现可缺省忽略） */
  cssText?: string
  /** focus/blur 边框色切换（真实 CSSStyleDeclaration 天然支持） */
  borderColor?: string
}

/** 编辑器元素最小结构（真实 HTMLInputElement/HTMLTextAreaElement 天然满足） */
export interface TextEditorElement {
  value: string
  readonly style: TextEditorElementStyle
  focus(): void
  addEventListener(type: string, listener: (event: EditorKeyEvent) => void): void
  removeEventListener(type: string, listener: (event: EditorKeyEvent) => void): void
}

/** 编辑器挂载宿主最小结构（表格容器） */
export interface TextEditorHost {
  appendChild(child: TextEditorElement): unknown
  removeChild(child: TextEditorElement): unknown
}

/** 元素创建源最小结构（真实 Document 天然满足） */
export interface TextEditorDoc {
  createElement(tag: 'input' | 'textarea'): TextEditorElement
}

/** 编辑器键盘语义动作：Esc 取消、Enter 提交并下移、Tab 提交并右移 */
export type TextEditorKeyAction = 'cancel' | 'commitDown' | 'commitRight'

export interface TextEditorInit {
  /** true 走 textarea 多行形态（缺省单行 input） */
  multiline?: boolean
  /** 编辑字体（CSS font 串，随锚定格样式推导）；缺省不设（用浏览器缺省） */
  font?: string
  /** 元素创建源；缺省取 globalThis.document（无 DOM 环境必须注入） */
  doc?: TextEditorDoc
}

export interface TextEditor {
  /** 打开浮层：挂载到宿主、按视口矩形定位、赋初值并聚焦 */
  open(host: TextEditorHost, rect: Region, initialValue: string): void
  /** 滚动跟随：按锚定格最新视口矩形重新定位（不重挂载、不抢焦点、不改值） */
  moveTo(rect: Region): void
  /** 当前编辑值（提交口径） */
  getValue(): string
  /** 关闭浮层：摘除元素、解绑键盘并清空状态；重复调用幂等 */
  close(): void
  /** 订阅键盘语义动作（Esc/Enter/Tab 已拦截默认行为与冒泡） */
  onKey(handler: (action: TextEditorKeyAction) => void): void
}

/** 编辑浮层边框宽（对齐 VTable InputEditor：2px 边框骑在格缘上，内外各半） */
const EDITOR_BORDER_WIDTH = 2
/** 编辑浮层失焦/聚焦边框色（对齐 VTable InputEditor 硬编码值） */
const EDITOR_BORDER_COLOR = '#d9d9d9'
const EDITOR_BORDER_COLOR_FOCUS = '#4A90E2'

/** 创建文本编辑器实例（每次编辑会话新建一个） */
export function createTextEditor(init: TextEditorInit = {}): TextEditor {
  const doc = init.doc ?? (globalThis as { document?: TextEditorDoc | undefined }).document ?? null
  if (!doc) {
    throw new Error('createTextEditor 需要 DOM 文档；无 DOM 环境请注入 init.doc')
  }
  const element = doc.createElement(init.multiline ? 'textarea' : 'input')
  // 基础视觉一次性写入（先于 open 的定位赋值，避免被覆盖）
  element.style.cssText =
    'margin:0;padding:4px;box-sizing:border-box;background-color:#FFFFFF;' +
    `border:${EDITOR_BORDER_WIDTH}px solid ${EDITOR_BORDER_COLOR};outline:none;` +
    (init.font ? `font:${init.font};` : '')
  element.addEventListener('focus', () => {
    element.style.borderColor = EDITOR_BORDER_COLOR_FOCUS
  })
  element.addEventListener('blur', () => {
    element.style.borderColor = EDITOR_BORDER_COLOR
  })
  let host: TextEditorHost | null = null
  let opened = false
  let keyHandler: ((action: TextEditorKeyAction) => void) | null = null

  const handleKeyDown = (event: EditorKeyEvent): void => {
    const action =
      event.key === 'Escape'
        ? 'cancel'
        : event.key === 'Enter'
          ? 'commitDown'
          : event.key === 'Tab'
            ? 'commitRight'
            : null
    if (!action) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    keyHandler?.(action)
  }

  const moveTo = (rect: Region): void => {
    // 边框骑格缘：矩形向外扩半边框宽，2px 边框在格缘内外各占 1px
    const half = EDITOR_BORDER_WIDTH / 2
    element.style.left = `${rect.x - half}px`
    element.style.top = `${rect.y - half}px`
    element.style.width = `${rect.width + EDITOR_BORDER_WIDTH}px`
    element.style.height = `${rect.height + EDITOR_BORDER_WIDTH}px`
  }

  return {
    onKey(handler) {
      keyHandler = handler
    },
    open(hostElement, rect, initialValue) {
      host = hostElement
      element.style.position = 'absolute'
      moveTo(rect)
      element.value = initialValue
      if (!opened) {
        host.appendChild(element)
        opened = true
        element.addEventListener('keydown', handleKeyDown)
      }
      element.focus()
    },
    moveTo,
    getValue() {
      return element.value
    },
    close() {
      element.removeEventListener('keydown', handleKeyDown)
      if (opened && host) {
        host.removeChild(element)
      }
      opened = false
      host = null
    },
  }
}
