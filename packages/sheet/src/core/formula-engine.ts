// 公式引擎门面：sheet 模型对 @infinitable/formulas 的唯一消费层。
//
// 组合而非重建：依赖索引（单格/区域反向索引、传递闭包、易失集）用 formulas 的
// DependencyGraph，AST 求值用 formulas 的 evaluate；本层只做图簿联动编排——
// sheet 注册表、改名别名链、标脏闭包（affectedBy + volatileCells）与递归求值
// 驱动（拓扑序 + memo + 在途环检测 #CYCLE!）。
//
// 图状态与单元格存储严格同步：所有 f 变更（命令/undo/redo/rollback 回放）都经
// Sheet.applyPatch → syncCell 维护节点；重算只发生在命令执行后（Sheet.executeCommand），
// undo/redo 靠派生补丁精确回放缓存值，不重算。

import {
  DependencyGraph,
  FormulaParseError,
  astHasVolatileCall,
  collectAstReferences,
  evaluate,
  formulaError,
  isFormulaError,
  isFormulaErrorCode,
  parseFormula,
  type FormulaError,
  type FormulaRefCoord,
  type FormulaResolver,
  type ScalarValue,
  type SheetCellCoord,
} from '@infinitable/formulas'

import type { CellAddress, CellRange } from './address'
import type { CellData, CellSnapshotItem, CellType, CellValue } from './cell-store'
import type { CellPatch } from './command/types'
import type { Sheet } from './sheet'

/** allNodes 迭代视图（公式格坐标；公式原文以 store 为准） */
export interface FormulaNodeView {
  readonly sheetName: string
  readonly addr: CellAddress
}

/** 格坐标键（长度前缀编码 sheet 名，任意表名无歧义；与 formulas 图同编码方案） */
function keyOf(coord: SheetCellCoord): string {
  return `${coord.sheet.length}#${coord.sheet}|${coord.col},${coord.row}`
}

/** 单元格存储 → 求值标量（t='e' 还原为错误标记；空 → null） */
function cellDataToScalar(data: CellData | undefined): ScalarValue | FormulaError {
  if (!data || data.v == null) return null
  if (data.t === 'e') {
    return formulaError(isFormulaErrorCode(data.v) ? data.v : '#ERROR!')
  }
  return data.v
}

/** 求值结果 → 存储形态（公式字符串结果 t='str'，与输入文本的 's' 区分） */
function serializeResult(value: ScalarValue | FormulaError): { v: CellValue; t: CellType } {
  if (isFormulaError(value)) return { v: value.code, t: 'e' }
  if (value === null) return { v: 0, t: 'n' } // 防御：公式结果不会是 null
  switch (typeof value) {
    case 'number':
      return { v: value, t: 'n' }
    case 'boolean':
      return { v: value, t: 'b' }
    default:
      return { v: value, t: 'str' }
  }
}

export class FormulaEngine {
  private readonly sheets = new Map<string, Sheet>()
  /** 表改名后的旧名 → 新名别名（求值解析层：AST 仍引用旧名，经别名解析到新名；
   *  公式文本不重写，与「引用跟随改名」语义一致；删除时随表清理） */
  private readonly aliases = new Map<string, string>()
  /** 依赖索引与标脏闭包（formulas 的图；本层不建第二套索引） */
  private readonly graph = new DependencyGraph()

  // ─── sheet 注册表 ─────────────────────────────────────────

  registerSheet(sheet: Sheet): void {
    this.sheets.set(sheet.name, sheet)
  }

  /** 按当前表名查注册表（别名不在此解析；求值层 readCell/readRange 才走别名） */
  getSheet(name: string): Sheet | undefined {
    return this.sheets.get(name)
  }

  /** 公式节点总数（测试/调试用） */
  get nodeCount(): number {
    return this.graph.size
  }

  /** 遍历全部公式节点（行列平移等批量操作用）：[sheet, 节点视图] */
  *allNodes(): Generator<[Sheet, FormulaNodeView], void, undefined> {
    for (const [name, sheet] of this.sheets) {
      for (const coord of this.graph.formulasOf(name)) {
        yield [sheet, { sheetName: name, addr: { row: coord.row, col: coord.col } }]
      }
    }
  }

  /**
   * 注销 sheet 并移除其全部公式节点；随后重算所有引用该表的公式节点并返回
   * 派生补丁（未应用）——引用方立即变 #REF!（调用方负责应用补丁，不入 undo）。
   * 返回空数组 = 无引用方（或表未注册）。
   */
  unregisterSheet(sheet: Sheet): CellPatch[] {
    if (this.sheets.get(sheet.name) !== sheet) return []
    // 注销前收集引用该表的公式格（反向索引仍有效）
    const referencing = this.graph.affectedBySheet(sheet.name)
    this.sheets.delete(sheet.name)
    // 清理指向该表的全部别名（旧名引用随之失效 → #REF!，与删除语义一致）
    for (const [old, next] of this.aliases) {
      if (next === sheet.name) this.aliases.delete(old)
    }
    this.graph.removeSheet(sheet.name)
    // 引用方重算：readCell/readRange 查不到该表 → #REF!
    return this.recalcDirtyCoords(referencing)
  }

  /**
   * 表改名后的索引重排：sheet 注册表、被改名表自身公式节点、以及所有引用该表的
   * 公式节点（跨表公式引用跟随改名）全部切到新名。既有引用在改名后保持有效；
   * AST 中的旧名经别名链解析。必须在 Sheet.setName 之后调用。
   */
  renameSheet(oldName: string, newName: string): void {
    const sheet = this.sheets.get(oldName)
    if (!sheet) return
    // 1. 收集受影响节点：被改名表自身的公式节点 + 所有引用该表的节点（去重）
    const affected = new Map<string, SheetCellCoord>()
    for (const coord of this.graph.formulasOf(oldName)) affected.set(keyOf(coord), coord)
    for (const coord of this.graph.affectedBySheet(oldName)) affected.set(keyOf(coord), coord)
    // 2. 公式原文从各自存储读取（改名不动存储），先全部移出索引
    const records: Array<{ coord: SheetCellCoord; formula: string }> = []
    for (const coord of affected.values()) {
      const owner = this.sheets.get(coord.sheet)
      const formula = owner?.store.getCell({ row: coord.row, col: coord.col })?.f
      if (formula) records.push({ coord, formula })
    }
    for (const coord of affected.values()) this.graph.remove(coord)
    // 3. 更新 sheet 注册表 + 别名（求值层：AST 旧名引用经别名解析到新名）
    this.sheets.delete(oldName)
    this.sheets.set(newName, sheet)
    // 拍平别名链：所有指向 oldName 的条目改指 newName（连续改名 A→B→C 后引用 A 仍有效）；
    // 删除键为 newName 的残留条目（新名是真实表名，别名不得覆盖真实名——改名回改 A→B→A 场景）
    const toUpdate: Array<[string, string]> = []
    for (const [key, next] of this.aliases) {
      if (next === oldName) toUpdate.push([key, newName])
    }
    for (const [key, next] of toUpdate) this.aliases.set(key, next)
    this.aliases.delete(newName)
    this.aliases.set(oldName, newName)
    // 4. 按新名重新注册（依赖边的目标表名同步跟随改名）。
    //    公式原文里的旧名不止 oldName——别名链上任一历史名（连续改名 A→B→C 后
    //    原文仍写 A）都指向本表；拍平后它们统一 next===newName，全部折到 newName，
    //    否则边会落在已不存在的名字上
    const renameMap = new Map([[oldName, newName]])
    for (const [key, next] of this.aliases) {
      if (next === newName) renameMap.set(key, newName)
    }
    for (const { coord, formula } of records) {
      const ownerSheet = coord.sheet === oldName ? sheet : this.sheets.get(coord.sheet)
      if (!ownerSheet) continue
      this.registerFormula(
        ownerSheet,
        { sheet: renameMap.get(coord.sheet) ?? coord.sheet, col: coord.col, row: coord.row },
        formula,
        renameMap,
      )
    }
  }

  // ─── 图同步 ───────────────────────────────────────────────

  /**
   * 单元格补丁后的图同步：f 增/删/改 → 节点增/删/重建。
   * 由 Sheet.applyPatch（唯一变更通道）调用，命令与 undo/redo 回放均覆盖。
   */
  syncCell(sheet: Sheet, addr: CellAddress, before?: CellData, after?: CellData): void {
    const beforeF = before?.f
    const afterF = after?.f
    if (beforeF === afterF) return
    const coord = { sheet: sheet.name, col: addr.col, row: addr.row }
    if (afterF != null && afterF !== '') {
      this.registerFormula(sheet, coord, afterF)
    } else {
      this.graph.remove(coord)
    }
  }

  /**
   * 整表内容替换后的图重建（SnapshotPatch 应用）：移除本 sheet 全部公式节点，
   * 按快照数据重新注册公式节点——restore 不走逐格 syncCell，图必须整体重建，
   * 否则旧节点残留（引用旧公式/旧坐标）污染后续重算。
   */
  rebuildSheet(sheet: Sheet, cells: readonly CellSnapshotItem[]): void {
    for (const coord of this.graph.formulasOf(sheet.name)) this.graph.remove(coord)
    for (const item of cells) {
      if (!item.f) continue
      this.registerFormula(sheet, { sheet: sheet.name, col: item.col, row: item.row }, item.f)
    }
  }

  // ─── 增量重算 ─────────────────────────────────────────────

  /**
   * 变更集 → 标脏 + 拓扑序重算 → 派生补丁（未应用）。
   * 调用方（Sheet.executeCommand）负责应用补丁并并入同一 undo 单元。
   * 易失性语义：任意单元格变更触发的重算必刷新全部易失性公式格（无论是否依赖
   * 变更格）；值未变的格在派生补丁处跳过，不产生冗余 undo 记录。
   */
  recalc(changed: readonly { sheet: Sheet; addr: CellAddress }[]): CellPatch[] {
    if (changed.length === 0) return []
    const dirty = new Map<string, SheetCellCoord>()
    const coords: SheetCellCoord[] = []
    for (const { sheet, addr } of changed) {
      const coord = { sheet: sheet.name, col: addr.col, row: addr.row }
      coords.push(coord)
      if (this.graph.has(coord)) dirty.set(keyOf(coord), coord)
    }
    for (const coord of this.graph.affectedBy(coords)) dirty.set(keyOf(coord), coord)
    // 易失性语义：单元格变更触发的重算必刷新全部易失性公式格（无论是否依赖
    // 变更格），且刷新沿依赖图向上传播给下游公式
    const volatile = this.graph.volatileCells()
    for (const coord of volatile) dirty.set(keyOf(coord), coord)
    for (const coord of this.graph.affectedBy(volatile)) dirty.set(keyOf(coord), coord)
    return this.evaluateDirty(dirty)
  }

  /** 从指定公式格集合重算（删除 sheet 联动：引用方立即 #REF!）：源 + 其传递依赖者 */
  private recalcDirtyCoords(sources: readonly SheetCellCoord[]): CellPatch[] {
    const dirty = new Map<string, SheetCellCoord>()
    for (const coord of sources) dirty.set(keyOf(coord), coord)
    for (const coord of this.graph.affectedBy(sources)) dirty.set(keyOf(coord), coord)
    return this.evaluateDirty(dirty)
  }

  /**
   * 脏集求值：递归向下（依赖先于使用求值，memo 每格最多算一次）；
   * 在途栈遇回边 → 栈中自回边点起全部入环（#CYCLE!），环外格只传播错误。
   */
  private evaluateDirty(dirty: Map<string, SheetCellCoord>): CellPatch[] {
    if (dirty.size === 0) return []
    const dirtyKeys = new Set(dirty.keys())

    const values = new Map<string, ScalarValue | FormulaError>()
    const inProgress = new Set<string>()
    const stack: SheetCellCoord[] = []
    const cycleMembers = new Set<string>()
    const cycleError = formulaError('#CYCLE!')

    /**
     * 裸引用缺省表：lazy 函数（VLOOKUP/MATCH 等按 AST 取区域几何逐格回读）
     * 绕过求值器的 fillSheet，ref.sheet 为 undefined 到达 resolver——按当前正在
     * 求值的公式所在表路由（求值同步单线程，进出 evaluateCoord 时保存/恢复）
     */
    let defaultSheet = ''

    const evaluateCoord = (coord: SheetCellCoord): ScalarValue | FormulaError => {
      const key = keyOf(coord)
      const cached = values.get(key)
      if (cached !== undefined) return cached
      if (inProgress.has(key)) {
        const start = Math.max(
          0,
          stack.findIndex((pending) => keyOf(pending) === key),
        )
        for (let i = start; i < stack.length; i++) cycleMembers.add(keyOf(stack[i]!))
        return cycleError
      }
      inProgress.add(key)
      stack.push(coord)
      const restoreSheet = defaultSheet
      defaultSheet = coord.sheet
      let value: ScalarValue | FormulaError
      try {
        const formula = this.sheets
          .get(coord.sheet)
          ?.store.getCell({ row: coord.row, col: coord.col })?.f
        value = formula
          ? evaluate(formula, resolver, {
              sheet: coord.sheet,
              cell: { col: coord.col, row: coord.row },
            })
          : formulaError('#ERROR!')
      } catch {
        // 求值期异常（如自定义函数抛错）不应击穿重算 → 记为 #ERROR!
        value = formulaError('#ERROR!')
      } finally {
        defaultSheet = restoreSheet
        inProgress.delete(key)
        stack.pop()
      }
      if (cycleMembers.has(key)) value = cycleError
      values.set(key, value)
      return value
    }

    const resolveSheet = (name: string): Sheet | undefined => {
      const resolved = this.aliases.get(name) ?? name
      return this.sheets.get(resolved)
    }

    const resolver: FormulaResolver = {
      cell(ref) {
        const sheet = resolveSheet(ref.sheet ?? defaultSheet)
        if (!sheet) return formulaError('#REF!')
        const addr = { row: ref.row, col: ref.col }
        const coord = { sheet: sheet.name, col: ref.col, row: ref.row }
        if (dirtyKeys.has(keyOf(coord))) return evaluateCoord(coord)
        return cellDataToScalar(sheet.store.getCell(addr))
      },
      range(ref) {
        const sheet = resolveSheet(ref.sheet ?? defaultSheet)
        if (!sheet) return [formulaError('#REF!')]
        const range: CellRange = {
          start: { row: ref.startRow, col: ref.startCol },
          end: { row: ref.endRow, col: ref.endCol },
        }
        const values: unknown[] = []
        // 只迭代稀疏存在的格（空格不进数组，聚合语义由函数层决定）
        for (const [addr, data] of sheet.store.entriesInRange(range)) {
          const coord = { sheet: sheet.name, col: addr.col, row: addr.row }
          values.push(dirtyKeys.has(keyOf(coord)) ? evaluateCoord(coord) : cellDataToScalar(data))
        }
        return values
      },
    }

    for (const coord of dirty.values()) evaluateCoord(coord)

    // 派生补丁：缓存值与重算结果一致的跳过（收敛时不产生冗余变更）
    const patches: CellPatch[] = []
    for (const coord of dirty.values()) {
      const value = values.get(keyOf(coord))!
      const sheet = this.sheets.get(coord.sheet)
      if (!sheet) continue
      const addr = { row: coord.row, col: coord.col }
      const before = sheet.store.getCell(addr)
      const formula = before?.f
      if (!formula) continue
      const { v, t } = serializeResult(value)
      if (before.v === v && before.t === t) continue
      patches.push({
        kind: 'cell',
        sheet,
        addr,
        before,
        // 只写缓存值（v/t），保留既有样式（s）——重算不得丢失格式
        after: before.s != null ? { f: formula, v, t, s: before.s } : { f: formula, v, t },
      })
    }
    return patches
  }

  // ─── 内部 ─────────────────────────────────────────────────

  /** 解析公式并注册进依赖图：静态引用收集（裸引用归一到公式所在表）、易失标记 */
  private registerFormula(
    sheet: Sheet,
    coord: SheetCellCoord,
    formula: string,
    renameMap?: ReadonlyMap<string, string>,
  ): void {
    let refs: FormulaRefCoord[] = []
    let volatile = false
    try {
      const ast = parseFormula(formula)
      volatile = astHasVolatileCall(ast)
      const seen = new Set<string>()
      for (const ref of collectAstReferences(ast)) {
        const target = renameMap?.get(ref.ref.sheet ?? sheet.name) ?? ref.ref.sheet ?? sheet.name
        if (ref.kind === 'cell') {
          const dedupe = `c|${target}|${ref.ref.col},${ref.ref.row}`
          if (seen.has(dedupe)) continue
          seen.add(dedupe)
          refs.push({ kind: 'cell', ref: { sheet: target, col: ref.ref.col, row: ref.ref.row } })
        } else {
          const { startCol, startRow, endCol, endRow } = ref.ref
          const dedupe = `r|${target}|${startCol},${startRow}:${endCol},${endRow}`
          if (seen.has(dedupe)) continue
          seen.add(dedupe)
          refs.push({
            kind: 'range',
            ref: { sheet: target, startCol, startRow, endCol, endRow },
          })
        }
      }
    } catch (error) {
      if (!(error instanceof FormulaParseError)) throw error
      // 解析失败：无依赖（求值 #ERROR!），节点仍注册（变更时作为源重算）
    }
    this.graph.setFormula(coord, refs, { volatile })
  }
}
