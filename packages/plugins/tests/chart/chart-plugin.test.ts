// @vitest-environment happy-dom
// 图表插件单测（happy-dom 挂载安全）：TablePlugin 契约注册、格声明解析入口、
// Chart.js 按需加载；container 挂载 + destroy 清理全链路不抛错。

import { describe, expect, it } from 'vitest'

import { ListTable } from '@infinite-table/core'

import { createChartPlugin, CHART_PLUGIN_NAME } from '../../src/chart/chart-plugin'
import { loadChartJs } from '../../src/chart/chart-loader'
import { StubHost } from '../testing/stub-host'

const BAR_DECLARATION = {
  type: 'bar',
  labels: ['Q1', 'Q2'],
  datasets: [{ label: '收入', data: [10, 20] }],
} as const

describe('createChartPlugin 插件契约', () => {
  it('构造 options.plugins 注册（与 sheet 插件族同一注册路径），destroy 清理', () => {
    const plugin = createChartPlugin({
      resolveCellChart: (col, row) => (col === 0 && row === 0 ? BAR_DECLARATION : undefined),
    })
    const host = new StubHost()
    const table = new ListTable({
      width: 400,
      height: 200,
      columns: [{ field: 'c0' }, { field: 'c1' }],
      plugins: [plugin],
      host,
    })
    expect(plugin.name).toBe(CHART_PLUGIN_NAME)
    // 声明解析入口：声明格出 spec，普通格 null
    expect(plugin.getChartSpec(0, 0)?.type).toBe('bar')
    expect(plugin.getChartSpec(1, 1)).toBeNull()
    // 注入宿主非表格所有：destroy 只逆序卸载插件，不销毁外部宿主
    expect(() => table.destroy()).not.toThrow()
  })

  it('table.use() 注册即生效；非法声明容错为 null', () => {
    const plugin = createChartPlugin({
      resolveCellChart: (col, row) =>
        col === 0 && row === 0 ? { type: 'radar' } : BAR_DECLARATION,
    })
    const host = new StubHost()
    const table = new ListTable({
      width: 400,
      height: 200,
      columns: [{ field: 'c0' }, { field: 'c1' }],
      host,
    })
    table.use(plugin)
    // (0,0) 非法声明 → null；(1,1) 合法声明 → spec
    expect(plugin.getChartSpec(0, 0)).toBeNull()
    expect(plugin.getChartSpec(1, 1)?.type).toBe('bar')
    table.destroy()
  })

  it('happy-dom container 挂载 + 插件注册 + destroy 全链路不抛错', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const plugin = createChartPlugin({ resolveCellChart: () => BAR_DECLARATION })
    const table = new ListTable({
      width: 400,
      height: 200,
      columns: [{ field: 'c0' }, { field: 'c1' }],
      plugins: [plugin],
      hostOptions: { container },
    })
    expect(container.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(2)
    table.destroy()
    expect(container.querySelectorAll('canvas').length).toBe(0)
  })
})

describe('Chart.js 按需加载', () => {
  it('loadChartJs 动态加载模块并缓存（重复调用共享同一 promise）', async () => {
    const first = loadChartJs()
    const second = loadChartJs()
    expect(second).toBe(first)
    const mod = await first
    expect(typeof mod.Chart).toBe('function')
    expect(typeof mod.Chart.register).toBe('function')
    expect(Array.isArray(mod.registerables)).toBe(true)
  })

  it('插件句柄 loadLibrary 与加载器共享缓存', async () => {
    const plugin = createChartPlugin()
    const mod = await plugin.loadLibrary()
    expect(mod).toBe(await loadChartJs())
  })
})
