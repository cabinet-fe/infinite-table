import { $n, n } from '@cat-kit/core'
import {
  MAX_DECIMAL_PLACES,
  MIN_DECIMAL_PLACES,
  isValidDecimalPlaces,
  type SmartColumn,
  type SummaryType,
} from './schema'

export const DECIMAL_PLACES_CHOICE_AUTO = '__auto__'

/** 小数位下拉选项（默认/自动 + 0~6 位小数，供各配置面板共用） */
export const DECIMAL_PLACES_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: DECIMAL_PLACES_CHOICE_AUTO, label: '默认（自动）' },
  ...Array.from({ length: MAX_DECIMAL_PLACES - MIN_DECIMAL_PLACES + 1 }, (_, idx) => {
    const digits = MIN_DECIMAL_PLACES + idx
    return {
      value: String(digits),
      label: digits === 0 ? '0 位（整数）' : `${digits} 位`,
    }
  }),
]

/** 将小数位配置转换为下拉框字符串选项 */
export function toDecimalPlacesChoice(decimalPlaces?: number): string {
  return isValidDecimalPlaces(decimalPlaces) ? String(decimalPlaces) : DECIMAL_PLACES_CHOICE_AUTO
}

/** 将下拉框字符串选项还原为合法小数位（选默认时返回 undefined） */
export function fromDecimalPlacesChoice(choice: string): number | undefined {
  if (choice === DECIMAL_PLACES_CHOICE_AUTO) {
    return undefined
  }
  const parsed = Number(choice)
  return isValidDecimalPlaces(parsed) ? parsed : undefined
}

const TINY_NUMBER_THRESHOLD = 1e-6
const LARGE_NUMBER_THRESHOLD = 1e15
const PROGRESS_MIN = 0
const PROGRESS_MAX = 100

function hasNonZeroDigit(text: string): boolean {
  return /[1-9]/.test(text)
}

/** 校验并收窄小数位配置（仅 0~6 的合法整数生效） */
export function resolveDecimalPlaces(decimalPlaces: number | undefined): number | undefined {
  return isValidDecimalPlaces(decimalPlaces) ? decimalPlaces : undefined
}

/** 使用 @cat-kit/core 做安全十进制乘法，过滤非有限数并规避 -0 */
export function safeDecimalMul(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return 0
  }
  const result = $n.mul(a, b)
  return Object.is(result, -0) ? 0 : result
}

/** 使用 @cat-kit/core 做安全十进制除法，除数为 0 或非有限数返回 0 */
export function safeDecimalDiv(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0
  }
  const result = $n.div(numerator, denominator)
  return Object.is(result, -0) ? 0 : result
}

/** 按指定精度区间格式化带千分位数值（底层委托给 @cat-kit/core） */
export function formatGroupedNumber(
  value: number,
  minPrecision: number,
  maxPrecision: number,
): string {
  if (!Number.isFinite(value)) {
    return '-'
  }
  const normalized = Object.is(value, -0) ? 0 : value
  const absVal = Math.abs(normalized)

  let unsigned: string
  if (absVal >= LARGE_NUMBER_THRESHOLD) {
    unsigned = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: minPrecision,
      maximumFractionDigits: maxPrecision,
    }).format(absVal)
  } else if (absVal > 0 && absVal < TINY_NUMBER_THRESHOLD) {
    // @cat-kit/core n().currency 处理 e- 科学计数法小数时会保留 'e-' 字符，先 +1 平移再还原首位 '0'
    const shifted = $n.plus(absVal, 1)
    const formatted =
      minPrecision === maxPrecision
        ? n(shifted).currency('CNY', maxPrecision)
        : n(shifted).currency('CNY', { minPrecision, maxPrecision })
    unsigned = `0${formatted.slice(1)}`
  } else {
    unsigned =
      minPrecision === maxPrecision
        ? n(absVal).currency('CNY', maxPrecision)
        : n(absVal).currency('CNY', { minPrecision, maxPrecision })
  }

  if (normalized < 0 && hasNonZeroDigit(unsigned)) {
    return `-${unsigned}`
  }
  return unsigned
}

/** 格式化比例型百分比（如 0.852 -> 85.2%），支持显式小数位覆盖 */
export function formatPercentRatio(ratio: number, decimalPlaces?: number): string {
  if (!Number.isFinite(ratio)) {
    return '-'
  }
  const pct = safeDecimalMul(ratio, 100)
  const digits = resolveDecimalPlaces(decimalPlaces)
  if (digits !== undefined) {
    return `${formatGroupedNumber(pct, digits, digits)}%`
  }
  return `${formatGroupedNumber(pct, 0, 1)}%`
}

/** 格式化进度百分比（输入已为 0~100 分值），支持显式小数位覆盖 */
export function formatProgressPercent(value: number, decimalPlaces?: number): string {
  if (!Number.isFinite(value)) {
    return ''
  }
  const clamped = Math.max(PROGRESS_MIN, Math.min(PROGRESS_MAX, value))
  const digits = resolveDecimalPlaces(decimalPlaces)
  if (digits !== undefined) {
    return `${formatGroupedNumber(clamped, digits, digits)}%`
  }
  return `${formatGroupedNumber(clamped, 0, 1)}%`
}

/** 统一数值格式化入口：覆盖 integer / decimal / currency / percent / 默认格式 */
export function formatNumberValue(
  value: number,
  numberFormat?: SmartColumn['numberFormat'],
  decimalPlaces?: number,
): string {
  if (!Number.isFinite(value)) {
    return '-'
  }
  const safeVal = Object.is(value, -0) ? 0 : value
  const digits = resolveDecimalPlaces(decimalPlaces)

  switch (numberFormat) {
    case 'integer': {
      const precision = digits ?? 0
      return formatGroupedNumber(safeVal, precision, precision)
    }
    case 'currency': {
      const precision = digits ?? (Number.isInteger(safeVal) ? 0 : 2)
      const absText = formatGroupedNumber(Math.abs(safeVal), precision, precision)
      const isNegativeNonZero = safeVal < 0 && hasNonZeroDigit(absText)
      return isNegativeNonZero ? `-¥${absText}` : `¥${absText}`
    }
    case 'percent':
      return formatPercentRatio(safeVal, digits)
    case 'decimal': {
      const precision = digits ?? 2
      return formatGroupedNumber(safeVal, precision, precision)
    }
    default:
      if (digits !== undefined) {
        return formatGroupedNumber(safeVal, digits, digits)
      }
      return formatGroupedNumber(safeVal, 0, MAX_DECIMAL_PLACES)
  }
}

/** 统一汇总指标格式化入口（兼容 count / filled_rate / 常规数值聚合） */
export function formatSummaryDisplayValue(
  value: number | null,
  type: SummaryType,
  numberFormat?: SmartColumn['numberFormat'],
  decimalPlaces?: number,
): string {
  if (type === 'none') {
    return ''
  }
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }
  if (type === 'filled_rate') {
    return formatPercentRatio(value, decimalPlaces)
  }
  if (type === 'count') {
    return formatGroupedNumber(value, 0, 0)
  }
  return formatNumberValue(value, numberFormat, decimalPlaces)
}

/** 图表坐标轴紧凑刻度格式化 */
export function formatCompactAxisTick(value: number): string {
  if (!Number.isFinite(value)) {
    return ''
  }
  const abs = Math.abs(value)
  if (abs >= 100_000_000) {
    return `${formatGroupedNumber(safeDecimalDiv(value, 100_000_000), 1, 1)}亿`
  }
  if (abs >= 10_000) {
    return `${formatGroupedNumber(safeDecimalDiv(value, 10_000), 1, 1)}万`
  }
  if (Number.isInteger(value)) {
    return formatGroupedNumber(value, 0, 0)
  }
  return formatGroupedNumber(value, 1, 1)
}
