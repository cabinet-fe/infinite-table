import { describe, expect, it } from 'vitest';

import { normalizeRange, SelectionState, type SelectionSnapshot } from './selection';

describe('SelectionState 拖选与整行整列', () => {
  it('拖选：beginDrag 锚定单格，updateDrag 扩展并同步焦点，支持反向拖拽', () => {
    const selection = new SelectionState();
    const seen: SelectionSnapshot[] = [];
    selection.onChange((snapshot) => seen.push(snapshot));

    selection.beginDrag(2, 3);
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 2, row: 3 }, end: { col: 2, row: 3 } },
    ]);
    expect(selection.snapshot.focus).toEqual({ col: 2, row: 3 });

    selection.updateDrag(4, 5);
    expect(normalizeRange(selection.snapshot.ranges[0]!)).toEqual({
      minCol: 2,
      minRow: 3,
      maxCol: 4,
      maxRow: 5,
    });
    expect(selection.snapshot.focus).toEqual({ col: 4, row: 5 });

    // 反向拖拽：锚点不动，焦点同步到左上角目标
    selection.updateDrag(0, 1);
    expect(selection.snapshot.ranges[0]).toEqual({
      start: { col: 2, row: 3 },
      end: { col: 0, row: 1 },
    });
    expect(normalizeRange(selection.snapshot.ranges[0]!)).toEqual({
      minCol: 0,
      minRow: 1,
      maxCol: 2,
      maxRow: 3,
    });
    expect(selection.snapshot.focus).toEqual({ col: 0, row: 1 });

    selection.endDrag();
    // 拖选结束后 updateDrag 不再生效
    selection.updateDrag(9, 9);
    expect(selection.snapshot.focus).toEqual({ col: 0, row: 1 });
    expect(seen.length).toBe(3);
  });

  it('整行/整列/全选：选区覆盖对应维度，焦点落在首格', () => {
    const selection = new SelectionState();
    selection.selectRow(4, 10);
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 0, row: 4 }, end: { col: 9, row: 4 } },
    ]);
    expect(selection.snapshot.focus).toEqual({ col: 0, row: 4 });

    selection.selectCol(2, 100);
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 2, row: 0 }, end: { col: 2, row: 99 } },
    ]);
    expect(selection.snapshot.focus).toEqual({ col: 2, row: 0 });

    selection.selectAll(10, 100);
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 9, row: 99 } },
    ]);
  });

  it('shift 扩展：以锚点扩展到目标格，焦点同步到最新扩展目标（选区修正补丁行为）', () => {
    const selection = new SelectionState();
    selection.selectCell(2, 2);
    selection.selectCell(5, 6, true);
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 2, row: 2 }, end: { col: 5, row: 6 } },
    ]);
    expect(selection.snapshot.focus).toEqual({ col: 5, row: 6 });

    // 继续 shift 扩展：锚点保持，焦点跟随新目标
    selection.selectCell(1, 0, true);
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 2, row: 2 }, end: { col: 1, row: 0 } },
    ]);
    expect(selection.snapshot.focus).toEqual({ col: 1, row: 0 });
  });

  it('clear 清空选区并广播一次', () => {
    const selection = new SelectionState();
    const seen: SelectionSnapshot[] = [];
    selection.onChange((snapshot) => seen.push(snapshot));
    selection.selectCell(1, 1);
    selection.clear();
    expect(selection.snapshot.ranges).toEqual([]);
    expect(selection.snapshot.focus).toBeNull();
    expect(seen).toHaveLength(2);
    // 空选区重复 clear 不再广播
    selection.clear();
    expect(seen).toHaveLength(2);
  });
});

describe('SelectionState 回驱防递归', () => {
  it('外部回写 applyExternal：应用但不广播，订阅方回写不回环', () => {
    const selection = new SelectionState();
    let broadcasts = 0;
    // 外部模型：订阅选区变更并回写（回驱），若不防递归将无限回环
    selection.onChange((snapshot) => {
      broadcasts++;
      selection.applyExternal(snapshot);
    });
    selection.selectCell(1, 1);
    expect(broadcasts).toBe(1);
    expect(selection.snapshot.focus).toEqual({ col: 1, row: 1 });
  });

  it('监听内重入选中：嵌套广播被吞掉，只广播最外一次', () => {
    const selection = new SelectionState();
    const seen: SelectionSnapshot[] = [];
    let reentered = false;
    selection.onChange(() => {
      seen.push(selection.snapshot);
      if (!reentered) {
        reentered = true;
        // 监听内重入选中：不应触发嵌套广播
        selection.selectCell(9, 9);
      }
    });
    selection.selectCell(1, 1);
    expect(seen).toHaveLength(1);
    expect(selection.snapshot.focus).toEqual({ col: 9, row: 9 });
  });
});
