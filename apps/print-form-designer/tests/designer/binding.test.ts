// P6 绑定域测试：路径解析/还原、取值（嵌套二级数组、明细循环语境、聚合）、
// 明细循环数组定位、数据集形态入口缺省口径、绑定树（嵌套二级数组节点）、
// 绑定元数据（数据集 + 路径 + 表达式 + 聚合）随模板 JSON round-trip 不丢。
import { describe, expect, test } from 'bun:test'

import {
  buildBindingTree,
  detailLoopArray,
  formatBindingPath,
  parseBindingPath,
  reshapeDatasetData,
  resolveBindingValue,
} from '../../src/designer/binding'
import { FormDoc } from '../../src/designer/form-doc'
import type { FormCellBinding } from '../../src/designer/template'

const ADDR = (row: number, col: number) => ({ row, col })

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
    expect(resolveBindingValue(shape, bind('customer.name'))).toBe('甲公司')
    expect(resolveBindingValue(shape, bind('items[1].name'))).toBe('推车')
    expect(resolveBindingValue(shape, bind('items[0].lines[1].qty'))).toBe(5)
    expect(resolveBindingValue(shape, bind('items[3].name'))).toBeUndefined()
    expect(resolveBindingValue(shape, bind('customer.missing'))).toBeUndefined()
  })

  test('明细语境：[] 按行下标逐行取值（含嵌套二级数组循环目标层）', () => {
    expect(resolveBindingValue(shape, bind('items[].name'), { each: 0 })).toBe('货架')
    expect(resolveBindingValue(shape, bind('items[].price'), { each: 1 })).toBe(80)
    expect(resolveBindingValue(shape, bind('items[].name'), { each: 2 })).toBeUndefined()
    expect(resolveBindingValue(shape, bind('items[0].lines[].qty'), { each: 1 })).toBe(5)
  })

  test('非明细语境：[] 需聚合，缺省无值', () => {
    expect(resolveBindingValue(shape, bind('items[].price'))).toBeUndefined()
    expect(resolveBindingValue(shape, bind('items[].price', 'sum'))).toBe(200)
    expect(resolveBindingValue(shape, bind('items[].price', 'avg'))).toBe(100)
    expect(resolveBindingValue(shape, bind('items[].name', 'count'))).toBe(2)
    expect(resolveBindingValue(shape, bind('items[].price', 'max'))).toBe(120)
    expect(resolveBindingValue(shape, bind('items[].price', 'min'))).toBe(80)
  })

  test('聚合跳过空值，数值聚合只吃 number', () => {
    const mixed = { xs: [{ v: 1 }, { v: 'x' }, { v: 3 }, {}, { v: null }] }
    expect(resolveBindingValue(mixed, bind('xs[].v', 'sum'))).toBe(4)
    expect(resolveBindingValue(mixed, bind('xs[].v', 'count'))).toBe(3)
    expect(resolveBindingValue(mixed, bind('xs[].v', 'avg'))).toBe(2)
    expect(resolveBindingValue({ xs: [] }, bind('xs[].v', 'max'))).toBeUndefined()
  })

  test('对象/数组结果不进格', () => {
    expect(resolveBindingValue(shape, bind('customer'))).toBeUndefined()
    expect(resolveBindingValue(shape, bind('items'))).toBeUndefined()
  })

  test('明细循环数组定位（决定波段展开行数）', () => {
    expect(detailLoopArray(shape, bind('items[].name'))?.length).toBe(2)
    expect(detailLoopArray(shape, bind('items[0].lines[].qty'))?.length).toBe(2)
    expect(detailLoopArray(shape, bind('customer.name'))).toBeUndefined()
    expect(detailLoopArray(shape, bind('missing[].x'))).toBeUndefined()
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
    const doc = FormDoc.create()
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
