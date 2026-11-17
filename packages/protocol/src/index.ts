// @infinitable/protocol 公共入口（唯一；显式导出，禁止 export *）。
//
// 引擎装配协议契约包：纯类型、零运行时代码——中立本体 EngineAssembly、
// 插件契约 EnginePlugin、主题与绘制器槽位词汇、纯网格值类型及可选能力面。

export type {
  EngineAssembly,
  EngineCapabilities,
  EngineFrameStyle,
  EngineScrollbarTokens,
  EngineTheme,
  EngineThemeOverride,
  LayerPainter,
  PainterRegistration,
  PainterSlot,
} from './engine'
export type {
  CellBorder,
  CellBorderEdge,
  CellBorderStyle,
  CellChangeEvent,
  CellPadding,
  CellRange,
  CellStyle,
  CellTextAlign,
  CellTextOverflow,
  CellVerticalAlign,
  GridDataModel,
  GridReadView,
  WritableGridDataModel,
} from './grid'
export type { EnginePlugin } from './plugin'
