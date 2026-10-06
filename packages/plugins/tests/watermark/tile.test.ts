// 文字平铺水印几何与绘制单测：平铺原点计算（步长 = 内容尺寸 + gap 的双层循环）、
// 颜色 alpha 预混（globalAlpha 等效）、缺省样式解析与 drawTextWatermark 的
// 整层绘制序列（translate → rotate → fillText，记录型上下文断言）。

import { describe, expect, it } from 'vitest'

import {
  drawTextWatermark,
  resolveWatermarkStyle,
  watermarkFillColor,
  watermarkFont,
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
