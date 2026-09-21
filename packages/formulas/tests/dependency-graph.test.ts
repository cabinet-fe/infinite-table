// dependency-graph：边注册/替换/移除/整表清理/传递闭包/循环/区域点查/易失集

import { describe, expect, it } from 'vitest'

import { DependencyGraph } from '../src/index'
import type { SheetCellCoord, SheetRangeCoord } from '../src/index'

const cell = (sheet: string, col: number, row: number): SheetCellCoord => ({ sheet, col, row })
const cellRef = (sheet: string, col: number, row: number) => ({
  kind: 'cell' as const,
  ref: cell(sheet, col, row),
})
const rangeRef = (
  sheet: string,
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
) => ({
  kind: 'range' as const,
  ref: { sheet, startCol, startRow, endCol, endRow } satisfies SheetRangeCoord,
})

/** 结果集排序成可读串，便于断言（affectedBy 顺序是 BFS 序，不稳定不断言） */
const sorted = (coords: SheetCellCoord[]): string[] =>
  coords.map((c) => `${c.sheet}!${c.col},${c.row}`).sort()

describe('DependencyGraph：注册与查询', () => {
  it('setFormula 注册公式格；has/size 反映', () => {
    const graph = new DependencyGraph()
    expect(graph.size).toBe(0)
    expect(graph.has(cell('S1', 0, 0))).toBe(false)
    graph.setFormula(cell('S1', 0, 0), [cellRef('S1', 0, 1)])
    expect(graph.has(cell('S1', 0, 0))).toBe(true)
    expect(graph.size).toBe(1)
  })

  it('sheet 名含分隔符不串键（长度前缀编码）', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('a|0', 1, 2), [])
    graph.setFormula(cell('a', 10, 12), [])
    expect(graph.size).toBe(2)
    expect(graph.has(cell('a|0', 1, 2))).toBe(true)
    expect(graph.has(cell('a', 10, 12))).toBe(true)
  })

  it('重复 setFormula 全量替换旧边', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [cellRef('S1', 0, 1)])
    graph.setFormula(cell('S1', 0, 0), [cellRef('S1', 5, 5)])
    expect(graph.size).toBe(1)
    // 旧依赖 A2 变更不再波及；新依赖 F6 变更波及
    expect(graph.affectedBy([cell('S1', 0, 1)])).toEqual([])
    expect(sorted(graph.affectedBy([cell('S1', 5, 5)]))).toEqual(['S1!0,0'])
  })

  it('refs 去重：完全相同的去掉；cell 与 range 重叠不合并', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [
      cellRef('S1', 1, 1),
      cellRef('S1', 1, 1),
      rangeRef('S1', 1, 1, 2, 2),
    ])
    // 去重后 remove 能干净清边（否则残留重边会让 affectedBy 仍命中）
    graph.remove(cell('S1', 0, 0))
    expect(graph.affectedBy([cell('S1', 1, 1)])).toEqual([])
  })

  it('remove：非公式格空操作；公式格清边', () => {
    const graph = new DependencyGraph()
    graph.remove(cell('S1', 0, 0))
    graph.setFormula(cell('S1', 0, 0), [cellRef('S1', 0, 1)])
    graph.remove(cell('S1', 0, 0))
    expect(graph.has(cell('S1', 0, 0))).toBe(false)
    expect(graph.size).toBe(0)
    expect(graph.affectedBy([cell('S1', 0, 1)])).toEqual([])
  })
})

describe('DependencyGraph：affectedBy 传递闭包', () => {
  it('直接依赖与多级扩散（跨表）', () => {
    const graph = new DependencyGraph()
    // S1!B1 = S1!A1；S1!C1 = S1!B1；S2!A1 = S1!C1
    graph.setFormula(cell('S1', 1, 0), [cellRef('S1', 0, 0)])
    graph.setFormula(cell('S1', 2, 0), [cellRef('S1', 1, 0)])
    graph.setFormula(cell('S2', 0, 0), [cellRef('S1', 2, 0)])
    expect(sorted(graph.affectedBy([cell('S1', 0, 0)]))).toEqual(['S1!1,0', 'S1!2,0', 'S2!0,0'])
    // 中游变更只波及下游
    expect(sorted(graph.affectedBy([cell('S1', 2, 0)]))).toEqual(['S2!0,0'])
  })

  it('多起点合并去重', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 2, 0), [cellRef('S1', 0, 0), cellRef('S1', 1, 0)])
    expect(graph.affectedBy([cell('S1', 0, 0), cell('S1', 1, 0)])).toHaveLength(1)
  })

  it('循环：环上格都会出现（含 changed 自身）', () => {
    const graph = new DependencyGraph()
    // A1 = B1+1；B1 = A1+1
    graph.setFormula(cell('S1', 0, 0), [cellRef('S1', 1, 0)])
    graph.setFormula(cell('S1', 1, 0), [cellRef('S1', 0, 0)])
    expect(sorted(graph.affectedBy([cell('S1', 0, 0)]))).toEqual(['S1!0,0', 'S1!1,0'])
  })

  it('自依赖 A1 = A1+1：changed 自身在结果中', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [cellRef('S1', 0, 0)])
    expect(sorted(graph.affectedBy([cell('S1', 0, 0)]))).toEqual(['S1!0,0'])
  })

  it('被改格本身是公式格但无依赖边时不出现在结果', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [cellRef('S1', 9, 9)])
    expect(graph.affectedBy([cell('S1', 0, 0)])).toEqual([])
  })
})

describe('DependencyGraph：区域依赖', () => {
  it('点查：区域内 / 外 / 边界（闭区间）', () => {
    const graph = new DependencyGraph()
    // S1!A1 = SUM(S1!B2:D5)
    graph.setFormula(cell('S1', 0, 0), [rangeRef('S1', 1, 1, 3, 4)])
    expect(sorted(graph.affectedBy([cell('S1', 2, 2)]))).toEqual(['S1!0,0']) // 内
    expect(sorted(graph.affectedBy([cell('S1', 1, 1)]))).toEqual(['S1!0,0']) // 边界（起点角）
    expect(sorted(graph.affectedBy([cell('S1', 3, 4)]))).toEqual(['S1!0,0']) // 边界（终点角）
    expect(graph.affectedBy([cell('S1', 4, 2)])).toEqual([]) // 外（列）
    expect(graph.affectedBy([cell('S1', 2, 5)])).toEqual([]) // 外（行）
  })

  it('区域按表隔离', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [rangeRef('S2', 0, 0, 9, 9)])
    expect(graph.affectedBy([cell('S1', 5, 5)])).toEqual([])
    expect(sorted(graph.affectedBy([cell('S2', 5, 5)]))).toEqual(['S1!0,0'])
  })

  it('区域命中后继续沿公式格扩散', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [rangeRef('S1', 1, 0, 1, 9)])
    graph.setFormula(cell('S1', 0, 1), [cellRef('S1', 0, 0)])
    expect(sorted(graph.affectedBy([cell('S1', 1, 5)]))).toEqual(['S1!0,0', 'S1!0,1'])
  })
})

describe('DependencyGraph：removeSheet', () => {
  it('清掉该表公式格与其它表指向该表的边', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [cellRef('S2', 0, 0)])
    graph.setFormula(cell('S2', 1, 1), [cellRef('S1', 0, 0)])
    graph.removeSheet('S2')
    expect(graph.has(cell('S2', 1, 1))).toBe(false)
    expect(graph.size).toBe(1)
    // S2 的变更不再波及 S1 的公式（边已清；宿主删表时整表处理缓存）
    expect(graph.affectedBy([cell('S2', 0, 0)])).toEqual([])
    // S1 自己的公式无入边，不受影响
    expect(graph.affectedBy([cell('S1', 0, 0)])).toEqual([])
  })

  it('removeSheet 后再 remove 残留引用不炸（deps 记录与索引已解耦清理）', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [cellRef('S2', 0, 0), rangeRef('S2', 0, 0, 1, 1)])
    graph.removeSheet('S2')
    expect(() => graph.remove(cell('S1', 0, 0))).not.toThrow()
    expect(graph.size).toBe(0)
  })
})

describe('DependencyGraph：易失集', () => {
  it('注册 / 重注册取消 / 移除', () => {
    const graph = new DependencyGraph()
    const a1 = cell('S1', 0, 0)
    graph.setFormula(a1, [], { volatile: true })
    expect(graph.volatileCells()).toEqual([a1])
    // 重注册不带 volatile → 出易失集
    graph.setFormula(a1, [])
    expect(graph.volatileCells()).toEqual([])
    graph.setFormula(a1, [], { volatile: true })
    graph.remove(a1)
    expect(graph.volatileCells()).toEqual([])
  })

  it('removeSheet 清掉该表易失格', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [], { volatile: true })
    graph.setFormula(cell('S2', 0, 0), [], { volatile: true })
    graph.removeSheet('S1')
    expect(graph.volatileCells()).toEqual([cell('S2', 0, 0)])
  })
})
