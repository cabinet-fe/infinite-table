// 单元格图表演示区：chart 插件经既有注册路径（构造 options.plugins）挂载，单元格声明图表
// （类型 + 数据）由插件离屏出图，位图落 L2 media cell 级缓存 blit 上屏——滚动滚回命中直贴
// 无闪。静态场景覆盖柱状/折线/面积/饼四类基线图表；滚动场景为长列表图表格，声明按行取模
// 共享 6 组（同 key 单飞出图 + cell 级缓存共享）。

import {
  createChartPlugin,
  type ChartCellDeclaration,
  type ChartPluginHandle,
  type ChartType,
} from '@infinite-table/plugins'

import {
  addButton,
  addStatus,
  createSection,
  createSubSection,
  mountTable,
  type DemoMount,
} from '../mount'

/** 静态场景行数：2 行 × 4 个图表列（柱状/折线/面积/饼各一格以上） */
export const CHART_STATIC_ROW_COUNT = 2
/** 静态表图表列的基础类型（col = 索引 + 1，col 0 为文本列） */
export const CHART_STATIC_COL_TYPES: readonly ChartType[] = ['bar', 'line', 'area', 'pie']
/** 滚动表图表格列 */
export const CHART_SCROLL_CHART_COLS: readonly number[] = [1, 2]
/** 滚动表声明按 row 取模共享的变体数（同 key 单飞 + cell 级缓存共享） */
export const CHART_SCROLL_VARIANTS = 6

const CHART_SCROLL_ROW_COUNT = 400
const CHART_STATIC_LINE_COL = 2
const CHART_TYPE_TITLES: Record<ChartType, string> = {
  bar: '柱状',
  line: '折线',
  area: '面积',
  pie: '饼图',
}
const STATIC_METRICS = ['营收', '利润']
const STATIC_LABELS = ['一月', '二月', '三月', '四月']
const STATIC_ROW_HEIGHT = 110
const SCROLL_ROW_HEIGHT = 84
const CHART_COL_WIDTH = 150

/** 静态表声明：类型 × 行出图；lineRevision 轮换折线数据（内容换 key 失效重绘演示） */
function staticDeclaration(
  type: ChartType,
  row: number,
  lineRevision: number,
): ChartCellDeclaration {
  const shift = row * 10
  switch (type) {
    case 'bar':
      return {
        type,
        labels: STATIC_LABELS,
        datasets: [
          { label: '本年', data: [12 + shift, 26 + shift, 18 + shift, 32 + shift] },
          { label: '上年', data: [18 + shift, 14 + shift, 24 + shift, 20 + shift] },
        ],
      }
    case 'line':
      return {
        type,
        labels: STATIC_LABELS,
        datasets: [
          {
            label: '趋势',
            data: [8 + shift + lineRevision * 4, null, 22 + shift + lineRevision * 4, 30 + shift],
          },
        ],
      }
    case 'area':
      return {
        type,
        labels: STATIC_LABELS,
        datasets: [{ label: '累计', data: [6 + shift, 16 + shift, 12 + shift, 24 + shift] }],
      }
    case 'pie':
      return { type, labels: STATIC_LABELS, datasets: [{ label: '占比', data: [35, 25, 22, 18] }] }
  }
}

/** 滚动表共享声明：柱状/折线各 6 组（身份稳定，保证插件声明 memo 与缓存 key 收敛） */
const scrollBarDeclarations: ChartCellDeclaration[] = Array.from(
  { length: CHART_SCROLL_VARIANTS },
  (_, variant) => ({
    type: 'bar',
    labels: STATIC_LABELS,
    datasets: [
      {
        label: '销量',
        data: [20 + variant * 6, 14 + variant * 3, 28 - variant * 2, 18 + variant * 4],
      },
    ],
  }),
)
const scrollLineDeclarations: ChartCellDeclaration[] = Array.from(
  { length: CHART_SCROLL_VARIANTS },
  (_, variant) => ({
    type: 'line',
    labels: STATIC_LABELS,
    datasets: [
      { label: '环比', data: [10 + variant * 3, null, 24 - variant * 2, 30 + variant * 2] },
    ],
  }),
)

export interface ChartDemo {
  staticMount: DemoMount
  scrollMount: DemoMount
  /** 静态表图表插件句柄（冒烟断言用：getChartSpec 抽查解析结果） */
  staticPlugin: ChartPluginHandle
}

export function mountChart(root: HTMLElement): ChartDemo {
  const section = createSection(
    root,
    '单元格图表',
    '单元格声明图表（类型 + 数据），chart 插件经构造 plugins 启用：Chart.js 在插件侧离屏出图，' +
      '位图落 L2 media cell 级缓存 blit 上屏。上方静态表覆盖柱状/折线/面积/饼四类；' +
      '下方 400 行长列表滚动滚回命中缓存直接回贴（无闪），声明按行取模共享 6 组。',
  )

  // ---- 静态渲染场景：四类基线图表 ----
  createSubSection(section, '静态渲染（柱状 / 折线 / 面积 / 饼）')
  let lineRevision = 0
  const staticPlugin = createChartPlugin({
    resolveCellChart: (col, row) => {
      const type = CHART_STATIC_COL_TYPES[col - 1]
      return type ? staticDeclaration(type, row, lineRevision) : null
    },
  })
  const staticMount = mountTable(section, {
    width: 48 + 120 + CHART_STATIC_COL_TYPES.length * CHART_COL_WIDTH + 12,
    height: 36 + CHART_STATIC_ROW_COUNT * STATIC_ROW_HEIGHT + 4,
    columns: [
      { title: '指标', width: 120 },
      ...CHART_STATIC_COL_TYPES.map((type) => ({
        title: CHART_TYPE_TITLES[type],
        width: CHART_COL_WIDTH,
      })),
    ],
    rowCount: CHART_STATIC_ROW_COUNT,
    rowHeight: STATIC_ROW_HEIGHT,
    resolveDisplayValue: (col, row) =>
      col === 0 ? (STATIC_METRICS[row % STATIC_METRICS.length] ?? '') : '',
    plugins: [staticPlugin],
  })

  // ---- 滚动场景：长列表图表格（滚回无闪 + 缓存命中） ----
  createSubSection(section, '长列表滚动（滚回无闪 / 缓存命中）')
  const scrollPlugin = createChartPlugin({
    resolveCellChart: (col, row) => {
      if (col === 1) {
        return scrollBarDeclarations[row % CHART_SCROLL_VARIANTS] ?? null
      }
      if (col === 2) {
        return scrollLineDeclarations[row % CHART_SCROLL_VARIANTS] ?? null
      }
      return null
    },
  })
  const scrollMount = mountTable(section, {
    width: 48 + 160 + CHART_SCROLL_CHART_COLS.length * CHART_COL_WIDTH + 12,
    height: 320,
    columns: [
      { title: '地区', width: 160 },
      { title: '销量（柱状）', width: CHART_COL_WIDTH },
      { title: '环比（折线）', width: CHART_COL_WIDTH },
    ],
    rowCount: CHART_SCROLL_ROW_COUNT,
    rowHeight: SCROLL_ROW_HEIGHT,
    resolveDisplayValue: (col, row) => (col === 0 ? `地区-${row}` : ''),
    plugins: [scrollPlugin],
  })

  const status = addStatus(section, '提示：滚动长列表再滚回，观察图表格无闪直贴。')
  const refreshStats = (): void => {
    status.textContent =
      `静态表：图表格 ${staticMount.table.chartCellNodes.size} 个、位图缓存 ${staticMount.table.mediaCache.size} 条；` +
      `滚动表：图表格 ${scrollMount.table.chartCellNodes.size} 个、位图缓存 ${scrollMount.table.mediaCache.size} 条` +
      `（声明共享 ${CHART_SCROLL_VARIANTS} 组）`
  }
  addButton(section, '出图统计', refreshStats)
  addButton(section, '轮换折线数据（内容换 key 失效重绘）', () => {
    lineRevision++
    for (let row = 0; row < CHART_STATIC_ROW_COUNT; row++) {
      staticMount.table.refreshCell(CHART_STATIC_LINE_COL, row)
    }
    refreshStats()
  })

  return { staticMount, scrollMount, staticPlugin }
}
