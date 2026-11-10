// 命令式路径助手：dashedLine（手动虚线分段）与 roundRectPath（arc 拼四角圆角矩形）。
// 面向不经场景树、直接在 2D 上下文上铺路径的绘制方（overlay 参考线、数据块描边等）：
// ctx 取最小结构化接口，引擎 RenderContext 与宿主自备的窄上下文（只声明用到的成员）
// 都天然满足。纯函数零 DOM，不含表格语义。

/** 虚线图案（段长 + 间隔，px）：RenderContext 无 setLineDash，按图案手动分段铺路径 */
export interface DashPattern {
  /** 实线段长（px） */
  dash: number
  /** 间隔长（px） */
  gap: number
}

/** 虚线铺设的最小路径接口（结构化子类型：RenderContext 及宿主窄上下文天然满足） */
export interface DashLineContext {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
}

/** 圆角矩形路径构造的最小路径接口 */
export interface RoundRectPathContext {
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void
  closePath(): void
}

/**
 * 手动虚线段：从 (x1,y1) 到 (x2,y2) 按图案推进（水平/垂直/斜线通用）。
 * 调用方负责 beginPath / 描边样式 / stroke；本函数只铺路径，零长度线不产生任何调用。
 */
export function dashedLine(
  ctx: DashLineContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pattern: DashPattern,
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  if (length === 0) return
  const ux = dx / length
  const uy = dy / length
  const step = pattern.dash + pattern.gap
  for (let d = 0; d < length; d += step) {
    const end = Math.min(d + pattern.dash, length)
    ctx.moveTo(x1 + ux * d, y1 + uy * d)
    ctx.lineTo(x1 + ux * end, y1 + uy * end)
  }
}

/**
 * 圆角矩形路径（RenderContext 无 roundRect，用 arc 拼四角）。自带 beginPath 与
 * closePath 整段构造一条闭合路径，调用方随后 fill 或 stroke；radius 超出半宽/半高
 * 时夹取到较短半边（退化为胶囊形）。
 */
export function roundRectPath(
  ctx: RoundRectPathContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, height / 2, width / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.arc(x + width - r, y + r, r, -Math.PI / 2, 0)
  ctx.lineTo(x + width, y + height - r)
  ctx.arc(x + width - r, y + height - r, r, 0, Math.PI / 2)
  ctx.lineTo(x + r, y + height)
  ctx.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI)
  ctx.lineTo(x, y + r)
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5)
  ctx.closePath()
}
