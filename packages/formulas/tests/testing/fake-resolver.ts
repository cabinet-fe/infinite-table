// 测试辅助：内存多表假 resolver（'A1' 键值地图 + 跨表路由 + 调用记录），镜像 SheetBook 宿主语义。

import { colLetters, formulaError } from '../../src/index'
import type { CellRef, FormulaResolver, RangeRef } from '../../src/index'

export interface FakeResolver extends FormulaResolver {
  /** cell 调用记录（跨表断言用） */
  cellCalls: CellRef[]
  /** range 调用记录 */
  rangeCalls: RangeRef[]
}

/**
 * book：表名 → { 'A1': 值 } 稀疏地图；空格（未登记）→ null。
 * defaultSheet：裸引用缺省表名（缺省取第一个表）。未知表 → #REF!（对齐宿主语义）。
 */
export function createFakeResolver(
  book: Record<string, Record<string, unknown>>,
  defaultSheet?: string,
): FakeResolver {
  const sheets = new Map<string, Map<string, unknown>>()
  for (const [name, cells] of Object.entries(book)) {
    const map = new Map<string, unknown>()
    for (const [address, value] of Object.entries(cells)) {
      map.set(address.toUpperCase(), value)
    }
    sheets.set(name, map)
  }
  const fallback = defaultSheet ?? Object.keys(book)[0]
  const cellCalls: CellRef[] = []
  const rangeCalls: RangeRef[] = []

  const lookup = (sheet: string | undefined): Map<string, unknown> | null =>
    sheets.get(sheet ?? fallback ?? '') ?? null

  return {
    cellCalls,
    rangeCalls,
    cell(ref) {
      cellCalls.push(ref)
      const sheet = lookup(ref.sheet)
      if (!sheet) {
        return formulaError('#REF!')
      }
      return sheet.get(`${colLetters(ref.col)}${ref.row + 1}`) ?? null
    },
    range(ref) {
      rangeCalls.push(ref)
      const sheet = lookup(ref.sheet)
      if (!sheet) {
        return [formulaError('#REF!')]
      }
      const values: unknown[] = []
      // 先行后列展开；空格不进数组（稀疏语义）
      for (let row = ref.startRow; row <= ref.endRow; row++) {
        for (let col = ref.startCol; col <= ref.endCol; col++) {
          const value = sheet.get(`${colLetters(col)}${row + 1}`)
          if (value !== undefined && value !== null) {
            values.push(value)
          }
        }
      }
      return values
    },
  }
}

/** 空 resolver（全部读空） */
export const EMPTY_RESOLVER: FormulaResolver = {
  cell: () => null,
  range: () => [],
}
