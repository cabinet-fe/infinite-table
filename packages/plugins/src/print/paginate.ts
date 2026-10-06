// 打印分页引擎（P1 headless 内核，ureport2 双模式移植）：
// fitpage 按行高累加分页 / fixrows 固定行数分页（末页补空白行），每页重复表头区间，
// groupBreakBy 分组换页与两模式正交组合。输出统一 Page 结构供 P2 页面构建渲染。
// 纯函数零 DOM（分层见 types.ts 文件头）。

import { derivePrintableArea, fitWidthScale, type PrintableArea } from './paper'
import type { PrintConfig, PrintSource } from './types'

/** 行区间（源表行号，含 start 不含 end） */
export interface PrintRowRange {
  start: number
  end: number
}

/**
 * 单页分页结果：
 * - rowRange：本页数据行区间（源表行号，不含重复表头行）
 * - headerRows：每页重复的表头行区间（源表前 N 行）；headerRepeatRows = 0 时为 null
 * - blankRows：末尾补的空白行数（fixrows 补齐每页行数一致；fitpage 恒 0）
 * - scale：本页缩放系数（origin 恒 1；fit-width 按可用页宽/内容宽只缩不放）
 */
export interface PrintPage {
  rowRange: PrintRowRange
  headerRows: PrintRowRange | null
  blankRows: number
  scale: number
}

/** 分组换页列（归一化：升序去重；空数组 = 不分组换页） */
type GroupColumns = readonly number[]

/** 归一化 groupBreakBy：单值展开、升序去重（越界列读取恒 undefined 不触发换页，惰性无效） */
function normalizeGroupColumns(groupBreakBy: PrintConfig['groupBreakBy']): GroupColumns {
  const cols = typeof groupBreakBy === 'number' ? [groupBreakBy] : (groupBreakBy ?? [])
  return [...new Set(cols)].sort((a, b) => a - b)
}

/**
 * 分组键：各分组列的 cellValue 串接（原始值口径，不受显示链影响——显示变换不改变
 * 分组语义）。无分组列返回 null（永不换页）。
 */
function makeGroupKey(source: PrintSource, cols: GroupColumns): (row: number) => string | null {
  if (cols.length === 0) {
    return () => null
  }
  return (row) => cols.map((col) => String(source.cellValue(col, row))).join('\u0000')
}

/**
 * 打印分页（headless）：按 PrintConfig 把 PrintSource 的数据行划分为页。
 *
 * - fitpage（缺省）：行高累加至放不下即换页；重复表头行每页先占高；单行高超可用页高
 *   时该行独占一页按原样输出（不截断行）。
 * - fixrows：每页数据行数 = fixRows − headerRepeatRows（ureport2 口径），按行数切页
 *   不看行高；不足一页满额的页（末页、分组提前换页的中间页）补空白行使各页行数一致
 *   （套打行栅格）。fixRows 缺省或 ≤ headerRepeatRows 抛 Error（配置错误快速失败）。
 * - groupBreakBy：指定列值变化处强制换页，两模式通用（fitpage 提前收页 / fixrows
 *   提前切页并补空行）。
 * - scale：fit-width 先按内容宽算缩放系数，行高按系数折算后再累加（等比缩放后
 *   每页可容行数随之增加）。
 *
 * 空表（数据行数为 0）返回空页列表。
 */
export function paginate(source: PrintSource, config: PrintConfig): PrintPage[] {
  const area: PrintableArea = derivePrintableArea(config)
  const headerRepeat = clampHeaderRepeatRows(config.headerRepeatRows, source.rowCount)
  const dataStart = headerRepeat
  const dataEnd = source.rowCount
  const scale = computeScale(source, config, area)
  const headerRows: PrintRowRange | null = headerRepeat > 0 ? { start: 0, end: headerRepeat } : null

  const groupKey = makeGroupKey(source, normalizeGroupColumns(config.groupBreakBy))
  const breakBefore = (row: number): boolean => {
    const next = groupKey(row)
    return next !== null && row > dataStart && next !== groupKey(row - 1)
  }

  if (dataEnd <= dataStart) {
    return []
  }
  if (config.paging === 'fixrows') {
    const quota = resolveFixRowsQuota(config, headerRepeat)
    return paginateFixRows(dataStart, dataEnd, quota, scale, headerRows, breakBefore)
  }
  return paginateFitPage(
    source,
    dataStart,
    dataEnd,
    area,
    scale,
    headerRepeat,
    headerRows,
    breakBefore,
  )
}

/** headerRepeatRows 归一：负数/缺省 0；超行数夹到行数（整表皆表头 → 数据行数为 0） */
function clampHeaderRepeatRows(value: number | undefined, rowCount: number): number {
  return Math.max(0, Math.min(value ?? 0, rowCount))
}

/** 缩放系数：fit-width = 可用页宽 / 内容宽（列宽和，只缩不放）；origin 恒 1 */
function computeScale(source: PrintSource, config: PrintConfig, area: PrintableArea): number {
  if (config.scale !== 'fit-width') {
    return 1
  }
  let contentWidth = 0
  for (let col = 0; col < source.colCount; col++) {
    contentWidth += source.colWidth(col)
  }
  return fitWidthScale(contentWidth, area)
}

/** fixrows 每页数据行数 = fixRows − headerRepeatRows（≥1；配置非法抛 Error） */
function resolveFixRowsQuota(config: PrintConfig, headerRepeat: number): number {
  const fixRows = config.fixRows
  if (fixRows === undefined || !Number.isFinite(fixRows)) {
    throw new Error('fixrows 分页必须配置 fixRows（每页总行数，含重复表头行）')
  }
  const quota = Math.trunc(fixRows) - headerRepeat
  if (quota < 1) {
    throw new Error(`fixRows（${fixRows}）必须大于 headerRepeatRows（${headerRepeat}）`)
  }
  return quota
}

/**
 * fitpage 切页：行高（× scale）累加，加不下即收页；页空时无条件收下首行——
 * 单行高超可用页高时该行独占一页按原样输出。重复表头每页先占高（表头高也随 scale 折算）。
 */
function paginateFitPage(
  source: PrintSource,
  dataStart: number,
  dataEnd: number,
  area: PrintableArea,
  scale: number,
  headerRepeat: number,
  headerRows: PrintRowRange | null,
  breakBefore: (row: number) => boolean,
): PrintPage[] {
  let headerHeight = 0
  for (let row = 0; row < headerRepeat; row++) {
    headerHeight += source.rowHeight(row) * scale
  }
  const available = area.height - headerHeight
  const pages: PrintPage[] = []
  let pageStart = dataStart
  let used = 0
  const closePage = (end: number): void => {
    pages.push({ rowRange: { start: pageStart, end }, headerRows, blankRows: 0, scale })
  }
  for (let row = dataStart; row < dataEnd; row++) {
    const height = source.rowHeight(row) * scale
    if (row > pageStart && (breakBefore(row) || used + height > available)) {
      closePage(row)
      pageStart = row
      used = 0
    }
    used += height
  }
  closePage(dataEnd)
  return pages
}

/**
 * fixrows 切页：按每页数据行数配额切页；分组值变化处提前收页。未满配额的页
 * （末页与分组提前换页的中间页）补空白行，保证各页行数一致（套打行栅格）。
 */
function paginateFixRows(
  dataStart: number,
  dataEnd: number,
  quota: number,
  scale: number,
  headerRows: PrintRowRange | null,
  breakBefore: (row: number) => boolean,
): PrintPage[] {
  const pages: PrintPage[] = []
  let pageStart = dataStart
  let count = 0
  const closePage = (end: number): void => {
    pages.push({ rowRange: { start: pageStart, end }, headerRows, blankRows: quota - count, scale })
  }
  for (let row = dataStart; row < dataEnd; row++) {
    if (count > 0 && (breakBefore(row) || count >= quota)) {
      closePage(row)
      pageStart = row
      count = 0
    }
    count++
  }
  closePage(dataEnd)
  return pages
}
