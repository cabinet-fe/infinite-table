// vs 场景循环：同一份口径在两库上、按数据规模（10 万 / 100 万行）各跑一遍，输出逐指标数值。
// 口径与 apps/bench 既有场景对齐：TTFF = 构造 + 首帧 flush（单 rAF，等待本身不计额外帧）；
// 稳态滚动 = 逐帧 scrollBy 后 rAF 帧间隔；写入落在可视区（产生真实失效）；
// 重建 = 构造 + 首帧（销毁在计时窗外）。
// 每个规模内跑序 [ours, vtable, vtable, ours] 两两对称，取均值抗 JIT/顺序偏差。

import type { DataRecord } from '@infinitable/core'
import { version as vtableVersion } from '@visactor/vtable'

import { BENCH_COLS, VIEWPORT_HEIGHT } from '../dataset'
import type { VsLibrary, VsTableOps } from './adapters'
import { VS_ROW_HEIGHT } from './adapters'

/** 3 倍速滚动步长：常规 120px 两库都能满帧，加压拉开帧预算差异 */
const SCROLL_STEP_Y = 360
const SCROLL_WARMUP_FRAMES = 30
const SCROLL_MEASURE_FRAMES = 300
/** 大幅跳转次数（快速拖滚动条口径，目标偏移由固定序列生成保证两库一致） */
const JUMP_FRAMES = 60
/** 大规模档的 TTFF/重建迭代数收紧（单次构造变慢，控制总时长；两库同档同数） */
const BIG_SCALE = 1_000_000
const BIG_TTFF_ITERATIONS = 3
const SMALL_TTFF_ITERATIONS = 5
/** 逐格写基准量；两库共用同一 N（见下方超时保护校准）。加大到 5000 让同步成本主导计时窗 */
const WRITE_COUNT_MAX = 5000
const WRITE_COUNT_FLOOR = 500
/** 单场景上限：超时则按比例降两库写入量（口径仍一致） */
const WRITE_BUDGET_MS = 15_000
/** 批量写区域：100 行 × 20 列 = 2000 格 */
const BATCH_ROWS = 100
const BATCH_CELLS = BATCH_ROWS * BENCH_COLS
/** 可视行数（720 视口 / 32 行高，向下取整）：写场景全部落在产生失效的行 */
const VISIBLE_ROWS = Math.floor(VIEWPORT_HEIGHT / VS_ROW_HEIGHT)

export interface VsSample {
  /** 指标 id（跨轮聚合键，规模内唯一） */
  id: string
  /** 数据规模（行数） */
  scale: number
  label: string
  group: string
  unit: 'ms' | 'fps' | 'ops/ms'
  /** lower = 数值越小越好；higher = 越大越好 */
  better: 'lower' | 'higher'
  value: number
  /** 口径补充说明（如实际写入次数） */
  note?: string
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

function raf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function scaleLabel(rows: number): string {
  return `${rows / 10_000} 万行`
}

/** 构造 → 首帧落地（单 rAF：只计首个 flush 帧，不让额外等待淹没计时窗） */
async function settleFirstFrame(ops: VsTableOps): Promise<void> {
  await raf()
  ops.scrollOffsetY()
}

async function measureTtff(
  library: VsLibrary,
  container: HTMLElement,
  records: DataRecord[],
  rows: number,
): Promise<VsSample[]> {
  const iterations = rows >= BIG_SCALE ? BIG_TTFF_ITERATIONS : SMALL_TTFF_ITERATIONS
  const ttffs: number[] = []
  const constructs: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    const { ops, constructMs } = library.createTable(container, records)
    await settleFirstFrame(ops)
    ttffs.push(performance.now() - t0)
    constructs.push(constructMs)
    ops.destroy()
    await raf()
  }
  return [
    {
      id: 'ttff-p50',
      scale: rows,
      label: '首次渲染时间（TTFF）P50',
      group: '首次渲染（TTFF）',
      unit: 'ms',
      better: 'lower',
      value: percentile(ttffs, 50),
      note: `${iterations} 次「new Table(10 万/100 万行数据) → 内容首帧画完」`,
    },
    {
      id: 'construct-p50',
      scale: rows,
      label: '构造耗时 P50（同步构造，不含首帧 flush）',
      group: '首次渲染（TTFF）',
      unit: 'ms',
      better: 'lower',
      value: percentile(constructs, 50),
    },
  ]
}

async function measureScroll(
  library: VsLibrary,
  container: HTMLElement,
  records: DataRecord[],
  rows: number,
): Promise<VsSample[]> {
  const group = `稳态滚动`
  const { ops } = library.createTable(container, records)
  await settleFirstFrame(ops)
  const intervals: number[] = []
  const works: number[] = []
  let prev = performance.now()
  const total = SCROLL_WARMUP_FRAMES + SCROLL_MEASURE_FRAMES
  for (let i = 0; i < total; i++) {
    await raf()
    const start = performance.now()
    ops.scrollByPx(SCROLL_STEP_Y)
    works.push(performance.now() - start)
    intervals.push(start - prev)
    prev = start
  }
  const scrolled = ops.scrollOffsetY()
  ops.destroy()
  if (scrolled < SCROLL_MEASURE_FRAMES * SCROLL_STEP_Y * 0.5) {
    throw new Error(`${library.name} 滚动未生效（offsetY=${scrolled}），FPS 数据无效`)
  }
  const measuredIntervals = intervals.slice(SCROLL_WARMUP_FRAMES)
  const measuredWorks = works.slice(SCROLL_WARMUP_FRAMES)
  return [
    {
      id: 'scroll-fps',
      scale: rows,
      label: '稳态滚动平均 FPS',
      group,
      unit: 'fps',
      better: 'higher',
      value: 1000 / mean(measuredIntervals),
      note: `${SCROLL_MEASURE_FRAMES} 帧 × ${SCROLL_STEP_Y}px/帧`,
    },
    {
      id: 'scroll-interval-p95',
      scale: rows,
      label: '滚动帧间隔 P95',
      group,
      unit: 'ms',
      better: 'lower',
      value: percentile(measuredIntervals, 95),
    },
    {
      id: 'scroll-work-p95',
      scale: rows,
      label: '滚动调用 JS 耗时 P95',
      group,
      unit: 'ms',
      better: 'lower',
      value: percentile(measuredWorks, 95),
    },
  ]
}

/** 大幅跳转（快速拖滚动条）：固定伪随机目标序列，两库一致；目标上界随表高走 */
function jumpTargets(maxTop: number): number[] {
  return Array.from({ length: JUMP_FRAMES }, (_, i) => ((i + 1) * 99_793) % maxTop)
}

async function measureJumpScroll(
  library: VsLibrary,
  container: HTMLElement,
  records: DataRecord[],
  rows: number,
): Promise<VsSample[]> {
  const group = `快速跳转滚动`
  const maxTop = Math.max(1, Math.floor(rows * VS_ROW_HEIGHT * 0.94))
  const targets = jumpTargets(maxTop)
  const { ops } = library.createTable(container, records)
  await settleFirstFrame(ops)
  const intervals: number[] = []
  const works: number[] = []
  let prev = performance.now()
  for (const top of targets) {
    await raf()
    const start = performance.now()
    ops.scrollToPx(top)
    works.push(performance.now() - start)
    intervals.push(start - prev)
    prev = start
  }
  ops.destroy()
  return [
    {
      id: 'jump-fps',
      scale: rows,
      label: '快速拖滚动条平均 FPS',
      group,
      unit: 'fps',
      better: 'higher',
      value: 1000 / mean(intervals),
      note: `${JUMP_FRAMES} 次大幅跳转（目标偏移 0~${(maxTop / 1_000_000).toFixed(1)}M px 伪随机）`,
    },
    {
      id: 'jump-work-p95',
      scale: rows,
      label: '单次跳转 JS 耗时 P95',
      group,
      unit: 'ms',
      better: 'lower',
      value: percentile(works, 95),
    },
  ]
}

/** 逐格写：先 50 次校准单次成本，超预算则全场景（两库）降 N */
async function measureCellWrites(
  library: VsLibrary,
  container: HTMLElement,
  records: DataRecord[],
  rows: number,
  count: number,
): Promise<VsSample> {
  const { ops } = library.createTable(container, records)
  await settleFirstFrame(ops)
  const t0 = performance.now()
  for (let i = 0; i < count; i++) {
    ops.writeCell(i % BENCH_COLS, i % VISIBLE_ROWS, i)
  }
  await raf()
  const elapsed = performance.now() - t0
  ops.destroy()
  return {
    id: 'cell-writes',
    scale: rows,
    label: '逐格写吞吐',
    group: '单元格写入',
    unit: 'ops/ms',
    better: 'higher',
    value: count / elapsed,
    note: `${count} 次单格写（含 1 帧收尾），总耗时 ${elapsed.toFixed(0)}ms`,
  }
}

/** 校准逐格写次数：任一库 50 次预估超预算则按比例降 N（两库共用，地板 500） */
async function calibrateWriteCount(
  libraries: readonly VsLibrary[],
  container: HTMLElement,
  rows: number,
): Promise<number> {
  const probe = 50
  for (const library of libraries) {
    const records = library.createRecords(rows)
    const { ops } = library.createTable(container, records)
    await settleFirstFrame(ops)
    const t0 = performance.now()
    for (let i = 0; i < probe; i++) {
      ops.writeCell(i % BENCH_COLS, i % VISIBLE_ROWS, i)
    }
    await raf()
    const perCall = (performance.now() - t0) / probe
    ops.destroy()
    const affordable = Math.floor(WRITE_BUDGET_MS / Math.max(perCall, 0.001))
    if (affordable < WRITE_COUNT_MAX) {
      return Math.max(WRITE_COUNT_FLOOR, affordable)
    }
  }
  return WRITE_COUNT_MAX
}

async function measureBatchWrite(
  library: VsLibrary,
  container: HTMLElement,
  records: DataRecord[],
  rows: number,
): Promise<VsSample> {
  const values: (string | number)[][] = Array.from({ length: BATCH_ROWS }, (_, r) =>
    Array.from({ length: BENCH_COLS }, (_, c) => `p-${r}-${c}`),
  )
  const { ops } = library.createTable(container, records)
  await settleFirstFrame(ops)
  const t0 = performance.now()
  await ops.batchWrite(0, 0, values)
  await raf()
  const elapsed = performance.now() - t0
  ops.destroy()
  return {
    id: 'batch-write',
    scale: rows,
    label: `批量写 ${BATCH_CELLS} 格耗时`,
    group: '单元格写入',
    unit: 'ms',
    better: 'lower',
    value: elapsed,
    note: `${BATCH_ROWS} 行 × ${BENCH_COLS} 列一次区域写（含 1 帧收尾）`,
  }
}

async function measureRebuild(
  library: VsLibrary,
  container: HTMLElement,
  records: DataRecord[],
  rows: number,
): Promise<VsSample> {
  const iterations = rows >= BIG_SCALE ? BIG_TTFF_ITERATIONS : SMALL_TTFF_ITERATIONS
  const durations: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    const { ops } = library.createTable(container, records)
    await settleFirstFrame(ops)
    durations.push(performance.now() - t0)
    ops.destroy()
    await raf()
  }
  return {
    id: 'rebuild',
    scale: rows,
    label: '整表重建均值（构造 + 首帧）',
    group: '重建（切表口径）',
    unit: 'ms',
    better: 'lower',
    value: mean(durations),
    note: `${iterations} 次建表 → 首帧（销毁在计时窗外）`,
  }
}

/** 单库一轮全场景（单规模） */
async function runLibraryRound(
  library: VsLibrary,
  container: HTMLElement,
  rows: number,
  writeCount: number,
  onStep?: (scenario: string) => void,
): Promise<VsSample[]> {
  const records = library.createRecords(rows)
  onStep?.('首次渲染（TTFF）')
  const ttff = await measureTtff(library, container, records, rows)
  onStep?.('稳态滚动')
  const scroll = await measureScroll(library, container, records, rows)
  onStep?.('快速跳转滚动')
  const jump = await measureJumpScroll(library, container, records, rows)
  onStep?.('逐格写吞吐')
  const cellWrites = await measureCellWrites(library, container, records, rows, writeCount)
  onStep?.('批量写')
  const batchWrite = await measureBatchWrite(library, container, records, rows)
  onStep?.('整表重建')
  const rebuild = await measureRebuild(library, container, records, rows)
  return [...ttff, ...scroll, ...jump, cellWrites, batchWrite, rebuild]
}

export interface VsRunResult {
  /** 库 id → 每轮样本（每规模各 ours 2 轮 / vtable 2 轮） */
  rounds: Record<string, VsSample[][]>
  /** 规模 → 逐格写实际次数 */
  writeCounts: Record<number, number>
  versions: Record<string, string>
  env: string
  startedAt: string
  durationMs: number
}

/** 对比运行进度（页面按钮触发时驱动进度条；驱动脚本 autorun 不消费） */
export interface VsProgress {
  /** 全量进度 0~100（按场景步数计，含每规模的写入量校准步） */
  percent: number
  /** 当前数据规模（行数） */
  scale: number
  /** 当前在跑的库展示名（校准步为空串） */
  library: string
  /** 当前场景名 */
  scenario: string
}

/** 对比数据规模：10 万与 100 万行 */
export const VS_SCALES = [100_000, 1_000_000] as const

/** 单库单轮内的场景步数（TTFF / 稳态滚动 / 快速跳转 / 逐格写 / 批量写 / 重建） */
const SCENARIO_STEPS = 6

export async function runComparison(
  container: HTMLElement,
  libraries: readonly VsLibrary[],
  onProgress?: (progress: VsProgress) => void,
): Promise<VsRunResult> {
  const startedAt = new Date()
  const t0 = performance.now()
  const rounds: Record<string, VsSample[][]> = {}
  for (const library of libraries) {
    rounds[library.id] = []
  }
  const writeCounts: Record<number, number> = {}
  // 每规模内对称跑序抗顺序偏差：A B B A
  const order = [libraries[0]!, libraries[1]!, libraries[1]!, libraries[0]!]
  const totalSteps = VS_SCALES.length * (1 + order.length * SCENARIO_STEPS)
  let step = 0
  const tick = (scale: number, library: string, scenario: string): void => {
    step += 1
    onProgress?.({
      percent: Math.min(100, Math.round((step / totalSteps) * 100)),
      scale,
      library,
      scenario,
    })
  }
  for (const rows of VS_SCALES) {
    tick(rows, '', '逐格写次数校准')
    writeCounts[rows] = await calibrateWriteCount(libraries, container, rows)
    for (const library of order) {
      rounds[library.id]!.push(
        await runLibraryRound(library, container, rows, writeCounts[rows]!, (scenario) =>
          tick(rows, library.name, scenario),
        ),
      )
    }
  }
  return {
    rounds,
    writeCounts,
    versions: {
      infinitable: `@infinitable/core（workspace 源码）`,
      '@visactor/vtable': `v${vtableVersion}`,
    },
    env: navigator.userAgent,
    startedAt: startedAt.toISOString(),
    durationMs: performance.now() - t0,
  }
}

export { BATCH_CELLS, SCROLL_MEASURE_FRAMES, SCROLL_STEP_Y, scaleLabel }
