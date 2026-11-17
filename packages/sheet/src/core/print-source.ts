// 打印供数适配（自 print-form-designer app 下沉）：SheetSnapshot → GridReadView。
// 快照还原进只读 Sheet 模型后逐项映射——行列数/行高列宽（未自定义回落内置缺省，
// 与屏上同口径）、合并区（模型区间 → 网格只读视图的扁平区间形状）、getCellValue（存储
// 原始值）、getCellStyle（有效样式投影，含列/行/格三层叠加与合并锚点解析）、
// getCellText（numFmt 显示链，公式格取计算缓存）。样式与显示链取本包公开的
// 显示链纯投影（sheetStyleToEngineStyle / formatByNumFmt / 内置缺省行列尺寸），
// 与屏上渲染同一份换算——打印页所见即画布所得。

import type { CellRange, CellStyle, GridReadView } from '@infinitable/protocol'

import { sheetStyleToEngineStyle } from '../grid/grid-style-map'
import { SHEET_DEFAULT_COL_WIDTH, SHEET_DEFAULT_ROW_HEIGHT } from './defaults'
import { formatByNumFmt } from './format'
import { Sheet, type SheetSnapshot } from './sheet'

/**
 * 数据态快照 → GridReadView：快照还原进只读 Sheet 模型（'print-data' 实例仅作读取
 * 载体，不接视图、不进任何 undo/事件链）后逐项映射。
 */
export function createSnapshotPrintSource(snapshot: SheetSnapshot, name: string): GridReadView {
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
    getRowHeight: (row) =>
      sheet.getRowHeight(row) ?? sheet.defaultRowHeight ?? SHEET_DEFAULT_ROW_HEIGHT,
    getColWidth: (col) =>
      sheet.getColWidth(col) ?? sheet.defaultColWidth ?? SHEET_DEFAULT_COL_WIDTH,
    getMergeRanges: (): readonly CellRange[] =>
      sheet.merges.getMerges().map((range) => ({
        startRow: range.start.row,
        startCol: range.start.col,
        endRow: range.end.row,
        endCol: range.end.col,
      })),
    getCellValue: (col, row) => sheet.getCellData(addr(col, row))?.v,
    getCellStyle: (col, row): CellStyle | undefined =>
      sheetStyleToEngineStyle(sheet.getEffectiveStyle(addr(col, row))) ?? undefined,
    getCellText: (col, row): string => {
      const at = addr(col, row)
      const data = sheet.getCellData(at)
      if (!data) return ''
      // 公式格取计算缓存（宿主数据态绑定/函数值已去公式，此处仅覆盖模板遗留公式格）
      const raw = data.f != null ? sheet.getDisplayValue(at) : data.v
      if (typeof raw === 'number') {
        const fmt = sheet.getEffectiveStyle(at)?.numFmt
        if (fmt) return formatByNumFmt(raw, fmt)
      }
      return raw == null ? '' : String(raw)
    },
  }
}
