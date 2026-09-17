// 测试共享的记录型 2D 上下文：按序记录绘制调用，供 node 环境下的单测断言
import type { RenderContext } from '@infinite-table/render'

export interface RecordedCall {
  name: string
  args: unknown[]
}

export class RecordingContext implements RenderContext {
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
