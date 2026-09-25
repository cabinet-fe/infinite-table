// 离屏出图器：ChartSpec → 可 blit 位图（core LoadedImage 形态，直进 cell 级 MediaCache）。
// 在插件持有的离屏 canvas 上同步确定性出图：responsive:false + animation:false + 显式
// devicePixelRatio 下，Chart.js 构造即完成布局与绘制（attached 直置 true、动画禁用后
// update → render → draw 同步走完），canvas 物理尺寸 = CSS 尺寸 × DPR、上下文按 DPR 缩放。
//
// 双画布协议：chart.js 出图在 scratch 画布，绘制完成后先 blit 到插件持有的 output 画布再
// destroy——chart.js 的 destroy 会 clearCanvas 并复原画布属性（releaseContext），scratch
// 像素不保证存活，产物必须先拷出。

import type { LoadedImage } from '@infinite-table/core'

import type { ChartJsModule } from './chart-loader'
import { loadChartJs } from './chart-loader'
import type { ChartSpec } from './types'

/** 基线四类的缺省分类色板（单元格声明只有类型 + 数据，配色由出图器确定性缺省） */
const PALETTE = [
  '#4dc9f6',
  '#f67019',
  '#f53794',
  '#537bc4',
  '#acc236',
  '#166a8f',
  '#00a950',
  '#58595b',
  '#8549ba',
]

/** 色板取色（越界循环） */
function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? PALETTE[0]!
}

/** 面积填充透明度（hex8 后缀，25%） */
const AREA_FILL_ALPHA = '40'

export interface ChartRenderOptions {
  spec: ChartSpec
  /** 格 CSS 宽高（物理分辨率 = CSS × dpr，由 chart.js devicePixelRatio 落地） */
  width: number
  height: number
  dpr: number
  /** 显式注入 Chart.js 模块（测试用）；缺省经 loadChartJs 按需动态加载 */
  module?: ChartJsModule
  /** 离屏画布工厂注入（测试用）；缺省 document.createElement('canvas') */
  createCanvas?: () => HTMLCanvasElement
}

/**
 * 按声明内容生成缓存内容 key：规范化 ChartSpec 的确定性序列化
 * （字段序由解析器构造决定，同声明必同 key）。
 */
export function chartContentKey(spec: ChartSpec): string {
  return JSON.stringify([spec.type, spec.labels, spec.datasets])
}

/**
 * 同步确定性出图（返回 promise 只为首次库加载；模块就绪后构造即完成绘制）。
 * 产物位图物理尺寸 = CSS × dpr，供 media 层 1:1 blit 回格尺寸。
 */
export async function renderChartBitmap(options: ChartRenderOptions): Promise<LoadedImage> {
  const { spec, width, height, dpr } = options
  const cssWidth = Math.max(1, Math.round(width))
  const cssHeight = Math.max(1, Math.round(height))
  const module = options.module ?? (await loadChartJs())
  const createCanvas =
    options.createCanvas ?? ((): HTMLCanvasElement => document.createElement('canvas'))

  // scratch：CSS 尺寸起步，chart.js 按 devicePixelRatio 提物理分辨率并缩放上下文
  const scratch = createCanvas()
  scratch.width = cssWidth
  scratch.height = cssHeight
  const context = scratch.getContext('2d')
  if (!context) {
    throw new Error('chart render failed: 无法获取离屏画布 2d 上下文')
  }
  const chart = new module.Chart(scratch, {
    type: spec.type,
    data: chartDataFromSpec(spec),
    options: {
      responsive: false,
      animation: false,
      devicePixelRatio: dpr,
      // 表格场景非目标（无图表内交互/图例）：图例关（让位格内容），tooltip 关（无指针）
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  })
  const output = createCanvas()
  output.width = scratch.width
  output.height = scratch.height
  const outputContext = output.getContext('2d')
  if (!outputContext) {
    chart.destroy()
    throw new Error('chart render failed: 无法获取产物画布 2d 上下文')
  }
  outputContext.drawImage(scratch, 0, 0)
  chart.destroy()
  return { source: output, width: output.width, height: output.height }
}

/** ChartSpec → chart.js data：area 的 fill 标记直接映射 chart.js dataset.fill */
function chartDataFromSpec(spec: ChartSpec): ChartJsData {
  return {
    labels: spec.labels ?? undefined,
    datasets: spec.datasets.map((dataset, index) => {
      const color = paletteColor(index)
      if (spec.type === 'pie') {
        // 饼图逐扇区配色（解析器已收敛为单数据集）
        return {
          label: dataset.label,
          data: dataset.data,
          backgroundColor: dataset.data.map((_, slice) => paletteColor(slice)),
        }
      }
      return {
        label: dataset.label,
        data: dataset.data,
        backgroundColor: dataset.fill ? `${color}${AREA_FILL_ALPHA}` : color,
        borderColor: color,
        fill: dataset.fill,
      }
    }),
  }
}

/** chart.js data 面（结构类型，避免对 chart.js 泛型的直接依赖面） */
interface ChartJsData {
  labels?: string[]
  datasets: {
    label: string
    data: (number | null)[]
    backgroundColor?: string | string[]
    borderColor?: string
    fill?: boolean
  }[]
}
