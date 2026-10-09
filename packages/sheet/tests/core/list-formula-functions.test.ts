// 函数注册表元数据口径：49 内置函数全量锁定（名称/分类/中文说明/参数表）。
// 迁移自 sheet-core __test__/list-formula-functions.test.ts；分类清单按本仓
// @infinitable/formulas 注册表的实际口径锁定——引擎侧另有「常用」分类
// （SUM/ROUND/ABS/AVERAGE/MAX/MIN/COUNT/IF/AND/OR 十个高频函数归入常用，
// 不在数学/统计/逻辑），与 sheet-core 的旧分类清单差异为引擎既有语义，不改。

import {
  getFormulaFunction,
  listFormulaFunctions,
  registerFormulaFunction,
  type FormulaFunctionCategory,
} from '@infinitable/formulas'
import { afterEach, describe, expect, it } from 'vitest'

const BUILTIN_NAMES = [
  'ABS',
  'AND',
  'AVERAGE',
  'CHOOSE',
  'COLUMN',
  'CONCATENATE',
  'COUNT',
  'COUNTA',
  'EXACT',
  'HLOOKUP',
  'IF',
  'INDEX',
  'LEFT',
  'LEN',
  'LOWER',
  'MATCH',
  'MAX',
  'MID',
  'MIN',
  'NOT',
  'OR',
  'REPLACE',
  'RIGHT',
  'ROUND',
  'ROW',
  'SUBSTITUTE',
  'SUM',
  'TRIM',
  'UPPER',
  'VLOOKUP',
] as const

/** 内置函数的期望分类（按引擎注册表口径锁定的清单） */
const BUILTIN_CATEGORIES: Record<string, FormulaFunctionCategory> = {
  SUM: '常用',
  ROUND: '常用',
  ABS: '常用',
  AVERAGE: '常用',
  MAX: '常用',
  MIN: '常用',
  COUNT: '常用',
  IF: '常用',
  AND: '常用',
  OR: '常用',
  RAND: '数学',
  RANDBETWEEN: '数学',
  COUNTA: '统计',
  COUNTIF: '统计',
  COUNTBLANK: '统计',
  MEDIAN: '统计',
  LARGE: '统计',
  SMALL: '统计',
  RANK: '统计',
  NOT: '逻辑',
  XOR: '逻辑',
  IFERROR: '逻辑',
  TRUE: '逻辑',
  FALSE: '逻辑',
  CONCATENATE: '文本',
  LEN: '文本',
  LEFT: '文本',
  RIGHT: '文本',
  MID: '文本',
  UPPER: '文本',
  LOWER: '文本',
  TRIM: '文本',
  EXACT: '文本',
  SUBSTITUTE: '文本',
  REPLACE: '文本',
  TODAY: '日期与时间',
  NOW: '日期与时间',
  VLOOKUP: '查找与引用',
  HLOOKUP: '查找与引用',
  MATCH: '查找与引用',
  INDEX: '查找与引用',
  CHOOSE: '查找与引用',
  ROW: '查找与引用',
  COLUMN: '查找与引用',
  PMT: '财务',
  FV: '财务',
  PV: '财务',
  IPMT: '财务',
  PPMT: '财务',
}

describe('listFormulaFunctions / FormulaFunctionMeta', () => {
  const extras: string[] = []

  afterEach(() => {
    // 测试用临时函数：用空实现覆盖后无法删除 Map 项，改为覆盖成无 meta 的占位再忽略
    for (const name of extras.splice(0)) {
      registerFormulaFunction(name, { impl: () => null, meta: undefined })
    }
  })

  it(`枚举含 ${BUILTIN_NAMES.length} 个内置函数，名称升序，均带 params + 中文 description`, () => {
    const list = listFormulaFunctions()
    const byName = new Map(list.map((f) => [f.name, f]))
    for (const name of BUILTIN_NAMES) {
      const item = byName.get(name)
      expect(item).toBeDefined()
      expect(item!.params.length).toBeGreaterThan(0)
      expect(item!.description.length).toBeGreaterThan(0)
      // 中文说明（至少含一个 CJK 字符）
      expect(/[\u4e00-\u9fff]/.test(item!.description)).toBe(true)
    }
    // 内置名称在列表中按字典序
    const builtinInList = list.filter((f) => (BUILTIN_NAMES as readonly string[]).includes(f.name))
    const names = builtinInList.map((f) => f.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('SUM 元数据签名字段正确（params 为名称 + 可选标记的参数表）', () => {
    const sum = listFormulaFunctions().find((f) => f.name === 'SUM')!
    expect(sum.params).toEqual([
      { name: 'number1' },
      { name: 'number2', optional: true },
      { name: '...' },
    ])
    expect(sum.description).toBe('求参数之和')
    expect(getFormulaFunction('SUM')?.meta).toEqual({
      params: sum.params,
      description: sum.description,
      category: '常用',
    })
  })

  it(`${Object.keys(BUILTIN_CATEGORIES).length} 个内置函数分类与引擎注册表锁定清单一致`, () => {
    const list = listFormulaFunctions()
    const byName = new Map(list.map((f) => [f.name, f]))
    for (const [name, category] of Object.entries(BUILTIN_CATEGORIES)) {
      expect(byName.get(name)).toBeDefined()
      expect(byName.get(name)!.category).toBe(category)
    }
  })

  // 全量锁定 49 个内置函数。过滤 '__' 前缀：本文件 afterEach 用无 meta 占位覆盖
  // 临时函数后注册表仍留键。
  it('全部 49 个内置函数名称全量锁定', () => {
    const names = listFormulaFunctions()
      .map((f) => f.name)
      .filter((name) => !name.startsWith('__'))
    expect(names).toHaveLength(49)
    expect(new Set(names)).toEqual(new Set(Object.keys(BUILTIN_CATEGORIES)))
  })

  it('无 meta 的第三方函数仅返回空 params / description，category 为 undefined', () => {
    const name = '__META_TEST_FN__'
    extras.push(name)
    registerFormulaFunction(name, { minArgs: 0, impl: () => 1 })
    const item = listFormulaFunctions().find((f) => f.name === name)
    expect(item).toMatchObject({ name, params: [], description: '', category: undefined })
  })
})
