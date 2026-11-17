// 领域计算管线共享的基础值规范化与安全数值聚合工具

/** 提取 `{ url, text }` 链接对象的展示文本；非链接对象返回 null */
export function extractLinkText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  if (!('url' in value) && !('text' in value)) {
    return null
  }
  const obj = value as { url?: unknown; text?: unknown }
  if (typeof obj.text === 'string' && obj.text.trim() !== '') {
    return obj.text.trim()
  }
  if (typeof obj.url === 'string' && obj.url.trim() !== '') {
    return obj.url.trim()
  }
  return ''
}

/** 判断单元格值是否为空（null / undefined / 纯空白字符串 / 空链接对象） */
export function isEmptyCellValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value === 'string') {
    return value.trim() === ''
  }
  const linkText = extractLinkText(value)
  if (linkText !== null) {
    return linkText === ''
  }
  return false
}

/** 将单元格值提取为有限数字；非数字或 NaN/Infinity 返回 null */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') {
      return null
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** 标量安全转字符串（支持 `{ url, text }` 链接对象，避免退化为 [object Object]） */
export function scalarToText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  const linkText = extractLinkText(value)
  if (linkText !== null) {
    return linkText
  }
  return ''
}

function toScaledInteger(val: number, maxScale: number): number {
  const negative = val < 0
  const absStr = String(Math.abs(val))
  const dotIdx = absStr.indexOf('.')
  const intPart = dotIdx === -1 ? absStr : absStr.slice(0, dotIdx)
  const fracPart = dotIdx === -1 ? '' : absStr.slice(dotIdx + 1)
  const padded = intPart + fracPart.padEnd(maxScale, '0')
  const scaled = Number(padded)
  return negative ? -scaled : scaled
}

/** 安全十进制累加：对齐小数位做整数求和，避免 0.1 + 0.2 等浮点漂移 */
export function sumNumbersSafe(values: readonly number[]): number {
  if (values.length === 0) {
    return 0
  }

  let maxScale = 0
  let canScale = true
  for (const val of values) {
    if (!Number.isFinite(val)) {
      continue
    }
    const str = String(val)
    if (str.includes('e') || str.includes('E')) {
      canScale = false
      break
    }
    const dotIdx = str.indexOf('.')
    if (dotIdx !== -1) {
      const fracLen = str.length - dotIdx - 1
      if (fracLen > maxScale) {
        maxScale = fracLen
      }
    }
  }

  if (canScale && maxScale <= 10) {
    const factor = 10 ** maxScale
    let intSum = 0
    let overflow = false
    for (const val of values) {
      if (!Number.isFinite(val)) {
        continue
      }
      const scaled = toScaledInteger(val, maxScale)
      if (!Number.isSafeInteger(scaled)) {
        overflow = true
        break
      }
      intSum += scaled
      if (!Number.isSafeInteger(intSum)) {
        overflow = true
        break
      }
    }
    if (!overflow) {
      return intSum === 0 ? 0 : intSum / factor
    }
  }

  // 超出安全整数范围或科学计数法时回退 Kahan 补偿累加
  let sum = 0
  let compensation = 0
  for (const val of values) {
    if (!Number.isFinite(val)) {
      continue
    }
    const y = val - compensation
    const t = sum + y
    compensation = t - sum - y
    sum = t
  }
  return sum
}

/** 对有限数值数组按 sum / avg / min / max 聚合 */
export function aggregateFiniteNumbers(
  values: readonly number[],
  agg: 'sum' | 'avg' | 'min' | 'max',
): number | null {
  if (agg === 'sum') {
    return sumNumbersSafe(values)
  }
  if (values.length === 0) {
    return null
  }
  if (agg === 'avg') {
    return sumNumbersSafe(values) / values.length
  }
  let best = values[0]!
  if (agg === 'min') {
    for (let i = 1; i < values.length; i++) {
      const val = values[i]!
      if (val < best) {
        best = val
      }
    }
    return best
  }
  for (let i = 1; i < values.length; i++) {
    const val = values[i]!
    if (val > best) {
      best = val
    }
  }
  return best
}
