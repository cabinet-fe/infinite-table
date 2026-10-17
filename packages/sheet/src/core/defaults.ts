/**
 * Sheet 内置缺省行高 / 列宽（px）。
 *
 * 模型未声明 defaultRowHeight / defaultColWidth 时，视图层与 xlsx 导出共同回落此值：
 * 导出不回落会导致 Excel 以内建缺省（15pt ≈ 20px / 8.43 字符 ≈ 64px）打开，
 * 比 UI 渲染（28px / 80px，行高含上下内边距）明显偏小。
 */
export const SHEET_DEFAULT_ROW_HEIGHT = 28
export const SHEET_DEFAULT_COL_WIDTH = 80
