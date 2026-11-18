// ListTable 交互接线协作模块：
// 指针/触摸/键盘/contextmenu 场景事件接线、拖选/悬停/resize 会话/填充柄/双击进编辑/列头单击、
// 视口命中与坐标换算、滚动跟随、sky 浮层刷新。以 ListTable 实例为参数的协作函数，
// 只触碰表实例上的 @internal 状态容器。

import {
  cursorForEdge,
  findColAt,
  findRowAt,
  floatHandleEdge,
  hitResizeHandle,
  hitScrollbar,
  mapScrollbarThumbDrag,
  mapScrollbarTrackPoint,
  normalizeRange,
  planScrollbarThumb,
  ResizeSession,
  resolveCellX,
  resolveCellYFromOffsets,
  spanHeight,
  spanWidth,
  type ColResizeEndEvent,
  type FloatTransformHandle,
  type RangeBounds,
  type ResizeGeometry,
  type ResizeTarget,
  type RowResizeEndEvent,
  type ScrollbarHit,
  type ScrollbarThumbGeometry,
  type SelectionRange,
} from '@infinitable/grid'
import type { Region, SceneEvent } from '@infinitable/render'

import { EDITOR_STRADDLE_PX } from './editing/text-editor'
import {
  clampToAnchorAxis,
  hitFillHandle,
  resolveFillPreview,
  resolveFillTarget,
  resolveFocusRange,
  type FillDragEndEvent,
  type FillDragState,
  type FillHandleDoubleClickEvent,
  type FillHandleDownEvent,
} from './fill-handle'
import type { OverlayContent } from './interaction-overlay'
import { nextActiveCell, revealAxis } from './keyboard-navigation'
import type { ListTable } from './list-table'
import { applyHeaderHighlight, editorBorderInsets } from './list-table-scene'
import type {
  CellAddress,
  CellLink,
  CellLinkClickEvent,
  CellLinkHoverEvent,
  CellLinkLeaveEvent,
  ColHeaderClickEvent,
  ImageLinkClickEvent,
  PointerEventHost,
  TableContextMenuEvent,
} from './types'

/** 双击/双触判定窗口与位移阈值 */
const DOUBLE_TAP_MS = 400
const DOUBLE_TAP_SLOP = 10

/** 单击判定位移阈值：down/up 落点距离超过该值视为拖拽，不派发链接/列头单击 */
const CLICK_SLOP = 10

function selectionInteractive(table: ListTable): boolean {
  return table.options.interactiveSelection !== false
}

function fillHandleEnabled(table: ListTable): boolean {
  return table.options.fillHandle !== false
}

/** 表头拖选会话：pointerdown 命中列头/行头后开启，锚定按下时命中的列/行，pointerup 重算后结束 */
export interface HeaderDragState {
  axis: 'col' | 'row'
  anchor: number
}

const FILL_EDGE_ZONE = 32
const FILL_EDGE_STEP = 24
const RESIZE_CURSOR = { col: 'col-resize', row: 'row-resize' } as const

function transformHandleCursor(handle: FloatTransformHandle): string {
  return handle === 'rotate' ? 'grab' : cursorForEdge(floatHandleEdge(handle))
}

/** 场景事件统一接线 */
export function bindInteractionEvents(table: ListTable): void {
  const { sceneState, interactionState } = table
  const bodyRoot = sceneState.body.root
  const forwardSkyPointer = (event: SceneEvent): void => {
    if (event.type === 'pointerdown') onPointerDown(table, event, true)
    else if (event.type === 'pointermove') onPointerMove(table, event)
    else if (event.type === 'pointerup') onPointerUp(table, event)
  }
  interactionState.eventUnsubscribers.push(
    bodyRoot.on('pointerdown', (event) => onPointerDown(table, event)),
    bodyRoot.on('pointermove', (event) => onPointerMove(table, event)),
    bodyRoot.on('pointerup', (event) => onPointerUp(table, event)),
    bodyRoot.on('contextmenu', (event) => onContextMenuEvent(table, event)),
    bodyRoot.on('touchstart', (event) => onTouchStart(table, event)),
    bodyRoot.on('touchmove', (event) => onTouchMove(table, event)),
    bodyRoot.on('touchend', (event) => onTouchEnd(table, event)),
    bodyRoot.on('touchcancel', () => onTouchCancel(table)),
    sceneState.sky.root.on('pointerdown', forwardSkyPointer),
    sceneState.sky.root.on('pointermove', forwardSkyPointer),
    sceneState.sky.root.on('pointerup', forwardSkyPointer),
    sceneState.sky.root.on('keydown', (event) => onKeyDown(table, event)),
    interactionState.selection.onChange(() => refreshOverlay(table)),
  )
}

function colHeaderAt(table: ListTable, x: number, y: number): number | null {
  if (table.headerHeight <= 0 || y < 0 || y >= table.headerHeight || x < table.rowHeaderWidth) {
    return null
  }
  const col = findColAt(table.geometryState.colOffsets, toContentX(table, x))
  return col >= 0 ? col : null
}

function onPointerDown(table: ListTable, event: SceneEvent, fromSkyRoot = false): void {
  if (event.button !== undefined && event.button !== 0) {
    return
  }
  if (fromSkyRoot) {
    const scrollbar = scrollbarHit(table, event.x, event.y)
    if (scrollbar) {
      beginScrollbarDrag(table, scrollbar, event)
    }
    return
  }
  const { interactionState, geometryState } = table
  interactionState.pointerDownAt = { x: event.x, y: event.y }
  interactionState.pointerDownCell = null
  interactionState.pointerDownColHeader = null
  interactionState.headerDrag = null

  const floats = table.floatLayer
  if (floats) {
    const handle = floats.handleAt(event.x, event.y)
    if (handle) {
      floats.beginTransform(handle, event.x, event.y)
      return
    }
    const floatObject = floats.getAt(event.x, event.y)
    if (floatObject) {
      floats.select(floatObject.id)
      floats.beginDrag(floatObject.id, event.x, event.y)
      return
    }
    floats.clearSelection()
  }

  const scrollbar = scrollbarHit(table, event.x, event.y)
  if (scrollbar) {
    beginScrollbarDrag(table, scrollbar, event)
    return
  }

  if (
    event.x < 0 ||
    event.y < 0 ||
    event.x >= table.rowHeaderWidth + table.viewportWidth ||
    event.y >= table.headerHeight + table.viewportHeight
  ) {
    return
  }

  const hit = cellAt(table, event.x, event.y)
  const editing = table.editManager.editingCell()
  if (editing && (!hit || hit.col !== editing.col || hit.row !== editing.row)) {
    if (!(interactionState.editPickMode && hit)) {
      table.editManager.commitEdit()
    }
  }
  const picking = editing !== null && interactionState.editPickMode
  const handle = resizeHandleAt(table, event.x, event.y)
  if (handle) {
    const startSize =
      handle.kind === 'col' ? table.getColWidth(handle.index) : table.rowHeightAt(handle.index)
    interactionState.resizeSession = new ResizeSession(
      handle,
      startSize,
      handle.kind === 'col' ? event.x : event.y,
    )
    table.setContainerCursor(RESIZE_CURSOR[handle.kind])
    bindPointerSessionCapture(table)
    return
  }

  const fillRange =
    picking || !selectionInteractive(table) ? null : fillHandleHit(table, event.x, event.y)
  if (fillRange) {
    const bounds = normalizeRange(fillRange)
    const origin = { col: bounds.maxCol, row: bounds.maxRow }
    const now = Date.now()
    const lastTap = interactionState.lastFillHandleTap
    interactionState.fillHandleDoubleTap =
      lastTap !== null &&
      lastTap.key === fillHandleTapKey(bounds) &&
      now - lastTap.time <= DOUBLE_TAP_MS
    interactionState.fillDrag = {
      range: fillRange,
      origin,
      current: origin,
      pointer: { x: event.x, y: event.y },
      edge: { dx: 0, dy: 0 },
    }
    const down: FillHandleDownEvent = { range: fillRange }
    for (const listener of interactionState.fillHandleDownListeners) {
      listener(down)
    }
    scheduleFillEdgeScroll(table)
    return
  }

  if (event.x < table.rowHeaderWidth && event.y < table.headerHeight) {
    if (selectionInteractive(table)) {
      const visible = table.getBodyVisibleCellRange()
      interactionState.selection.selectAll(table.columns.length, table.pipeline.rowCount, {
        col: visible.cols.start,
        row: visible.rows.start,
      })
    }
    return
  }

  if (event.y < table.headerHeight) {
    const col = colHeaderAt(table, event.x, event.y)
    if (col !== null) {
      interactionState.pointerDownColHeader = col
      if (selectionInteractive(table) && table.pipeline.rowCount > 0) {
        interactionState.headerDrag = { axis: 'col', anchor: col }
        interactionState.selection.beginDragRange(
          { col, row: 0 },
          { col, row: table.pipeline.rowCount - 1 },
          { col, row: table.getBodyVisibleCellRange().rows.start },
        )
      }
    }
    return
  }

  if (selectionInteractive(table) && event.x < table.rowHeaderWidth) {
    const row = findRowAt(geometryState.rowOffsets, toContentY(table, event.y))
    if (row >= 0 && table.columns.length > 0) {
      interactionState.headerDrag = { axis: 'row', anchor: row }
      interactionState.selection.beginDragRange(
        { col: 0, row },
        { col: table.columns.length - 1, row },
        { col: table.getBodyVisibleCellRange().cols.start, row },
      )
    }
    return
  }

  const cell = cellAt(table, event.x, event.y)
  if (cell) {
    interactionState.pointerDownCell = cell
    if (!selectionInteractive(table)) {
      return
    }
    const extent = dragExtentRange(table, cell, cell)
    const shiftAnchor = event.shiftKey ? resolveShiftAnchor(table, cell) : null
    if (shiftAnchor) {
      const anchorExtent = dragExtentRange(table, shiftAnchor, shiftAnchor)
      interactionState.selection.beginDragRange(anchorExtent.start, extent.end)
      interactionState.dragAnchor = { ...anchorExtent.start }
    } else if (table.options.ctrlMultiSelect === true && (event.ctrlKey || event.metaKey)) {
      interactionState.selection.addRange(extent)
    } else {
      interactionState.selection.beginDragRange(extent.start, extent.end)
      interactionState.dragAnchor = { ...extent.start }
    }
    interactionState.selecting = true
  }
}

function resolveShiftAnchor(table: ListTable, target: CellAddress): CellAddress | null {
  const hooked = table.options.resolveShiftSelectAnchor?.(target)
  if (hooked !== undefined) {
    return hooked
  }
  const ranges = table.interactionState.selection.snapshot.ranges
  return ranges[ranges.length - 1]?.start ?? null
}

function onPointerMove(table: ListTable, event: SceneEvent): void {
  const { interactionState } = table
  if (interactionState.scrollbarConfig.visibility === 'hover') {
    table.pokeScrollbar()
  }
  if (table.floatLayer?.isTransforming()) {
    table.floatLayer.transformMove(event.x, event.y, event.shiftKey)
    return
  }
  if (table.floatLayer?.isDragging()) {
    table.floatLayer.dragMove(event.x, event.y)
    return
  }
  if (interactionState.scrollbarDrag) {
    if (pointerButtons(event) === 0) {
      endScrollbarDrag(table, event)
      return
    }
    const session = interactionState.scrollbarDrag
    const geometry = scrollbarGeometry(table, session.axis)
    if (geometry) {
      const delta = (session.axis === 'vertical' ? event.y : event.x) - session.startPx
      session.pendingOffset = mapScrollbarThumbDrag(geometry, session.startOffset, delta)
      table.host.requestFrame(table.scrollbarCommitTask)
    }
    table.pokeScrollbar()
    table.setContainerCursor('default')
    return
  }
  if (interactionState.resizeSession) {
    if (pointerButtons(event) === 0) {
      onPointerUp(table, event)
      return
    }
    table.setContainerCursor(RESIZE_CURSOR[interactionState.resizeSession.target.kind])
    updateResizeLine(table, event)
    return
  }
  if (interactionState.fillDrag) {
    table.setContainerCursor('crosshair')
    const drag = interactionState.fillDrag
    drag.pointer = { x: event.x, y: event.y }
    drag.edge = fillEdgeVelocity(table, event.x, event.y)
    if (scrollFillEdge(table)) {
      scheduleFillEdgeScroll(table)
    }
    const cell = cellAt(table, event.x, event.y)
    if (cell) {
      updateFillCurrent(drag, cell)
    }
    refreshOverlay(table)
    return
  }
  if (interactionState.headerDrag) {
    extendHeaderDrag(table, event.x, event.y)
    return
  }
  const cell = cellAt(table, event.x, event.y)
  if (interactionState.selecting) {
    if (cell) {
      const last =
        interactionState.selection.snapshot.ranges[
          interactionState.selection.snapshot.ranges.length - 1
        ]
      if (last) {
        const anchor = interactionState.dragAnchor ?? last.start
        const extent = dragExtentRange(table, anchor, cell)
        const lo = extent.start
        const hi = extent.end
        const anchorInsideSpan =
          (lo.col < anchor.col && anchor.col < hi.col) ||
          (lo.row < anchor.row && anchor.row < hi.row)
        const segment = anchorInsideSpan
          ? { start: { ...lo }, end: { ...hi } }
          : {
              start: { ...anchor },
              end: {
                col: anchor.col === lo.col ? hi.col : lo.col,
                row: anchor.row === lo.row ? hi.row : lo.row,
              },
            }
        interactionState.selection.updateDragRange(segment.start, segment.end)
      } else {
        interactionState.selection.updateDrag(cell.col, cell.row)
      }
      ensureCellVisible(table, cell.col, cell.row)
    }
    return
  }
  updatePointerCursor(table, event)
}

function onPointerUp(table: ListTable, event: SceneEvent): void {
  const { interactionState } = table
  if (table.floatLayer?.isTransforming()) {
    table.floatLayer.endTransform()
    return
  }
  if (table.floatLayer?.isDragging()) {
    table.floatLayer.endDrag()
    dispatchFloatImageLinkClick(table, event)
    return
  }
  const floats = table.floatLayer
  if (floats && floats.getSelectedId() !== null && floats.getAt(event.x, event.y)) {
    dispatchFloatImageLinkClick(table, event)
    return
  }
  if (interactionState.scrollbarDrag) {
    endScrollbarDrag(table, event)
    return
  }
  if (interactionState.resizeSession) {
    const session = interactionState.resizeSession
    releasePointerSessionCapture(table)
    interactionState.resizeSession = null
    interactionState.resizeLine = null
    const pointer = session.target.kind === 'col' ? event.x : event.y
    if (session.target.kind === 'col') {
      table.setColWidth(session.target.index, session.sizeAt(pointer))
    } else {
      table.setRowHeight(session.target.index, session.sizeAt(pointer))
    }
    emitResizeEnd(table, session.target)
    updatePointerCursor(table, event)
    return
  }
  if (interactionState.fillDrag) {
    const drag = interactionState.fillDrag
    interactionState.fillDrag = null
    const anchor = normalizeRange(drag.range)
    const target = resolveFillTarget(anchor, drag.origin, drag.current)
    const doubleTap = interactionState.fillHandleDoubleTap
    interactionState.fillHandleDoubleTap = false
    if (resolveFillPreview(anchor, target) === null) {
      interactionState.lastFillHandleTap = doubleTap
        ? null
        : { key: fillHandleTapKey(anchor), time: Date.now() }
      if (doubleTap) {
        const doubleEvent: FillHandleDoubleClickEvent = { range: drag.range }
        for (const listener of interactionState.fillHandleDoubleClickListeners) {
          listener(doubleEvent)
        }
        refreshOverlay(table)
        return
      }
    } else {
      interactionState.lastFillHandleTap = null
    }
    const targetEvent: FillDragEndEvent = { anchor, target }
    for (const listener of interactionState.fillDragEndListeners) {
      listener(targetEvent)
    }
    refreshOverlay(table)
    return
  }
  if (interactionState.headerDrag) {
    extendHeaderDrag(table, event.x, event.y)
    interactionState.headerDrag = null
    interactionState.selection.endDrag()
    dispatchColHeaderClick(table, event)
    return
  }
  interactionState.selecting = false
  interactionState.dragAnchor = null
  interactionState.selection.endDrag()
  updatePointerCursor(table, event)
  if (interactionState.pointerDownColHeader !== null) {
    dispatchColHeaderClick(table, event)
    return
  }
  if (!(interactionState.editPickMode && table.editManager.isEditing())) {
    if (detectDoubleTap(table, event)) {
      return
    }
    if (dispatchCellImageLinkClick(table, event)) {
      return
    }
    dispatchCellLinkClick(table, event)
  }
}

/** 列头单击派发：主键按下与抬起落在同一列头且位移在阈值内（非 resize 手柄） */
function dispatchColHeaderClick(table: ListTable, event: SceneEvent): void {
  const { interactionState } = table
  const downCol = interactionState.pointerDownColHeader
  interactionState.pointerDownColHeader = null
  if (event.button !== undefined && event.button !== 0) {
    return
  }
  const down = interactionState.pointerDownAt
  if (!down || downCol === null) {
    return
  }
  if (Math.hypot(event.x - down.x, event.y - down.y) > CLICK_SLOP) {
    return
  }
  if (colHeaderAt(table, event.x, event.y) !== downCol) {
    return
  }
  if (interactionState.colHeaderClickListeners.size === 0) {
    return
  }
  const emitted: ColHeaderClickEvent = {
    col: downCol,
    x: event.x,
    y: event.y,
    originalEvent: event.originalEvent,
  }
  for (const listener of interactionState.colHeaderClickListeners) {
    listener(emitted)
  }
}

function extendHeaderDrag(table: ListTable, x: number, y: number): void {
  const { interactionState, geometryState } = table
  const drag = interactionState.headerDrag
  if (!drag) {
    return
  }
  const isCol = drag.axis === 'col'
  const axisCount = isCol ? table.columns.length : table.pipeline.rowCount
  const fullCount = isCol ? table.pipeline.rowCount : table.columns.length
  const content = isCol ? toContentX(table, x) : toContentY(table, y)
  const hit = isCol
    ? findColAt(geometryState.colOffsets, content)
    : findRowAt(geometryState.rowOffsets, content)
  const target = hit >= 0 ? hit : content < 0 ? 0 : axisCount - 1
  const min = Math.min(drag.anchor, target)
  const max = Math.max(drag.anchor, target)
  const start = isCol ? { col: min, row: 0 } : { col: 0, row: min }
  const end = isCol ? { col: max, row: fullCount - 1 } : { col: fullCount - 1, row: max }
  const last =
    interactionState.selection.snapshot.ranges[
      interactionState.selection.snapshot.ranges.length - 1
    ]
  if (
    last &&
    last.start.col === start.col &&
    last.start.row === start.row &&
    last.end.col === end.col &&
    last.end.row === end.row
  ) {
    return
  }
  interactionState.selection.updateDragRange(start, end)
}

function updateFillCurrent(drag: FillDragState, cell: CellAddress): void {
  drag.current = clampToAnchorAxis(drag.origin, cell, normalizeRange(drag.range))
}

function fillEdgeVelocity(table: ListTable, x: number, y: number): { dx: number; dy: number } {
  const { geometryState } = table
  let dx = 0
  let dy = 0
  if (y >= table.height - table.scrollbarGutterHeight - FILL_EDGE_ZONE) {
    dy = FILL_EDGE_STEP
  } else if (y <= table.headerHeight + geometryState.frozenRowsHeight + FILL_EDGE_ZONE) {
    dy = -FILL_EDGE_STEP
  }
  if (x >= table.width - table.scrollbarGutterWidth - FILL_EDGE_ZONE) {
    dx = FILL_EDGE_STEP
  } else if (x <= table.rowHeaderWidth + geometryState.frozenColsWidth + FILL_EDGE_ZONE) {
    dx = -FILL_EDGE_STEP
  }
  return { dx, dy }
}

function scrollFillEdge(table: ListTable): boolean {
  const drag = table.interactionState.fillDrag
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
    updateFillCurrent(drag, cell)
  }
  return true
}

function scheduleFillEdgeScroll(table: ListTable): void {
  table.host.requestFrame(() => {
    if (!table.interactionState.fillDrag) {
      return
    }
    if (scrollFillEdge(table)) {
      refreshOverlay(table)
      scheduleFillEdgeScroll(table)
    }
  })
}

function dragExtentRange(
  table: ListTable,
  anchor: CellAddress,
  target: CellAddress,
): SelectionRange {
  const { mergeCells } = table.geometryState
  const a = mergeCells.rangeAt(anchor.col, anchor.row)
  const t = mergeCells.rangeAt(target.col, target.row)
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

function fillHandleHit(table: ListTable, x: number, y: number): SelectionRange | null {
  if (!fillHandleEnabled(table)) {
    return null
  }
  const range = resolveFocusRange(table.interactionState.selection.snapshot)
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

function fillHandleTapKey(bounds: RangeBounds): string {
  return `${bounds.minCol},${bounds.minRow}:${bounds.maxCol},${bounds.maxRow}`
}

function detectDoubleTap(table: ListTable, event: SceneEvent): boolean {
  const { interactionState } = table
  const down = interactionState.pointerDownAt
  const cell = cellAt(table, event.x, event.y)
  const time = Date.now()
  if (!down || !cell || Math.hypot(event.x - down.x, event.y - down.y) > DOUBLE_TAP_SLOP) {
    interactionState.lastTap = null
    return false
  }
  const prev = interactionState.lastTap
  interactionState.lastTap = {
    col: cell.col,
    row: cell.row,
    x: event.x,
    y: event.y,
    time,
  }
  if (prev && prev.col === cell.col && prev.row === cell.row && time - prev.time <= DOUBLE_TAP_MS) {
    interactionState.lastTap = null
    return table.startEdit(cell.col, cell.row)
  }
  return false
}

function updateResizeLine(table: ListTable, event: SceneEvent): void {
  const { interactionState, geometryState } = table
  const session = interactionState.resizeSession
  if (!session) {
    return
  }
  const { left, top } = table.scroll.state
  if (session.target.kind === 'col') {
    const index = session.target.index
    const edge = resolveCellX(
      index + 1,
      left,
      geometryState.colOffsets,
      geometryState.frozenColCount,
      table.rowHeaderWidth,
    )
    const size = session.sizeAt(event.x)
    interactionState.resizeLine = {
      orientation: 'vertical',
      position: clampResizeLinePosition(
        table,
        'vertical',
        edge + (size - table.getColWidth(index)),
      ),
    }
  } else {
    const index = session.target.index
    const edge = resolveCellYFromOffsets(
      index + 1,
      top,
      geometryState.rowOffsets,
      geometryState.frozenRowCount,
      table.headerHeight,
    )
    const size = session.sizeAt(event.y)
    interactionState.resizeLine = {
      orientation: 'horizontal',
      position: clampResizeLinePosition(
        table,
        'horizontal',
        edge + (size - table.rowHeightAt(index)),
      ),
    }
  }
  refreshOverlay(table)
}

function clampResizeLinePosition(
  table: ListTable,
  orientation: 'vertical' | 'horizontal',
  position: number,
): number {
  const viewport = table.bodyViewport
  if (orientation === 'vertical') {
    return Math.min(Math.max(position, viewport.x + 1), viewport.x + viewport.width - 1)
  }
  return Math.min(Math.max(position, viewport.y + 1), viewport.y + viewport.height - 1)
}

function emitResizeEnd(table: ListTable, target: ResizeTarget): void {
  const { interactionState } = table
  if (target.kind === 'col') {
    const event: ColResizeEndEvent = {
      col: target.index,
      width: table.getColWidth(target.index),
    }
    for (const listener of interactionState.colResizeEndListeners) {
      listener(event)
    }
    return
  }
  const event: RowResizeEndEvent = {
    row: target.index,
    height: table.rowHeightAt(target.index),
  }
  for (const listener of interactionState.rowResizeEndListeners) {
    listener(event)
  }
}

function onKeyDown(table: ListTable, event: SceneEvent): void {
  if (table.editManager.isEditing()) {
    return
  }
  const focus = table.interactionState.selection.snapshot.focus
  if (!focus || !event.key) {
    return
  }
  if (event.key === 'Enter' && table.options.editCellOnEnter) {
    table.startEdit(focus.col, focus.row)
    return
  }
  if (!selectionInteractive(table)) {
    return
  }
  const next = nextActiveCell(
    event.key,
    focus,
    table.columns.length,
    table.pipeline.rowCount,
    event.shiftKey,
  )
  if (!next) {
    return
  }
  const extend = event.shiftKey && event.key.startsWith('Arrow')
  table.interactionState.selection.selectCell(next.col, next.row, extend)
  ensureCellVisible(table, next.col, next.row)
}

function onTouchStart(table: ListTable, event: SceneEvent): void {
  table.interactionState.inertia.stop()
  table.interactionState.touchTracker.start(event.x, event.y, Date.now())
}

function onTouchMove(table: ListTable, event: SceneEvent): void {
  const delta = table.interactionState.touchTracker.move(event.x, event.y, Date.now())
  if (delta) {
    table.scroll.scrollBy(delta.dx, delta.dy)
  }
}

function onTouchEnd(table: ListTable, event: SceneEvent): void {
  const velocity = table.interactionState.touchTracker.end(event.x, event.y, Date.now())
  if (velocity) {
    table.interactionState.inertia.start(velocity)
  }
}

function onTouchCancel(table: ListTable): void {
  table.interactionState.touchTracker.cancel()
  table.interactionState.inertia.stop()
}

function onContextMenuEvent(table: ListTable, event: SceneEvent): void {
  const floats = table.floatLayer
  if (floats) {
    const floatObject = floats.getAt(event.x, event.y)
    if (floatObject) {
      floats.dispatchContextMenu(floatObject, event)
      return
    }
  }
  if (table.interactionState.contextMenuListeners.size === 0) {
    return
  }
  event.originalEvent.preventDefault?.()
  const emitted: TableContextMenuEvent = {
    cell: cellAt(table, event.x, event.y),
    region: contextMenuRegion(table, event.x, event.y),
    x: event.x,
    y: event.y,
    originalEvent: event.originalEvent,
  }
  for (const listener of table.interactionState.contextMenuListeners) {
    listener(emitted)
  }
}

function contextMenuRegion(
  table: ListTable,
  x: number,
  y: number,
): TableContextMenuEvent['region'] {
  if (y < table.headerHeight && x >= table.rowHeaderWidth) {
    return 'col-header'
  }
  if (x < table.rowHeaderWidth && y >= table.headerHeight) {
    return 'row-header'
  }
  return 'body'
}

function toContentX(table: ListTable, x: number): number {
  const rel = x - table.rowHeaderWidth
  return rel < table.geometryState.frozenColsWidth ? rel : rel + table.scroll.state.left
}

function toContentY(table: ListTable, y: number): number {
  const rel = y - table.headerHeight
  return rel < table.geometryState.frozenRowsHeight ? rel : rel + table.scroll.state.top
}

export function cellAt(table: ListTable, x: number, y: number): CellAddress | null {
  if (x < table.rowHeaderWidth || y < table.headerHeight) {
    return null
  }
  const { geometryState } = table
  const col = findColAt(geometryState.colOffsets, toContentX(table, x))
  const row = findRowAt(geometryState.rowOffsets, toContentY(table, y))
  if (col < 0 || row < 0) {
    return null
  }
  const master = geometryState.mergeCells.masterOf(col, row)
  return master ?? { col, row }
}

export function cellRectInViewport(table: ListTable, col: number, row: number): Region | null {
  const { geometryState } = table
  const rowVisible =
    row < geometryState.frozenRowCount ||
    (row >= geometryState.rows.start && row < geometryState.rows.end)
  const colVisible =
    col < geometryState.frozenColCount ||
    (col >= geometryState.cols.start && col < geometryState.cols.end)
  if (!rowVisible || !colVisible) {
    return null
  }
  const { left, top } = table.scroll.state
  return {
    x: resolveCellX(
      col,
      left,
      geometryState.colOffsets,
      geometryState.frozenColCount,
      table.rowHeaderWidth,
    ),
    y: resolveCellYFromOffsets(
      row,
      top,
      geometryState.rowOffsets,
      geometryState.frozenRowCount,
      table.headerHeight,
    ),
    width: table.getColWidth(col),
    height: table.rowHeightAt(row),
  }
}

export function mergeAwareCellRect(table: ListTable, col: number, row: number): Region | null {
  const { geometryState } = table
  const range = geometryState.mergeCells.rangeAt(col, row)
  if (!range) {
    return cellRectInViewport(table, col, row)
  }
  const base = cellRectInViewport(table, range.startCol, range.startRow)
  if (!base) {
    return null
  }
  return {
    x: base.x,
    y: base.y,
    width: spanWidth(geometryState.colOffsets, range.startCol, range.endCol),
    height: spanHeight(geometryState.rowOffsets, range.startRow, range.endRow),
  }
}

export function editorCellRect(table: ListTable, col: number, row: number): Region | null {
  const rect = mergeAwareCellRect(table, col, row)
  if (!rect || !table.options.editorInsideBorder) {
    return rect
  }
  const master = table.geometryState.mergeCells.masterOf(col, row) ?? { col, row }
  const insets = editorBorderInsets(
    table,
    master.col,
    master.row,
    table.resolveStyle(master.col, master.row),
  )
  const pad = EDITOR_STRADDLE_PX
  return {
    x: rect.x + insets.left + pad,
    y: rect.y + insets.top + pad,
    width: Math.max(1, rect.width - insets.left - insets.right - pad * 2),
    height: Math.max(1, rect.height - insets.top - insets.bottom - pad * 2),
  }
}

export function ensureCellVisible(table: ListTable, col: number, row: number): void {
  const { geometryState } = table
  const { left, top } = table.scroll.state
  let nextLeft = left
  let nextTop = top
  if (col >= geometryState.frozenColCount) {
    nextLeft = revealAxis(
      left,
      table.viewportWidth - geometryState.frozenColsWidth,
      (geometryState.colOffsets[col] ?? 0) - geometryState.frozenColsWidth,
      table.getColWidth(col),
    )
  }
  if (row >= geometryState.frozenRowCount) {
    nextTop = revealAxis(
      top,
      table.viewportHeight - geometryState.frozenRowsHeight,
      (geometryState.rowOffsets[row] ?? 0) - geometryState.frozenRowsHeight,
      table.rowHeightAt(row),
    )
  }
  table.scroll.scrollTo(nextLeft, nextTop)
}

function resizeGeometry(table: ListTable): ResizeGeometry {
  const { geometryState } = table
  return {
    colOffsets: geometryState.colOffsets,
    rowOffsets: geometryState.rowOffsets,
    rowHeaderWidth: table.rowHeaderWidth,
    headerHeight: table.headerHeight,
    toContentX: (x) => toContentX(table, x),
    toContentY: (y) => toContentY(table, y),
  }
}

function resizeHandleAt(table: ListTable, x: number, y: number): ResizeTarget | null {
  return hitResizeHandle(x, y, resizeGeometry(table), {
    canResizeCol: table.options.canResizeCol,
    canResizeRow: table.options.canResizeRow,
  })
}

function updatePointerCursor(table: ListTable, event: SceneEvent): void {
  const { x, y } = event
  const link = updateLinkHover(table, event)
  const floats = table.floatLayer
  if (floats) {
    const handle = floats.handleAt(x, y)
    if (handle) {
      table.setContainerCursor(transformHandleCursor(handle))
      return
    }
  }
  if (updateScrollbarHover(table, x, y)) {
    table.setContainerCursor('default')
    return
  }
  const handle = resizeHandleAt(table, x, y)
  if (handle) {
    table.setContainerCursor(RESIZE_CURSOR[handle.kind])
    return
  }
  table.setContainerCursor(fillHandleHit(table, x, y) ? 'crosshair' : link ? 'pointer' : 'auto')
}

function updateLinkHover(table: ListTable, event: SceneEvent): CellLink | null {
  const { interactionState } = table
  const resolve = table.options.resolveCellLink
  if (!resolve) {
    return null
  }
  const cell = cellAt(table, event.x, event.y)
  const link = cell ? (resolve(cell.col, cell.row) ?? null) : null
  const hover = interactionState.linkHover
  const sameCell =
    hover !== null && cell !== null && hover.col === cell.col && hover.row === cell.row
  if (hover && (!sameCell || link === null)) {
    interactionState.linkHover = null
    if (interactionState.cellLinkLeaveListeners.size > 0) {
      const leave: CellLinkLeaveEvent = { col: hover.col, row: hover.row }
      for (const listener of interactionState.cellLinkLeaveListeners) {
        listener(leave)
      }
    }
  }
  if (!sameCell && cell && link) {
    interactionState.linkHover = { col: cell.col, row: cell.row }
    if (interactionState.cellLinkHoverListeners.size > 0) {
      const hoverEvent: CellLinkHoverEvent = {
        col: cell.col,
        row: cell.row,
        url: link.url,
        text: link.text,
        x: event.x,
        y: event.y,
        originalEvent: event.originalEvent,
      }
      for (const listener of interactionState.cellLinkHoverListeners) {
        listener(hoverEvent)
      }
    }
  }
  return link
}

function dispatchCellLinkClick(table: ListTable, event: SceneEvent): void {
  const { interactionState } = table
  if (event.button !== undefined && event.button !== 0) {
    return
  }
  const down = interactionState.pointerDownAt
  const downCell = interactionState.pointerDownCell
  if (!down || !downCell) {
    return
  }
  if (Math.hypot(event.x - down.x, event.y - down.y) > CLICK_SLOP) {
    return
  }
  const cell = cellAt(table, event.x, event.y)
  if (!cell || cell.col !== downCell.col || cell.row !== downCell.row) {
    return
  }
  const link = table.options.resolveCellLink?.(cell.col, cell.row)
  if (!link) {
    return
  }
  if (interactionState.cellLinkClickListeners.size > 0) {
    const emitted: CellLinkClickEvent = {
      col: cell.col,
      row: cell.row,
      url: link.url,
      text: link.text,
      originalEvent: event.originalEvent,
    }
    for (const listener of interactionState.cellLinkClickListeners) {
      listener(emitted)
    }
  }
  if (table.options.openCellLinkOnClick !== false) {
    openCellLinkDefault(table, link.url)
  }
}

function openCellLinkInBrowser(url: string): void {
  const win = (
    globalThis as {
      window?: { open(url: string, target: string, features: string): unknown } | undefined
    }
  ).window
  win?.open(url, '_blank', 'noopener')
}

function openCellLinkDefault(table: ListTable, url: string): void {
  const open = table.options.openCellLink ?? openCellLinkInBrowser
  open(url)
}

function emitImageLinkClick(table: ListTable, event: ImageLinkClickEvent): void {
  const { interactionState } = table
  if (interactionState.imageLinkClickListeners.size > 0) {
    for (const listener of interactionState.imageLinkClickListeners) {
      listener(event)
    }
  }
  if (table.options.openCellLinkOnClick !== false) {
    openCellLinkDefault(table, event.url)
  }
}

function dispatchFloatImageLinkClick(table: ListTable, event: SceneEvent): void {
  if (event.button !== undefined && event.button !== 0) {
    return
  }
  const down = table.interactionState.pointerDownAt
  if (!down) {
    return
  }
  if (Math.hypot(event.x - down.x, event.y - down.y) > CLICK_SLOP) {
    return
  }
  const object = table.floatLayer?.getAt(event.x, event.y)
  if (!object?.link) {
    return
  }
  emitImageLinkClick(table, {
    kind: 'float',
    id: object.id,
    url: object.link,
    originalEvent: event.originalEvent,
  })
}

function dispatchCellImageLinkClick(table: ListTable, event: SceneEvent): boolean {
  const { interactionState } = table
  if (event.button !== undefined && event.button !== 0) {
    return false
  }
  const down = interactionState.pointerDownAt
  const downCell = interactionState.pointerDownCell
  if (!down || !downCell) {
    return false
  }
  if (Math.hypot(event.x - down.x, event.y - down.y) > CLICK_SLOP) {
    return false
  }
  const cell = cellAt(table, event.x, event.y)
  if (!cell || cell.col !== downCell.col || cell.row !== downCell.row) {
    return false
  }
  const url = table.options.resolveCellImageLink?.(cell.col, cell.row)
  if (!url) {
    return false
  }
  emitImageLinkClick(table, {
    kind: 'cell',
    col: cell.col,
    row: cell.row,
    url,
    originalEvent: event.originalEvent,
  })
  return true
}

function updateScrollbarHover(table: ListTable, x: number, y: number): ScrollbarHit | null {
  const { interactionState } = table
  const hit = scrollbarHit(table, x, y)
  const hover = hit?.onThumb ? hit.axis : null
  if (hover !== interactionState.scrollbarHover) {
    interactionState.scrollbarHover = hover
    table.pokeScrollbar()
    refreshOverlay(table)
  } else if (hit) {
    table.pokeScrollbar()
  }
  return hit
}

function scrollbarGeometry(
  table: ListTable,
  axis: 'vertical' | 'horizontal',
): ScrollbarThumbGeometry | null {
  const { scroll } = table
  return planScrollbarThumb(
    axis === 'vertical'
      ? { maxScroll: scroll.maxTop, viewport: table.viewportHeight, offset: table.getScrollTop() }
      : { maxScroll: scroll.maxLeft, viewport: table.viewportWidth, offset: table.getScrollLeft() },
    Math.max(
      0,
      axis === 'vertical'
        ? table.height - table.scrollbarGutterHeight
        : table.width - table.scrollbarGutterWidth,
    ),
  )
}

function scrollbarViews(table: ListTable): OverlayContent['scrollbars'] {
  const { interactionState } = table
  if (
    !interactionState.scrollbarConfig.enabled ||
    interactionState.nativeScrollbar ||
    !interactionState.scrollbarVisible
  ) {
    return { vertical: null, horizontal: null }
  }
  const view = (axis: 'vertical' | 'horizontal') => {
    const geometry = scrollbarGeometry(table, axis)
    return geometry
      ? {
          geometry,
          hover: interactionState.scrollbarHover === axis,
          active: interactionState.scrollbarDrag?.axis === axis,
        }
      : null
  }
  return { vertical: view('vertical'), horizontal: view('horizontal') }
}

function scrollbarHit(table: ListTable, x: number, y: number): ScrollbarHit | null {
  const { interactionState } = table
  if (!interactionState.scrollbarConfig.enabled || interactionState.nativeScrollbar) return null
  const size = table.getTheme().interaction.scrollbarSize
  return hitScrollbar(
    table.width,
    table.height,
    size,
    scrollbarGeometry(table, 'vertical'),
    scrollbarGeometry(table, 'horizontal'),
    x,
    y,
  )
}

function pointerButtons(event: SceneEvent): number | undefined {
  return event.originalEvent.buttons
}

function beginScrollbarDrag(table: ListTable, hit: ScrollbarHit, event: SceneEvent): void {
  const { interactionState } = table
  if (!hit.onThumb) {
    const geometry = scrollbarGeometry(table, hit.axis)
    if (geometry) {
      const target = mapScrollbarTrackPoint(geometry, hit.pointPx)
      if (hit.axis === 'vertical') {
        table.setScrollTop(target)
      } else {
        table.setScrollLeft(target)
      }
    }
  }
  interactionState.scrollbarDrag = {
    axis: hit.axis,
    startPx: hit.axis === 'vertical' ? event.y : event.x,
    startOffset: hit.axis === 'vertical' ? table.getScrollTop() : table.getScrollLeft(),
    pendingOffset: undefined,
  }
  table.pokeScrollbar()
  bindPointerSessionCapture(table)
  table.setContainerCursor('default')
}

function endScrollbarDrag(table: ListTable, event: SceneEvent): void {
  table.scrollbarCommitTask()
  table.interactionState.scrollbarDrag = null
  releasePointerSessionCapture(table)
  updatePointerCursor(table, event)
}

function pointerSessionActive(table: ListTable): boolean {
  return (
    table.interactionState.scrollbarDrag !== null || table.interactionState.resizeSession !== null
  )
}

function bindPointerSessionCapture(table: ListTable): void {
  releasePointerSessionCapture(table)
  const eventHost = table.options.pointerEventHost ?? defaultPointerEventHost()
  if (!eventHost) {
    return
  }
  const container = table.getContainer()
  const insideCanvasHost = (dom: PointerEvent): boolean =>
    container !== undefined && dom.target instanceof Node && container.contains(dom.target)
  const synthesize = (type: 'pointermove' | 'pointerup', dom: PointerEvent): SceneEvent => {
    const rect = container?.getBoundingClientRect()
    return {
      type,
      target: null,
      x: (dom.clientX ?? 0) - (rect?.left ?? 0),
      y: (dom.clientY ?? 0) - (rect?.top ?? 0),
      deltaX: 0,
      deltaY: 0,
      key: undefined,
      shiftKey: dom.shiftKey ?? false,
      ctrlKey: dom.ctrlKey ?? false,
      metaKey: dom.metaKey ?? false,
      button: dom.button,
      originalEvent: dom,
    }
  }
  const onMove = (dom: PointerEvent): void => {
    if (!pointerSessionActive(table) || insideCanvasHost(dom)) {
      return
    }
    onPointerMove(table, synthesize('pointermove', dom))
  }
  const onUp = (dom: PointerEvent): void => {
    releasePointerSessionCapture(table)
    if (!pointerSessionActive(table) || insideCanvasHost(dom)) {
      return
    }
    onPointerUp(table, synthesize('pointerup', dom))
  }
  eventHost.addEventListener('pointermove', onMove)
  eventHost.addEventListener('pointerup', onUp)
  table.interactionState.pointerSessionRelease = () => {
    eventHost.removeEventListener('pointermove', onMove)
    eventHost.removeEventListener('pointerup', onUp)
  }
}

function defaultPointerEventHost(): PointerEventHost | null {
  return (globalThis as { window?: PointerEventHost | undefined }).window ?? null
}

function releasePointerSessionCapture(table: ListTable): void {
  table.interactionState.pointerSessionRelease?.()
  table.interactionState.pointerSessionRelease = null
}

export function refreshOverlay(table: ListTable): void {
  const { interactionState, geometryState } = table
  refreshHeaderHighlight(table)
  const fillDrag = interactionState.fillDrag
  let fillPreview: OverlayContent['fillPreview'] = null
  if (fillDrag) {
    const anchor = normalizeRange(fillDrag.range)
    fillPreview = resolveFillPreview(
      anchor,
      resolveFillTarget(anchor, fillDrag.origin, fillDrag.current),
    )
  }
  const has = interactionState.overlay.update({
    selection: interactionState.selection.snapshot,
    resizeLine: interactionState.resizeLine,
    fillHandleRange:
      selectionInteractive(table) && fillHandleEnabled(table)
        ? resolveFocusRange(interactionState.selection.snapshot)
        : null,
    fillPreview,
    selectionAnchor: interactionState.selectionAnchor,
    highlightRanges: interactionState.highlightRanges,
    freezeDividers: {
      x:
        geometryState.frozenColCount > 0
          ? table.rowHeaderWidth + geometryState.frozenColsWidth
          : null,
      y:
        geometryState.frozenRowCount > 0
          ? table.headerHeight + geometryState.frozenRowsHeight
          : null,
    },
    scrollbars: scrollbarViews(table),
    scrollbarGutter: {
      width: table.scrollbarGutterWidth,
      height: table.scrollbarGutterHeight,
    },
    window: {
      frozenRowCount: geometryState.frozenRowCount,
      frozenColCount: geometryState.frozenColCount,
      rows: geometryState.rows,
      cols: geometryState.cols,
    },
  })
  if (has || interactionState.overlayHadContent) {
    table.host.submitInvalidation('sky', { type: 'full' })
  }
  interactionState.overlayHadContent = has
}

function refreshHeaderHighlight(table: ListTable): void {
  const { interactionState } = table
  const snapshot = interactionState.selection.snapshot
  const signature = `${JSON.stringify(snapshot.ranges)}|${table.columns.length}|${table.pipeline.rowCount}`
  if (signature === interactionState.headerHighlightSignature) {
    return
  }
  interactionState.headerHighlightSignature = signature
  const flipped = applyHeaderHighlight(table)
  if (flipped.cols) {
    table.host.submitInvalidation('body', {
      type: 'band',
      region: flipped.cols,
    })
  }
  if (flipped.rows) {
    table.host.submitInvalidation('body', {
      type: 'band',
      region: flipped.rows,
    })
  }
}
