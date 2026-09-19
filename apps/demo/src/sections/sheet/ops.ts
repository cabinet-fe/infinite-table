// 结构操作（Store 语义）：插入/删除行列的平移、清空、合并变更。
// 引擎运行时 API（setMergeCells 等）由调用方随 Store 同步落地。
// 演示简化：行高/列宽覆盖不随平移迁移（观察区如实注记）。

import type { CellRange, CellStyle, ListTable } from '@infinite-table/core'

import type { SheetStore } from '@infinite-table/plugins'

/** 读全表非空值/样式快照（稀疏） */
interface GridSnapshot {
  values: Map<string, unknown>
  styles: Map<string, CellStyle>
}

function snapshot(store: SheetStore): GridSnapshot {
  const values = new Map<string, unknown>()
  const styles = new Map()
  for (let col = 0; col < store.getColCount(); col++) {
    for (let row = 0; row < store.getRowCount(); row++) {
      const value = store.getValue(col, row)
      if (value != null) {
        values.set(`${col},${row}`, value)
      }
      const style = store.getStyle(col, row)
      if (style) {
        styles.set(`${col},${row}`, style)
      }
    }
  }
  return { values, styles }
}

/** 插入行：at 及以下整体下移一行（最后一行移出丢弃），at 行清空；合并区与行高覆盖随平移 */
export function insertRow(store: SheetStore, at: number): void {
  const snap = snapshot(store)
  store.setMerges(shiftRanges(store.getMerges(), 'row', at, 1))
  applyShifted(store, snap, 'row', at, 1)
}

/** 删除行：at 行移除，其下整体上移 */
export function deleteRow(store: SheetStore, at: number): void {
  const snap = snapshot(store)
  store.setMerges(shiftRanges(removeRangesAt(store.getMerges(), 'row', at), 'row', at + 1, -1))
  applyShifted(store, snap, 'row', at + 1, -1)
}

/** 插入列：at 及以右整体右移一列（最后一列移出丢弃），at 列清空 */
export function insertCol(store: SheetStore, at: number): void {
  const snap = snapshot(store)
  store.setMerges(shiftRanges(store.getMerges(), 'col', at, 1))
  applyShifted(store, snap, 'col', at, 1)
}

/** 删除列：at 列移除，其右整体左移 */
export function deleteCol(store: SheetStore, at: number): void {
  const snap = snapshot(store)
  store.setMerges(shiftRanges(removeRangesAt(store.getMerges(), 'col', at), 'col', at + 1, -1))
  applyShifted(store, snap, 'col', at + 1, -1)
}

/** 结构操作后的全表刷新（值/样式平移涉及大量格；合并区变更由 setMergeCells 自行重建） */
export function refreshAllGrid(table: ListTable, store: SheetStore): void {
  table.batchUpdate(() => {
    for (let col = 0; col < store.getColCount(); col++) {
      for (let row = 0; row < store.getRowCount(); row++) {
        table.refreshCell(col, row)
      }
    }
  })
}

/** 结构操作后随 Store 同步引擎运行时合并区（引擎校验失败经 onError 上报，Store 侧保持事实源） */
export function syncMergesToTable(
  table: ListTable,
  store: SheetStore,
  onError?: (error: Error) => void,
): void {
  try {
    table.setMergeCells([...store.getMerges()])
  } catch (error) {
    onError?.(error as Error)
  }
}

/** 清空选区值（样式保留） */
export function clearValues(
  store: SheetStore,
  bounds: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): void {
  for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
    for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
      store.setValue(col, row, null)
    }
  }
}

/** 合并选区（调用方需 try/catch 引擎校验）；返回合并区间 */
export function mergeBounds(bounds: {
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
}): CellRange {
  return {
    startCol: bounds.minCol,
    startRow: bounds.minRow,
    endCol: bounds.maxCol,
    endRow: bounds.maxRow,
  }
}

/** 取消与选区相交的合并区；返回剩余合并区 */
export function unmergeAt(
  store: SheetStore,
  bounds: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): CellRange[] {
  const kept = store
    .getMerges()
    .filter(
      (range) =>
        range.endCol < bounds.minCol ||
        range.startCol > bounds.maxCol ||
        range.endRow < bounds.minRow ||
        range.startRow > bounds.maxRow,
    )
  store.setMerges(kept)
  return kept
}

// ---- 内部：平移实现 ----

type Axis = 'row' | 'col'

/** 合并区平移：axis 上 >= at 的坐标 +delta */
function shiftRanges(
  ranges: readonly CellRange[],
  axis: Axis,
  at: number,
  delta: number,
): CellRange[] {
  return ranges.map((range) => shiftRange(range, axis, at, delta))
}

function shiftRange(range: CellRange, axis: Axis, at: number, delta: number): CellRange {
  if (axis === 'row') {
    return {
      ...range,
      startRow: range.startRow >= at ? range.startRow + delta : range.startRow,
      endRow: range.endRow >= at ? range.endRow + delta : range.endRow,
    }
  }
  return {
    ...range,
    startCol: range.startCol >= at ? range.startCol + delta : range.startCol,
    endCol: range.endCol >= at ? range.endCol + delta : range.endCol,
  }
}

/** 删除操作前：移除覆盖 at 行/列的合并区（避免平移后悬挂） */
function removeRangesAt(ranges: readonly CellRange[], axis: Axis, at: number): CellRange[] {
  return ranges.filter((range) =>
    axis === 'row'
      ? range.startRow > at || range.endRow < at
      : range.startCol > at || range.endCol < at,
  )
}

/** 值/样式/尺寸覆盖按平移重排（先清全表，再按快照平移写回） */
function applyShifted(
  store: SheetStore,
  snap: GridSnapshot,
  axis: Axis,
  at: number,
  delta: number,
): void {
  // 清全表值/样式
  for (const key of [...snap.values.keys(), ...snap.styles.keys()]) {
    const [col, row] = key.split(',').map(Number)
    store.setValue(col!, row!, null)
    store.clearStyle(col!, row!)
  }
  const move = (value: number): number => (value >= at ? value + delta : value)
  const writeAt = (col: number, row: number, key: 'values' | 'styles'): void => {
    if (axis === 'row') {
      const moved = move(row)
      if (key === 'values') {
        store.setValue(col, moved, snap.values.get(`${col},${row}`))
      } else {
        const style = snap.styles.get(`${col},${row}`)
        if (style) {
          store.setStyle(col, moved, style)
        }
      }
      return
    }
    const moved = move(col)
    if (key === 'values') {
      store.setValue(moved, row, snap.values.get(`${col},${row}`))
    } else {
      const style = snap.styles.get(`${col},${row}`)
      if (style) {
        store.setStyle(moved, row, style)
      }
    }
  }
  for (const key of snap.values.keys()) {
    const [col, row] = key.split(',').map(Number)
    writeAt(col!, row!, 'values')
  }
  for (const key of snap.styles.keys()) {
    const [col, row] = key.split(',').map(Number)
    writeAt(col!, row!, 'styles')
  }
}
