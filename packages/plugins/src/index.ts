// 插件包公共入口：官方插件（首批为 sheet 插件，见 docs/plugin-interface-map.md）。
// 只做具名导出：插件契约类型自 core 转出，后续插件能力经此入口对外提供（禁止 export *）。
export type { TablePlugin } from '@infinitable/core'

// ---- sheet 插件（电子表格能力族：Store 参考模型 + 多 sheet 实例池 + 撤销栈 + 填充生成 + 选区同步
// + 公式显示 + Excel 键位 + 边框预设 + xlsx 导出映射，统一收拢为插件对象与 handle 操作面） ----
export { createSheetPlugin } from './sheet/sheet-plugin'
export type { SheetPluginHandle, SheetPluginOptions } from './sheet/sheet-plugin'

// ---- chart 插件（单元格图表：声明解析 + Chart.js 按需加载 + 离屏出图，落 L2 media 位图管线） ----
// 只导出插件工厂与参数类型；chart-loader/parse/render 为包内实现，深路径可测但不对外
export { createChartPlugin } from './chart/chart-plugin'
export type { ChartPluginHandle, ChartPluginOptions } from './chart/chart-plugin'
export type {
  ChartCellDeclaration,
  ChartDatasetDeclaration,
  ChartDatasetSpec,
  ChartSpec,
  ChartSpecType,
  ChartType,
} from './chart/types'

// ---- watermark 插件（文字平铺水印：core 顶层 overlay 预留位绘制，锚定视口不随滚动） ----
export { createWatermarkPlugin } from './watermark/watermark-plugin'
export type { WatermarkHandle } from './watermark/watermark-plugin'
// 水印插件参数配置（与打印水印共享同一模型，经本入口一并转出）
export type { WatermarkTextConfig } from './print/types'

// ---- print 插件（headless 打印内核：分页 → 页面 HTML → 占位符求值 → iframe 输出 + DOM 预览薄壳） ----
// 散装打印能力收拢为插件 handle 方法（分页/文档构建/打印输出/DOM 预览）；实现细节
// 保留在包内深路径，实现细节类型（页结构/钩子/预览句柄等）不转出
export { createPrintPlugin } from './print/print-plugin'
export type { PrintPluginHandle, PrintPluginOptions } from './print/print-plugin'
export type {
  PrintConfig,
  PrintHeaderFooterConfig,
  PrintHeaderFooterSection,
  PrintImagePayload,
  PrintMargin,
  PrintOrientation,
  PrintPagingMode,
  PrintPaperPreset,
  PrintPaperSpec,
  PrintScaleMode,
  PrintSource,
} from './print/types'
