// 公式感知显示：值为 = 前缀字符串的格经注入求值器渲染，其余值沿用引擎默认管线。
// 编辑体验对齐 ultra-ui resolveEditText：编辑初值取基础值（= 原文）由引擎保证，
// 下游公式栏镜像订阅 onEditStart/onEditEnd（core S1 事件）。

import type { ListTableOptions } from '@infinite-table/core'

/** 求值器：入参为公式体（不含前导 =，如 'A1+1'）与目标格坐标；无法求值返回 null/undefined 或抛错 */
export type FormulaEvaluator = (
  formula: string,
  col: number,
  row: number,
) => string | number | null | undefined

/** resolveDisplayValue hook 形态（直接展开进 ListTableOptions） */
export type FormulaDisplayFn = NonNullable<ListTableOptions['resolveDisplayValue']>

/**
 * 产出公式感知的 resolveDisplayValue：
 * - 值为 `=` 前缀字符串 → 调 evaluate（公式体）取显示文本；
 *   evaluate 未注入/返回 null/undefined/抛错 → 回落 `=` 原文（编辑初值即原文，所见即所编）；
 * - 其它值 → 复刻引擎管线缺省渲染（value == null ? '' : String(value)，见 CellValuePipeline.resolveText）。
 */
export function createFormulaDisplay(
  options: { evaluate?: FormulaEvaluator } = {},
): FormulaDisplayFn {
  return (col, row, value) => {
    if (typeof value !== 'string' || !value.startsWith('=')) {
      return value == null ? '' : String(value)
    }
    const original = value
    if (!options.evaluate) {
      return original
    }
    try {
      const result = options.evaluate(original.slice(1), col, row)
      return result == null ? original : String(result)
    } catch {
      return original
    }
  }
}
