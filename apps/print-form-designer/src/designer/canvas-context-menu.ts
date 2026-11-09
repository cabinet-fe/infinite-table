// 画布右键菜单的菜单项构建（纯函数）：按落点上下文（body / 行头）计算可用项与
// 禁用原因。菜单呈现归 ui/ContextMenu，动作执行归 DesignerPage——这里只决定
// 「这一下右键能做什么、为什么不能做」，与 Excel 右键的行为口径对齐。
import type { CellRange, CellAddress, SheetGridContextMenuInfo } from '@infinitable/sheet'

import type { ContextMenuItem } from '../ui/ContextMenu'
import type { FormDoc } from './form-doc'
import {
  FORM_BINDING_META_NAMESPACE,
  REGION_ROW_ROLES,
  isAggBinding,
  regionRefOf,
  type RegionRowRole,
} from './template'

/** 菜单动作（由 DesignerPage 注入；抛错就地呈现由调用方负责） */
export interface CanvasContextMenuActions {
  createRegionFromSelection(): void
  resizeRegionToSelection(index: number): void
  removeRegion(index: number): void
  mergeSelection(): void
  unmergeSelection(): void
  setRowRole(index: number, row: number, role: RegionRowRole): void
}

/** 选区 → 规范矩形（start ≤ end 的闭区间口径） */
export function selectionRect(
  range: CellRange,
): { startRow: number; endRow: number; startCol: number; endCol: number } {
  return {
    startRow: Math.min(range.start.row, range.end.row),
    endRow: Math.max(range.start.row, range.end.row),
    startCol: Math.min(range.start.col, range.end.col),
    endCol: Math.max(range.start.col, range.end.col),
  }
}

/** 「设置为数据块」的禁用原因：无选区 / 与已有数据块重叠 / 含相对绑定字段的单元格 */
function createRegionBlockedReason(
  doc: FormDoc,
  range: CellRange | null,
): string | undefined {
  if (!range) {
    return '先在画布上框选一块范围（数据块只为绑数据集或数组型聚合而存在；固定文字直接写在格子里）'
  }
  const rect = selectionRect(range)
  const overlap = doc.regions.some(
    (region) =>
      rect.startRow <= region.endRow &&
      rect.endRow >= region.startRow &&
      rect.startCol <= region.endCol &&
      rect.endCol >= region.startCol,
  )
  if (overlap) return '选区与已有数据块重叠'
  // 只拦相对绑定（数据源继承所在数据块）；聚合引用绑定不依赖数据块，可以框进新数据块
  const hasBinding = (doc.sheet.snapshot().meta ?? []).some(
    (item) =>
      item.namespace === FORM_BINDING_META_NAMESPACE &&
      !isAggBinding(item.payload) &&
      item.row >= rect.startRow &&
      item.row <= rect.endRow &&
      item.col >= rect.startCol &&
      item.col <= rect.endCol,
  )
  if (hasBinding) return '选区内有绑定字段的单元格（相对字段绑定只能属于数据块）'
  return undefined
}

/** 落点地址所在的数据块下标（-1 = 不在任何数据块） */
function regionIndexOfAddr(doc: FormDoc, addr: CellAddress | null): number {
  if (!addr) return -1
  return doc.regions.findIndex(
    (region) =>
      addr.row >= region.startRow &&
      addr.row <= region.endRow &&
      addr.col >= region.startCol &&
      addr.col <= region.endCol,
  )
}

/** 选区与任一合并区相交 */
function selectionIntersectsMerge(doc: FormDoc, range: CellRange | null): boolean {
  if (!range) return false
  const rect = selectionRect(range)
  return doc.sheet.merges
    .getMerges()
    .some(
      (merge) =>
        rect.startRow <= merge.end.row &&
        rect.endRow >= merge.start.row &&
        rect.startCol <= merge.end.col &&
        rect.endCol >= merge.start.col,
    )
}

/**
 * 构建菜单项：
 * - body：设置为数据块 / 调整数据块范围为选区 / 删除数据块 / 合并 / 取消合并；
 * - 行头（数据块内行）：设为明细/组头/小计/合计行（Excel「行类型」的右键入口）；
 * - 列头：暂无条目（返回空数组，调用方不开菜单）。
 */
export function buildCanvasContextMenu(
  doc: FormDoc,
  info: SheetGridContextMenuInfo,
  selection: CellRange | null,
  actions: CanvasContextMenuActions,
): ContextMenuItem[] {
  if (info.kind === 'row-header') {
    const row = info.row
    if (row === undefined) return []
    const index = doc.regions.findIndex(
      (region) => row >= region.startRow && row <= region.endRow,
    )
    const region = doc.regions[index]
    if (!region) return []
    return REGION_ROW_ROLES.map((role, roleIndex) => {
      let disabledReason: string | undefined
      if (region.expand !== 'down') {
        disabledReason = '行角色只对「纵向列表」的数据块有效'
      } else if (
        (role.value === 'groupHeader' || role.value === 'groupFooter') &&
        !region.groupBy?.length
      ) {
        disabledReason = '先在数据块设置的「分组」页配置分组字段'
      }
      const current =
        region.rowRoles?.find((entry) => entry.row === row)?.role ?? 'detail'
      return {
        key: `role-${role.value}`,
        label: `设为${role.label}`,
        checked: current === role.value,
        disabledReason,
        separatorBefore: roleIndex === 0,
        onSelect: () => actions.setRowRole(index, row, role.value),
      }
    })
  }
  if (info.kind !== 'body') return []

  const rect = selection ? selectionRect(selection) : undefined
  const multiCell =
    rect !== undefined && (rect.endRow > rect.startRow || rect.endCol > rect.startCol)
  const regionIndex = regionIndexOfAddr(doc, info.addr)
  const region = regionIndex >= 0 ? doc.regions[regionIndex] : undefined
  const items: ContextMenuItem[] = []

  items.push({
    key: 'create-region',
    label: '设置为数据块',
    disabledReason: createRegionBlockedReason(doc, selection),
    onSelect: () => actions.createRegionFromSelection(),
  })
  items.push({
    key: 'resize-region',
    label: '把数据块调整为选区大小',
    disabledReason: !region
      ? '落点不在任何数据块内'
      : !rect
        ? '先在画布上框选目标范围'
        : undefined,
    onSelect: () => regionIndex >= 0 && actions.resizeRegionToSelection(regionIndex),
  })
  if (region) {
    items.push({
      key: 'remove-region',
      label: `删除数据块「${regionRefOf(region, regionIndex)}」`,
      danger: true,
      separatorBefore: true,
      onSelect: () => regionIndex >= 0 && actions.removeRegion(regionIndex),
    })
  }

  items.push({
    key: 'merge',
    label: '合并单元格',
    separatorBefore: true,
    disabledReason: !multiCell ? '先框选两个以上单元格' : undefined,
    onSelect: () => actions.mergeSelection(),
  })
  items.push({
    key: 'unmerge',
    label: '取消合并单元格',
    disabledReason: !selectionIntersectsMerge(doc, selection) ? '选区内没有合并单元格' : undefined,
    onSelect: () => actions.unmergeSelection(),
  })
  return items
}
