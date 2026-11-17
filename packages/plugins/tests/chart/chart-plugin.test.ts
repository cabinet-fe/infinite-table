// 图表插件单测（node 环境直跑，不依赖 ListTable / 引擎）：
// resolveCellChart 媒体解析与 memo 复用/失效、produce 出图产出 LoadedImage、
// getChartSpec 声明解析与容错、Chart.js 按需加载与缓存。

import { describe, expect, it } from 'vitest'

import { loadChartJs } from '../../src/chart/chart-loader'
import { createChartPlugin } from '../../src/chart/chart-plugin'
import type { ChartCellDeclaration } from '../../src/chart/types'
import { FakeCanvas, FakeChart, createFakeChartModule, resetFakeChart } from '../testing/fake-chart'

const BAR_DECLARATION: ChartCellDeclaration = {
  type: 'bar',
  labels: ['Q1', 'Q2'],
  datasets: [{ label: '收入', data: [10, 20] }],
}

describe('createChartPlugin 解析与媒体生产', () => {
  it('resolveCellChart：合法声明产出 ChartCellMedia，普通格与非法声明返回 null', async () => {
    resetFakeChart()
    const plugin = createChartPlugin({
      resolveCellChart: (col, row) => {
        if (col === 0 && row === 0) {
          return BAR_DECLARATION
        }
        if (col === 1 && row === 0) {
          return { type: 'radar' } as unknown as ChartCellDeclaration
        }
        return null
      },
      chartJsModule: createFakeChartModule(),
      createCanvas: () => new FakeCanvas().asCanvas(),
    })

    expect(plugin.resolveCellChart(1, 0)).toBeNull()
    expect(plugin.resolveCellChart(2, 2)).toBeNull()

    const media = plugin.resolveCellChart(0, 0)
    expect(media).not.toBeNull()
    expect(typeof media!.key).toBe('string')
    expect(media!.key.length).toBeGreaterThan(0)

    const bitmap = await media!.produce({ width: 120, height: 80, dpr: 2 })
    expect(bitmap.width).toBe(240)
    expect(bitmap.height).toBe(160)
    expect(FakeChart.created).toHaveLength(1)
    expect(FakeChart.created[0]!.destroyed).toBe(true)
  })

  it('memo 复用与就地修改失效：同引用同内容复用实例，内容变更即换 key 并重建 media', () => {
    const datasets = [{ label: '趋势', data: [1, 2] }]
    const mutableDecl: ChartCellDeclaration = {
      type: 'line',
      labels: ['Q1', 'Q2'],
      datasets,
    }
    const plugin = createChartPlugin({
      resolveCellChart: (col, row) => (col === 0 && row === 0 ? mutableDecl : undefined),
    })

    const first = plugin.resolveCellChart(0, 0)
    const second = plugin.resolveCellChart(0, 0)
    expect(first).not.toBeNull()
    expect(second).toBe(first)

    // 宿主就地改写声明数据（对象引用不变）→ 内容 key 改变，必须重建 media
    datasets[0]!.data = [1, 99]
    const third = plugin.resolveCellChart(0, 0)
    expect(third).not.toBeNull()
    expect(third).not.toBe(first)
    expect(third!.key).not.toBe(first!.key)
  })

  it('getChartSpec：合法声明出 spec，未声明或非法声明容错为 null', () => {
    const plugin = createChartPlugin({
      resolveCellChart: (col, row) => {
        if (col === 0 && row === 0) {
          return BAR_DECLARATION
        }
        if (col === 0 && row === 1) {
          return { type: 'radar' } as unknown as ChartCellDeclaration
        }
        return undefined
      },
    })

    expect(plugin.getChartSpec(0, 0)?.type).toBe('bar')
    expect(plugin.getChartSpec(0, 1)).toBeNull()
    expect(plugin.getChartSpec(1, 1)).toBeNull()
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
