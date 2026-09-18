import { describe, expect, it } from 'vitest'

import type { TablePlugin } from '../src/index'

describe('plugins 公共入口', () => {
  it('插件契约类型可用：TablePlugin 形态对象可赋值（name/mount/可选 unmount）', () => {
    const mounted: string[] = []
    const plugin: TablePlugin = {
      name: 'entry-smoke',
      mount: (table) => {
        // 参数类型为 ListTable（契约类型断言在编译层完成）；完整挂载链路由
        // core 自身测试与 S3 插件测试覆盖，此处不构造真实表格（node 环境无 canvas）
        void table
        mounted.push('mounted')
      },
    }
    expect(plugin.name).toBe('entry-smoke')
    expect(plugin.mount).toBeTypeOf('function')
    plugin.mount?.({} as Parameters<TablePlugin['mount']>[0])
    expect(mounted).toEqual(['mounted'])

    // 可选卸载钩子可省略
    const minimal: TablePlugin = { name: 'minimal', mount: () => {} }
    expect(minimal.unmount).toBeUndefined()
  })
})
