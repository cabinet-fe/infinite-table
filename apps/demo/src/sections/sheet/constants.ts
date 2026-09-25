// sheet 演示区共享常量与初始数据/样式种子（SheetStore 单一事实源的播种材料）。

import type { CellStyle } from '@infinite-table/core'

/** 数据列数（A~Z 列头）与行数（对标 ultra-ui 演示的 26 列横向滚动形态） */
export const SHEET_COL_COUNT = 26
export const SHEET_ROW_COUNT = 40

/**
 * 初始合并区（C12:E13 主格含 \n 多行文本）。
 * 起始列取 2：冻结列数在 0/1/2 挡位切换时均不跨冻结边界（运行时校验会拒绝跨界合并）。
 */
export const SHEET_MERGE_RANGE = { startCol: 2, startRow: 11, endCol: 4, endRow: 12 } as const
/** 运行时切换时追加的合并区（G16:H17） */
export const SHEET_MERGE_EXTRA_RANGE = { startCol: 5, startRow: 15, endCol: 6, endRow: 16 } as const
/** 填充柄预置选区（B16:C18：数字序列 1/2/3 + 文本 a/b） */
export const SHEET_FILL_SELECTION = [
  { start: { col: 1, row: 15 }, end: { col: 2, row: 17 } },
] as const
/** 格内示例图所在格（F1） */
export const SHEET_IMAGE_CELL = { col: 5, row: 0 } as const

/** 内边距演示格底色（让内缩观感可见） */
export const PADDING_BACKGROUND = '#eef2ff'
/** 边框线型演示色 */
export const BORDER_DEMO_COLOR = '#2563eb'
/** 溢出演示共用长文本（超出 104px 列宽） */
export const OVERFLOW_TEXT = '超宽长文本溢出演示超宽长文本溢出演示超宽长文本'

/** 边框线型演示：四边同线型的边框片段 */
export function borderAll(style: 'solid' | 'dashed' | 'dotted' | 'double'): CellStyle {
  const edge = { width: 2, color: BORDER_DEMO_COLOR, style }
  return { border: { top: edge, right: edge, bottom: edge, left: edge } }
}

/** 样式矩阵种子：键 `${col},${row}` → 样式片段（迁入 SheetStore 格级样式） */
export const MATRIX_STYLE_SEEDS: ReadonlyArray<{ key: string; style: CellStyle }> = [
  // 对齐（row 3；B3 左对齐为缺省不设）
  { key: '2,3', style: { textAlign: 'center' } },
  { key: '3,3', style: { textAlign: 'right' } },
  { key: '4,3', style: { verticalAlign: 'top' } },
  { key: '5,3', style: { verticalAlign: 'bottom' } },
  // 加粗 / 斜体（row 4）
  { key: '1,4', style: { fontWeight: 700 } },
  { key: '2,4', style: { fontStyle: 'italic' } },
  { key: '3,4', style: { fontWeight: 700, fontStyle: 'italic' } },
  // 下划线 / 删除线（row 5）
  { key: '1,5', style: { underline: true } },
  { key: '2,5', style: { lineThrough: true } },
  { key: '3,5', style: { underline: true, lineThrough: true } },
  // 字号（row 6）
  { key: '1,6', style: { fontSize: 10 } },
  { key: '2,6', style: { fontSize: 14 } },
  { key: '3,6', style: { fontSize: 18 } },
  // 边框线型（row 7）
  { key: '1,7', style: borderAll('solid') },
  { key: '2,7', style: borderAll('dashed') },
  { key: '3,7', style: borderAll('dotted') },
  { key: '4,7', style: borderAll('double') },
  // 溢出策略（row 8；D8 缺省 = Excel 式溢出到右侧空格）
  { key: '1,8', style: { textOverflow: 'ellipsis' } },
  { key: '2,8', style: { textOverflow: 'clip' } },
  // 内边距（row 9）
  { key: '1,9', style: { padding: [0, 8, 0, 24], background: PADDING_BACKGROUND } },
  { key: '2,9', style: { padding: [8, 16, 8, 16], background: PADDING_BACKGROUND } },
  // 合并区主格（C12:E13）：textWrap 开启后 \n 强制分段 + 段内自动换行叠加
  { key: '2,11', style: { textWrap: true } },
]

/** 初始格值种子（稀疏键 `${col},${row}` → 值） */
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
  { key: '1,6', value: '10px' },
  { key: '2,6', value: '14px' },
  { key: '3,6', value: '18px' },
  { key: '0,7', value: '边框线型' },
  { key: '1,7', value: 'solid' },
  { key: '2,7', value: 'dashed' },
  { key: '3,7', value: 'dotted' },
  { key: '4,7', value: 'double' },
  // 溢出策略行：每格文本自带策略标注——B8 省略号（显式 ellipsis）、C8 裁剪（显式 clip）、
  // D8 缺省溢出（未设 textOverflow，按 Excel 式溢出到右侧空格）。缺省格的省略号误读
  // 防线：本行三格策略互不相同且自描述，见 S10-P3 实现说明。
  { key: '0,8', value: '溢出策略' },
  { key: '1,8', value: `省略号：${OVERFLOW_TEXT}` },
  { key: '2,8', value: `裁剪：${OVERFLOW_TEXT}` },
  { key: '3,8', value: `缺省溢出：${OVERFLOW_TEXT}` },
  { key: '0,9', value: '内边距' },
  { key: '1,9', value: '左内边距24' },
  { key: '2,9', value: '四边内边距' },
  // \n 多行文本 + 合并区主格（C12:E13）
  { key: '2,11', value: '合并区 C12:E13\n第二行文本\n第三行文本' },
  { key: '0,14', value: '填充柄 ↓' },
  // 填充柄预置值：数字序列与文本（拖拽由 bindFillGeneration 消费生成写值）
  { key: '1,15', value: 1 },
  { key: '1,16', value: 2 },
  { key: '1,17', value: 3 },
  { key: '2,15', value: 'a' },
  { key: '2,16', value: 'b' },
  // 格内示例图说明（图在 F1）与公式演示格
  { key: '4,0', value: '示例图→' },
]
