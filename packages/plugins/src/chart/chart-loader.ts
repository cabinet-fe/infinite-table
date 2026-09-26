// Chart.js 按需加载器：chart 模块内唯一触碰 chart.js 的文件。
// 动态 import 使 chart.js（含其唯一依赖 @kurkle/color）独立分包：仅图表真正需要
// 出图时才加载；未启用图表插件的宿主不触发本调用，plugins 主产物不含 chart.js 代码。

/** Chart.js 模块类型（仅类型引用，编译期擦除，不影响运行时分包） */
export type ChartJsModule = typeof import('chart.js')

let modulePromise: Promise<ChartJsModule> | null = null

/** 按需加载 Chart.js（模块级缓存：首次触发动态 import，之后共享同一 promise） */
export function loadChartJs(): Promise<ChartJsModule> {
  modulePromise ??= import('chart.js').then((module) => {
    // chart.js 4 主入口不自动注册控制器/刻度等组件（树摇设计），直接 new Chart 会抛
    // "bar is not a registered controller"：主入口模块加载后注册全量 registerables，
    // 使离屏出图可按声明类型出柱/折/面积/饼。register 重复注册无害，模块缓存保证只跑一次。
    module.Chart.register(...module.registerables)
    return module
  })
  return modulePromise
}
