// ListTable 交互接线协作模块（拆自 list-table.ts，纯移动不改行为）：
// 指针/触摸/键盘/contextmenu 场景事件接线、拖选/悬停/resize 会话/填充柄/双击进编辑、
// 视口命中与坐标换算、滚动跟随、sky 浮层刷新。以 ListTable 实例为参数的协作函数，
// 只触碰表实例上标注 @internal 的内部成员。

import type { Region, SceneEvent } from '@infinite-table/render'

import type {
  FillDragEndEvent,
  FillDragState,
  FillHandleDoubleClickEvent,
  FillHandleDownEvent,
} from './fill-handle'
import {
  hitFillHandle,
  resolveFillPreview,
  resolveFillTarget,
  resolveFocusRange,
} from './fill-handle'
import {
  findColAt,
  findRowAt,
  resolveCellX,
  resolveCellYFromOffsets,
  spanHeight,
  spanWidth,
} from './grid-layout'
import type { ListTable } from './list-table'
import { nextActiveCell, revealAxis } from './keyboard-navigation'
import { applyHeaderHighlight } from './list-table-scene'
import type { OverlayContent } from './interaction-overlay'
import type { ColResizeEndEvent, ResizeGeometry, ResizeTarget, RowResizeEndEvent } from './resize'
import { hitResizeHandle, ResizeSession } from './resize'
import { normalizeRange, type RangeBounds, type SelectionRange } from './selection'
import type { CellRef, TableContextMenuEvent } from './types'

/** 双击/双触判定窗口与位移阈值（鼠标双击与触控双击统一走指针事件流） */
const DOUBLE_TAP_MS = 400
const DOUBLE_TAP_SLOP = 10

/** 表头拖选会话：pointerdown 命中列头/行头后开启，锚定按下时命中的列/行，pointerup 重算后结束 */
export interface HeaderDragState {
  /** 拖选轴向：列头横向扩展列区间，行头纵向扩展行区间 */
  axis: 'col' | 'row'
  /** 锚定（按下时命中的）列号/行号 */
  anchor: number
}

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
  // 非主键（右/中键）不改选区、不开启任何会话：右键只抛 contextmenu，选区保留给
  // 「菜单作用于既有选区」的语义（落点在选区外由宿主在 contextmenu 里自行改选）
  if (event.button !== undefined && event.button !== 0) {
    return
  }
  table.pointerDownAt = { x: event.x, y: event.y }
  // 新按下终结任何残留的表头拖选会话（正常流由 pointerup 结束）
  table.headerDrag = null
  // 浮动对象命中优先（浮动层在 sky 最顶、盖在格内容之上）：命中即点选 + 开启拖拽会话
  // （只读仍选中、不拖拽），事件不落入编辑提交/单元格选区；未命中清除图片选中
  // （对齐 ultra-ui「点其它处取消选中」）
  const floats = table.floatLayer
  if (floats) {
    const floatObject = floats.getAt(event.x, event.y)
    if (floatObject) {
      floats.select(floatObject.id)
      floats.beginDrag(floatObject.id, event.x, event.y)
      return
    }
    floats.clearSelection()
  }
  // 编辑中点击其它格/空白：先提交当前会话（同一时刻至多一个编辑会话）；
  // 编辑拾取模式（editPickMode）命中数据格除外——不提交，选区流动由宿主消费为引用插入
  const hit = cellAt(table, event.x, event.y)
  const editing = table.editManager.editingCell()
  if (editing && (!hit || hit.col !== editing.col || hit.row !== editing.row)) {
    if (!(table.editPickMode && hit)) {
      table.editManager.commitEdit()
    }
  }
  const picking = editing !== null && table.editPickMode
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
  // 填充柄按下：开启拖拽会话并抛按下事件（不改选区，填充生成不在内核）；
  // 拾取会话中让位——编辑态的填充柄不属于公式输入流，点选一律按引用拾取走选区
  const fillRange = picking ? null : fillHandleHit(table, event.x, event.y)
  if (fillRange) {
    const bounds = normalizeRange(fillRange)
    const origin = { col: bounds.maxCol, row: bounds.maxRow }
    // 双击窗口判定：上一次「点按柄」（无拖拽扩展的按下-抬起）距此次按下在连击阈值内
    // 且锚定段未变；命中则本次抬起抛双击事件而非拖拽结束（判定消费在 onPointerUp）
    const now = Date.now()
    const lastTap = table.lastFillHandleTap
    table.fillHandleDoubleTap =
      lastTap !== null &&
      lastTap.key === fillHandleTapKey(bounds) &&
      now - lastTap.time <= DOUBLE_TAP_MS
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
    // 左上角：全选（焦点落可视带首格——活动格恒在视口内，以活动格可见性为闸的
    // 宿主滚动跟随不触发，视口不被拽回首格）
    const visible = table.getBodyVisibleCellRange()
    table.selection.selectAll(table.options.columns.length, table.pipeline.rowCount, {
      col: visible.cols.start,
      row: visible.rows.start,
    })
    return
  }
  if (event.y < table.headerHeight) {
    const col = findColAt(table.colOffsets, toContentX(table, event.x))
    if (col >= 0 && table.pipeline.rowCount > 0) {
      // 表头拖选会话：按下即整列（快照等价 selectCol），拖中/抬起重算为连续列区间。
      // 焦点落交互可视位（被点列 × 可视行带首行，对齐 Excel）：活动格已在视口内，
      // ultra-ui 宿主按活动格可见性判滚动即不会把视口拽回首行
      table.headerDrag = { axis: 'col', anchor: col }
      table.selection.beginDragRange(
        { col, row: 0 },
        { col, row: table.pipeline.rowCount - 1 },
        { col, row: table.getBodyVisibleCellRange().rows.start },
      )
    }
    return
  }
  if (event.x < table.rowHeaderWidth) {
    const row = findRowAt(table.rowOffsets, toContentY(table, event.y))
    if (row >= 0 && table.options.columns.length > 0) {
      // 表头拖选会话：按下即整行（快照等价 selectRow），拖中/抬起重算为连续行区间。
      // 焦点落交互可视位（可视列带首列 × 被点行），同列头分支不拽视口
      table.headerDrag = { axis: 'row', anchor: row }
      table.selection.beginDragRange(
        { col: 0, row },
        { col: table.options.columns.length - 1, row },
        { col: table.getBodyVisibleCellRange().cols.start, row },
      )
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
      // 锚点定格按下格（合并区为包围盒起点）：拖中扩展恒以它计算并集，
      // 反向拖越锚点后不因段 start 被改写为 min 角而塌缩
      table.dragAnchor = { ...extent.start }
    }
    table.selecting = true
  }
}

function onPointerMove(table: ListTable, event: SceneEvent): void {
  // 图片拖拽会话优先：跟随指针（不更新悬停/选区）
  if (table.floatLayer?.isDragging()) {
    table.floatLayer.dragMove(event.x, event.y)
    return
  }
  if (table.resizeSession) {
    updateResizeLine(table, event)
    return
  }
  if (table.fillDrag) {
    // 填充拖拽：轴锁定跟踪终点 + 边缘自动滚动 + 预览刷新（不更新选区，无写值）；
    // 会话全程保持十字光标（pointermove 抖动不闪回缺省，边缘驻留帧不经 move 也不改光标）
    table.setContainerCursor('crosshair')
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
  if (table.headerDrag) {
    // 表头拖选：轴坐标驱动连续区间实时扩展（列头看 x、行头看 y，落点无需仍在表头带）
    extendHeaderDrag(table, event.x, event.y)
    return
  }
  const cell = cellAt(table, event.x, event.y)
  if (table.selecting) {
    if (cell) {
      // 合并感知拖选：扩展段 = 锚点格与目标格各自合并包围盒的并。锚点恒取按下时定格的
      // dragAnchor（段的 start 在反向拖越锚点后已是 min 角，不能再当锚点）；段保持
      // 「start=锚点、end=目标侧端点」形态（normalizeRange 仍等于并集边界），反向拖选
      // 的段方向与锚点不丢。锚点被并集严格包含（跨合并区拖拽）时两全不可得，整段回落
      // 归一化形态（边界优先，扩展锚点语义由 dragAnchor 保障）。
      const last = table.selection.snapshot.ranges[table.selection.snapshot.ranges.length - 1]
      if (last) {
        const anchor = table.dragAnchor ?? last.start
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
        table.selection.updateDragRange(segment.start, segment.end)
      } else {
        table.selection.updateDrag(cell.col, cell.row)
      }
      ensureCellVisible(table, cell.col, cell.row)
    }
    return
  }
  // 填充柄十字光标（Excel 式）：走到此处即无任何会话（浮动图拖拽/resize/填充/表头拖选/
  // 拖选均已提前返回）——指针悬停焦点段右下角柄命中区置 crosshair，未命中恢复缺省；
  // 先于 hover 开关短路（光标管理与悬停绘制互相独立）
  table.setContainerCursor(fillHandleHit(table, event.x, event.y) ? 'crosshair' : 'auto')
  // hover 显式开关：开启后不喂跟踪也不清浮层（hoverState 同时短路，绘制链路无输入）
  if (table.theme.hover.disableHover) {
    return
  }
  if (cell) {
    table.hoverState.set(cell.col, cell.row)
  } else {
    table.hoverState.clear()
  }
}

function onPointerUp(table: ListTable, event: SceneEvent): void {
  // 图片拖拽会话结束：落点换算在浮动层（按对象视觉位置反查，onDragEnd 抛新锚点给宿主写回）
  if (table.floatLayer?.isDragging()) {
    table.floatLayer.endDrag()
    return
  }
  // 点按图片（未成拖拽，含只读）：选中语义在按下完成，抬起不落选区/双击进编辑
  const floats = table.floatLayer
  if (floats && floats.getSelectedId() !== null && floats.getAt(event.x, event.y)) {
    return
  }
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
    const target = resolveFillTarget(anchor, drag.origin, drag.current)
    const doubleTap = table.fillHandleDoubleTap
    table.fillHandleDoubleTap = false
    if (resolveFillPreview(anchor, target) === null) {
      // 无扩展的点按：双击窗口内的第二次抬起抛双击事件（与拖拽结束互斥）；
      // 否则记为单击，供下一次按下做双击窗口判定（拖拽扩展会清零断链）
      table.lastFillHandleTap = doubleTap
        ? null
        : { key: fillHandleTapKey(anchor), time: Date.now() }
      if (doubleTap) {
        const event: FillHandleDoubleClickEvent = { range: drag.range }
        for (const listener of table.fillHandleDoubleClickListeners) {
          listener(event)
        }
        refreshOverlay(table)
        return
      }
    } else {
      table.lastFillHandleTap = null
    }
    const targetEvent: FillDragEndEvent = { anchor, target }
    for (const listener of table.fillDragEndListeners) {
      listener(targetEvent)
    }
    refreshOverlay(table)
    return
  }
  if (table.headerDrag) {
    // 抬起按落点重算（与拖中同一逻辑，未经 move 直达的 up 落点也生效），会话结束
    extendHeaderDrag(table, event.x, event.y)
    table.headerDrag = null
    table.selection.endDrag()
    return
  }
  table.selecting = false
  table.dragAnchor = null
  table.selection.endDrag()
  // 拾取会话中抬起不做双击进编辑（画布点选都是引用拾取，落双击会顶掉编辑会话）
  if (!(table.editPickMode && table.editManager.isEditing())) {
    detectDoubleTap(table, event)
  }
}

/**
 * 表头拖选扩展：锚定列/行与当前落点列/行围成连续区间——
 * 列头横向 → 列区间 × 全部行；行头纵向 → 行区间 × 全部列。
 * 轴坐标越界（拖过表缘或滑入行号列/列头带）夹取到首/末，区间保持连续。
 */
function extendHeaderDrag(table: ListTable, x: number, y: number): void {
  const drag = table.headerDrag
  if (!drag) {
    return
  }
  const isCol = drag.axis === 'col'
  // 拖轴范围（列头会话为列数 / 行头会话为行数）与铺满轴范围（对侧全量行数/列数）
  const axisCount = isCol ? table.options.columns.length : table.pipeline.rowCount
  const fullCount = isCol ? table.pipeline.rowCount : table.options.columns.length
  const content = isCol ? toContentX(table, x) : toContentY(table, y)
  const hit = isCol ? findColAt(table.colOffsets, content) : findRowAt(table.rowOffsets, content)
  const target = hit >= 0 ? hit : content < 0 ? 0 : axisCount - 1
  const min = Math.min(drag.anchor, target)
  const max = Math.max(drag.anchor, target)
  const start = isCol ? { col: min, row: 0 } : { col: 0, row: min }
  const end = isCol ? { col: max, row: fullCount - 1 } : { col: fullCount - 1, row: max }
  // 区间与当前段一致（按下即抬起或同带抖动）时不重写：updateDragRange 会把焦点
  // 移到段末，点选整行/整列的活动格将跳到行/列末格（native 与 Excel 语义均为
  // 交互行/列首格）；真实拖拽扩展时区间变化，照常重写并同步焦点到段末
  const last = table.selection.snapshot.ranges[table.selection.snapshot.ranges.length - 1]
  if (
    last &&
    last.start.col === start.col &&
    last.start.row === start.row &&
    last.end.col === end.col &&
    last.end.row === end.row
  ) {
    return
  }
  table.selection.updateDragRange(start, end)
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

/** 填充柄连击判定的锚定段签名（同一段上的两次点按才构成双击） */
function fillHandleTapKey(bounds: RangeBounds): string {
  return `${bounds.minCol},${bounds.minRow}:${bounds.maxCol},${bounds.maxRow}`
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
  table.lastTap = {
    col: cell.col,
    row: cell.row,
    x: event.x,
    y: event.y,
    time,
  }
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
    const event: ColResizeEndEvent = {
      col: target.index,
      width: table.getColWidth(target.index),
    }
    for (const listener of table.colResizeEndListeners) {
      listener(event)
    }
    return
  }
  const event: RowResizeEndEvent = {
    row: target.index,
    height: table.rowHeightAt(target.index),
  }
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
  // 应用接管了右键菜单：阻止浏览器原生菜单盖在自绘菜单上
  event.originalEvent.preventDefault?.()
  const emitted: TableContextMenuEvent = {
    cell: cellAt(table, event.x, event.y),
    region: contextMenuRegion(table, event.x, event.y),
    x: event.x,
    y: event.y,
    originalEvent: event.originalEvent,
  }
  for (const listener of table.contextMenuListeners) {
    listener(emitted)
  }
}

/**
 * 右键落点区域：列头带 → col-header，行号列带 → row-header，其余（表体与角点）→ body。
 * 角点归 body（cell 为 null），归属定义见 TableContextMenuEvent.region 注释。
 */
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
 * 跨冻结边界合并区：主格按冻结带钉固，包围盒取整块跨度（与场景建格同一几何，
 * 见 grid-layout spanWidth/spanHeight），主格可见（冻结侧恒可见）即整块返回。
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
  return {
    x: base.x,
    y: base.y,
    width: spanWidth(table.colOffsets, range.startCol, range.endCol),
    height: spanHeight(table.rowOffsets, range.startRow, range.endRow),
  }
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
    // 选区锚点（编辑拾取会话中被编辑格保持选区绘制；setSelectionAnchor 写入，无为 null）
    selectionAnchor: table.selectionAnchor,
    // 宿主高亮区域（公式引用染色框等；setHighlightRanges 写入，无为空数组）
    highlightRanges: table.highlightRanges,
    // 冻结分隔线：冻结列右缘 / 冻结行下缘（冻结数为 0 的轴为 null，不画）
    freezeDividers: {
      x: table.frozenColCount > 0 ? table.rowHeaderWidth + table.frozenColsWidth : null,
      y: table.frozenRowCount > 0 ? table.headerHeight + table.frozenRowsHeight : null,
    },
    // 冻结行列恒可见，裁剪窗口从 0 起并到滚动窗口末；无冻结时起点取滚动窗
    // 起点——rangeRect 收拢后还须经 cellRect 解析双角格，起点越过可解析范围
    // （cellRect 对滚动窗外行列返回 null）会让整行/整列选区在滚动后整块浮层丢失
    window: {
      rows: {
        start: table.frozenRowCount > 0 ? 0 : table.rows.start,
        end: Math.max(table.rows.end, table.frozenRowCount),
      },
      cols: {
        start: table.frozenColCount > 0 ? 0 : table.cols.start,
        end: Math.max(table.cols.end, table.frozenColCount),
      },
    },
  })
  if (has || table.overlayHadContent) {
    table.host.submitInvalidation('sky', { type: 'full' })
  }
  table.overlayHadContent = has
}

/**
 * 选区联动表头高亮（整轴覆盖带 + 焦点格所在行列头，合并区按主格）：选区签名
 * （段集合×焦点格×全表行列数）未变化时零开销跳过（hover 变更同样途经
 * refreshOverlay，靠签名守卫避免无谓重涂）；焦点格入签名——段集合不变而焦点移动
 * （宿主回写活动格移动等）同样要重涂。变化时只重涂翻转的表头节点，并按条带登记
 * body band 失效——不产生跨数据区的 body band/full。
 */
function refreshHeaderHighlight(table: ListTable): void {
  const snapshot = table.selection.snapshot
  const signature = `${JSON.stringify(snapshot.ranges)}|${JSON.stringify(snapshot.focus)}|${table.options.columns.length}|${table.pipeline.rowCount}`
  if (signature === table.headerHighlightSignature) {
    return
  }
  table.headerHighlightSignature = signature
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
