// headless 假画布（chart-support P5）：Chart.js 离屏出图在 bun 无 DOM 环境运行所需的
// 最小 2d 上下文调用面（BasicPlatform 路径：acquireContext + retinaScale + 布局/绘制）。
// 绘制一律 no-op（headless 不测栅格化成本），只保证 chart 插件 responsive:false +
// animation:false 的同步出图路径不因缺方法抛错，产物位图照常落 cell 级 MediaCache 走 blit。

/** 文本度量（宽度近似 + 基线度量，供刻度/标签布局计算） */
interface FakeTextMetrics {
  width: number
  actualBoundingBoxAscent: number
  actualBoundingBoxDescent: number
}

/** 线性渐变占位：Chart.js 只在 fill 配置需要时创建，addColorStop 为 no-op */
interface FakeLinearGradient {
  addColorStop(): void
}

/** 最小 2d 上下文：保留 Chart.js v4 构造路径（bar/line/pie + 类目/线性刻度）的调用面 */
class ChartJsMinimalContext {
  readonly canvas: ChartFakeCanvas
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  font = ''
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  imageSmoothingEnabled = true
  lineCap: CanvasLineCap = 'butt'
  lineJoin: CanvasLineJoin = 'miter'
  lineDashOffset = 0
  lineWidth = 1
  miterLimit = 10
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  direction: CanvasDirection = 'inherit'

  constructor(canvas: ChartFakeCanvas) {
    this.canvas = canvas
  }

  save(): void {}
  restore(): void {}
  setTransform(): void {}
  resetTransform(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  ellipse(): void {}
  arcTo(): void {}
  rect(): void {}
  roundRect(): void {}
  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  fill(): void {}
  stroke(): void {}
  clip(): void {}
  clearRect(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  fillText(): void {}
  strokeText(): void {}
  drawImage(): void {}

  measureText(text: string): FakeTextMetrics {
    return { width: text.length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }
  }

  setLineDash(): void {}
  getLineDash(): number[] {
    return []
  }

  createLinearGradient(): FakeLinearGradient {
    return { addColorStop: () => {} }
  }
}

/** 假离屏画布：宽高可写（Chart.js retinaScale 按显式 devicePixelRatio 落物理尺寸） */
export class ChartFakeCanvas {
  width = 0
  height = 0
  private readonly context: ChartJsMinimalContext

  constructor() {
    this.context = new ChartJsMinimalContext(this)
  }

  getContext(contextId: string): ChartJsMinimalContext | null {
    return contextId === '2d' ? this.context : null
  }

  /** chart 插件 createCanvas 注入点的 HTMLCanvasElement 形态（headless 无 DOM，结构伪装） */
  asCanvas(): HTMLCanvasElement {
    return this as unknown as HTMLCanvasElement
  }
}
