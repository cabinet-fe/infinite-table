// 测试专用图表出图注入件：可录制绘制调用的假 2d 上下文/离屏画布，
// 与模拟「构造即同步出图 + destroy 清画布」契约的假 Chart.js 模块类。
// happy-dom 无真实 2d 上下文（getContext 返回 null），出图器单测经注入件驱动真实代码路径。

import type { ChartJsModule } from '../../src/chart/chart-loader'

/** 录制型假 2d 上下文：方法调用记为操作流水（产物非空断言依据） */
export class RecordingContext2D {
  /** 绘制操作流水：`方法:参数摘要` */
  readonly ops: string[] = []

  drawImage(image: { width: number; height: number }, dx: number, dy: number): void {
    this.ops.push(`drawImage:${image.width}x${image.height}@${dx},${dy}`)
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.ops.push(`fillRect:${width}x${height}@${x},${y}`)
  }
}

/** 假离屏画布：宽高可写、恒返回同一录制上下文 */
export class FakeCanvas {
  width = 0
  height = 0
  readonly ctx = new RecordingContext2D()

  getContext(contextId: '2d'): RecordingContext2D | null {
    return contextId === '2d' ? this.ctx : null
  }

  asCanvas(): HTMLCanvasElement {
    return this as unknown as HTMLCanvasElement
  }
}

interface RecordedChartConfig {
  type: string
  data: {
    labels?: string[]
    datasets: {
      label: string
      data: (number | null)[]
      backgroundColor?: string | string[]
      borderColor?: string
      fill?: boolean
    }[]
  }
  options: {
    responsive: boolean
    animation: boolean
    devicePixelRatio: number
    plugins?: { legend?: { display: boolean }; tooltip?: { enabled: boolean } }
  }
}

/** 已构造的假图表记录（配置断言与构造计数用） */
export interface RecordedChart {
  canvas: FakeCanvas
  config: RecordedChartConfig
  destroyed: boolean
  /** 出图后的操作流水快照（destroy 清画布前捕获，「产物非空」断言依据） */
  renderedOps: string[]
}

/** 模拟 Chart.js v4 行为契约的假 Chart 类：构造即同步出图，destroy 清画布并解绑 */
export class FakeChart {
  static readonly created: RecordedChart[] = []

  readonly canvas: FakeCanvas
  readonly config: RecordedChartConfig
  readonly record: RecordedChart

  constructor(canvas: FakeCanvas, config: RecordedChartConfig) {
    if (FakeChart.created.some((chart) => chart.canvas === canvas && !chart.destroyed)) {
      throw new Error('Canvas is already in use. Chart must be destroyed before reuse.')
    }
    // 模拟 retinaScale：canvas 物理尺寸 = CSS 尺寸 × devicePixelRatio，构造即落绘制调用
    const dpr = config.options.devicePixelRatio
    canvas.width = Math.round(canvas.width * dpr)
    canvas.height = Math.round(canvas.height * dpr)
    canvas.ctx.ops.push(`render:${config.type}:${canvas.width}x${canvas.height}`)
    this.canvas = canvas
    this.config = config
    this.record = {
      canvas,
      config,
      destroyed: false,
      renderedOps: [...canvas.ctx.ops],
    }
    FakeChart.created.push(this.record)
  }

  destroy(): void {
    // 模拟真实 destroy：清像素（clearCanvas + releaseContext 复原属性）
    this.record.destroyed = true
    this.record.canvas.ctx.ops.length = 0
  }
}

/** 出图器消费的假 Chart.js 模块（结构满足 ChartJsModule 的使用面） */
export function createFakeChartModule(): ChartJsModule {
  return {
    Chart: FakeChart as unknown as ChartJsModule['Chart'],
  } as unknown as ChartJsModule
}

/** 重置假模块记录（测试间隔离） */
export function resetFakeChart(): void {
  FakeChart.created.length = 0
}
