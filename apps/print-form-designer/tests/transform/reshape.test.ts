// P7 转换器口径：扁平行 → 嵌套对象、嵌套二级数组构造/取数、分组聚合、重复调用同输入同输出、错误相位。
import { describe, expect, test } from 'vitest'
import {
  reshapeRows,
  TransformError,
  type SourceRow,
  type TransformDefinition,
} from '../../src/transform/reshape'

// 订单明细原始行（扁平行：一明细一行，单头字段随行重复）
const ORDER_ROWS: SourceRow[] = [
  { order_no: 'SO-2026-001', customer: '华信科技', item_name: 'A4 打印纸', qty: 10, amount: 450 },
  { order_no: 'SO-2026-001', customer: '华信科技', item_name: '碳粉盒', qty: 2, amount: 760 },
  { order_no: 'SO-2026-002', customer: '蓝湾物流', item_name: '面单纸', qty: 5, amount: 150 },
]

const reshape = (definition: TransformDefinition, rows: SourceRow[]) =>
  reshapeRows(definition, rows)

describe('数据重塑转换器', () => {
  test('扁平行重塑为嵌套对象（单头收拢 + 汇总）', () => {
    const result = reshape(
      {
        expression: `(() => {
          const head = rows[0]
          return {
            order: { no: head.order_no, customer: head.customer },
            itemCount: rows.length,
            totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
          }
        })()`,
      },
      ORDER_ROWS,
    )
    expect(result).toEqual({
      order: { no: 'SO-2026-001', customer: '华信科技' },
      itemCount: 3,
      totalAmount: 1360,
    })
  })

  test('二级数组构造：按单号分组为订单数组，每单挂明细二级数组', () => {
    const result = reshape(
      {
        expression: `(() => {
          const orders = []
          const byNo = new Map()
          for (const row of rows) {
            let order = byNo.get(row.order_no)
            if (order === undefined) {
              order = { orderNo: row.order_no, customer: row.customer, lines: [] }
              byNo.set(row.order_no, order)
              orders.push(order)
            }
            order.lines.push({ name: row.item_name, qty: row.qty, amount: row.amount })
          }
          return { orders }
        })()`,
      },
      ORDER_ROWS,
    )
    expect(result).toEqual({
      orders: [
        {
          orderNo: 'SO-2026-001',
          customer: '华信科技',
          lines: [
            { name: 'A4 打印纸', qty: 10, amount: 450 },
            { name: '碳粉盒', qty: 2, amount: 760 },
          ],
        },
        {
          orderNo: 'SO-2026-002',
          customer: '蓝湾物流',
          lines: [{ name: '面单纸', qty: 5, amount: 150 }],
        },
      ],
    })
  })

  test('二级数组取数：行内嵌套数组字段展开为扁平明细', () => {
    const nestedRows: SourceRow[] = [
      {
        order_no: 'SO-2026-001',
        lines: [
          { sku: 'P-A4', qty: 10 },
          { sku: 'P-TN', qty: 2 },
        ],
      },
      { order_no: 'SO-2026-002', lines: [{ sku: 'P-WB', qty: 5 }] },
    ]
    const result = reshape(
      {
        expression: `rows.flatMap((row) =>
          row.lines.map((line) => ({ orderNo: row.order_no, sku: line.sku, qty: line.qty })),
        )`,
      },
      nestedRows,
    )
    expect(result).toEqual([
      { orderNo: 'SO-2026-001', sku: 'P-A4', qty: 10 },
      { orderNo: 'SO-2026-001', sku: 'P-TN', qty: 2 },
      { orderNo: 'SO-2026-002', sku: 'P-WB', qty: 5 },
    ])
  })

  test('分组聚合样例：按类别聚合条数与金额', () => {
    const categoryRows: SourceRow[] = [
      { category: '耗材', amount: 450 },
      { category: '设备', amount: 3200 },
      { category: '耗材', amount: 150 },
    ]
    const result = reshape(
      {
        expression: `(() => {
          const groups = new Map()
          for (const row of rows) {
            const list = groups.get(row.category) ?? []
            list.push(row)
            groups.set(row.category, list)
          }
          return Array.from(groups, ([category, list]) => ({
            category,
            count: list.length,
            total: list.reduce((sum, row) => sum + row.amount, 0),
          }))
        })()`,
      },
      categoryRows,
    )
    expect(result).toEqual([
      { category: '耗材', count: 2, total: 600 },
      { category: '设备', count: 1, total: 3200 },
    ])
  })

  test('重复调用同输入同输出（入参按只读约定共享，表达式不改写 rows）', () => {
    const rows = ORDER_ROWS.map((row) => ({ ...row }))
    const definition: TransformDefinition = {
      expression: `rows
        .slice()
        .sort((a, b) => b.amount - a.amount)
        .map((row) => row.item_name)`,
    }
    const first = reshape(definition, rows)
    const second = reshape(definition, rows)
    expect(first).toEqual(['碳粉盒', 'A4 打印纸', '面单纸'])
    expect(second).toEqual(first)
    // 只读约定：求值环境直接共享调用方数据，不做防御性克隆
    expect(rows).toEqual(ORDER_ROWS.map((row) => ({ ...row })))
  })

  test('错误相位：空/语法错误为编译期，求值抛错为求值期', () => {
    // 捕获器只抓错（应抛未抛时炸出），类型断言与相位断言平铺在外
    const capture = (expression: string, rows: SourceRow[]): unknown => {
      try {
        reshape({ expression }, rows)
      } catch (error) {
        return error
      }
      throw new Error('应抛错但未抛')
    }
    const empty = capture('   ', [])
    expect(empty).toBeInstanceOf(TransformError)
    expect((empty as TransformError).phase).toBe('compile')
    const syntax = capture('rows..', [])
    expect(syntax).toBeInstanceOf(TransformError)
    expect((syntax as TransformError).phase).toBe('compile')
    const runtime = capture('rows[0].nope.deep', [{ id: 1 }])
    expect(runtime).toBeInstanceOf(TransformError)
    expect((runtime as TransformError).phase).toBe('runtime')
  })
})
