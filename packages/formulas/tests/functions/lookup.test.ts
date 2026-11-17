// 查找与引用函数：VLOOKUP / HLOOKUP / MATCH / INDEX / CHOOSE / ROW / COLUMN（lazy 逐格回读）

import { describe, expect, it } from 'vitest'

import {
  FormulaLookupCache,
  evaluate,
  evaluateAst,
  formulaError,
  parseFormula,
  type FormulaResolver,
} from '../../src/index'
import { EMPTY_RESOLVER, createFakeResolver } from '../testing/fake-resolver'

// A1:A3 = 10/20/30（升序），B1:B3 = 'a'/'b'/'c'；C1:C3 = 30/20/10（降序）；A2:C2 行向量 'a'/'b'/'c'
const TABLE = createFakeResolver({
  Sheet1: {
    A1: 10,
    A2: 20,
    A3: 30,
    B1: 'a',
    B2: 'b',
    B3: 'c',
    C1: 30,
    C2: 20,
    C3: 10,
  },
})

describe('VLOOKUP / HLOOKUP', () => {
  it('精确匹配（第 4 参 FALSE）', () => {
    expect(evaluate('VLOOKUP(20, A1:B3, 2, FALSE)', TABLE)).toBe('b')
    expect(evaluate('VLOOKUP(99, A1:B3, 2, FALSE)', TABLE)).toMatchObject({ code: '#N/A' })
  })

  it('近似匹配（缺省升序）', () => {
    expect(evaluate('VLOOKUP(25, A1:A3, 1)', TABLE)).toBe(20)
    expect(evaluate('VLOOKUP(30, A1:A3, 1)', TABLE)).toBe(30)
    expect(evaluate('VLOOKUP(5, A1:A3, 1)', TABLE)).toMatchObject({ code: '#N/A' })
  })

  it('列序号越界 → #REF!；< 1 → #VALUE!；区域参数非引用 → #VALUE!', () => {
    expect(evaluate('VLOOKUP(20, A1:B3, 3, FALSE)', TABLE)).toMatchObject({ code: '#REF!' })
    expect(evaluate('VLOOKUP(20, A1:B3, 0, FALSE)', TABLE)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('VLOOKUP(20, 1+1, 1, FALSE)', TABLE)).toMatchObject({ code: '#VALUE!' })
  })

  it('HLOOKUP：按首行匹配', () => {
    const rows = createFakeResolver({
      Sheet1: { A1: 10, B1: 20, C1: 30, A2: 'a', B2: 'b', C2: 'c' },
    })
    expect(evaluate('HLOOKUP(20, A1:C2, 2, FALSE)', rows)).toBe('b')
    expect(evaluate('HLOOKUP(25, A1:C1, 1)', rows)).toBe(20)
    expect(evaluate('HLOOKUP(20, A1:C2, 3, FALSE)', rows)).toMatchObject({ code: '#REF!' })
  })
})

describe('MATCH', () => {
  it('精确（0）/ 升序近似（1）/ 降序近似（-1）', () => {
    expect(evaluate('MATCH(20, A1:A3, 0)', TABLE)).toBe(2)
    expect(evaluate('MATCH(15, A1:A3, 1)', TABLE)).toBe(1)
    expect(evaluate('MATCH(25, C1:C3, -1)', TABLE)).toBe(1)
    expect(evaluate('MATCH(99, A1:A3, 0)', TABLE)).toMatchObject({ code: '#N/A' })
  })

  it('查找区域必须一维；文本匹配不区分大小写', () => {
    expect(evaluate('MATCH(1, A1:B2, 0)', TABLE)).toMatchObject({ code: '#N/A' })
    expect(evaluate('MATCH("B", B1:B3, 0)', TABLE)).toBe(2)
  })
})

describe('INDEX / CHOOSE', () => {
  it('INDEX：1 基行/列取值；单行区域省略列序号时首参实为列序号', () => {
    expect(evaluate('INDEX(A1:B3, 2, 2)', TABLE)).toBe('b')
    expect(evaluate('INDEX(B1:B3, 2)', TABLE)).toBe('b')
    const rows = createFakeResolver({ Sheet1: { A1: 10, B1: 20, C1: 30 } })
    expect(evaluate('INDEX(A1:C1, 2)', rows)).toBe(20)
  })

  it('INDEX：越界 → #REF!；序号 < 1 → #VALUE!', () => {
    expect(evaluate('INDEX(A1:B3, 4, 1)', TABLE)).toMatchObject({ code: '#REF!' })
    expect(evaluate('INDEX(A1:B3, 0, 1)', TABLE)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('INDEX(1+1, 1)', TABLE)).toMatchObject({ code: '#VALUE!' })
  })

  it('CHOOSE：1 基取值；未选分支不求值（短路）；序号越界 → #VALUE!', () => {
    expect(evaluate('CHOOSE(2, "a", "b", "c")', EMPTY_RESOLVER)).toBe('b')
    expect(evaluate('CHOOSE(1, 5, 1/0)', EMPTY_RESOLVER)).toBe(5)
    expect(evaluate('CHOOSE(0, "a")', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('CHOOSE(5, "a", "b")', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
  })
})

describe('ROW / COLUMN', () => {
  it('引用起始格行列号（1 基）；省略取公式所在格（options.cell）', () => {
    expect(evaluate('ROW(A3)', TABLE)).toBe(3)
    expect(evaluate('COLUMN(C1)', TABLE)).toBe(3)
    expect(evaluate('ROW(B2:C5)', TABLE)).toBe(2)
    expect(evaluate('ROW()', TABLE, { cell: { col: 4, row: 9 } })).toBe(10)
    expect(evaluate('COLUMN()', TABLE, { cell: { col: 4, row: 9 } })).toBe(5)
    expect(evaluate('ROW(1+1)', TABLE)).toMatchObject({ code: '#VALUE!' })
  })
})

describe('查找边界语义与批内索引缓存（FormulaLookupCache）', () => {
  it('通配符（* / ? / ~ 转义）与大小写不敏感（无缓存与有缓存一致）', () => {
    const resolver = createFakeResolver({
      Sheet1: {
        A1: 'Apple',
        A2: 'a*b',
        A3: 'cat',
        A4: 'a?c',
        B1: 1,
        B2: 2,
        B3: 3,
        B4: 4,
      },
    })
    for (const lookupCache of [undefined, new FormulaLookupCache()]) {
      const opts = lookupCache ? { lookupCache } : undefined
      expect(evaluate('VLOOKUP("app*", A1:B4, 2, FALSE)', resolver, opts)).toBe(1)
      expect(evaluate('VLOOKUP("C?T", A1:B4, 2, FALSE)', resolver, opts)).toBe(3)
      expect(evaluate('VLOOKUP("A~*B", A1:B4, 2, FALSE)', resolver, opts)).toBe(2)
      expect(evaluate('VLOOKUP("A~?C", A1:B4, 2, FALSE)', resolver, opts)).toBe(4)
      expect(evaluate('MATCH("app*", A1:A4, 0)', resolver, opts)).toBe(1)
      expect(evaluate('HLOOKUP("Apple", A1:B4, 2, FALSE)', resolver, opts)).toBe('a*b')
    }
  })

  it('严格区分数字与数字字符串、空单元格不参与匹配、重复键取首次命中', () => {
    const resolver = createFakeResolver({
      Sheet1: {
        A1: '20',
        A2: 20,
        A3: 20,
        B1: 'text-20',
        B2: 'first-num',
        B3: 'second-num',
      },
    })
    const cache = new FormulaLookupCache()
    expect(evaluate('VLOOKUP(20, A1:B4, 2, FALSE)', resolver, { lookupCache: cache })).toBe(
      'first-num',
    )
    expect(evaluate('VLOOKUP("20", A1:B4, 2, FALSE)', resolver, { lookupCache: cache })).toBe(
      'text-20',
    )
    // A4 为空（null），空查找值转 0 不命中空单元格
    expect(
      evaluate('VLOOKUP(A4, A1:B4, 2, FALSE)', resolver, { lookupCache: cache }),
    ).toMatchObject({ code: '#N/A' })
  })

  it('区域内错误传播：匹配点之前的错误传播，匹配在错误之前则正常返回', () => {
    const resolver = createFakeResolver({
      Sheet1: {
        A1: 10,
        A2: formulaError('#DIV/0!'),
        A3: 30,
        B1: 'ok',
        B2: 'err',
        B3: 'after',
      },
    })
    for (const lookupCache of [undefined, new FormulaLookupCache()]) {
      const opts = lookupCache ? { lookupCache } : undefined
      expect(evaluate('VLOOKUP(10, A1:B3, 2, FALSE)', resolver, opts)).toBe('ok')
      expect(evaluate('VLOOKUP(30, A1:B3, 2, FALSE)', resolver, opts)).toMatchObject({
        code: '#DIV/0!',
      })
      expect(evaluate('VLOOKUP(99, A1:B3, 2, FALSE)', resolver, opts)).toMatchObject({
        code: '#DIV/0!',
      })
    }
  })

  it('超大稀疏表通过 sparseVector 钩子快速定位（不逐格遍历 10 万行）', () => {
    let cellCalls = 0
    const sparseResolver: FormulaResolver = {
      cell(ref) {
        cellCalls++
        if (ref.row === 50_000 && ref.col === 1) return 'found-50k'
        return null
      },
      range: () => [],
      sparseVector(_ref, along) {
        if (along === 'column') {
          return [
            [10, 100],
            [50_000, 200],
          ]
        }
        return []
      },
    }
    const cache = new FormulaLookupCache()
    expect(
      evaluate('VLOOKUP(200, A1:B100000, 2, FALSE)', sparseResolver, { lookupCache: cache }),
    ).toBe('found-50k')
    expect(evaluate('MATCH(150, A1:A100000, 1)', sparseResolver)).toBe(11)
    // 仅在取目标返回值 B50001 时调用过 1 次 cell()
    expect(cellCalls).toBe(1)
  })

  it('性能基准：50,000 行表执行 2,000 次 VLOOKUP（共享 FormulaLookupCache）< 200ms', () => {
    const rowCount = 50_000
    const colA = Array.from({ length: rowCount }, (_, i) => i + 1)
    const colB = Array.from({ length: rowCount }, (_, i) => `v-${i + 1}`)
    const bigResolver: FormulaResolver = {
      cell(ref) {
        if (ref.row < 0 || ref.row >= rowCount) return null
        if (ref.col === 0) return colA[ref.row]!
        if (ref.col === 1) return colB[ref.row]!
        return null
      },
      range: () => [],
    }

    const cache = new FormulaLookupCache()
    const asts = Array.from({ length: 2000 }, (_, i) =>
      parseFormula(`VLOOKUP(${((i * 23) % rowCount) + 1}, A1:B${rowCount}, 2, FALSE)`),
    )

    const start = performance.now()
    for (let i = 0; i < asts.length; i++) {
      const expected = `v-${((i * 23) % rowCount) + 1}`
      expect(evaluateAst(asts[i]!, bigResolver, { lookupCache: cache })).toBe(expected)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })
})
