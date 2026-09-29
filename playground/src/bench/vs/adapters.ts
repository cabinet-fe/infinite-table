// 对比适配层：infinitable 与 @visactor/vtable 收敛到同一操作面，
// 同数据（dataset.ts 10 万行 × 20 列）、同视口 1280×720、行高 32、列宽 100、无冻结、默认主题。
// 只包一层最小翻译，不做任何库外缓存：测的就是各库自身的公开调用成本。

import { ListTable, type ColumnDefine, type DataRecord } from '@infinitable/core'
import { createRenderHost, type RenderHost } from '@infinitable/render'
import { ListTable as VTableListTable } from '@visactor/vtable'

import {
  BENCH_COLS,
  BENCH_COL_WIDTH,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  createBenchRecords,
} from '../dataset'

/** 对比口径行高（两库 body 行统一 32px，保证同屏行数一致） */
export const VS_ROW_HEIGHT = 32

export interface VsTableOps {
  /** 纵向按像素滚动（稳态滚动场景驱动） */
  scrollByPx(dy: number): void
  /** 纵向跳转到像素偏移（快速拖滚动条场景驱动） */
  scrollToPx(top: number): void
  /** 读当前纵向像素偏移（滚动生效性校验） */
  scrollOffsetY(): number
  /** 单格写（逐格写吞吐场景） */
  writeCell(col: number, row: number, value: string | number): void
  /** 区域批量写（粘贴口径），调用方负责帧收尾 */
  batchWrite(startCol: number, startRow: number, values: (string | number)[][]): Promise<void>
  destroy(): void
}

export interface VsLibrary {
  id: 'ours' | 'vtable'
  name: string
  /** 各库独立生成数据（指定行数），避免库在 records 上挂内部元数据后污染对方初始化 */
  createRecords(rows: number): DataRecord[]
  /** 建表（含构造计时），返回统一操作面 */
  createTable(
    container: HTMLElement,
    records: DataRecord[],
  ): { ops: VsTableOps; constructMs: number }
}

function createColumns(): ColumnDefine[] {
  return Array.from({ length: BENCH_COLS }, (_, col) => ({
    field: `f${col}`,
    title: `列 ${col + 1}`,
    width: BENCH_COL_WIDTH,
  }))
}

export const oursLibrary: VsLibrary = {
  id: 'ours',
  name: 'infinitable',
  createRecords: (rows) => createBenchRecords(rows),
  createTable(container, records) {
    const host: RenderHost = createRenderHost({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      container,
    })
    const t0 = performance.now()
    const table = new ListTable({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      columns: createColumns(),
      records,
      rowHeight: VS_ROW_HEIGHT,
      host,
    })
    const constructMs = performance.now() - t0
    return {
      constructMs,
      ops: {
        scrollByPx: (dy) => table.scrollBy(0, dy),
        scrollToPx: (top) => table.scrollTo(0, top),
        scrollOffsetY: () => table.scroll.state.top,
        writeCell: (col, row, value) => table.updateCell(col, row, value),
        batchWrite: (startCol, startRow, values) => {
          table.batchUpdate(() => {
            for (let r = 0; r < values.length; r++) {
              const rowValues = values[r]!
              for (let c = 0; c < rowValues.length; c++) {
                table.updateCell(startCol + c, startRow + r, rowValues[c]!)
              }
            }
          })
          return Promise.resolve()
        },
        destroy: () => {
          table.destroy()
          host.destroy()
        },
      },
    }
  },
}

export const vtableLibrary: VsLibrary = {
  id: 'vtable',
  name: '@visactor/vtable',
  createRecords: (rows) => createBenchRecords(rows),
  createTable(container, records) {
    const t0 = performance.now()
    // vtable 1.26.8 类型缺口：构造选项未声明 width/height（运行时支持）、dispose 被标 private（公开销毁入口），
    // 与 columns 一样走窄化断言，不影响运行时行为
    const table = new VTableListTable({
      container,
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      columns: createColumns() as never,
      records,
      defaultRowHeight: VS_ROW_HEIGHT,
    } as never)
    const constructMs = performance.now() - t0
    return {
      constructMs,
      ops: {
        scrollByPx: (dy) => table.setScrollTop(table.getScrollTop() + dy),
        scrollToPx: (top) => table.setScrollTop(top),
        scrollOffsetY: () => table.getScrollTop(),
        writeCell: (col, row, value) => table.changeCellValue(col, row, value),
        batchWrite: (startCol, startRow, values) =>
          table.changeCellValues(startCol, startRow, values as never).then(() => undefined),
        destroy: () => (table as unknown as { dispose(): void }).dispose(),
      },
    }
  },
}
