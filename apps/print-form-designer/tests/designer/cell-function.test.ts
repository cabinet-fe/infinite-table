// 单元格函数（「作用方式」的 v4 替代）测试：内置数据块函数（SUM/AVG/COUNT/MIN/MAX/
// SUBTOTAL/GROUP）、item 计算列、agg 引用、同列省字段语义、参数与数据块引用校验、
// 结果收敛（非原始类型不进格）与错误分类。结构化载荷（FormCellFunction 的 fn 形态）
// 经 cellFunctionExpression 合成等价表达式后走同一条求值管线；旧表达式载荷的
// 嗅探转换（可迁移 → fn / 不可迁移 → expr）在这里验证语义等价。
import { describe, expect, test } from 'vitest'

import {
  CELL_FUNCTION_CATALOG,
  cellFnLabel,
  deriveParamCell,
  evaluateCellFunction,
  type CellFunctionEnv,
  type ParamCellSource,
} from '../../src/designer/cell-function'
import {
  cellFunctionExpression,
  normalizeCellFunction,
  type FormCellBinding,
  type FormCellFunction,
  type FormRegion,
} from '../../src/shared/template-schema'
import { ExprError } from '../../src/transform/expr'
import { ADDR } from './testing/fixtures'

/** 捕获 action 抛出的错误（应抛未抛时炸出，expect 平铺在外，不做条件断言） */
const thrownOf = (action: () => unknown): unknown => {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('应抛错但未抛')
}

const ITEMS = [
  { customer: '甲', qty: 2, price: 120 },
  { customer: '甲', qty: 1, price: 80 },
  { customer: '乙', qty: 5, price: 900 },
]

/** 最小求值环境：单数据块「明细」+ 可选分组语境 */
function env(partials: Partial<CellFunctionEnv> = {}): CellFunctionEnv {
  return {
    agg: {},
    itemsOf: (ref) => {
      if (ref === '明细') return ITEMS
      throw new Error(`没有名为「${ref}」的数据块`)
    },
    columnFieldOf: (ref) => {
      if (ref !== '明细') throw new Error(`没有名为「${ref}」的数据块`)
      return 'qty'
    },
    ...partials,
  }
}

describe('数据块聚合函数', () => {
  test('SUM/AVG/COUNT/MIN/MAX 显式字段', () => {
    expect(evaluateCellFunction("SUM('明细', 'qty')", env())).toBe(8)
    expect(evaluateCellFunction("AVG('明细', 'price')", env())).toBeCloseTo(1100 / 3)
    expect(evaluateCellFunction("COUNT('明细', 'qty')", env())).toBe(3)
    expect(evaluateCellFunction("MIN('明细', 'price')", env())).toBe(80)
    expect(evaluateCellFunction("MAX('明细', 'price')", env())).toBe(900)
  })

  test('省字段 = 同列绑定字段（columnFieldOf）', () => {
    expect(evaluateCellFunction("SUM('明细')", env())).toBe(8)
  })

  test('COUNT 不带字段 = 条数', () => {
    expect(evaluateCellFunction("COUNT('明细')", env())).toBe(3)
  })

  test('聚合跳过空值，数值聚合只吃 number', () => {
    const mixed = [{ v: 1 }, { v: 'x' }, { v: 3 }, {}, { v: null }]
    const env2 = env({
      itemsOf: (ref) => {
        if (ref === 'm') return mixed
        throw new Error('nope')
      },
    })
    expect(evaluateCellFunction("SUM('m', 'v')", env2)).toBe(4)
    expect(evaluateCellFunction("COUNT('m', 'v')", env2)).toBe(3)
    expect(evaluateCellFunction("MAX('m', 'v')", env({ itemsOf: () => mixed }))).toBe(3)
  })

  test('SUBTOTAL：小计行按当前组，无分组语境 = 全量', () => {
    const group = ITEMS.filter((item) => item.customer === '甲')
    expect(evaluateCellFunction("SUBTOTAL('明细', 'qty')", env({ subtotalItems: group }))).toBe(3)
    expect(evaluateCellFunction("SUBTOTAL('明细', 'qty')", env())).toBe(8)
  })
})

describe('GROUP 与 item', () => {
  test('GROUP 缺省取首个分组字段，指定字段取组首条目', () => {
    const groupEnv = env({
      groupFirst: ITEMS[0],
      groupField: 'customer',
    })
    expect(evaluateCellFunction('GROUP()', groupEnv)).toBe('甲')
    expect(evaluateCellFunction("GROUP('qty')", groupEnv)).toBe(2)
  })

  test('GROUP 在分组语境之外抛错', () => {
    expect(() => evaluateCellFunction('GROUP()', env())).toThrow('GROUP()')
  })

  test('item 计算列与自由 JS 表达式', () => {
    expect(evaluateCellFunction('item.qty * item.price', env({ item: ITEMS[0] }))).toBe(240)
    expect(evaluateCellFunction("Math.round(SUM('明细', 'price') * 0.13)", env())).toBe(143)
  })
})

describe('agg 引用与结果收敛', () => {
  test('agg 对象直接取值', () => {
    expect(
      evaluateCellFunction("agg.summary['总计']", env({ agg: { summary: { 总计: 42 } } })),
    ).toBe(42)
  })

  test('非原始类型结果不进格', () => {
    expect(evaluateCellFunction('({ a: 1 })', env())).toBeUndefined()
    expect(evaluateCellFunction('[1, 2]', env())).toBeUndefined()
    expect(evaluateCellFunction('null', env())).toBeUndefined()
  })
})

describe('结构化载荷求值（合成等价表达式，与手写表达式同一条管线）', () => {
  /** 结构化载荷求值快捷入口：合成 → evaluateCellFunction（data-state 的实际路径） */
  const run = (fn: FormCellFunction, context: Partial<CellFunctionEnv> = {}) =>
    evaluateCellFunction(cellFunctionExpression(fn), env(context))

  test('显式字段：SUM/AVG/COUNT/MIN/MAX/SUBTOTAL', () => {
    expect(run({ kind: 'fn', fn: 'SUM', region: '明细', field: 'qty' })).toBe(8)
    expect(run({ kind: 'fn', fn: 'AVG', region: '明细', field: 'price' })).toBeCloseTo(1100 / 3)
    expect(run({ kind: 'fn', fn: 'COUNT', region: '明细', field: 'qty' })).toBe(3)
    expect(run({ kind: 'fn', fn: 'MIN', region: '明细', field: 'price' })).toBe(80)
    expect(run({ kind: 'fn', fn: 'MAX', region: '明细', field: 'price' })).toBe(900)
    expect(run({ kind: 'fn', fn: 'SUBTOTAL', region: '明细', field: 'qty' })).toBe(8)
  })

  test('省字段 = 同列绑定字段（columnFieldOf）；COUNT 省字段 = 条数', () => {
    expect(run({ kind: 'fn', fn: 'SUM', region: '明细' })).toBe(8)
    expect(run({ kind: 'fn', fn: 'COUNT', region: '明细' })).toBe(3)
  })

  test('GROUP：省字段取首个分组字段，指定字段取组首条目', () => {
    const context = { groupFirst: ITEMS[0], groupField: 'customer' }
    expect(run({ kind: 'fn', fn: 'GROUP' }, context)).toBe('甲')
    expect(run({ kind: 'fn', fn: 'GROUP', field: 'qty' }, context)).toBe(2)
  })

  test('合成表达式格式（画布占位符与求值共用同一口径）', () => {
    expect(cellFunctionExpression({ kind: 'fn', fn: 'SUM', region: '明细', field: 'qty' })).toBe(
      "SUM('明细', 'qty')",
    )
    expect(cellFunctionExpression({ kind: 'fn', fn: 'SUM', region: '明细' })).toBe("SUM('明细')")
    expect(cellFunctionExpression({ kind: 'fn', fn: 'GROUP' })).toBe('GROUP()')
    expect(cellFunctionExpression({ kind: 'expr', expression: 'item.qty * 2' })).toBe(
      'item.qty * 2',
    )
  })
})

describe('旧表达式嗅探转换（normalizeCellFunction）', () => {
  test('可迁移：六函数单次调用 → 结构化 fn', () => {
    expect(normalizeCellFunction({ expression: "SUM('明细')" })).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '明细',
    })
    expect(normalizeCellFunction({ expression: "AVG('明细', 'price')" })).toEqual({
      kind: 'fn',
      fn: 'AVG',
      region: '明细',
      field: 'price',
    })
    // 手写空格随意：嗅探容忍空白
    expect(normalizeCellFunction({ expression: "SUBTOTAL( '明细' , 'qty' )" })).toEqual({
      kind: 'fn',
      fn: 'SUBTOTAL',
      region: '明细',
      field: 'qty',
    })
    expect(normalizeCellFunction({ expression: 'GROUP()' })).toEqual({ kind: 'fn', fn: 'GROUP' })
    expect(normalizeCellFunction({ expression: "GROUP('客户')" })).toEqual({
      kind: 'fn',
      fn: 'GROUP',
      field: '客户',
    })
  })

  test('不可迁移：复合表达式 / item / agg / 空数据块名 → expr 原样保留', () => {
    expect(normalizeCellFunction({ expression: "SUM('明细') + 1" })).toEqual({
      kind: 'expr',
      expression: "SUM('明细') + 1",
    })
    expect(normalizeCellFunction({ expression: 'item.qty * item.price' })).toEqual({
      kind: 'expr',
      expression: 'item.qty * item.price',
    })
    expect(normalizeCellFunction({ expression: "agg.summary['总计']" })).toEqual({
      kind: 'expr',
      expression: "agg.summary['总计']",
    })
    // 空数据块名带不进结构化（求值期会给出指引报错），保持原样
    expect(normalizeCellFunction({ expression: "SUM('')" })).toEqual({
      kind: 'expr',
      expression: "SUM('')",
    })
  })

  test('嗅探结果与手写表达式求值等价（同一环境同值）', () => {
    const legacy = "SUM('明细', 'qty')"
    const converted = normalizeCellFunction({ expression: legacy })
    expect(converted).toEqual({ kind: 'fn', fn: 'SUM', region: '明细', field: 'qty' })
    expect(evaluateCellFunction(cellFunctionExpression(converted as FormCellFunction), env())).toBe(
      evaluateCellFunction(legacy, env()),
    )
  })
})

describe('点选参数格推导（deriveParamCell：UI 与测试共用的纯函数）', () => {
  // 布局：无源静态区 0:0-2:7；带源明细区（自定义名「明细」）5:0-9:7；
  // 3-4 行是数据块外。绑定：H6=amount（明细区）、A1=title（无源区）、B7=空路径；
  // C7 上有既有函数格
  const regions: FormRegion[] = [
    { startRow: 0, endRow: 2, startCol: 0, endCol: 7, expand: 'none' },
    {
      startRow: 5,
      endRow: 9,
      startCol: 0,
      endCol: 7,
      expand: 'down',
      name: '明细',
      source: { kind: 'dataset', datasetId: 'ds1', path: '' },
    },
  ]
  const key = (row: number, col: number): string => `${row}:${col}`
  const bindings = new Map<string, FormCellBinding>([
    [key(5, 7), { path: 'amount' }],
    [key(0, 0), { path: 'title' }],
    [key(6, 1), { path: '' }],
  ])
  const functions = new Map<string, FormCellFunction>([
    [key(6, 2), { kind: 'fn', fn: 'SUM', region: '明细' }],
  ])
  const source: ParamCellSource = {
    regions,
    bindingOf: (addr) => bindings.get(key(addr.row, addr.col)),
    functionOf: (addr) => functions.get(key(addr.row, addr.col)),
  }

  test('成功：带源数据块内的字段绑定格 → 数据块引用名 + 字段路径', () => {
    expect(deriveParamCell(source, ADDR(5, 7))).toEqual({
      ok: true,
      region: '明细',
      field: 'amount',
    })
  })

  test('成功：未命名数据块回落缺省引用名「数据块 N」', () => {
    const unnamed: ParamCellSource = {
      ...source,
      regions: [{ ...regions[1]!, name: undefined }],
    }
    expect(deriveParamCell(unnamed, ADDR(5, 7))).toEqual({
      ok: true,
      region: '数据块 1',
      field: 'amount',
    })
  })

  test('失败：数据块外 / 无源的数据块 / 函数格 / 空格，各给中文原因', () => {
    const outside = deriveParamCell(source, ADDR(4, 0))
    expect(outside.ok).toBe(false)
    expect(!outside.ok && outside.reason).toContain('不在任何数据块')

    const noSource = deriveParamCell(source, ADDR(0, 0))
    expect(noSource.ok).toBe(false)
    expect(!noSource.ok && noSource.reason).toContain('数据源')

    const fnCell = deriveParamCell(source, ADDR(6, 2))
    expect(fnCell.ok).toBe(false)
    expect(!fnCell.ok && fnCell.reason).toContain('函数格')

    const empty = deriveParamCell(source, ADDR(7, 3))
    expect(empty.ok).toBe(false)
    expect(!empty.ok && empty.reason).toContain('没有绑定字段')
  })

  test('失败：空路径绑定（条目本身）不能当函数参数', () => {
    const emptyPath = deriveParamCell(source, ADDR(6, 1))
    expect(emptyPath.ok).toBe(false)
    expect(!emptyPath.ok && emptyPath.reason).toContain('空路径')
  })

  test('推导结果直接拼载荷：合成表达式与手写一致', () => {
    const derived = deriveParamCell(source, ADDR(5, 7))
    expect(derived.ok).toBe(true)
    if (!derived.ok) return
    expect(
      cellFunctionExpression({
        kind: 'fn',
        fn: 'SUM',
        region: derived.region,
        field: derived.field,
      }),
    ).toBe("SUM('明细', 'amount')")
    // GROUP 同流程：只取被点格字段
    expect(cellFunctionExpression({ kind: 'fn', fn: 'GROUP', field: derived.field })).toBe(
      "GROUP('amount')",
    )
  })
})

describe('函数目录元数据（编辑器下拉与帮助浮层共用）', () => {
  test('每个条目都有中文名、一句话说明、签名与示例，签名以名称开头', () => {
    expect(CELL_FUNCTION_CATALOG.length).toBeGreaterThanOrEqual(9)
    for (const item of CELL_FUNCTION_CATALOG) {
      expect(item.label).toBeTruthy()
      expect(item.title).toBeTruthy()
      expect(item.example).toBeTruthy()
      expect(item.signature.startsWith(item.name)).toBe(true)
    }
  })

  test('数据块函数齐全（下拉选项序），item/agg 引用只进帮助浮层', () => {
    const names = CELL_FUNCTION_CATALOG.map((item) => [item.kind, item.name] as const)
    expect(names.filter(([kind]) => kind === 'region').map(([, name]) => name)).toEqual([
      'SUM',
      'AVG',
      'COUNT',
      'MIN',
      'MAX',
      'SUBTOTAL',
    ])
    expect(names.filter(([kind]) => kind === 'fn').map(([, name]) => name)).toEqual(['GROUP'])
    expect(names.filter(([kind]) => kind === 'ref').map(([, name]) => name)).toEqual([
      'item',
      'agg',
    ])
  })

  test('cellFnLabel 取目录中文名（点选提示条与面板共用）', () => {
    expect(cellFnLabel('SUM')).toBe('求和')
    expect(cellFnLabel('GROUP')).toBe('分组值')
  })
})

describe('参数校验与错误分类', () => {
  test('数据块名必须是字符串、未知数据块快速失败', () => {
    expect(() => evaluateCellFunction('SUM(123)', env())).toThrow('第一个参数')
    expect(() => evaluateCellFunction("SUM('nope')", env())).toThrow('没有名为')
  })

  test('同列省字段但该列无绑定时给出指引', () => {
    const env2 = env({
      columnFieldOf: () => {
        throw new Error(
          "数据块「明细」在函数格所在列没有字段绑定：请写明字段，如 SUM('明细', '数量')",
        )
      },
    })
    expect(() => evaluateCellFunction("SUM('明细')", env2)).toThrow('请写明字段')
  })

  test('语法错误分类为 compile，运行期错误分类为 runtime', () => {
    expect(() => evaluateCellFunction('1 +', env())).toThrow(ExprError)
    const compileError = thrownOf(() => evaluateCellFunction('1 +', env())) as ExprError
    expect(compileError.phase).toBe('compile')
    try {
      evaluateCellFunction('item.x.y.z', env({ item: {} }))
      // item 为空对象时 undefined 下探不抛错——换真抛错的表达式
    } catch {
      // 不应进入
    }
    const runtimeError = thrownOf(() => evaluateCellFunction('null.x', env())) as ExprError
    expect(runtimeError.phase).toBe('runtime')
  })
})
