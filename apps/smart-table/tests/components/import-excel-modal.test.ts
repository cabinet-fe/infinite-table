// ImportExcelModal 纯逻辑：导入列配置编辑（key 稳定，重命名不产生标识符冲突）

import { describe, expect, test } from 'vitest'

import { updateImportColumn } from '../../src/components/ImportExcelModal'
import type { ImportPreviewColumn } from '../../src/shared/api-types'

const columns: ImportPreviewColumn[] = [
  { key: 'name', label: '姓名', type: 'text' },
  { key: 'amount', label: '金额', type: 'number' },
]

describe('updateImportColumn', () => {
  test('按 key 更新类型，未命中的列保持原引用（原数组不可变）', () => {
    const next = updateImportColumn(columns, 'amount', { type: 'date' })
    expect(next[0]).toBe(columns[0])
    expect(next[1]).toEqual({ key: 'amount', label: '金额', type: 'date' })
    expect(columns[1]!.type).toBe('number')
  })

  test('改标题保留 key：重命名后标识符仍唯一，不会与既有 key 冲突', () => {
    const next = updateImportColumn(columns, 'name', { label: 'amount' })
    expect(next[0]).toEqual({ key: 'name', label: 'amount', type: 'text' })
    expect(next.map((c) => c.key)).toEqual(['name', 'amount'])
  })

  test('未知 key 原样返回', () => {
    expect(updateImportColumn(columns, 'nope', { label: 'x' })).toEqual(columns)
  })
})
