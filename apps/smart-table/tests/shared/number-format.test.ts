import { describe, expect, it } from 'vitest'
import {
  DECIMAL_PLACES_CHOICE_AUTO,
  DECIMAL_PLACES_OPTIONS,
  formatCompactAxisTick,
  formatNumberValue,
  formatPercentRatio,
  formatProgressPercent,
  formatSummaryDisplayValue,
  fromDecimalPlacesChoice,
  resolveDecimalPlaces,
  safeDecimalDiv,
  safeDecimalMul,
  toDecimalPlacesChoice,
} from '../../src/shared/number-format'

describe('shared/number-format（@cat-kit/core 小数精算与格式化单一事实源）', () => {
  it('resolveDecimalPlaces 与下拉选项映射仅接受 0~6 整数', () => {
    expect(DECIMAL_PLACES_OPTIONS).toHaveLength(8)
    expect(DECIMAL_PLACES_OPTIONS[0]?.value).toBe(DECIMAL_PLACES_CHOICE_AUTO)
    expect(resolveDecimalPlaces(0)).toBe(0)
    expect(resolveDecimalPlaces(6)).toBe(6)
    expect(resolveDecimalPlaces(-1)).toBeUndefined()
    expect(resolveDecimalPlaces(7)).toBeUndefined()
    expect(resolveDecimalPlaces(1.5)).toBeUndefined()

    expect(toDecimalPlacesChoice(undefined)).toBe(DECIMAL_PLACES_CHOICE_AUTO)
    expect(toDecimalPlacesChoice(3)).toBe('3')
    expect(fromDecimalPlacesChoice(DECIMAL_PLACES_CHOICE_AUTO)).toBeUndefined()
    expect(fromDecimalPlacesChoice('0')).toBe(0)
    expect(fromDecimalPlacesChoice('6')).toBe(6)
    expect(fromDecimalPlacesChoice('9')).toBeUndefined()
  })

  it('safeDecimalMul / safeDecimalDiv 消除浮点漂移并安全处理 0 除与非有限值', () => {
    expect(safeDecimalMul(0.14, 100)).toBe(14)
    expect(safeDecimalDiv(0.3, 0.1)).toBe(3)
    expect(safeDecimalDiv(0.3, 3)).toBe(0.1)
    expect(safeDecimalDiv(10, 0)).toBe(0)
    expect(safeDecimalDiv(Number.NaN, 2)).toBe(0)
    expect(Object.is(safeDecimalMul(-0, 100), 0)).toBe(true)
  })

  it('formatNumberValue 覆盖默认与 0~6 位小数及各类边界（四舍五入、-0、极小/极大数）', () => {
    // 默认态行为
    expect(formatNumberValue(1200, 'currency')).toBe('¥1,200')
    expect(formatNumberValue(1200.5, 'currency')).toBe('¥1,200.50')
    expect(formatNumberValue(-1234, 'currency')).toBe('-¥1,234')
    expect(formatNumberValue(1.005, 'currency')).toBe('¥1.01')
    expect(formatNumberValue(-0.004, 'currency', 2)).toBe('¥0.00')
    expect(formatNumberValue(1200, 'currency', 2)).toBe('¥1,200.00')
    expect(formatNumberValue(1200, 'currency', 0)).toBe('¥1,200')

    expect(formatNumberValue(12.3, 'decimal')).toBe('12.30')
    expect(formatNumberValue(12.3456, 'decimal', 3)).toBe('12.346')
    expect(formatNumberValue(1234.6, 'integer')).toBe('1,235')
    expect(formatNumberValue(1234.5, 'integer', 2)).toBe('1,234.50')

    expect(formatNumberValue(0.14, 'percent')).toBe('14%')
    expect(formatNumberValue(0.852, 'percent')).toBe('85.2%')
    expect(formatNumberValue(0.5, 'percent', 2)).toBe('50.00%')

    // 未指定 numberFormat 时保留真实小数（最多 6 位且去尾 0），指定小数位时固定位数
    expect(formatNumberValue(0.3)).toBe('0.3')
    expect(formatNumberValue(0.125)).toBe('0.125')
    expect(formatNumberValue(0.125, undefined, 4)).toBe('0.1250')

    // 科学计数法极小数与超大数安全回退
    expect(formatNumberValue(5e-7, undefined, 6)).toBe('0.000001')
    expect(formatNumberValue(-5e-7, undefined, 6)).toBe('-0.000001')
    expect(formatNumberValue(-5e-7, 'currency', 2)).toBe('¥0.00')
    expect(formatNumberValue(1e21, 'integer')).toBe('1,000,000,000,000,000,000,000')
    expect(formatNumberValue(Number.NaN, 'decimal')).toBe('-')
  })

  it('formatPercentRatio / formatProgressPercent / formatSummaryDisplayValue / formatCompactAxisTick 一致生效', () => {
    expect(formatPercentRatio(0.8333)).toBe('83.3%')
    expect(formatPercentRatio(0.8333, 2)).toBe('83.33%')
    expect(formatProgressPercent(75.5)).toBe('75.5%')
    expect(formatProgressPercent(75, 2)).toBe('75.00%')
    expect(formatProgressPercent(120, 0)).toBe('100%')
    expect(formatProgressPercent(-5, 1)).toBe('0.0%')
    expect(formatProgressPercent(Number.NaN, 1)).toBe('')

    expect(formatSummaryDisplayValue(12, 'none')).toBe('')
    expect(formatSummaryDisplayValue(null, 'sum', 'currency', 2)).toBe('-')
    expect(formatSummaryDisplayValue(42, 'count', 'decimal', 2)).toBe('42')
    expect(formatSummaryDisplayValue(0.5, 'filled_rate', undefined, 2)).toBe('50.00%')
    expect(formatSummaryDisplayValue(1200, 'sum', 'currency', 3)).toBe('¥1,200.000')

    expect(formatCompactAxisTick(150_000_000)).toBe('1.5亿')
    expect(formatCompactAxisTick(12_500)).toBe('1.3万')
    expect(formatCompactAxisTick(1200)).toBe('1,200')
    expect(formatCompactAxisTick(4.85)).toBe('4.9')
  })
})
