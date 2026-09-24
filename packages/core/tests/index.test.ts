import { describe, expect, it } from 'vitest'

import { type FloatDragEndEvent, ListTable } from '../src/index'
import { createRenderHost } from '@infinite-table/render'

describe('monorepo 骨架冒烟', () => {
  it('core 与 render 公共入口可解析', () => {
    expect(typeof ListTable).toBe('function')
    expect(typeof createRenderHost).toBe('function')
  })

  it('FloatDragEndEvent 类型可从公开入口导入', () => {
    const event: FloatDragEndEvent = {
      id: 'img-1',
      anchor: { from: { col: 0, row: 0 }, to: { col: 1, row: 1 }, offsetX: 0, offsetY: 0 },
    }
    expect(event.id).toBe('img-1')
    expect(event.anchor.from).toEqual({ col: 0, row: 0 })
  })
})
