import { RENDER_PACKAGE_NAME } from '@infinite-table/render';

// 表格主体公共入口：公共 API 显式导出（禁止 export *）
export { ListTable } from './list-table';
export { ScrollManager } from './scroll-manager';
export type { ScrollDelta, ScrollListener, ScrollState } from './scroll-manager';
export { ModelBinding } from './model-binding';
export { CellValuePipeline } from './cell-value';
export type { CellValuePipelineInit } from './cell-value';
export { TextCellNode } from './cell-node';
export type { TextCellNodeInit } from './cell-node';
export { computeColOffsets, computeColWindow, computeRowWindow } from './grid-layout';
export type { WindowRange } from './grid-layout';
export type {
  CellChangeEvent,
  ColumnDefine,
  DataRecord,
  ListTableOptions,
  ResolveDisplayValue,
  TableModel,
} from './types';

export const CORE_PACKAGE_NAME = '@infinite-table/core';

// 依赖边占位：core → render
export const CORE_DEPENDENCY_CHAIN = `${CORE_PACKAGE_NAME} -> ${RENDER_PACKAGE_NAME}`;
