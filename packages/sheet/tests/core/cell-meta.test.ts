import { describe, expect, it } from 'vitest'

import { cloneCellMetaPayload } from '../../src/core/cell-meta'

// 底座部分：仅纯函数用例。Sheet 模型层的 meta 用例（存取 / undo / 快照 / 结构平移）
// 依赖 sheet.ts 模型，随模型层迁入后补回。

describe('cloneCellMetaPayload', () => {
  it('structuredClone 不可克隆时回退 JSON 深拷贝', () => {
    const raw = { a: 1, b: { c: 2 } }
    const payload = { ...raw, fn: () => 1 }
    const cloned = cloneCellMetaPayload(payload) as typeof raw
    expect(cloned).toEqual({ a: 1, b: { c: 2 } })
    expect(cloned.b).not.toBe(raw.b)
  })
})
