// @vitest-environment happy-dom
// 图表格位图缓存命中单测（happy-dom 挂载安全，经 fake-chart 注入件驱动真实出图链路）：
// 首次出图写回 cell 级 MediaCache 并直贴节点；滚动滚出滚回命中缓存首帧直贴（无闪，
// 不重复出图）；声明内容变更换 key 重建；同内容并发出图单飞收敛；出图失败容错。

import { describe, expect, it } from 'vitest'

import { ListTable, type DataRecord } from '@infinite-table/core'

import { createChartPlugin } from '../../src/chart/chart-plugin'
import { chartContentKey } from '../../src/chart/render'
import { parseChartDeclaration } from '../../src/chart/parse'
import { FakeCanvas, FakeChart, createFakeChartModule, resetFakeChart } from '../testing/fake-chart'
import { StubHost } from '../testing/stub-host'

const BAR_DECLARATION = {
  type: 'bar',
  labels: ['Q1', 'Q2'],
  datasets: [{ label: '收入', data: [10, 20] }],
}

/** 声明 → 规范化 spec 的缓存内容 key（测试断言用） */
function specKey(declaration: unknown): string {
  const result = parseChartDeclaration(declaration)
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return chartContentKey(result.spec)
}

const BAR_SPEC_KEY = specKey(BAR_DECLARATION)

interface SetupOptions {
  hostDpr?: number
}

interface ChartHarness {
  table: ListTable
  host: StubHost
  flushAsync: () => Promise<void>
}

/** 建表 + 图表插件（注入假 Chart.js 模块与录制画布），resolveCellChart 读 records[row].chart */
function setupChartTable(records: DataRecord[], options: SetupOptions = {}): ChartHarness {
  resetFakeChart()
  const host = new StubHost()
  const plugin = createChartPlugin({
    chartJsModule: createFakeChartModule(),
    createCanvas: () => new FakeCanvas().asCanvas(),
    resolveCellChart: (col, row) => {
      const record = records[row]
      return col === 1 ? ((record?.chart as DataRecord['chart']) ?? null) : null
    },
  })
  const table = new ListTable({
    width: 300,
    height: 200,
    columns: [{ field: 'name' }, { field: 'chart' }],
    records,
    host,
    hostOptions: { dpr: options.hostDpr ?? 1 },
    plugins: [plugin],
  })
  return {
    table,
    host,
    flushAsync: async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

function chartRecord(declaration: unknown): DataRecord {
  return { name: `row-${Math.random()}`, chart: declaration }
}

/** 期望的 cell 级缓存 key（core 契约：内容 key + 格几何 + DPR） */
function expectedCacheKey(table: ListTable, contentKey: string, dpr: number): string {
  return `chart:${contentKey}:${Math.round(table.getColWidth(1))}x${Math.round(
    table.rowHeightAt(0),
  )}@${dpr}`
}

/** 图表格节点按坐标查找（chartCellNodes 以 cellKey 数字为键） */
function chartNodeAt(table: ListTable, col: number, row: number) {
  return [...table.chartCellNodes.values()].find((node) => node.col === col && node.row === row)
}

describe('图表格位图缓存（L2 media）', () => {
  it('首次出图：位图写回 cell 级 MediaCache 并直贴节点，媒体层 cell 失效', async () => {
    const { table, host, flushAsync } = setupChartTable([chartRecord(BAR_DECLARATION)])
    const node = chartNodeAt(table, 1, 0)
    expect(node).toBeDefined()
    // 图表格：body 格节点文本留空，位图走 media 层（getCellText 是取值管线口径，不管节点）
    const bodyNode = [...table.cellNodes.values()].find((n) => n.col === 1 && n.row === 0)
    expect(bodyNode!.text).toBe('')
    await flushAsync()
    // 出图完成：节点直贴位图，位图进 cell 级缓存（key = 内容 key + 格几何 + DPR）
    expect(node!.hasBitmap).toBe(true)
    expect(node!.cacheKey).toBe(expectedCacheKey(table, BAR_SPEC_KEY, 1))
    expect(table.mediaCache.get(node!.cacheKey)).toBeDefined()
    // 定向失效登记在 media 层 cell 档（同图片格）
    expect(
      host.submitted.some((entry) => entry.kind === 'media' && entry.inv.type === 'cell'),
    ).toBe(true)
    table.destroy()
  })

  it('滚动滚出滚回：命中缓存首帧直贴位图，不重复出图（无闪）', async () => {
    const records: DataRecord[] = Array.from({ length: 40 }, (_, i) =>
      i === 0 ? chartRecord(BAR_DECLARATION) : ({ name: `row-${i}` } as DataRecord),
    )
    const { table, flushAsync } = setupChartTable(records)
    await flushAsync()
    const originalNode = chartNodeAt(table, 1, 0)
    expect(originalNode!.hasBitmap).toBe(true)

    // 滚出窗口：media 节点摘除，缓存条目保留
    table.scrollTo(0, table.rowHeightAt(0) * 10)
    expect(table.chartCellNodes.has(0)).toBe(false)
    // 滚回：重建场景即命中 cell 级缓存，首帧直贴真实位图（同图片无闪协议，无占位帧）
    table.scrollTo(0, 0)
    const rebuiltNode = chartNodeAt(table, 1, 0)
    expect(rebuiltNode).toBeDefined()
    expect(rebuiltNode!.hasBitmap).toBe(true)
    expect(rebuiltNode!.cacheKey).toBe(originalNode!.cacheKey)
    // 无重复出图：位图来自缓存，fake chart.js 构造计数不变
    expect(FakeChart.created).toHaveLength(1)
    table.destroy()
  })

  it('声明内容变更：refreshCell 换 key 重建节点并重出图', async () => {
    const record = chartRecord(BAR_DECLARATION)
    const { table, flushAsync } = setupChartTable([record])
    await flushAsync()
    const originalNode = chartNodeAt(table, 1, 0)!
    expect(originalNode.hasBitmap).toBe(true)

    record.chart = { type: 'line', datasets: [{ data: [3, 1] }] }
    table.refreshCell(1, 0)
    const rebuiltNode = chartNodeAt(table, 1, 0)!
    expect(rebuiltNode).not.toBe(originalNode)
    expect(rebuiltNode.cacheKey).not.toBe(originalNode.cacheKey)
    await flushAsync()
    expect(rebuiltNode.hasBitmap).toBe(true)
    expect(table.mediaCache.get(rebuiltNode.cacheKey)).toBeDefined()
    table.destroy()
  })

  it('同内容多格并发出图单飞：只出图一次，两格共享同一缓存位图', async () => {
    const declaration = { ...BAR_DECLARATION }
    const { table, flushAsync } = setupChartTable([
      chartRecord(declaration),
      chartRecord(declaration),
    ])
    await flushAsync()
    const nodeA = chartNodeAt(table, 1, 0)!
    const nodeB = chartNodeAt(table, 1, 1)!
    expect(nodeA.hasBitmap).toBe(true)
    expect(nodeB.hasBitmap).toBe(true)
    expect(nodeA.cacheKey).toBe(nodeB.cacheKey)
    expect(FakeChart.created).toHaveLength(1)
    table.destroy()
  })

  it('出图失败容错：节点保持占位不抛错，缓存不写入', async () => {
    resetFakeChart()
    const plugin = createChartPlugin({
      // 未注入 chartJsModule → 走真实 loadChartJs → happy-dom 无 2d 上下文 → 出图失败
      resolveCellChart: (col) => (col === 1 ? BAR_DECLARATION : null),
    })
    const table = new ListTable({
      width: 300,
      height: 200,
      columns: [{ field: 'name' }, { field: 'chart' }],
      records: [chartRecord(BAR_DECLARATION)],
      plugins: [plugin],
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const node = chartNodeAt(table, 1, 0)
    expect(node).toBeDefined()
    expect(node!.hasBitmap).toBe(false)
    expect(table.mediaCache.get(node!.cacheKey)).toBeUndefined()
    table.destroy()
  })

  it('hostOptions.dpr 注入：出图缓存 key 携带 DPR，物理位图随 DPR 放大', async () => {
    const { table, flushAsync } = setupChartTable([chartRecord(BAR_DECLARATION)], { hostDpr: 2 })
    await flushAsync()
    const node = chartNodeAt(table, 1, 0)!
    expect(node.hasBitmap).toBe(true)
    expect(node.cacheKey).toBe(expectedCacheKey(table, BAR_SPEC_KEY, 2))
    table.destroy()
  })

  it('非法声明容错：图表格降级普通文本格', () => {
    const { table } = setupChartTable([chartRecord({ type: 'radar' })])
    expect(table.chartCellNodes.size).toBe(0)
    // 降级为普通文本格：按取值管线渲染原始值
    expect(table.getCellText(1, 0)).not.toBe('')
    table.destroy()
  })
})
