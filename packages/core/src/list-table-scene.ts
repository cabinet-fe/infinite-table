// ListTable 场景重建协作模块（拆自 list-table.ts，纯移动不改行为）：
// 可视窗口场景树的全量重建与滚动帧增量窗口（6.2：滚入建/滚出摘/存活平移）、
// 分带建格与行列头装配、Excel 式文本溢出右界支撑（refreshCell 的溢出联动依赖）。
// 以 ListTable 实例为参数的协作函数，只触碰表实例上标注 @internal 的内部成员。

import type { SceneNode } from '@infinite-table/render'

import { CellNode } from './cell-node'
import type { CellStyle } from './cell-style'
import {
  computeScrollableColWindow,
  computeScrollableRowWindowFromOffsets,
  resolveCellX,
  resolveCellYFromOffsets,
  type WindowRange,
} from './grid-layout'
import type { ListTable } from './list-table'
import { cellKey, HEADER_COORD } from './list-table-internal'
import { appendImageCell } from './list-table-media'

/** 重建可视窗口场景：数据格在前、行列头在后（同层后画覆盖边缘半格） */
export function rebuildScene(table: ListTable): void {
  const root = table.body.root
  while (root.children.length > 0) {
    root.removeChild(root.children[0]!)
  }
  table.cellNodes.clear()
  table.colHeaderNodes.clear()
  table.rowHeaderNodes.clear()
  table.cornerNode = null
  if (table.media) {
    const mediaRoot = table.media.root
    while (mediaRoot.children.length > 0) {
      mediaRoot.removeChild(mediaRoot.children[0]!)
    }
  }
  table.imageCellNodes.clear()
  const { left, top } = table.scroll.state
  const scrollableRows = computeScrollableRowWindowFromOffsets(
    top,
    table.viewportHeight - table.frozenRowsHeight,
    table.rowOffsets,
    table.frozenRowCount,
  )
  const scrollableCols = computeScrollableColWindow(
    left,
    table.viewportWidth - table.frozenColsWidth,
    table.colOffsets,
    table.frozenColCount,
  )
  table.rows = scrollableRows
  table.cols = scrollableCols
  // 分层顺序：滚动区在最下，部分可见合并区同属滚动层，冻结条带居中，冻结角最上
  // （滚动内容滑到冻结区下方，由后画的冻结区覆盖）
  const frozenRows: WindowRange = { start: 0, end: table.frozenRowCount }
  const frozenCols: WindowRange = { start: 0, end: table.frozenColCount }
  appendCellBand(table, scrollableRows, scrollableCols, left, top)
  appendPartiallyVisibleMerges(table, left, top, [frozenRows, scrollableRows], [
    frozenCols,
    scrollableCols,
  ])
  appendCellBand(table, scrollableRows, frozenCols, left, top)
  appendCellBand(table, frozenRows, scrollableCols, left, top)
  appendCellBand(table, frozenRows, frozenCols, left, top)
  appendHeaders(table, left, top, frozenRows, scrollableRows, frozenCols, scrollableCols)
}

/**
 * 滚动帧增量窗口：摘除滚出行列的节点、补建滚入行列，存活节点原地平移（零重建）。
 * 滚动帧的节点分配与样式投影从 O(窗口格数) 降到 O(滚入格数)；场景内容与全量重建
 * 逐点等价——「滚动区在下、冻结居中、表头最上、同行左格后画」的层内 z 序由
 * 整行列降序补建 + 左侧溢出存活格重挂 + 新建数据格后重挂表头共同保持；
 * band 失效语义不变（onScroll 维持原横/纵带提交）。
 */
export function updateSceneWindow(table: ListTable): void {
  const { left, top } = table.scroll.state
  const prevRows = table.rows
  const prevCols = table.cols
  const scrollableRows = computeScrollableRowWindowFromOffsets(
    top,
    table.viewportHeight - table.frozenRowsHeight,
    table.rowOffsets,
    table.frozenRowCount,
  )
  const scrollableCols = computeScrollableColWindow(
    left,
    table.viewportWidth - table.frozenColsWidth,
    table.colOffsets,
    table.frozenColCount,
  )
  table.rows = scrollableRows
  table.cols = scrollableCols
  const frozenRows: WindowRange = { start: 0, end: table.frozenRowCount }
  const frozenCols: WindowRange = { start: 0, end: table.frozenColCount }
  const rowBands = [frozenRows, scrollableRows]
  const colBands = [frozenCols, scrollableCols]
  const inRange = (index: number, range: WindowRange): boolean =>
    index >= range.start && index < range.end
  const partiallyVisible = (start: number, end: number, bands: readonly WindowRange[]): boolean =>
    bands.some((band) => start < band.end && end >= band.start)
  // 节点保留条件：格在窗口内，或为「主格在窗外但区间仍部分可见」的合并主格
  const keepCell = (col: number, row: number): boolean => {
    if (inRange(row, frozenRows) || inRange(row, scrollableRows)) {
      if (inRange(col, frozenCols) || inRange(col, scrollableCols)) {
        return true
      }
    }
    const range = table.mergeCells.rangeAt(col, row)
    return (
      range !== null &&
      partiallyVisible(range.startRow, range.endRow, rowBands) &&
      partiallyVisible(range.startCol, range.endCol, colBands)
    )
  }
  // 1) 摘除滚出窗口的节点，存活节点按新滚动位置原地平移（数据格与图片格同条件）
  sweepWindowNodes(table, table.cellNodes, table.body.root, keepCell, left, top)
  sweepWindowNodes(table, table.imageCellNodes, table.media?.root ?? null, keepCell, left, top)
  let bodyChanged = false
  // 2) 新滚入行整行补建：先滚动区列降序、再冻结列降序（同行左格后画）
  for (let row = scrollableRows.start; row < scrollableRows.end; row++) {
    if (inRange(row, prevRows)) {
      continue
    }
    for (let col = scrollableCols.end - 1; col >= scrollableCols.start; col--) {
      bodyChanged = appendCell(table, col, row, left, top) || bodyChanged
    }
    for (let col = frozenCols.end - 1; col >= frozenCols.start; col--) {
      bodyChanged = appendCell(table, col, row, left, top) || bodyChanged
    }
  }
  // 3) 存活行补建滚入列（降序），并把可溢出进新列区的左侧存活格重挂到行尾
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
          continue // 新行已在步骤 2 整行补建
        }
        for (let i = enteringCols.length - 1; i >= 0; i--) {
          bodyChanged = appendCell(table, enteringCols[i]!, row, left, top) || bodyChanged
        }
      }
    }
    const firstEntering = enteringCols[0]!
    for (const band of rowBands) {
      for (let row = band.start; row < band.end; row++) {
        for (let col = 0; col < firstEntering; col++) {
          const node = table.cellNodes.get(cellKey(col, row))
          // 溢出格必须后画于其溢出目标（Excel 式溢出只进右侧空格）；
          // 升序重挂保持「越靠左越后画」的既有行内 z 序
          if (node && node.textMaxX > node.width) {
            table.body.root.removeChild(node)
            table.body.root.appendChild(node)
            bodyChanged = true
          }
        }
      }
    }
  }
  // 4) 主格窗外但区间部分可见的合并主格补建（已存在则跳过）
  bodyChanged = appendPartiallyVisibleMerges(table, left, top, rowBands, colBands) || bodyChanged
  // 5) 表头增量维护：存活节点平移、滚出摘除、滚入补建；有新建数据格时把表头
  //    重挂到树尾，保持「表头最上」的既有 z 序（合并主格上缘可能伸进列头带）
  const root = table.body.root
  const style = headerStyle(table)
  for (const [col, node] of table.colHeaderNodes) {
    if (inRange(col, frozenCols) || inRange(col, scrollableCols)) {
      node.x = resolveCellX(col, left, table.colOffsets, table.frozenColCount, table.rowHeaderWidth)
    } else {
      root.removeChild(node)
      table.colHeaderNodes.delete(col)
    }
  }
  for (const [row, node] of table.rowHeaderNodes) {
    if (inRange(row, frozenRows) || inRange(row, scrollableRows)) {
      node.y = resolveCellYFromOffsets(
        row,
        top,
        table.rowOffsets,
        table.frozenRowCount,
        table.headerHeight,
      )
    } else {
      root.removeChild(node)
      table.rowHeaderNodes.delete(row)
    }
  }
  for (const cols of [scrollableCols, frozenCols]) {
    for (let col = cols.start; col < cols.end; col++) {
      if (!table.colHeaderNodes.has(col)) {
        const node = newColHeaderNode(table, col, left, style)
        root.appendChild(node)
        table.colHeaderNodes.set(col, node)
      }
    }
  }
  for (const rows of [scrollableRows, frozenRows]) {
    for (let row = rows.start; row < rows.end; row++) {
      if (!table.rowHeaderNodes.has(row)) {
        const node = newRowHeaderNode(table, row, top, style)
        root.appendChild(node)
        table.rowHeaderNodes.set(row, node)
      }
    }
  }
  if (!table.cornerNode) {
    table.cornerNode = newCornerNode(table, style)
    root.appendChild(table.cornerNode)
  }
  if (bodyChanged) {
    for (const node of table.colHeaderNodes.values()) {
      root.removeChild(node)
      root.appendChild(node)
    }
    for (const node of table.rowHeaderNodes.values()) {
      root.removeChild(node)
      root.appendChild(node)
    }
    if (table.cornerNode) {
      root.removeChild(table.cornerNode)
      root.appendChild(table.cornerNode)
    }
  }
}

/**
 * 窗口滑动清扫：不满足保留条件的节点从父节点摘除并出索引，
 * 存活节点按新滚动位置原地平移（数据格、图片格通用）。
 */
function sweepWindowNodes<T extends SceneNode & { readonly col: number; readonly row: number }>(
  table: ListTable,
  nodes: Map<number, T>,
  parent: SceneNode | null,
  keep: (col: number, row: number) => boolean,
  left: number,
  top: number,
): void {
  for (const [key, node] of nodes) {
    if (keep(node.col, node.row)) {
      node.x = resolveCellX(node.col, left, table.colOffsets, table.frozenColCount, table.rowHeaderWidth)
      node.y = resolveCellYFromOffsets(
        node.row,
        top,
        table.rowOffsets,
        table.frozenRowCount,
        table.headerHeight,
      )
    } else {
      parent?.removeChild(node)
      nodes.delete(key)
    }
  }
}

/** 建一个行列带内的数据格节点；同行按列降序建（后画在上），左格溢出文本不被右格背景盖住 */
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

/**
 * 建单格节点：被合并覆盖的格不建节点（由主格统一取值/绘制/命中），主格跨域取完整尺寸；
 * 节点已存在（增量窗口保留的存活格/既有合并主格）时跳过。返回是否新建了节点。
 */
function appendCell(table: ListTable, col: number, row: number, left: number, top: number): boolean {
  if (table.cellNodes.has(cellKey(col, row))) {
    return false
  }
  const range = table.mergeCells.rangeAt(col, row)
  if (range && (range.startCol !== col || range.startRow !== row)) {
    return false
  }
  const endCol = range?.endCol ?? col
  const endRow = range?.endRow ?? row
  // 图片格：body 节点只画背景/边框（文本留空），图片内容在 L2 media 层渲染
  const imageUrl = table.options.resolveCellImage?.(col, row)
  const style = table.resolveStyle(col, row)
  const node = new CellNode({
    col,
    row,
    x: resolveCellX(col, left, table.colOffsets, table.frozenColCount, table.rowHeaderWidth),
    y: resolveCellYFromOffsets(row, top, table.rowOffsets, table.frozenRowCount, table.headerHeight),
    width: (table.colOffsets[endCol + 1] ?? 0) - (table.colOffsets[col] ?? 0),
    height: (table.rowOffsets[endRow + 1] ?? 0) - (table.rowOffsets[row] ?? 0),
    text: imageUrl ? '' : table.pipeline.resolveText(col, row),
    value: table.pipeline.resolveValue(col, row),
    cellType: table.options.columns[col]?.cellType,
    style,
    renderer: table.options.resolveCellRenderer?.(col, row) ?? null,
  })
  // 文本溢出右界（Excel 式溢出到右侧空格；换行/表头/合并/图片/自定义渲染格不溢出）
  const limitX = imageUrl ? null : textOverflowLimitX(table, col, row, style, left)
  node.textMaxX = limitX === null ? node.width : limitX - node.x
  table.body.root.appendChild(node)
  table.cellNodes.set(cellKey(col, row), node)
  if (imageUrl) {
    appendImageCell(table, col, row, imageUrl, node.x, node.y, node.width, node.height)
  }
  return true
}

/** 空文本数据格判定（溢出邻居扫描用）：text 类型、无图片/自定义渲染/合并覆盖、取值文本为空 */
function isEmptyTextCell(table: ListTable, col: number, row: number): boolean {
  return (
    (table.options.columns[col]?.cellType ?? 'text') === 'text' &&
    !table.options.resolveCellRenderer?.(col, row) &&
    !table.options.resolveCellImage?.(col, row) &&
    !table.mergeCells.rangeAt(col, row) &&
    !table.pipeline.resolveText(col, row)
  )
}

/**
 * 文本溢出允许的层坐标右界；null 表示该格不溢出（裁剪在本格内）。
 * Excel 规则：只溢出到右侧相邻空格，遇非空格停；换行、ellipsis/clip、checkbox、合并、图片、
 * 自定义渲染格不溢出；冻结列带不越过带边界（对齐 Excel 冻结窗格），滚动带止于最后一列。
 */
export function textOverflowLimitX(
  table: ListTable,
  col: number,
  row: number,
  style: CellStyle,
  left: number,
): number | null {
  if (
    style.textOverflow !== undefined ||
    style.textWrap === true ||
    (table.options.columns[col]?.cellType ?? 'text') !== 'text' ||
    table.options.resolveCellRenderer?.(col, row) ||
    table.options.resolveCellImage?.(col, row) ||
    table.mergeCells.rangeAt(col, row) ||
    !table.pipeline.resolveText(col, row)
  ) {
    return null
  }
  const inFrozenBand = col < table.frozenColCount
  const bandEnd = inFrozenBand ? table.frozenColCount : table.options.columns.length
  let end = col + 1
  while (end < bandEnd && isEmptyTextCell(table, end, row)) {
    end++
  }
  if (end === col + 1) {
    return null
  }
  // 列左缘的层坐标（冻结带内不随滚动位移）
  return inFrozenBand
    ? table.rowHeaderWidth + (table.colOffsets[end] ?? 0)
    : table.rowHeaderWidth + (table.colOffsets[end] ?? 0) - left
}

/**
 * 左侧最近的非空格列号（溢出来源候选）：从左邻向带首扫，中间全空格无文本不可溢出，
 * 再往左被首个非空格挡住。返回后由调用方重算其溢出右界（不可溢出则收敛回本格宽）
 */
export function overflowSourceCol(table: ListTable, col: number, row: number): number | null {
  const bandStart = col < table.frozenColCount ? 0 : table.frozenColCount
  for (let c = col - 1; c >= bandStart; c--) {
    if (!isEmptyTextCell(table, c, row)) {
      return c
    }
  }
  return null
}

/** 合并区主格落在窗口外但区间部分可见时补建主格节点（位置可越出视口，绘制由 cull 裁剪）；返回是否新建 */
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
  for (const range of table.mergeCells.ranges) {
    if (table.cellNodes.has(cellKey(range.startCol, range.startRow))) {
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

/** 列头（冻结列固定、其余随横向滚动）+ 行号列（冻结行固定、其余随纵向滚动）+ 左上角 */
function appendHeaders(
  table: ListTable,
  left: number,
  top: number,
  frozenRows: WindowRange,
  scrollableRows: WindowRange,
  frozenCols: WindowRange,
  scrollableCols: WindowRange,
): void {
  const root = table.body.root
  const style = headerStyle(table)
  // 滚动条带先画、冻结条带后画：滑动的行/列头被冻结头覆盖
  for (const cols of [scrollableCols, frozenCols]) {
    for (let col = cols.start; col < cols.end; col++) {
      const node = newColHeaderNode(table, col, left, style)
      root.appendChild(node)
      table.colHeaderNodes.set(col, node)
    }
  }
  for (const rows of [scrollableRows, frozenRows]) {
    for (let row = rows.start; row < rows.end; row++) {
      const node = newRowHeaderNode(table, row, top, style)
      root.appendChild(node)
      table.rowHeaderNodes.set(row, node)
    }
  }
  table.cornerNode = newCornerNode(table, style)
  root.appendChild(table.cornerNode)
}

/** 列头/行号列缺省 ellipsis（超宽标题省略号截断）；主题 header 分区显式给了 textOverflow 则以主题为准 */
function headerStyle(table: ListTable): CellStyle {
  return { textOverflow: 'ellipsis', ...table.theme.header }
}

function newColHeaderNode(table: ListTable, col: number, left: number, style: CellStyle): CellNode {
  return new CellNode({
    col,
    row: HEADER_COORD,
    x: resolveCellX(col, left, table.colOffsets, table.frozenColCount, table.rowHeaderWidth),
    y: 0,
    width: table.colWidths[col] ?? 0,
    height: table.headerHeight,
    text: table.options.columns[col]?.title ?? '',
    style,
  })
}

function newRowHeaderNode(table: ListTable, row: number, top: number, style: CellStyle): CellNode {
  return new CellNode({
    col: HEADER_COORD,
    row,
    x: 0,
    y: resolveCellYFromOffsets(row, top, table.rowOffsets, table.frozenRowCount, table.headerHeight),
    width: table.rowHeaderWidth,
    height: table.rowHeightAt(row),
    text: String(row + 1),
    style,
  })
}

function newCornerNode(table: ListTable, style: CellStyle): CellNode {
  return new CellNode({
    col: HEADER_COORD,
    row: HEADER_COORD,
    x: 0,
    y: 0,
    width: table.rowHeaderWidth,
    height: table.headerHeight,
    style,
  })
}
