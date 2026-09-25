// 公式求值装配：@infinite-table/formulas 引擎 + SheetBook 跨表解析 + 依赖图驱动增量重算。
// 缓存失效从「book 级版本比对」换成「DependencyGraph 脏标记」：
// setValue 的 value 事件 → notifyValueChange 更新图边 + affectedBy/volatileCells 标脏；
// 样式/几何等事件不再触碰公式缓存。易失函数（TODAY/NOW/RAND/RANDBETWEEN）按 volatile 注册，
// 任意 value 变更后随易失集标脏。循环引用仍由求值中集合护栏 → #CYCLE!。
// 不变式：「有缓存必已注册」——公式格首次求值时才 parse + 注册依赖（lazy）；
// 之后同一文本的重算直接复用图边，文本变更必经 notifyValueChange 重新注册。

import {
  astHasVolatileCall,
  collectAstReferences,
  DependencyGraph,
  evaluate,
  formulaError,
  FormulaParseError,
  isFormulaError,
  parseFormula,
  type AstNode,
  type FormulaError,
  type FormulaRefCoord,
  type FormulaResolver,
  type ScalarValue,
  type SheetCellCoord,
} from '@infinite-table/formulas'
import type { SheetStore } from '@infinite-table/plugins'

/** 求值结果（错误已转为错误码文本，可直接进 createFormulaDisplay 显示链） */
export type EvaluatedValue = number | string | boolean

/** 宿主注入面（book.ts 实现） */
export interface SheetEvaluatorHost {
  /** 表名（大小写不敏感，兼容 id 与展示名）→ 目标；未知表 null */
  resolveSheet(name: string): { id: string; store: SheetStore } | null
}

export interface SheetEvaluator {
  /** createFormulaDisplay 的 evaluate 入参：绑定指定 sheet（裸引用缺省表），按格缓存；布尔显示为 TRUE/FALSE */
  forSheet(
    sheetId: string,
    store: SheetStore,
  ): (formula: string, col: number, row: number) => string | number
  /** 直接求值（冒烟/控制台驱动面；formula 可带前导 =）；临时求值不进缓存，每次全新求值 */
  evaluateIn(sheetId: string, store: SheetStore, formula: string): EvaluatedValue
  /**
   * 值变更通知（Store value 事件驱动）：更新图边 + 标脏波及公式与易失格；
   * 返回本次被标脏的全部格坐标（含被改格自身与跨表依赖方），宿主据此通知画布重绘失效格
   */
  notifyValueChange(sheetId: string, col: number, row: number): SheetCellCoord[]
  /** 全部缓存标脏（sheet 改名等使跨表名解析面变化时用；图边以规范 id 记录，不受影响） */
  invalidateAll(): void
  /** 清除指定 sheet 的缓存与图节点（sheet 移除时用） */
  dropSheet(sheetId: string): void
}

type CellValue = ScalarValue | FormulaError

export function createSheetEvaluator(host: SheetEvaluatorHost): SheetEvaluator {
  /** 按格缓存：`sheetId:col,row` → 求值结果（脏标记驱动失效，见 dirty） */
  const cache = new Map<string, CellValue>()
  /** 脏格集：value 变更经图扩散标记；重算时清除 */
  const dirty = new Set<string>()
  /** 公式格 AST 缓存（null = 解析失败快照）；「有 AST 必已注册图边」 */
  const astCache = new Map<string, AstNode | null>()
  /** 求值中集合：循环引用护栏（重入即 #CYCLE!） */
  const inProgress = new Set<string>()
  const graph = new DependencyGraph()

  const keyOf = (sheetId: string, col: number, row: number): string => `${sheetId}:${col},${row}`

  /** 绑定 sheet 的 resolver：裸引用读本表；跨表经宿主按表名路由（未知表 → #REF!） */
  const resolverFor = (sheetId: string, store: SheetStore): FormulaResolver => ({
    cell(ref) {
      const target = ref.sheet === undefined ? { id: sheetId, store } : host.resolveSheet(ref.sheet)
      if (!target) {
        return formulaError('#REF!')
      }
      return readCellValue(target.id, target.store, ref.col, ref.row)
    },
    range(ref) {
      const target = ref.sheet === undefined ? { id: sheetId, store } : host.resolveSheet(ref.sheet)
      if (!target) {
        return [formulaError('#REF!')]
      }
      const values: unknown[] = []
      // 先行后列展开；空格不进数组（稀疏语义，对齐 ultra-ui）
      for (let row = ref.startRow; row <= ref.endRow; row++) {
        for (let col = ref.startCol; col <= ref.endCol; col++) {
          const value = readCellValue(target.id, target.store, col, row)
          if (value !== null) {
            values.push(value)
          }
        }
      }
      return values
    },
  })

  /** AST 引用 → 图边：表名归一为规范 sheet id；未知名表 → unknownSheet（调用方按 volatile 兜底） */
  const resolveRefs = (
    sheetId: string,
    ast: AstNode,
  ): { refs: FormulaRefCoord[]; unknownSheet: boolean } => {
    const refs: FormulaRefCoord[] = []
    let unknownSheet = false
    for (const item of collectAstReferences(ast)) {
      const name = item.ref.sheet
      if (name === undefined) {
        refs.push(
          item.kind === 'cell'
            ? { kind: 'cell', ref: { sheet: sheetId, col: item.ref.col, row: item.ref.row } }
            : {
                kind: 'range',
                ref: {
                  sheet: sheetId,
                  startCol: item.ref.startCol,
                  startRow: item.ref.startRow,
                  endCol: item.ref.endCol,
                  endRow: item.ref.endRow,
                },
              },
        )
        continue
      }
      const target = host.resolveSheet(name)
      if (!target) {
        // 未知名表无法建边；该表随时可能出现/改名，保守按易失注册：任意变更后重算
        unknownSheet = true
        continue
      }
      refs.push(
        item.kind === 'cell'
          ? { kind: 'cell', ref: { sheet: target.id, col: item.ref.col, row: item.ref.row } }
          : {
              kind: 'range',
              ref: {
                sheet: target.id,
                startCol: item.ref.startCol,
                startRow: item.ref.startRow,
                endCol: item.ref.endCol,
                endRow: item.ref.endRow,
              },
            },
      )
    }
    return { refs, unknownSheet }
  }

  /** 解析 + 注册公式格依赖（幂等：有 AST 缓存即已注册）；body 为不含 '=' 的公式文本 */
  const ensureRegistered = (sheetId: string, col: number, row: number, body: string): void => {
    const key = keyOf(sheetId, col, row)
    if (astCache.has(key)) {
      return
    }
    const coord: SheetCellCoord = { sheet: sheetId, col, row }
    let ast: AstNode | null = null
    try {
      ast = parseFormula(body)
    } catch (error) {
      if (!(error instanceof FormulaParseError)) {
        throw error
      }
      // 解析失败：无依赖可建，记 null 快照（求值恒为 #ERROR!）
    }
    astCache.set(key, ast)
    if (ast === null) {
      graph.remove(coord)
      return
    }
    const { refs, unknownSheet } = resolveRefs(sheetId, ast)
    graph.setFormula(coord, refs, { volatile: unknownSheet || astHasVolatileCall(ast) })
  }

  /** 公式体求值（护栏 + 缓存 + lazy 依赖注册） */
  const evaluateBody = (
    sheetId: string,
    store: SheetStore,
    col: number,
    row: number,
    body: string,
  ): CellValue => {
    const key = keyOf(sheetId, col, row)
    const cached = cache.get(key)
    if (cached !== undefined && !dirty.has(key)) {
      return cached
    }
    if (inProgress.has(key)) {
      return formulaError('#CYCLE!')
    }
    inProgress.add(key)
    let result: CellValue
    try {
      ensureRegistered(sheetId, col, row, body)
      if (astCache.get(key) === null) {
        // 解析失败快照常量（与 evaluate 的 #ERROR! 语义一致，跳过重复解析）
        result = formulaError('#ERROR!')
      } else {
        // 经 evaluate 重算（复用其归一化管线；AST 缓存服务依赖注册而非求值）
        result = evaluate(body, resolverFor(sheetId, store), { cell: { col, row } })
      }
    } finally {
      inProgress.delete(key)
    }
    cache.set(key, result)
    dirty.delete(key)
    return result
  }

  /** 读格（公式格递归求值；普通值归一后同样进缓存） */
  const readCellValue = (
    sheetId: string,
    store: SheetStore,
    col: number,
    row: number,
  ): CellValue => {
    if (col < 0 || row < 0 || col >= store.getColCount() || row >= store.getRowCount()) {
      return null
    }
    const raw = store.getValue(col, row)
    if (typeof raw === 'string' && raw.startsWith('=')) {
      return evaluateBody(sheetId, store, col, row, raw.slice(1))
    }
    const key = keyOf(sheetId, col, row)
    const cached = cache.get(key)
    if (cached !== undefined && !dirty.has(key)) {
      return cached
    }
    const result = (raw ?? null) as CellValue
    cache.set(key, result)
    dirty.delete(key)
    return result
  }

  /** 错误对象 → 错误码文本（createFormulaDisplay 显示链直出） */
  const toDisplay = (result: CellValue): EvaluatedValue => {
    if (isFormulaError(result)) {
      return result.code
    }
    // evaluate 终值不含 null（空格引用已归一为 0）；分支仅为类型收窄
    return result ?? 0
  }

  return {
    forSheet(sheetId, store) {
      // 显示链适配：布尔结果按 Excel 观感显示为 TRUE/FALSE（createFormulaDisplay 入参形态不含布尔）
      return (formula, col, row) => {
        const result = toDisplay(evaluateBody(sheetId, store, col, row, formula))
        return typeof result === 'boolean' ? (result ? 'TRUE' : 'FALSE') : result
      }
    },
    evaluateIn(sheetId, store, formula) {
      const body = formula.startsWith('=') ? formula.slice(1) : formula
      // 临时控制台求值：不进缓存（独立命名空间键永远脏不了，缓存即泄漏）
      return toDisplay(evaluate(body, resolverFor(sheetId, store)))
    },
    notifyValueChange(sheetId, col, row): SheetCellCoord[] {
      const key = keyOf(sheetId, col, row)
      const coord: SheetCellCoord = { sheet: sheetId, col, row }
      /** 本次被标脏格（自身 + 波及 + 易失，按 dirty 去重），交宿主重绘 */
      const invalidated: SheetCellCoord[] = [coord]
      const raw = host.resolveSheet(sheetId)?.store.getValue(col, row)
      if (typeof raw === 'string' && raw.startsWith('=')) {
        // 公式：重新注册依赖（全量替换旧边）+ 标脏自身
        astCache.delete(key)
        ensureRegistered(sheetId, col, row, raw.slice(1))
        if (astCache.get(key) === null) {
          // 解析失败：结果恒为 #ERROR!，直接写快照常量（无依赖边，之后不会被标脏）
          cache.set(key, formulaError('#ERROR!'))
          dirty.delete(key)
        } else {
          dirty.add(key)
        }
      } else {
        // 非公式：摘图节点 + 标脏自身缓存
        graph.remove(coord)
        astCache.delete(key)
        dirty.add(key)
      }
      for (const affected of graph.affectedBy([coord])) {
        const affectedKey = keyOf(affected.sheet, affected.col, affected.row)
        if (!dirty.has(affectedKey)) {
          dirty.add(affectedKey)
          invalidated.push(affected)
        }
      }
      for (const volatileCell of graph.volatileCells()) {
        const volatileKey = keyOf(volatileCell.sheet, volatileCell.col, volatileCell.row)
        if (!dirty.has(volatileKey)) {
          dirty.add(volatileKey)
          invalidated.push(volatileCell)
        }
      }
      return invalidated
    },
    invalidateAll() {
      for (const key of cache.keys()) {
        dirty.add(key)
      }
    },
    dropSheet(sheetId) {
      const prefix = `${sheetId}:`
      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) {
          cache.delete(key)
          astCache.delete(key)
          dirty.delete(key)
        } else {
          // 依赖被删表的公式需重算出 #REF!，但 removeSheet 清边后 affectedBy 已找不到它们；
          // 删表低频，保守全量标脏（对齐旧 version++ 语义）
          dirty.add(key)
        }
      }
      graph.removeSheet(sheetId)
    },
  }
}
