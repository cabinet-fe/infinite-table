// 图表插件工厂（领域面组合模块：不实现 EnginePlugin，零 @infinitable/table 依赖）。
// 格声明解析 + Chart.js 按需加载封装 + 离屏出图器：对外暴露 resolveCellChart
// 供宿主作为构造缝（如 ListTableOptions.resolveCellChart）直接注入渲染引擎，
// 位图经 cell 级 MediaCache blit 上屏。

import type { LoadedImage } from '@infinitable/grid'

import { loadChartJs, type ChartJsModule } from './chart-loader'
import { parseChartDeclaration } from './parse'
import { chartContentKey, renderChartBitmap } from './render'
import type { ChartCellDeclaration, ChartSpec } from './types'

/** 图表位图生产尺寸：width/height 为格 CSS 像素，dpr 为出图设备像素比 */
export interface ChartCellMediaSize {
  width: number
  height: number
  dpr: number
}

/** 格内图表媒体描述（结构等价于 ListTableOptions.resolveCellChart 的返回契约） */
export interface ChartCellMedia {
  /** 内容 key：按图表声明内容生成（内容变更自然换 key） */
  key: string
  /** 位图生产：未命中缓存时调用；首次含库加载为异步 */
  produce(size: ChartCellMediaSize): Promise<LoadedImage> | LoadedImage
}

/** 图表插件配置：宿主提供格 → 图表声明的读取通道 */
export interface ChartPluginOptions {
  /** 返回该格的图表声明；null/undefined 表示普通格 */
  resolveCellChart?: (col: number, row: number) => ChartCellDeclaration | null | undefined
  /** 离屏画布工厂注入（测试用）；缺省 document.createElement('canvas') */
  createCanvas?: () => HTMLCanvasElement
  /** Chart.js 模块注入（测试用，与 ImageServiceOptions.loadImage 同风格的注入缝）；缺省按需动态加载 */
  chartJsModule?: ChartJsModule | Promise<ChartJsModule>
}

/** 图表插件句柄：提供格 → 媒体解析器、声明解析与按需加载入口 */
export interface ChartPluginHandle {
  /** 格 → 图表媒体解析器（可直接作为 ListTableOptions.resolveCellChart 注入引擎） */
  readonly resolveCellChart: (col: number, row: number) => ChartCellMedia | null
  /** 解析指定格的图表声明为 ChartSpec；未声明或非法声明返回 null（不抛异常） */
  getChartSpec(col: number, row: number): ChartSpec | null
  /** 按需加载 Chart.js（首次调用触发动态 import，之后共享模块缓存） */
  loadLibrary(): Promise<ChartJsModule>
}

/** 创建图表插件：返回 resolveCellChart / getChartSpec / loadLibrary 组合句柄 */
export function createChartPlugin(options: ChartPluginOptions = {}): ChartPluginHandle {
  // 声明身份 + 内容 key 双重校验 memo：场景重建/走廊扫描对图表格反复解析，声明内容未变
  // 时复用同一 media（O(1) 复用产物对象）。声明常被宿主就地改数据（记录式数据源，对象
  // 身份不变），故每次 resolve 重算内容 key 比对：key 变了即换新 media——produce 闭包
  // 捕获旧 spec，必须整体重建，refreshCell 才能凭新 key 定向失效该格缓存并重出图。
  const mediaMemo = new WeakMap<object, ChartCellMedia>()

  const resolveCellChart = (col: number, row: number): ChartCellMedia | null => {
    const declaration = options.resolveCellChart?.(col, row)
    if (!declaration) {
      return null
    }
    const result = parseChartDeclaration(declaration)
    if (!result.ok) {
      return null
    }
    const key = chartContentKey(result.spec)
    const memoized = mediaMemo.get(declaration)
    if (memoized && memoized.key === key) {
      return memoized
    }
    const spec = result.spec
    const media: ChartCellMedia = {
      key,
      produce: async (size) =>
        renderChartBitmap({
          spec,
          ...size,
          module: await options.chartJsModule,
          createCanvas: options.createCanvas,
        }),
    }
    mediaMemo.set(declaration, media)
    return media
  }

  return {
    resolveCellChart,
    getChartSpec(col, row) {
      const declaration = options.resolveCellChart?.(col, row)
      if (!declaration) {
        return null
      }
      const result = parseChartDeclaration(declaration)
      return result.ok ? result.spec : null
    },
    loadLibrary: loadChartJs,
  }
}
