// 编辑器注册表与格级路由：可注册即通过，支持原生会话型自定义编辑器（open/close）与内置文本编辑器回退。

import type { Region } from '@infinitable/render'

import type { EditCommitMove } from './editing/edit-manager'
import type { ColumnDefine } from './types'

/**
 * 编辑器会话上下文（原生会话型自定义编辑器用）：
 * 宿主自定义编辑器在 open(session) 中挂载 UI，通过 commit/cancel 结束会话，
 * 通过 onRectChange 随滚动帧同步定位。
 */
export interface CellEditorSession {
  readonly col: number
  readonly row: number
  readonly container: HTMLElement | undefined
  readonly rect: Region
  readonly initialValue: unknown
  readonly font?: string
  readonly multiline?: boolean
  readonly maxLength?: number
  commit(value: unknown, move?: EditCommitMove): void
  cancel(): void
  onRectChange(listener: (rect: Region) => void): void
}

/**
 * 编辑器接口：
 * - 未实现 open 时回退使用引擎内置 DOM 文本编辑器；
 * - 实现 open(session) 时接管编辑浮层生命周期（close 可选清理）。
 */
export interface CellEditor {
  /** 编辑器标识（可选，供实现自检/调试；注册名由注册表管理） */
  readonly name?: string
  open?(session: CellEditorSession): void
  close?(): void
}

/** 格级路由 hook：按格返回编辑器注册名，优先于列定义 editor */
export type EditorRoute = (col: number, row: number) => string | undefined

export class EditorRegistry {
  private readonly editors = new Map<string, CellEditor>()

  constructor(private readonly route?: EditorRoute) {}

  registerEditor(name: string, editor: CellEditor): void {
    this.editors.set(name, editor)
  }

  /**
   * 格级路由：按格解析应使用的编辑器。
   * 路由名先走 route hook，回退列定义 editor；未注册的名字解析为 undefined。
   */
  resolveEditor(
    columns: readonly ColumnDefine[],
    col: number,
    row: number,
  ): CellEditor | undefined {
    const name = this.route?.(col, row) ?? columns[col]?.editor
    if (name === undefined) {
      return undefined
    }
    return this.editors.get(name)
  }
}
