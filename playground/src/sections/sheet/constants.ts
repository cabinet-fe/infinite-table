// sheet 演示区共享常量与初始数据/样式种子（@infinitable/sheet 模型播种材料）。
// 样式形态为模型 CellStyle（fill/font/align/border/numFmt 五族）：
// 模型能力边界内组阵——溢出策略与格内边距不在此模型样式面（各演示区自证），矩阵不设对应行。

import type { CellStyle } from '@infinitable/sheet'

/** 数据列数（A~Z 列头）与行数（对标 ultra-ui 演示的 26 列横向滚动形态） */
export const SHEET_COL_COUNT = 26
export const SHEET_ROW_COUNT = 40

/** 格内示例图所在格（F1，Sheet1 专属） */
export const SHEET_IMAGE_CELL = { col: 5, row: 0 } as const

/** 主 sheet 名 / 次 sheet 名（Workbook 管理表名，tabs 与跨表引用同源） */
export const MAIN_SHEET_NAME = 'Sheet1'
export const SECONDARY_SHEET_NAME = 'Sheet2'

/** 溢出演示共用长文本（超出 104px 列宽） */
export const OVERFLOW_TEXT = '超宽长文本溢出演示超宽长文本溢出演示超宽长文本'

/** 边框线型演示色 */
const BORDER_DEMO_COLOR = '#2563eb'

/** 边框线型演示：四边同线型的边框片段（模型五种线型取四种成组：thin/medium/dashed/dotted） */
function borderAll(style: 'thin' | 'medium' | 'dashed' | 'dotted'): CellStyle {
  const edge = { width: style === 'medium' ? 2 : 1, color: BORDER_DEMO_COLOR, style }
  return { border: { top: edge, right: edge, bottom: edge, left: edge } }
}

/** 样式矩阵种子：键 `${col},${row}` → 模型样式片段（迁入 Sheet 格级样式池） */
export const MATRIX_STYLE_SEEDS: ReadonlyArray<{ key: string; style: CellStyle }> = [
  // 公式演示说明格（C1）弱化字色
  { key: '2,0', style: { font: { color: '#71717a' } } },
  // 对齐（row 3；B3 左对齐为缺省不设）
  { key: '2,3', style: { align: { horizontal: 'center' } } },
  { key: '3,3', style: { align: { horizontal: 'right' } } },
  { key: '4,3', style: { align: { vertical: 'top' } } },
  { key: '5,3', style: { align: { vertical: 'bottom' } } },
  // 加粗 / 斜体（row 4）
  { key: '1,4', style: { font: { bold: true } } },
  { key: '2,4', style: { font: { italic: true } } },
  { key: '3,4', style: { font: { bold: true, italic: true } } },
  // 下划线 / 删除线（row 5）
  { key: '1,5', style: { font: { underline: true } } },
  { key: '2,5', style: { font: { strikethrough: true } } },
  { key: '3,5', style: { font: { underline: true, strikethrough: true } } },
  // 字号（row 6；模型字号单位 pt，渲染 ×4/3 转 px）
  { key: '1,6', style: { font: { size: 9 } } },
  { key: '2,6', style: { font: { size: 12 } } },
  { key: '3,6', style: { font: { size: 14 } } },
  // 边框线型（row 7）
  { key: '1,7', style: borderAll('thin') },
  { key: '2,7', style: borderAll('medium') },
  { key: '3,7', style: borderAll('dashed') },
  { key: '4,7', style: borderAll('dotted') },
  // 合并区主格（C12:E13）：wrap 开启后 \n 强制分段 + 段内自动换行叠加
  { key: '2,11', style: { align: { wrap: true } } },
]

/** 初始格值种子（稀疏键 `${col},${row}` → 值；公式格为 '=' 原文，播种时转 f 入模型） */
export const VALUE_SEEDS: ReadonlyArray<{ key: string; value: unknown }> = [
  { key: '0,2', value: '样式矩阵 ↓' },
  { key: '0,3', value: '对齐' },
  { key: '1,3', value: '左对齐' },
  { key: '2,3', value: '居中' },
  { key: '3,3', value: '右对齐' },
  { key: '4,3', value: '顶对齐' },
  { key: '5,3', value: '底对齐' },
  { key: '0,4', value: '字型' },
  { key: '1,4', value: '加粗' },
  { key: '2,4', value: '斜体' },
  { key: '3,4', value: '粗斜体' },
  { key: '0,5', value: '线饰' },
  { key: '1,5', value: '下划线' },
  { key: '2,5', value: '删除线' },
  { key: '3,5', value: '下划+删除' },
  { key: '0,6', value: '字号' },
  { key: '1,6', value: '9pt' },
  { key: '2,6', value: '12pt' },
  { key: '3,6', value: '14pt' },
  { key: '0,7', value: '边框线型' },
  { key: '1,7', value: 'thin' },
  { key: '2,7', value: 'medium' },
  { key: '3,7', value: 'dashed' },
  { key: '4,7', value: 'dotted' },
  // 溢出行：模型样式面无 textOverflow 逐格策略，此行演示缺省 Excel 式溢出（走廊空格可见字形）
  { key: '0,8', value: '溢出' },
  { key: '1,8', value: `缺省溢出：${OVERFLOW_TEXT}` },
  // \n 多行文本 + 合并区主格（C12:E13）
  { key: '2,11', value: '合并区 C12:E13\n第二行文本\n第三行文本' },
  { key: '0,14', value: '填充柄 ↓' },
  // 填充柄预置值：数字序列与文本（拖拽/双击由 fill.ts 接线消费生成写值）
  { key: '1,15', value: 1 },
  { key: '1,16', value: 2 },
  { key: '1,17', value: 3 },
  { key: '2,15', value: 'a' },
  { key: '2,16', value: 'b' },
  // 格内示例图说明（图在 F1，仅 Sheet1）与公式演示格说明
  { key: '4,0', value: '示例图→' },
  { key: '2,0', value: '公式显示→' },
  // 公式演示源值：D1=7、D2=5（D3=引用运算、D4=区域函数在 workbook.ts 播种）
  { key: '3,0', value: 7 },
  { key: '3,1', value: 5 },
]
