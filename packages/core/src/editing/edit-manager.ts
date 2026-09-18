// 编辑状态唯一源：进入（可编三级判定）、提交回写、取消的完整生命周期。
// 同一时刻至多一个编辑会话；初值取基础值（resolveValue 口径，未过 resolveDisplayValue）；
// 提交经回写目标落数据源（records 改 field / model 经 ModelBinding.writeBack），
// 随后局部刷新该格并抛 onCellChange（col/row/oldValue/newValue）。
// 编辑中订阅滚动帧：浮层逐帧对齐锚定格最新视口矩形，锚定格滚出视口按 Enter 语义自动提交。

import type { Region } from '@infinite-table/render'

import type { EditorRegistry } from '../editor-registry'
import type { ScrollState } from '../scroll-manager'
import type { CellChangeEvent, CellRef, ColumnDefine, EditEndEvent, EditStartEvent } from '../types'
import {
  createTextEditor,
  type TextEditor,
  type TextEditorDoc,
  type TextEditorHost,
  type TextEditorKeyAction,
} from './text-editor'

/** 回写目标：数据供给形态（records / model）的格级可写判定与提交写值 */
export interface EditWriteTarget {
  /** 该格有无回写目标（records 列有 field，或 model 形态） */
  canWrite(col: number, row: number): boolean
  /** 写回数据源 */
  write(col: number, row: number, value: unknown): void
}

/** 提交后的选区移动方向：Enter 下移、Tab 右移 */
export type EditCommitMove = 'down' | 'right'

export interface EditManagerInit {
  /** 列定义（editor 声明、editorMultiline 形态来源） */
  columns: readonly ColumnDefine[]
  /** 编辑器注册表：可编第一级判定（列声明 editor 或格级路由命中） */
  registry: EditorRegistry
  /** 格级可编判定（第二级；缺省全部可编） */
  resolveEditable?: (col: number, row: number) => boolean
  /** 回写目标（第三级判定 + 提交写值） */
  writeTarget: EditWriteTarget
  /** 编辑初值口径：基础值（未过 resolveDisplayValue） */
  resolveValue: (col: number, row: number) => unknown
  /** 锚定格视口矩形（含表头/行号偏移与冻结区）；滚出视口为 null */
  cellRect: (col: number, row: number) => Region | null
  /** 提交后该格局部刷新（cell 级失效） */
  refreshCell: (col: number, row: number) => void
  /** 提交后抛编辑变更事件（oldValue/newValue） */
  emitChange: (change: CellChangeEvent) => void
  /** 会话真正打开后通知（可编判定通过且浮层已开；同格幂等重入不重复通知） */
  emitStart?: (event: EditStartEvent) => void
  /** 会话结束通知：提交路径在 emitChange 之后抛出（committed=true 带终值），取消 committed=false */
  emitEnd?: (event: EditEndEvent) => void
  /** 提交后选区移动（复用键盘导航的选区移动能力） */
  moveSelection: (col: number, row: number, move: EditCommitMove) => void
  /** 会话结束（提交/取消）后焦点交还表格 */
  restoreFocus: () => void
  /** 编辑器挂载宿主（表格容器）；缺省离屏（不落 DOM，仅保留会话状态） */
  host?: TextEditorHost
  /** 元素创建源；缺省取 globalThis.document（无 DOM 环境必须注入） */
  doc?: TextEditorDoc
  /** 订阅滚动帧（复用 ListTable.onScrollFrame）：编辑中逐帧跟随锚定格，滚出视口自动提交 */
  subscribeScrollFrame?: (listener: (state: ScrollState) => void) => () => void
}

/** 离屏宿主：编辑器元素不落 DOM（测试/无容器注入时） */
const detachedHost: TextEditorHost = {
  appendChild() {},
  removeChild() {},
}

/** 单个编辑会话：锚定格 + 编辑初值（oldValue 口径）+ 编辑器实例 */
interface EditSession {
  col: number
  row: number
  oldValue: unknown
  editor: TextEditor
}

export class EditManager {
  private session: EditSession | null = null
  private readonly host: TextEditorHost
  /** 滚动帧退订（dispose 时解绑） */
  private unsubscribeScrollFrame: (() => void) | null = null

  constructor(private readonly init: EditManagerInit) {
    this.host = init.host ?? detachedHost
    this.unsubscribeScrollFrame = init.subscribeScrollFrame?.(() => this.followAnchor()) ?? null
  }

  /** 当前是否处于编辑会话中 */
  isEditing(): boolean {
    return this.session !== null
  }

  /** 当前编辑的格；无会话时为 null */
  editingCell(): CellRef | null {
    return this.session ? { col: this.session.col, row: this.session.row } : null
  }

  /** 可编三级判定：editor 声明/路由 ∧ 格级 editable ∧ 有回写目标 */
  isEditable(col: number, row: number): boolean {
    if (!this.init.registry.resolveEditor(this.init.columns, col, row)) {
      return false
    }
    if (this.init.resolveEditable && !this.init.resolveEditable(col, row)) {
      return false
    }
    return this.init.writeTarget.canWrite(col, row)
  }

  /**
   * 进入编辑：可编判定通过才打开浮层（初值为基础值）；不可编返回 false。
   * 已有会话时同格幂等（不重开不丢焦点），异格先提交当前会话再开新会话。
   */
  startEdit(col: number, row: number): boolean {
    if (this.session) {
      if (this.session.col === col && this.session.row === row) {
        return true
      }
      this.commitEdit()
    }
    if (!this.isEditable(col, row)) {
      return false
    }
    const rect = this.init.cellRect(col, row)
    if (!rect) {
      return false
    }
    const oldValue = this.init.resolveValue(col, row)
    const editor = createTextEditor({
      multiline: this.init.columns[col]?.editorMultiline ?? false,
      doc: this.init.doc,
    })
    editor.onKey((action) => this.onEditorKey(action))
    editor.open(this.host, rect, oldValue == null ? '' : String(oldValue))
    this.session = { col, row, oldValue, editor }
    this.init.emitStart?.({ col, row, initialValue: oldValue })
    return true
  }

  /**
   * 提交：值写回数据源（回写目标）、该格局部失效、抛 onCellChange；
   * move 给定时（Enter/Tab）随后移动选区。无会话返回 false。
   */
  commitEdit(move?: EditCommitMove): boolean {
    const session = this.session
    if (!session) {
      return false
    }
    this.session = null
    const newValue = session.editor.getValue()
    session.editor.close()
    this.init.writeTarget.write(session.col, session.row, newValue)
    this.init.refreshCell(session.col, session.row)
    this.init.emitChange({
      col: session.col,
      row: session.row,
      oldValue: session.oldValue,
      newValue,
    })
    this.init.emitEnd?.({
      col: session.col,
      row: session.row,
      initialValue: session.oldValue,
      finalValue: newValue,
      committed: true,
    })
    if (move) {
      this.init.moveSelection(session.col, session.row, move)
    }
    this.init.restoreFocus()
    return true
  }

  /** 取消：不回写不抛事件，浮层关闭、焦点交还表格；无会话为空操作 */
  cancelEdit(): void {
    const session = this.session
    if (!session) {
      return
    }
    this.session = null
    session.editor.close()
    this.init.emitEnd?.({
      col: session.col,
      row: session.row,
      initialValue: session.oldValue,
      committed: false,
    })
    this.init.restoreFocus()
  }

  /** 销毁：退订滚动帧并结束当前会话（如有） */
  dispose(): void {
    this.unsubscribeScrollFrame?.()
    this.unsubscribeScrollFrame = null
    this.cancelEdit()
  }

  /**
   * 滚动帧：编辑中浮层逐帧对齐锚定格最新视口矩形；
   * 锚定格滚出视口（cellRect null）按 Enter 语义自动提交并关闭（不丢编辑内容）。
   */
  private followAnchor(): void {
    const session = this.session
    if (!session) {
      return
    }
    const rect = this.init.cellRect(session.col, session.row)
    if (!rect) {
      this.commitEdit('down')
      return
    }
    session.editor.moveTo(rect)
  }

  private onEditorKey(action: TextEditorKeyAction): void {
    if (action === 'cancel') {
      this.cancelEdit()
      return
    }
    this.commitEdit(action === 'commitDown' ? 'down' : 'right')
  }
}
