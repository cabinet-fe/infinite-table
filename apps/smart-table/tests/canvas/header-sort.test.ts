// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { cycleSortRules } from '../../src/App'
import type { SortRule } from '../../src/shared/schema'

describe('cycleSortRules 列头点击排序循环', () => {
  it('非 additive：无→asc→desc→移除，且重置为仅该列一条规则', () => {
    const others: SortRule[] = [
      { field: 'owner', direction: 'asc' },
      { field: 'status', direction: 'desc' },
    ]

    expect(cycleSortRules(others, 'name', false)).toEqual([{ field: 'name', direction: 'asc' }])
    expect(
      cycleSortRules([{ ...others[0]! }, { field: 'name', direction: 'asc' }], 'name', false),
    ).toEqual([{ field: 'name', direction: 'desc' }])
    expect(cycleSortRules([{ field: 'name', direction: 'desc' }], 'name', false)).toEqual([])
  })

  it('additive：已有规则原地循环且不塌缩其它规则，无规则时追加', () => {
    const owner: SortRule = { field: 'owner', direction: 'asc' }

    expect(cycleSortRules([owner], 'name', true)).toEqual([
      owner,
      { field: 'name', direction: 'asc' },
    ])

    const nameAsc: SortRule = { field: 'name', direction: 'asc' }
    expect(cycleSortRules([owner, nameAsc], 'name', true)).toEqual([
      owner,
      { field: 'name', direction: 'desc' },
    ])

    const nameDesc: SortRule = { field: 'name', direction: 'desc' }
    expect(cycleSortRules([owner, nameDesc], 'name', true)).toEqual([owner])
  })
})
