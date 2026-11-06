// 数据态渲染管线：绑定 + 重塑后数据 → 数据态表单快照（预览与打印共用的唯一入口）。
//
// 配置态画布永不填充数据；本管线按区域的 `expand` 属性做**行列双轴**复制：
// - `expand: 'down'` 的区域按数据条数向下复制（行轴），区域下方内容整体下移；
// - `expand: 'right'` 的区域按数据条数向右复制（列轴），区域右侧内容整体右移；
// - 其余内容（含不属于任何区域的行列）原样保留。
//
// 份数由**区域自己声明的数据源**（`region.source`）决定，与区域内绑定的路径无关：
// 区域内的绑定只描述「一份里取什么字段」（条目内相对路径）。输出即 SheetSnapshot
// 形态，可直接喂给以 sheet 快照为基准的打印适配。

import type { CellMetaSnapshotItem, CellValue, SheetSnapshot } from '@infinitable/sheet'

import { loopArrayAt, resolveBindingValue, resolveItemValue } from './binding'
import { clampSnapshotToBounds, contentBounds } from './content-bounds'
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

/** 快照里的绑定 sidecar 表：row|col → 绑定（格取值用） */
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

/** 区域数据源在当前形态集合里的循环数组（无 source / 形态缺失 / 取不到数组 → undefined） */
function regionLoopArray(region: FormRegion, shapes: DatasetShapes): unknown[] | undefined {
  const source = region.source
  if (!source) return undefined
  return loopArrayAt(shapes.get(datasetShapeKey(source.datasetId, source.expression)), source.path)
}

/**
 * 区域展开份数：读 `region.source`（数据集 × 重塑表达式 × 列表路径）在该形态里
 * 取到的数组长度。
 * - 取到数组 → 其长度（空数组即 0 份：区域塌缩，整块不占版面）；
 * - `expand !== 'none'` 却没有 source 属模型损坏（normalizeRegions 已禁止），直接抛错；
 * - 取不到数组（数据集没取数 / 路径不是数组）→ 1 份，按模板形态出一份。
 */
function regionCopies(region: FormRegion, shapes: DatasetShapes): number {
  if (region.expand === 'none') return 1
  if (!region.source) {
    throw new Error('展开区域缺少数据源：模板已损坏')
  }
  return regionLoopArray(region, shapes)?.length ?? 1
}

/** 区域 → 本次渲染解析出的循环数组（同一区域只解析一次路径） */
function regionArrayOf(
  region: FormRegion,
  shapes: DatasetShapes,
  cache: Map<FormRegion, unknown[] | undefined>,
): unknown[] | undefined {
  if (!cache.has(region)) cache.set(region, regionLoopArray(region, shapes))
  return cache.get(region)
}

/** 单轴展开计划：区域在轴上占 [from, to]（模板坐标），份数 copies */
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
 * 非展开区的绝对绑定取值。
 *
 * 绑定可能没有 `datasetId`：那是相对绑定（`{ path }`），本应落在展开区内；把区域的
 * 展开方式改回「不展开」后它会残留在这里。此时没有数据集可查，本格不出值——
 * 不是兜底，而是「这份绑定在当前区域语义下没有数据源」的事实。
 */
function resolveAbsoluteValue(
  binding: FormCellBinding,
  shapes: DatasetShapes,
): CellValue | undefined {
  if (!binding.datasetId) return undefined
  return resolveBindingValue(
    shapes.get(datasetShapeKey(binding.datasetId, binding.expression)),
    binding,
    {},
  )
}

/**
 * 渲染数据态表单快照：
 * - 模板长度取**内容包围盒**（无限画布引擎的行列含大量扩容噪声）：包围盒之外不参与
 *   映射，天然丢弃落在外面的 cell/merge；
 * - 未绑定格：回落模板存储值（随区域复制）；
 * - 展开区内绑定格：`item = 区域循环数组[该份下标]`，按条目内相对路径取值；
 * - 非展开区绑定格：按绝对路径直取（`[].x` 需聚合，否则无值）；
 * - 合并区若跨了展开区边界（首尾份数不一致）则丢弃；
 * - 绑定 sidecar 不进数据态快照（已解析为值）。
 */
export function renderDataState(doc: FormDoc, shapes: DatasetShapes): SheetSnapshot {
  const snapshot = doc.sheet.snapshot()
  const bindings = bindingIndex(snapshot.meta)
  const bounds = contentBounds(snapshot, doc.regions)
  // 区域循环数组缓存：展开份数与格取值共用，同一区域只解析一次路径
  const arrayCache = new Map<FormRegion, unknown[] | undefined>()

  // 行/列展开计划：expand 各最多一个（模型层已拦住），仍按数组收集以防将来放开
  const rowPlans: AxisPlan[] = []
  const colPlans: AxisPlan[] = []
  for (const region of doc.regions) {
    const copies = regionCopies(region, shapes)
    if (region.expand === 'down') {
      rowPlans.push({ from: region.startRow, to: region.endRow, copies })
    } else if (region.expand === 'right') {
      colPlans.push({ from: region.startCol, to: region.endCol, copies })
    }
  }
  const rowMap = buildAxisMap(bounds.rows, rowPlans)
  const colMap = buildAxisMap(bounds.cols, colPlans)
  const outRows = rowMap.reduce((sum, target) => sum + target.length, 0)
  const outCols = colMap.reduce((sum, target) => sum + target.length, 0)

  // 打印域 = 展开后尺寸与内容包围盒的较大者：既装得下展开出的行，区域塌缩（0 份）时
  // 也不把模板原有版面裁短；包围盒之外的空行空列（无限画布扩容噪声）不进打印
  const box = { rows: Math.max(outRows, bounds.rows), cols: Math.max(outCols, bounds.cols) }

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
        // 展开区：绑定 path 是条目内相对字段，每份下探该份的数组元素；向下区看行份、
        // 向右区看列份。非展开区：按绝对路径 + 聚合取值。
        const value = expanding
          ? resolveItemValue(
              regionArrayOf(expanding, shapes, arrayCache)?.[
                expanding.expand === 'down' ? rowIndex : colIndex
              ],
              binding.path,
            )
          : resolveAbsoluteValue(binding, shapes)
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

  return clampSnapshotToBounds(
    {
      ...snapshot,
      rows: box.rows,
      cols: box.cols,
      cells,
      merges,
      meta: undefined,
      selection: undefined,
      rowHeights: remapAxis(snapshot.rowHeights, rowMap),
      colWidths: remapAxis(snapshot.colWidths, colMap),
      rowStyles: remapAxis(snapshot.rowStyles, rowMap),
      colStyles: remapAxis(snapshot.colStyles, colMap),
      // images 不做下标重映射（模板图片属边缘形态），越界者由裁剪丢弃
    },
    box,
  )
}
