// '@veltra/sheet-core/grid' 的 infinite-table 引擎替换实现（经 vite alias 整模块接管）。
// 导出面与 ultra-ui grid/index.ts 对齐：SheetGrid + 上下文菜单/渲染 hook 类型 + CustomLayout。
export {
  CustomLayout,
  type CellLayoutRect,
  type CellLayoutText,
  type ICustomLayoutObj,
} from './cell-layout'
export {
  SheetGrid,
  type ResolveCellRenderer,
  type ResolveCellStyleHook,
  type ResolveDisplayValue,
  type SheetGridContextMenuInfo,
  type SheetGridContextMenuKind,
  type SheetGridOptions,
} from './sheet-grid'
