// 格样式预设：工具条选项 ↔ Sheet 样式补丁的唯一映射（含从既有样式反推当前预设）
import {
  BORDER_STYLE_WIDTH,
  type BorderSide,
  type CellStyle,
  type CellStylePatch,
} from '@infinitable/sheet'

/** 边框预设（四边同线型；none = 四边全清） */
export type BorderOption = 'none' | 'thin' | 'medium' | 'thick' | 'dashed'

/** 数字格式预设 */
export type NumFmtOption = 'none' | 'date' | 'thousands' | 'fixed2' | 'cnUpper'

const BORDER_SIDES: readonly BorderSide[] = ['top', 'right', 'bottom', 'left']

export const BORDER_OPTIONS: { value: BorderOption; label: string }[] = [
  { value: 'none', label: '无边框' },
  { value: 'thin', label: '细线' },
  { value: 'medium', label: '中线' },
  { value: 'thick', label: '粗线' },
  { value: 'dashed', label: '虚线' },
]

export const NUM_FMT_OPTIONS: { value: NumFmtOption; label: string }[] = [
  { value: 'none', label: '常规' },
  { value: 'date', label: '日期' },
  { value: 'thousands', label: '千分位' },
  { value: 'fixed2', label: '两位小数' },
  { value: 'cnUpper', label: '金额大写' },
]

/**
 * 工具条上的数字格式快捷组（顺序即展示顺序；cnUpper 是「金额转中文大写」的常用诉求）。
 * title 给具体示例，用户不用猜「金额大写」到底输出什么。
 */
export const NUM_FMT_QUICK: { value: NumFmtOption; label: string; title: string }[] = [
  { value: 'none', label: '常规', title: '常规显示：保留原始值，不做格式化' },
  { value: 'thousands', label: '千分位', title: '千分位分组（1234567.5 → 1,234,567.5）' },
  { value: 'fixed2', label: '两位小数', title: '固定两位小数（3.1 → 3.10）' },
  {
    value: 'cnUpper',
    label: '金额大写',
    title: '金额转中文大写（1234.56 → 壹仟贰佰叁拾肆元伍角陆分）',
  },
  { value: 'date', label: '日期', title: '日期格式（序列数 → YYYY-MM-DD）' },
]

/** 边框预设 → 样式补丁（none 显式清四边，其余四边同线型） */
export function borderPatch(option: BorderOption): CellStylePatch {
  if (option === 'none') {
    return { border: { top: null, right: null, bottom: null, left: null } }
  }
  const edge = { style: option, width: BORDER_STYLE_WIDTH[option], color: '#000000' }
  return { border: { top: edge, right: edge, bottom: edge, left: edge } }
}

/** 数字格式预设 → 样式补丁 */
export function numFmtPatch(option: NumFmtOption): CellStylePatch {
  switch (option) {
    case 'date':
      return { numFmt: { type: 'date' } }
    case 'thousands':
      return { numFmt: { type: 'thousands' } }
    case 'fixed2':
      return { numFmt: { type: 'fixed', digits: 2 } }
    case 'cnUpper':
      return { numFmt: { type: 'cnUpper' } }
    default:
      return { numFmt: null }
  }
}

/**
 * 既有样式 → 边框预设。四边同线型才算命中；四边全无 = none；
 * 混合形态（只描了三边等）返回 'mixed'，工具条据此显示未选状态。
 */
export function detectBorderOption(style: CellStyle | undefined): BorderOption | 'mixed' {
  const edges = BORDER_SIDES.map((side) => style?.border?.[side])
  if (edges.every((edge) => edge === undefined)) return 'none'
  const first = edges[0]
  if (!first) return 'mixed'
  const same = edges.every(
    (edge) => edge && edge.style === first.style && edge.width === first.width,
  )
  if (!same) return 'mixed'
  const hit = BORDER_OPTIONS.find((option) => option.value === first.style)
  return hit ? hit.value : 'mixed'
}

/** 既有样式 → 数字格式预设（fixed 非 2 位小数视为常规） */
export function detectNumFmtOption(style: CellStyle | undefined): NumFmtOption {
  const numFmt = style?.numFmt
  if (!numFmt) return 'none'
  switch (numFmt.type) {
    case 'date':
      return 'date'
    case 'thousands':
      return 'thousands'
    case 'cnUpper':
      return 'cnUpper'
    case 'fixed':
      return numFmt.digits === 2 ? 'fixed2' : 'none'
    default:
      return 'none'
  }
}
