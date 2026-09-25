// @vitest-environment happy-dom
// 离屏出图器单测（happy-dom 挂载安全：无真实 2d 上下文，经 tests/testing/fake-chart
// 注入件驱动真实代码路径）：基线四类（柱/折/面积/饼）各出图一次，断言
// responsive:false + animation:false + 显式 devicePixelRatio 配置契约、
// 产物位图非空且物理尺寸随 DPR 正确、双画布协议（先 blit 后 destroy）。

import { describe, expect, it } from 'vitest'

import { FakeCanvas, FakeChart, createFakeChartModule, resetFakeChart } from '../testing/fake-chart'

import { chartContentKey, renderChartBitmap } from '../../src/chart/render'
import { parseChartDeclaration } from '../../src/chart/parse'

/** 每次出图用全新画布工厂（chart.js scratch 不复用，同真实路径） */
function createCanvasFactory(): { canvases: FakeCanvas[]; createCanvas: () => HTMLCanvasElement } {
  const canvases: FakeCanvas[] = []
  return {
    canvases,
    createCanvas: () => {
      const canvas = new FakeCanvas()
      canvases.push(canvas)
      return canvas.asCanvas()
    },
  }
}

async function renderOnce(declaration: unknown, width: number, height: number, dpr: number) {
  const result = parseChartDeclaration(declaration)
  if (!result.ok) {
    throw new Error(`test declaration invalid: ${result.reason}`)
  }
  resetFakeChart()
  const factory = createCanvasFactory()
  const bitmap = await renderChartBitmap({
    spec: result.spec,
    width,
    height,
    dpr,
    module: createFakeChartModule(),
    createCanvas: factory.createCanvas,
  })
  return { spec: result.spec, bitmap, charts: [...FakeChart.created], canvases: factory.canvases }
}

describe('renderChartBitmap 离屏出图器', () => {
  it('四类图表（柱/折/面积/饼）各出图一次：产物位图非空且物理尺寸随 DPR 正确', async () => {
    const declarations = [
      { type: 'bar', labels: ['Q1', 'Q2'], datasets: [{ label: '收入', data: [10, 20] }] },
      { type: 'line', labels: ['Q1', 'Q2'], datasets: [{ label: '趋势', data: [1, 2] }] },
      { type: 'area', labels: ['Q1', 'Q2'], datasets: [{ label: '面积', data: [3, 4] }] },
      {
        type: 'pie',
        labels: ['A', 'B', 'C'],
        datasets: [{ label: '构成', data: [5, 3, 2] }],
      },
    ]
    for (const declaration of declarations) {
      const { bitmap, charts } = await renderOnce(declaration, 120, 80, 2)
      // 出图恰一次，产物位图非空：scratch 落过绘制调用（快照在 destroy 清画布前捕获）
      expect(charts).toHaveLength(1)
      expect(charts[0]!.renderedOps.length).toBeGreaterThanOrEqual(1)
      expect(charts[0]!.destroyed).toBe(true)
      // 物理尺寸随 DPR：CSS 120×80 @2x → 240×160
      expect(bitmap.width).toBe(240)
      expect(bitmap.height).toBe(160)
    }
  })

  it('配置契约：responsive:false + animation:false + 显式 devicePixelRatio，图例与 tooltip 关闭', async () => {
    const { charts } = await renderOnce({ type: 'bar', datasets: [{ data: [1] }] }, 100, 60, 3)
    const options = charts[0]!.config.options
    expect(options.responsive).toBe(false)
    expect(options.animation).toBe(false)
    expect(options.devicePixelRatio).toBe(3)
    expect(options.plugins?.legend?.display).toBe(false)
    expect(options.plugins?.tooltip?.enabled).toBe(false)
  })

  it('类型与数据映射：area 归一 line+fill、饼图取首数据集并逐扇区配色', async () => {
    const area = await renderOnce(
      { type: 'area', labels: ['Q1'], datasets: [{ label: '面积', data: [3] }] },
      100,
      60,
      1,
    )
    expect(area.charts[0]!.config.type).toBe('line')
    const areaDataset = area.charts[0]!.config.data.datasets[0]!
    expect(areaDataset.fill).toBe(true)
    expect(areaDataset.backgroundColor).toMatch(/[0-9a-f]{2}$/) // hex8 透明填充
    expect(areaDataset.borderColor).not.toBe(areaDataset.backgroundColor)

    const pie = await renderOnce(
      {
        type: 'pie',
        labels: ['A', 'B'],
        datasets: [
          { label: '第一', data: [5, 3] },
          { label: '第二', data: [9, 9] },
        ],
      },
      100,
      60,
      1,
    )
    expect(pie.charts[0]!.config.type).toBe('pie')
    expect(pie.charts[0]!.config.data.datasets).toHaveLength(1)
    expect(pie.charts[0]!.config.data.datasets[0]!.backgroundColor).toHaveLength(2)
  })

  it('双画布协议：出图落在 scratch，先 blit 到产物画布再 destroy（产物存活）', async () => {
    const { bitmap, charts, canvases } = await renderOnce(
      { type: 'bar', datasets: [{ data: [1, 2] }] },
      100,
      60,
      2,
    )
    expect(canvases).toHaveLength(2)
    const [scratch, output] = canvases
    // scratch 按 DPR 提物理分辨率并落绘制调用（流水快照存于构造记录，destroy 已清画布）
    expect(scratch!.width).toBe(200)
    expect(scratch!.height).toBe(120)
    expect(charts[0]!.renderedOps[0]).toBe('render:bar:200x120')
    // 产物画布物理尺寸一致，且收到 blit；blit 先于 destroy（destroy 后 scratch 被清）
    expect(output!.width).toBe(200)
    expect(output!.height).toBe(120)
    expect(output!.ctx.ops).toEqual([`drawImage:200x120@0,0`])
    expect(charts[0]!.destroyed).toBe(true)
    expect(bitmap.source).toBe(output!.asCanvas())
    expect(bitmap.width).toBe(200)
    expect(bitmap.height).toBe(120)
  })

  it('无 2d 上下文（happy-dom 真实画布）时显式抛错，不产出位图', async () => {
    resetFakeChart()
    await expect(
      renderChartBitmap({
        spec: { type: 'bar', labels: null, datasets: [] },
        width: 100,
        height: 60,
        dpr: 1,
        module: createFakeChartModule(),
        createCanvas: () => document.createElement('canvas'),
      }),
    ).rejects.toThrow('无法获取离屏画布 2d 上下文')
  })

  it('chartContentKey 按声明内容生成：同内容同 key，类型/标签/数据任一变更换 key', async () => {
    const spec = (declaration: unknown) => {
      const result = parseChartDeclaration(declaration)
      if (!result.ok) {
        throw new Error(result.reason)
      }
      return chartContentKey(result.spec)
    }
    const base = { type: 'bar', labels: ['Q1'], datasets: [{ label: '收入', data: [1] }] }
    expect(spec(base)).toBe(spec({ ...base }))
    expect(spec(base)).not.toBe(spec({ ...base, type: 'line' }))
    expect(spec(base)).not.toBe(spec({ ...base, labels: ['Q2'] }))
    expect(spec(base)).not.toBe(spec({ ...base, datasets: [{ label: '收入', data: [2] }] }))
  })
})
