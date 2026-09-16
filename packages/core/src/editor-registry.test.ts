import { describe, expect, it } from 'vitest';

import { EditorRegistry, type CellEditor } from './editor-registry';
import type { ColumnDefine } from './types';

const columns: ColumnDefine[] = [
  { field: 'name', title: 'Name', editor: 'text-editor' },
  { field: 'age', title: 'Age' },
];

describe('编辑器注册表与格级路由', () => {
  it('注册即可按名取回（可注册即通过）', () => {
    const registry = new EditorRegistry();
    const editor: CellEditor = { name: 'text-editor' };
    registry.registerEditor('text-editor', editor);
    expect(registry.getEditor('text-editor')).toBe(editor);
    expect(registry.getEditor('missing')).toBeUndefined();
  });

  it('按列定义 editor 做格级路由', () => {
    const registry = new EditorRegistry();
    const editor: CellEditor = {};
    registry.registerEditor('text-editor', editor);
    expect(registry.resolveEditor(columns, 0, 5)).toBe(editor);
    expect(registry.resolveEditor(columns, 1, 5)).toBeUndefined();
  });

  it('route hook 优先于列定义；未注册名解析为 undefined', () => {
    const routeEditor: CellEditor = {};
    const columnEditor: CellEditor = {};
    const registry = new EditorRegistry((col, row) =>
      col === 0 && row === 0 ? 'route-editor' : undefined,
    );
    registry.registerEditor('route-editor', routeEditor);
    registry.registerEditor('text-editor', columnEditor);
    // (0,0) 命中 route hook，优先于列定义 text-editor
    expect(registry.resolveEditor(columns, 0, 0)).toBe(routeEditor);
    // 其余格回退列定义
    expect(registry.resolveEditor(columns, 0, 1)).toBe(columnEditor);

    const unresolved = new EditorRegistry(() => 'not-registered');
    expect(unresolved.resolveEditor(columns, 0, 0)).toBeUndefined();
  });
});
