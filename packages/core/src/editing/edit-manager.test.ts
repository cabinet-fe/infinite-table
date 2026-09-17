import { describe, expect, it } from 'vitest';

import { EditorRegistry } from '../editor-registry';
import { createFakeDoc, FakeEditorElement, FakeEditorHost } from '../testing/fake-editor-dom';
import type { CellChangeEvent, ColumnDefine } from '../types';
import { EditManager, type EditCommitMove, type EditWriteTarget } from './edit-manager';

interface ManagerHarness {
  manager: EditManager;
  host: FakeEditorHost;
  /** 每次 startEdit 创建的编辑器元素（按创建顺序） */
  created: FakeEditorElement[];
  writes: Array<{ col: number; row: number; value: unknown }>;
  changes: CellChangeEvent[];
  moves: Array<{ col: number; row: number; move: EditCommitMove }>;
  refreshes: Array<{ col: number; row: number }>;
  focusRestores: () => number;
}

function createManager(
  overrides: {
    columns?: ColumnDefine[];
    resolveEditable?: (col: number, row: number) => boolean;
    canWrite?: boolean;
    resolveValue?: (col: number, row: number) => unknown;
    /** 锚定格滚出视口（cellRect 返回 null） */
    offscreen?: boolean;
  } = {},
): ManagerHarness {
  const registry = new EditorRegistry();
  registry.registerEditor('text', {});
  const { doc, created } = createFakeDoc();
  const host = new FakeEditorHost();
  const writes: Array<{ col: number; row: number; value: unknown }> = [];
  const changes: CellChangeEvent[] = [];
  const moves: Array<{ col: number; row: number; move: EditCommitMove }> = [];
  const refreshes: Array<{ col: number; row: number }> = [];
  let focusRestores = 0;
  const writeTarget: EditWriteTarget = {
    canWrite: () => overrides.canWrite ?? true,
    write: (col, row, value) => writes.push({ col, row, value }),
  };
  const manager = new EditManager({
    columns: overrides.columns ?? [{ field: 'name', title: 'Name', editor: 'text' }],
    registry,
    resolveEditable: overrides.resolveEditable,
    writeTarget,
    resolveValue: overrides.resolveValue ?? (() => 'a'),
    cellRect: () => (overrides.offscreen ? null : { x: 148, y: 36, width: 100, height: 32 }),
    refreshCell: (col, row) => refreshes.push({ col, row }),
    emitChange: (change) => changes.push(change),
    moveSelection: (col, row, move) => moves.push({ col, row, move }),
    restoreFocus: () => {
      focusRestores++;
    },
    host,
    doc,
  });
  return {
    manager,
    host,
    created,
    writes,
    changes,
    moves,
    refreshes,
    focusRestores: () => focusRestores,
  };
}

describe('EditManager 编辑生命周期', () => {
  it('可编格 startEdit 打开浮层：初值取基础值口径，会话状态可查询', () => {
    const h = createManager({ resolveValue: () => 42 });
    expect(h.manager.startEdit(0, 0)).toBe(true);
    expect(h.manager.isEditing()).toBe(true);
    expect(h.manager.editingCell()).toEqual({ col: 0, row: 0 });
    const element = h.created[0]!;
    expect(h.host.children).toEqual([element]);
    expect(element.value).toBe('42');
    expect(element.focusCalls).toBe(1);
  });

  it('不可编返回 false 且无浮层：三级判定逐一验证', () => {
    // 第一级：列未声明 editor 且路由未命中
    const noEditor = createManager({ columns: [{ field: 'name', title: 'Name' }] });
    expect(noEditor.manager.startEdit(0, 0)).toBe(false);
    // 第二级：格级 editable 判定为 false
    const notEditable = createManager({ resolveEditable: () => false });
    expect(notEditable.manager.startEdit(0, 0)).toBe(false);
    // 第三级：无回写目标
    const noTarget = createManager({ canWrite: false });
    expect(noTarget.manager.startEdit(0, 0)).toBe(false);
    // 三者均不挂浮层
    expect(noEditor.host.children).toEqual([]);
    expect(notEditable.host.children).toEqual([]);
    expect(noTarget.host.children).toEqual([]);
  });

  it('锚定格滚出视口（cellRect null）不打开浮层', () => {
    const h = createManager({ offscreen: true });
    expect(h.manager.startEdit(0, 0)).toBe(false);
    expect(h.manager.isEditing()).toBe(false);
  });

  it('编辑中同格重复 startEdit 幂等：不重开不丢焦点', () => {
    const h = createManager();
    h.manager.startEdit(0, 0);
    expect(h.manager.startEdit(0, 0)).toBe(true);
    expect(h.host.children).toHaveLength(1);
    expect(h.created).toHaveLength(1);
    expect(h.created[0]!.focusCalls).toBe(1);
    expect(h.manager.isEditing()).toBe(true);
  });

  it('编辑中异格 startEdit：先提交当前会话再开新会话（同一时刻至多一个）', () => {
    const h = createManager({
      columns: [
        { field: 'name', title: 'Name', editor: 'text' },
        { field: 'age', title: 'Age', editor: 'text' },
      ],
    });
    h.manager.startEdit(0, 0);
    h.created[0]!.value = 'b';
    expect(h.manager.startEdit(1, 0)).toBe(true);
    expect(h.writes).toEqual([{ col: 0, row: 0, value: 'b' }]);
    expect(h.changes).toEqual([{ col: 0, row: 0, oldValue: 'a', newValue: 'b' }]);
    expect(h.created).toHaveLength(2);
    expect(h.host.children).toHaveLength(1);
    expect(h.manager.editingCell()).toEqual({ col: 1, row: 0 });
  });

  it('commitEdit 回写、该格刷新、抛事件（oldValue/newValue）并交还焦点', () => {
    const h = createManager();
    h.manager.startEdit(0, 0);
    h.created[0]!.value = 'b';
    expect(h.manager.commitEdit()).toBe(true);
    expect(h.writes).toEqual([{ col: 0, row: 0, value: 'b' }]);
    expect(h.refreshes).toEqual([{ col: 0, row: 0 }]);
    expect(h.changes).toEqual([{ col: 0, row: 0, oldValue: 'a', newValue: 'b' }]);
    expect(h.focusRestores()).toBe(1);
    expect(h.manager.isEditing()).toBe(false);
    expect(h.host.children).toEqual([]);
  });

  it('commitEdit 无会话返回 false；API 提交不带选区移动', () => {
    const h = createManager();
    expect(h.manager.commitEdit()).toBe(false);
    h.manager.startEdit(0, 0);
    h.created[0]!.value = 'b';
    h.manager.commitEdit();
    expect(h.moves).toEqual([]);
  });

  it('Esc 取消：不回写不抛事件，浮层关闭、焦点交还表格', () => {
    const h = createManager();
    h.manager.startEdit(0, 0);
    h.created[0]!.value = 'b';
    h.created[0]!.dispatchKey('Escape');
    expect(h.writes).toEqual([]);
    expect(h.changes).toEqual([]);
    expect(h.manager.isEditing()).toBe(false);
    expect(h.host.children).toEqual([]);
    expect(h.focusRestores()).toBe(1);
  });

  it('Enter 提交并选区下移；Tab 提交并选区右移（编辑器按键语义）', () => {
    const down = createManager();
    down.manager.startEdit(0, 0);
    down.created[0]!.dispatchKey('Enter');
    expect(down.writes).toEqual([{ col: 0, row: 0, value: 'a' }]);
    expect(down.moves).toEqual([{ col: 0, row: 0, move: 'down' }]);
    expect(down.focusRestores()).toBe(1);

    const right = createManager();
    right.manager.startEdit(0, 0);
    right.created[0]!.dispatchKey('Tab');
    expect(right.moves).toEqual([{ col: 0, row: 0, move: 'right' }]);
  });

  it('cancelEdit API 与 Esc 语义一致；dispose 结束会话', () => {
    const h = createManager();
    h.manager.startEdit(0, 0);
    h.created[0]!.value = 'b';
    h.manager.cancelEdit();
    expect(h.writes).toEqual([]);
    expect(h.changes).toEqual([]);
    expect(h.manager.isEditing()).toBe(false);

    h.manager.startEdit(0, 0);
    h.manager.dispose();
    expect(h.manager.isEditing()).toBe(false);
    expect(h.host.children).toEqual([]);
  });

  it('列 editorMultiline 决定多行形态', () => {
    const h = createManager({
      columns: [{ field: 'name', title: 'Name', editor: 'text', editorMultiline: true }],
    });
    h.manager.startEdit(0, 0);
    expect(h.created[0]!.tagName).toBe('textarea');
  });
});
