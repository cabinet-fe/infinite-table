// numFmt（数字格式）显示通道：值 → 显示文本的纯函数 + 显示链组合。
// 移植 ultra-ui sheet-core/src/core/format.ts 的四格式语义（date/thousands/cnUpper/fixed）：
// 仅作用于显示，Store 恒存原始值（Excel 式语义）；非数字值由调用方回落原始显示。

/** 数字格式（对齐 ultra-ui NumFmt 语义；kind 联合替代 type 字段） */
export type NumFmt =
  | { kind: 'date' }
  | { kind: 'thousands' }
  | { kind: 'cnUpper' }
  | { kind: 'fixed'; digits: number }

const MS_PER_DAY = 86400000

/** 1900 日期系统序列数 → Date 的 UTC 毫秒（含 Excel 1900 伪闰日兼容：序列 <60 时纪元为 1899-12-31） */
function dateSerialToMs(serial: number): number {
  const days = Math.floor(serial)
  const epoch = days > 0 && days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30)
  return epoch + days * MS_PER_DAY
}

/** 日期序列数 → `YYYY-MM-DD`（小数部分为时间，日期格式只取整数日；UTC 口径与 ultra-ui 一致） */
function formatDate(serial: number): string {
  const d = new Date(dateSerialToMs(serial))
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 千分位分组：整数部分三位分隔 + 固定两位小数（对齐 ultra-ui 千分位金额观感） */
function formatThousands(value: number): string {
  const fixed = roundHalfUp(value, 2).toFixed(2)
  const negative = fixed.startsWith('-')
  const body = negative ? fixed.slice(1) : fixed
  const [int, frac] = body.split('.')
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (negative ? '-' : '') + grouped + (frac ? `.${frac}` : '')
}

/** 四舍五入到指定位数（half-up，远离零；EPSILON 修正 1.005 类浮点误差） */
function roundHalfUp(value: number, digits: number): number {
  const factor = 10 ** digits
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor
  return value < 0 ? -rounded : rounded
}

/** 固定小数位数（四舍五入仅作用于显示） */
function formatFixed(value: number, digits: number): string {
  const d = Math.max(0, Math.trunc(digits))
  return roundHalfUp(value, d).toFixed(d)
}

const CN_DIGITS = '零壹贰叁肆伍陆柒捌玖'
const CN_INT_UNITS = ['', '拾', '佰', '仟']
const CN_GROUP_UNITS = ['', '万', '亿', '兆']

/** 4 位以内整数组 → 大写（组内零收敛为单个「零」） */
function cnIntGroup(group: number): string {
  const str = String(group)
  let out = ''
  let pendingZero = false
  for (let i = 0; i < str.length; i++) {
    const d = str.charCodeAt(i) - 48
    if (d === 0) {
      pendingZero = true
      continue
    }
    if (pendingZero) {
      out += '零'
      pendingZero = false
    }
    out += CN_DIGITS[d]! + CN_INT_UNITS[str.length - 1 - i]
  }
  return out
}

/** 整数部分 → 大写（按万/亿/兆四位分组；跨组不足四位或有零组时补「零」） */
function cnInt(value: number): string {
  if (value === 0) return '零'
  const groups: number[] = []
  let rest = value
  while (rest > 0) {
    groups.push(rest % 10000)
    rest = Math.floor(rest / 10000)
  }
  let out = ''
  let pendingZero = false
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!
    if (g === 0) {
      pendingZero = true
      continue
    }
    if (out && (pendingZero || g < 1000)) out += '零'
    out += cnIntGroup(g) + CN_GROUP_UNITS[i]
    pendingZero = false
  }
  return out
}

/** 中文大写金额（先四舍五入到分；负数加「负」前缀） */
function formatCnUpper(value: number): string {
  const negative = value < 0
  const total = roundHalfUp(Math.abs(value), 2)
  const intPart = Math.floor(total)
  const cents = Math.round((total - intPart) * 100)
  const jiao = Math.floor(cents / 10)
  const fen = cents % 10

  let out = negative ? '负' : ''
  if (cents === 0) return out + cnInt(intPart) + '元整'
  if (intPart > 0) out += cnInt(intPart) + '元'
  if (jiao > 0) out += CN_DIGITS[jiao]! + '角'
  else if (intPart > 0 && fen > 0) out += '零'
  if (fen > 0) out += CN_DIGITS[fen]! + '分'
  return out
}

/** 按 numFmt 把数字值格式化为显示文本（仅显示用，不改动存储值） */
export function formatByNumFmt(value: number, fmt: NumFmt): string {
  switch (fmt.kind) {
    case 'date':
      return formatDate(value)
    case 'thousands':
      return formatThousands(value)
    case 'cnUpper':
      return formatCnUpper(value)
    case 'fixed':
      return formatFixed(value, fmt.digits)
  }
}

/** 求值器签名（与 plugins createFormulaDisplay 的 FormulaEvaluator 同形，demo 层不复引用 plugins 类型） */
export type SheetDisplayEvaluator = (
  formula: string,
  col: number,
  row: number,
) => string | number | null | undefined

/**
 * 显示链组合：公式求值 → numFmt 格式化（book.ts 的 resolveDisplayValue 接线）。
 * - `=` 前缀格：先经 evaluate 求值；数值结果带 numFmt 时格式化，其余（文本/错误码）直出；
 *   evaluate 缺失/返回空 → 回落 `=` 原文（对齐 createFormulaDisplay 语义）；
 *   evaluate 抛错 → `#ERROR!` 占位可见降级（不无痕回退原文；口径同公式引擎错误码）。
 * - 非公式格：数字且带 numFmt → 格式化；空值/文本不误伤，回落引擎缺省渲染（'' / String(value)）。
 */
export function createSheetDisplay(options: {
  evaluate?: SheetDisplayEvaluator
  numFmt: (col: number, row: number) => NumFmt | undefined
}): (col: number, row: number, value: unknown) => string {
  return (col, row, value) => {
    const fmt = options.numFmt(col, row)
    if (typeof value === 'string' && value.startsWith('=')) {
      if (!options.evaluate) {
        return value
      }
      try {
        const result = options.evaluate(value.slice(1), col, row)
        if (result == null) {
          return value
        }
        if (fmt && typeof result === 'number') {
          return formatByNumFmt(result, fmt)
        }
        return String(result)
      } catch {
        return '#ERROR!'
      }
    }
    if (fmt && typeof value === 'number') {
      return formatByNumFmt(value, fmt)
    }
    return value == null ? '' : String(value)
  }
}
