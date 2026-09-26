// 图表格场景口径（chart-support P5）：含图表格的稳态滚动 FPS 与失效面积收敛
// （稳态滚动收敛 / 快速跳转 / 滚回缓存命中直贴 / 数据变更 cell 失效重绘）。
// 场景只依赖 BenchEnv 抽象，headless 与浏览器跑同一份逻辑；失效口径同现有场景
// （每帧失效像素面积 / 视口面积，full 全量重绘要求为 0，出图位图落 L2 media cell 级缓存）。

import type {
  ColumnDefine,
  ListTableOptions,
  ResolveDisplayValue,
  TablePlugin,
} from '@infinite-table/core'
import type { RenderHost } from '@infinite-table/render'
import type { ChartCellDeclaration } from '@infinite-table/plugins'

import { VIEWPORT_AREA, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from './dataset'
import type { BenchEnv, BenchTable } from './env'
import type { BenchCheck, BenchMetric, ScenarioResult } from './report'
import { BODY_AREA_RATIO_MAX, BODY_FULL_REPAINT_MAX, SCROLL_FPS_MIN } from './thresholds'

/** 图表格行数（滚动余量：330 帧 × 120px ≈ 4 万px 滚程，最大滚程约 8.3 万px） */
const CHART_ROW_COUNT = 1000
/** 行高与图表列宽（对齐 demo 滚动图表格口径：84px 行高 / 150px 图表列宽） */
const CHART_ROW_HEIGHT = 84
const CHART_COL_WIDTH = 150
/** 图表列：col 1 柱状、col 2 折线 */
const CHART_BAR_COL = 1
const CHART_LINE_COL = 2
/** 声明按行取模共享的变体数（同 key 单飞出图 + cell 级缓存共享，对齐 demo 滚动口径） */
const CHART_VARIANTS = 6
const CHART_LABELS = ['一月', '二月', '三月', '四月']

// 滚动口径同 scenarios.ts runScrollFps（120px/帧，30 帧预热 + 300 帧测量）
const SCROLL_STEP_Y = 120
const SCROLL_WARMUP_FRAMES = 30
const SCROLL_MEASURE_FRAMES = 300
const SETTLE_MAX_ROUNDS = 100

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]!
}

function fixed(value: number, digits = 1): string {
  return value.toFixed(digits)
}

/** 首帧落地：构造提交的 full 失效在下一帧 flush 完成，此后 drain 从干净状态起计（口径同 scenarios.ts） */
async function settleFirstFrame(bt: BenchTable): Promise<void> {
  await bt.beginFrame()
  bt.endFrame()
  bt.meter.drain()
}

/**
 * 首屏图表格位图等待：首帧登记出图 → 单飞落定回填。
 * 每轮 await 一帧 + setTimeout 让渡事件循环：Chart.js 首次动态 import 的模块加载续延
 * 落在宏任务上，只排空微任务等不到它；headless 与浏览器同一等待口径。
 */
async function settleChartBitmaps(bt: BenchTable): Promise<number> {
  let rounds = 0
  for (; rounds < SETTLE_MAX_ROUNDS; rounds++) {
    const nodes = [...bt.table.chartCellNodes.values()]
    if (nodes.length > 0 && nodes.every((node) => node.hasBitmap)) {
      break
    }
    await bt.beginFrame()
    bt.endFrame()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return rounds
}

// ---- 表口径（headless 与浏览器共用同一份列/声明/解析器） ----

/** 变体基础数据（数值面独立保存，数据变更场景按此重写共享声明数组） */
const barVariantData: number[][] = Array.from({ length: CHART_VARIANTS }, (_, variant) => [
  20 + variant * 6,
  14 + variant * 3,
  28 - variant * 2,
  18 + variant * 4,
])
const lineVariantData: number[][] = Array.from({ length: CHART_VARIANTS }, (_, variant) => [
  10 + variant * 3,
  18 + variant * 2,
  24 - variant * 2,
  30 + variant * 2,
])

/** 柱状/折线声明 ×6（对象身份稳定：插件声明 memo 与缓存 key 收敛的前提，同 demo 滚动口径） */
const barDeclarations: ChartCellDeclaration[] = barVariantData.map((data) => ({
  type: 'bar',
  labels: CHART_LABELS,
  datasets: [{ label: '销量', data }],
}))
const lineDeclarations: ChartCellDeclaration[] = lineVariantData.map((data) => ({
  type: 'line',
  labels: CHART_LABELS,
  datasets: [{ label: '环比', data }],
}))

/** 图表列声明解析（env 无关，headless 与浏览器注入同一份） */
export function resolveChartCellDeclaration(col: number, row: number): ChartCellDeclaration | null {
  if (col === CHART_BAR_COL) {
    return barDeclarations[row % CHART_VARIANTS] ?? null
  }
  if (col === CHART_LINE_COL) {
    return lineDeclarations[row % CHART_VARIANTS] ?? null
  }
  return null
}

/** 列定义：1 个文本列 + 柱状/折线两个图表列 */
function createChartColumns(): ColumnDefine[] {
  return [
    { title: '地区', width: 160 },
    { title: '销量（柱状）', width: CHART_COL_WIDTH },
    { title: '环比（折线）', width: CHART_COL_WIDTH },
  ]
}

/** 文本列显示值（图表格为位图格，无文本） */
const chartDisplayValue: ResolveDisplayValue = (col, row) => (col === 0 ? `地区-${row}` : '')

/** chart 口径 ListTable 参数（headless 与浏览器同一份表口径）：host 与 chart 插件由 env 注入 */
export function chartTableOptions(
  host: RenderHost,
  plugins: readonly TablePlugin[],
): ListTableOptions {
  return {
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    columns: createChartColumns(),
    rowCount: CHART_ROW_COUNT,
    rowHeight: CHART_ROW_HEIGHT,
    resolveDisplayValue: chartDisplayValue,
    host,
    plugins,
  }
}

/** 数据变更口径：轮换第 variant 组柱状数据（声明内容换 key → cell 三档失效重绘） */
function bumpBarDeclaration(variant: number): void {
  const data = barVariantData[variant]
  if (data) {
    data[0] = (data[0] ?? 0) + 5
  }
}

interface FrameAreaSample {
  bodyArea: number
  bodyFull: number
}

function areaOf(stats: Map<string, { area: number; full: number }>, kind: string): FrameAreaSample {
  const layer = stats.get(kind)
  return { bodyArea: layer?.area ?? 0, bodyFull: layer?.full ?? 0 }
}

/**
 * 图表格稳态滚动 FPS：1000 行图表格（柱状/折线两图表列）持续纵向滚动，
 * 口径同 runScrollFps（30 帧预热 + 300 帧 × 120px，逐帧间隔均值换算 FPS，判定 ≥55fps）。
 * 首屏出图完成后再测：稳态窗口为纯缓存命中回贴，media 层 cell 失效应为 0（无重出图）。
 */
async function runChartScrollFps(env: BenchEnv): Promise<ScenarioResult> {
  const bt = env.createChartTable()
  await settleFirstFrame(bt)
  const settleRounds = await settleChartBitmaps(bt)
  bt.meter.drain()

  const intervals: number[] = []
  const workMs: number[] = []
  const mediaCells: number[] = []
  let prevStart = performance.now()
  const total = SCROLL_WARMUP_FRAMES + SCROLL_MEASURE_FRAMES
  for (let i = 0; i < total; i++) {
    await bt.beginFrame()
    const start = performance.now()
    bt.table.scrollBy(0, SCROLL_STEP_Y)
    bt.endFrame()
    workMs.push(performance.now() - start)
    intervals.push(start - prevStart)
    prevStart = start
    if (i >= SCROLL_WARMUP_FRAMES) {
      mediaCells.push(bt.meter.drain().get('media')?.cell ?? 0)
    }
  }
  bt.destroy()
  const measuredIntervals = intervals.slice(SCROLL_WARMUP_FRAMES)
  const measuredWork = workMs.slice(SCROLL_WARMUP_FRAMES)
  const mediaCellTotal = mediaCells.reduce((sum, value) => sum + value, 0)
  const meanFps = 1000 / mean(measuredIntervals)
  const metrics: BenchMetric[] = [
    { label: '图表格稳态滚动平均 FPS', value: fixed(meanFps) },
    { label: '帧间隔 P95', value: `${fixed(percentile(measuredIntervals, 95), 2)}ms` },
    { label: '帧间隔 P50', value: `${fixed(percentile(measuredIntervals, 50), 2)}ms` },
    {
      label: 'JS 侧帧耗时 P95（滚动 + 场景重建 + flush）',
      value: `${fixed(percentile(measuredWork, 95), 2)}ms`,
    },
    { label: '首屏出图等待轮次（await 帧数）', value: String(settleRounds) },
    { label: '测量窗口 media cell 失效合计', value: String(mediaCellTotal) },
  ]
  const checks: BenchCheck[] = [
    {
      label: `图表格稳态滚动平均 FPS ≥ ${SCROLL_FPS_MIN}（口径同 runScrollFps）`,
      passed: meanFps >= SCROLL_FPS_MIN,
    },
    {
      label: `稳态滚动无重出图（测量窗口 media cell 失效 ${mediaCellTotal} 次，要求 0：命中缓存直接回贴）`,
      passed: mediaCellTotal === 0,
    },
  ]
  return {
    id: 'chart-scroll-fps',
    title: `图表格滚动 FPS（${CHART_ROW_COUNT} 行 × ${CHART_ROW_HEIGHT}px 行高，柱状/折线两图表列，${SCROLL_MEASURE_FRAMES} 帧 × ${SCROLL_STEP_Y}px）`,
    passed: checks.every((check) => check.passed),
    metrics,
    checks,
  }
}

/**
 * 图表格失效面积收敛（口径同 runInvalidation：每帧失效像素面积 / 视口面积）：
 * - 稳态滚动：body / media 两层每帧收敛于单条滚动 band（≤1× 视口），无 full 全量重绘；
 * - 快速跳转：不出现 full 全量重绘路径；
 * - 滚回首帧：可视图表格全部命中 cell 级缓存直贴（无闪协议），不新增出图、不新增缓存条目；
 * - 数据变更：声明内容换 key → refreshCell 定向 cell 失效重绘，不引发 body / full 失效。
 */
async function runChartInvalidation(env: BenchEnv): Promise<ScenarioResult> {
  const bt = env.createChartTable()
  await settleFirstFrame(bt)
  await settleChartBitmaps(bt)
  bt.meter.drain()

  const steady: FrameAreaSample[] = []
  const steadyMedia: FrameAreaSample[] = []
  for (let i = 0; i < 120; i++) {
    await bt.beginFrame()
    bt.table.scrollBy(0, SCROLL_STEP_Y)
    bt.endFrame()
    const stats = bt.meter.drain()
    steady.push(areaOf(stats, 'body'))
    steadyMedia.push(areaOf(stats, 'media'))
  }

  // 快速跳转目标在最大滚程内（1000 行 × 84px 行高，最大约 8.3 万px）
  const fast: FrameAreaSample[] = []
  for (const top of [60_000, 20_000, 80_000]) {
    await bt.beginFrame()
    bt.table.scrollTo(0, top)
    bt.endFrame()
    fast.push(areaOf(bt.meter.drain(), 'body'))
  }

  // 滚回首帧：缓存命中直贴（无闪协议），出图位图不经重出图、缓存条目不增长
  const cacheSizeBeforeScrollBack = bt.table.mediaCache.size
  await bt.beginFrame()
  bt.table.scrollTo(0, 0)
  bt.endFrame()
  const scrollBackFull = areaOf(bt.meter.drain(), 'body').bodyFull
  const visibleNodes = [...bt.table.chartCellNodes.values()]
  const hitCount = visibleNodes.filter((node) => node.hasBitmap).length
  const cacheSizeAfterScrollBack = bt.table.mediaCache.size

  // 数据变更：轮换一组柱状数据（内容换 key）→ refreshCell 定向失效重绘
  const nodeBefore = visibleNodes.find((node) => node.col === CHART_BAR_COL && node.row === 0)
  const cacheKeyBefore = nodeBefore?.cacheKey ?? ''
  bumpBarDeclaration(0)
  bt.table.refreshCell(CHART_BAR_COL, 0)
  const refreshStats = bt.meter.drain()
  const refreshCellCount = refreshStats.get('media')?.cell ?? 0
  const refreshFullCount =
    (refreshStats.get('body')?.full ?? 0) + (refreshStats.get('media')?.full ?? 0)
  await settleChartBitmaps(bt)
  const nodeAfter = [...bt.table.chartCellNodes.values()].find(
    (node) => node.col === CHART_BAR_COL && node.row === 0,
  )
  const cacheKeyChanged = nodeAfter !== undefined && nodeAfter.cacheKey !== cacheKeyBefore
  const cacheSizeAfterBump = bt.table.mediaCache.size
  bt.destroy()

  const ratio = (area: number): number => area / VIEWPORT_AREA
  const maxOf = (samples: readonly FrameAreaSample[], pick: (s: FrameAreaSample) => number) =>
    Math.max(0, ...samples.map(pick))
  const fullTotal = (samples: readonly FrameAreaSample[]) =>
    samples.reduce((sum, s) => sum + s.bodyFull, 0)
  const steadyMaxRatio = ratio(maxOf(steady, (s) => s.bodyArea))
  const steadyMediaMaxRatio = ratio(maxOf(steadyMedia, (s) => s.bodyArea))

  const metrics: BenchMetric[] = [
    { label: '稳态滚动单帧 body 失效面积 / 视口（最大）', value: fixed(steadyMaxRatio, 3) },
    { label: '稳态滚动单帧 media 失效面积 / 视口（最大）', value: fixed(steadyMediaMaxRatio, 3) },
    {
      label: 'body full 次数（稳态 / 快跳 / 滚回）',
      value: `${fullTotal(steady)} / ${fullTotal(fast)} / ${scrollBackFull}`,
    },
    {
      label: '滚回首帧图表格缓存命中',
      value: `${hitCount} / ${visibleNodes.length}`,
    },
    {
      label: `数据变更 media cell 失效 / 缓存条目增长`,
      value: `${refreshCellCount} / ${cacheSizeAfterBump - cacheSizeAfterScrollBack}`,
    },
  ]
  const checks: BenchCheck[] = [
    {
      label: `稳态滚动 body 无 full 全量重绘（≤ ${BODY_FULL_REPAINT_MAX}，口径同 runInvalidation）`,
      passed: fullTotal(steady) <= BODY_FULL_REPAINT_MAX,
    },
    {
      label: `稳态滚动 media 无 full 全量重绘（≤ ${BODY_FULL_REPAINT_MAX}）`,
      passed: steadyMedia.every((s) => s.bodyFull <= BODY_FULL_REPAINT_MAX),
    },
    {
      label: `单帧 body 失效面积收敛于单条 band（≤ ${BODY_AREA_RATIO_MAX}× 视口）`,
      passed: steadyMaxRatio <= BODY_AREA_RATIO_MAX,
    },
    {
      label: `单帧 media 失效面积收敛于单条 band（≤ ${BODY_AREA_RATIO_MAX}× 视口）`,
      passed: steadyMediaMaxRatio <= BODY_AREA_RATIO_MAX,
    },
    {
      label: `快速拖滚动条无 body full 全量重绘（≤ ${BODY_FULL_REPAINT_MAX}）`,
      passed: fullTotal(fast) <= BODY_FULL_REPAINT_MAX,
    },
    {
      label: `滚回首帧可视图表格全部命中 cell 级缓存直贴（${hitCount}/${visibleNodes.length}，无闪协议）`,
      passed:
        visibleNodes.length > 0 &&
        hitCount === visibleNodes.length &&
        scrollBackFull === 0 &&
        cacheSizeAfterScrollBack === cacheSizeBeforeScrollBack,
    },
    {
      label: `数据变更按 cell 三档失效重绘（media cell 失效 + 内容换 key 重出图 + 无 full）`,
      passed:
        refreshCellCount > 0 &&
        refreshFullCount === 0 &&
        nodeAfter !== undefined &&
        nodeAfter.hasBitmap &&
        cacheKeyChanged &&
        cacheSizeAfterBump === cacheSizeAfterScrollBack + 1,
    },
  ]
  return {
    id: 'chart-invalidation',
    title: `图表格失效面积收敛（视口 ${VIEWPORT_WIDTH}×${VIEWPORT_HEIGHT}，滚动/快跳/滚回命中/数据变更）`,
    passed: checks.every((check) => check.passed),
    metrics,
    checks,
  }
}

export async function runChartScenarios(env: BenchEnv): Promise<ScenarioResult[]> {
  return [await runChartScrollFps(env), await runChartInvalidation(env)]
}
