// 文字平铺水印几何与绘制单测：平铺原点计算（步长 = 内容尺寸 + gap 的双层循环）、
// 颜色 alpha 预混（globalAlpha 等效）、缺省样式解析与 drawTextWatermark 的
// 整层绘制序列（translate → rotate → fillText，记录型上下文断言）。

import { describe, expect, it, vi } from 'vitest'

import type { RenderCanvas, RenderImageSource } from '@infinitable/render'

import {
  drawTextWatermark,
  resolveWatermarkStyle,
  watermarkFillColor,
  watermarkFont,
  WatermarkTileCache,
  watermarkTileOrigins,
} from '../../src/watermark/tile'
import { RecordingContext } from '../testing/recording-context'

describe('watermarkTileOrigins 平铺几何', () => {
  it('步长 = 内容尺寸 + gap：800×600 视口、200×20 内容、gap 100×80 → 3×6 网格', () => {
    const origins = watermarkTileOrigins(
      { width: 800, height: 600 },
      { width: 200, height: 20 },
      100,
      80,
    )
    expect(origins).toHaveLength(18)
    expect(origins[0]).toEqual({ x: 0, y: 0 })
    // x 轴 0/300/600（600 < 800 计入，900 越出）；y 轴 0..500 步长 100
    expect([...new Set(origins.map((o) => o.x))]).toEqual([0, 300, 600])
    expect([...new Set(origins.map((o) => o.y))]).toEqual([0, 100, 200, 300, 400, 500])
    expect(origins[17]).toEqual({ x: 600, y: 500 })
  })

  it('末列部分可见计入：视口宽 610 时 x 为 0/300/600', () => {
    const origins = watermarkTileOrigins(
      { width: 610, height: 60 },
      { width: 200, height: 20 },
      100,
      80,
    )
    expect(origins).toHaveLength(3)
    expect(origins.map((o) => o.x)).toEqual([0, 300, 600])
  })

  it('退化输入不绘制：步长 ≤ 0 或视口非正返回空数组', () => {
    expect(
      watermarkTileOrigins({ width: 800, height: 600 }, { width: 0, height: 20 }, 0, 80),
    ).toEqual([])
    expect(
      watermarkTileOrigins({ width: 800, height: 600 }, { width: 200, height: 20 }, 100, -30),
    ).toEqual([])
    expect(
      watermarkTileOrigins({ width: 0, height: 600 }, { width: 200, height: 20 }, 100, 80),
    ).toEqual([])
  })
})

describe('watermarkFillColor 颜色 alpha 预混', () => {
  it('hex 色与 opacity 合成 rgba（globalAlpha 等效）', () => {
    expect(watermarkFillColor('#000000', 0.12)).toBe('rgba(0, 0, 0, 0.12)')
    expect(watermarkFillColor('#ff8800', 0.5)).toBe('rgba(255, 136, 0, 0.5)')
    // 三位缩写展开
    expect(watermarkFillColor('#abc', 1)).toBe('rgba(170, 187, 204, 1)')
  })

  it('非 hex 颜色原样返回（alpha 由颜色自带）', () => {
    expect(watermarkFillColor('rgb(1, 2, 3)', 0.5)).toBe('rgb(1, 2, 3)')
    expect(watermarkFillColor('red', 0.5)).toBe('red')
  })
})

describe('resolveWatermarkStyle 缺省解析', () => {
  it('未给字段回落 WATERMARK_TEXT_DEFAULTS，显式值优先', () => {
    expect(resolveWatermarkStyle({ enabled: true, text: '机密' })).toEqual({
      fontSize: 14,
      color: '#000000',
      opacity: 0.12,
      rotate: -30,
      gapX: 160,
      gapY: 120,
    })
    expect(resolveWatermarkStyle({ enabled: true, text: '机密', fontSize: 20, rotate: 0 })).toEqual(
      {
        fontSize: 20,
        color: '#000000',
        opacity: 0.12,
        rotate: 0,
        gapX: 160,
        gapY: 120,
      },
    )
  })
})

describe('drawTextWatermark 整层绘制', () => {
  it('逐单元 translate（中心）→ rotate → fillText，整层统一 font 与预混 fillStyle', () => {
    const ctx = new RecordingContext()
    drawTextWatermark(
      ctx,
      { enabled: true, text: 'wm', fontSize: 10, opacity: 0.12, rotate: -30, gapX: 100, gapY: 50 },
      { width: 220, height: 60 },
    )
    // 内容宽 20（2 字符 × 10px）高 10：stepX 120（x 0/120）、stepY 60（y 仅 0）→ 2 单元
    expect(ctx.texts).toHaveLength(2)
    expect(ctx.translates).toEqual([
      { x: 10, y: 5 },
      { x: 130, y: 5 },
    ])
    expect(ctx.rotations).toEqual([(-30 * Math.PI) / 180, (-30 * Math.PI) / 180])
    expect(ctx.font).toBe(watermarkFont(10))
    expect(ctx.fillStyle).toBe('rgba(0, 0, 0, 0.12)')
    // 文本以单元中心为原点：左缘 -内容宽/2，基线 0.3 × 字号近似居中
    expect(ctx.texts[0]).toEqual({ text: 'wm', x: -10, y: 3 })
    expect(ctx.saveCount).toBe(ctx.restoreCount)
  })

  it('先设 font 再测量：measureText 时刻的 font 即水印字体（防 10px 缺省字宽回归）', () => {
    const ctx = new RecordingContext()
    drawTextWatermark(
      ctx,
      { enabled: true, text: 'wm', fontSize: 32, gapX: 100, gapY: 50 },
      { width: 400, height: 200 },
    )
    // 真实 2D 上下文按当前 font 计量：测量发生在设 font 之后（整层只测量一次）
    expect(ctx.measureFonts).toEqual([watermarkFont(32)])
  })

  it('无平铺单元（空文本零间距 / 视口非正）时不触碰上下文', () => {
    const ctx = new RecordingContext()
    drawTextWatermark(ctx, { enabled: true, text: '', gapX: 0 }, { width: 300, height: 200 })
    drawTextWatermark(ctx, { enabled: true, text: 'wm' }, { width: 0, height: 200 })
    expect(ctx.texts).toEqual([])
    expect(ctx.translates).toEqual([])
    expect(ctx.saveCount).toBe(0)
  })
})

/** 支持 createPattern 与记录 fillRect 的测试上下文 */
class PatternRecordingContext extends RecordingContext {
  readonly createdPatterns: { image: RenderImageSource; repetition: string | null }[] = []
  readonly fillRects: { x: number; y: number; width: number; height: number }[] = []

  override fillRect(x: number, y: number, width: number, height: number): void {
    this.fillRects.push({ x, y, width, height })
  }

  createPattern(
    image: RenderImageSource,
    repetition: 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat' | null,
  ): CanvasPattern | null {
    this.createdPatterns.push({ image, repetition })
    return { setTransform() {} } as unknown as CanvasPattern
  }
}

describe('WatermarkTileCache 离屏 CanvasPattern 缓存', () => {
  it('ctx.createPattern + 离屏画布可用时走图案快路径，重绘与 resize 复用同一瓦片不重绘', () => {
    const offscreenContexts: RecordingContext[] = []
    let canvasCreates = 0
    const canvasFactory = (): RenderCanvas => {
      canvasCreates++
      const tileCtx = new RecordingContext()
      offscreenContexts.push(tileCtx)
      return {
        width: 0,
        height: 0,
        getContext: () => tileCtx,
      }
    }

    const cache = new WatermarkTileCache(canvasFactory)
    const ctx = new PatternRecordingContext()
    const config = { enabled: true, text: 'wm', fontSize: 10, gapX: 100, gapY: 50 }

    drawTextWatermark(ctx, config, { width: 800, height: 600 }, { cache })
    expect(canvasCreates).toBe(1)
    expect(ctx.createdPatterns).toHaveLength(1)
    expect(ctx.createdPatterns[0]?.repetition).toBe('repeat')
    expect(ctx.fillRects).toEqual([{ x: 0, y: 0, width: 800, height: 600 }])
    // 主上下文未退化逐格 fillText；离屏瓦片画布绘制 3×3 周期包裹单元
    expect(ctx.texts).toHaveLength(0)
    expect(offscreenContexts[0]?.texts).toHaveLength(9)
    expect(offscreenContexts[0]?.saveCount).toBe(offscreenContexts[0]?.restoreCount)

    // 同参数重绘 & 视口尺寸变化：直接复用缓存 CanvasPattern 与离屏画布，零重新生成
    drawTextWatermark(ctx, { ...config }, { width: 1200, height: 900 }, { cache })
    expect(canvasCreates).toBe(1)
    expect(ctx.createdPatterns).toHaveLength(1)
    expect(ctx.fillRects).toEqual([
      { x: 0, y: 0, width: 800, height: 600 },
      { x: 0, y: 0, width: 1200, height: 900 },
    ])
  })

  it('参数或 DPR 变更使缓存失效并重建瓦片', () => {
    let canvasCreates = 0
    const canvasFactory = (): RenderCanvas => {
      canvasCreates++
      const tileCtx = new RecordingContext()
      return { width: 0, height: 0, getContext: () => tileCtx }
    }

    const cache = new WatermarkTileCache(canvasFactory)
    const ctx = new PatternRecordingContext()
    const base = {
      enabled: true,
      text: 'wm',
      fontSize: 14,
      color: '#000000',
      rotate: -30,
      gapX: 160,
      gapY: 120,
    }

    drawTextWatermark(ctx, base, { width: 400, height: 300 }, { cache, dpr: 1 })
    expect(canvasCreates).toBe(1)

    drawTextWatermark(ctx, { ...base, text: 'wm2' }, { width: 400, height: 300 }, { cache, dpr: 1 })
    expect(canvasCreates).toBe(2)

    drawTextWatermark(
      ctx,
      { ...base, text: 'wm2', fontSize: 20 },
      { width: 400, height: 300 },
      { cache, dpr: 1 },
    )
    expect(canvasCreates).toBe(3)

    drawTextWatermark(
      ctx,
      { ...base, text: 'wm2', fontSize: 20, color: '#ff0000' },
      { width: 400, height: 300 },
      { cache, dpr: 1 },
    )
    expect(canvasCreates).toBe(4)

    drawTextWatermark(
      ctx,
      { ...base, text: 'wm2', fontSize: 20, color: '#ff0000', rotate: 15 },
      { width: 400, height: 300 },
      { cache, dpr: 1 },
    )
    expect(canvasCreates).toBe(5)

    drawTextWatermark(
      ctx,
      { ...base, text: 'wm2', fontSize: 20, color: '#ff0000', rotate: 15, gapX: 80 },
      { width: 400, height: 300 },
      { cache, dpr: 1 },
    )
    expect(canvasCreates).toBe(6)

    drawTextWatermark(
      ctx,
      { ...base, text: 'wm2', fontSize: 20, color: '#ff0000', rotate: 15, gapX: 80 },
      { width: 400, height: 300 },
      { cache, dpr: 1, offsetX: 12 },
    )
    expect(canvasCreates).toBe(7)

    // 模拟支持 DOMMatrix 的高 DPR 宿主环境，验证 DPR 变更触发重建并通过 pattern.setTransform 缩回 CSS 尺寸
    const FakeDOMMatrix = class {
      scaleX = 1
      scaleY = 1
      scale(x: number, y = x) {
        this.scaleX = x
        this.scaleY = y
        return this
      }
    }
    vi.stubGlobal('DOMMatrix', FakeDOMMatrix)
    try {
      drawTextWatermark(
        ctx,
        { ...base, text: 'wm2', fontSize: 20, color: '#ff0000', rotate: 15, gapX: 80 },
        { width: 400, height: 300 },
        { cache, dpr: 2, offsetX: 12 },
      )
      expect(canvasCreates).toBe(8)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('无 createPattern 或离屏 2D 上下文不可用时回落逐格平铺路径', () => {
    const noPatternCtx = new RecordingContext()
    drawTextWatermark(
      noPatternCtx,
      { enabled: true, text: 'wm', fontSize: 10, gapX: 100, gapY: 50 },
      { width: 220, height: 60 },
    )
    expect(noPatternCtx.texts).toHaveLength(2)

    const nullCanvasCache = new WatermarkTileCache(() => ({
      width: 0,
      height: 0,
      getContext: () => null,
    }))
    const fallbackCtx = new PatternRecordingContext()
    drawTextWatermark(
      fallbackCtx,
      { enabled: true, text: 'wm', fontSize: 10, gapX: 100, gapY: 50 },
      { width: 220, height: 60 },
      { cache: nullCanvasCache },
    )
    expect(fallbackCtx.createdPatterns).toHaveLength(0)
    expect(fallbackCtx.fillRects).toHaveLength(0)
    expect(fallbackCtx.texts).toHaveLength(2)
  })
})
