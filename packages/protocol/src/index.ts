// @infinitable/protocol 公共入口（唯一；显式导出，禁止 export *）。
//
// 引擎装配协议契约包：纯类型、零运行时代码——中立本体 EngineAssembly、导出读取面
// EngineReadView、插件契约 EnginePlugin，及其引用的槽位 / 事件词汇
// （UnderlayPainter / OverlayPainter / CellChangeEvent）。四类平级引擎（表格 /
// sheet / 透视 / 甘特）与官方插件只依赖本包即完成契约消费；表格领域增量
// （TableEngine）在 @infinitable/table，不在本包。

export type {
  CellChangeEvent,
  EngineAssembly,
  EngineReadView,
  OverlayPainter,
  UnderlayPainter,
} from './engine'
export type { EnginePlugin } from './plugin'
