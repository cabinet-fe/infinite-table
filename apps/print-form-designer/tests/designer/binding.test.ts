// 绑定域测试（v4）：路径解析/还原、数据块循环数组定位（loopArrayAt）、数据块内条目
// 取值（resolveItemValue，含相对路径禁 [] 口径）、数据集形态入口缺省口径、
// 绑定树（嵌套二级数组节点）、绑定/函数 sidecar 随模板 JSON round-trip 不丢。
// 绝对绑定与单元格聚合已删除（由 cell-function.test.ts 覆盖函数体系）。
import { describe, expect, test } from 'vitest'

import {
  buildBindingTree,
  formatBindingPath,
  loopArrayAt,
  parseBindingPath,
  reshapeDatasetData,
  resolveItemValue,
} from '../../src/designer/binding'
import { FormDoc } from '../../src/domain/form-doc'
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

describe('数据块循环数组（loopArrayAt）', () => {
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

describe('数据块内条目取值（resolveItemValue）', () => {
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

describe('sidecar 落模板 JSON', () => {
  test('绑定（条目内相对路径）与函数 round-trip 不丢', () => {
    const doc = FormDoc.create(8)
    doc.setCellBinding(ADDR(0, 1), { path: 'customer.name' })
    // 旧表达式形状写入即嗅探为结构化 fn，round-trip 后保持结构化形状
    doc.setCellFunction(ADDR(1, 1), { expression: "SUM('数据块 1', 'qty')" })
    const restored = FormDoc.fromTemplate(doc.toTemplate('t'))
    expect(restored.getCellBinding(ADDR(0, 1))).toEqual({ path: 'customer.name' })
    expect(restored.getCellFunction(ADDR(1, 1))).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '数据块 1',
      field: 'qty',
    })
  })

  test('绑定与函数互斥：写绑定清函数、写函数清绑定', () => {
    const doc = FormDoc.create(8)
    doc.setCellFunction(ADDR(0, 0), { expression: '1' })
    doc.setCellBinding(ADDR(0, 0), { path: 'name' })
    expect(doc.getCellFunction(ADDR(0, 0))).toBeUndefined()
    doc.setCellFunction(ADDR(0, 0), { expression: '2' })
    expect(doc.getCellBinding(ADDR(0, 0))).toBeUndefined()
    expect(doc.getCellFunction(ADDR(0, 0))).toMatchObject({ kind: 'expr', expression: '2' })
  })
})
