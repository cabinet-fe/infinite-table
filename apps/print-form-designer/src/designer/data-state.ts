// 数据态渲染管线（P6）：绑定 + 重塑后数据 → 数据态表单快照。
//
// 配置态画布永不填充数据（P3 口径）；本管线是预览与打印共用的唯一数据态入口，
// P8 打印弹框从这里取快照渲染。输出即 SheetSnapshot 形态：格取值已解析、明细
// 波段按绑定数组循环展开（数组每个元素复制一份波段行区，值按元素下探），可直接
// 喂给以 sheet 快照为基准的打印适配。
import type { CellMetaSnapshotItem, SheetSnapshot } from '@infinitable/sheet'

import { detailLoopArray, resolveBindingValue } from './binding'
import type { FormDoc } from './form-doc'
import {
  FORM_BINDING_META_NAMESPACE,
  bandAtRow,
  type FormBand,
  type FormCellBinding,
} from './template'

/** 数据集 id → 重塑后取数形态（reshapeDatasetData 的产物集合） */
export type DatasetShapes = Map<string, unknown>

/** 快照里的绑定 sidecar 表：row|col → 绑定（明细行数探测与格取值共用） */
function bindingIndex(
  items: readonly CellMetaSnapshotItem[] | undefined,
): Map<string, { row: number; col: number; binding: FormCellBinding }> {
  const index = new Map<string, { row: number; col: number; binding: FormCellBinding }>()
  for (const item of items ?? []) {
    if (item.namespace === FORM_BINDING_META_NAMESPACE) {
      index.set(`${item.row}|${item.col}`, {
        row: item.row,
        col: item.col,
        binding: item.payload as FormCellBinding,
      })
    }
  }
  return index
}

/** 波段展开份数：明细波段取波段内绑定循环数组的最大长度；解析到空数组 = 0 份（塌缩），
 *  波段内没有任何有效循环数组（未绑定/数组缺失）时保持 1 份（按模板形态出） */
function bandCopies(
  band: FormBand,
  items: readonly CellMetaSnapshotItem[] | undefined,
  shapes: DatasetShapes,
): number {
  if (band.kind !== 'detail') return 1
  let count = 0
  let found = false
  for (const item of items ?? []) {
    if (item.namespace !== FORM_BINDING_META_NAMESPACE) continue
    if (item.row < band.startRow || item.row > band.endRow) continue
    const binding = item.payload as FormCellBinding
    const array = detailLoopArray(shapes.get(binding.datasetId), binding)
    if (!array) continue
    found = true
    count = Math.max(count, array.length)
  }
  return found ? count : 1
}

/**
 * 渲染数据态表单快照：
 * - 非明细格：绑定按路径直取（`[]` 循环路径需聚合，否则无值），未绑定格回落模板存储值；
 * - 明细波段：按绑定数组长度逐元素复制行区，`[]` 路径按元素下标取值，样式/行高随行复制；
 * - 合并区整体落在同一展开份数的行上则随份复制，跨明细边界的合并在数据态丢弃；
 * - 绑定 sidecar 不进数据态快照（已解析为值）。
 */
export function renderDataState(doc: FormDoc, shapes: DatasetShapes): SheetSnapshot {
  const snapshot = doc.sheet.snapshot()
  const bindings = bindingIndex(snapshot.meta)

  // 模板行 → 展开后行号列表（明细行多份；元素外层、波段行区内层，块序即元素序）
  const targets: number[][] = Array.from({ length: snapshot.rows }, () => [])
  let nextRow = 0
  for (const band of doc.bands) {
    const copies = bandCopies(band, snapshot.meta, shapes)
    for (let copy = 0; copy < copies; copy++) {
      for (let row = band.startRow; row <= band.endRow; row++) targets[row]!.push(nextRow++)
    }
  }

  // 绑定格可能没有存储项（只写 sidecar，未落值/样式）：与快照 cells 按格求并集，
  // 缺项以零数据格补出，保证每个绑定格都进入数据态取值
  const cellsByKey = new Map(snapshot.cells.map((cell) => [`${cell.row}|${cell.col}`, cell]))
  for (const [key, entry] of bindings) {
    if (!cellsByKey.has(key)) cellsByKey.set(key, { row: entry.row, col: entry.col })
  }

  const cells = [...cellsByKey.values()].flatMap((cell) => {
    const binding = bindings.get(`${cell.row}|${cell.col}`)?.binding
    const inDetail = bandAtRow(doc.bands, cell.row)?.kind === 'detail'
    const copies = targets[cell.row] ?? []
    return copies
      .map((row, copyIndex) => {
        if (!binding) return { ...cell, row }
        const value = resolveBindingValue(
          shapes.get(binding.datasetId),
          binding,
          inDetail ? { each: copyIndex } : {},
        )
        // 绑定格以解析值替换存储值（公式缓存/类型标记一并丢弃，样式保留）；
        // 无存储项且解析不出值 = 空数据格，不进快照（restore 亦会丢弃）
        const { v: _v, t: _t, f: _f, ...carry } = cell
        if (value === undefined && !('s' in carry)) return undefined
        return { ...carry, row, ...(value !== undefined ? { v: value } : {}) }
      })
      .filter((item): item is SheetSnapshot['cells'][number] => item !== undefined)
  })

  const remapAxis = (entries: [number, number][] | undefined): [number, number][] | undefined =>
    entries?.flatMap(([row, value]) =>
      (targets[row] ?? []).map((r) => [r, value] as [number, number]),
    )

  const merges = snapshot.merges.flatMap((range) => {
    const starts = targets[range.start.row] ?? []
    const ends = targets[range.end.row] ?? []
    if (starts.length !== ends.length) return []
    return starts.map((row, i) => ({
      start: { row, col: range.start.col },
      end: { row: ends[i]!, col: range.end.col },
    }))
  })

  return {
    ...snapshot,
    rows: nextRow,
    cells,
    merges,
    meta: undefined,
    selection: undefined,
    rowHeights: remapAxis(snapshot.rowHeights),
    rowStyles: remapAxis(snapshot.rowStyles),
    // images 不做行号重映射（明细展开上方行号不变、下方会偏移；模板图片属边缘形态）
  }
}
