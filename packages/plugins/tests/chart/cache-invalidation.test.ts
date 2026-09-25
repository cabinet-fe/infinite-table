// @vitest-environment happy-dom
// 图表格缓存失效与数据/尺寸变更重绘单测（happy-dom 挂载安全，经 fake-chart 注入件驱动
// 真实出图链路）：声明就地改数据（对象身份不变）→ refreshCell 凭内容 key 定向失效该格
// 缓存并重出图；同帧多格更新走 media 层 cell 档定向失效（不扩档位，由既有失效队列收敛）；
// 行高/列宽/DPR 变化按新尺寸重出图；重绘完成后新位图回填 cell 级缓存，滚动滚回首帧直贴。

import { describe, expect, it } from 'vitest'

import { ListTable, type DataRecord } from '@infinite-table/core'

import { createChartPlugin } from '../../src/chart/chart-plugin'
import { FakeChart, FakeCanvas, createFakeChartModule, resetFakeChart } from '../testing/fake-chart'
import { StubHost } from '../testing/stub-host'

/** 声明对象以具体类型持有（测试要就地改数据，DataRecord 值面是 unknown 不可直接深改） */
const BAR_DECLARATION = {
  type: 'bar',
  labels: ['Q1', 'Q2'],
  datasets: [{ label: '收入', data: [10, 20] }],
}

interface ChartHarness {
  table: ListTable
  host: StubHost
  flushAsync: () => Promise<void>
}

/** 建表 + 图表插件（注入假 Chart.js 模块与录制画布），resolveCellChart 读 records[row].chart */
function setupChartTable(records: DataRecord[]): ChartHarness {
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
    hostOptions: { dpr: 1 },
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

/** 图表格节点按坐标查找（chartCellNodes 以 cellKey 数字为键） */
function chartNodeAt(table: ListTable, col: number, row: number) {
  return [...table.chartCellNodes.values()].find((node) => node.col === col && node.row === row)
}

function createdCount(): number {
  return FakeChart.created.length
}

describe('图表格缓存失效与数据/尺寸变更重绘', () => {
  it('声明就地改数据（对象身份不变）：refreshCell 凭内容 key 定向失效并重出图，新数据进位图', async () => {
    const declaration = { ...BAR_DECLARATION, datasets: [{ label: '收入', data: [10, 20] }] }
    const record = chartRecord(declaration)
    const { table, flushAsync } = setupChartTable([record])
    await flushAsync()
    const originalNode = chartNodeAt(table, 1, 0)!
    expect(originalNode.hasBitmap).toBe(true)
    const originalKey = originalNode.cacheKey

    // 就地改数据：声明对象身份不变，纯内容变更（记录式数据源的典型更新形态）
    declaration.datasets[0]!.data = [5, 9]
    table.refreshCell(1, 0)
    const rebuiltNode = chartNodeAt(table, 1, 0)!
    expect(rebuiltNode).not.toBe(originalNode)
    expect(rebuiltNode.cacheKey).not.toBe(originalKey)
    await flushAsync()
    // 重出图携带新数据；节点直贴新位图，新条目回填 cell 级缓存
    expect(createdCount()).toBe(2)
    const rendered = FakeChart.created[1]!
    expect(rendered.config.data.datasets[0]!.data).toEqual([5, 9])
    expect(rebuiltNode.hasBitmap).toBe(true)
    expect(table.mediaCache.get(rebuiltNode.cacheKey)).toBeDefined()
    table.destroy()
  })

  it('同帧多格数据更新：逐格 media 层 cell 档定向失效，不扩 band/full 档位', async () => {
    const declarationA = { ...BAR_DECLARATION, datasets: [{ label: '收入', data: [10, 20] }] }
    const declarationB = { type: 'line', datasets: [{ data: [1, 2] }] }
    const { table, host, flushAsync } = setupChartTable([
      chartRecord(declarationA),
      chartRecord(declarationB),
    ])
    await flushAsync()
    expect(chartNodeAt(table, 1, 0)!.hasBitmap).toBe(true)
    expect(chartNodeAt(table, 1, 1)!.hasBitmap).toBe(true)

    const submittedBefore = host.submitted.length
    declarationA.datasets[0]!.data = [7, 3]
    declarationB.datasets[0]!.data = [4, 8]
    table.refreshCell(1, 0)
    table.refreshCell(1, 1)
    await flushAsync()
    // 两格各自重出图（内容不同 → key 不同 → 不共享单飞）
    expect(createdCount()).toBe(4)
    expect(chartNodeAt(table, 1, 0)!.hasBitmap).toBe(true)
    expect(chartNodeAt(table, 1, 1)!.hasBitmap).toBe(true)
    // 更新引发的 media 层失效全部为 cell 档（定向失效该格；同帧收敛交给既有失效队列）
    const mediaInvalidations = host.submitted
      .slice(submittedBefore)
      .filter((entry) => entry.kind === 'media')
    expect(mediaInvalidations.length).toBeGreaterThan(0)
    for (const entry of mediaInvalidations) {
      expect(entry.inv.type).toBe('cell')
    }
    table.destroy()
  })

  it('行高变化：图表按新格高重出图，新 key 位图回填缓存', async () => {
    const { table, flushAsync } = setupChartTable([chartRecord(BAR_DECLARATION)])
    await flushAsync()
    const originalNode = chartNodeAt(table, 1, 0)!
    expect(originalNode.hasBitmap).toBe(true)

    table.setRowHeight(0, 120)
    const rebuiltNode = chartNodeAt(table, 1, 0)!
    expect(rebuiltNode).not.toBe(originalNode)
    expect(rebuiltNode.height).toBe(120)
    await flushAsync()
    // 新尺寸重出图：物理位图高 = 新格高 × DPR，缓存按新 key 回填
    expect(createdCount()).toBe(2)
    expect(rebuiltNode.hasBitmap).toBe(true)
    expect(table.mediaCache.get(rebuiltNode.cacheKey)).toMatchObject({ height: 120 })
    table.destroy()
  })

  it('列宽变化：图表按新列宽重出图', async () => {
    const { table, flushAsync } = setupChartTable([chartRecord(BAR_DECLARATION)])
    await flushAsync()
    const originalNode = chartNodeAt(table, 1, 0)!
    expect(originalNode.hasBitmap).toBe(true)

    table.setColWidth(1, 240)
    const rebuiltNode = chartNodeAt(table, 1, 0)!
    expect(rebuiltNode).not.toBe(originalNode)
    expect(rebuiltNode.width).toBe(240)
    await flushAsync()
    expect(createdCount()).toBe(2)
    expect(rebuiltNode.hasBitmap).toBe(true)
    expect(table.mediaCache.get(rebuiltNode.cacheKey)).toMatchObject({ width: 240 })
    table.destroy()
  })

  it('DPR 变化（resize 通道）：出图随新 DPR 重做，缓存 key 携带新 DPR', async () => {
    const { table, flushAsync } = setupChartTable([chartRecord(BAR_DECLARATION)])
    await flushAsync()
    const originalNode = chartNodeAt(table, 1, 0)!
    expect(originalNode.hasBitmap).toBe(true)
    expect(originalNode.cacheKey.endsWith('@1')).toBe(true)

    // 运行环境 DPR 变化（跨屏/缩放）经 resize 通道进入 core：几何变更统一走全量重建
    window.devicePixelRatio = 2
    try {
      table.resize(320, 220)
      const rebuiltNode = chartNodeAt(table, 1, 0)!
      expect(rebuiltNode).not.toBe(originalNode)
      expect(rebuiltNode.cacheKey.endsWith('@2')).toBe(true)
      await flushAsync()
      const rendered = FakeChart.created[1]!
      expect(rendered.config.options.devicePixelRatio).toBe(2)
      // 物理位图 = CSS 尺寸 × 2
      expect(table.mediaCache.get(rebuiltNode.cacheKey)).toMatchObject({
        height: table.rowHeightAt(0) * 2,
      })
    } finally {
      window.devicePixelRatio = 1
    }
    table.destroy()
  })

  it('重绘后缓存回填：滚动滚回命中新位图（首帧直贴，不重复出图）', async () => {
    const declaration = { ...BAR_DECLARATION, datasets: [{ label: '收入', data: [10, 20] }] }
    const records: DataRecord[] = Array.from({ length: 40 }, (_, i) =>
      i === 0 ? chartRecord(declaration) : { name: `row-${i}` },
    )
    const { table, flushAsync } = setupChartTable(records)
    await flushAsync()
    const originalKey = chartNodeAt(table, 1, 0)!.cacheKey

    // 数据更新重绘完成：新位图回填 cell 级缓存
    declaration.datasets[0]!.data = [6, 8]
    table.refreshCell(1, 0)
    await flushAsync()
    const updatedNode = chartNodeAt(table, 1, 0)!
    expect(updatedNode.hasBitmap).toBe(true)
    expect(updatedNode.cacheKey).not.toBe(originalKey)
    expect(createdCount()).toBe(2)

    // 滚出窗口再滚回：重建节点直接命中新 key 缓存，首帧直贴、不再出图
    table.scrollTo(0, table.rowHeightAt(0) * 10)
    expect(chartNodeAt(table, 1, 0)).toBeUndefined()
    table.scrollTo(0, 0)
    const rebuiltNode = chartNodeAt(table, 1, 0)!
    expect(rebuiltNode).toBeDefined()
    expect(rebuiltNode!.hasBitmap).toBe(true)
    expect(rebuiltNode!.cacheKey).toBe(updatedNode.cacheKey)
    expect(createdCount()).toBe(2)
    table.destroy()
  })
})
