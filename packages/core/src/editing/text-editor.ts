// DOM 浮层文本编辑器：单行 input / 多行 textarea，挂载表格容器内、按锚定格视口矩形定位
// （矩形由调用方换算，含表头/行号偏移与冻结区）。DOM 依赖收敛在最小结构接口上，
// 真实 Document/HTMLElement 天然满足，无 DOM 环境可注入假实现。

import type { Region } from '@infinite-table/render';

/** 编辑器键盘事件最小结构（真实 KeyboardEvent 天然满足） */
export interface EditorKeyEvent {
  readonly key?: string;
  preventDefault(): void;
  stopPropagation(): void;
}

/** 编辑器元素定位样式最小结构 */
export interface TextEditorElementStyle {
  position: string;
  left: string;
  top: string;
  width: string;
  height: string;
}

/** 编辑器元素最小结构（真实 HTMLInputElement/HTMLTextAreaElement 天然满足） */
export interface TextEditorElement {
  value: string;
  readonly style: TextEditorElementStyle;
  focus(): void;
  addEventListener(type: string, listener: (event: EditorKeyEvent) => void): void;
  removeEventListener(type: string, listener: (event: EditorKeyEvent) => void): void;
}

/** 编辑器挂载宿主最小结构（表格容器） */
export interface TextEditorHost {
  appendChild(child: TextEditorElement): unknown;
  removeChild(child: TextEditorElement): unknown;
}

/** 元素创建源最小结构（真实 Document 天然满足） */
export interface TextEditorDoc {
  createElement(tag: 'input' | 'textarea'): TextEditorElement;
}

/** 编辑器键盘语义动作：Esc 取消、Enter 提交并下移、Tab 提交并右移 */
export type TextEditorKeyAction = 'cancel' | 'commitDown' | 'commitRight';

export interface TextEditorInit {
  /** true 走 textarea 多行形态（缺省单行 input） */
  multiline?: boolean;
  /** 元素创建源；缺省取 globalThis.document（无 DOM 环境必须注入） */
  doc?: TextEditorDoc;
}

export interface TextEditor {
  /** 打开浮层：挂载到宿主、按视口矩形定位、赋初值并聚焦 */
  open(host: TextEditorHost, rect: Region, initialValue: string): void;
  /** 当前编辑值（提交口径） */
  getValue(): string;
  /** 关闭浮层：摘除元素、解绑键盘并清空状态；重复调用幂等 */
  close(): void;
  /** 订阅键盘语义动作（Esc/Enter/Tab 已拦截默认行为与冒泡） */
  onKey(handler: (action: TextEditorKeyAction) => void): void;
}

/** 创建文本编辑器实例（每次编辑会话新建一个） */
export function createTextEditor(init: TextEditorInit = {}): TextEditor {
  const doc = init.doc ?? (globalThis as { document?: TextEditorDoc | undefined }).document ?? null;
  if (!doc) {
    throw new Error('createTextEditor 需要 DOM 文档；无 DOM 环境请注入 init.doc');
  }
  const element = doc.createElement(init.multiline ? 'textarea' : 'input');
  let host: TextEditorHost | null = null;
  let opened = false;
  let keyHandler: ((action: TextEditorKeyAction) => void) | null = null;

  const handleKeyDown = (event: EditorKeyEvent): void => {
    const action =
      event.key === 'Escape'
        ? 'cancel'
        : event.key === 'Enter'
          ? 'commitDown'
          : event.key === 'Tab'
            ? 'commitRight'
            : null;
    if (!action) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    keyHandler?.(action);
  };

  return {
    onKey(handler) {
      keyHandler = handler;
    },
    open(hostElement, rect, initialValue) {
      host = hostElement;
      element.style.position = 'absolute';
      element.style.left = `${rect.x}px`;
      element.style.top = `${rect.y}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
      element.value = initialValue;
      if (!opened) {
        host.appendChild(element);
        opened = true;
        element.addEventListener('keydown', handleKeyDown);
      }
      element.focus();
    },
    getValue() {
      return element.value;
    },
    close() {
      element.removeEventListener('keydown', handleKeyDown);
      if (opened && host) {
        host.removeChild(element);
      }
      opened = false;
      host = null;
    },
  };
}
