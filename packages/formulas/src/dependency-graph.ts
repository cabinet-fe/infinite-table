// 公式依赖图：公式格 → 静态引用（单格 / 区域）的反向索引，支撑变更扩散（标脏）。
//
// 结构取舍：
// - 单格依赖两级 Map（sheet → 'col,row' → 公式格 key 集合），点查 O(1)。
// - 区域依赖按表存条目集，点查线性扫该表全部区域条目：区域条目数 ≈ 含区域引用的公式数，
//   千级公式下开销可忽略；不为臆测的「百万区域」需求上区间树（过度泛化）。
// - 公式格 key 用「长度前缀 + sheet」编码：sheet 名可含任意字符（含分隔符本身），
//   长度前缀保证无歧义，无需转义表。

/** 带规范 sheet id 的格坐标（sheet 由宿主解析归一；0 基 col/row） */
export interface SheetCellCoord {
  sheet: string
  col: number
  row: number
}

/** 带规范 sheet id 的区域坐标（闭区间，start ≤ end） */
export interface SheetRangeCoord {
  sheet: string
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}

/** 公式格的静态依赖条目 */
export type FormulaRefCoord =
  | { kind: 'cell'; ref: SheetCellCoord }
  | { kind: 'range'; ref: SheetRangeCoord }

/** 区域反向索引条目：owner = 持有该依赖的公式格 key */
interface RangeEntry {
  range: SheetRangeCoord
  owner: string
}

/** 公式格 key：长度前缀编码 sheet，任意 sheet 名无歧义 */
function keyOf(coord: SheetCellCoord): string {
  return `${coord.sheet.length}#${coord.sheet}|${coord.col},${coord.row}`
}

/** 依赖条目去重 key（完全相同才算重；cell 与 range 重叠不合并） */
function refKey(ref: FormulaRefCoord): string {
  if (ref.kind === 'cell') {
    const { sheet, col, row } = ref.ref
    return `c|${sheet.length}#${sheet}|${col},${row}`
  }
  const { sheet, startCol, startRow, endCol, endRow } = ref.ref
  return `r|${sheet.length}#${sheet}|${startCol},${startRow}:${endCol},${endRow}`
}

function sameRange(a: SheetRangeCoord, b: SheetRangeCoord): boolean {
  return (
    a.sheet === b.sheet &&
    a.startCol === b.startCol &&
    a.startRow === b.startRow &&
    a.endCol === b.endCol &&
    a.endRow === b.endRow
  )
}

function contains(range: SheetRangeCoord, coord: SheetCellCoord): boolean {
  return (
    coord.col >= range.startCol &&
    coord.col <= range.endCol &&
    coord.row >= range.startRow &&
    coord.row <= range.endRow
  )
}

export class DependencyGraph {
  /** 全部公式格：key → 坐标（size/has/易失快照的回查源） */
  private readonly formulas = new Map<string, SheetCellCoord>()
  /** 公式格 key → 其依赖条目（remove 时按此清反向索引） */
  private readonly deps = new Map<string, FormulaRefCoord[]>()
  /** 单格反向索引：sheet → 'col,row' → 依赖该格的公式格 key 集 */
  private readonly cellIndex = new Map<string, Map<string, Set<string>>>()
  /** 区域反向索引：sheet → 区域条目集 */
  private readonly rangeIndex = new Map<string, Set<RangeEntry>>()
  /** 易失公式格 key 集 */
  private readonly volatileKeys = new Set<string>()

  /**
   * 注册/更新公式格的静态依赖（全量替换该格旧边）。
   * refs 的 sheet 必须已被宿主解析为规范 id（裸引用由宿主填公式所在表）。
   * volatile 公式记入易失集。
   */
  setFormula(
    cell: SheetCellCoord,
    refs: readonly FormulaRefCoord[],
    options?: { volatile?: boolean },
  ): void {
    const key = keyOf(cell)
    // 全量替换：先清旧边再建新边
    this.remove(cell)
    const unique: FormulaRefCoord[] = []
    const seen = new Set<string>()
    for (const ref of refs) {
      const dedupeKey = refKey(ref)
      if (seen.has(dedupeKey)) {
        continue
      }
      seen.add(dedupeKey)
      unique.push(ref)
    }
    this.formulas.set(key, { ...cell })
    this.deps.set(key, unique)
    for (const ref of unique) {
      if (ref.kind === 'cell') {
        let sheetMap = this.cellIndex.get(ref.ref.sheet)
        if (!sheetMap) {
          sheetMap = new Map()
          this.cellIndex.set(ref.ref.sheet, sheetMap)
        }
        const cellKey = `${ref.ref.col},${ref.ref.row}`
        let owners = sheetMap.get(cellKey)
        if (!owners) {
          owners = new Set()
          sheetMap.set(cellKey, owners)
        }
        owners.add(key)
      } else {
        let entries = this.rangeIndex.get(ref.ref.sheet)
        if (!entries) {
          entries = new Set()
          this.rangeIndex.set(ref.ref.sheet, entries)
        }
        entries.add({ range: { ...ref.ref }, owner: key })
      }
    }
    if (options?.volatile) {
      this.volatileKeys.add(key)
    }
  }

  /** 移除公式格（被覆盖为字面量/清空）；非公式格为空操作 */
  remove(cell: SheetCellCoord): void {
    const key = keyOf(cell)
    const refs = this.deps.get(key)
    if (!refs) {
      return
    }
    for (const ref of refs) {
      if (ref.kind === 'cell') {
        const sheetMap = this.cellIndex.get(ref.ref.sheet)
        const owners = sheetMap?.get(`${ref.ref.col},${ref.ref.row}`)
        owners?.delete(key)
        if (owners && owners.size === 0) {
          sheetMap!.delete(`${ref.ref.col},${ref.ref.row}`)
        }
        if (sheetMap && sheetMap.size === 0) {
          this.cellIndex.delete(ref.ref.sheet)
        }
      } else {
        const entries = this.rangeIndex.get(ref.ref.sheet)
        if (entries) {
          for (const entry of entries) {
            if (entry.owner === key && sameRange(entry.range, ref.ref)) {
              entries.delete(entry)
              break
            }
          }
          if (entries.size === 0) {
            this.rangeIndex.delete(ref.ref.sheet)
          }
        }
      }
    }
    this.deps.delete(key)
    this.formulas.delete(key)
    this.volatileKeys.delete(key)
  }

  /**
   * 移除整表：该表全部公式格（连出向边）+ 其它表公式指向该表的边。
   * 指向被删表的边选择清除而非保留：表没了依赖无意义，重建同名表也是另一张表。
   * 清除后依赖该表的公式格不再出现于 affectedBy——由宿主在删表时整表处理缓存。
   */
  removeSheet(sheet: string): void {
    // Map 迭代中删除当前已访问键是安全的（remove 只删当前 coord 自己的键）
    for (const coord of this.formulas.values()) {
      if (coord.sheet === sheet) {
        this.remove(coord)
      }
    }
    this.cellIndex.delete(sheet)
    this.rangeIndex.delete(sheet)
  }

  /**
   * 变更传递闭包：直接或间接依赖 changed 中任一格的公式格（去重）。
   * 循环时环上格也会出现（含 changed 自身若在环上）。
   */
  affectedBy(changed: Iterable<SheetCellCoord>): SheetCellCoord[] {
    const result = new Map<string, SheetCellCoord>()
    const visited = new Set<string>()
    const queue: SheetCellCoord[] = [...changed]
    while (queue.length > 0) {
      const coord = queue.shift()!
      const coordKey = keyOf(coord)
      if (visited.has(coordKey)) {
        continue
      }
      visited.add(coordKey)
      // 单格依赖点查 + 区域依赖线性扫（条目数 ≈ 公式数，见文件头取舍说明）
      const owners = new Set<string>(
        this.cellIndex.get(coord.sheet)?.get(`${coord.col},${coord.row}`),
      )
      const entries = this.rangeIndex.get(coord.sheet)
      if (entries) {
        for (const entry of entries) {
          if (contains(entry.range, coord)) {
            owners.add(entry.owner)
          }
        }
      }
      for (const owner of owners) {
        if (result.has(owner)) {
          continue
        }
        const formulaCoord = this.formulas.get(owner)
        if (!formulaCoord) {
          continue
        }
        result.set(owner, formulaCoord)
        // 公式格自身也是格坐标：可能被其它公式引用，继续扩散
        queue.push(formulaCoord)
      }
    }
    return [...result.values()]
  }

  /** 易失公式格快照（宿主在任意变更后把它们标脏） */
  volatileCells(): SheetCellCoord[] {
    const cells: SheetCellCoord[] = []
    for (const key of this.volatileKeys) {
      const coord = this.formulas.get(key)
      if (coord) {
        cells.push({ ...coord })
      }
    }
    return cells
  }

  has(cell: SheetCellCoord): boolean {
    return this.formulas.has(keyOf(cell))
  }

  get size(): number {
    return this.formulas.size
  }
}
