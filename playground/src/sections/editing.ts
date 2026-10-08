// 编辑演示区：内置 SheetModel 坐标模型驱动文本编辑闭环——
// 可编列（含多行列）、格级 resolveEditable 禁编对照格、无 editor 声明的纯展示列（双击无反应）。
// startEdit/commitEdit/cancelEdit API 按钮与提交状态行的用户可见控件由 EditingPage 承担；
// 冒烟直接驱动本模块返回的 api 与 status 句柄断言（页面按钮与冒烟共用同一实现）。

import { EditorRegistry, SheetModel, type CellChangeEvent } from '@infinitable/core'

import { mountTable, type DemoMount } from '../mount'

/** 格级禁编对照格：所在列可编，但 resolveEditable 对它返回 false */
export const DISABLED_CELL = { col: 0, row: 2 } as const

/** 纯展示列（无 editor 声明，双击无反应） */
export const DISPLAY_COL = 2

/** 提交状态文本（冒烟状态句柄与 EditingPage 状态展示共用同一口径） */
export function formatCommitStatus(change: CellChangeEvent): string {
  return `已提交 (${change.col},${change.row})：${String(change.oldValue)} → ${String(change.newValue)}`
}

/** 最近一次提交 / API 动作的回执文本（冒烟断言消费；页面状态行另有 React state） */
export interface EditingStatus {
  text: string
}

export interface EditingDemo {
  mount: DemoMount
  model: SheetModel
  /** 状态回执：onCellChange 提交事件与 api 动作共同维护 */
  status: EditingStatus
  /** 编程式 API 演示动作：执行并返回状态文本（冒烟与页面按钮共用同一实现） */
  api: {
    /** startEdit(0,3)：返回进入编辑结果 */
    startEdit(): string
    /** commitEdit()：返回 null 表示已提交（回执由 onCellChange 事件接管） */
    commitEdit(): string | null
    /** cancelEdit()：取消当前编辑会话 */
    cancelEdit(): string
  }
}

/** 行 r 的初始值：名称-r / 备注-r / 展示-r */
function initialRow(r: number): unknown[] {
  return [`名称-${r}`, `备注-${r}`, `展示-${r}`]
}

export function mountEditing(root: HTMLElement): EditingDemo {
  const section = document.createElement('section')
  root.appendChild(section)

  const registry = new EditorRegistry()
  registry.registerEditor('text', {})
  const model = new SheetModel(Array.from({ length: 16 }, (_, r) => initialRow(r)))
  const mount = mountTable(section, {
    width: 620,
    height: 220,
    columns: [
      { title: '名称', width: 160, editor: 'text' },
      { title: '备注（多行）', width: 220, editor: 'text', editorMultiline: true },
      { title: '展示列', width: 140 },
    ],
    model,
    editorRegistry: registry,
    resolveEditable: (col, row) => !(col === DISABLED_CELL.col && row === DISABLED_CELL.row),
  })

  const status: EditingStatus = { text: '尚未提交' }
  const api: EditingDemo['api'] = {
    startEdit: () => {
      const text = mount.table.startEdit(0, 3)
        ? 'API startEdit(0,3) → true'
        : 'API startEdit(0,3) → false'
      status.text = text
      return text
    },
    commitEdit: () => {
      if (mount.table.commitEdit()) {
        return null // 提交回执由 onCellChange 事件接管
      }
      const text = 'API commitEdit() → false（无编辑会话）'
      status.text = text
      return text
    },
    cancelEdit: () => {
      mount.table.cancelEdit()
      const text = 'API cancelEdit() → 已取消'
      status.text = text
      return text
    },
  }
  mount.table.onCellChange((change) => {
    status.text = formatCommitStatus(change)
  })

  return { mount, model, status, api }
}
