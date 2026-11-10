// 数据态渲染管线：绑定/函数 + 重塑后数据 + 聚合结果 → 数据态表单快照
// （预览与打印共用的唯一入口）。
//
// 配置态画布永不填充数据；本管线按数据块的 `expand` 属性做**行列双轴**复制：
// - `expand: 'down'` 的数据块按数据条数向下复制（行轴），数据块下方内容整体下移；
//   配了 `groupBy` 时逐组渲染「组头行 ×1 + 明细行 × 组内条数 + 小计行 ×1」，
//   全部组结束后垫一份合计行（`summary` 角色行；未分组的数据块同样支持合计行）；
// - `expand: 'right'` 的数据块按数据条数向右复制（列轴），数据块右侧内容整体右移；
// - 其余内容（含不属于任何数据块的行列）原样保留。
//
// 份数由数据块的数据源（数据集形态或聚合结果里的循环数组）决定；未绑数据源的展开区
// 属合法中间态，渲染暂按 1 份（绑定解析为空）：
// - 展开区内绑定 = 条目内相对路径，按份取值；组头/小计行的绑定取组内第 1 条，
//   合计行取全体第 1 条；
// - 聚合引用绑定（kind:'agg'）= 从聚合结果 `agg[名]` 按路径下钻取值，任意格可设、
//   与所在数据块无关（块外单据头格直取非数组聚合）；
// - 不展开 + 带源的数据块 = 静态取循环数组第 1 条；
// - 单元格函数（cell-function.ts）在绑定解析后逐格求值，可引用 `agg`/`item`/数据块函数；
// - 合并区若跨了展开边界（首尾份数不一致）则丢弃；
// - 绑定/函数 sidecar 不进数据态快照（已解析为值）。

import {
  clampSnapshotToBounds,
  snapshotContentBounds,
  type CellMetaSnapshotItem,
  type CellValue,
  type SheetSnapshot,
} from '@infinitable/sheet'

import { evaluateCellFunction } from './cell-function'
import { loopArrayAt, resolveItemValue } from './binding'
import type { FormDoc } from '../domain/form-doc'
import {
  FORM_BINDING_META_NAMESPACE,
  FORM_FUNCTION_META_NAMESPACE,
  cellFunctionExpression,
  isAggBinding,
  regionRefOf,
  regionRowRoleOf,
  regionsAt,
  type FormCellBinding,
  type FormCellFunction,
  type FormRegion,
} from '../shared/template-schema'

/** 数据集 id → 重塑后取数形态（reshapeDatasetData 的产物集合） */
export type DatasetShapes = Map<string, unknown>

/**
 * 数据集形态键：形态属于「数据集 × 重塑表达式」对——同一数据集被多个数据块以不同
 * 表达式引用时，各数据块按自己的表达式取形态。无表达式的引用共用裸 datasetId 键。
 */
export function datasetShapeKey(datasetId: string, expression?: string): string {
  const trimmed = expression?.trim()
  return trimmed ? `${datasetId}\u0000${trimmed}` : datasetId
}

/** 渲染输入：数据集形态表 + 聚合结果（数据块 agg 来源与单元格函数共用） */
export interface RenderDataInput {
  shapes: DatasetShapes
  agg: Record<string, unknown>
}

/** 快照里的 sidecar 表：row|col → 载荷（绑定与函数各建一份） */
function sidecarIndex<T>(
  items: readonly CellMetaSnapshotItem[] | undefined,
  namespace: string,
): Map<string, { row: number; col: number; payload: T }> {
  const index = new Map<string, { row: number; col: number; payload: T }>()
  for (const item of items ?? []) {
    if (item.namespace === namespace) {
      index.set(`${item.row}|${item.col}`, {
        row: item.row,
        col: item.col,
        payload: item.payload as T,
      })
    }
  }
  return index
}

/**
 * 数据块数据源的循环数组（无 source / 形态缺失 / 聚合缺失 / 取不到数组 → undefined；
 * 路径语法非法由 parseBindingPath 抛错）。
 * 「source → 循环数组」的唯一权威读取口径：数据态渲染（renderDataState）、数据块弹框
 * 的实时预览（RegionDialog 草稿试算）、绑定编辑的条目采样（BindingEditor）都经本函数
 * 取数，不各自手拼 loopArrayAt。消费方的差异（草稿表达式、容错策略）在各自构建
 * RenderDataInput 入参时参数化，读取语义不拉平。
 */
export function loopArrayForRegion(
  region: FormRegion,
  input: RenderDataInput,
): unknown[] | undefined {
  const source = region.source
  if (!source) return undefined
  const shape =
    source.kind === 'dataset'
      ? input.shapes.get(datasetShapeKey(source.datasetId, source.expression))
      : input.agg[source.aggName]
  return loopArrayAt(shape, source.path)
}

/** 分组：条目按 groupBy 路径值归组（保持出现顺序；键为值的 JSON 序列化） */
interface RegionGroup {
  values: unknown[]
  items: unknown[]
}

function buildRegionGroups(items: readonly unknown[], groupBy: readonly string[]): RegionGroup[] {
  const groups: RegionGroup[] = []
  const byKey = new Map<string, RegionGroup>()
  for (const item of items) {
    const values = groupBy.map((path) => resolveItemValue(item, path))
    const key = JSON.stringify(values)
    let group = byKey.get(key)
    if (!group) {
      group = { values, items: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

/** 展开行槽位的取数语境（函数与小计按槽位取；undefined = 静态行） */
interface RowContext {
  regionIndex: number
  /** 该槽位的取数条目：明细行 = 当前条目；组头/小计 = 组内第 1 条；合计 = 全体第 1 条 */
  item: unknown
  /** SUBTOTAL 聚合范围：小计行 = 本组条目；合计行 = 数据块全体 */
  subtotalItems?: unknown[]
  /** 当前组第 1 条与组键值（GROUP 用；未分组的数据块缺省） */
  groupFirst?: unknown
  groupField?: string
}

interface RowSlot {
  templateRow: number
  context?: RowContext
}

/**
 * down 数据块的行槽位序列：
 * - 未分组：明细行逐条复制 + 合计行（若有）垫底一份；
 * - 分组：逐组「组头 ×1 + 明细 × 组内条数 + 小计 ×1」（按模板行序渲染），
 *   全部组之后合计行垫底一份；空数组时明细/组头/小计全部塌缩，仅合计行保留。
 */
function rowSlotsForRegion(
  region: FormRegion,
  regionIndex: number,
  items: readonly unknown[],
): RowSlot[] {
  const groupBy = region.groupBy?.length ? region.groupBy : undefined
  const slots: RowSlot[] = []
  const summaryRows: number[] = []
  if (!groupBy) {
    // 未分组：整块 ×N 份（份外层、数据块内行内层——与历版块序一致）；合计行最后垫底
    for (const item of items) {
      for (let row = region.startRow; row <= region.endRow; row++) {
        if (regionRowRoleOf(region, row) === 'summary') continue
        slots.push({ templateRow: row, context: { regionIndex, item } })
      }
    }
    for (let row = region.startRow; row <= region.endRow; row++) {
      if (regionRowRoleOf(region, row) === 'summary') summaryRows.push(row)
    }
  } else {
    for (let row = region.startRow; row <= region.endRow; row++) {
      const role = regionRowRoleOf(region, row)
      if (role === 'summary') summaryRows.push(row)
    }
    // 分组：逐组「组头 ×1 + 明细 × 组内条数 + 小计 ×1」按模板行序重放
    for (const group of buildRegionGroups(items, groupBy)) {
      const head = group.items[0]
      for (let row = region.startRow; row <= region.endRow; row++) {
        const role = regionRowRoleOf(region, row)
        if (role === 'summary') continue
        const groupInfo = { regionIndex, groupFirst: head, groupField: groupBy[0] }
        if (role === 'groupHeader') {
          slots.push({ templateRow: row, context: { ...groupInfo, item: head } })
        } else if (role === 'groupFooter') {
          slots.push({
            templateRow: row,
            context: { ...groupInfo, item: head, subtotalItems: group.items },
          })
        } else {
          for (const item of group.items) {
            slots.push({ templateRow: row, context: { ...groupInfo, item } })
          }
        }
      }
    }
  }
  // 合计行垫底（明细/分组循环之后）：SUBTOTAL 范围 = 数据块全体
  for (const row of summaryRows) {
    slots.push({
      templateRow: row,
      context: { regionIndex, item: items[0], subtotalItems: [...items] },
    })
  }
  return slots
}

/** 展开列槽位（right 数据块专用；无分组语义） */
interface ColContext {
  regionIndex: number
  item: unknown
}

interface ColSlot {
  templateCol: number
  context?: ColContext
}

/** right 数据块的列槽位：整块 ×N 份（份外层、数据块内列内层） */
function colSlotsForRegion(
  region: FormRegion,
  regionIndex: number,
  items: readonly unknown[],
): ColSlot[] {
  const slots: ColSlot[] = []
  for (const item of items) {
    for (let col = region.startCol; col <= region.endCol; col++) {
      slots.push({ templateCol: col, context: { regionIndex, item } })
    }
  }
  return slots
}

/** 模板行轴 → 槽位序列（down 数据块整块在原位展开，其余行一对一） */
function buildRowSlots(
  doc: FormDoc,
  rows: number,
  regionItems: ReadonlyMap<number, unknown[]>,
): RowSlot[] {
  const slots: RowSlot[] = []
  let row = 0
  while (row < rows) {
    const hit = doc.regions.findIndex(
      (region) => region.expand === 'down' && region.startRow === row,
    )
    if (hit >= 0) {
      const region = doc.regions[hit]!
      const items = regionItems.get(hit) ?? []
      slots.push(...rowSlotsForRegion(region, hit, items))
      row = region.endRow + 1
      continue
    }
    slots.push({ templateRow: row })
    row++
  }
  return slots
}

/** 模板列轴 → 槽位序列（right 数据块整块在原位展开，其余列一对一） */
function buildColSlots(
  doc: FormDoc,
  cols: number,
  regionItems: ReadonlyMap<number, unknown[]>,
): ColSlot[] {
  const slots: ColSlot[] = []
  let col = 0
  while (col < cols) {
    const hit = doc.regions.findIndex(
      (region) => region.expand === 'right' && region.startCol === col,
    )
    if (hit >= 0) {
      const region = doc.regions[hit]!
      const items = regionItems.get(hit) ?? []
      slots.push(...colSlotsForRegion(region, hit, items))
      col = region.endCol + 1
      continue
    }
    slots.push({ templateCol: col })
    col++
  }
  return slots
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
 * - 模板长度取**内容包围盒**（无限画布引擎的行列含大量扩容噪声）：包围盒之外
 *   不参与映射，天然丢弃落在外面的 cell/merge；
 * - 未绑定格：回落模板存储值（随数据块复制）；
 * - 数据块内绑定格：按槽位条目 + 相对路径取值（见 rowSlotsForRegion 的语境口径）；
 * - 函数格：绑定解析后按槽位语境求值（agg / item / 数据块函数）；
 * - 合并区若跨了展开边界（首尾份数不一致）则丢弃；
 * - 绑定/函数 sidecar 不进数据态快照（已解析为值）。
 */
export function renderDataState(doc: FormDoc, input: RenderDataInput): SheetSnapshot {
  const snapshot = doc.sheet.snapshot()
  const bindings = sidecarIndex<FormCellBinding>(snapshot.meta, FORM_BINDING_META_NAMESPACE)
  const functions = sidecarIndex<FormCellFunction>(snapshot.meta, FORM_FUNCTION_META_NAMESPACE)
  const bounds = snapshotContentBounds(snapshot, doc.regions)

  // 数据块循环数组（展开份数、绑定/函数取数、数据块函数引用共用一份）
  const regionItems = new Map<number, unknown[]>()
  doc.regions.forEach((region, index) => {
    const items = loopArrayForRegion(region, input)
    if (items === undefined && region.expand !== 'none') {
      // 未绑数据源或取不到数组 → 暂按 1 份（绑定解析为空），与历版口径一致
      regionItems.set(index, [undefined])
      return
    }
    regionItems.set(index, items ?? [])
  })

  // 数据块名索引：单元格函数的 `SUM('数据块名')` / `agg` 数据源按引用名解析
  const regionByRef = new Map<string, { region: FormRegion; items: unknown[] }>()
  doc.regions.forEach((region, index) => {
    regionByRef.set(regionRefOf(region, index), {
      region,
      items: regionItems.get(index) ?? [],
    })
  })

  const rowSlots = buildRowSlots(doc, bounds.rows, regionItems)
  const colSlots = buildColSlots(doc, bounds.cols, regionItems)
  const rowMap: number[][] = Array.from({ length: bounds.rows }, () => [])
  rowSlots.forEach((slot, index) => rowMap[slot.templateRow]!.push(index))
  const colMap: number[][] = Array.from({ length: bounds.cols }, () => [])
  colSlots.forEach((slot, index) => colMap[slot.templateCol]!.push(index))
  const rowContexts = rowSlots.map((slot) => slot.context)
  const colContexts = colSlots.map((slot) => slot.context)

  // 打印域 = 展开后尺寸与内容包围盒的较大者：既装得下展开出的行，数据块塌缩（0 份）时
  // 也不把模板原有版面裁短；包围盒之外的空行空列（无限画布扩容噪声）不进打印
  const box = {
    rows: Math.max(rowSlots.length, bounds.rows),
    cols: Math.max(colSlots.length, bounds.cols),
  }

  // 绑定/函数格可能没有存储项（只写 sidecar）：与快照 cells 求并集，保证都进入取值
  const cellsByKey = new Map(snapshot.cells.map((cell) => [`${cell.row}|${cell.col}`, cell]))
  for (const [key, entry] of bindings) {
    if (!cellsByKey.has(key)) cellsByKey.set(key, { row: entry.row, col: entry.col })
  }
  for (const [key, entry] of functions) {
    if (!cellsByKey.has(key)) cellsByKey.set(key, { row: entry.row, col: entry.col })
  }

  /** 格子在数据块里的取数条目（按展开槽位语境；数据块外/无源的数据块 → undefined） */
  const itemOf = (
    region: FormRegion | undefined,
    expandedRow: number,
    expandedCol: number,
  ): unknown => {
    if (!region?.source) return undefined
    if (region.expand === 'down') return rowContexts[expandedRow]?.item
    if (region.expand === 'right') return colContexts[expandedCol]?.item
    return (regionItems.get(doc.regions.indexOf(region)) ?? [])[0]
  }

  const cells = [...cellsByKey.values()].flatMap((cell) => {
    const binding = bindings.get(`${cell.row}|${cell.col}`)?.payload
    const fn = functions.get(`${cell.row}|${cell.col}`)?.payload
    const region = regionsAt(doc.regions, cell.row, cell.col)
    const out: SheetSnapshot['cells'] = []
    // 叉乘重建：每份行 × 每份列各出一格
    for (const row of rowMap[cell.row] ?? []) {
      for (const col of colMap[cell.col] ?? []) {
        if (!binding && !fn) {
          // 未绑定格：回落模板存储值（随数据块复制，公式缓存原样保留）
          out.push({ ...cell, row, col })
          continue
        }
        let value: CellValue | undefined
        if (binding) {
          // 聚合引用绑定：从已算好的聚合结果取 `agg[aggName]` 再按 path 下钻（与数据块
          // 无关，块外单据头格直取）；相对绑定：按槽位条目取条目内字段。取不到/undefined
          // 一律空（与既有绑定 miss 同口径）；聚合结果由调用方先于本管线算好（agg env）。
          value = isAggBinding(binding)
            ? resolveItemValue(input.agg[binding.aggName], binding.path)
            : resolveItemValue(itemOf(region, row, col), binding.path)
        } else if (fn) {
          const rowContext = region?.expand === 'down' ? rowContexts[row] : undefined
          const colContext = region?.expand === 'right' ? colContexts[col] : undefined
          const staticItem =
            region && region.expand === 'none'
              ? (regionItems.get(doc.regions.indexOf(region)) ?? [])[0]
              : undefined
          // 结构化 fn 先合成等价表达式，与自定义 expr 走同一条求值管线
          value = evaluateCellFunction(cellFunctionExpression(fn), {
            agg: input.agg,
            item: rowContext?.item ?? colContext?.item ?? staticItem,
            subtotalItems: rowContext?.subtotalItems,
            groupFirst: rowContext?.groupFirst,
            groupField: rowContext?.groupField,
            itemsOf: (ref) => {
              const target = regionByRef.get(ref)
              if (!target) throw new Error(`没有名为「${ref}」的数据块`)
              return target.items
            },
            columnFieldOf: (ref) => {
              const target = regionByRef.get(ref)
              if (!target) throw new Error(`没有名为「${ref}」的数据块`)
              for (let r = target.region.startRow; r <= target.region.endRow; r++) {
                const hit = bindings.get(`${r}|${cell.col}`)?.payload
                if (hit) return hit.path
              }
              throw new Error(
                `数据块「${ref}」在函数格所在列没有字段绑定：请写明字段，如 SUM('${ref}', '数量')`,
              )
            },
          })
        }
        // 绑定/函数格以解析值替换存储值（公式缓存/类型标记丢弃，样式保留）
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
