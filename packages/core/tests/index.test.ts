import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/index'
import { createRenderHost } from '@infinite-table/render'

describe('monorepo 骨架冒烟', () => {
  it('core 与 render 公共入口可解析', () => {
    expect(typeof ListTable).toBe('function')
    expect(typeof createRenderHost).toBe('function')
  })
})
