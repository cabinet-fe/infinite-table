// 快照/恢复：SheetStore 全量快照采集与灌回（meta 报表迁移缺口「快照完整性」）。
// 九字段：cells / styles / merges / frozen / rowHeights / colWidths / images / meta / selection；
// 前七类直接落 Store 自身状态，images（浮动对象列表）与 selection（选区快照）不归 Store 持有，
// 随快照携带、由宿主接线应用（引擎 FloatObjectLayer / applyExternalSelection）——插件层不持有引擎实例。
// 快照是值物化：样式/选区/浮动图在采集与灌回两端都深拷贝，快照与 Store 不互为别名；
// 格值与 meta 值类型开放（unknown），按引用携带。

import type {
  CellBorder,
  CellRange,
  CellStyle,
  FloatObject,
  SelectionSnapshot,
} from '@infinite-table/core'

import type { SheetCellMetaEntry, SheetFrozen, SheetStore } from './sheet-store'

/** 格值条目（稀疏：仅采集非 undefined 格） */
export interface SheetSnapshotCell {
  col: number
  row: number
  value: unknown
}

/** 格级样式条目 */
export interface SheetSnapshotCellStyle {
  col: number
  row: number
  style: CellStyle
}

/** 列级样式条目 */
export interface SheetSnapshotColumnStyle {
  col: number
  style: CellStyle
}

/** 样式字段：格级 + 列级两类条目（格级行主序、列级列升序，确定性排序） */
export interface SheetSnapshotStyles {
  cells: SheetSnapshotCellStyle[]
  columns: SheetSnapshotColumnStyle[]
}

/** cell meta 命名空间条目组（entries 行主序） */
export interface SheetSnapshotMeta {
  ns: string
  entries: SheetCellMetaEntry[]
}

/** 行高覆盖条目 */
export interface SheetSnapshotRowHeight {
  row: number
  height: number
}

/** 列宽覆盖条目 */
export interface SheetSnapshotColWidth {
  col: number
  width: number
}

/** Sheet 全量快照（九字段） */
export interface SheetSnapshot {
  cells: SheetSnapshotCell[]
  styles: SheetSnapshotStyles
  merges: CellRange[]
  frozen: SheetFrozen
  rowHeights: SheetSnapshotRowHeight[]
  colWidths: SheetSnapshotColWidth[]
  images: FloatObject[]
  meta: SheetSnapshotMeta[]
  /** 选区快照（无选区为 null）；宿主接线引擎 applyExternalSelection 应用 */
  selection: SelectionSnapshot | null
}

/** 采集补充项：images / selection 不在 Store 内，由宿主自引擎侧取值注入（缺省空列表 / null） */
export interface SheetSnapshotExtras {
  /** 浮动对象列表（引擎侧 table.floatObjects 遍历收集） */
  images?: readonly FloatObject[]
  /** 选区快照（引擎侧 table.getSelection()） */
  selection?: SelectionSnapshot | null
}

/** 灌回接线项：images / selection 随快照携带，由宿主提供应用回调落到引擎侧 */
export interface SheetRestoreWiring {
  /** 浮动对象列表应用（收到的是快照全量列表：宿主对账 FloatObjectLayer，先清后加或按 id 增删） */
  images?: (images: readonly FloatObject[]) => void
  /** 选区应用（null 表示清空选区：宿主接 applyExternalSelection / clearSelection） */
  selection?: (selection: SelectionSnapshot | null) => void
}

/** 采集 Store 全量快照（九字段）；images / selection 经 extras 注入携带 */
export function snapshot(store: SheetStore, extras?: SheetSnapshotExtras): SheetSnapshot {
  const cells: SheetSnapshotCell[] = []
  for (let row = 0; row < store.getRowCount(); row++) {
    for (let col = 0; col < store.getColCount(); col++) {
      const value = store.getValue(col, row)
      if (value !== undefined) {
        cells.push({ col, row, value })
      }
    }
  }
  return {
    cells,
    styles: {
      cells: store
        .entriesCellStyles()
        .map(({ col, row, style }) => ({ col, row, style: cloneStyle(style) })),
      columns: store
        .entriesColumnStyles()
        .map(({ col, style }) => ({ col, style: cloneStyle(style) })),
    },
    merges: [...store.getMerges()],
    frozen: store.getFrozen(),
    rowHeights: sortedEntries(store.getRowHeightOverrides()).map(([row, height]) => ({
      row,
      height,
    })),
    colWidths: sortedEntries(store.getColWidthOverrides()).map(([col, width]) => ({ col, width })),
    images: cloneFloatObjects(extras?.images ?? []),
    meta: store.getCellMetaNamespaces().map((ns) => ({ ns, entries: store.entriesCellMeta(ns) })),
    selection: cloneSelection(extras?.selection ?? null),
  }
}

/**
 * 快照全量灌回 Store（替换语义：目标 Store 中不在快照内的值/样式/尺寸/meta 被清场）。
 * 灌回经 Store.rebuild 收口：不逐格广播，完成后发一次汇总变更（onChange 一条 rebuild +
 * 每个触碰命名空间一条 meta 汇总）。images / selection 不落 Store，经 wiring 回调交宿主接线应用
 * （接线活跃引擎时，引擎侧逐值失效可由宿主再包 table.batchUpdate 收敛）。
 * 越目标维度的快照条目（值/样式/尺寸/meta 格坐标）静默丢弃（与 Store 越界写空操作口径一致）。
 */
export function restore(store: SheetStore, snap: SheetSnapshot, wiring?: SheetRestoreWiring): void {
  store.rebuild(() => {
    restoreCells(store, snap.cells)
    restoreStyles(store, snap.styles)
    // setMerges/setFrozen 内部归一化/拷贝，Store 不别名快照
    store.setMerges(snap.merges)
    store.setFrozen({ ...snap.frozen })
    restoreGeometry(store, snap)
    restoreMeta(store, snap.meta)
  })
  wiring?.images?.(cloneFloatObjects(snap.images))
  wiring?.selection?.(cloneSelection(snap.selection))
}

/** 值灌回：目标维度内逐格对账（稀疏快照查表），差异才写；快照缺席格清空（写 undefined） */
function restoreCells(store: SheetStore, cells: readonly SheetSnapshotCell[]): void {
  const colCount = store.getColCount()
  const rowCount = store.getRowCount()
  const wanted = new Map<number, unknown>()
  for (const cell of cells) {
    if (inBounds(store, cell.col, cell.row)) {
      wanted.set(cell.row * colCount + cell.col, cell.value)
    }
  }
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      const target = wanted.get(row * colCount + col)
      if (store.getValue(col, row) !== target) {
        store.setValue(col, row, target)
      }
    }
  }
}

/** 样式灌回：既有格级/列级全清场后按快照重建（写入为快照样式副本，不别名快照） */
function restoreStyles(store: SheetStore, styles: SheetSnapshotStyles): void {
  const colCount = store.getColCount()
  for (const { col, row } of store.entriesCellStyles()) {
    store.clearStyle(col, row)
  }
  for (const { col, row, style } of styles.cells) {
    if (inBounds(store, col, row)) {
      store.setStyle(col, row, cloneStyle(style))
    }
  }
  for (const { col } of store.entriesColumnStyles()) {
    store.clearColumnStyle(col)
  }
  for (const { col, style } of styles.columns) {
    if (col >= 0 && col < colCount) {
      store.setColumnStyle(col, cloneStyle(style))
    }
  }
}

/** 行列尺寸灌回：既有覆盖全清场后按快照重建 */
function restoreGeometry(store: SheetStore, snap: SheetSnapshot): void {
  const colCount = store.getColCount()
  const rowCount = store.getRowCount()
  // 迭代中仅删当前键（Map 迭代器安全），快照写入在独立循环进行
  for (const col of store.getColWidthOverrides().keys()) {
    store.clearColWidth(col)
  }
  for (const { col, width } of snap.colWidths) {
    if (col >= 0 && col < colCount) {
      store.setColWidth(col, width)
    }
  }
  for (const row of store.getRowHeightOverrides().keys()) {
    store.clearRowHeight(row)
  }
  for (const { row, height } of snap.rowHeights) {
    if (row >= 0 && row < rowCount) {
      store.setRowHeight(row, height)
    }
  }
}

/** meta 灌回：快照外命名空间整清，快照内命名空间清场后按条目重建（值按引用携带） */
function restoreMeta(store: SheetStore, meta: readonly SheetSnapshotMeta[]): void {
  const wanted = new Set(meta.map((group) => group.ns))
  for (const ns of store.getCellMetaNamespaces()) {
    if (!wanted.has(ns)) {
      store.clearCellMeta(ns)
    }
  }
  for (const { ns, entries } of meta) {
    store.clearCellMeta(ns)
    for (const { col, row, value } of entries) {
      store.setCellMeta(ns, col, row, value)
    }
  }
}

/** 尺寸覆盖 Map → 索引升序条目（确定性快照） */
function sortedEntries(overrides: ReadonlyMap<number, number>): Array<[number, number]> {
  return [...overrides.entries()].sort((a, b) => a[0] - b[0])
}

/** 快照条目灌回的界内过滤（维度取目标 Store；与 Store 越界写空操作口径一致） */
function inBounds(store: SheetStore, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < store.getColCount() && row < store.getRowCount()
}

function cloneStyle(style: CellStyle): CellStyle {
  const cloned: CellStyle = { ...style }
  if (style.border) {
    cloned.border = cloneBorder(style.border)
  }
  if (style.padding) {
    cloned.padding = [...style.padding]
  }
  return cloned
}

function cloneBorder(border: CellBorder): CellBorder {
  const cloned: CellBorder = {}
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const line = border[edge]
    if (line) {
      cloned[edge] = { ...line }
    }
  }
  return cloned
}

function cloneSelection(selection: SelectionSnapshot | null): SelectionSnapshot | null {
  if (!selection) {
    return null
  }
  return {
    ranges: selection.ranges.map((range) => ({
      start: { ...range.start },
      end: { ...range.end },
    })),
    focus: selection.focus ? { ...selection.focus } : null,
  }
}

function cloneFloatObjects(images: readonly FloatObject[]): FloatObject[] {
  return images.map((object) => ({
    ...object,
    anchor: {
      from: { ...object.anchor.from },
      to: { ...object.anchor.to },
      offsetX: object.anchor.offsetX,
      offsetY: object.anchor.offsetY,
    },
    ...(object.size ? { size: { ...object.size } } : {}),
  }))
}
