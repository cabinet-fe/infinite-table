import { describe, expect, it } from 'vitest'

import type { ListTableOptions } from '@infinite-table/core'

import { excelKeymapPreset } from '../../src/sheet/keymap'

describe('excelKeymapPreset 键位预设', () => {
  it('Enter 进编辑、关闭 Ctrl 加选（对齐 ultra-ui 组合语义）', () => {
    expect(excelKeymapPreset.editCellOnEnter).toBe(true)
    expect(excelKeymapPreset.ctrlMultiSelect).toBe(false)
  })

  it('可直接展开进 ListTableOptions（类型兼容）', () => {
    const options: Partial<ListTableOptions> = { ...excelKeymapPreset }
    expect(options).toEqual(excelKeymapPreset)
  })
})
