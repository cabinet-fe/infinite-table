import { rangesIntersect, type CellAddress, type SheetRange } from '../address'
import { cellDataEqual, isEmptyCellData, type CellData } from '../cell-store'
import type { Sheet } from '../sheet'
import type { SheetCellStyle } from '../style/types'
import type { CellPatch, Command, CommandResult, MergePatch, Patch } from './types'

export interface MergeCellsParams {
  range: SheetRange
}

/** 从已按行主序排列的实存格中合成合并区四边外边框到基础样式 */
function synthesizeMergeBorder(
  sheet: Sheet,
  finalRange: SheetRange,
  entries: readonly [CellAddress, CellData][],
  baseStyle?: SheetCellStyle,
): SheetCellStyle | undefined {
  const mergedBorder = { ...baseStyle?.border }
  for (const [addr, data] of entries) {
    if (data.s == null) continue
    const border = sheet.stylePool.get(data.s)?.border
    if (!border) continue
    if (!mergedBorder.top && addr.row === finalRange.start.row && border.top) {
      mergedBorder.top = border.top
    }
    if (!mergedBorder.bottom && addr.row === finalRange.end.row && border.bottom) {
      mergedBorder.bottom = border.bottom
    }
    if (!mergedBorder.left && addr.col === finalRange.start.col && border.left) {
      mergedBorder.left = border.left
    }
    if (!mergedBorder.right && addr.col === finalRange.end.col && border.right) {
      mergedBorder.right = border.right
    }
    if (mergedBorder.top && mergedBorder.bottom && mergedBorder.left && mergedBorder.right) {
      break
    }
  }

  if (Object.keys(mergedBorder).length === 0) return baseStyle
  return { ...baseStyle, border: mergedBorder }
}

/**
 * 收集单区域合并补丁（MergeCellsCommand 与 MergeCellsBatchCommand 共用，行为一致）：
 * - merge 补丁：解除被包围的既有合并 + 登记新区域（相交取包围盒）
 * - cell 补丁：通过 entriesInRange 仅扫描区域内实存格（按 (row, col) 升序保证行主序），
 *   消除十万行级大合并区对空坐标的逐格分配；行主序第一个有值格的值写入新锚点，其余清空；
 *   边框规则：合成区域边界上的外边框写入新锚点；过滤无实际变化的补丁
 */
function collectMergeRangePatches(
  sheet: Sheet,
  range: SheetRange,
): { finalRange: SheetRange; patches: Patch[] } {
  const { range: finalRange, removed } = sheet.merges.computeMerge(range)

  // entriesInRange 内层遍历 rowMap 为插入序，按 (row, col) 升序重排以严格满足行主序规则
  const entries = [...sheet.store.entriesInRange(finalRange)]
  entries.sort((a, b) => a[0].row - b[0].row || a[0].col - b[0].col)

  let retained: CellData | undefined
  let anchorBefore: CellData | undefined
  const cellPatches: CellPatch[] = []
  for (const [addr, before] of entries) {
    if (!retained && !isEmptyCellData(before)) {
      retained = before
    }
    if (addr.row === finalRange.start.row && addr.col === finalRange.start.col) {
      anchorBefore = before
    } else {
      cellPatches.push({ kind: 'cell', addr, before, after: undefined })
    }
  }

  const baseStyle = retained?.s != null ? sheet.stylePool.get(retained.s) : undefined
  const finalStyle = synthesizeMergeBorder(sheet, finalRange, entries, baseStyle)
  let styleId = retained?.s
  if (finalStyle && finalStyle !== baseStyle) {
    styleId = sheet.stylePool.intern(finalStyle)
  }

  const anchorAfter: CellData | undefined =
    retained || styleId != null
      ? { ...retained, ...(styleId != null ? { s: styleId } : {}) }
      : undefined

  if (!cellDataEqual(anchorBefore, anchorAfter)) {
    cellPatches.unshift({
      kind: 'cell',
      addr: { ...finalRange.start },
      before: anchorBefore,
      after: anchorAfter,
    })
  }

  return {
    finalRange,
    patches: [
      ...removed.map((mergeRange): MergePatch => ({
        kind: 'merge',
        range: mergeRange,
        before: true,
        after: false,
      })),
      { kind: 'merge', range: finalRange, before: false, after: true },
      ...cellPatches,
    ],
  }
}

/**
 * 合并命令。Patch 捕获完整 before 状态：
 * - 被解除的既有合并记录（undo 时逐一恢复）
 * - 包围盒内每一格的原数据（undo 时连被清空的值一起还原）
 * 值保留规则同 Excel/univer：行主序第一个有值格的值写入新锚点，其余清空。
 * 边框规则：合成区域边界上的外边框并写入新锚点。
 */
export const MergeCellsCommand: Command<MergeCellsParams, SheetRange> = {
  id: 'sheet.command.merge-cells',

  handler(ctx, params): CommandResult<SheetRange> {
    const { finalRange, patches } = collectMergeRangePatches(ctx.sheet, params.range)
    for (const patch of patches) ctx.applyPatch(patch, 'redo')
    return { mutations: [{ redo: patches, undo: [...patches].reverse() }], result: finalRange }
  },
}

export interface UnmergeCellsParams {
  range: SheetRange
}

/** 取消合并命令：解除与 range 相交的所有合并；undo 恢复合并记录 */
export const UnmergeCellsCommand: Command<UnmergeCellsParams> = {
  id: 'sheet.command.unmerge-cells',

  handler(ctx, params): CommandResult {
    const removed: MergePatch[] = []
    for (const range of ctx.sheet.merges.getMerges()) {
      if (rangesIntersect(range, params.range)) {
        removed.push({ kind: 'merge', range, before: true, after: false })
      }
    }
    if (removed.length === 0) return { mutations: [] }
    for (const patch of removed) ctx.applyPatch(patch, 'redo')
    return { mutations: [{ redo: removed, undo: [...removed].reverse() }] }
  },
}

export interface MergeCellsBatchParams {
  ranges: SheetRange[]
}

/**
 * 批量合并命令（导入等批量场景：一次命令 = 单 undo 单元，
 * 替代逐区域 MergeCellsCommand 的命令/历史/重算编排开销）。
 * 每个区域与 MergeCellsCommand 同语义（相交包围盒 + 锚点值保留）；undo 逆序
 * 回放（后合并的先撤销，相交依赖自洽）。源 Excel 合并区域互不相交——批量
 * 收集时各区域独立 computeMerge，行为与逐条一致。
 */
export const MergeCellsBatchCommand: Command<MergeCellsBatchParams> = {
  id: 'sheet.command.merge-cells-batch',

  handler(ctx, params): CommandResult {
    const patches: Patch[] = []
    for (const range of params.ranges) {
      const collected = collectMergeRangePatches(ctx.sheet, range)

      // 立即应用本区域的补丁后再处理下一个：批量内相交时 computeMerge 能看到
      // 前一个合并（与逐条 mergeCells 语义一致：相交 → 包围盒）；undo 逆序回放
      // 仍自洽（后应用的先撤销）
      for (const patch of collected.patches) ctx.applyPatch(patch, 'redo')
      patches.push(...collected.patches)
    }
    if (patches.length === 0) return { mutations: [] }
    return { mutations: [{ redo: patches, undo: [...patches].reverse() }] }
  },
}
