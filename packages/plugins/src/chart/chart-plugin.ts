// 图表插件工厂：实现 core TablePlugin 契约，经既有插件注册路径挂载
// （构造 options.plugins 或 table.use()，与 sheet 插件族同一注册方式）。
// 格声明解析 + Chart.js 按需加载封装 + 离屏出图路由注入：mount 时把「格 → 图表媒体」
// 解析器写入 table（core L2 media 的 chart 预留位），位图经 cell 级 MediaCache blit 上屏。

import type { CellChartMedia, ListTable, TablePlugin } from '@infinite-table/core'

import { loadChartJs, type ChartJsModule } from './chart-loader'
import { parseChartDeclaration } from './parse'
import { chartContentKey, renderChartBitmap } from './render'
import type { ChartCellDeclaration, ChartSpec } from './types'

/** 图表插件配置：宿主提供格 → 图表声明的读取通道（与 core resolveCellImage 同风格） */
export interface ChartPluginOptions {
  /** 返回该格的图表声明；null/undefined 表示普通格 */
  resolveCellChart?: (col: number, row: number) => ChartCellDeclaration | null | undefined
  /** 离屏画布工厂注入（测试用）；缺省 document.createElement('canvas') */
  createCanvas?: () => HTMLCanvasElement
  /** Chart.js 模块注入（测试用，与 ImageServiceOptions.loadImage 同风格的注入缝）；缺省按需动态加载 */
  chartJsModule?: ChartJsModule | Promise<ChartJsModule>
}

/** 图表插件句柄：TablePlugin 契约 + 渲染通路消费的解析/加载入口 */
export interface ChartPluginHandle extends TablePlugin {
  /** 解析指定格的图表声明为 ChartSpec；未声明或非法声明返回 null（不抛异常） */
  getChartSpec(col: number, row: number): ChartSpec | null
  /** 按需加载 Chart.js（首次调用触发动态 import，之后共享模块缓存） */
  loadLibrary(): Promise<ChartJsModule>
}

/** 插件名（core 插件注册路径用） */
export const CHART_PLUGIN_NAME = 'chart'

export function createChartPlugin(options: ChartPluginOptions = {}): ChartPluginHandle {
  // 声明身份 + 内容 key 双重校验 memo：场景重建/走廊扫描对图表格反复解析，声明内容未变
  // 时复用同一 media（O(1) 复用产物对象）。声明常被宿主就地改数据（记录式数据源，对象
  // 身份不变），故每次 resolve 重算内容 key 比对：key 变了即换新 media——produce 闭包
  // 捕获旧 spec，必须整体重建，refreshCell 才能凭新 key 定向失效该格缓存并重出图。
  const mediaMemo = new WeakMap<object, CellChartMedia>()

  const resolveChartMedia = (col: number, row: number): CellChartMedia | null => {
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
    const media: CellChartMedia = {
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
    name: CHART_PLUGIN_NAME,
    mount(table: ListTable) {
      // L2 media 的 chart 预留位接线：场景重建按此解析器装配图表格节点
      table.chartMediaResolver = resolveChartMedia
      // 晚挂载（table.use）：构造期注册已在首帧前生效，此处补一次全量重建即时上图
      if (table.sceneInitialized) {
        table.applyGeometryChange()
      }
    },
    unmount(table: ListTable) {
      if (table.chartMediaResolver === resolveChartMedia) {
        table.chartMediaResolver = null
      }
    },
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
