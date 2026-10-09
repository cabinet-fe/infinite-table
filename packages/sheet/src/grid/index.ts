/**
 * 引擎适配层（SheetGrid）公共入口：深导入通道，底座为本仓 `@infinitable/core`
 * 公共面的 ListTable；引擎侧红线见 docs/plugin-interface-map.md。
 * 主入口 `src/index.ts` 亦具名转出同一公共面（spec 定稿：完整 sheet API 单入口）。
 */
import type { CellRenderer } from '@infinitable/core'

/** CellRenderer 绘制目标（core 公共面未单列该类型，经 CellRenderer 参数派生保持同步） */
export type CellRenderTarget = Parameters<CellRenderer>[0]

export type { CellRenderer } from '@infinitable/core'
export { SheetGrid, type ResolveCellRenderer, type SheetGridOptions } from './sheet-grid'
export type { ResolveCellStyleHook, ResolveDisplayValue } from './grid-model'
export type { SheetGridContextMenuInfo, SheetGridContextMenuKind } from './grid-coords'
export type { SheetGridHeaderOptions } from './grid-header'
export type {
  GridCellEditor,
  GridEditorRect,
  GridEditorSession,
  SheetGridEditorsOptions,
} from './grid-editors'
