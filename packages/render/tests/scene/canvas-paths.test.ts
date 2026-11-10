// 命令式路径助手单测：dashedLine 虚线分段推进与 roundRectPath 四角 arc 拼装。
// 断言落在录制型 FakeContext 的调用序列与坐标参数上（几何即断言），零真实画布。

import { describe, expect, it } from 'vitest'

import { dashedLine, roundRectPath } from '../../src/scene/canvas-paths'
import { FakeContext } from '../testing/fake-canvas'

describe('dashedLine：按图案手动分段铺路径', () => {
  it('水平线按 dash/gap 步进：每段 moveTo 起点 + lineTo 段尾', () => {
    const ctx = new FakeContext()
    // 长 14、段 4 / 间隔 3（步进 7）：段 [0,4] 与 [7,11]，[14,18] 越界不铺
    dashedLine(ctx, 0, 0, 14, 0, { dash: 4, gap: 3 })
    expect(ctx.callsOf('moveTo').map((call) => call.args)).toEqual([
      [0, 0],
      [7, 0],
    ])
    expect(ctx.callsOf('lineTo').map((call) => call.args)).toEqual([
      [4, 0],
      [11, 0],
    ])
  })

  it('末段夹取到线长：不足一个完整段时 lineTo 收在线段终点', () => {
    const ctx = new FakeContext()
    // 长 10：第二段 [7, 11] 夹取为 [7, 10]
    dashedLine(ctx, 0, 0, 10, 0, { dash: 4, gap: 3 })
    expect(ctx.callsOf('lineTo').map((call) => call.args)).toEqual([
      [4, 0],
      [10, 0],
    ])
  })

  it('斜线沿单位向量推进（3-4-5 直角三角形：单段全长铺到终点）', () => {
    const ctx = new FakeContext()
    dashedLine(ctx, 0, 0, 3, 4, { dash: 5, gap: 2 })
    expect(ctx.callsOf('moveTo').map((call) => call.args)).toEqual([[0, 0]])
    expect(ctx.callsOf('lineTo').map((call) => call.args)).toEqual([[3, 4]])
  })

  it('零长度线不产生任何调用；本函数不 beginPath/stroke（编排留给调用方）', () => {
    const ctx = new FakeContext()
    dashedLine(ctx, 5, 5, 5, 5, { dash: 4, gap: 3 })
    expect(ctx.calls).toHaveLength(0)
    dashedLine(ctx, 0, 0, 1, 0, { dash: 4, gap: 3 })
    expect(ctx.callsOf('beginPath')).toHaveLength(0)
    expect(ctx.callsOf('stroke')).toHaveLength(0)
  })
})

describe('roundRectPath：arc 拼四角圆角矩形', () => {
  it('顺时针构造闭合路径：四边直线 + 四角 90° 圆弧', () => {
    const ctx = new FakeContext()
    roundRectPath(ctx, 10, 20, 100, 40, 8)
    expect(ctx.calls.map((call) => call.name)).toEqual([
      'beginPath',
      'moveTo',
      'lineTo',
      'arc',
      'lineTo',
      'arc',
      'lineTo',
      'arc',
      'lineTo',
      'arc',
      'closePath',
    ])
    expect(ctx.callsOf('moveTo').map((call) => call.args)).toEqual([[18, 20]])
    // 末参 counterclockwise 未传，只断言前五参（圆心/半径/起止角）
    expect(ctx.callsOf('arc').map((call) => call.args.slice(0, 5))).toEqual([
      [102, 28, 8, -Math.PI / 2, 0],
      [102, 52, 8, 0, Math.PI / 2],
      [18, 52, 8, Math.PI / 2, Math.PI],
      [18, 28, 8, Math.PI, Math.PI * 1.5],
    ])
    expect(ctx.callsOf('closePath')).toHaveLength(1)
  })

  it('radius 超出半宽/半高时夹取到较短半边（退化为胶囊形）', () => {
    const ctx = new FakeContext()
    // 半高 20 / 半宽 10：radius 30 → 夹取 10，顶边直线段只到 x + width − 10
    roundRectPath(ctx, 0, 0, 20, 40, 30)
    expect(ctx.callsOf('moveTo').map((call) => call.args)).toEqual([[10, 0]])
    expect(ctx.callsOf('arc').map((call) => call.args.slice(0, 5))).toEqual([
      [10, 10, 10, -Math.PI / 2, 0],
      [10, 30, 10, 0, Math.PI / 2],
      [10, 30, 10, Math.PI / 2, Math.PI],
      [10, 10, 10, Math.PI, Math.PI * 1.5],
    ])
  })
})
