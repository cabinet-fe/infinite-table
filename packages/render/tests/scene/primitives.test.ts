import { describe, expect, it } from 'vitest'

import { hitTest } from '../../src/scene/hit-test'
import { paintTree } from '../../src/scene/paint'
import { ImageNode, PathNode, RectNode, TextNode } from '../../src/scene/primitives'
import { FakeCanvas, FakeContext } from '../testing/fake-canvas'

describe('路径原语调用序列', () => {
  it('折线：beginPath 后按序回放 moveTo/lineTo/closePath，最后 stroke', () => {
    const ctx = new FakeContext()
    const polyline = new PathNode({
      x: 0,
      y: 0,
      commands: [
        { type: 'moveTo', x: 0, y: 6 },
        { type: 'lineTo', x: 5, y: 0 },
        { type: 'lineTo', x: 10, y: 6 },
        { type: 'closePath' },
      ],
      stroke: '#333',
      lineWidth: 1.5,
    })
    paintTree(polyline, ctx)
    expect(ctx.calls.map((call) => call.name)).toEqual([
      'save',
      'translate',
      'beginPath',
      'moveTo',
      'lineTo',
      'lineTo',
      'closePath',
      'stroke',
      'restore',
    ])
    expect(ctx.callsOf('moveTo').map((call) => call.args)).toEqual([[0, 6]])
    expect(ctx.callsOf('lineTo').map((call) => call.args)).toEqual([
      [5, 0],
      [10, 6],
    ])
    expect(ctx.strokeStyle).toBe('#333')
    expect(ctx.lineWidth).toBe(1.5)
  })

  it('贝塞尔：bezierCurveTo/quadraticCurveTo 各自原样透传参数，fill 收尾', () => {
    const ctx = new FakeContext()
    const curve = new PathNode({
      commands: [
        { type: 'moveTo', x: 0, y: 0 },
        { type: 'bezierCurveTo', cp1x: 1, cp1y: 2, cp2x: 3, cp2y: 4, x: 5, y: 6 },
        { type: 'quadraticCurveTo', cpx: 7, cpy: 8, x: 9, y: 10 },
      ],
      fill: '#f00',
    })
    paintTree(curve, ctx)
    expect(ctx.calls.map((call) => call.name)).toEqual([
      'save',
      'translate',
      'beginPath',
      'moveTo',
      'bezierCurveTo',
      'quadraticCurveTo',
      'fill',
      'restore',
    ])
    expect(ctx.callsOf('bezierCurveTo').map((call) => call.args)).toEqual([[1, 2, 3, 4, 5, 6]])
    expect(ctx.callsOf('quadraticCurveTo').map((call) => call.args)).toEqual([[7, 8, 9, 10]])
    expect(ctx.fillStyle).toBe('#f00')
    expect(ctx.callsOf('stroke')).toHaveLength(0)
  })

  it('arc 命令透传圆心/半径/起止角与逆时针标记', () => {
    const ctx = new FakeContext()
    const arc = new PathNode({
      commands: [
        {
          type: 'arc',
          x: 4,
          y: 4,
          radius: 4,
          startAngle: 0,
          endAngle: Math.PI,
          counterclockwise: true,
        },
      ],
      fill: '#000',
    })
    paintTree(arc, ctx)
    expect(ctx.callsOf('arc').map((call) => call.args)).toEqual([[4, 4, 4, 0, Math.PI, true]])
  })
})

describe('矩形图元', () => {
  it('fill 走 fillRect，stroke 走 beginPath + rect + stroke 描边路径', () => {
    const ctx = new FakeContext()
    const rect = new RectNode({ x: 0, y: 0, width: 100, height: 50, fill: '#fff', stroke: '#333' })
    paintTree(rect, ctx)
    expect(ctx.calls.map((call) => call.name)).toEqual([
      'save',
      'translate',
      'fillRect',
      'beginPath',
      'rect',
      'stroke',
      'restore',
    ])
    expect(ctx.callsOf('fillRect').map((call) => call.args)).toEqual([[0, 0, 100, 50]])
    expect(ctx.callsOf('rect').map((call) => call.args)).toEqual([[0, 0, 100, 50]])
  })

  it('只配 fill 时不产生描边调用；命中按节点矩形', () => {
    const rect = new RectNode({ x: 10, y: 20, width: 30, height: 40, fill: '#fff' })
    const ctx = new FakeContext()
    paintTree(rect, ctx)
    expect(ctx.callsOf('stroke')).toHaveLength(0)
    expect(hitTest(rect, 10, 20)).toBe(rect)
    expect(hitTest(rect, 39, 59)).toBe(rect)
    expect(hitTest(rect, 40, 20)).toBeNull()
    expect(hitTest(rect, 10, 19)).toBeNull()
  })
})

describe('文本图元', () => {
  it('按 font 测量并回写外接盒，基线锚在 (0, ascent)', () => {
    const ctx = new FakeContext()
    const text = new TextNode({ x: 5, y: 6, text: 'hello', fill: '#111', font: '12px serif' })
    paintTree(text, ctx)
    // FakeContext 测量口径：每字符 10px 宽、ascent 8 / descent 2
    expect(text.width).toBe(50)
    expect(text.height).toBe(10)
    expect(ctx.font).toBe('12px serif')
    expect(ctx.callsOf('fillText').map((call) => call.args)).toEqual([['hello', 0, 8]])
  })

  it('显式给定的一侧尺寸不被测量回写覆盖', () => {
    const text = new TextNode({ text: 'hello', width: 200 })
    paintTree(text, new FakeContext())
    expect(text.width).toBe(200)
    expect(text.height).toBe(10)
  })

  it('命中按文本外接盒', () => {
    const text = new TextNode({ x: 10, y: 20, text: 'hello' })
    paintTree(text, new FakeContext())
    expect(hitTest(text, 10, 20)).toBe(text)
    expect(hitTest(text, 59, 29)).toBe(text)
    expect(hitTest(text, 60, 20)).toBeNull()
  })
})

describe('路径图元', () => {
  it('命令平移到包围盒原点，节点 x/y 为包围盒摆放位置', () => {
    const path = new PathNode({
      x: 100,
      y: 200,
      commands: [
        { type: 'moveTo', x: 10, y: 4 },
        { type: 'lineTo', x: 20, y: 4 },
        { type: 'lineTo', x: 15, y: 12 },
        { type: 'closePath' },
      ],
      fill: '#000',
    })
    expect(path.x).toBe(110)
    expect(path.y).toBe(204)
    expect(path.width).toBe(10)
    expect(path.height).toBe(8)
    expect(path.commands).toEqual([
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'lineTo', x: 10, y: 0 },
      { type: 'lineTo', x: 5, y: 8 },
      { type: 'closePath' },
    ])
    expect(path.getGlobalBounds()).toEqual({ x: 110, y: 204, width: 10, height: 8 })
  })

  it('曲线包围盒计入控制点（保守上界）', () => {
    const path = new PathNode({
      commands: [
        { type: 'moveTo', x: 0, y: 0 },
        { type: 'quadraticCurveTo', cpx: 30, cpy: 0, x: 10, y: 0 },
      ],
    })
    expect(path.width).toBe(30)
    expect(path.height).toBe(0)
  })

  it('圆弧包围盒取整圆外接盒（保守上界）', () => {
    const path = new PathNode({
      commands: [{ type: 'arc', x: 5, y: 5, radius: 3, startAngle: 0, endAngle: Math.PI / 2 }],
    })
    expect(path.x).toBe(2)
    expect(path.y).toBe(2)
    expect(path.width).toBe(6)
    expect(path.height).toBe(6)
  })

  it('命中按路径包围盒', () => {
    const path = new PathNode({
      x: 0,
      y: 0,
      commands: [
        { type: 'moveTo', x: 0, y: 0 },
        { type: 'lineTo', x: 10, y: 0 },
        { type: 'lineTo', x: 5, y: 8 },
        { type: 'closePath' },
      ],
      fill: '#000',
    })
    expect(hitTest(path, 1, 1)).toBe(path)
    expect(hitTest(path, 9, 7)).toBe(path)
    expect(hitTest(path, 10, 0)).toBeNull()
    expect(hitTest(path, 0, 8)).toBeNull()
  })
})

describe('图片图元', () => {
  it('按节点尺寸四参绘制，缺省尺寸取 source 当前宽高', () => {
    const ctx = new FakeContext()
    const source = new FakeCanvas()
    source.width = 20
    source.height = 10
    const image = new ImageNode({ x: 3, y: 4, source })
    paintTree(image, ctx)
    expect(image.width).toBe(20)
    expect(image.height).toBe(10)
    expect(ctx.callsOf('drawImage').map((call) => call.args)).toEqual([[source, 0, 0, 20, 10]])
  })

  it('显式尺寸覆盖 source 宽高，命中按图片矩形', () => {
    const source = new FakeCanvas()
    source.width = 20
    source.height = 10
    const image = new ImageNode({ x: 10, y: 20, source, width: 40, height: 30 })
    expect(image.width).toBe(40)
    expect(hitTest(image, 10, 20)).toBe(image)
    expect(hitTest(image, 49, 49)).toBe(image)
    expect(hitTest(image, 50, 20)).toBeNull()
  })
})
