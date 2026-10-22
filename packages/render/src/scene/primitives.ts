// 内建图元节点：矩形/文本/路径/图片四种最小自绘单位，复用 SceneNode 挂载与绘制协议。
// 供表头按格自绘、排序指示等任意自绘场景与离屏快照合成直接拼装，不含表格语义。
import { SceneNode } from './scene-node'
import type { SceneNodeInit } from './scene-node'
import type { RenderContext, RenderImageSource } from '../types'

/** 填充/描边取值（同 canvas fillStyle/strokeStyle 口径） */
export type PaintStyle = string | CanvasGradient | CanvasPattern

/** 填充/描边共用配置段 */
interface ShapeStyleInit {
  fill?: PaintStyle
  stroke?: PaintStyle
  lineWidth?: number
}

export interface RectNodeInit extends SceneNodeInit, ShapeStyleInit {}

/**
 * 矩形图元：以节点包围盒为几何，fill 走 fillRect、stroke 走 beginPath + rect + stroke
 * 描边路径；fill/stroke 均可缺省（都不配则不绘制）。
 */
export class RectNode extends SceneNode {
  readonly fill: PaintStyle | undefined
  readonly stroke: PaintStyle | undefined
  readonly lineWidth: number

  constructor(init: RectNodeInit) {
    super(init)
    this.fill = init.fill
    this.stroke = init.stroke
    this.lineWidth = init.lineWidth ?? 1
  }

  override paint(ctx: RenderContext): void {
    if (this.fill !== undefined) {
      ctx.fillStyle = this.fill
      ctx.fillRect(0, 0, this.width, this.height)
    }
    if (this.stroke !== undefined) {
      ctx.strokeStyle = this.stroke
      ctx.lineWidth = this.lineWidth
      ctx.beginPath()
      ctx.rect(0, 0, this.width, this.height)
      ctx.stroke()
    }
  }
}

export interface TextNodeInit extends SceneNodeInit {
  text: string
  fill?: PaintStyle
  /** 绘制与测量所用 font（缺省沿用上下文当前 font） */
  font?: string
}

/**
 * 文本图元：基线锚在局部 (0, ascent)，每次绘制前经 measureText 求文本外接盒，
 * 并把未显式给定的一侧尺寸回写为测量值（命中与脏区剔除即用该盒）；
 * 首次绘制前且未显式给尺寸时为空盒（不可命中）。
 */
export class TextNode extends SceneNode {
  text: string
  fill: PaintStyle
  font: string | undefined
  private readonly measureWidth: boolean
  private readonly measureHeight: boolean

  constructor(init: TextNodeInit) {
    super(init)
    this.text = init.text
    this.fill = init.fill ?? '#000'
    this.font = init.font
    this.measureWidth = init.width === undefined
    this.measureHeight = init.height === undefined
  }

  override paint(ctx: RenderContext): void {
    if (this.font !== undefined) {
      ctx.font = this.font
    }
    const metrics = ctx.measureText(this.text)
    const ascent = metrics.actualBoundingBoxAscent ?? 0
    const descent = metrics.actualBoundingBoxDescent ?? 0
    if (this.measureWidth) {
      this.width = metrics.width
    }
    if (this.measureHeight) {
      this.height = ascent + descent
    }
    ctx.fillStyle = this.fill
    ctx.fillText(this.text, 0, ascent)
  }
}

/** 路径命令：与 RenderContext 路径原语一一对应（局部坐标） */
export type PathCommand =
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number }
  | {
      type: 'bezierCurveTo'
      cp1x: number
      cp1y: number
      cp2x: number
      cp2y: number
      x: number
      y: number
    }
  | { type: 'quadraticCurveTo'; cpx: number; cpy: number; x: number; y: number }
  | {
      type: 'arc'
      x: number
      y: number
      radius: number
      startAngle: number
      endAngle: number
      counterclockwise?: boolean
    }
  | { type: 'closePath' }

export interface PathNodeInit extends SceneNodeInit, ShapeStyleInit {
  commands: readonly PathCommand[]
}

/**
 * 路径图元：命令序列回放为一条 canvas 路径后按 fill/stroke 填充/描边（先填充后描边）。
 * 包围盒由命令坐标推导：曲线段计入控制点（凸包上界）、圆弧取整圆外接盒（保守上界）；
 * 命令在构造时整体平移使包围盒左上角落在节点局部原点（节点 x/y 即包围盒摆放位置），
 * init 中的 width/height 不参与。
 */
export class PathNode extends SceneNode {
  readonly commands: readonly PathCommand[]
  readonly fill: PaintStyle | undefined
  readonly stroke: PaintStyle | undefined
  readonly lineWidth: number

  constructor(init: PathNodeInit) {
    super(init)
    const { commands, minX, minY } = normalizeCommands(init.commands)
    const box = pathBounds(commands)
    this.commands = commands
    this.fill = init.fill
    this.stroke = init.stroke
    this.lineWidth = init.lineWidth ?? 1
    this.x += minX
    this.y += minY
    this.width = box.width
    this.height = box.height
  }

  override paint(ctx: RenderContext): void {
    ctx.beginPath()
    for (const command of this.commands) {
      applyCommand(ctx, command)
    }
    if (this.fill !== undefined) {
      ctx.fillStyle = this.fill
      ctx.fill()
    }
    if (this.stroke !== undefined) {
      ctx.strokeStyle = this.stroke
      ctx.lineWidth = this.lineWidth
      ctx.stroke()
    }
  }
}

/** 命令整体平移到包围盒原点（返回新数组，不改调用方数据），并带回原始包围盒左上角 */
function normalizeCommands(commands: readonly PathCommand[]): {
  commands: PathCommand[]
  minX: number
  minY: number
} {
  const box = pathBounds(commands)
  const dx = -box.x
  const dy = -box.y
  return {
    commands: commands.map((command) => shiftCommand(command, dx, dy)),
    minX: box.x,
    minY: box.y,
  }
}

/** 命令坐标点的包围盒（曲线含控制点、圆弧取整圆外接盒，均为保守上界） */
function pathBounds(commands: readonly PathCommand[]): {
  x: number
  y: number
  width: number
  height: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const include = (x: number, y: number): void => {
    if (x < minX) {
      minX = x
    }
    if (y < minY) {
      minY = y
    }
    if (x > maxX) {
      maxX = x
    }
    if (y > maxY) {
      maxY = y
    }
  }
  for (const command of commands) {
    switch (command.type) {
      case 'moveTo':
      case 'lineTo':
        include(command.x, command.y)
        break
      case 'bezierCurveTo':
        include(command.cp1x, command.cp1y)
        include(command.cp2x, command.cp2y)
        include(command.x, command.y)
        break
      case 'quadraticCurveTo':
        include(command.cpx, command.cpy)
        include(command.x, command.y)
        break
      case 'arc':
        include(command.x - command.radius, command.y - command.radius)
        include(command.x + command.radius, command.y + command.radius)
        break
      case 'closePath':
        break
    }
  }
  if (minX === Infinity) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function shiftCommand(command: PathCommand, dx: number, dy: number): PathCommand {
  switch (command.type) {
    case 'moveTo':
    case 'lineTo':
      return { ...command, x: command.x + dx, y: command.y + dy }
    case 'bezierCurveTo':
      return {
        ...command,
        cp1x: command.cp1x + dx,
        cp1y: command.cp1y + dy,
        cp2x: command.cp2x + dx,
        cp2y: command.cp2y + dy,
        x: command.x + dx,
        y: command.y + dy,
      }
    case 'quadraticCurveTo':
      return {
        ...command,
        cpx: command.cpx + dx,
        cpy: command.cpy + dy,
        x: command.x + dx,
        y: command.y + dy,
      }
    case 'arc':
      return { ...command, x: command.x + dx, y: command.y + dy }
    case 'closePath':
      return command
  }
}

function applyCommand(ctx: RenderContext, command: PathCommand): void {
  switch (command.type) {
    case 'moveTo':
      ctx.moveTo(command.x, command.y)
      break
    case 'lineTo':
      ctx.lineTo(command.x, command.y)
      break
    case 'bezierCurveTo':
      ctx.bezierCurveTo(
        command.cp1x,
        command.cp1y,
        command.cp2x,
        command.cp2y,
        command.x,
        command.y,
      )
      break
    case 'quadraticCurveTo':
      ctx.quadraticCurveTo(command.cpx, command.cpy, command.x, command.y)
      break
    case 'arc':
      ctx.arc(
        command.x,
        command.y,
        command.radius,
        command.startAngle,
        command.endAngle,
        command.counterclockwise,
      )
      break
    case 'closePath':
      ctx.closePath()
      break
  }
}

export interface ImageNodeInit extends SceneNodeInit {
  source: RenderImageSource
}

/**
 * 图片图元：source 按节点包围盒尺寸绘制（drawImage 四参形态）。
 * 尺寸缺省时取 source 当前 width/height（各图像源运行时均携带，位图未就绪时为 0，
 * 调用方须显式传尺寸）。
 */
export class ImageNode extends SceneNode {
  readonly source: RenderImageSource

  constructor(init: ImageNodeInit) {
    super(init)
    this.source = init.source
    const source = this.source as Partial<{ width: number; height: number }>
    this.width = init.width ?? source.width ?? 0
    this.height = init.height ?? source.height ?? 0
  }

  override paint(ctx: RenderContext): void {
    ctx.drawImage(this.source, 0, 0, this.width, this.height)
  }
}
