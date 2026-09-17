import { describe, expect, it } from 'vitest'

import { CORE_DEPENDENCY_CHAIN, CORE_PACKAGE_NAME } from '../src/index'
import { RENDER_DEPENDENCY_CHAIN } from '@infinite-table/render'

describe('monorepo 骨架冒烟', () => {
  it('core → render → utils 依赖链可解析', () => {
    expect(CORE_PACKAGE_NAME).toBe('@infinite-table/core')
    expect(CORE_DEPENDENCY_CHAIN).toBe('@infinite-table/core -> @infinite-table/render')
    expect(RENDER_DEPENDENCY_CHAIN).toBe('@infinite-table/render -> @infinite-table/utils')
  })
})
