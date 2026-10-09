// 基准运行环境抽象：headless（bun，注入假画布 + 手动帧泵）与浏览器（真实 canvas + rAF）
// 共用同一套场景逻辑，保证两处测的是同一份代码路径

import type { ListTable, TableModel } from '@infinitable/core'

import type { InvalidationMeter } from './invalidation-meter'

export interface BenchTable {
  readonly table: ListTable
  readonly meter: InvalidationMeter
  /** `new ListTable(...)` 构造耗时（ms，TTFF 的同步部分，createTable 内实测） */
  readonly constructorMs: number
  /** 帧开始：浏览器等待下一 rAF；headless 立即返回 */
  beginFrame(): Promise<void>
  /** 帧结束：headless 同步跑掉排期的帧任务（含失效 flush）；浏览器 no-op（flush 由宿主 rAF 驱动） */
  endFrame(): void
  /** 在视口坐标 (x, y) 派发一次 pointermove（指针并发滚动场景） */
  pointerMoveAt(x: number, y: number): void
  destroy(): void
}

export interface BenchEnv {
  readonly name: string
  createTable(): BenchTable
  /** sheet 口径建表：Sheet 模型绑定挂模型形态（sheet 场景用；S5）；模型适配由 sheet-scenarios 提供 */
  createSheetTable(model: TableModel): BenchTable
  /** chart 口径建表：图表格场景用（chart-support P5；表口径与声明解析在 chart-scenarios.ts） */
  createChartTable(): BenchTable
}
