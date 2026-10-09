// sheet 场景口径（S5）：切 sheet（全量重建）、逐格写（cell 级失效）、大块粘贴（batchUpdate
// 收敛单次 band）、冻结切换（运行时重建）。headless 与浏览器跑同一份逻辑。
// P9 增：大批量初始化写 + 大样式池（口径对齐下游 sheet-big-data：万行级批量写 + 20 色样式池）。
// P11：模型一律 @infinitable/sheet 的 Sheet（写路径走命令系统），引擎侧经 sheetTableModel
// 结构子集绑定挂模型（不做包级硬绑定，同旧 SheetStoreLike 先例）。

import type { TableModel } from '@infinitable/core'
import {
  Sheet,
  type CellStyle as SheetCellStyle,
  type CellValue,
  type SetCellValueItem,
} from '@infinitable/sheet'

import type { BenchEnv, BenchTable } from './env'
import type { BenchCheck, BenchMetric, ScenarioResult } from './report'
import {
  SHEET_BIG_INIT_WRITE_THROUGHPUT_MIN_OPS_MS,
  SHEET_FREEZE_AVG_MAX_MS,
  SHEET_PASTE_MAX_MS,
  SHEET_SWITCH_AVG_MAX_MS,
  SHEET_WRITE_THROUGHPUT_MIN_OPS_MS,
} from './thresholds'

const SHEET_ROWS = 500
const SHEET_COLS = 8
/** 逐格写数量和大块粘贴格数（口径：1000 次单格写 / 500 格一次粘贴） */
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

/**
 * Sheet → 引擎 TableModel 绑定（对齐 @infinitable/sheet grid 适配层的数据面口径：
 * 取存储值、引擎回写走 setCellValue 命令、cell-change 事件驱动引擎 cell 级局部刷新；
 * bench 场景无公式，取值不带 '=' 前缀分支）。
 */
function sheetTableModel(sheet: Sheet, rows: number): TableModel {
  return {
    rowCount: rows,
    getCellValue: (col, row) => sheet.getCellData({ row, col })?.v,
    setCellValue: (col, row, value) => sheet.setCellValue({ row, col }, value as CellValue),
    onCellChange: (listener) =>
      sheet.on('cell-change', ({ addr }) =>
        listener({ col: addr.col, row: addr.row, oldValue: undefined, newValue: undefined }),
      ),
  }
}

/** 建表口径的模型绑定（Sheet + 引擎模型适配；seed 时预灌 100×8 种子数据） */
function createSheetStore(seed = false): { sheet: Sheet; model: TableModel } {
  const sheet = new Sheet('bench')
  if (seed) {
    const items: SetCellValueItem[] = []
    for (let row = 0; row < 100; row++) {
      for (let col = 0; col < SHEET_COLS; col++) {
        items.push({ addr: { row, col }, data: { v: col * 100 + row, t: 'n' } })
      }
    }
    sheet.setCells(items)
  }
  return { sheet, model: sheetTableModel(sheet, SHEET_ROWS) }
}

/** 场景① 切 sheet：创建→销毁全量重建 ×N，均值（constructor + 首帧 flush 计入） */
async function runSheetSwitch(env: BenchEnv): Promise<ScenarioResult> {
  const durations: number[] = []
  for (let i = 0; i < SWITCH_ITERATIONS; i++) {
    const { model } = createSheetStore(true)
    const t0 = performance.now()
    const bench = env.createSheetTable(model)
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

/** 场景② 逐格写：setCellValue 经模型事件局部刷新（cell 级），吞吐 + full 失效为零断言 */
async function runSheetCellWrites(env: BenchEnv): Promise<ScenarioResult> {
  const { sheet, model } = createSheetStore(true)
  const bench = env.createSheetTable(model)
  await bench.beginFrame()
  bench.endFrame()
  bench.meter.drain()
  const t0 = performance.now()
  for (let i = 0; i < WRITE_COUNT; i++) {
    const col = i % SHEET_COLS
    const row = i % VISIBLE_ROWS
    sheet.setCellValue({ row, col }, i)
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
  const { sheet, model } = createSheetStore(true)
  const bench = env.createSheetTable(model)
  await bench.beginFrame()
  bench.endFrame()
  bench.meter.drain()
  const t0 = performance.now()
  bench.table.batchUpdate(() => {
    for (let i = 0; i < PASTE_CELLS; i++) {
      const col = i % SHEET_COLS
      const row = i % VISIBLE_ROWS
      sheet.setCellValue({ row, col }, `paste-${i}`)
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
  const { model } = createSheetStore(true)
  const bench: BenchTable = env.createSheetTable(model)
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

/** 场景⑤ 大批量初始化写 + 大样式池（口径对齐下游 sheet-big-data）：
 * 1/5/10 万行 × 12 列批量初始化写（值 + 20 色样式池逐格落格），batchUpdate 收敛单次 band。
 * 写入口径按 12 列全量落模型（下游批量灌数维度）：按行分块 setCells，值与样式随 v/t/s
 * 同补丁写模型（样式池预驻 20 定义、写入只引用 StyleId）；分块命令进历史栈后按 200 上限
 * 滚动淘汰，万行级初始化不驻留百万级撤销补丁。引擎建表面沿用 BenchEnv 固定 sheet 口径
 * （8 列视口），窗口外写为纯模型成本——与下游「批量灌数后渲染」的形态一致。 */
const BIG_INIT_SIZES = [10_000, 50_000, 100_000] as const
const BIG_INIT_COLS = 12
/** 样式池规模（下游口径 20 色） */
const STYLE_POOL_SIZE = 20

/** 20 色样式池：背景色 + 粗体轮转，池内对象共享引用（同下游口径：色池而非逐格新样式） */
function createStylePool(): SheetCellStyle[] {
  return Array.from({ length: STYLE_POOL_SIZE }, (_, i) => ({
    fill: { color: `hsl(${(i * 137) % 360} 45% ${52 + (i % 3) * 6}%)` },
    font: { bold: i % 2 === 0 },
  }))
}

async function runSheetBigInitWrites(env: BenchEnv): Promise<ScenarioResult> {
  const metrics: BenchMetric[] = []
  const checks: BenchCheck[] = []
  let totalOps = 0
  let totalElapsed = 0
  for (const rows of BIG_INIT_SIZES) {
    const sheet = new Sheet('bench')
    const bench: BenchTable = env.createSheetTable(sheetTableModel(sheet, rows))
    await bench.beginFrame()
    bench.endFrame()
    bench.meter.drain()
    const pool = createStylePool()
    const styleIds = pool.map((style) => sheet.stylePool.intern(style))
    const t0 = performance.now()
    bench.table.batchUpdate(() => {
      for (let row = 0; row < rows; row++) {
        const items: SetCellValueItem[] = []
        for (let col = 0; col < BIG_INIT_COLS; col++) {
          items.push({
            addr: { row, col },
            data: {
              v: row * BIG_INIT_COLS + col,
              t: 'n',
              s: styleIds[(row + col) % STYLE_POOL_SIZE],
            },
          })
        }
        sheet.setCells(items)
      }
    })
    bench.endFrame()
    const elapsed = performance.now() - t0
    const ops = rows * BIG_INIT_COLS * 2
    totalOps += ops
    totalElapsed += elapsed
    const body = bench.meter.drain().get('body')
    const bandCount = body?.band ?? 0
    const fullCount = body?.full ?? 0
    metrics.push({
      label: `${rows / 10_000} 万行`,
      value: `${elapsed.toFixed(1)} ms（${(ops / elapsed).toFixed(0)} ops/ms）`,
    })
    checks.push({
      label: `${rows / 10_000} 万行初始化写收敛 band ${bandCount} 次（要求 1）`,
      passed: bandCount === 1,
    })
    checks.push({
      label: `${rows / 10_000} 万行初始化写期间 body full ${fullCount} 次（要求 0）`,
      passed: fullCount === 0,
    })
    bench.destroy()
  }
  const throughput = totalOps / totalElapsed
  metrics.unshift({ label: '合计吞吐', value: `${throughput.toFixed(0)} ops/ms` })
  checks.push({
    label: `初始化写吞吐 ${throughput.toFixed(0)} ops/ms（下限 ${SHEET_BIG_INIT_WRITE_THROUGHPUT_MIN_OPS_MS}）`,
    passed: throughput >= SHEET_BIG_INIT_WRITE_THROUGHPUT_MIN_OPS_MS,
  })
  return {
    id: 'sheet-big-init-writes',
    title: `sheet 大批量初始化写 + 大样式池（${BIG_INIT_SIZES.map((r) => r / 10_000).join('/')} 万行 × ${BIG_INIT_COLS} 列 × ${STYLE_POOL_SIZE} 色池）`,
    passed: checks.every((check) => check.passed),
    metrics,
    checks,
  }
}

export async function runSheetScenarios(env: BenchEnv): Promise<ScenarioResult[]> {
  return [
    await runSheetSwitch(env),
    await runSheetCellWrites(env),
    await runSheetPaste(env),
    await runSheetFreezeSwitch(env),
    await runSheetBigInitWrites(env),
  ]
}
