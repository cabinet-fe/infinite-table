// 打印分页引擎（P1 headless 内核，ureport2 双模式移植）：
// fitpage 按行高累加分页 / fixrows 固定行数分页（末页补空白行），每页重复表头区间，
// groupBreakBy 分组换页与两模式正交组合。输出统一 Page 结构供 P2 页面构建渲染。
// 纯函数零 DOM（分层见 types.ts 文件头）。

import { derivePrintableArea, fitWidthScale, type PrintableArea } from './paper'
import type { PrintConfig, PrintRange, PrintSource } from './types'

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
 * - scale：本页缩放系数（origin 恒 1；fit-width 按可用页宽/内容宽只缩不放；percent 为百分比/100）
 * - colRange：本页列区间（源表列号，含 start 不含 end；全表打印为 [0, colCount)，
 *   超宽表横向分页 / colRange 打印区域裁剪后落到页）
 */
export interface PrintPage {
  rowRange: PrintRowRange
  headerRows: PrintRowRange | null
  blankRows: number
  scale: number
  colRange: PrintRowRange
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
 *   每页可容行数随之增加）；{ percent } 自定义百分比（1–1000，非法值抛 Error）。
 * - rowRange/colRange 打印区域：区间夹取后作为数据域（空/倒置返回空页列表）；
 *   rowRange 与 headerRepeatRows 正交（重复表头恒取源表前 N 行）。
 * - 横向分页：列宽和（× 缩放）超可用页宽时按列切带（fit-width 缩放已保证单带不超宽，
 *   自然不切），页序行带在外列带在内（先下后右）；跨列带的合并格按带裁剪输出。
 *
 * 空表（数据行数为 0）或空打印区域返回空页列表。
 */
export function paginate(source: PrintSource, config: PrintConfig): PrintPage[] {
  const area: PrintableArea = derivePrintableArea(config)
  const headerRepeat = clampHeaderRepeatRows(config.headerRepeatRows, source.rowCount)
  const rowDomain = resolveRowDomain(config.rowRange, source.rowCount, headerRepeat)
  const colDomain = clampPrintRange(config.colRange, source.colCount)
  if (!rowDomain || !colDomain) {
    return []
  }
  const scale = computeScale(source, config, area, colDomain)
  const headerRows: PrintRowRange | null = headerRepeat > 0 ? { start: 0, end: headerRepeat } : null

  const groupKey = makeGroupKey(source, normalizeGroupColumns(config.groupBreakBy))
  const breakBefore = (row: number): boolean => {
    const next = groupKey(row)
    return next !== null && row > rowDomain.start && next !== groupKey(row - 1)
  }

  const rowBands =
    config.paging === 'fixrows'
      ? paginateFixRows(
          rowDomain.start,
          rowDomain.end,
          resolveFixRowsQuota(config, headerRepeat),
          scale,
          headerRows,
          breakBefore,
        )
      : paginateFitPage(
          source,
          rowDomain.start,
          rowDomain.end,
          area,
          scale,
          headerRepeat,
          headerRows,
          breakBefore,
        )
  const colBands = paginateColumns(source, colDomain, scale, area)
  const pages: PrintPage[] = []
  for (const rowBand of rowBands) {
    for (const colBand of colBands) {
      pages.push({ ...rowBand, colRange: colBand })
    }
  }
  return pages
}

/** headerRepeatRows 归一：负数/缺省 0；超行数夹到行数（整表皆表头 → 数据行数为 0） */
export function clampHeaderRepeatRows(value: number | undefined, rowCount: number): number {
  return Math.max(0, Math.min(value ?? 0, rowCount))
}

/** 区间归一：夹取到 [0, size) 且保证 start < end；缺省全量，空/倒置返回 null */
function clampPrintRange(range: PrintRange | undefined, size: number): PrintRowRange | null {
  if (!range) {
    return { start: 0, end: size }
  }
  const start = Math.max(0, Math.min(Math.trunc(range.start), size))
  const end = Math.max(0, Math.min(Math.trunc(range.end), size))
  return start < end ? { start, end } : null
}

/** 数据行域：行区间夹取后与表头带正交（起点落在表头带内时数据域从表头带之后开始） */
function resolveRowDomain(
  range: PrintRange | undefined,
  rowCount: number,
  headerRepeat: number,
): PrintRowRange | null {
  const domain = clampPrintRange(range, rowCount)
  if (!domain) {
    return null
  }
  const start = Math.max(domain.start, headerRepeat)
  return start < domain.end ? { start, end: domain.end } : null
}

/** 缩放系数：origin 恒 1；{ percent } 自定义百分比；fit-width = 可用页宽 / 内容宽（列宽和，只缩不放） */
function computeScale(
  source: PrintSource,
  config: PrintConfig,
  area: PrintableArea,
  colRange: PrintRowRange,
): number {
  const scale = config.scale
  if (typeof scale === 'object') {
    const percent = scale.percent
    if (!Number.isFinite(percent) || percent < 1 || percent > 1000) {
      throw new Error(`自定义缩放百分比必须为 1–1000 的有限数值：${JSON.stringify(scale)}`)
    }
    return percent / 100
  }
  if (scale !== 'fit-width') {
    return 1
  }
  let contentWidth = 0
  for (let col = colRange.start; col < colRange.end; col++) {
    contentWidth += source.colWidth(col)
  }
  return fitWidthScale(contentWidth, area)
}

/**
 * 列带切分：列宽（× 缩放）累加至超可用页宽即收带；单列超宽时该列独占一带按原样
 * 输出（不截断列）。fit-width 缩放后全表不超页宽，自然只产出单一带。
 */
function paginateColumns(
  source: PrintSource,
  domain: PrintRowRange,
  scale: number,
  area: PrintableArea,
): PrintRowRange[] {
  const bands: PrintRowRange[] = []
  let bandStart = domain.start
  let used = 0
  for (let col = domain.start; col < domain.end; col++) {
    const width = source.colWidth(col) * scale
    if (col > bandStart && used + width > area.width) {
      bands.push({ start: bandStart, end: col })
      bandStart = col
      used = 0
    }
    used += width
  }
  bands.push({ start: bandStart, end: domain.end })
  return bands
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

/** 行带：行方向分页产物（列带叉乘后补 colRange 落页） */
type RowBand = Omit<PrintPage, 'colRange'>

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
): RowBand[] {
  let headerHeight = 0
  for (let row = 0; row < headerRepeat; row++) {
    headerHeight += source.rowHeight(row) * scale
  }
  const available = area.height - headerHeight
  const pages: RowBand[] = []
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
): RowBand[] {
  const pages: RowBand[] = []
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
