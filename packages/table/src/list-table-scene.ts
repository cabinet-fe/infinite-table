// ListTable 场景重建协作模块：
// 可视窗口场景树的全量重建与滚动帧增量窗口（滚入建/滚出摘/存活平移）、
// 固定层级容器组（scrollable → scrollableOverflow → frozen → frozenOverflow → crossMerge → header → frame）、
// 行列头装配、Excel 式文本溢出走廊支撑（refreshCell 的溢出联动依赖）。
// 以 ListTable 实例为参数的协作函数，只触碰表实例上的 @internal 状态容器。

import {
  computeScrollableColWindow,
  computeScrollableRowWindowFromOffsets,
  expandWindowRange,
  opaqueHeaderHighlight,
  rangeCrossesBoundary,
  resolveCellX,
  resolveCellYFromOffsets,
  resolveSharedEdges,
  spanHeight,
  spanWidth,
  strongerEdge,
  themeCellBase,
  unionRegions,
  type FrameStyle,
  type WindowRange,
} from '@infinitable/grid'
import { SceneNode, type Region, type RenderContext } from '@infinitable/render'

import { CellNode } from './cell-node'
import { cellTextAnchorX } from './cell-renderer'
import {
  cellStyleFont,
  type BorderInset,
  type CellBorder,
  type CellBorderEdge,
  type CellStyle,
} from './cell-style'
import type { TableBodyGroups, TableMediaGroups } from './internal/table-states'
import type { ListTable } from './list-table'
import {
  cellKey,
  HEADER_COORD,
  isColHeaderHighlighted,
  isRowHeaderHighlighted,
  type HeaderHighlightInput,
} from './list-table-internal'
import { appendChartCell, appendImageCell } from './list-table-media'

/** 外框阴影模糊半径（CSS 像素；frameStyle.shadow 开启时的固定观感） */
const FRAME_SHADOW_BLUR = 6

/** 创建固定层级容器组（不可拾取、跳过子节点命中遍历） */
function newContainerGroup(width: number, height: number): SceneNode {
  return new SceneNode({
    pickable: false,
    hitTestChildren: false,
    width,
    height,
  })
}

/**
 * 纯填充矩形节点：underlay 底色铺设。恒为 body root 首子节点（格背景之下），
 * 数据区外空白处与半透明格背景之下直接可见。
 */
export class UnderlayNode extends SceneNode {
  constructor(private readonly color: string) {
    super({ pickable: false, hitTestChildren: false })
  }

  override paint(ctx: RenderContext): void {
    ctx.fillStyle = this.color
    ctx.fillRect(0, 0, this.width, this.height)
  }
}

/** 表格外框节点：四边细条线框 + 可选阴影（RenderContext 无 stroke，用细条填充）。恒为 body root 末子节点 */
export class FrameNode extends SceneNode {
  constructor(private readonly frame: FrameStyle) {
    super({ pickable: false, hitTestChildren: false })
  }

  override paint(ctx: RenderContext): void {
    const { lineWidth, color, shadow } = this.frame
    if (lineWidth <= 0) {
      return
    }
    if (shadow) {
      ctx.shadowColor = color
      ctx.shadowBlur = FRAME_SHADOW_BLUR
    }
    ctx.fillStyle = color
    const w = this.width
    const h = this.height
    ctx.fillRect(0, 0, w, lineWidth)
    ctx.fillRect(0, h - lineWidth, w, lineWidth)
    ctx.fillRect(0, 0, lineWidth, h)
    ctx.fillRect(w - lineWidth, 0, lineWidth, h)
  }
}

/** 确保并挂载 media 层固定容器组（scrollableMediaGroup → frozenMediaGroup → crossMergeMediaGroup） */
export function ensureMediaGroups(table: ListTable): TableMediaGroups {
  const existing = table.sceneState.mediaGroups
  if (existing) {
    return existing
  }
  const mediaRoot = table.sceneState.media!.root
  const { width, height } = table
  const mediaGroups: TableMediaGroups = {
    scrollableMediaGroup: newContainerGroup(width, height),
    frozenMediaGroup: newContainerGroup(width, height),
    crossMergeMediaGroup: newContainerGroup(width, height),
  }
  mediaRoot.appendChild(mediaGroups.scrollableMediaGroup)
  mediaRoot.appendChild(mediaGroups.frozenMediaGroup)
  mediaRoot.appendChild(mediaGroups.crossMergeMediaGroup)
  table.sceneState.mediaGroups = mediaGroups
  return mediaGroups
}

/** 同步容器组尺寸（视口 resize 后更新组包围盒） */
export function resizeSceneGroups(table: ListTable): void {
  const { width, height } = table
  const groups = table.sceneState.groups
  if (groups) {
    for (const node of [
      groups.underlayNode,
      groups.scrollableGroup,
      groups.scrollableOverflowGroup,
      groups.frozenGroup,
      groups.frozenOverflowGroup,
      groups.crossMergeGroup,
      groups.headerGroup,
      groups.scrollableHeadersGroup,
      groups.frozenHeadersGroup,
      groups.frameNode,
    ]) {
      node.width = width
      node.height = height
    }
  }
  const mediaGroups = table.sceneState.mediaGroups
  if (mediaGroups) {
    for (const node of [
      mediaGroups.scrollableMediaGroup,
      mediaGroups.frozenMediaGroup,
      mediaGroups.crossMergeMediaGroup,
    ]) {
      node.width = width
      node.height = height
    }
  }
}

/** 根据格归属与溢出状态路由到 body 场景树的固定容器组 */
export function targetBodyGroup(
  table: ListTable,
  col: number,
  row: number,
  overflows: boolean,
): SceneNode {
  const groups = table.sceneState.groups!
  const { frozenColCount, frozenRowCount, mergeCells } = table.geometryState
  const range = mergeCells.rangeAt(col, row)
  if (range && rangeCrossesBoundary(range, frozenColCount, frozenRowCount)) {
    return groups.crossMergeGroup
  }
  const isFrozen = col < frozenColCount || row < frozenRowCount
  if (isFrozen) {
    return overflows ? groups.frozenOverflowGroup : groups.frozenGroup
  }
  return overflows ? groups.scrollableOverflowGroup : groups.scrollableGroup
}

/**
 * 同步单格所在容器组与溢出排序（局部刷新 / 窗外溢出源收敛共用）：
 * 节点获得或失去溢出能力时在 scrollableGroup <-> scrollableOverflowGroup 或
 * frozenGroup <-> frozenOverflowGroup 间迁移，并在溢出组内保持同行列升序。
 */
export function syncCellGroupAndOverflowOrder(
  table: ListTable,
  node: CellNode,
  col: number,
  row: number,
): void {
  const overflows = node.textMaxX > node.width || node.textMinX < 0
  const target = targetBodyGroup(table, col, row, overflows)
  if (node.parent !== target) {
    target.appendChild(node)
  }
  if (overflows) {
    const groups = table.sceneState.groups
    if (
      groups &&
      (target === groups.scrollableOverflowGroup || target === groups.frozenOverflowGroup)
    ) {
      reorderRowInOverflowGroup(target, row)
    }
  }
}

/** 保持某溢出组内指定行节点按 col 升序（确定性 z 序） */
function reorderRowInOverflowGroup(group: SceneNode, row: number): void {
  const rowNodes: CellNode[] = []
  for (const child of group.children) {
    if ((child as CellNode).row === row) {
      rowNodes.push(child as CellNode)
    }
  }
  if (rowNodes.length <= 1) {
    return
  }
  rowNodes.sort((a, b) => a.col - b.col)
  for (const node of rowNodes) {
    group.appendChild(node)
  }
}

/** 清空场景树根节点全部子节点 */
function clearRootChildren(root: SceneNode): void {
  while (root.children.length > 0) {
    root.removeChild(root.children[0]!)
  }
}

/** 重建可视窗口场景：按固定分层顺序建组，数据格/表头/外框直接入对应容器组 */
export function rebuildScene(table: ListTable): void {
  const { sceneState, geometryState, mediaState } = table
  const root = sceneState.body.root
  clearRootChildren(root)
  sceneState.cellNodes.clear()
  sceneState.colHeaderNodes.clear()
  sceneState.rowHeaderNodes.clear()
  sceneState.cornerNode = null
  sceneState.headerGroup = null
  sceneState.frameNode = null
  sceneState.underlayNode = null
  sceneState.groups = null

  mediaState.imageCellNodes.clear()
  mediaState.chartCellNodes.clear()
  sceneState.mediaGroups = null
  if (sceneState.media) {
    clearRootChildren(sceneState.media.root)
    ensureMediaGroups(table)
  }

  const { width, height } = table
  const underlayNode = new UnderlayNode(table.theme.underlayBackgroundColor)
  underlayNode.width = width
  underlayNode.height = height
  const scrollableGroup = newContainerGroup(width, height)
  const scrollableOverflowGroup = newContainerGroup(width, height)
  const frozenGroup = newContainerGroup(width, height)
  const frozenOverflowGroup = newContainerGroup(width, height)
  const crossMergeGroup = newContainerGroup(width, height)
  const headerGroup = newContainerGroup(width, height)
  const scrollableHeadersGroup = newContainerGroup(width, height)
  const frozenHeadersGroup = newContainerGroup(width, height)
  const frameNode = new FrameNode(table.theme.frameStyle)
  frameNode.width = width
  frameNode.height = height

  headerGroup.appendChild(scrollableHeadersGroup)
  headerGroup.appendChild(frozenHeadersGroup)

  root.appendChild(underlayNode)
  root.appendChild(scrollableGroup)
  root.appendChild(scrollableOverflowGroup)
  root.appendChild(frozenGroup)
  root.appendChild(frozenOverflowGroup)
  root.appendChild(crossMergeGroup)
  root.appendChild(headerGroup)
  root.appendChild(frameNode)

  const groups: TableBodyGroups = {
    underlayNode,
    scrollableGroup,
    scrollableOverflowGroup,
    frozenGroup,
    frozenOverflowGroup,
    crossMergeGroup,
    headerGroup,
    scrollableHeadersGroup,
    frozenHeadersGroup,
    frameNode,
  }
  sceneState.groups = groups
  sceneState.underlayNode = underlayNode
  sceneState.headerGroup = headerGroup
  sceneState.frameNode = frameNode

  const { left, top } = table.scroll.state
  const { rows: scrollableRows, cols: scrollableCols } = computeAssemblyWindow(table, left, top)
  geometryState.rows = scrollableRows
  geometryState.cols = scrollableCols
  const frozenRows: WindowRange = { start: 0, end: geometryState.frozenRowCount }
  const frozenCols: WindowRange = { start: 0, end: geometryState.frozenColCount }

  appendCellBand(table, scrollableRows, scrollableCols, left, top)
  appendPartiallyVisibleMerges(
    table,
    left,
    top,
    [frozenRows, scrollableRows],
    [frozenCols, scrollableCols],
  )
  appendCellBand(table, scrollableRows, frozenCols, left, top)
  appendCellBand(table, frozenRows, scrollableCols, left, top)
  appendCellBand(table, frozenRows, frozenCols, left, top)
  appendOffWindowOverflowSources(table, [frozenRows, scrollableRows], left, top)
  remountOverflowSources(table)

  appendHeaders(table, groups, left, top, frozenRows, scrollableRows, frozenCols, scrollableCols)
}

/**
 * 滚动帧增量窗口：摘除滚出行列的节点、补建滚入行列，存活节点原地平移（零重建）。
 * 各带已有固定容器组，新节点直接挂入目标组，不再每帧重挂冻结节点、跨界合并主格、表头容器与外框。
 */
export function updateSceneWindow(table: ListTable): void {
  const { geometryState, sceneState, mediaState } = table
  const { left, top } = table.scroll.state
  const prevRows = geometryState.rows
  const prevCols = geometryState.cols
  const { rows: scrollableRows, cols: scrollableCols } = computeAssemblyWindow(table, left, top)
  geometryState.rows = scrollableRows
  geometryState.cols = scrollableCols
  const frozenRows: WindowRange = { start: 0, end: geometryState.frozenRowCount }
  const frozenCols: WindowRange = { start: 0, end: geometryState.frozenColCount }
  const rowBands = [frozenRows, scrollableRows]
  const colBands = [frozenCols, scrollableCols]
  const inRange = (index: number, range: WindowRange): boolean =>
    index >= range.start && index < range.end
  const partiallyVisible = (start: number, end: number, bands: readonly WindowRange[]): boolean =>
    bands.some((band) => start < band.end && end >= band.start)

  const keepDataCell = (col: number, row: number, node: CellNode): boolean => {
    const rowVisible = inRange(row, frozenRows) || inRange(row, scrollableRows)
    if (rowVisible && (inRange(col, frozenCols) || inRange(col, scrollableCols))) {
      return true
    }
    const range = geometryState.mergeCells.rangeAt(col, row)
    if (
      range !== null &&
      partiallyVisible(range.startRow, range.endRow, rowBands) &&
      partiallyVisible(range.startCol, range.endCol, colBands)
    ) {
      return true
    }
    if (rowVisible && (node.textMaxX > node.width || node.textMinX < 0)) {
      const corridor = corridorCols(table, col, row, node.style, node)
      if (
        corridor !== null &&
        corridor.leftStart < scrollableCols.end &&
        corridor.rightEnd > scrollableCols.start
      ) {
        return true
      }
    }
    return false
  }

  const keepMediaCell = (col: number, row: number): boolean => {
    if (inRange(row, frozenRows) || inRange(row, scrollableRows)) {
      if (inRange(col, frozenCols) || inRange(col, scrollableCols)) {
        return true
      }
    }
    const range = geometryState.mergeCells.rangeAt(col, row)
    return (
      range !== null &&
      partiallyVisible(range.startRow, range.endRow, rowBands) &&
      partiallyVisible(range.startCol, range.endCol, colBands)
    )
  }

  // 1) 摘除滚出窗口的节点，存活节点按新滚动位置原地平移
  sweepWindowNodes(table, sceneState.cellNodes, keepDataCell, left, top)
  sweepWindowNodes(table, mediaState.imageCellNodes, keepMediaCell, left, top, (node) => {
    table.imageService.releaseRef(node.url, { col: node.col, row: node.row })
  })
  sweepWindowNodes(table, mediaState.chartCellNodes, keepMediaCell, left, top)

  // 2) 新滚入行整行补建
  const newRows = new Set<number>()
  for (let row = scrollableRows.start; row < scrollableRows.end; row++) {
    if (inRange(row, prevRows)) {
      continue
    }
    newRows.add(row)
    for (let col = scrollableCols.end - 1; col >= scrollableCols.start; col--) {
      appendCell(table, col, row, left, top)
    }
    for (let col = frozenCols.end - 1; col >= frozenCols.start; col--) {
      appendCell(table, col, row, left, top)
    }
  }

  // 3) 存活行补建滚入列
  const enteringCols: number[] = []
  for (let col = scrollableCols.start; col < scrollableCols.end; col++) {
    if (!inRange(col, prevCols)) {
      enteringCols.push(col)
    }
  }
  if (enteringCols.length > 0) {
    for (const band of rowBands) {
      for (let row = band.start; row < band.end; row++) {
        if (inRange(row, scrollableRows) && !inRange(row, prevRows)) {
          continue
        }
        for (let i = enteringCols.length - 1; i >= 0; i--) {
          appendCell(table, enteringCols[i]!, row, left, top)
        }
      }
    }
  }

  // 3.2) 窗缘反查补建窗外溢出源
  if (enteringCols.length > 0 || newRows.size > 0) {
    const colsWindowMoved =
      scrollableCols.start !== prevCols.start || scrollableCols.end !== prevCols.end
    for (const band of rowBands) {
      for (let row = band.start; row < band.end; row++) {
        if (!colsWindowMoved && !newRows.has(row)) {
          continue
        }
        appendOffWindowOverflowSources(table, [{ start: row, end: row + 1 }], left, top)
      }
    }
  }

  // 3.5) 行内溢出 z 序规范（仅在溢出容器组内按列升序排序并重标走廊内部标记）
  if (enteringCols.length > 0 || newRows.size > 0) {
    for (const band of rowBands) {
      for (let row = band.start; row < band.end; row++) {
        if (enteringCols.length === 0 && !newRows.has(row)) {
          continue
        }
        canonicalizeRowOverflowOrder(table, row, colBands)
      }
    }
  }

  // 4) 主格窗外但区间部分可见的合并主格补建
  appendPartiallyVisibleMerges(table, left, top, rowBands, colBands)

  // 5) 表头增量维护：存活节点平移、滚出摘除、滚入直接挂入滚动/冻结表头组
  const groups = sceneState.groups!
  const styles = headerStyles(table)
  for (const [col, node] of sceneState.colHeaderNodes) {
    if (inRange(col, frozenCols) || inRange(col, scrollableCols)) {
      node.x = resolveCellX(
        col,
        left,
        geometryState.colOffsets,
        geometryState.frozenColCount,
        table.rowHeaderWidth,
      )
    } else {
      node.removeFromParent()
      sceneState.colHeaderNodes.delete(col)
    }
  }
  for (const [row, node] of sceneState.rowHeaderNodes) {
    if (inRange(row, frozenRows) || inRange(row, scrollableRows)) {
      node.y = resolveCellYFromOffsets(
        row,
        top,
        geometryState.rowOffsets,
        geometryState.frozenRowCount,
        table.headerHeight,
      )
    } else {
      node.removeFromParent()
      sceneState.rowHeaderNodes.delete(row)
    }
  }
  if (showsColHeader(table)) {
    for (const cols of [scrollableCols, frozenCols]) {
      const targetGroup =
        cols === frozenCols ? groups.frozenHeadersGroup : groups.scrollableHeadersGroup
      for (let col = cols.start; col < cols.end; col++) {
        if (!sceneState.colHeaderNodes.has(col)) {
          const node = newColHeaderNode(table, col, left, styles)
          targetGroup.appendChild(node)
          sceneState.colHeaderNodes.set(col, node)
        }
      }
    }
  }
  if (showsRowHeader(table)) {
    for (const rows of [scrollableRows, frozenRows]) {
      const targetGroup =
        rows === frozenRows ? groups.frozenHeadersGroup : groups.scrollableHeadersGroup
      for (let row = rows.start; row < rows.end; row++) {
        if (!sceneState.rowHeaderNodes.has(row)) {
          const node = newRowHeaderNode(table, row, top, styles)
          targetGroup.appendChild(node)
          sceneState.rowHeaderNodes.set(row, node)
        }
      }
    }
  }
  if (showsColHeader(table) && showsRowHeader(table) && !sceneState.cornerNode) {
    sceneState.cornerNode = newCornerNode(table, styles)
    groups.headerGroup.appendChild(sceneState.cornerNode)
  }
}

/**
 * 窗口滑动清扫：不满足保留条件的节点按所属父容器组批量摘除并出索引，
 * 存活节点按新滚动位置原地平移。
 */
function sweepWindowNodes<T extends SceneNode & { readonly col: number; readonly row: number }>(
  table: ListTable,
  nodes: Map<number, T>,
  keep: (col: number, row: number, node: T) => boolean,
  left: number,
  top: number,
  onSweep?: (node: T) => void,
): void {
  const { geometryState } = table
  const sweptByParent = new Map<SceneNode, Set<SceneNode>>()
  const sweptAll: T[] = []
  for (const [key, node] of nodes) {
    if (keep(node.col, node.row, node)) {
      node.x = resolveCellX(
        node.col,
        left,
        geometryState.colOffsets,
        geometryState.frozenColCount,
        table.rowHeaderWidth,
      )
      node.y = resolveCellYFromOffsets(
        node.row,
        top,
        geometryState.rowOffsets,
        geometryState.frozenRowCount,
        table.headerHeight,
      )
    } else {
      nodes.delete(key)
      sweptAll.push(node)
      if (node.parent) {
        let set = sweptByParent.get(node.parent)
        if (!set) {
          set = new Set<SceneNode>()
          sweptByParent.set(node.parent, set)
        }
        set.add(node)
      }
    }
  }
  for (const [parent, set] of sweptByParent) {
    parent.removeChildren((child) => set.has(child))
  }
  for (const node of sweptAll) {
    onSweep?.(node)
  }
}

/** 建一个行列带内的数据格节点；同行按列降序建 */
function appendCellBand(
  table: ListTable,
  rows: WindowRange,
  cols: WindowRange,
  left: number,
  top: number,
): void {
  for (let row = rows.start; row < rows.end; row++) {
    for (let col = cols.end - 1; col >= cols.start; col--) {
      appendCell(table, col, row, left, top)
    }
  }
}

/** 数据格生效绘制边框（共享边裁决） */
export function effectiveBorder(
  table: ListTable,
  col: number,
  row: number,
  style: CellStyle,
): CellBorder | null {
  const range = table.geometryState.mergeCells.rangeAt(col, row)
  const endCol = range?.endCol ?? col
  const endRow = range?.endRow ?? row
  let facingRight: CellBorderEdge | undefined
  if (endCol + 1 < table.columns.length) {
    for (let r = row; r <= endRow; r++) {
      facingRight = strongerEdge(facingRight, table.styleAt(endCol + 1, r).border?.left)
    }
  }
  let facingBottom: CellBorderEdge | undefined
  if (endRow + 1 < table.pipeline.rowCount) {
    for (let c = col; c <= endCol; c++) {
      facingBottom = strongerEdge(facingBottom, table.styleAt(c, endRow + 1).border?.top)
    }
  }
  return (
    resolveSharedEdges(
      style.border,
      { right: facingRight, bottom: facingBottom },
      { firstCol: col === 0, firstRow: row === 0 },
    ) ?? null
  )
}

/** 锚定格四周可视边框线宽（编辑浮层内缩口径，配合 options.editorInsideBorder） */
export function editorBorderInsets(
  table: ListTable,
  col: number,
  row: number,
  style: CellStyle,
): BorderInset {
  const range = table.geometryState.mergeCells.rangeAt(col, row)
  const endCol = range?.endCol ?? col
  const endRow = range?.endRow ?? row
  let facingLeft: CellBorderEdge | undefined
  if (col > 0) {
    for (let r = row; r <= endRow; r++) {
      facingLeft = strongerEdge(facingLeft, table.styleAt(col - 1, r).border?.right)
    }
  }
  let facingTop: CellBorderEdge | undefined
  if (row > 0) {
    for (let c = col; c <= endCol; c++) {
      facingTop = strongerEdge(facingTop, table.styleAt(c, row - 1).border?.bottom)
    }
  }
  const visualLeft = col === 0 ? style.border?.left : strongerEdge(style.border?.left, facingLeft)
  const visualTop = row === 0 ? style.border?.top : strongerEdge(style.border?.top, facingTop)
  const painted = effectiveBorder(table, col, row, style)
  return {
    top: visualTop?.width ?? 0,
    right: painted?.right?.width ?? 0,
    bottom: painted?.bottom?.width ?? 0,
    left: visualLeft?.width ?? 0,
  }
}

/** 建单格节点：直接路由到对应的场景容器组 */
export function appendCell(
  table: ListTable,
  col: number,
  row: number,
  left: number,
  top: number,
): boolean {
  const { geometryState, sceneState } = table
  if (sceneState.cellNodes.has(cellKey(col, row))) {
    return false
  }
  const range = geometryState.mergeCells.rangeAt(col, row)
  if (range && (range.startCol !== col || range.startRow !== row)) {
    return false
  }
  const endCol = range?.endCol ?? col
  const endRow = range?.endRow ?? row
  const imageUrl = table.options.resolveCellImage?.(col, row)
  const chartMedia = imageUrl ? null : (table.options.resolveCellChart?.(col, row) ?? null)
  const style = table.resolveStyle(col, row)
  const node = new CellNode({
    col,
    row,
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
    width: spanWidth(geometryState.colOffsets, col, endCol),
    height: spanHeight(geometryState.rowOffsets, row, endRow),
    text: imageUrl || chartMedia ? '' : table.pipeline.resolveText(col, row),
    value: table.pipeline.resolveValue(col, row),
    cellType: table.columns[col]?.cellType,
    style,
    border: effectiveBorder(table, col, row, style),
    renderer: table.options.resolveCellRenderer?.(col, row) ?? null,
  })
  const limits =
    imageUrl || chartMedia ? null : textOverflowLimits(table, col, row, style, left, node)
  node.textMaxX = limits === null ? node.width : limits.maxX - node.x
  node.textMinX = limits === null ? 0 : limits.minX - node.x
  const editing = table.editManager.isEditing() ? table.editManager.editingCell() : null
  node.contentHidden = editing !== null && editing.col === col && editing.row === row
  const overflows = node.textMaxX > node.width || node.textMinX < 0
  targetBodyGroup(table, col, row, overflows).appendChild(node)
  sceneState.cellNodes.set(cellKey(col, row), node)
  if (imageUrl) {
    appendImageCell(table, col, row, imageUrl, node.x, node.y, node.width, node.height)
  } else if (chartMedia) {
    appendChartCell(table, col, row, chartMedia, node.x, node.y, node.width, node.height)
  }
  return true
}

/** 场景装配窗口（rebuildScene 与 updateSceneWindow 共用） */
function computeAssemblyWindow(
  table: ListTable,
  left: number,
  top: number,
): { rows: WindowRange; cols: WindowRange } {
  const { geometryState } = table
  return {
    rows: clampWindowToScrollableBand(
      expandWindowRange(
        computeScrollableRowWindowFromOffsets(
          top,
          table.viewportHeight - geometryState.frozenRowsHeight,
          geometryState.rowOffsets,
          geometryState.frozenRowCount,
        ),
        table.overscanRows,
        table.rowCount,
      ),
      geometryState.frozenRowCount,
    ),
    cols: clampWindowToScrollableBand(
      expandWindowRange(
        computeScrollableColWindow(
          left,
          table.viewportWidth - geometryState.frozenColsWidth,
          geometryState.colOffsets,
          geometryState.frozenColCount,
        ),
        table.overscanCols,
        table.colCount,
      ),
      geometryState.frozenColCount,
    ),
  }
}

function clampWindowToScrollableBand(window: WindowRange, frozenCount: number): WindowRange {
  if (window.start < frozenCount) {
    return { start: frozenCount, end: Math.max(window.end, frozenCount) }
  }
  return window
}

/** 空文本数据格判定（溢出邻居扫描用） */
function isEmptyTextCell(table: ListTable, col: number, row: number): boolean {
  return (
    (table.columns[col]?.cellType ?? 'text') === 'text' &&
    !table.options.resolveCellRenderer?.(col, row) &&
    !table.options.resolveCellImage?.(col, row) &&
    !table.options.resolveCellChart?.(col, row) &&
    !table.geometryState.mergeCells.rangeAt(col, row) &&
    !table.pipeline.resolveText(col, row)
  )
}

interface TextOverflowLimits {
  minX: number
  maxX: number
}

export function textOverflowLimits(
  table: ListTable,
  col: number,
  row: number,
  style: CellStyle,
  left: number,
  node?: CellNode,
): TextOverflowLimits | null {
  const corridor = corridorCols(table, col, row, style, node)
  if (corridor === null) {
    return null
  }
  const { frozenColCount, colOffsets } = table.geometryState
  const inFrozenBand = col < frozenColCount
  const colLeft = (c: number): number =>
    table.rowHeaderWidth + (colOffsets[c] ?? 0) - (inFrozenBand ? 0 : left)
  return {
    minX: colLeft(corridor.leftStart),
    maxX: colLeft(corridor.rightEnd),
  }
}

interface CorridorCols {
  leftStart: number
  rightEnd: number
}

function cellTextWidth(table: ListTable, style: CellStyle, text: string, node?: CellNode): number {
  const measure = (t: string, font: string): number => table.host.measure(t, font).width
  return node
    ? node.measureTextWidthWith(measure)
    : table.host.measure(text, cellStyleFont(style)).width
}

const TEXT_BOUND_SAFETY_SCALE = 1.01
const TEXT_BOUND_SAFETY_PX = 0.5

function textConfinedToCell(
  table: ListTable,
  style: CellStyle,
  width: number,
  text: string,
  font: string,
): boolean {
  const bound = table.sceneState.textAdvances.upperBound(text, font)
  if (bound === null) {
    return false
  }
  const safeBound = bound * TEXT_BOUND_SAFETY_SCALE + TEXT_BOUND_SAFETY_PX
  const textLeft = cellTextAnchorX(style, width, safeBound)
  return textLeft >= 0 && textLeft + safeBound <= width
}

export function corridorCols(
  table: ListTable,
  col: number,
  row: number,
  style: CellStyle,
  node?: CellNode,
): CorridorCols | null {
  const { geometryState } = table
  if (
    style.textOverflow !== undefined ||
    style.textWrap === true ||
    (table.columns[col]?.cellType ?? 'text') !== 'text' ||
    table.options.resolveCellRenderer?.(col, row) ||
    table.options.resolveCellImage?.(col, row) ||
    table.options.resolveCellChart?.(col, row) ||
    geometryState.mergeCells.rangeAt(col, row)
  ) {
    return null
  }
  const text = node ? node.text : table.pipeline.resolveText(col, row)
  if (!text) {
    return null
  }
  const width = geometryState.colWidths[col] ?? 0
  const font = node ? node.fontString() : cellStyleFont(style)
  if (textConfinedToCell(table, style, width, text, font)) {
    return null
  }
  const textWidth = cellTextWidth(table, style, text, node)
  const textLeft = cellTextAnchorX(style, width, textWidth)
  const textRight = textLeft + textWidth
  const inFrozenBand = col < geometryState.frozenColCount
  const bandStart = inFrozenBand ? 0 : geometryState.frozenColCount
  const bandEnd = inFrozenBand ? geometryState.frozenColCount : table.columns.length
  const align = style.textAlign ?? 'left'
  const colLeft = (c: number): number =>
    (geometryState.colOffsets[c] ?? 0) - (geometryState.colOffsets[col] ?? 0)

  let rightEnd = col + 1
  if (align !== 'right' && textRight > width) {
    while (
      rightEnd < bandEnd &&
      colLeft(rightEnd) < textRight &&
      isEmptyTextCell(table, rightEnd, row)
    ) {
      rightEnd++
    }
  }
  let leftStart = col
  if (align !== 'left' && textLeft < 0) {
    while (
      leftStart > bandStart &&
      colLeft(leftStart) > textLeft &&
      isEmptyTextCell(table, leftStart - 1, row)
    ) {
      leftStart--
    }
  }
  if (rightEnd === col + 1 && leftStart === col) {
    return null
  }
  return { leftStart, rightEnd }
}

export function overflowSourceCol(table: ListTable, col: number, row: number): number | null {
  const bandStart =
    col < table.geometryState.frozenColCount ? 0 : table.geometryState.frozenColCount
  for (let c = col - 1; c >= bandStart; c--) {
    if (!isEmptyTextCell(table, c, row)) {
      return c
    }
  }
  return null
}

export function overflowSourceColRight(table: ListTable, col: number, row: number): number | null {
  const bandEnd =
    col < table.geometryState.frozenColCount
      ? table.geometryState.frozenColCount
      : table.columns.length
  for (let c = col + 1; c < bandEnd; c++) {
    if (!isEmptyTextCell(table, c, row)) {
      return c
    }
  }
  return null
}

interface OffWindowOverflowSource {
  col: number
  corridor: CorridorCols
  node: CellNode | null
}

export function resolveOffWindowOverflowSource(
  table: ListTable,
  row: number,
  side: 'left' | 'right',
): OffWindowOverflowSource | null {
  const scrollable = table.geometryState.cols
  if (scrollable.end <= scrollable.start) {
    return null
  }
  const edgeCol = side === 'left' ? scrollable.start : scrollable.end - 1
  const sourceCol =
    side === 'left'
      ? overflowSourceCol(table, edgeCol, row)
      : overflowSourceColRight(table, edgeCol, row)
  if (sourceCol === null) {
    return null
  }
  const node = table.sceneState.cellNodes.get(cellKey(sourceCol, row)) ?? null
  const corridor = corridorCols(
    table,
    sourceCol,
    row,
    node?.style ?? table.resolveStyle(sourceCol, row),
    node ?? undefined,
  )
  if (corridor === null) {
    return null
  }
  const reaches =
    side === 'left' ? corridor.rightEnd > scrollable.start : corridor.leftStart < scrollable.end
  if (!reaches) {
    return null
  }
  return { col: sourceCol, corridor, node }
}

function appendOffWindowOverflowSources(
  table: ListTable,
  rows: readonly WindowRange[],
  left: number,
  top: number,
): boolean {
  let created = false
  for (const rowsBand of rows) {
    for (let row = rowsBand.start; row < rowsBand.end; row++) {
      for (const side of ['left', 'right'] as const) {
        const resolved = resolveOffWindowOverflowSource(table, row, side)
        if (resolved === null || resolved.node !== null) {
          continue
        }
        created = appendCell(table, resolved.col, row, left, top) || created
      }
    }
  }
  return created
}

export function dataColBands(table: ListTable): WindowRange[] {
  return [{ start: 0, end: table.geometryState.frozenColCount }, table.geometryState.cols]
}

export function markRowCorridorInterior(
  table: ListTable,
  row: number,
  colBands: readonly WindowRange[],
): void {
  const { cellNodes } = table.sceneState
  for (const band of colBands) {
    for (let col = band.start; col < band.end; col++) {
      const node = cellNodes.get(cellKey(col, row))
      if (node) {
        node.corridorInterior = null
      }
    }
  }
  const markCorridor = (corridor: CorridorCols): void => {
    for (let c = corridor.leftStart; c < corridor.rightEnd; c++) {
      const covered = cellNodes.get(cellKey(c, row))
      if (
        covered &&
        (covered.corridorInterior === null || covered.corridorInterior < corridor.rightEnd)
      ) {
        covered.corridorInterior = corridor.rightEnd
      }
    }
  }
  for (const band of colBands) {
    for (let col = band.start; col < band.end; col++) {
      const node = cellNodes.get(cellKey(col, row))
      if (!node) {
        continue
      }
      const corridor = corridorCols(table, col, row, node.style, node)
      if (corridor === null) {
        continue
      }
      markCorridor(corridor)
    }
  }
  for (const side of ['left', 'right'] as const) {
    const resolved = resolveOffWindowOverflowSource(table, row, side)
    if (resolved !== null) {
      markCorridor(resolved.corridor)
    }
  }
}

/** 全量重建的溢出 z 序收口：各自溢出组内按 (row, col) 升序排列，并重标走廊内部标记 */
function remountOverflowSources(table: ListTable): void {
  const groups = table.sceneState.groups!
  for (const group of [groups.scrollableOverflowGroup, groups.frozenOverflowGroup]) {
    if (group.children.length > 1) {
      const sources = [...group.children] as CellNode[]
      sources.sort((a, b) => a.row - b.row || a.col - b.col)
      for (const node of sources) {
        group.appendChild(node)
      }
    }
  }
  const colBands = dataColBands(table)
  for (const rowBand of [
    { start: 0, end: table.geometryState.frozenRowCount },
    table.geometryState.rows,
  ]) {
    for (let row = rowBand.start; row < rowBand.end; row++) {
      markRowCorridorInterior(table, row, colBands)
    }
  }
}

/** 增量路径的行内溢出 z 序规范：各自溢出组内同行列升序重排 + 走廊内部重标 */
function canonicalizeRowOverflowOrder(
  table: ListTable,
  row: number,
  colBands: readonly WindowRange[],
): void {
  const groups = table.sceneState.groups
  if (groups) {
    reorderRowInOverflowGroup(groups.scrollableOverflowGroup, row)
    reorderRowInOverflowGroup(groups.frozenOverflowGroup, row)
  }
  markRowCorridorInterior(table, row, colBands)
}

function appendPartiallyVisibleMerges(
  table: ListTable,
  left: number,
  top: number,
  rowBands: readonly WindowRange[],
  colBands: readonly WindowRange[],
): boolean {
  let created = false
  const visible = (start: number, end: number, bands: readonly WindowRange[]): boolean =>
    bands.some((band) => start < band.end && end >= band.start)
  for (const range of table.geometryState.mergeCells.ranges) {
    if (table.sceneState.cellNodes.has(cellKey(range.startCol, range.startRow))) {
      continue
    }
    if (
      visible(range.startRow, range.endRow, rowBands) &&
      visible(range.startCol, range.endCol, colBands)
    ) {
      created = appendCell(table, range.startCol, range.startRow, left, top) || created
    }
  }
  return created
}

function showsColHeader(table: ListTable): boolean {
  return table.headerHeight > 0
}

function showsRowHeader(table: ListTable): boolean {
  return table.rowHeaderWidth > 0
}

function appendHeaders(
  table: ListTable,
  groups: TableBodyGroups,
  left: number,
  top: number,
  frozenRows: WindowRange,
  scrollableRows: WindowRange,
  frozenCols: WindowRange,
  scrollableCols: WindowRange,
): void {
  const { sceneState } = table
  const styles = headerStyles(table)
  if (showsColHeader(table)) {
    for (const cols of [scrollableCols, frozenCols]) {
      const targetGroup =
        cols === frozenCols ? groups.frozenHeadersGroup : groups.scrollableHeadersGroup
      for (let col = cols.start; col < cols.end; col++) {
        const node = newColHeaderNode(table, col, left, styles)
        targetGroup.appendChild(node)
        sceneState.colHeaderNodes.set(col, node)
      }
    }
  }
  if (showsRowHeader(table)) {
    for (const rows of [scrollableRows, frozenRows]) {
      const targetGroup =
        rows === frozenRows ? groups.frozenHeadersGroup : groups.scrollableHeadersGroup
      for (let row = rows.start; row < rows.end; row++) {
        const node = newRowHeaderNode(table, row, top, styles)
        targetGroup.appendChild(node)
        sceneState.rowHeaderNodes.set(row, node)
      }
    }
  }
  if (showsColHeader(table) && showsRowHeader(table)) {
    sceneState.cornerNode = newCornerNode(table, styles)
    groups.headerGroup.appendChild(sceneState.cornerNode)
  }
}

export function headerStyles(table: ListTable): HeaderStyles {
  return {
    col: { textOverflow: 'ellipsis', ...themeCellBase(table.theme.header) },
    row: { textOverflow: 'ellipsis', ...themeCellBase(table.theme.rowHeader) },
    corner: { textOverflow: 'ellipsis', ...themeCellBase(table.theme.corner) },
  }
}

interface HeaderStyles {
  col: CellStyle
  row: CellStyle
  corner: CellStyle
}

function headerBorder(
  table: ListTable,
  kind: keyof HeaderStyles,
  styles: HeaderStyles,
): CellBorder | null {
  const style = styles[kind]
  if (kind === 'col') {
    return (
      resolveSharedEdges(
        style.border,
        { right: styles.col.border?.left },
        { firstCol: false, firstRow: true },
      ) ?? null
    )
  }
  if (kind === 'row') {
    return (
      resolveSharedEdges(
        style.border,
        { bottom: styles.row.border?.top },
        { firstCol: true, firstRow: false },
      ) ?? null
    )
  }
  return (
    resolveSharedEdges(
      style.border,
      {
        right: table.columns.length > 0 ? styles.col.border?.left : undefined,
        bottom: table.pipeline.rowCount > 0 ? styles.row.border?.top : undefined,
      },
      { firstCol: true, firstRow: true },
    ) ?? null
  )
}

function headerHighlightInput(table: ListTable): HeaderHighlightInput {
  return {
    snapshot: table.interactionState.selection.snapshot,
    colCount: table.columns.length,
    rowCount: table.pipeline.rowCount,
    merges: table.geometryState.mergeCells,
  }
}

function newColHeaderNode(
  table: ListTable,
  col: number,
  left: number,
  styles: HeaderStyles,
): CellNode {
  const { geometryState } = table
  const node = new CellNode({
    col,
    row: HEADER_COORD,
    x: resolveCellX(
      col,
      left,
      geometryState.colOffsets,
      geometryState.frozenColCount,
      table.rowHeaderWidth,
    ),
    y: 0,
    width: geometryState.colWidths[col] ?? 0,
    height: table.headerHeight,
    text: table.columns[col]?.title ?? table.options.resolveColTitle?.(col) ?? '',
    style: styles.col,
    border: headerBorder(table, 'col', styles),
    renderer: table.options.resolveColHeaderRenderer?.(col) ?? null,
  })
  if (isColHeaderHighlighted(headerHighlightInput(table), col)) {
    node.style = {
      ...styles.col,
      background: opaqueHeaderHighlight(
        table.theme.interaction.headerHighlight,
        styles.col.background,
      ),
    }
  }
  return node
}

function newRowHeaderNode(
  table: ListTable,
  row: number,
  top: number,
  styles: HeaderStyles,
): CellNode {
  const { geometryState } = table
  const node = new CellNode({
    col: HEADER_COORD,
    row,
    x: 0,
    y: resolveCellYFromOffsets(
      row,
      top,
      geometryState.rowOffsets,
      geometryState.frozenRowCount,
      table.headerHeight,
    ),
    width: table.rowHeaderWidth,
    height: table.rowHeightAt(row),
    text: String(row + 1),
    style: styles.row,
    border: headerBorder(table, 'row', styles),
  })
  if (isRowHeaderHighlighted(headerHighlightInput(table), row)) {
    node.style = {
      ...styles.row,
      background: opaqueHeaderHighlight(
        table.theme.interaction.headerHighlight,
        styles.row.background,
      ),
    }
  }
  return node
}

export function applyHeaderHighlight(table: ListTable): {
  rows: Region | null
  cols: Region | null
} {
  const styles = headerStyles(table)
  const highlight = table.theme.interaction.headerHighlight
  const colHighlight = opaqueHeaderHighlight(highlight, styles.col.background)
  const rowHighlight = opaqueHeaderHighlight(highlight, styles.row.background)
  const input = headerHighlightInput(table)
  let rowsRegion: Region | null = null
  let colsRegion: Region | null = null
  for (const [col, node] of table.sceneState.colHeaderNodes) {
    const highlighted = isColHeaderHighlighted(input, col)
    const background = highlighted ? colHighlight : styles.col.background
    if (node.style.background === background) {
      continue
    }
    node.style = highlighted ? { ...styles.col, background } : styles.col
    const bounds = node.getGlobalBounds()
    colsRegion = colsRegion ? unionRegions([colsRegion, bounds])! : bounds
  }
  for (const [row, node] of table.sceneState.rowHeaderNodes) {
    const highlighted = isRowHeaderHighlighted(input, row)
    const background = highlighted ? rowHighlight : styles.row.background
    if (node.style.background === background) {
      continue
    }
    node.style = highlighted ? { ...styles.row, background } : styles.row
    const bounds = node.getGlobalBounds()
    rowsRegion = rowsRegion ? unionRegions([rowsRegion, bounds])! : bounds
  }
  return { rows: rowsRegion, cols: colsRegion }
}

function newCornerNode(table: ListTable, styles: HeaderStyles): CellNode {
  return new CellNode({
    col: HEADER_COORD,
    row: HEADER_COORD,
    x: 0,
    y: 0,
    width: table.rowHeaderWidth,
    height: table.headerHeight,
    style: styles.corner,
    border: headerBorder(table, 'corner', styles),
  })
}
