// 插件包公共入口：官方插件（chart/print/watermark，见 docs/plugin-interface-map.md）。
// 只做具名导出：协议契约类型（EnginePlugin / GridReadView）自 @infinitable/protocol 转出，
// 本包零 @infinitable/table 依赖（禁止 export *）。
// 电子表格能力已整体迁入 @infinitable/sheet，不再由插件包承载。
// 插件分类：
// - watermark / print 为协议插件（实现 EnginePlugin，mount 只收 EngineAssembly）；
// - chart 为领域面组合模块（经 resolveCellChart 构造缝注入表格引擎，按需加载 Chart.js）。
export type { EnginePlugin, GridReadView } from '@infinitable/protocol'

// ---- chart 插件（领域面组合模块：单元格图表——声明解析 + Chart.js 按需加载 + 离屏出图） ----
// 只导出插件工厂与公开契约类型；chart-loader/parse/render 为包内实现，深路径可测但不对外
export { createChartPlugin } from './chart/chart-plugin'
export type {
  ChartCellMedia,
  ChartCellMediaSize,
  ChartPluginHandle,
  ChartPluginOptions,
} from './chart/chart-plugin'
export type {
  ChartCellDeclaration,
  ChartDatasetDeclaration,
  ChartDatasetSpec,
  ChartSpec,
  ChartSpecType,
  ChartType,
} from './chart/types'

// ---- watermark 插件（协议插件：文字平铺水印——经引擎装配协议 overlay 槽位注册绘制器，锚定视口不随滚动） ----
export { createWatermarkPlugin } from './watermark/watermark-plugin'
export type { WatermarkHandle, WatermarkPluginOptions } from './watermark/watermark-plugin'
// 水印插件参数配置（与打印水印共享同一模型，经本入口一并转出）
export type { WatermarkTextConfig } from './print/types'

// ---- print 插件（协议插件：headless 打印内核——分页 → 页面 HTML → 占位符求值 → iframe 输出 + DOM 预览薄壳） ----
// 散装打印能力收拢为插件 handle 方法（分页/文档构建/打印输出/DOM 预览）；实现细节
// 保留在包内深路径，实现细节类型（页结构/钩子/预览句柄等）不转出
export { createPrintPlugin } from './print/print-plugin'
export type { PrintPluginHandle, PrintPluginOptions } from './print/print-plugin'
// 纸张几何纯函数（纸幅/可用区域推导，分页与页面构建共用的同一口径）：设计器画布
// 参考线等显示层经此复用，宿主不再逐字复制 mm→px 换算与预设尺寸表
export { derivePrintableArea } from './print/paper'
export type { PrintableArea } from './print/paper'
export type {
  PrintConfig,
  PrintHeaderFooterConfig,
  PrintHeaderFooterSection,
  PrintMargin,
  PrintOrientation,
  PrintPagingMode,
  PrintPaperPreset,
  PrintPaperSpec,
  PrintScaleMode,
} from './print/types'
