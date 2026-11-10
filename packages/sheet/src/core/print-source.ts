// 打印供数适配（自 print-form-designer app 下沉）：SheetSnapshot → PrintSource。
// 快照还原进只读 Sheet 模型后逐项映射——行列数/行高列宽（未自定义回落内置缺省，
// 与屏上同口径）、合并区（模型区间 → 打印内核的扁平区间形状）、cellValue（存储
// 原始值）、cellStyle（有效样式投影，含列/行/格三层叠加与合并锚点解析）、
// displayValue（numFmt 显示链，公式格取计算缓存）。样式与显示链取本包公开的
// 显示链纯投影（sheetStyleToEngineStyle / formatByNumFmt / 内置缺省行列尺寸），
// 与屏上渲染同一份换算——打印页所见即画布所得。
//
// PrintSource 是 sheet 自有的**结构化类型**：字段形状与 @infinitable/plugins 的
// PrintSource（packages/plugins/src/print/types.ts，打印内核的数据面抽象）逐字段
// 对齐——sheet 不依赖 plugins（依赖方向只允许 plugins → 各引擎包），宿主把本模块
// 产物直接喂给 plugins 打印内核靠结构化兼容，不需要适配层。两包任一侧改 PrintSource
// 字段时须同步另一侧（互指文档：plugins 侧见其 types.ts PrintSource 注释）。

import type { CellRange, CellStyle } from '@infinitable/grid'

import { sheetStyleToEngineStyle } from '../grid/grid-style-map'
import { SHEET_DEFAULT_COL_WIDTH, SHEET_DEFAULT_ROW_HEIGHT } from './defaults'
import { formatByNumFmt } from './format'
import { Sheet, type SheetSnapshot } from './sheet'

/**
 * 打印数据源（结构化类型）：字段口径与 @infinitable/plugins 的 PrintSource 对齐
 * （签名以能适配宿主侧 sheet 模型快照为准；单位约定：行高/列宽一律 px，96dpi）。
 * cellImage 通道本模块不产出（快照无格图数据源），字段保留以保证形状对齐。
 */
export interface PrintSource {
  /** 表名（页面标题缺省源） */
  name: string
  /** 数据行数（含重复表头行在内的全表行数） */
  rowCount: number
  /** 数据列数 */
  colCount: number
  /** 行高读取（px；越界行为由适配层保证确定性） */
  rowHeight(row: number): number
  /** 列宽读取（px） */
  colWidth(col: number): number
  /** 合并单元格区域列表 */
  merges(): readonly CellRange[]
  /** 原始格值（分组换页按此判定分组语义，不受显示链影响） */
  cellValue(col: number, row: number): unknown
  /** 有效格样式（无样式返回 undefined） */
  cellStyle(col: number, row: number): CellStyle | undefined
  /** 显示值（经显示链产出展示形态） */
  displayValue(col: number, row: number): unknown
  /** 可选格图通道（返回图源 URL/dataURL；本模块不产出，形状对齐保留） */
  cellImage?: (col: number, row: number) => string | null | undefined
}

/**
 * 数据态快照 → PrintSource：快照还原进只读 Sheet 模型（'print-data' 实例仅作读取
 * 载体，不接视图、不进任何 undo/事件链）后逐项映射。
 */
export function createSnapshotPrintSource(snapshot: SheetSnapshot, name: string): PrintSource {
  const sheet = new Sheet('print-data')
  sheet.restore(snapshot)
  const addr = (col: number, row: number) => ({ row, col })
  return {
    name,
    get rowCount(): number {
      return sheet.rows
    },
    get colCount(): number {
      return sheet.cols
    },
    rowHeight: (row) =>
      sheet.getRowHeight(row) ?? sheet.defaultRowHeight ?? SHEET_DEFAULT_ROW_HEIGHT,
    colWidth: (col) =>
      sheet.getColWidth(col) ?? sheet.defaultColWidth ?? SHEET_DEFAULT_COL_WIDTH,
    merges: () =>
      sheet.merges.getMerges().map((range) => ({
        startRow: range.start.row,
        startCol: range.start.col,
        endRow: range.end.row,
        endCol: range.end.col,
      })),
    cellValue: (col, row) => sheet.getCellData(addr(col, row))?.v,
    cellStyle: (col, row) =>
      sheetStyleToEngineStyle(sheet.getEffectiveStyle(addr(col, row))) ?? undefined,
    displayValue: (col, row) => {
      const at = addr(col, row)
      const data = sheet.getCellData(at)
      if (!data) return undefined
      // 公式格取计算缓存（宿主数据态绑定/函数值已去公式，此处仅覆盖模板遗留公式格）
      const raw = data.f != null ? sheet.getDisplayValue(at) : data.v
      if (typeof raw === 'number') {
        const fmt = sheet.getEffectiveStyle(at)?.numFmt
        if (fmt) return formatByNumFmt(raw, fmt)
      }
      return raw
    },
  }
}
