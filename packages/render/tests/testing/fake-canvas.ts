// 测试共享的假 canvas/2d 上下文：记录调用、可控测量，供 node 环境下的单测注入
import type { RenderCanvas, RenderContext } from '../../src/types'

export interface RecordedCall {
  name: string
  args: unknown[]
}

export class FakeContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  font = ''
  readonly calls: RecordedCall[] = []

  private record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args })
  }

  callsOf(name: string): RecordedCall[] {
    return this.calls.filter((call) => call.name === name)
  }

  save(): void {
    this.record('save')
  }
  restore(): void {
    this.record('restore')
  }
  setTransform(...args: unknown[]): void {
    this.record('setTransform', ...args)
  }
  translate(x: number, y: number): void {
    this.record('translate', x, y)
  }
  beginPath(): void {
    this.record('beginPath')
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.record('rect', x, y, width, height)
  }
  moveTo(x: number, y: number): void {
    this.record('moveTo', x, y)
  }
  lineTo(x: number, y: number): void {
    this.record('lineTo', x, y)
  }
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.record('bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y)
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.record('quadraticCurveTo', cpx, cpy, x, y)
  }
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.record('arc', x, y, radius, startAngle, endAngle, counterclockwise)
  }
  closePath(): void {
    this.record('closePath')
  }
  stroke(): void {
    this.record('stroke')
  }
  fill(): void {
    this.record('fill')
  }
  clip(): void {
    this.record('clip')
  }
  clearRect(x: number, y: number, width: number, height: number): void {
    this.record('clearRect', x, y, width, height)
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.record('fillRect', x, y, width, height)
  }
  fillText(text: string, x: number, y: number): void {
    this.record('fillText', text, x, y)
  }
  drawImage(...args: unknown[]): void {
    this.record('drawImage', ...args)
  }
  measureText(text: string): {
    width: number
    actualBoundingBoxAscent: number
    actualBoundingBoxDescent: number
  } {
    return { width: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }
  }
}

export class FakeCanvas implements RenderCanvas {
  width = 0
  height = 0
  readonly context = new FakeContext()

  getContext(_contextId: '2d'): RenderContext | null {
    return this.context
  }
}

export function createFakeCanvas(): RenderCanvas {
  return new FakeCanvas()
}
