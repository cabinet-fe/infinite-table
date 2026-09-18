// sheet 场景口径（S5）：切 sheet（全量重建）、逐格写（cell 级失效）、大块粘贴（batchUpdate
// 收敛单次 band）、冻结切换（运行时重建）。headless 与浏览器跑同一份逻辑。

import { SheetStore } from '@infinite-table/plugins'

import type { BenchEnv, BenchTable } from './env'
import type { ScenarioResult } from './report'
import {
  SHEET_FREEZE_AVG_MAX_MS,
  SHEET_PASTE_MAX_MS,
  SHEET_SWITCH_AVG_MAX_MS,
  SHEET_WRITE_THROUGHPUT_MIN_OPS_MS,
} from './thresholds'

const SHEET_ROWS = 500
const SHEET_COLS = 8
/** 逐格写数量与大块粘贴格数（口径：1000 次单格写 / 500 格一次粘贴） */
const WRITE_COUNT = 1000
const PASTE_CELLS = 500
const FREEZE_SWITCH_ROUNDS = 20
/** 可视行数（720 视口 / 32 行高 ≈ 21）：逐格写与粘贴落可视行，口径为「产生失效的写」 */
const VISIBLE_ROWS = 21
const SWITCH_ITERATIONS = 5

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function createSheetStore(seed = false): SheetStore {
  const store = new SheetStore({ rowCount: SHEET_ROWS, colCount: SHEET_COLS })
  if (seed) {
    for (let col = 0; col < SHEET_COLS; col++) {
      for (let row = 0; row < 100; row++) {
        store.setValue(col, row, col * 100 + row)
      }
    }
  }
  return store
}

/** 场景① 切 sheet：创建→销毁全量重建 ×N，均值（constructor + 首帧 flush 计入） */
async function runSheetSwitch(env: BenchEnv): Promise<ScenarioResult> {
  const durations: number[] = []
  for (let i = 0; i < SWITCH_ITERATIONS; i++) {
    const store = createSheetStore(true)
    const t0 = performance.now()
    const bench = env.createSheetTable(store)
    // 计时窗 = 构造 + 帧任务 flush（t0 先于构造，now-t0 已含构造；rAF 等待不计入浏览器口径差异）
    bench.endFrame()
    durations.push(performance.now() - t0)
    await bench.beginFrame()
    bench.destroy()
  }
  const avg = mean(durations)
  return {
    id: 'sheet-switch',
    title: 'sheet 切换（全量重建，含首帧）',
    passed: avg <= SHEET_SWITCH_AVG_MAX_MS,
    metrics: [
      { label: '均值', value: `${avg.toFixed(2)} ms` },
      { label: '轮次', value: String(SWITCH_ITERATIONS) },
    ],
    checks: [],
  }
}

/** 场景② 逐格写：setValue 经模型事件局部刷新（cell 级），吞吐 + full 失效为零断言 */
async function runSheetCellWrites(env: BenchEnv): Promise<ScenarioResult> {
  const store = createSheetStore(true)
  const bench = env.createSheetTable(store)
  await bench.beginFrame()
  bench.endFrame()
  bench.meter.drain()
  const t0 = performance.now()
  for (let i = 0; i < WRITE_COUNT; i++) {
    const col = i % SHEET_COLS
    const row = i % VISIBLE_ROWS
    store.setValue(col, row, i)
  }
  bench.endFrame()
  const elapsed = performance.now() - t0
  const body = bench.meter.drain().get('body')
  const fullCount = body?.full ?? 0
  const throughput = WRITE_COUNT / elapsed
  bench.destroy()
  return {
    id: 'sheet-cell-writes',
    title: 'sheet 逐格写（模型事件 → cell 失效）',
    passed: fullCount === 0 && throughput >= SHEET_WRITE_THROUGHPUT_MIN_OPS_MS,
    metrics: [
      { label: '写入次数', value: String(WRITE_COUNT) },
      { label: '吞吐', value: `${(WRITE_COUNT / elapsed).toFixed(0)} ops/ms` },
      { label: 'body full 失效', value: String(fullCount) },
      { label: 'body cell 失效', value: String(body?.cell ?? 0) },
    ],
    checks: [
      {
        label: `逐格写期间 body full 失效 ${fullCount} 次（要求 0）`,
        passed: fullCount === 0,
      },
      {
        label: `吞吐 ${throughput.toFixed(0)} ops/ms（下限 ${SHEET_WRITE_THROUGHPUT_MIN_OPS_MS}）`,
        passed: throughput >= SHEET_WRITE_THROUGHPUT_MIN_OPS_MS,
      },
    ],
  }
}

/** 场景③ 大块粘贴：batchUpdate 内写 500 格，断言收敛单次 band */
async function runSheetPaste(env: BenchEnv): Promise<ScenarioResult> {
  const store = createSheetStore(true)
  const bench = env.createSheetTable(store)
  await bench.beginFrame()
  bench.endFrame()
  bench.meter.drain()
  const t0 = performance.now()
  bench.table.batchUpdate(() => {
    for (let i = 0; i < PASTE_CELLS; i++) {
      const col = i % SHEET_COLS
      const row = i % VISIBLE_ROWS
      store.setValue(col, row, `paste-${i}`)
    }
  })
  bench.endFrame()
  const elapsed = performance.now() - t0
  const body = bench.meter.drain().get('body')
  const bandCount = body?.band ?? 0
  const fullCount = body?.full ?? 0
  bench.destroy()
  return {
    id: 'sheet-paste',
    title: 'sheet 大块粘贴（batchUpdate 收敛）',
    passed: bandCount === 1 && fullCount === 0 && elapsed <= SHEET_PASTE_MAX_MS,
    metrics: [
      { label: '粘贴格数', value: String(PASTE_CELLS) },
      { label: '耗时', value: `${elapsed.toFixed(2)} ms` },
      { label: 'body band 失效', value: String(bandCount) },
      { label: 'body full 失效', value: String(fullCount) },
    ],
    checks: [
      {
        label: `粘贴 ${PASTE_CELLS} 格收敛 band ${bandCount} 次（要求 1）`,
        passed: bandCount === 1,
      },
      {
        label: `粘贴期间 body full ${fullCount} 次（要求 0）`,
        passed: fullCount === 0,
      },
      {
        label: `耗时 ${elapsed.toFixed(2)} ms（上限 ${SHEET_PASTE_MAX_MS}）`,
        passed: elapsed <= SHEET_PASTE_MAX_MS,
      },
    ],
  }
}

/** 场景④ 冻结切换：setFrozenColCount 循环 ×20（每次全量重建），均值 */
async function runSheetFreezeSwitch(env: BenchEnv): Promise<ScenarioResult> {
  const store = createSheetStore(true)
  const bench: BenchTable = env.createSheetTable(store)
  await bench.beginFrame()
  bench.endFrame()
  const durations: number[] = []
  for (let i = 0; i < FREEZE_SWITCH_ROUNDS; i++) {
    const t0 = performance.now()
    bench.table.setFrozenColCount((i % 3) + 0)
    durations.push(performance.now() - t0)
  }
  const avg = mean(durations)
  bench.destroy()
  return {
    id: 'sheet-freeze-switch',
    title: 'sheet 冻结切换（运行时全量重建）',
    passed: avg <= SHEET_FREEZE_AVG_MAX_MS,
    metrics: [
      { label: '均值', value: `${avg.toFixed(2)} ms` },
      { label: '轮次', value: String(FREEZE_SWITCH_ROUNDS) },
    ],
    checks: [],
  }
}

export async function runSheetScenarios(env: BenchEnv): Promise<ScenarioResult[]> {
  return [
    await runSheetSwitch(env),
    await runSheetCellWrites(env),
    await runSheetPaste(env),
    await runSheetFreezeSwitch(env),
  ]
}
