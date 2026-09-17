// 基准场景：TTFF、稳态滚动 FPS、失效面积收敛（滚动 + 快速跳转 + hover 并发）。
// 场景只依赖 BenchEnv 抽象，headless 与浏览器跑同一份逻辑。

import { BENCH_COLS, BENCH_ROWS, VIEWPORT_AREA, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from './dataset'
import type { BenchEnv, BenchTable } from './env'
import type { LayerInvalidationStats } from './invalidation-meter'
import type { BenchCheck, BenchMetric, BenchReport, ScenarioResult } from './report'
import {
  BODY_AREA_RATIO_MAX,
  BODY_FULL_REPAINT_MAX,
  SCROLL_FPS_MIN,
  TTFF_P50_MAX_MS,
} from './thresholds'

/** 每帧滚动步长（px）与测量帧数：300 帧 ≈ 60fps 下 5s 稳态窗口（07 §1.1 Scroll FPS 口径） */
const SCROLL_STEP_Y = 120
const SCROLL_WARMUP_FRAMES = 30
const SCROLL_MEASURE_FRAMES = 300
const TTFF_ITERATIONS = 5

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

/** 首帧落地：构造提交的 full 失效在下一帧 flush 完成，此后 drain 从干净状态起计 */
async function settleFirstFrame(bt: BenchTable): Promise<void> {
  await bt.beginFrame()
  bt.endFrame()
  bt.meter.drain()
}

/**
 * TTFF：构造（含同步建窗口场景与首帧失效提交）→ 首帧 flush 完成的耗时，
 * 对齐 07 §1.1「performance.now() 包裹 constructor 含首绘」语义；取 P50 判定 ≤80ms。
 */
async function runTtff(env: BenchEnv): Promise<ScenarioResult> {
  const ttffSamples: number[] = []
  const constructorSamples: number[] = []
  for (let i = 0; i < TTFF_ITERATIONS; i++) {
    const bt = env.createTable()
    const t0 = performance.now()
    await bt.beginFrame()
    bt.endFrame()
    // TTFF = 同步构造 + 首帧 flush 完成（07 §1.1：constructor 含首绘）
    ttffSamples.push(bt.constructorMs + (performance.now() - t0))
    constructorSamples.push(bt.constructorMs)
    bt.destroy()
  }
  const p50 = percentile(ttffSamples, 50)
  const metrics: BenchMetric[] = [
    { label: 'TTFF P50', value: `${fixed(p50)}ms` },
    { label: 'TTFF 各次', value: ttffSamples.map((s) => fixed(s)).join(' / ') },
    {
      label: 'constructor P50（不含首帧 flush）',
      value: `${fixed(percentile(constructorSamples, 50))}ms`,
    },
  ]
  const checks: BenchCheck[] = [
    { label: `TTFF P50 ≤ ${TTFF_P50_MAX_MS}ms（07 §1.2 M1）`, passed: p50 <= TTFF_P50_MAX_MS },
  ]
  return {
    id: 'ttff',
    title: `TTFF 首帧时间（${BENCH_ROWS} 行 × ${BENCH_COLS} 列固定尺寸，${TTFF_ITERATIONS} 次）`,
    passed: checks.every((check) => check.passed),
    metrics,
    checks,
  }
}

/**
 * 稳态滚动 FPS：10 万行固定行高持续纵向滚动，
 * 逐帧间隔均值换算 FPS（浏览器为 rAF 真实帧率；headless 为 JS 侧可持续帧率），判定 ≥55fps。
 */
async function runScrollFps(env: BenchEnv): Promise<ScenarioResult> {
  const bt = env.createTable()
  await settleFirstFrame(bt)
  const intervals: number[] = []
  const workMs: number[] = []
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
  }
  bt.destroy()
  const measuredIntervals = intervals.slice(SCROLL_WARMUP_FRAMES)
  const measuredWork = workMs.slice(SCROLL_WARMUP_FRAMES)
  const meanFps = 1000 / mean(measuredIntervals)
  const metrics: BenchMetric[] = [
    { label: '稳态滚动平均 FPS', value: fixed(meanFps) },
    { label: '帧间隔 P95', value: `${fixed(percentile(measuredIntervals, 95), 2)}ms` },
    { label: '帧间隔 P50', value: `${fixed(percentile(measuredIntervals, 50), 2)}ms` },
    {
      label: 'JS 侧帧耗时 P95（滚动 + 场景重建 + flush）',
      value: `${fixed(percentile(measuredWork, 95), 2)}ms`,
    },
  ]
  const checks: BenchCheck[] = [
    {
      label: `稳态滚动平均 FPS ≥ ${SCROLL_FPS_MIN}（README 目标）`,
      passed: meanFps >= SCROLL_FPS_MIN,
    },
  ]
  return {
    id: 'scroll-fps',
    title: `滚动 FPS（${BENCH_ROWS} 行固定行高，${SCROLL_MEASURE_FRAMES} 帧 × ${SCROLL_STEP_Y}px）`,
    passed: checks.every((check) => check.passed),
    metrics,
    checks,
  }
}

interface FrameAreaSample {
  bodyArea: number
  bodyFull: number
}

function areaOf(stats: Map<string, LayerInvalidationStats>, kind: string): FrameAreaSample {
  const layer = stats.get(kind)
  return { bodyArea: layer?.area ?? 0, bodyFull: layer?.full ?? 0 }
}

/**
 * 失效面积收敛（07 §1.1：每帧失效像素面积 / 视口面积）：
 * - 稳态滚动：body 层每帧收敛于单条滚动 band（面积 ≤ 1× 视口），无 full 全量重绘；
 * - 快速拖滚动条（大幅跳转）：不出现全量重绘路径（README：拖滚动条不再退化为全量重绘）；
 * - hover + 滚动并发：hover 高亮走 sky 层独立重绘（03 §4.2），body 面积不超过纯滚动水平。
 */
async function runInvalidation(env: BenchEnv): Promise<ScenarioResult> {
  const bt = env.createTable()
  await settleFirstFrame(bt)

  const steady: FrameAreaSample[] = []
  for (let i = 0; i < 120; i++) {
    await bt.beginFrame()
    bt.table.scrollBy(0, SCROLL_STEP_Y)
    bt.endFrame()
    steady.push(areaOf(bt.meter.drain(), 'body'))
  }

  const fast: FrameAreaSample[] = []
  for (const top of [2_000_000, 500_000, 2_800_000, 0]) {
    await bt.beginFrame()
    bt.table.scrollTo(0, top)
    bt.endFrame()
    fast.push(areaOf(bt.meter.drain(), 'body'))
  }

  const hover: FrameAreaSample[] = []
  for (let i = 0; i < 60; i++) {
    await bt.beginFrame()
    bt.table.scrollBy(0, SCROLL_STEP_Y)
    bt.hoverAt(60 + (i % 8) * 100, 50 + (i % 6) * 32)
    bt.endFrame()
    hover.push(areaOf(bt.meter.drain(), 'body'))
  }
  bt.destroy()

  const ratio = (area: number): number => area / VIEWPORT_AREA
  const maxOf = (samples: readonly FrameAreaSample[], pick: (s: FrameAreaSample) => number) =>
    Math.max(0, ...samples.map(pick))
  const steadyMaxRatio = ratio(maxOf(steady, (s) => s.bodyArea))
  const hoverMaxRatio = ratio(maxOf(hover, (s) => s.bodyArea))
  const fullTotal = (samples: readonly FrameAreaSample[]) =>
    samples.reduce((sum, s) => sum + s.bodyFull, 0)

  const metrics: BenchMetric[] = [
    { label: '稳态滚动单帧 body 失效面积 / 视口（最大）', value: fixed(steadyMaxRatio, 3) },
    { label: 'hover 并发单帧 body 失效面积 / 视口（最大）', value: fixed(hoverMaxRatio, 3) },
    {
      label: 'body full 次数（稳态 / 快跳 / hover）',
      value: `${fullTotal(steady)} / ${fullTotal(fast)} / ${fullTotal(hover)}`,
    },
  ]
  const checks: BenchCheck[] = [
    {
      label: `稳态滚动无 full 全量重绘（≤ ${BODY_FULL_REPAINT_MAX}，README「无全量重绘路径」）`,
      passed: fullTotal(steady) <= BODY_FULL_REPAINT_MAX,
    },
    {
      label: `快速拖滚动条无 full 全量重绘（≤ ${BODY_FULL_REPAINT_MAX}）`,
      passed: fullTotal(fast) <= BODY_FULL_REPAINT_MAX,
    },
    {
      label: `单帧 body 失效面积收敛于单条 band（≤ ${BODY_AREA_RATIO_MAX}× 视口）`,
      passed: steadyMaxRatio <= BODY_AREA_RATIO_MAX,
    },
    {
      label: `hover 并发不放大 body 失效面积（03 §4.2：hover 走 sky 独立重绘）`,
      passed: hoverMaxRatio <= steadyMaxRatio + 0.001 && fullTotal(hover) <= BODY_FULL_REPAINT_MAX,
    },
  ]
  return {
    id: 'invalidation-area',
    title: `失效面积收敛（视口 ${VIEWPORT_WIDTH}×${VIEWPORT_HEIGHT}，滚动/快跳/hover 并发）`,
    passed: checks.every((check) => check.passed),
    metrics,
    checks,
  }
}

export async function runAllScenarios(env: BenchEnv): Promise<BenchReport> {
  const startedAt = new Date()
  const t0 = performance.now()
  const scenarios = [await runTtff(env), await runScrollFps(env), await runInvalidation(env)]
  return {
    tool: 'infinite-table-bench',
    env: env.name,
    dataset: `${BENCH_ROWS} 行 × ${BENCH_COLS} 列固定尺寸（视口 ${VIEWPORT_WIDTH}×${VIEWPORT_HEIGHT}）`,
    startedAt: startedAt.toISOString(),
    durationMs: performance.now() - t0,
    passed: scenarios.every((scenario) => scenario.passed),
    scenarios,
  }
}
