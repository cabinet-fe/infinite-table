// 透视表聚合模型：行维度树 × 列维度树 × 度量 → 展平行序列与聚合矩阵，实现引擎
// TableModel 数据面。两个方向都是维度树，但布局语言不同：
// - 行方向是多列树形布局：每个行维度独占一列，同组单元格跨行合并（rowspan）；
//   展开时组格纵跨其全部可见后代行，折叠时组收敛为单行载体（branch 行自带该
//   前缀路径的聚合值即小计载体），leaf 为最深层维度值，grand 为总计。
// - 列方向是多级表头：列维度序列逐层展开为表头行（层级序），同层前缀的连续
//   数据列横向合并（colspan），末行固定为度量标题行；无列维度时仅度量行。
// 表头行以引擎冻结行落地（含角落区整块合并），故模型 rowCount = 表头行数 +
// 数据行数，引擎坐标含表头偏移；合并区（角落/表头层/行组跨行/载体与总计横并）
// 一并在 rebuild 计算，由 PivotGrid 经 setMergeCells 落地。
// 交叉聚合都是引擎没有的领域概念——本模型把结果展平成唯一行列矩阵，引擎只看到
// rowCount/colCount 与逐格取值；结构变化（行维度序列 / 列维度序列 / 度量序列 /
// 度量聚合）整体重算，由 PivotGrid 经 batchUpdate + setRowCount/setColCount/
// setFrozenColCount/setFrozenRowCount/setMergeCells 落地引擎几何；展开/折叠只重算
// 行序列与行侧合并区，列结构不变。
// 维度值与列头序均用码点比较（不走 localeCompare）：跨环境确定，冒烟断言可依赖。

import type { CellChangeEvent, CellRange, TableModel } from '@infinitable/table'

import type { PivotDimension, PivotMeasure, PivotRecord } from './types'

/** 可见行：leaf 最深维度值 / branch 折叠组载体行（自带聚合即小计）/ grand 总计行 */
export interface PivotRow {
  type: 'branch' | 'leaf' | 'grand'
  /** 行维度路径（branch 为组前缀路径；leaf 逐 depth 维度值到最深层；grand 为空） */
  path: readonly string[]
  /** 树深度（path.length - 1，0 基；总计行 -1） */
  depth: number
  /** branch 恒 false（载体行即折叠态）；leaf/grand 恒 true */
  expanded: boolean
  /** branch 恒 true（有被折叠的子层）；leaf/grand 恒 false */
  hasChildren: boolean
}

/** 列描述：行维度列（每个行维度一列，冻结带）或数据列（列维度路径 × 度量） */
export type PivotColumn =
  | { kind: 'row-header'; title: string; width: number }
  | { kind: 'measure'; colPath: readonly string[]; measure: PivotMeasure }

/** 折叠态节点键：路径以 \u0000 连接（维度值不含控制字符，键无歧义） */
const NODE_KEY_SEP = '\u0000'

/** 维度值空值标签（记录字段值为空的归此组） */
const EMPTY_DIMENSION_VALUE = '(空)'

/** 记录字段值 → 维度值（空值归 (空)） */
function dimensionValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return EMPTY_DIMENSION_VALUE
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  return EMPTY_DIMENSION_VALUE
}

/** 预聚合累加槽布局：[0]=记录数，之后每度量 4 个槽位 [numCount, sum, min, max] */
const ACC_STRIDE = 4

/** 行维度树节点：阶段 1 单遍扫描构建，阶段 2 按折叠态 DFS 展平 */
export interface PivotTreeNode {
  /** 节点路径键（以 \u0000 连接） */
  key: string
  /** 行维度路径（根节点为空数组） */
  path: readonly string[]
  /** 树深度（0 基；根节点为 -1） */
  depth: number
  /** 当前层维度值（根节点为空串） */
  label: string
  /** 子节点序列（阶段 1 构建后按维度值码点序排列） */
  children: PivotTreeNode[]
  /** 可折叠 branch 节点键（非最深层且 depth >= 0 时非空，最深层与根为 null） */
  branchKey: string | null
  /** 预聚合累加槽（按列叶子 rawColId 索引） */
  accumulators: Map<number, Float64Array>
}

/** 阶段 1 构建期的临时树节点（挂载子节点查找表，构建后按码点序冻结到 children） */
interface BuildTreeNode extends PivotTreeNode {
  childrenMap: Map<string, BuildTreeNode>
  children: BuildTreeNode[]
}

/** 阶段 1 构建期的列维度前缀树节点 */
interface ColTrieNode {
  children: Map<string, ColTrieNode>
  rawId: number
}

/** 创建空累加槽（min 初始化为 +∞、max 初始化为 -∞） */
function createAccumulatorSlot(measureCount: number): Float64Array {
  const slot = new Float64Array(1 + measureCount * ACC_STRIDE)
  for (let m = 0; m < measureCount; m++) {
    const offset = 1 + m * ACC_STRIDE
    slot[offset + 2] = Number.POSITIVE_INFINITY
    slot[offset + 3] = Number.NEGATIVE_INFINITY
  }
  return slot
}

/** 单条记录累加进槽位（阶段 1 单遍扫描内调用） */
function accumulateRecord(
  slot: Float64Array,
  record: PivotRecord,
  measures: readonly PivotMeasure[],
): void {
  slot[0] = slot[0]! + 1
  for (let m = 0; m < measures.length; m++) {
    const measure = measures[m]!
    if (measure.agg === 'count') continue
    const value = record[measure.field]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const offset = 1 + m * ACC_STRIDE
    slot[offset] = slot[offset]! + 1
    slot[offset + 1] = slot[offset + 1]! + value
    if (value < slot[offset + 2]!) slot[offset + 2] = value
    if (value > slot[offset + 3]!) slot[offset + 3] = value
  }
}

/** 子节点累加槽向上归并到父节点（阶段 1 自底向上汇总用） */
function mergeAccumulatorSlot(
  target: Float64Array,
  source: Float64Array,
  measureCount: number,
): void {
  target[0] = target[0]! + source[0]!
  for (let m = 0; m < measureCount; m++) {
    const offset = 1 + m * ACC_STRIDE
    const srcNumCount = source[offset]!
    if (srcNumCount === 0) continue
    target[offset] = target[offset]! + srcNumCount
    target[offset + 1] = target[offset + 1]! + source[offset + 1]!
    const srcMin = source[offset + 2]!
    if (srcMin < target[offset + 2]!) target[offset + 2] = srcMin
    const srcMax = source[offset + 3]!
    if (srcMax > target[offset + 3]!) target[offset + 3] = srcMax
  }
}

/** 从预聚合累加槽读取指定度量的最终聚合值（空集 count/sum 为 0，avg/min/max 为 undefined） */
function resolveAccumulatorValue(
  slot: Float64Array | undefined,
  measureIndex: number,
  agg: PivotMeasure['agg'],
): number | undefined {
  if (agg === 'count') return slot ? slot[0]! : 0
  if (!slot) return agg === 'sum' ? 0 : undefined
  const offset = 1 + measureIndex * ACC_STRIDE
  const numCount = slot[offset]!
  const sum = slot[offset + 1]!
  if (agg === 'sum') return sum
  if (numCount === 0) return undefined
  if (agg === 'avg') return sum / numCount
  return agg === 'min' ? slot[offset + 2]! : slot[offset + 3]!
}

/** 将节点预聚合累加槽投影为该可见行的数据列数组 */
function materializeRowValues(
  node: PivotTreeNode,
  colLeafRawIds: readonly number[],
  measures: readonly PivotMeasure[],
): (number | undefined)[] {
  const values: (number | undefined)[] = []
  for (let c = 0; c < colLeafRawIds.length; c++) {
    const slot = node.accumulators.get(colLeafRawIds[c]!)
    for (let m = 0; m < measures.length; m++) {
      values.push(resolveAccumulatorValue(slot, m, measures[m]!.agg))
    }
  }
  return values
}

/** 节点维度值码点序比较（与 [...keys].sort() 一致） */
function compareNodeLabel(a: PivotTreeNode, b: PivotTreeNode): number {
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
}

/** 列维度前缀树 DFS 展开为码点序叶子路径及对应的 rawColId */
function collectSortedColLeaves(
  node: ColTrieNode,
  prefix: string[],
  outPaths: string[][],
  outRawIds: number[],
): void {
  if (node.children.size === 0) {
    if (node.rawId >= 0) {
      outPaths.push(prefix)
      outRawIds.push(node.rawId)
    }
    return
  }
  const keys = [...node.children.keys()].sort()
  for (const key of keys) {
    collectSortedColLeaves(node.children.get(key)!, [...prefix, key], outPaths, outRawIds)
  }
}

/** 阶段 1 收尾：按码点序整理子节点、收集 branchKeys 并自底向上归并累加槽 */
function finalizeTreeNode(
  node: BuildTreeNode,
  measureCount: number,
  branchKeys: Set<string>,
): void {
  if (node.branchKey !== null) {
    branchKeys.add(node.branchKey)
  }
  if (node.childrenMap.size === 0) return
  const children = [...node.childrenMap.values()].sort(compareNodeLabel)
  node.children = children
  for (const child of children) {
    finalizeTreeNode(child, measureCount, branchKeys)
    for (const [rawColId, childSlot] of child.accumulators) {
      let parentSlot = node.accumulators.get(rawColId)
      if (!parentSlot) {
        parentSlot = createAccumulatorSlot(measureCount)
        node.accumulators.set(rawColId, parentSlot)
      }
      mergeAccumulatorSlot(parentSlot, childSlot, measureCount)
    }
  }
}

/** 去重且保持首现顺序（行/列维度与度量序列按调用方顺序生效，不回池序） */
function dedupe(keys: readonly string[]): string[] {
  return [...new Set(keys)]
}

/** 两路径前 length 级一致（length ≤ 较短路径长度时才可能为 true） */
function samePathPrefix(a: readonly string[], b: readonly string[], length: number): boolean {
  if (a.length < length || b.length < length) return false
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export class PivotModel implements TableModel {
  private dimensionPool: readonly PivotDimension[]
  private measurePool: readonly PivotMeasure[]
  private records: readonly PivotRecord[]
  private rowDimKeys: readonly string[]
  private columnDimKeys: readonly string[]
  private measureKeys: readonly string[]
  /** 是否显示总计行（缺省 true） */
  private showGrandTotalEnabled = true
  /** 行维度树是否可折叠（false 时始终平铺，折叠操作整体禁用） */
  private collapsibleEnabled = true
  /** 折叠态 branch 节点键（结构变更清空，数据刷新保留；不可折叠时恒空） */
  private readonly collapsedKeys = new Set<string>()
  /** 展平数据行序列（不含表头伪行；结构或折叠态变更整体重算） */
  private rowList: PivotRow[] = []
  /** 列序列（行维度列 + 数据列；结构变更整体重算） */
  private columnList: PivotColumn[] = []
  /** 表头行数（列维度层数 + 度量行；引擎冻结行数） */
  private headerRows = 1
  /** 聚合矩阵：数据行 index → 数据列 index → 聚合值（不含表头行） */
  private matrix: (number | undefined)[][] = []
  /** 合并区（引擎坐标，含表头行偏移；结构变更整体重算） */
  private mergeList: CellRange[] = []
  /** 阶段 1 产物：列维度叶子路径（码点序）及其对应的累加槽 rawColId */
  private colLeaves: string[][] = [[]]
  private colLeafRawIds: number[] = [0]
  /** 阶段 1 产物：内存行维度树虚拟根节点（其累加槽即 grandTotals） */
  private rootNode: PivotTreeNode = {
    key: '',
    path: [],
    depth: -1,
    label: '',
    children: [],
    branchKey: null,
    accumulators: new Map(),
  }
  /** 阶段 1 产物：全树可折叠 branch 节点键集合（无视当前折叠态） */
  private branchKeys = new Set<string>()

  constructor(options: {
    dimensions: readonly PivotDimension[]
    measures: readonly PivotMeasure[]
    records: readonly PivotRecord[]
    rowDimensions?: readonly string[]
    columnDimensions?: readonly string[]
    activeMeasures?: readonly string[]
    showGrandTotal?: boolean
    collapsible?: boolean
  }) {
    // 池拷贝自有：updateMeasure 原地改聚合不污染调用方配置对象
    this.dimensionPool = options.dimensions.map((dimension) => ({ ...dimension }))
    this.measurePool = options.measures.map((measure) => ({ ...measure }))
    this.records = options.records
    this.rowDimKeys = dedupe(
      options.rowDimensions ?? this.dimensionPool.map((dimension) => dimension.key),
    )
    this.columnDimKeys = dedupe(options.columnDimensions ?? [])
    this.measureKeys = dedupe(
      options.activeMeasures ?? this.measurePool.map((measure) => measure.key),
    )
    this.showGrandTotalEnabled = options.showGrandTotal ?? true
    this.collapsibleEnabled = options.collapsible ?? true
    this.rebuildDataTree()
    this.materializeView()
  }

  // ---- TableModel 数据面（引擎经 ListTableOptions.model 直挂消费；只读模型） ----
  // 行坐标是引擎坐标：前 headerRowCount 行为表头伪行（冻结带），其下才是数据行。

  get rowCount(): number {
    return this.headerRows + this.rowList.length
  }

  getCellValue(col: number, row: number): unknown {
    const column = this.columnList[col]
    if (!column || row < 0 || row >= this.rowCount) return undefined
    if (row < this.headerRows) {
      if (column.kind === 'row-header') {
        // 表头区行维度列：按维度分列的标题竖条（整列合并到首行主格，被覆盖格出空）
        return row === 0 ? column.title : ''
      }
      // 列维度层取该层路径值，末行为度量标题
      return row < this.columnDimKeys.length ? (column.colPath[row] ?? '') : column.measure.title
    }
    const index = row - this.headerRows
    const pivotRow = this.rowList[index]
    if (!pivotRow) return undefined
    if (column.kind === 'row-header') {
      if (pivotRow.type === 'grand') return col === 0 ? '总计' : ''
      return pivotRow.path[col] ?? ''
    }
    return this.matrix[index]?.[col - this.rowHeaderCount]
  }

  onCellChange(_listener: (change: CellChangeEvent) => void): () => void {
    // 透视表交叉格为聚合值，模型只读不回写
    return () => {}
  }

  // ---- 结构查询 ----

  /** 展平数据行序列快照（不含表头伪行；行类型/路径判定的依据） */
  get rows(): readonly PivotRow[] {
    return this.rowList
  }

  /** 列序列快照（行维度列与数据列的当前形态） */
  get columns(): readonly PivotColumn[] {
    return this.columnList
  }

  /** 行头列数（多列树形布局 = 当前行维度数；引擎冻结列数） */
  get rowHeaderCount(): number {
    return this.rowDimKeys.length
  }

  /** 表头行数（列维度层数 + 度量行；引擎冻结行数） */
  get headerRowCount(): number {
    return this.headerRows
  }

  /** 是否显示总计行 */
  get showGrandTotal(): boolean {
    return this.showGrandTotalEnabled
  }

  /**
   * 切换总计行显示：仅重算阶段 2 物化行矩阵与合并区，不清空折叠态、零记录扫描。
   * 状态变化返回 true，由 PivotGrid 落地引擎几何。
   */
  setShowGrandTotal(enabled: boolean): boolean {
    if (enabled === this.showGrandTotalEnabled) return false
    this.showGrandTotalEnabled = enabled
    this.materializeView()
    return true
  }

  /** 行维度树是否可折叠（false 时始终平铺展开） */
  get collapsible(): boolean {
    return this.collapsibleEnabled
  }

  /**
   * 切换可折叠配置：关闭时既有折叠态清空（整树平铺）并重算；开启时从平铺态起步。
   * 结构变化返回 true，由 PivotGrid 落地引擎几何。
   */
  setCollapsible(enabled: boolean): boolean {
    if (enabled === this.collapsibleEnabled) return false
    this.collapsibleEnabled = enabled
    if (!enabled) this.collapsedKeys.clear()
    this.materializeView()
    return true
  }

  /** 数据列数（列维度叶子路径数 × 度量数；无列维度为度量直排） */
  get dataColumnCount(): number {
    return this.columnList.length - this.rowHeaderCount
  }

  /** branch 行数（折叠组载体行，不含总计） */
  get branchRowCount(): number {
    return this.rowList.filter((row) => row.type === 'branch').length
  }

  /** 记录总数 */
  get recordCount(): number {
    return this.records.length
  }

  /** 合并区快照（引擎坐标：角落区 / 表头列维度层 / 行组跨行 / 载体与总计横并） */
  get mergeRanges(): readonly CellRange[] {
    return this.mergeList
  }

  /** 维度池快照（浅拷贝防外改） */
  get dimensions(): readonly PivotDimension[] {
    return this.dimensionPool.map((dimension) => ({ ...dimension }))
  }

  /** 度量池快照（浅拷贝防外改） */
  get measures(): readonly PivotMeasure[] {
    return this.measurePool.map((measure) => ({ ...measure }))
  }

  /** 当前行维度序列（调用方顺序即树层级序） */
  get activeRowDimensions(): readonly PivotDimension[] {
    return this.rowDimKeys
      .map((key) => this.dimensionPool.find((dimension) => dimension.key === key))
      .filter((dimension): dimension is PivotDimension => dimension !== undefined)
  }

  /** 当前列维度序列（调用方顺序即表头层级序；空序列列方向不挂维度） */
  get activeColumnDimensions(): readonly PivotDimension[] {
    return this.columnDimKeys
      .map((key) => this.dimensionPool.find((dimension) => dimension.key === key))
      .filter((dimension): dimension is PivotDimension => dimension !== undefined)
  }

  /** 当前度量序列（调用方顺序） */
  get activeMeasures(): readonly PivotMeasure[] {
    return this.measureKeys
      .map((key) => this.measurePool.find((measure) => measure.key === key))
      .filter((measure): measure is PivotMeasure => measure !== undefined)
  }

  /** 列宽（行维度列取维度宽；数据列取度量宽；PivotGrid 落地 setColWidth 用） */
  getColumnWidth(col: number): number | undefined {
    const column = this.columnList[col]
    if (!column) return undefined
    return column.kind === 'row-header' ? column.width : column.measure.width
  }

  /** 交叉格明细：该格聚合所覆盖的原始记录（branch 取前缀路径全体，leaf 取全路径匹配） */
  getCellRecords(col: number, row: number): readonly PivotRecord[] {
    const column = this.columnList[col]
    if (!column || row < this.headerRows || row >= this.rowCount) return []
    const pivotRow = this.rowList[row - this.headerRows]
    if (!pivotRow) return []
    const bucket = this.recordsFor(pivotRow)
    if (column.kind !== 'measure') return bucket
    const colDims = this.activeColumnDimensions
    if (colDims.length === 0) return bucket
    return bucket.filter((record) =>
      column.colPath.every((value, level) => dimensionValue(record[colDims[level]!.key]) === value),
    )
  }

  /**
   * 组在可见行中的连续区块（引擎坐标）：路径前缀匹配的全部可见行（含折叠载体
   * 自身）。组块即「该组所有层级的维度数据」的选区几何；树上无此组返回 null。
   */
  groupRange(path: readonly string[]): { startRow: number; endRow: number } | null {
    let start = -1
    let end = -1
    for (let index = 0; index < this.rowList.length; index++) {
      const row = this.rowList[index]
      if (row === undefined || row.path.length < path.length) continue
      if (!path.every((value, depth) => row.path[depth] === value)) continue
      if (start < 0) start = index
      end = index
    }
    if (start < 0) return null
    return { startRow: start + this.headerRows, endRow: end + this.headerRows }
  }

  /**
   * 表头格的列组区间（引擎坐标）：列维度层取该层同前缀连续数据列的合并跨度
   * （单列组无合并区，回落单列），度量标题行恒单列；行维度列（标题竖条）与
   * 非表头行返回 null。列头点击高亮的几何源。
   */
  headerColumnRange(col: number, row: number): { startCol: number; endCol: number } | null {
    if (row < 0 || row >= this.headerRows || col < this.rowHeaderCount) return null
    const merge = this.mergeList.find(
      (range) =>
        range.startRow === row &&
        range.endRow === row &&
        range.startCol >= this.rowHeaderCount &&
        col >= range.startCol &&
        col <= range.endCol,
    )
    return merge
      ? { startCol: merge.startCol, endCol: merge.endCol }
      : { startCol: col, endCol: col }
  }

  // ---- 领域操作（结构变化返回 true，由 PivotGrid 落地引擎几何） ----

  /** 勾选行维度序列（按调用方顺序生效：序列位置即树层级；至少一个） */
  setRowDimensions(keys: readonly string[]): boolean {
    const next = dedupe(keys.filter((key) => this.dimensionPool.some((dim) => dim.key === key)))
    if (next.length === 0 || sameList(next, this.rowDimKeys)) return false
    this.rowDimKeys = next
    this.collapsedKeys.clear()
    this.rebuildDataTree()
    this.materializeView()
    return true
  }

  /** 勾选列维度序列（按调用方顺序生效：序列位置即表头层级序；空序列度量直排） */
  setColumnDimensions(keys: readonly string[]): boolean {
    const next = dedupe(keys.filter((key) => this.dimensionPool.some((dim) => dim.key === key)))
    if (sameList(next, this.columnDimKeys)) return false
    this.columnDimKeys = next
    this.collapsedKeys.clear()
    this.rebuildDataTree()
    this.materializeView()
    return true
  }

  /** 勾选度量序列（按调用方顺序生效：序列位置即数据列分组序；至少一个） */
  setMeasures(keys: readonly string[]): boolean {
    const next = dedupe(
      keys.filter((key) => this.measurePool.some((measure) => measure.key === key)),
    )
    if (next.length === 0 || sameList(next, this.measureKeys)) return false
    this.measureKeys = next
    this.collapsedKeys.clear()
    this.rebuildDataTree()
    this.materializeView()
    return true
  }

  /** 更高度量定义（聚合方式 / 标题 / 列宽；仅显示属性变化时不重扫记录） */
  updateMeasure(
    key: string,
    patch: Partial<Pick<PivotMeasure, 'agg' | 'title' | 'width'>>,
  ): boolean {
    const measure = this.measurePool.find((entry) => entry.key === key)
    if (!measure) return false
    const aggChanged = patch.agg !== undefined && patch.agg !== measure.agg
    const titleChanged = patch.title !== undefined && patch.title !== measure.title
    const widthChanged = patch.width !== undefined && patch.width !== measure.width
    if (!aggChanged && !titleChanged && !widthChanged) {
      return false
    }
    if (aggChanged) measure.agg = patch.agg!
    if (titleChanged) measure.title = patch.title!
    if (widthChanged) measure.width = patch.width!
    if (this.measureKeys.includes(key)) {
      if (aggChanged) {
        this.rebuildDataTree()
        this.materializeView()
      } else {
        // 仅标题或列宽等显示属性变更：刷新列描述，零记录重扫
        this.rebuildColumns()
      }
    }
    return true
  }

  setRecords(records: readonly PivotRecord[]): boolean {
    this.records = records
    this.rebuildDataTree()
    this.materializeView()
    return true
  }

  /** 原地替换维度池：保留仍存在的行/列维度顺序；行维度全失效时回落池首项 */
  setDimensions(dimensions: readonly PivotDimension[]): boolean {
    this.dimensionPool = dimensions.map((dimension) => ({ ...dimension }))
    const validKeys = new Set(this.dimensionPool.map((dimension) => dimension.key))
    const nextRows = this.rowDimKeys.filter((key) => validKeys.has(key))
    if (nextRows.length === 0 && this.dimensionPool.length > 0) {
      nextRows.push(this.dimensionPool[0]!.key)
    }
    this.rowDimKeys = nextRows
    this.columnDimKeys = this.columnDimKeys.filter((key) => validKeys.has(key))
    this.collapsedKeys.clear()
    this.rebuildDataTree()
    this.materializeView()
    return true
  }

  /** 原地替换度量池：保留仍存在的激活度量顺序；全失效时回落池首项 */
  setMeasurePool(measures: readonly PivotMeasure[]): boolean {
    this.measurePool = measures.map((measure) => ({ ...measure }))
    const validKeys = new Set(this.measurePool.map((measure) => measure.key))
    const nextMeasures = this.measureKeys.filter((key) => validKeys.has(key))
    if (nextMeasures.length === 0 && this.measurePool.length > 0) {
      nextMeasures.push(this.measurePool[0]!.key)
    }
    this.measureKeys = nextMeasures
    this.collapsedKeys.clear()
    this.rebuildDataTree()
    this.materializeView()
    return true
  }

  // ---- 行维度树展开/折叠（多列树形布局的模型面） ----

  /**
   * 切换 branch 节点展开态：展开时组格跨行合并且无自有行，折叠时收敛为单行
   * 载体（聚合值可见）。不可折叠时恒拒绝。只对树上存在且当前可见的节点生效
   * ——被折叠祖先隐藏的节点返回 false。阶段 2 物化 O(可见行数)，零记录扫描。
   */
  toggleNode(path: readonly string[]): boolean {
    if (!this.collapsibleEnabled) return false
    const key = path.join(NODE_KEY_SEP)
    if (!this.branchKeys.has(key)) return false
    for (let depth = 1; depth < path.length; depth++) {
      if (this.collapsedKeys.has(path.slice(0, depth).join(NODE_KEY_SEP))) return false
    }
    if (this.collapsedKeys.has(key)) {
      this.collapsedKeys.delete(key)
    } else {
      this.collapsedKeys.add(key)
    }
    this.materializeView()
    return true
  }

  /** 全部展开（阶段 2 物化，零记录扫描） */
  expandAll(): boolean {
    if (this.collapsedKeys.size === 0) return false
    this.collapsedKeys.clear()
    this.materializeView()
    return true
  }

  /** 全部收起：所有 branch（含嵌套）置为折叠，整树收拢到一级；不可折叠时恒拒绝 */
  collapseAll(): boolean {
    if (!this.collapsibleEnabled) return false
    let changed = false
    for (const key of this.branchKeys) {
      if (!this.collapsedKeys.has(key)) {
        this.collapsedKeys.add(key)
        changed = true
      }
    }
    if (!changed) return false
    this.materializeView()
    return true
  }

  // ---- 内部：两阶段重算 ----

  /**
   * 阶段 1：单遍扫描 this.records 构建列维度叶子路径、行维度树与预聚合累加槽
   * （含 grandTotals 虚拟根节点）及全树可折叠 branch 键集合。仅在记录或结构/聚合
   * 定义变更时调用。
   */
  private rebuildDataTree(): void {
    const rowDims = this.activeRowDimensions
    const colDims = this.activeColumnDimensions
    const measures = this.activeMeasures
    const measureCount = measures.length

    // 表头行数：列维度逐层一行 + 度量标题行（无列维度仅度量行）
    this.headerRows = colDims.length + 1

    const root: BuildTreeNode = {
      key: '',
      path: [],
      depth: -1,
      label: '',
      children: [],
      branchKey: null,
      accumulators: new Map(),
      childrenMap: new Map(),
    }

    const colRoot: ColTrieNode = { children: new Map(), rawId: -1 }
    let nextRawColId = 0

    for (let i = 0; i < this.records.length; i++) {
      const record = this.records[i]!

      let rawColId = 0
      if (colDims.length > 0) {
        let colNode = colRoot
        for (let level = 0; level < colDims.length; level++) {
          const val = dimensionValue(record[colDims[level]!.key])
          let child = colNode.children.get(val)
          if (!child) {
            child = { children: new Map(), rawId: -1 }
            colNode.children.set(val, child)
          }
          colNode = child
        }
        if (colNode.rawId < 0) {
          colNode.rawId = nextRawColId++
        }
        rawColId = colNode.rawId
      }

      let rowNode = root
      for (let depth = 0; depth < rowDims.length; depth++) {
        const val = dimensionValue(record[rowDims[depth]!.key])
        let child = rowNode.childrenMap.get(val)
        if (!child) {
          const childPath = depth === 0 ? [val] : [...rowNode.path, val]
          const key = childPath.join(NODE_KEY_SEP)
          child = {
            key,
            path: childPath,
            depth,
            label: val,
            children: [],
            branchKey: depth < rowDims.length - 1 ? key : null,
            accumulators: new Map(),
            childrenMap: new Map(),
          }
          rowNode.childrenMap.set(val, child)
        }
        rowNode = child
      }

      let slot = rowNode.accumulators.get(rawColId)
      if (!slot) {
        slot = createAccumulatorSlot(measureCount)
        rowNode.accumulators.set(rawColId, slot)
      }
      accumulateRecord(slot, record, measures)
    }

    if (colDims.length === 0) {
      this.colLeaves = [[]]
      this.colLeafRawIds = [0]
    } else {
      const leaves: string[][] = []
      const rawIds: number[] = []
      collectSortedColLeaves(colRoot, [], leaves, rawIds)
      this.colLeaves = leaves
      this.colLeafRawIds = rawIds
    }

    const branchKeys = new Set<string>()
    finalizeTreeNode(root, measureCount, branchKeys)
    this.rootNode = root
    this.branchKeys = branchKeys

    this.rebuildColumns()
  }

  /** 根据已构建的列叶子路径与当前度量定义刷新列序列（纯列结构投影，零记录扫描） */
  private rebuildColumns(): void {
    const rowDims = this.activeRowDimensions
    const measures = this.activeMeasures
    const columns: PivotColumn[] = rowDims.map((dimension) => ({
      kind: 'row-header',
      title: dimension.title,
      width: dimension.width,
    }))
    for (const colPath of this.colLeaves) {
      for (const measure of measures) {
        columns.push({ kind: 'measure', colPath, measure })
      }
    }
    this.columnList = columns
  }

  /**
   * 阶段 2：按当前折叠态与 collapsible 配置 DFS 遍历内存行维度树，在 O(可见行数)
   * 内物化 rowList、matrix（直接读取预聚合累加槽）与 mergeList；全程零访问 this.records。
   */
  private materializeView(): void {
    const leafDepth = this.activeRowDimensions.length - 1
    const measures = this.activeMeasures
    const colLeafRawIds = this.colLeafRawIds
    const rows: PivotRow[] = []
    const matrix: (number | undefined)[][] = []

    const visit = (node: PivotTreeNode): void => {
      if (node.depth === leafDepth) {
        rows.push({
          type: 'leaf',
          path: node.path,
          depth: node.depth,
          expanded: true,
          hasChildren: false,
        })
        matrix.push(materializeRowValues(node, colLeafRawIds, measures))
        return
      }
      const collapsed =
        this.collapsibleEnabled && node.branchKey !== null && this.collapsedKeys.has(node.branchKey)
      if (collapsed) {
        rows.push({
          type: 'branch',
          path: node.path,
          depth: node.depth,
          expanded: false,
          hasChildren: true,
        })
        matrix.push(materializeRowValues(node, colLeafRawIds, measures))
        return
      }
      for (const child of node.children) {
        visit(child)
      }
    }

    for (const child of this.rootNode.children) {
      visit(child)
    }

    if (this.showGrandTotalEnabled) {
      rows.push({ type: 'grand', path: [], depth: -1, expanded: true, hasChildren: false })
      matrix.push(materializeRowValues(this.rootNode, colLeafRawIds, measures))
    }

    this.rowList = rows
    this.matrix = matrix
    this.mergeList = this.computeMerges()
  }

  /**
   * 合并区计算（引擎坐标）：① 表头区行维度列标题竖条（按维度分列，整列合并到
   * 首行主格）；② 表头列维度层（同层前缀的连续数据列横并；度量行不并）；③ 行侧
   * 维度列（同前缀连续数据行跨行合并，单行组无区间）；④ 折叠载体行与总计行的
   * 行头横并（收敛为一块宽格）。各区间按构造不相交。
   */
  private computeMerges(): CellRange[] {
    const ranges: CellRange[] = []
    const headerRows = this.headerRows
    const rowCount = this.rowHeaderCount
    const columns = this.columnList
    const rows = this.rowList

    if (headerRows > 1) {
      for (let col = 0; col < rowCount; col++) {
        ranges.push({ startCol: col, endCol: col, startRow: 0, endRow: headerRows - 1 })
      }
    }

    for (let level = 0; level < this.columnDimKeys.length; level++) {
      let start = rowCount
      for (let col = rowCount + 1; col <= columns.length; col++) {
        const prev = columns[col - 1]
        const current = columns[col]
        const sameGroup =
          prev?.kind === 'measure' &&
          current?.kind === 'measure' &&
          samePathPrefix(prev.colPath, current.colPath, level + 1)
        if (!sameGroup) {
          if (col - 1 > start) {
            ranges.push({ startCol: start, endCol: col - 1, startRow: level, endRow: level })
          }
          start = col
        }
      }
    }

    for (let depth = 0; depth < rowCount - 1; depth++) {
      let start = -1
      let startPivotRow: PivotRow | undefined
      for (let index = 0; index <= rows.length; index++) {
        const current = rows[index]
        const hasDepth = current !== undefined && current.path.length > depth
        const sameGroup =
          hasDepth &&
          startPivotRow !== undefined &&
          samePathPrefix(startPivotRow.path, current.path, depth + 1)
        if (sameGroup) continue
        if (start >= 0 && index - 1 > start) {
          ranges.push({
            startCol: depth,
            endCol: depth,
            startRow: start + headerRows,
            endRow: index - 1 + headerRows,
          })
        }
        start = hasDepth ? index : -1
        startPivotRow = hasDepth ? current : undefined
      }
    }

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      if (!row) continue
      const engineRow = index + headerRows
      if (row.type === 'grand' && rowCount > 1) {
        ranges.push({ startCol: 0, endCol: rowCount - 1, startRow: engineRow, endRow: engineRow })
      } else if (row.type === 'branch' && row.path.length < rowCount) {
        ranges.push({
          startCol: row.path.length - 1,
          endCol: rowCount - 1,
          startRow: engineRow,
          endRow: engineRow,
        })
      }
    }

    return ranges
  }

  /** 行 → 参与聚合的记录集（仅 getCellRecords 下钻按需调用，构建与物化阶段不触发） */
  private recordsFor(row: PivotRow): readonly PivotRecord[] {
    if (row.type === 'grand') return this.records
    const rowDims = this.activeRowDimensions
    return this.records.filter((record) =>
      rowDims.every(
        (dim, depth) =>
          depth >= row.path.length || dimensionValue(record[dim.key]) === row.path[depth],
      ),
    )
  }
}
