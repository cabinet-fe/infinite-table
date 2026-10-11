// dependency-graph：边注册/替换/移除/整表清理/传递闭包/循环/区域点查/易失集

import { describe, expect, it } from 'vitest'

import { DependencyGraph } from '../src/dependency-graph'
import type { FormulaRefCoord, SheetCellCoord, SheetRangeCoord } from '../src/dependency-graph'

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

describe('DependencyGraph：大批量输入（批量写入重算路径）', () => {
  // 回归防护：affectedBy 曾用 shift() 排空输入队列，15 万坐标级批量写入下
  // O(n²) 搬移会卡死主线程数分钟；两段式批量点查后为线性。规模低于此则
  // 回归也难超时，故固定 15 万。

  it('空图快路径：无公式格时大批量 changed 不逐格遍历，直接空结果', () => {
    const graph = new DependencyGraph()
    const changed = Array.from({ length: 150_000 }, (_, i) => cell('S1', i % 12, (i / 12) | 0))
    expect(graph.affectedBy(changed)).toEqual([])
  })

  it('两段式扩散：大批量 changed 中命中依赖闭包仍正确', () => {
    const graph = new DependencyGraph()
    // S1!E5 = S1!D4 + 1；D4 淹没在 15 万变更集中
    graph.setFormula(cell('S1', 4, 4), [cellRef('S1', 3, 3)])
    const changed = Array.from({ length: 150_000 }, (_, i) => cell('S1', i % 12, (i / 12) | 0))
    expect(sorted(graph.affectedBy(changed))).toEqual(['S1!4,4'])
  })

  it('区域批量判定：矩形批量变更命中区域公式（#8 列区间合并路径）', () => {
    const graph = new DependencyGraph()
    // S1!A1 = SUM(S1!C3:G9)；批量变更矩形 C..G × 3..9 的子块应命中，
    // 矩形外的行/列不命中
    graph.setFormula(cell('S1', 0, 0), [rangeRef('S1', 2, 2, 6, 8)])
    const inside = Array.from({ length: 50_000 }, (_, i) =>
      cell('S1', 2 + (i % 5), 2 + (((i / 5) | 0) % 7)),
    )
    expect(sorted(graph.affectedBy(inside))).toEqual(['S1!0,0'])
    const outsideRows = Array.from({ length: 50_000 }, (_, i) => cell('S1', 2, 9 + (i % 3)))
    expect(graph.affectedBy(outsideRows)).toEqual([])
    const outsideCols = Array.from({ length: 50_000 }, (_, i) => cell('S1', 7 + (i % 3), 2))
    expect(graph.affectedBy(outsideCols)).toEqual([])
  })
})

describe('DependencyGraph：affectedBy 批量路径差分等价（#8 回归防护）', () => {
  // 朴素参考实现：直接拿注册边暴力求闭包（不经过被测的批量/区间代码），
  // 与 affectedBy 在随机图 × 随机变更集上逐轮对照。覆盖：跨表、链式、
  // 环、单格/区域混合引用、变更集含公式格与重复坐标。

  const coordOf = (c: SheetCellCoord) => `${c.sheet}!${c.col},${c.row}`

  const refContains = (ref: FormulaRefCoord, coord: SheetCellCoord): boolean => {
    if (ref.kind === 'cell') {
      const r = ref.ref
      return r.sheet === coord.sheet && r.col === coord.col && r.row === coord.row
    }
    const r = ref.ref
    return (
      r.sheet === coord.sheet &&
      coord.col >= r.startCol &&
      coord.col <= r.endCol &&
      coord.row >= r.startRow &&
      coord.row <= r.endRow
    )
  }

  const bruteForce = (
    formulas: Array<{ coord: SheetCellCoord; refs: FormulaRefCoord[] }>,
    changed: SheetCellCoord[],
  ): string[] => {
    const affected = new Map<string, SheetCellCoord>()
    let grew = true
    while (grew) {
      grew = false
      for (const f of formulas) {
        const key = coordOf(f.coord)
        if (affected.has(key)) continue
        const sources = [...changed, ...affected.values()]
        if (f.refs.some((ref) => sources.some((coord) => refContains(ref, coord)))) {
          affected.set(key, f.coord)
          grew = true
        }
      }
    }
    return [...affected.keys()].sort()
  }

  /** mulberry32：固定种子的确定性 PRNG（可复现失败轮次） */
  function prng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it('随机图 × 随机变更集：与朴素参考闭包完全一致（30 轮）', () => {
    const rand = prng(20261011)
    for (let round = 0; round < 30; round++) {
      const graph = new DependencyGraph()
      const formulas: Array<{ coord: SheetCellCoord; refs: FormulaRefCoord[] }> = []
      // 候选格池含少量公式格自身（制造链式/环）；两张表制造跨表引用
      const pool: SheetCellCoord[] = []
      for (let i = 0; i < 24; i++)
        pool.push(cell(rand() < 0.7 ? 'S1' : 'S2', (rand() * 8) | 0, (rand() * 8) | 0))
      const formulaCount = 2 + ((rand() * 10) | 0)
      for (let i = 0; i < formulaCount; i++) {
        const coord = pool[(rand() * pool.length) | 0]!
        const refs: FormulaRefCoord[] = []
        const refCount = (rand() * 3) | 0
        for (let r = 0; r < refCount; r++) {
          if (rand() < 0.5) {
            refs.push(
              cellRef(pool[(rand() * pool.length) | 0]!.sheet, (rand() * 8) | 0, (rand() * 8) | 0),
            )
          } else {
            const c1 = (rand() * 8) | 0
            const r1 = (rand() * 8) | 0
            refs.push(rangeRef('S1', c1, r1, c1 + ((rand() * 3) | 0), r1 + ((rand() * 3) | 0)))
          }
        }
        graph.setFormula(coord, refs)
        // setFormula 是同格全量替换语义：参考实现只保留最后一次注册
        const key = coordOf(coord)
        const prev = formulas.findIndex((f) => coordOf(f.coord) === key)
        if (prev >= 0) formulas.splice(prev, 1)
        formulas.push({ coord, refs })
      }
      // 随机变更集：多为随机分散，偶发重复坐标
      const changed: SheetCellCoord[] = []
      const changeCount = 1 + ((rand() * 40) | 0)
      for (let i = 0; i < changeCount; i++) {
        changed.push(cell(rand() < 0.7 ? 'S1' : 'S2', (rand() * 9) | 0, (rand() * 9) | 0))
        if (rand() < 0.2) changed.push(changed[changed.length - 1]!)
      }
      const actual = sorted(graph.affectedBy(changed))
      const expected = bruteForce(formulas, changed).sort()
      expect(actual).toEqual(expected)
    }
  })
})

describe('DependencyGraph：按表查询（宿主删表/改名编排用）', () => {
  it('formulasOf 枚举该表全部公式格（跨表公式不计）', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [cellRef('S2', 0, 0)])
    graph.setFormula(cell('S1', 1, 1), [rangeRef('S1', 0, 0, 2, 2)])
    graph.setFormula(cell('S2', 0, 0), [])
    expect(sorted(graph.formulasOf('S1'))).toEqual(['S1!0,0', 'S1!1,1'])
    expect(sorted(graph.formulasOf('S2'))).toEqual(['S2!0,0'])
    expect(graph.formulasOf('Nope')).toEqual([])
  })

  it('affectedBySheet 收集单格/区域引用该表的公式格（去重，含自引用）', () => {
    const graph = new DependencyGraph()
    // S1!A1 引用 S2 单格；S1!C3 引用 S2 区域；S2!B2 自引用本表
    graph.setFormula(cell('S1', 0, 0), [cellRef('S2', 0, 0)])
    graph.setFormula(cell('S1', 2, 2), [rangeRef('S2', 0, 0, 1, 1)])
    graph.setFormula(cell('S2', 1, 1), [cellRef('S2', 0, 0)])
    // 同格重复引用同表去重
    graph.setFormula(cell('S1', 0, 3), [cellRef('S2', 1, 1), rangeRef('S2', 5, 5, 6, 6)])
    expect(sorted(graph.affectedBySheet('S2'))).toEqual(['S1!0,0', 'S1!0,3', 'S1!2,2', 'S2!1,1'])
    expect(graph.affectedBySheet('S1')).toEqual([])
  })

  it('remove 后 affectedBySheet 不再命中', () => {
    const graph = new DependencyGraph()
    graph.setFormula(cell('S1', 0, 0), [cellRef('S2', 0, 0)])
    graph.remove(cell('S1', 0, 0))
    expect(graph.affectedBySheet('S2')).toEqual([])
  })
})
