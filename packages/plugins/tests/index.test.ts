import { describe, expect, it } from 'vitest'

import type { EnginePlugin, GridReadView } from '../src/index'

describe('plugins 公共入口', () => {
  it('插件契约类型可用：EnginePlugin 形态对象可赋值（name/mount 返回可选清理函数/可选 unmount）', () => {
    const lifecycle: string[] = []
    const plugin: EnginePlugin = {
      name: 'entry-smoke',
      mount: (engine) => {
        // 参数类型为引擎装配协议面 EngineAssembly（P7：契约类型断言在编译层完成）
        void engine
        lifecycle.push('mounted')
        return () => {
          lifecycle.push('disposed')
        }
      },
    }
    expect(plugin.name).toBe('entry-smoke')
    expect(typeof plugin.mount).toBe('function')
    const dispose = plugin.mount({} as Parameters<EnginePlugin['mount']>[0])
    expect(lifecycle).toEqual(['mounted'])
    expect(typeof dispose).toBe('function')
    dispose?.()
    expect(lifecycle).toEqual(['mounted', 'disposed'])

    // 可选卸载钩子可省略，mount 也可不返回清理函数
    const minimal: EnginePlugin = { name: 'minimal', mount: () => {} }
    expect('unmount' in minimal).toBe(false)
  })

  it('协议只读视图类型 GridReadView 自入口转出可用', () => {
    const view: GridReadView = {
      name: '入口契约',
      rowCount: 1,
      colCount: 1,
      getRowHeight: () => 28,
      getColWidth: () => 100,
      getCellText: () => 'v',
      getCellValue: () => 'v',
      getCellStyle: () => undefined,
      getMergeRanges: () => [],
    }
    expect(view.name).toBe('入口契约')
    expect(view.getCellText(0, 0)).toBe('v')
  })
})
