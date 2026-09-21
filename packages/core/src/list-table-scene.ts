// ListTable 场景重建协作模块（拆自 list-table.ts，纯移动不改行为）：
// 可视窗口场景树的全量重建与滚动帧增量窗口（6.2：滚入建/滚出摘/存活平移）、
// 分带建格与行列头装配、Excel 式文本溢出右界支撑（refreshCell 的溢出联动依赖）。
// 以 ListTable 实例为参数的协作函数，只触碰表实例上标注 @internal 的内部成员。

import { SceneNode, type Region, type RenderContext } from '@infinite-table/render'

import { CellNode } from './cell-node'
import type { CellBorder, CellBorderEdge, CellStyle } from './cell-style'
import {
  computeScrollableColWindow,
  computeScrollableRowWindowFromOffsets,
  resolveCellX,
  resolveCellYFromOffsets,
  unionRegions,
  type WindowRange,
} from './grid-layout'
import type { ListTable } from './list-table'
import {
  cellKey,
  HEADER_COORD,
  isColHeaderHighlighted,
  isRowHeaderHighlighted,
} from './list-table-internal'
import { appendImageCell } from './list-table-media'
import { resolveSharedEdges, strongerEdge } from './shared-edges'
import { themeCellBase } from './theme'
import type { FrameStyle } from './theme'

/** 外框阴影模糊半径（CSS 像素；frameStyle.shadow 开启时的固定观感） */
const FRAME_SHADOW_BLUR = 6

/**
 * 纯填充矩形节点：underlay 底色铺设。恒为 body root 首子节点（格背景之下），
 * 数据区外空白处与半透明格背景之下直接可见。
 */
export class UnderlayNode extends SceneNode {
  constructor(private readonly color: string) {
    super({ pickable: false })
  }

  override paint(ctx: RenderContext): void {
    ctx.fillStyle = this.color
    ctx.fillRect(0, 0, this.width, this.height)
  }
}

/** 表格外框节点：四边细条线框 + 可选阴影（RenderContext 无 stroke，用细条填充）。恒为 body root 末子节点 */
export class FrameNode extends SceneNode {
  constructor(private readonly frame: FrameStyle) {
    super({ pickable: false })
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
  table.headerGroup = null
  table.frameNode = null
  if (table.media) {
    const mediaRoot = table.media.root
    while (mediaRoot.children.length > 0) {
      mediaRoot.removeChild(mediaRoot.children[0]!)
    }
  }
  table.imageCellNodes.clear()
  // underlay 底色最先入树（首子节点）：格背景之下铺设
  const underlay = new UnderlayNode(table.theme.underlayBackgroundColor)
  underlay.width = table.width
  underlay.height = table.height
  root.appendChild(underlay)
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
  // 表头收进单一容器节点（R2-5）：容器恒为 root 末子节点，表头整体在全部数据格之上；
  // 滚动帧有新建数据格时只需重挂容器单节点（原先逐表头 removeChild+appendChild，
  // 单节点 removeChild 含 indexOf+splice，整体为 O(表头数×窗口节点数)）。
  // 容器自带全表包围盒且 pickable:false：paintTree 的 cull 与 hitTest 都按节点自身
  // 包围盒判定，零尺寸容器会让表头被 cull 剔除或无法命中；pickable:false 使未命中
  // 表头子节点时穿透到数据格。
  const headerGroup = newHeaderGroup(table)
  table.headerGroup = headerGroup
  root.appendChild(headerGroup)
  appendHeaders(
    table,
    headerGroup,
    left,
    top,
    frozenRows,
    scrollableRows,
    frozenCols,
    scrollableCols,
  )
  // 外框最后入树（末子节点）：恒在数据格与表头之上；滚动帧增量补建后由 updateSceneWindow 重挂保持最上
  const frame = new FrameNode(table.theme.frameStyle)
  frame.width = table.width
  frame.height = table.height
  root.appendChild(frame)
  table.frameNode = frame
}

/**
 * 滚动帧增量窗口：摘除滚出行列的节点、补建滚入行列，存活节点原地平移（零重建）。
 * 滚动帧的节点分配与样式投影从 O(窗口格数) 降到 O(滚入格数)；场景内容与全量重建
 * （rebuildScene）逐点等价。层内 z 序契约（R2-6 固化，改动步骤 ②③⑤ 前必读）：
 * 1. 滚动区在下、冻结条带居中：两带几何不相交，带间绘制顺序无语义，
 *    「新节点挂树尾」不会破坏带间关系；全量重建带序为
 *    滚动带 → 部分可见合并区 → 冻结列带 → 冻结行带 → 冻结角 → 表头容器。
 * 2. 同行左格后画（Excel 式溢出文本不被右侧格背景盖住）：
 *    全量重建 = 带内按列降序建格（左格最后画）；增量侧 = 新滚入行整行降序补建
 *    （步骤 ②，含冻结列）+ 滚入列降序补建（步骤 ③ 前半）+ 对 `[0, firstEntering)`
 *    × 全部行带中 `textMaxX > width` 的存活格按列升序 removeChild+appendChild
 *    重挂树尾（步骤 ③ 后半）。等价性逐点对照：
 *    - 升序重挂保持「越靠左越后画」；重挂格后画于本帧新补建的滚入格，
 *      覆盖「溢出格穿过新滚入列」的组合（横向右滚的典型形态）；
 *    - 向左滚动时滚入列在左缘：滚入格挂树尾即在其右侧存活格之上，
 *      与全量重建「小列号后画」一致；右侧存活格不向左溢出，无需重挂；
 *    - 溢出格同行内被 ≥1 个空格隔开（溢出走廊必然全空，且文本右缘止于下一
 *      非空格左缘），重挂集合内部两两无绘制交叠——升序与全量重建的降序虽非
 *      字面同序，可见输出等价；升序保证重挂格整体后画于本帧滚入格。
 *    步骤 ③ 扫描口径的边界：对「新行已在步骤 ② 整行补建」的行跳过（整行降序
 *    已内含左格后画）；对冻结带行不跳过——冻结「行」上的滚动区列格仍可向右
 *    溢出进滚入列（冻结只按「列」带截断溢出，见 textOverflowLimitX）。
 * 3. 表头最上（合并主格上缘可伸进列头带）：表头收进单一容器节点且恒为 root
 *    末子节点（R2-5，见 rebuildScene）；bodyChanged 时仅把容器重挂树尾一次。
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
  sweepWindowNodes(
    table,
    table.imageCellNodes,
    table.media?.root ?? null,
    keepCell,
    left,
    top,
    (node) => {
      // 引用裁剪接线（R2-7）：滚出窗口的图片格释放 ImageService 格引用，
      // 无引用条目脱离窗口调度扫描面（重入由 appendImageCell 的 request 重登记）
      table.imageService.releaseRef(node.url, { col: node.col, row: node.row })
    },
  )
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
  // 5) 表头增量维护：存活节点平移、滚出摘除、滚入补建，全部发生在表头容器内
  //    （容器恒在数据格之上，见 rebuildScene）；有新建数据格时把容器重挂到树尾，
  //    保持「表头最上」的既有 z 序（合并主格上缘可能伸进列头带）
  const root = table.body.root
  const styles = headerStyles(table)
  if (!table.headerGroup) {
    table.headerGroup = newHeaderGroup(table)
    root.appendChild(table.headerGroup)
  }
  const headerGroup = table.headerGroup
  for (const [col, node] of table.colHeaderNodes) {
    if (inRange(col, frozenCols) || inRange(col, scrollableCols)) {
      node.x = resolveCellX(col, left, table.colOffsets, table.frozenColCount, table.rowHeaderWidth)
    } else {
      headerGroup.removeChild(node)
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
      headerGroup.removeChild(node)
      table.rowHeaderNodes.delete(row)
    }
  }
  for (const cols of [scrollableCols, frozenCols]) {
    for (let col = cols.start; col < cols.end; col++) {
      if (!table.colHeaderNodes.has(col)) {
        const node = newColHeaderNode(table, col, left, styles)
        headerGroup.appendChild(node)
        table.colHeaderNodes.set(col, node)
      }
    }
  }
  for (const rows of [scrollableRows, frozenRows]) {
    for (let row = rows.start; row < rows.end; row++) {
      if (!table.rowHeaderNodes.has(row)) {
        const node = newRowHeaderNode(table, row, top, styles)
        headerGroup.appendChild(node)
        table.rowHeaderNodes.set(row, node)
      }
    }
  }
  if (!table.cornerNode) {
    table.cornerNode = newCornerNode(table, styles)
    headerGroup.appendChild(table.cornerNode)
  }
  if (bodyChanged) {
    // appendChild 自带摘除重挂：单节点定位替代原先逐表头搬移
    root.appendChild(headerGroup)
    if (table.frameNode) {
      // 外框重挂树尾：恒在数据格与表头之上
      root.appendChild(table.frameNode)
    }
  }
}

/**
 * 窗口滑动清扫：不满足保留条件的节点从父节点摘除并出索引，
 * 存活节点按新滚动位置原地平移（数据格、图片格通用）；
 * 滚出节点先收集、再按父节点一次批摘（SceneNode.removeChildren 单趟压实，
 * 清扫从 O(滚出 × 窗口子节点数) 降为 O(窗口子节点数)，R3-1）；
 * onSweep 保持「摘除后回调」时序（图片格释放 ImageService 引用的接线点）。
 */
function sweepWindowNodes<T extends SceneNode & { readonly col: number; readonly row: number }>(
  table: ListTable,
  nodes: Map<number, T>,
  parent: SceneNode | null,
  keep: (col: number, row: number) => boolean,
  left: number,
  top: number,
  onSweep?: (node: T) => void,
): void {
  const swept: T[] = []
  for (const [key, node] of nodes) {
    if (keep(node.col, node.row)) {
      node.x = resolveCellX(
        node.col,
        left,
        table.colOffsets,
        table.frozenColCount,
        table.rowHeaderWidth,
      )
      node.y = resolveCellYFromOffsets(
        node.row,
        top,
        table.rowOffsets,
        table.frozenRowCount,
        table.headerHeight,
      )
    } else {
      nodes.delete(key)
      swept.push(node)
    }
  }
  if (swept.length > 0) {
    if (parent) {
      const sweptSet = new Set<SceneNode>(swept)
      parent.removeChildren((child) => sweptSet.has(child))
    }
    for (const node of swept) {
      onSweep?.(node)
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
 * 数据格生效绘制边框（共享边裁决，规则见 shared-edges.ts 头注）：
 * right/bottom 与邻居对侧边取强，left/top 仅模型首列/首行自画（其余由左/上邻居呈现）。
 * 合并主格拥有区域右/下缘：facing 取区域外邻居逐格对侧边的最强者；被覆盖格的边忽略（v1）。
 * 邻居样式经表侧统一 styleAt 溯源：每格至多 2 次额外样式解析（右/下邻居），
 * 合并格按区域右/下缘边长逐格（v1 简化：邻居为被合并覆盖格时取其原始格样式）。
 */
export function effectiveBorder(
  table: ListTable,
  col: number,
  row: number,
  style: CellStyle,
): CellBorder | null {
  const range = table.mergeCells.rangeAt(col, row)
  const endCol = range?.endCol ?? col
  const endRow = range?.endRow ?? row
  let facingRight: CellBorderEdge | undefined
  if (endCol + 1 < table.options.columns.length) {
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

/**
 * 建单格节点：被合并覆盖的格不建节点（由主格统一取值/绘制/命中），主格跨域取完整尺寸；
 * 节点已存在（增量窗口保留的存活格/既有合并主格）时跳过。返回是否新建了节点。
 */
function appendCell(
  table: ListTable,
  col: number,
  row: number,
  left: number,
  top: number,
): boolean {
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
    y: resolveCellYFromOffsets(
      row,
      top,
      table.rowOffsets,
      table.frozenRowCount,
      table.headerHeight,
    ),
    width: (table.colOffsets[endCol + 1] ?? 0) - (table.colOffsets[col] ?? 0),
    height: (table.rowOffsets[endRow + 1] ?? 0) - (table.rowOffsets[row] ?? 0),
    text: imageUrl ? '' : table.pipeline.resolveText(col, row),
    value: table.pipeline.resolveValue(col, row),
    cellType: table.options.columns[col]?.cellType,
    style,
    border: effectiveBorder(table, col, row, style),
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

/** 表头容器节点：恒为 body root 末子节点（见 rebuildScene 的 z 序说明） */
function newHeaderGroup(table: ListTable): SceneNode {
  return new SceneNode({ pickable: false, width: table.width, height: table.height })
}

/** 列头（冻结列固定、其余随横向滚动）+ 行号列（冻结行固定、其余随纵向滚动）+ 左上角 */
function appendHeaders(
  table: ListTable,
  headerGroup: SceneNode,
  left: number,
  top: number,
  frozenRows: WindowRange,
  scrollableRows: WindowRange,
  frozenCols: WindowRange,
  scrollableCols: WindowRange,
): void {
  const styles = headerStyles(table)
  // 滚动条带先画、冻结条带后画：滑动的行/列头被冻结头覆盖
  for (const cols of [scrollableCols, frozenCols]) {
    for (let col = cols.start; col < cols.end; col++) {
      const node = newColHeaderNode(table, col, left, styles)
      headerGroup.appendChild(node)
      table.colHeaderNodes.set(col, node)
    }
  }
  for (const rows of [scrollableRows, frozenRows]) {
    for (let row = rows.start; row < rows.end; row++) {
      const node = newRowHeaderNode(table, row, top, styles)
      headerGroup.appendChild(node)
      table.rowHeaderNodes.set(row, node)
    }
  }
  table.cornerNode = newCornerNode(table, styles)
  headerGroup.appendChild(table.cornerNode)
}

/** 三类表头分区样式：列头用 header、行号列用 rowHeader、左上角用 corner（缺省随 header 派生）；borderColor 同样投影为网格边 */
export function headerStyles(table: ListTable): HeaderStyles {
  return {
    col: { textOverflow: 'ellipsis', ...themeCellBase(table.theme.header) },
    row: { textOverflow: 'ellipsis', ...themeCellBase(table.theme.rowHeader) },
    corner: { textOverflow: 'ellipsis', ...themeCellBase(table.theme.corner) },
  }
}

/** 表头三分区样式集合（共享边裁决 facing 溯源与节点装配共用） */
export interface HeaderStyles {
  col: CellStyle
  row: CellStyle
  corner: CellStyle
}

/**
 * 表头节点生效边框：表头带内同样走共享边裁决（列头横排互裁、行号列竖排互裁、
 * 角格拥有列头 0 的 left 与行号 0 的 top）；表头带与数据带之间不做裁决——
 * 数据带首列/首行的 left/top 由各带自画（带边界两侧边并列，与既有观感一致）。
 */
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
        // 右邻列头的 left 边（列头样式集合各列共享，逐列 facing 相同）
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
        right: table.options.columns.length > 0 ? styles.col.border?.left : undefined,
        bottom: table.pipeline.rowCount > 0 ? styles.row.border?.top : undefined,
      },
      { firstCol: true, firstRow: true },
    ) ?? null
  )
}

function newColHeaderNode(
  table: ListTable,
  col: number,
  left: number,
  styles: HeaderStyles,
): CellNode {
  const node = new CellNode({
    col,
    row: HEADER_COORD,
    x: resolveCellX(col, left, table.colOffsets, table.frozenColCount, table.rowHeaderWidth),
    y: 0,
    width: table.colWidths[col] ?? 0,
    height: table.headerHeight,
    text: table.options.columns[col]?.title ?? '',
    style: styles.col,
    border: headerBorder(table, 'col', styles),
  })
  // 整列选区覆盖 → 列头高亮（建格路径与选区变化路径共用同一判定）
  if (isColHeaderHighlighted(table.selection.snapshot, table.pipeline.rowCount, col)) {
    node.style = { ...styles.col, background: table.theme.interaction.headerHighlight }
  }
  return node
}

function newRowHeaderNode(
  table: ListTable,
  row: number,
  top: number,
  styles: HeaderStyles,
): CellNode {
  const node = new CellNode({
    col: HEADER_COORD,
    row,
    x: 0,
    y: resolveCellYFromOffsets(
      row,
      top,
      table.rowOffsets,
      table.frozenRowCount,
      table.headerHeight,
    ),
    width: table.rowHeaderWidth,
    height: table.rowHeightAt(row),
    text: String(row + 1),
    style: styles.row,
    border: headerBorder(table, 'row', styles),
  })
  // 整行选区覆盖 → 行号格高亮
  if (isRowHeaderHighlighted(table.selection.snapshot, table.options.columns.length, row)) {
    node.style = { ...styles.row, background: table.theme.interaction.headerHighlight }
  }
  return node
}

/**
 * 表头高亮同步：按当前选区重涂可见行号/列头节点的高亮背景，
 * 返回两个条带上翻转节点的包围并集（行号列条带/列头条带；无翻转为 null），
 * 供调用方只登记表头条带 band 失效（不产生 body band/full）。
 */
export function applyHeaderHighlight(table: ListTable): {
  rows: Region | null
  cols: Region | null
} {
  const styles = headerStyles(table)
  const highlight = table.theme.interaction.headerHighlight
  const colCount = table.options.columns.length
  const rowCount = table.pipeline.rowCount
  let rowsRegion: Region | null = null
  let colsRegion: Region | null = null
  for (const [col, node] of table.colHeaderNodes) {
    const highlighted = isColHeaderHighlighted(table.selection.snapshot, rowCount, col)
    const background = highlighted ? highlight : styles.col.background
    if (node.style.background === background) {
      continue
    }
    node.style = highlighted ? { ...styles.col, background } : styles.col
    const bounds = node.getGlobalBounds()
    colsRegion = colsRegion ? unionRegions([colsRegion, bounds])! : bounds
  }
  for (const [row, node] of table.rowHeaderNodes) {
    const highlighted = isRowHeaderHighlighted(table.selection.snapshot, colCount, row)
    const background = highlighted ? highlight : styles.row.background
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
