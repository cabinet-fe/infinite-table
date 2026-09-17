// 编辑演示区：内置 SheetModel 坐标模型驱动文本编辑闭环——
// 可编列（含多行列）、格级 resolveEditable 禁编对照格、无 editor 声明的纯展示列（双击无反应），
// 以及 startEdit/commitEdit/cancelEdit API 按钮与 onCellChange 状态行。

import { EditorRegistry, SheetModel } from '@infinite-table/core';

import {
  addButton,
  addStatus,
  createSection,
  mountTable,
  type DemoMount,
} from '../mount';

/** 格级禁编对照格：所在列可编，但 resolveEditable 对它返回 false */
export const DISABLED_CELL = { col: 0, row: 2 } as const;

/** 纯展示列（无 editor 声明，双击无反应） */
export const DISPLAY_COL = 2;

export interface EditingDemo {
  mount: DemoMount;
  model: SheetModel;
  status: HTMLElement;
}

/** 行 r 的初始值：名称-r / 备注-r / 展示-r */
function initialRow(r: number): unknown[] {
  return [`名称-${r}`, `备注-${r}`, `展示-${r}`];
}

export function mountEditing(root: HTMLElement): EditingDemo {
  const section = createSection(
    root,
    '单元格编辑',
    'SheetModel 内存坐标模型：双击进入编辑，Enter 提交下移、Tab 提交右移、Esc 取消；' +
      `编辑中滚动浮层跟随锚定格，滚出视口自动提交。对照：格 (${DISABLED_CELL.col},${DISABLED_CELL.row}) 格级禁编、展示列不可编。`,
  );

  const registry = new EditorRegistry();
  registry.registerEditor('text', {});
  const model = new SheetModel(
    Array.from({ length: 16 }, (_, r) => initialRow(r)),
  );
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
    resolveEditable: (col, row) =>
      !(col === DISABLED_CELL.col && row === DISABLED_CELL.row),
  });

  const status = addStatus(section, '尚未提交');
  mount.table.onCellChange((change) => {
    status.textContent = `已提交 (${change.col},${change.row})：${String(change.oldValue)} → ${String(change.newValue)}`;
  });

  addButton(section, 'API startEdit(0,3)', () => {
    status.textContent = mount.table.startEdit(0, 3)
      ? 'API startEdit(0,3) → true'
      : 'API startEdit(0,3) → false';
  });
  addButton(section, 'API commitEdit()', () => {
    if (!mount.table.commitEdit()) {
      status.textContent = 'API commitEdit() → false（无编辑会话）';
    }
  });
  addButton(section, 'API cancelEdit()', () => {
    mount.table.cancelEdit();
    status.textContent = 'API cancelEdit() → 已取消';
  });

  return { mount, model, status };
}
