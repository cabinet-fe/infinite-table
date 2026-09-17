// 基准数据集：docs/perf-redesign 07 §1.1 口径的 10 万行 × 20 列固定尺寸表

import type { ColumnDefine, DataRecord } from '@infinite-table/core'

export const BENCH_ROWS = 100_000
export const BENCH_COLS = 20
export const BENCH_COL_WIDTH = 100
export const VIEWPORT_WIDTH = 1280
export const VIEWPORT_HEIGHT = 720
export const VIEWPORT_AREA = VIEWPORT_WIDTH * VIEWPORT_HEIGHT

export function createBenchColumns(): ColumnDefine[] {
  return Array.from({ length: BENCH_COLS }, (_, col) => ({
    field: `f${col}`,
    title: `列 ${col + 1}`,
    width: BENCH_COL_WIDTH,
  }))
}

export function createBenchRecords(): DataRecord[] {
  return Array.from({ length: BENCH_ROWS }, (_, row) => {
    const record: DataRecord = {}
    for (let col = 0; col < BENCH_COLS; col++) {
      record[`f${col}`] = row * BENCH_COLS + col
    }
    return record
  })
}
