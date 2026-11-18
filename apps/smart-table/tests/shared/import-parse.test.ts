// 浏览器端导入解析纯逻辑测试：hucre 解析 xlsx/CSV、列类型推断与 key 清洗、类型规整与初始记录构建。
import { writeXlsx } from 'hucre/xlsx'
import { describe, expect, test } from 'vitest'
import {
  buildImportRecords,
  buildMappedImportRecords,
  coerceImportCell,
  matchImportColumns,
  parseImportFile,
} from '../../src/shared/import-parse'
import type { ImportPreviewColumn } from '../../src/shared/api-types'
import { validateBatchRecords } from '../../src/shared/record-validation'
import type { SmartColumn } from '../../src/shared/schema'

function csvFile(content: string): File {
  return new File([content], 'import.csv', { type: 'text/csv' })
}

describe('parseImportFile：xlsx 二进制（魔数 PK）解析', () => {
  test('sheet 名建议表名、列类型推断与表头 key 清洗去重', async () => {
    const xlsxBytes = await writeXlsx({
      sheets: [
        {
          name: '渠道线索',
          rows: [
            ['线索ID', '公司名称', '预算', '创建日期', '负责人'],
            ['L-001', '杭州云脉科技', '120000', '2025-03-01', '张三'],
            ['L-002', '苏州深蓝智造', '80000', '2025/3/5', '李四'],
            ['L-003', '广州湾区数联', '', '2025-03-12', '王五'],
          ],
        },
      ],
    })
    const preview = await parseImportFile(new File([new Uint8Array(xlsxBytes)], '渠道线索.xlsx'))
    expect(preview.suggestedName).toBe('渠道线索')
    // key 清洗：中文表头退化为 col_N，混排「线索ID」抽出 ID；类型推断 number/date/text
    expect(preview.columns.map((c) => c.key)).toEqual(['ID', 'col_2', 'col_3', 'col_4', 'col_5'])
    expect(preview.columns.map((c) => c.type)).toEqual(['text', 'text', 'number', 'date', 'text'])
    expect(preview.columns.map((c) => c.label)).toEqual([
      '线索ID',
      '公司名称',
      '预算',
      '创建日期',
      '负责人',
    ])
    expect(preview.totalRows).toBe(3)
    expect(preview.rows).toHaveLength(3)
    expect(preview.rows[0]).toEqual(['L-001', '杭州云脉科技', '120000', '2025-03-01', '张三'])
    expect(preview.truncated).toBe(false)
  })
})

describe('parseImportFile：CSV 文本解析', () => {
  test('重复表头 key 追加序号去重；空表头退化为 col_N；日期列推断', async () => {
    const preview = await parseImportFile(
      csvFile(['name,amount,,name', 'a,1,2025-01-01,x', 'b,2,2025-01-02,y'].join('\n')),
    )
    expect(preview.suggestedName).toBe('导入数据')
    expect(preview.columns.map((c) => c.key)).toEqual(['name', 'amount', 'col_3', 'name_2'])
    expect(preview.columns.map((c) => c.type)).toEqual(['text', 'number', 'date', 'text'])
    expect(preview.totalRows).toBe(2)
    expect(preview.rows).toEqual([
      ['a', '1', '2025-01-01', 'x'],
      ['b', '2', '2025-01-02', 'y'],
    ])
    expect(preview.truncated).toBe(false)
  })

  test('超过 50 列截断并标注 truncated；只有表头时 totalRows 为 0', async () => {
    const wideHeader = Array.from({ length: 51 }, (_, i) => `c${i}`)
    const wideRow = Array.from({ length: 51 }, (_, i) => String(i))
    const wide = await parseImportFile(
      csvFile([wideHeader.join(','), wideRow.join(',')].join('\n')),
    )
    expect(wide.columns).toHaveLength(50)
    expect(wide.columns.at(-1)?.key).toBe('c49')
    expect(wide.truncated).toBe(true)

    const headerOnly = await parseImportFile(csvFile('a,b\n'))
    expect(headerOnly.totalRows).toBe(0)
    expect(headerOnly.rows).toEqual([])
  })

  test('空文件抛错（缺少表头行）', async () => {
    await expect(parseImportFile(csvFile(''))).rejects.toThrow('文件内容为空')
  })
})

describe('coerceImportCell / buildImportRecords', () => {
  const columns: ImportPreviewColumn[] = [
    { key: 'name', label: '姓名', type: 'text' },
    { key: 'amount', label: '金额', type: 'number' },
  ]

  test('数值列转数字、空串转 null、文本列保持字符串', () => {
    expect(coerceImportCell('120.5', 'number')).toBe(120.5)
    expect(coerceImportCell('  ', 'number')).toBeNull()
    expect(coerceImportCell('2025-01-01', 'date')).toBe('2025-01-01')
    expect(() => coerceImportCell('abc', 'number')).toThrow('数值列存在非法值')
  })

  test('行矩阵 → 建表初始记录：空数值不写入、行宽不足补空', () => {
    const records = buildImportRecords(columns, [['张三', '100'], ['李四', ''], ['王五']])
    expect(records).toEqual([{ name: '张三', amount: 100 }, { name: '李四' }, { name: '王五' }])
  })
})

describe('matchImportColumns / buildMappedImportRecords', () => {
  const targetColumns: SmartColumn[] = [
    { key: 'project_code', title: '项目编号', type: 'text', width: 120, required: true },
    { key: 'contract_amount', title: '合同金额', type: 'number', width: 120, required: true },
    { key: 'due_date', title: '交付日期', type: 'date', width: 120 },
    {
      key: 'lookup_dept',
      title: '所属部门',
      type: 'lookup',
      width: 120,
    },
  ]

  test('按列标题精确、key 精确与常见归一化匹配，且跳过目标派生列', () => {
    const importCols: ImportPreviewColumn[] = [
      { key: 'col_1', label: '项目编号*', type: 'text' }, // 归一化去 * 匹配
      { key: 'contractAmount', label: 'Contract Amount', type: 'number' }, // 归一化去空格匹配 key
      { key: 'col_3', label: '交付日期', type: 'date' }, // 标题精确匹配
      { key: 'col_4', label: '所属部门', type: 'text' }, // 目标为 lookup，不匹配
      { key: 'col_5', label: '备注列', type: 'text' }, // 未命中
    ]

    const mappings = matchImportColumns(importCols, targetColumns)
    expect(mappings.map((m) => m.targetField)).toEqual([
      'project_code',
      'contract_amount',
      'due_date',
      null,
      null,
    ])
  })

  test('buildMappedImportRecords 按映射转换并保留非法值供批量校验收集错误', () => {
    const importCols: ImportPreviewColumn[] = [
      { key: 'c1', label: '项目编号', type: 'text' },
      { key: 'c2', label: '合同金额', type: 'number' },
      { key: 'c3', label: '交付日期', type: 'date' },
    ]
    const mappings = matchImportColumns(importCols, targetColumns)
    const mapped = buildMappedImportRecords(mappings, targetColumns, [
      ['P-1', '12000', '2026/4/1'],
      ['P-2', 'bad_num', '2026-04-02'],
    ])

    expect(mapped).toEqual([
      { project_code: 'P-1', contract_amount: 12000, due_date: '2026-04-01' },
      { project_code: 'P-2', contract_amount: 'bad_num', due_date: '2026-04-02' },
    ])

    const batch = validateBatchRecords(targetColumns, mapped)
    expect(batch.valid).toBe(false)
    expect(batch.errors).toEqual([
      {
        rowIndex: 1,
        field: 'contract_amount',
        columnTitle: '合同金额',
        message: '请输入有效数值',
      },
    ])
  })
})
