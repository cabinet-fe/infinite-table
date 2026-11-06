// 数据态渲染管线：绑定 + 重塑后数据 → 数据态表单快照（预览与打印共用的唯一入口）。
//
// 配置态画布永不填充数据；本管线按区域的 `expand` 属性做**行列双轴**复制：
// - `expand: 'down'` 的区域按数据条数向下复制（行轴），区域下方内容整体下移；
// - `expand: 'right'` 的区域按数据条数向右复制（列轴），区域右侧内容整体右移；
// - 其余内容（含不属于任何区域的行列）原样保留。
// 输出即 SheetSnapshot 形态，可直接喂给以 sheet 快照为基准的打印适配。

import type { CellMetaSnapshotItem, SheetSnapshot } from '@infinitable/sheet'

import { detailLoopArray, resolveBindingValue } from './binding'
import type { FormDoc } from './form-doc'
import {
  FORM_BINDING_META_NAMESPACE,
  regionsAt,
  type FormCellBinding,
  type FormRegion,
} from './template'

/** 数据集 id → 重塑后取数形态（reshapeDatasetData 的产物集合） */
export type DatasetShapes = Map<string, unknown>

/**
 * 数据集形态键：形态属于「数据集 × 重塑表达式」对——同一数据集被多个绑定以不同
 * 表达式引用时，各绑定按自己的表达式取形态。无表达式的绑定共用裸 datasetId 键。
 */
export function datasetShapeKey(datasetId: string, expression?: string): string {
  const trimmed = expression?.trim()
  return trimmed ? `${datasetId}\u0000${trimmed}` : datasetId
}

/** 快照里的绑定 sidecar 表：row|col → 绑定（展开份数探测与格取值共用） */
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

/**
 * 区域展开份数：取区域内绑定循环数组的最大长度；解析到空数组 = 0 份（塌缩），
 * 区域内没有任何有效循环数组（未绑定/数组缺失）时保持 1 份（按模板形态出一份）。
 */
function regionCopies(
  region: FormRegion,
  items: readonly CellMetaSnapshotItem[] | undefined,
  shapes: DatasetShapes,
): number {
  if (region.expand === 'none') return 1
  let count = 0
  let found = false
  for (const item of items ?? []) {
    if (item.namespace !== FORM_BINDING_META_NAMESPACE) continue
    if (item.row < region.startRow || item.row > region.endRow) continue
    if (item.col < region.startCol || item.col > region.endCol) continue
    const binding = item.payload as FormCellBinding
    const array = detailLoopArray(
      shapes.get(datasetShapeKey(binding.datasetId, binding.expression)),
      binding,
    )
    if (!array) continue
    found = true
    count = Math.max(count, array.length)
  }
  return found ? count : 1
}

/** 单轴展开计划：区域在轴上占 [from, to]，份数 copies */
interface AxisPlan {
  from: number
  to: number
  copies: number
}

/**
 * 单轴映射：模板下标 → 展开后下标列表。
 * 区域内每份占满该区域的长度（块序即份序），区域之后的元素整体平移。
 */
function buildAxisMap(length: number, plans: readonly AxisPlan[]): number[][] {
  // 按起点排序后一遍扫描：区域前的原样输出，区域内按份展开，区域后加偏移
  const sorted = [...plans].sort((a, b) => a.from - b.from)
  const map: number[][] = Array.from({ length }, () => [])
  let next = 0
  let cursor = 0
  for (const plan of sorted) {
    const span = plan.to - plan.from + 1
    // 区域前的元素：一对一
    for (; cursor < plan.from; cursor++) map[cursor]!.push(next++)
    // 区域内的元素：每份都要一份（份外层、区域内下标内层）
    for (let copy = 0; copy < plan.copies; copy++) {
      for (let index = plan.from; index <= plan.to; index++) {
        map[index]!.push(next++)
      }
    }
    cursor = plan.to + 1
  }
  // 区域之后（或整表无区域）的尾巴：一对一
  for (; cursor < length; cursor++) map[cursor]!.push(next++)
  return map
}

/** 轴尺寸表重映射（行高/列宽、行/列默认样式）：[下标, 值] → 展开后的多份 */
function remapAxis(
  entries: [number, number][] | undefined,
  map: readonly number[][],
): [number, number][] | undefined {
  return entries?.flatMap(([index, value]) =>
    (map[index] ?? []).map((next) => [next, value] as [number, number]),
  )
}

/**
 * 渲染数据态表单快照：
 * - 未绑定格：回落模板存储值（随区域复制）；
 * - 展开区内绑定格：按该份的下标做 `each` 取值（向下区看行份、向右区看列份）；
 * - 非展开区绑定格：按路径直取（`[].x` 需聚合，否则无值）；
 * - 合并区若跨了展开区边界（首尾份数不一致）则丢弃；
 * - 绑定 sidecar 不进数据态快照（已解析为值）。
 */
export function renderDataState(doc: FormDoc, shapes: DatasetShapes): SheetSnapshot {
  const snapshot = doc.sheet.snapshot()
  const bindings = bindingIndex(snapshot.meta)

  // 行/列展开计划：expand 各最多一个（模型层已拦住），仍按数组收集以防将来放开
  const rowPlans: AxisPlan[] = []
  const colPlans: AxisPlan[] = []
  for (const region of doc.regions) {
    const copies = regionCopies(region, snapshot.meta, shapes)
    if (region.expand === 'down') {
      rowPlans.push({ from: region.startRow, to: region.endRow, copies })
    } else if (region.expand === 'right') {
      colPlans.push({ from: region.startCol, to: region.endCol, copies })
    }
  }
  const rowMap = buildAxisMap(snapshot.rows, rowPlans)
  const colMap = buildAxisMap(snapshot.cols, colPlans)
  const outRows = rowMap.reduce((sum, target) => sum + target.length, 0)
  const outCols = colMap.reduce((sum, target) => sum + target.length, 0)

  // 绑定格可能没有存储项（只写 sidecar）：与快照 cells 按格求并集，保证都进入取值
  const cellsByKey = new Map(snapshot.cells.map((cell) => [`${cell.row}|${cell.col}`, cell]))
  for (const [key, entry] of bindings) {
    if (!cellsByKey.has(key)) cellsByKey.set(key, { row: entry.row, col: entry.col })
  }

  const cells = [...cellsByKey.values()].flatMap((cell) => {
    const binding = bindings.get(`${cell.row}|${cell.col}`)?.binding
    const region = regionsAt(doc.regions, cell.row, cell.col)
    const expanding = region && region.expand !== 'none' ? region : undefined
    const rows = rowMap[cell.row] ?? []
    const cols = colMap[cell.col] ?? []
    const out: SheetSnapshot['cells'] = []
    // 叉乘重建：每份行 × 每份列各出一格
    for (const [rowIndex, row] of rows.entries()) {
      for (const [colIndex, col] of cols.entries()) {
        if (!binding) {
          out.push({ ...cell, row, col })
          continue
        }
        // 展开区：向下区按行份取 each、向右区按列份取 each（同一数据格在同列份内一致）
        const each = expanding ? (expanding.expand === 'down' ? rowIndex : colIndex) : undefined
        const value = resolveBindingValue(
          shapes.get(datasetShapeKey(binding.datasetId, binding.expression)),
          binding,
          each === undefined ? {} : { each },
        )
        // 绑定格以解析值替换存储值（公式缓存/类型标记丢弃，样式保留）
        const { v: _v, t: _t, f: _f, ...carry } = cell
        if (value === undefined && !('s' in carry)) continue
        out.push({ ...carry, row, col, ...(value !== undefined ? { v: value } : {}) })
      }
    }
    return out
  })

  const merges = snapshot.merges.flatMap((range) => {
    const starts = rowMap[range.start.row] ?? []
    const ends = rowMap[range.end.row] ?? []
    const colStarts = colMap[range.start.col] ?? []
    const colEnds = colMap[range.end.col] ?? []
    // 跨展开区边界（首尾份数不一致）→ 丢弃
    if (starts.length !== ends.length || colStarts.length !== colEnds.length) return []
    return starts
      .map((row, i) =>
        colStarts.map((col, j) => ({
          start: { row, col },
          end: { row: ends[i]!, col: colEnds[j]! },
        })),
      )
      .flat()
  })

  return {
    ...snapshot,
    rows: outRows,
    cols: outCols,
    cells,
    merges,
    meta: undefined,
    selection: undefined,
    rowHeights: remapAxis(snapshot.rowHeights, rowMap),
    colWidths: remapAxis(snapshot.colWidths, colMap),
    rowStyles: remapAxis(snapshot.rowStyles, rowMap),
    colStyles: remapAxis(snapshot.colStyles, colMap),
    // images 不做下标重映射（模板图片属边缘形态）
  }
}
