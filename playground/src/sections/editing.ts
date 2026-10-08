// 编辑演示区：内置 SheetModel 坐标模型驱动文本编辑闭环——
// 可编列（含多行列）、格级 resolveEditable 禁编对照格、无 editor 声明的纯展示列（双击无反应）。
// startEdit/commitEdit/cancelEdit API 按钮与提交状态行的用户可见控件由 EditingPage 承担；
// ?smoke=1 裸挂路径无页面，区内自建命令式等价物供 checkSmoke 断言驱动。

import { EditorRegistry, SheetModel, type CellChangeEvent } from '@infinitable/core'

import {
  addButton,
  addStatus,
  createSection,
  isSmokeMode,
  mountTable,
  type DemoMount,
} from '../mount'

/** 格级禁编对照格：所在列可编，但 resolveEditable 对它返回 false */
export const DISABLED_CELL = { col: 0, row: 2 } as const

/** 纯展示列（无 editor 声明，双击无反应） */
export const DISPLAY_COL = 2

/** 提交状态文本（冒烟状态行与 EditingPage 状态展示共用同一口径） */
export function formatCommitStatus(change: CellChangeEvent): string {
  return `已提交 (${change.col},${change.row})：${String(change.oldValue)} → ${String(change.newValue)}`
}

export interface EditingDemo {
  mount: DemoMount
  model: SheetModel
  /** 提交状态行：文本由本模块维护（单一口径）；页面模式为脱管节点，展示由 EditingPage 承担 */
  status: HTMLElement
  /** 编程式 API 演示动作：执行并返回状态文本（冒烟按钮与页面按钮共用同一实现） */
  api: {
    /** startEdit(0,3)：返回进入编辑结果 */
    startEdit(): string
    /** commitEdit()：返回 null 表示已提交（状态行由 onCellChange 事件接管） */
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
  const section = createSection(
    root,
    '单元格编辑',
    'SheetModel 内存坐标模型：双击进入编辑，Enter 提交下移、Tab 提交右移、Esc 取消；' +
      `编辑中滚动浮层跟随锚定格，滚出视口自动提交。对照：格 (${DISABLED_CELL.col},${DISABLED_CELL.row}) 格级禁编、展示列不可编。`,
  )

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

  // 用户可见控件由 EditingPage 以 shadcn 组件承担；?smoke=1 裸挂路径无页面，
  // checkEditing 直接驱动并断言这里的 API 按钮与状态行，故仅在冒烟模式随区装配。
  const api: EditingDemo['api'] = {
    startEdit: () =>
      mount.table.startEdit(0, 3) ? 'API startEdit(0,3) → true' : 'API startEdit(0,3) → false',
    commitEdit: () => (mount.table.commitEdit() ? null : 'API commitEdit() → false（无编辑会话）'),
    cancelEdit: () => {
      mount.table.cancelEdit()
      return 'API cancelEdit() → 已取消'
    },
  }
  const status = addStatus(section, '尚未提交')
  if (!isSmokeMode()) {
    status.remove()
  } else {
    addButton(section, 'API startEdit(0,3)', () => {
      status.textContent = api.startEdit()
    })
    addButton(section, 'API commitEdit()', () => {
      const text = api.commitEdit()
      if (text !== null) {
        status.textContent = text
      }
    })
    addButton(section, 'API cancelEdit()', () => {
      status.textContent = api.cancelEdit()
    })
  }
  mount.table.onCellChange((change) => {
    status.textContent = formatCommitStatus(change)
  })

  return { mount, model, status, api }
}
