// 画布网格主题覆盖（仅颜色/框线与超宽文本策略，不动 rowHeight/colWidth/字号——
// 避免画布与打印输出不一致）。以 SheetGrid 内置 SHEET_GRID_THEME 为底经 extendsTheme
// 深覆盖，未给 token 保持引擎缺省。
// 类型取自 sheet 公共面的选项形状（不直接引 @infinitable/grid 包，避免新增应用依赖）。
import type { SheetGridOptions } from '@infinitable/sheet'

type CanvasTheme = NonNullable<SheetGridOptions['theme']>

/**
 * 设计画布主题：中性灰表头 + 更轻的网格线 + 品牌蓝选区。
 *
 * body 显式 ellipsis（引擎缺省是 Excel 式溢出走廊）：画布上的长文本主要是绑定占位符
 * （`{{[0].items[].unit_price}}` 这类远长于真实数据的字符串），窄列里按缺省向右/向左
 * 溢出时，右对齐格的左溢与左对齐格的右溢会同时穿过中间的空格，两段文本叠在同一片
 * 区域——设计态看过去就是「文本堆起来」。打印产物里 td 恒 `overflow:hidden`
 * 逐格裁剪（page-html 的 .print-table td），画布不溢出即与打印口径一致。
 */
export const FORM_CANVAS_THEME: CanvasTheme = {
  body: {
    color: '#101828',
    borderColor: '#e9ecf1',
    textOverflow: 'ellipsis',
  },
  header: {
    background: '#f7f8fa',
    color: '#475467',
    borderColor: '#e4e7ec',
  },
  interaction: {
    selectionBorder: '#2f62f0',
    selectionFill: 'rgba(47, 98, 240, 0.10)',
    headerHighlight: 'rgba(47, 98, 240, 0.08)',
    fillHandle: '#2f62f0',
    resizeLine: '#2f62f0',
  },
  frameStyle: {
    color: '#e4e7ec',
  },
}
