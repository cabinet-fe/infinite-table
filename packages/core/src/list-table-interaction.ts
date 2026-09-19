// ListTable 交互接线协作模块（拆自 list-table.ts，纯移动不改行为）：
// 指针/触摸/键盘/contextmenu 场景事件接线、拖选/悬停/resize 会话/填充柄/双击进编辑、
// 视口命中与坐标换算、滚动跟随、sky 浮层刷新。以 ListTable 实例为参数的协作函数，
// 只触碰表实例上标注 @internal 的内部成员。

import type { Region, SceneEvent } from '@infinite-table/render'

import type { FillDragEndEvent, FillDragState, FillHandleDownEvent } from './fill-handle'
import {
  hitFillHandle,
  resolveFillPreview,
  resolveFillTarget,
  resolveFocusRange,
} from './fill-handle'
import { findColAt, findRowAt, resolveCellX, resolveCellYFromOffsets } from './grid-layout'
import type { ListTable } from './list-table'
import { nextActiveCell, revealAxis } from './keyboard-navigation'
import { applyHeaderHighlight } from './list-table-scene'
import type { OverlayContent } from './interaction-overlay'
import type { ColResizeEndEvent, ResizeGeometry, ResizeTarget, RowResizeEndEvent } from './resize'
import { hitResizeHandle, ResizeSession } from './resize'
import { normalizeRange, type SelectionRange } from './selection'
import type { CellRef, TableContextMenuEvent } from './types'

/** 双击/双触判定窗口与位移阈值（鼠标双击与触控双击统一走指针事件流） */
const DOUBLE_TAP_MS = 400
const DOUBLE_TAP_SLOP = 10

/** 填充拖拽边缘自动滚动：触发带宽度与每帧行进量（px） */
const FILL_EDGE_ZONE = 32
const FILL_EDGE_STEP = 24

/** 场景事件统一接线：指针/触摸在 body 根（sky 浮层不可拾取，事件穿透），键盘在最顶层根 */
export function bindInteractionEvents(table: ListTable): void {
  const bodyRoot = table.body.root
  table.eventUnsubscribers.push(
    bodyRoot.on('pointerdown', (event) => onPointerDown(table, event)),
    bodyRoot.on('pointermove', (event) => onPointerMove(table, event)),
    bodyRoot.on('pointerup', (event) => onPointerUp(table, event)),
    bodyRoot.on('contextmenu', (event) => onContextMenuEvent(table, event)),
    bodyRoot.on('touchstart', (event) => onTouchStart(table, event)),
    bodyRoot.on('touchmove', (event) => onTouchMove(table, event)),
    bodyRoot.on('touchend', (event) => onTouchEnd(table, event)),
    bodyRoot.on('touchcancel', () => onTouchCancel(table)),
    table.sky.root.on('keydown', (event) => onKeyDown(table, event)),
    table.selection.onChange(() => refreshOverlay(table)),
    table.hoverState.onChange(() => refreshOverlay(table)),
  )
}

function onPointerDown(table: ListTable, event: SceneEvent): void {
  table.pointerDownAt = { x: event.x, y: event.y }
  // 编辑中点击其它格/空白：先提交当前会话（同一时刻至多一个编辑会话）
  const hit = cellAt(table, event.x, event.y)
  const editing = table.editManager.editingCell()
  if (editing && (!hit || hit.col !== editing.col || hit.row !== editing.row)) {
    table.editManager.commitEdit()
  }
  const handle = hitResizeHandle(event.x, event.y, resizeGeometry(table), {
    canResizeCol: table.options.canResizeCol,
    canResizeRow: table.options.canResizeRow,
  })
  if (handle) {
    const startSize =
      handle.kind === 'col' ? table.getColWidth(handle.index) : table.rowHeightAt(handle.index)
    table.resizeSession = new ResizeSession(
      handle,
      startSize,
      handle.kind === 'col' ? event.x : event.y,
    )
    return
  }
  // 填充柄按下：开启拖拽会话并抛按下事件（不改选区，填充生成不在内核）
  const fillRange = fillHandleHit(table, event.x, event.y)
  if (fillRange) {
    const bounds = normalizeRange(fillRange)
    const origin = { col: bounds.maxCol, row: bounds.maxRow }
    table.fillDrag = {
      range: fillRange,
      origin,
      current: origin,
      pointer: { x: event.x, y: event.y },
      edge: { dx: 0, dy: 0 },
    }
    const down: FillHandleDownEvent = { range: fillRange }
    for (const listener of table.fillHandleDownListeners) {
      listener(down)
    }
    // 边缘驻留时帧循环续滚（指针停在边缘区不再产 move 事件）
    scheduleFillEdgeScroll(table)
    return
  }
  if (event.x < table.rowHeaderWidth && event.y < table.headerHeight) {
    // 左上角：全选
    table.selection.selectAll(table.options.columns.length, table.pipeline.rowCount)
    return
  }
  if (event.y < table.headerHeight) {
    const col = findColAt(table.colOffsets, toContentX(table, event.x))
    if (col >= 0) {
      table.selection.selectCol(col, table.pipeline.rowCount)
    }
    return
  }
  if (event.x < table.rowHeaderWidth) {
    const row = findRowAt(table.rowOffsets, toContentY(table, event.y))
    if (row >= 0) {
      table.selection.selectRow(row, table.options.columns.length)
    }
    return
  }
  const cell = cellAt(table, event.x, event.y)
  if (cell) {
    // 合并区整体作为选区单元：点按即全选包围盒（锚定主格，焦点随主格，编辑/取值都走主格）
    const extent = dragExtentRange(table, cell, cell)
    // ctrlMultiSelect：Ctrl/Cmd 点选在既有选区上追加选区段（后续拖拽扩展该段）；缺省替换选区
    if (table.options.ctrlMultiSelect === true && (event.ctrlKey || event.metaKey)) {
      table.selection.addRange(extent)
    } else {
      table.selection.beginDragRange(extent.start, extent.end)
    }
    table.selecting = true
  }
}

function onPointerMove(table: ListTable, event: SceneEvent): void {
  if (table.resizeSession) {
    updateResizeLine(table, event)
    return
  }
  if (table.fillDrag) {
    // 填充拖拽：轴锁定跟踪终点 + 边缘自动滚动 + 预览刷新（不更新选区，无写值）
    const drag = table.fillDrag
    drag.pointer = { x: event.x, y: event.y }
    drag.edge = fillEdgeVelocity(table, event.x, event.y)
    if (scrollFillEdge(table)) {
      scheduleFillEdgeScroll(table)
    }
    const cell = cellAt(table, event.x, event.y)
    if (cell) {
      updateFillCurrent(table, drag, cell)
    }
    refreshOverlay(table)
    return
  }
  const cell = cellAt(table, event.x, event.y)
  if (table.selecting) {
    if (cell) {
      // 合并感知拖选：扩展段取锚点与目标格各自合并包围盒的并
      const last = table.selection.snapshot.ranges[table.selection.snapshot.ranges.length - 1]
      if (last) {
        const extent = dragExtentRange(table, last.start, cell)
        table.selection.updateDragRange(extent.start, extent.end)
      } else {
        table.selection.updateDrag(cell.col, cell.row)
      }
      ensureCellVisible(table, cell.col, cell.row)
    }
    return
  }
  if (cell) {
    table.hoverState.set(cell.col, cell.row)
  } else {
    table.hoverState.clear()
  }
}

function onPointerUp(table: ListTable, event: SceneEvent): void {
  if (table.resizeSession) {
    const session = table.resizeSession
    table.resizeSession = null
    table.resizeLine = null
    const pointer = session.target.kind === 'col' ? event.x : event.y
    if (session.target.kind === 'col') {
      table.setColWidth(session.target.index, session.sizeAt(pointer))
    } else {
      table.setRowHeight(session.target.index, session.sizeAt(pointer))
    }
    // 拖拽会话成功结束：尺寸落地后按目标抛列/行结束事件（尺寸为夹取后的生效值）
    emitResizeEnd(table, session.target)
    return
  }
  if (table.fillDrag) {
    const drag = table.fillDrag
    table.fillDrag = null
    // 拖拽结束：抛锚定段范围 + 轴锁定后的拖拽目标格范围（内核不产生任何写值行为）
    const anchor = normalizeRange(drag.range)
    const targetEvent: FillDragEndEvent = {
      anchor,
      target: resolveFillTarget(anchor, drag.origin, drag.current),
    }
    for (const listener of table.fillDragEndListeners) {
      listener(targetEvent)
    }
    refreshOverlay(table)
    return
  }
  table.selecting = false
  table.selection.endDrag()
  detectDoubleTap(table, event)
}

/**
 * 填充拖拽终点更新：轴锁定（副轴夹回锚定段跨度）。
 * 柄方点骑在角点上，裸命中即右/下一格；副轴漂移不应产生侧向填充。
 */
function updateFillCurrent(table: ListTable, drag: FillDragState, cell: CellRef): void {
  const anchor = normalizeRange(drag.range)
  let col = cell.col
  let row = cell.row
  if (Math.abs(cell.row - drag.origin.row) >= Math.abs(cell.col - drag.origin.col)) {
    col = Math.min(Math.max(col, anchor.minCol), anchor.maxCol)
  } else {
    row = Math.min(Math.max(row, anchor.minRow), anchor.maxRow)
  }
  drag.current = { col, row }
}

/** 指针在视口边缘区内的自动滚动速度（px/帧）；不在边缘区为 0 */
function fillEdgeVelocity(table: ListTable, x: number, y: number): { dx: number; dy: number } {
  let dx = 0
  let dy = 0
  if (y >= table.height - FILL_EDGE_ZONE) {
    dy = FILL_EDGE_STEP
  } else if (y <= table.headerHeight + table.frozenRowsHeight + FILL_EDGE_ZONE) {
    dy = -FILL_EDGE_STEP
  }
  if (x >= table.width - FILL_EDGE_ZONE) {
    dx = FILL_EDGE_STEP
  } else if (x <= table.rowHeaderWidth + table.frozenColsWidth + FILL_EDGE_ZONE) {
    dx = -FILL_EDGE_STEP
  }
  return { dx, dy }
}

/** 按边缘速度滚动一帧并续算终点；未滚动（不在边缘区或已到内容边界）返回 false */
function scrollFillEdge(table: ListTable): boolean {
  const drag = table.fillDrag
  if (!drag || (drag.edge.dx === 0 && drag.edge.dy === 0)) {
    return false
  }
  const before = table.scroll.state
  table.scroll.scrollBy(drag.edge.dx, drag.edge.dy)
  const after = table.scroll.state
  if (after.left === before.left && after.top === before.top) {
    drag.edge = { dx: 0, dy: 0 }
    return false
  }
  const cell = cellAt(table, drag.pointer.x, drag.pointer.y)
  if (cell) {
    updateFillCurrent(table, drag, cell)
  }
  return true
}

/** 边缘驻留帧循环：指针停在边缘区不再产 move 事件时持续滚动；滚不动或会话结束即停帧 */
function scheduleFillEdgeScroll(table: ListTable): void {
  table.host.requestFrame(() => {
    if (!table.fillDrag) {
      return
    }
    if (scrollFillEdge(table)) {
      refreshOverlay(table)
      scheduleFillEdgeScroll(table)
    }
  })
}

/**
 * 拖选扩展段：锚点格与目标格各自合并包围盒的并（两端都未被合并覆盖时退化为两点框）。
 * 点按合并区任意覆盖格即选中整个合并区；从合并区拖出时包围盒不丢列/行。
 */
export function dragExtentRange(
  table: ListTable,
  anchor: CellRef,
  target: CellRef,
): SelectionRange {
  const a = table.mergeCells.rangeAt(anchor.col, anchor.row)
  const t = table.mergeCells.rangeAt(target.col, target.row)
  const cols = [
    a ? a.startCol : anchor.col,
    a ? a.endCol : anchor.col,
    t ? t.startCol : target.col,
    t ? t.endCol : target.col,
  ]
  const rows = [
    a ? a.startRow : anchor.row,
    a ? a.endRow : anchor.row,
    t ? t.startRow : target.row,
    t ? t.endRow : target.row,
  ]
  return {
    start: { col: Math.min(...cols), row: Math.min(...rows) },
    end: { col: Math.max(...cols), row: Math.max(...rows) },
  }
}

/** 指针是否落在填充柄上：命中返回柄所在的焦点段；焦点段右下角格不可见即无柄 */
function fillHandleHit(table: ListTable, x: number, y: number): SelectionRange | null {
  const range = resolveFocusRange(table.selection.snapshot)
  if (!range) {
    return null
  }
  const bounds = normalizeRange(range)
  const cell = cellRectInViewport(table, bounds.maxCol, bounds.maxRow)
  if (!cell) {
    return null
  }
  return hitFillHandle(x, y, cell) ? range : null
}

/** 双击/双触进编辑：两次同格落点、时长与位移均在阈值内（拖拽/滚动滚出阈值不触发） */
function detectDoubleTap(table: ListTable, event: SceneEvent): void {
  const down = table.pointerDownAt
  const cell = cellAt(table, event.x, event.y)
  const time = Date.now()
  if (!down || !cell || Math.hypot(event.x - down.x, event.y - down.y) > DOUBLE_TAP_SLOP) {
    table.lastTap = null
    return
  }
  const prev = table.lastTap
  table.lastTap = { col: cell.col, row: cell.row, x: event.x, y: event.y, time }
  if (prev && prev.col === cell.col && prev.row === cell.row && time - prev.time <= DOUBLE_TAP_MS) {
    table.lastTap = null
    table.startEdit(cell.col, cell.row)
  }
}

/** resize 拖拽指示线跟手：目标边线随夹取后的尺寸位移，提交在 pointerup 一次生效 */
function updateResizeLine(table: ListTable, event: SceneEvent): void {
  const session = table.resizeSession
  if (!session) {
    return
  }
  const { left, top } = table.scroll.state
  if (session.target.kind === 'col') {
    const index = session.target.index
    const edge = resolveCellX(
      index + 1,
      left,
      table.colOffsets,
      table.frozenColCount,
      table.rowHeaderWidth,
    )
    const size = session.sizeAt(event.x)
    table.resizeLine = {
      orientation: 'vertical',
      position: edge + (size - table.getColWidth(index)),
    }
  } else {
    const index = session.target.index
    const edge = resolveCellYFromOffsets(
      index + 1,
      top,
      table.rowOffsets,
      table.frozenRowCount,
      table.headerHeight,
    )
    const size = session.sizeAt(event.y)
    table.resizeLine = {
      orientation: 'horizontal',
      position: edge + (size - table.rowHeightAt(index)),
    }
  }
  refreshOverlay(table)
}

/** 按拖拽目标抛列/行结束事件（订阅者集合为空时零开销） */
function emitResizeEnd(table: ListTable, target: ResizeTarget): void {
  if (target.kind === 'col') {
    const event: ColResizeEndEvent = { col: target.index, width: table.getColWidth(target.index) }
    for (const listener of table.colResizeEndListeners) {
      listener(event)
    }
    return
  }
  const event: RowResizeEndEvent = { row: target.index, height: table.rowHeightAt(target.index) }
  for (const listener of table.rowResizeEndListeners) {
    listener(event)
  }
}

function onKeyDown(table: ListTable, event: SceneEvent): void {
  // 编辑中按键由编辑器处理（Esc/Enter/Tab 已在编辑器内拦截冒泡），场景导航让位
  if (table.editManager.isEditing()) {
    return
  }
  const focus = table.selection.snapshot.focus
  if (!focus || !event.key) {
    return
  }
  // editCellOnEnter 键位开关：开启后非编辑态按 Enter 进入焦点格编辑（编辑器内 Enter 提交
  // 并按 Enter 语义下移的既有行为不变）；关闭时非编辑态 Enter 保持现状（无操作）
  if (event.key === 'Enter' && table.options.editCellOnEnter) {
    table.startEdit(focus.col, focus.row)
    return
  }
  const next = nextActiveCell(
    event.key,
    focus,
    table.options.columns.length,
    table.pipeline.rowCount,
    event.shiftKey,
  )
  if (!next) {
    return
  }
  // shift+方向键扩展选区（焦点同步到扩展目标，sheet-core 选区修正补丁行为）；Tab 恒为单格移动
  const extend = event.shiftKey && event.key.startsWith('Arrow')
  table.selection.selectCell(next.col, next.row, extend)
  ensureCellVisible(table, next.col, next.row)
}

function onTouchStart(table: ListTable, event: SceneEvent): void {
  table.inertia.stop()
  table.touchTracker.start(event.x, event.y, Date.now())
}

function onTouchMove(table: ListTable, event: SceneEvent): void {
  const delta = table.touchTracker.move(event.x, event.y, Date.now())
  if (delta) {
    table.scroll.scrollBy(delta.dx, delta.dy)
  }
}

function onTouchEnd(table: ListTable, event: SceneEvent): void {
  const velocity = table.touchTracker.end(event.x, event.y, Date.now())
  if (velocity) {
    table.inertia.start(velocity)
  }
}

function onTouchCancel(table: ListTable): void {
  table.touchTracker.cancel()
  table.inertia.stop()
}

function onContextMenuEvent(table: ListTable, event: SceneEvent): void {
  if (table.contextMenuListeners.size === 0) {
    return
  }
  const emitted: TableContextMenuEvent = {
    cell: cellAt(table, event.x, event.y),
    x: event.x,
    y: event.y,
    originalEvent: event.originalEvent,
  }
  for (const listener of table.contextMenuListeners) {
    listener(emitted)
  }
}

/** 视口坐标 → 内容坐标：冻结区内不滚动，冻结区外叠加滚动位置 */
function toContentX(table: ListTable, x: number): number {
  const rel = x - table.rowHeaderWidth
  return rel < table.frozenColsWidth ? rel : rel + table.scroll.state.left
}

function toContentY(table: ListTable, y: number): number {
  const rel = y - table.headerHeight
  return rel < table.frozenRowsHeight ? rel : rel + table.scroll.state.top
}

/**
 * 视口坐标命中的数据格；行列头/空白处返回 null。
 * 合并区覆盖格路由到主格（左上角）：选区/编辑/取值/hover 都以主格为锚。
 */
export function cellAt(table: ListTable, x: number, y: number): CellRef | null {
  if (x < table.rowHeaderWidth || y < table.headerHeight) {
    return null
  }
  const col = findColAt(table.colOffsets, toContentX(table, x))
  const row = findRowAt(table.rowOffsets, toContentY(table, y))
  if (col < 0 || row < 0) {
    return null
  }
  const master = table.mergeCells.masterOf(col, row)
  return master ?? { col, row }
}

/** 数据格在视口中的矩形；冻结行列恒可见，其余须在可视窗口内，否则返回 null */
export function cellRectInViewport(table: ListTable, col: number, row: number): Region | null {
  const rowVisible = row < table.frozenRowCount || (row >= table.rows.start && row < table.rows.end)
  const colVisible = col < table.frozenColCount || (col >= table.cols.start && col < table.cols.end)
  if (!rowVisible || !colVisible) {
    return null
  }
  const { left, top } = table.scroll.state
  return {
    x: resolveCellX(col, left, table.colOffsets, table.frozenColCount, table.rowHeaderWidth),
    y: resolveCellYFromOffsets(
      row,
      top,
      table.rowOffsets,
      table.frozenRowCount,
      table.headerHeight,
    ),
    width: table.getColWidth(col),
    height: table.rowHeightAt(row),
  }
}

/**
 * 数据格视口矩形（合并感知）：合并区任意格返回整块包围盒（编辑浮层跨满合并区），
 * 普通格同 cellRectInViewport；主格不在可视窗口返回 null。
 */
export function mergeAwareCellRect(table: ListTable, col: number, row: number): Region | null {
  const range = table.mergeCells.rangeAt(col, row)
  if (!range) {
    return cellRectInViewport(table, col, row)
  }
  const base = cellRectInViewport(table, range.startCol, range.startRow)
  if (!base) {
    return null
  }
  let width = 0
  for (let c = range.startCol; c <= range.endCol; c++) {
    width += table.getColWidth(c)
  }
  let height = 0
  for (let r = range.startRow; r <= range.endRow; r++) {
    height += table.rowHeightAt(r)
  }
  return { x: base.x, y: base.y, width, height }
}

/** 滚动跟随：非冻结轴上让目标格完整进入视口（冻结轴恒可见，跳过） */
export function ensureCellVisible(table: ListTable, col: number, row: number): void {
  const { left, top } = table.scroll.state
  let nextLeft = left
  let nextTop = top
  if (col >= table.frozenColCount) {
    nextLeft = revealAxis(
      left,
      table.viewportWidth - table.frozenColsWidth,
      (table.colOffsets[col] ?? 0) - table.frozenColsWidth,
      table.getColWidth(col),
    )
  }
  if (row >= table.frozenRowCount) {
    nextTop = revealAxis(
      top,
      table.viewportHeight - table.frozenRowsHeight,
      (table.rowOffsets[row] ?? 0) - table.frozenRowsHeight,
      table.rowHeightAt(row),
    )
  }
  table.scroll.scrollTo(nextLeft, nextTop)
}

function resizeGeometry(table: ListTable): ResizeGeometry {
  return {
    colOffsets: table.colOffsets,
    rowOffsets: table.rowOffsets,
    rowHeaderWidth: table.rowHeaderWidth,
    headerHeight: table.headerHeight,
    toContentX: (x) => toContentX(table, x),
    toContentY: (y) => toContentY(table, y),
  }
}

/** 刷新 sky 浮层；仅在（或曾在）有内容时提交 sky 失效，避免空浮层空转整层重绘 */
export function refreshOverlay(table: ListTable): void {
  refreshHeaderHighlight(table)
  const fillDrag = table.fillDrag
  let fillPreview: OverlayContent['fillPreview'] = null
  if (fillDrag) {
    const anchor = normalizeRange(fillDrag.range)
    fillPreview = resolveFillPreview(
      anchor,
      resolveFillTarget(anchor, fillDrag.origin, fillDrag.current),
    )
  }
  const has = table.overlay.update({
    selection: table.selection.snapshot,
    hover: table.hoverState.cell,
    resizeLine: table.resizeLine,
    // 填充柄挂在焦点段右下角（无选区为 null）
    fillHandleRange: resolveFocusRange(table.selection.snapshot),
    // 填充拖拽预览：轴锁定后的纯扩展区（非拖拽中为 null）
    fillPreview,
    // 冻结行列恒可见，裁剪窗口从 0 起并到滚动窗口末
    window: {
      rows: { start: 0, end: Math.max(table.rows.end, table.frozenRowCount) },
      cols: { start: 0, end: Math.max(table.cols.end, table.frozenColCount) },
    },
  })
  if (has || table.overlayHadContent) {
    table.host.submitInvalidation('sky', { type: 'full' })
  }
  table.overlayHadContent = has
}

/**
 * 整行/整列选区联动表头高亮：选区签名（段集合×全表行列数）未变化时零开销跳过
 * （hover 变更同样途经 refreshOverlay，靠签名守卫避免无谓重涂）；
 * 变化时只重涂翻转的表头节点，并按条带登记 body band 失效——不产生跨数据区的 body band/full。
 */
function refreshHeaderHighlight(table: ListTable): void {
  const signature = `${JSON.stringify(table.selection.snapshot.ranges)}|${table.options.columns.length}|${table.pipeline.rowCount}`
  if (signature === table.headerHighlightSignature) {
    return
  }
  table.headerHighlightSignature = signature
  const flipped = applyHeaderHighlight(table)
  if (flipped.cols) {
    table.host.submitInvalidation('body', { type: 'band', region: flipped.cols })
  }
  if (flipped.rows) {
    table.host.submitInvalidation('body', { type: 'band', region: flipped.rows })
  }
}
