// 编辑器注册表与格级路由（预留）：可注册即通过，具体编辑器实现由下游提供。

import type { ColumnDefine } from './types';

/**
 * 编辑器接口（预留）：MVP 不内置具体编辑器，
 * 下游实现该接口并经 EditorRegistry 注册后即可被格级路由解析到。
 */
export interface CellEditor {
  /** 编辑器标识（可选，供实现自检/调试；注册名由注册表管理） */
  readonly name?: string;
}

/** 格级路由 hook：按格返回编辑器注册名，优先于列定义 editor */
export type EditorRoute = (col: number, row: number) => string | undefined;

export class EditorRegistry {
  private readonly editors = new Map<string, CellEditor>();

  constructor(private readonly route?: EditorRoute) {}

  registerEditor(name: string, editor: CellEditor): void {
    this.editors.set(name, editor);
  }

  getEditor(name: string): CellEditor | undefined {
    return this.editors.get(name);
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
    const name = this.route?.(col, row) ?? columns[col]?.editor;
    if (name === undefined) {
      return undefined;
    }
    return this.editors.get(name);
  }
}
