// P6 绑定域测试：路径解析/还原、取值（嵌套二级数组、明细循环语境、聚合）、
// 区域循环数组定位（loopArrayAt）、展开区条目取值（resolveItemValue，含相对路径
// 禁 [] 口径）、数据集形态入口缺省口径、绑定树（嵌套二级数组节点）、
// 绑定元数据（数据集 + 路径 + 表达式 + 聚合）随模板 JSON round-trip 不丢。
import { describe, expect, test } from 'bun:test'

import {
  buildBindingTree,
  formatBindingPath,
  loopArrayAt,
  parseBindingPath,
  reshapeDatasetData,
  resolveBindingValue,
  resolveItemValue,
} from '../../src/designer/binding'
import { FormDoc } from '../../src/designer/form-doc'
import type { FormCellBinding } from '../../src/designer/template'
import { ADDR } from './testing/fixtures'

describe('路径解析与还原', () => {
  test('对象/下标/循环标记任意深度组合 round-trip', () => {
    for (const path of [
      'customer.name',
      'items[0].price',
      'items[].price',
      '[0].name',
      '[]',
      'matrix[0][1]',
      'orders[0].lines[].qty',
    ]) {
      expect(formatBindingPath(parseBindingPath(path))).toBe(path)
    }
  })

  test('非法路径抛错', () => {
    expect(() => parseBindingPath('')).toThrow('路径不能为空')
    expect(() => parseBindingPath('a..b')).toThrow('路径段非法')
    expect(() => parseBindingPath('a[x]')).toThrow('数组下标非法')
    expect(() => parseBindingPath('a[].b[]')).toThrow('最多一个 [] 循环标记')
  })
})

describe('绑定取值', () => {
  const shape = {
    customer: { name: '甲公司' },
    items: [
      { name: '货架', price: 120, lines: [{ qty: 2 }, { qty: 5 }] },
      { name: '推车', price: 80, lines: [{ qty: 1 }] },
    ],
  }
  const bind = (path: string, aggregate?: FormCellBinding['aggregate']): FormCellBinding => ({
    datasetId: 'ds1',
    path,
    aggregate,
  })

  test('对象直取与嵌套二级数组下标取数', () => {
    expect(resolveBindingValue(shape, bind('customer.name'), {})).toBe('甲公司')
    expect(resolveBindingValue(shape, bind('items[1].name'), {})).toBe('推车')
    expect(resolveBindingValue(shape, bind('items[0].lines[1].qty'), {})).toBe(5)
    expect(resolveBindingValue(shape, bind('items[3].name'), {})).toBeUndefined()
    expect(resolveBindingValue(shape, bind('customer.missing'), {})).toBeUndefined()
  })

  test('明细语境：[] 按行下标逐行取值（含嵌套二级数组循环目标层）', () => {
    expect(resolveBindingValue(shape, bind('items[].name'), { each: 0 })).toBe('货架')
    expect(resolveBindingValue(shape, bind('items[].price'), { each: 1 })).toBe(80)
    expect(resolveBindingValue(shape, bind('items[].name'), { each: 2 })).toBeUndefined()
    expect(resolveBindingValue(shape, bind('items[0].lines[].qty'), { each: 1 })).toBe(5)
  })

  test('非明细语境：[] 需聚合，缺省无值', () => {
    expect(resolveBindingValue(shape, bind('items[].price'), {})).toBeUndefined()
    expect(resolveBindingValue(shape, bind('items[].price', 'sum'), {})).toBe(200)
    expect(resolveBindingValue(shape, bind('items[].price', 'avg'), {})).toBe(100)
    expect(resolveBindingValue(shape, bind('items[].name', 'count'), {})).toBe(2)
    expect(resolveBindingValue(shape, bind('items[].price', 'max'), {})).toBe(120)
    expect(resolveBindingValue(shape, bind('items[].price', 'min'), {})).toBe(80)
  })

  test('聚合跳过空值，数值聚合只吃 number', () => {
    const mixed = { xs: [{ v: 1 }, { v: 'x' }, { v: 3 }, {}, { v: null }] }
    expect(resolveBindingValue(mixed, bind('xs[].v', 'sum'), {})).toBe(4)
    expect(resolveBindingValue(mixed, bind('xs[].v', 'count'), {})).toBe(3)
    expect(resolveBindingValue(mixed, bind('xs[].v', 'avg'), {})).toBe(2)
    expect(resolveBindingValue({ xs: [] }, bind('xs[].v', 'max'), {})).toBeUndefined()
  })

  test('对象/数组结果不进格', () => {
    expect(resolveBindingValue(shape, bind('customer'), {})).toBeUndefined()
    expect(resolveBindingValue(shape, bind('items'), {})).toBeUndefined()
  })
})

describe('区域循环数组（loopArrayAt）', () => {
  const shape = {
    items: [{ name: '甲' }, { name: '乙' }],
    order: { lines: [{ qty: 1 }] },
    nested: [{ items: [{ v: 1 }, { v: 2 }, { v: 3 }] }],
    empty: [],
    scalar: 42,
  }

  test("path 为 ''：形态根即数组", () => {
    expect(loopArrayAt([1, 2, 3], '')).toEqual([1, 2, 3])
    expect(loopArrayAt([], '')).toEqual([])
    // 根不是数组 → 取不到（按「无 source」处理）
    expect(loopArrayAt(shape, '')).toBeUndefined()
    expect(loopArrayAt(undefined, '')).toBeUndefined()
    expect(loopArrayAt(shape, '   ')).toBeUndefined()
  })

  test('点分路径与下标前缀（嵌套二级数组）', () => {
    expect(loopArrayAt(shape, 'items')).toHaveLength(2)
    expect(loopArrayAt(shape, 'order.lines')).toHaveLength(1)
    expect(loopArrayAt(shape, 'nested[0].items')).toHaveLength(3)
  })

  test('取到空数组 = 0 份；取不到/非数组 = undefined', () => {
    expect(loopArrayAt(shape, 'empty')).toEqual([])
    expect(loopArrayAt(shape, 'scalar')).toBeUndefined()
    expect(loopArrayAt(shape, 'order')).toBeUndefined()
    expect(loopArrayAt(shape, 'missing')).toBeUndefined()
    expect(loopArrayAt(undefined, 'items')).toBeUndefined()
  })

  test('路径语法非法快速失败（不静默兜底）', () => {
    expect(() => loopArrayAt(shape, 'items[0')).toThrow('路径段非法')
    expect(() => loopArrayAt(shape, 'items[x]')).toThrow('数组下标非法')
  })
})

describe('展开区条目取值（resolveItemValue）', () => {
  const item = { name: '货架', price: 120, customer: { name: '甲公司' }, lines: [{ qty: 2 }] }

  test("relativePath 为 '' 时条目本身进格（仅原始类型）", () => {
    expect(resolveItemValue('甲', '')).toBe('甲')
    expect(resolveItemValue(3, '')).toBe(3)
    expect(resolveItemValue(false, '')).toBe(false)
    // 对象/数组/null/undefined 不进格
    expect(resolveItemValue(item, '')).toBeUndefined()
    expect(resolveItemValue([1], '')).toBeUndefined()
    expect(resolveItemValue(null, '')).toBeUndefined()
  })

  test('相对字段路径逐段下探（含嵌套对象与固定下标）', () => {
    expect(resolveItemValue(item, 'name')).toBe('货架')
    expect(resolveItemValue(item, 'customer.name')).toBe('甲公司')
    expect(resolveItemValue(item, 'lines[0].qty')).toBe(2)
    expect(resolveItemValue(item, 'missing')).toBeUndefined()
    expect(resolveItemValue(undefined, 'name')).toBeUndefined()
  })

  test('相对路径不允许出现 [] 循环标记（条目内再循环无落点，快速失败）', () => {
    expect(() => resolveItemValue(item, 'lines[].qty')).toThrow('不能含 [] 循环标记')
    expect(() => resolveItemValue(item, '[]')).toThrow('不能含 [] 循环标记')
  })
})

describe('数据集形态入口', () => {
  const rows = [
    { name: 'a', qty: 1 },
    { name: 'b', qty: 2 },
  ]

  test('缺省表达式 = 原始行数组直接作形态', () => {
    expect(reshapeDatasetData(undefined, rows)).toBe(rows)
    expect(reshapeDatasetData('  ', rows)).toBe(rows)
  })

  test('表达式经 reshapeRows 唯一管线求值', () => {
    expect(reshapeDatasetData('rows.length', rows)).toBe(2)
    expect(reshapeDatasetData('rows.map(r => r.name)', rows)).toEqual(['a', 'b'])
    expect(() => reshapeDatasetData('rows.', rows)).toThrow('编译失败')
  })
})

describe('绑定树（路径选择器数据源）', () => {
  test('嵌套二级数组节点下钻，且只生成一个 [] 循环层', () => {
    const shape = { orders: [{ no: 'A', lines: [{ qty: 2 }] }] }
    const tree = buildBindingTree(shape)
    expect(tree.map((node) => node.path)).toEqual(['orders'])
    const orders = tree[0]!
    expect(orders.kind).toBe('array')
    expect(orders.children!.map((node) => node.label)).toEqual(['[]', '[0]'])
    const lines = orders.children![0]!.children!.find((node) => node.label === 'lines')!
    expect(lines.path).toBe('orders[].lines')
    // 已在 [] 分支内：嵌套数组只给 [0] 采样，不再给第二个 []
    expect(lines.children!.map((node) => node.label)).toEqual(['[0]'])
    expect(lines.children![0]!.children!.map((node) => node.path)).toEqual([
      'orders[].lines[0].qty',
    ])
  })

  test('根数组直接给 []/[0] 入口', () => {
    const tree = buildBindingTree([{ a: 1 }, { a: 2 }])
    expect(tree.map((node) => node.path)).toEqual(['[]', '[0]'])
    expect(tree[0]!.children!.map((node) => node.path)).toEqual(['[].a'])
    expect(tree[1]!.children!.map((node) => node.path)).toEqual(['[0].a'])
  })

  test('标量形态无可选路径', () => {
    expect(buildBindingTree(42)).toEqual([])
  })
})

describe('绑定元数据落模板 JSON', () => {
  test('数据集 + 表达式 + 路径 + 聚合随 sidecar round-trip 不丢', () => {
    const doc = FormDoc.create(8)
    doc.setCellBinding(ADDR(4, 1), {
      datasetId: 'ds1',
      expression: 'rows.map(r => ({ name: r.name, lines: [r] }))',
      path: 'items[].price',
      aggregate: 'sum',
    })
    const restored = FormDoc.fromTemplate(doc.toTemplate('t'))
    expect(restored.getCellBinding(ADDR(4, 1))).toEqual({
      datasetId: 'ds1',
      expression: 'rows.map(r => ({ name: r.name, lines: [r] }))',
      path: 'items[].price',
      aggregate: 'sum',
    })
  })
})
