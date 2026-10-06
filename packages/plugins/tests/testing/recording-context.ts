// 测试共享的记录型 2D 上下文（node 环境无 canvas）：实现 core 转出的 RenderContext
// 窄接口，按序记录水印绘制触达的调用，供平铺几何与插件行为断言。

import type { RenderContext } from '@infinitable/core'

export interface RecordedTranslate {
  x: number
  y: number
}

export interface RecordedText {
  text: string
  x: number
  y: number
}

export class RecordingContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  font = ''
  readonly translates: RecordedTranslate[] = []
  readonly rotations: number[] = []
  readonly texts: RecordedText[] = []
  /** 每次 measureText 调用时刻的 ctx.font 快照（锁定「先设 font 再测量」防回归） */
  readonly measureFonts: string[] = []
  saveCount = 0
  restoreCount = 0

  save(): void {
    this.saveCount++
  }

  restore(): void {
    this.restoreCount++
  }

  setTransform(): void {}

  translate(x: number, y: number): void {
    this.translates.push({ x, y })
  }

  rotate(rad: number): void {
    this.rotations.push(rad)
  }

  beginPath(): void {}

  rect(): void {}

  clip(): void {}

  clearRect(): void {}

  fillRect(): void {}

  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y })
  }

  drawImage(): void {}

  /** 测量约定「每字符 10px」（与 core StubHost 同口径）；记录调用时 font 供断言 */
  measureText(text: string): {
    width: number
    actualBoundingBoxAscent: number
    actualBoundingBoxDescent: number
  } {
    this.measureFonts.push(this.font)
    return { width: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }
  }
}
