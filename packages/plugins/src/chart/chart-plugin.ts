// 图表插件工厂：实现 core TablePlugin 契约，经既有插件注册路径挂载
// （构造 options.plugins 或 table.use()，与 sheet 插件族同一注册方式）。
// P1 骨架：格声明解析 + Chart.js 按需加载封装；离屏出图与 L2 media 渲染通路
// 在后续阶段接入（复用 L2 media 位图管线与 cell 三档失效）。

import type { TablePlugin } from '@infinite-table/core'

import { loadChartJs, type ChartJsModule } from './chart-loader'
import { parseChartDeclaration } from './parse'
import type { ChartCellDeclaration, ChartSpec } from './types'

/** 图表插件配置：宿主提供格 → 图表声明的读取通道（与 core resolveCellImage 同风格） */
export interface ChartPluginOptions {
  /** 返回该格的图表声明；null/undefined 表示普通格 */
  resolveCellChart?: (col: number, row: number) => ChartCellDeclaration | null | undefined
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
  return {
    name: CHART_PLUGIN_NAME,
    // 挂载/卸载暂无副作用：注册即声明可解析、加载器就位；出图接线（media 层节点
    // 装配与失效订阅）属渲染通路，在后续阶段补充
    mount() {},
    unmount() {},
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
