// 浮动对象变换交互测试：手柄命中（8 缩放 + 1 旋转）、缩放/旋转几何计算
// （对侧锚点固定、Shift 等比、15° 吸附、角度归一化）、onTransformEnd 载荷与阈值语义。
// 台架与 float-object-layer.test.ts 共用 tests/testing/float-fixtures。
import { describe, expect, it } from 'vitest'

import type { SceneNode } from '@infinitable/render'

import {
  FloatObjectLayer,
  type FloatTransformEndEvent,
  type FloatTransformHandle,
} from '../../src/float/float-object-layer'
import { RecordingContext } from '../testing/recording-context'
import { hitCell, imageObject, stubGeometry, stubLayer } from '../testing/float-fixtures'

describe('FloatObjectLayer 变换（缩放/旋转，univer Transformer 思路）', () => {
  /** 变换测试台架：对象 a 层坐标 (104,72) 尺寸 (196,56)，中心 (202,100)，已选中 */
  function transformSetup(rotation = 0) {
    const { layer, invalidated } = stubLayer()
    const floats = new FloatObjectLayer({
      layer,
      geometry: stubGeometry({ left: 0, top: 0 }, undefined, hitCell),
    })
    floats.add({ ...imageObject('a', { col: 1, row: 2 }), rotation })
    floats.select('a')
    invalidated.length = 0
    return { layer, floats, invalidated }
  }

  /** 台架节点（容器下唯一子节点；rotation 为浮动节点渲染态，场景节点基类未声明） */
  function nodeOf(layer: ReturnType<typeof stubLayer>['layer']) {
    const node = layer.root.children[0]?.children[0] as
      | (SceneNode & { rotation: number })
      | undefined
    if (!node) {
      throw new Error('浮动对象节点缺失')
    }
    return node
  }

  it('手柄命中：选中对象 8 缩放手柄 + 1 旋转手柄各命中；未选中/对象体内无手柄', () => {
    const { floats } = transformSetup()
    // 手柄中心（层坐标，未旋转）：四角 + 四边中点 + 顶部旋转手柄（上缘外 20px）
    const expected: Array<[FloatTransformHandle, number, number]> = [
      ['left-top', 104, 72],
      ['center-top', 202, 72],
      ['right-top', 300, 72],
      ['left-middle', 104, 100],
      ['right-middle', 300, 100],
      ['left-bottom', 104, 128],
      ['center-bottom', 202, 128],
      ['right-bottom', 300, 128],
      ['rotate', 202, 52],
    ]
    for (const [handle, x, y] of expected) {
      expect(floats.handleAt(x, y)).toBe(handle)
    }
    // 手柄方块外（距 left-top 中心 (7,7)）与对象体内（中心）都不命中
    expect(floats.handleAt(97, 65)).toBeNull()
    expect(floats.handleAt(202, 100)).toBeNull()

    // 未选中：无手柄
    const { floats: plain } = transformSetup()
    plain.clearSelection()
    expect(plain.handleAt(202, 52)).toBeNull()
  })

  it('旋转对象的手柄随 rotation 旋转后仍命中（逆变换路径）', () => {
    const { floats } = transformSetup(90)
    // 未旋转帧 left-top (104,72) 绕中心 (202,100) 旋转 90° → (230,2)；
    // 旋转手柄 (202,52) → (250,100)
    expect(floats.handleAt(230, 2)).toBe('left-top')
    expect(floats.handleAt(250, 100)).toBe('rotate')
  })

  it('选中态绘制 8 缩放手柄与顶部旋转手柄（白芯蓝框方块 + 连杆）', () => {
    const { layer } = transformSetup()
    const node = nodeOf(layer)
    const ctx = new RecordingContext()
    node.paint(ctx)
    const rects = ctx.callsOf('fillRect')
    // 局部帧坐标（ctx 已平移到节点原点）：右下角手柄中心 (196,56) →
    // 蓝框 8×8 + 白芯 4×4（两层 fillRect 拼边框）
    expect(rects).toContainEqual({ name: 'fillRect', args: [192, 52, 8, 8] })
    expect(rects).toContainEqual({ name: 'fillRect', args: [194, 54, 4, 4] })
    // 顶部旋转手柄中心 (98,-20)：连杆（上缘到手柄，宽 2）+ 实心方块
    expect(rects).toContainEqual({ name: 'fillRect', args: [97, -16, 2, 12] })
    expect(rects).toContainEqual({ name: 'fillRect', args: [94, -24, 8, 8] })
    // 手柄总数锁定：占位 1 + 环 4 + 8×2 + 杆 1 + 方块 1 = 23 笔
    expect(rects).toHaveLength(23)
  })

  it('拖右下角缩放：尺寸随指针增量变大，对侧（左上角）保持不动；双区域定向失效', () => {
    const { layer, floats, invalidated } = transformSetup()
    expect(floats.beginTransform('right-bottom', 300, 128)).toBe(true)
    expect(floats.isTransforming()).toBe(true)
    floats.transformMove(330, 148, false)
    const node = nodeOf(layer)
    expect({ x: node.x, y: node.y, width: node.width, height: node.height }).toEqual({
      x: 104,
      y: 72,
      width: 226,
      height: 76,
    })
    // 失效语言：cell 级成对区域（旧包围盒 + 新包围盒，选中态外扩一档）
    expect(invalidated).toEqual([
      {
        type: 'cell',
        region: { x: 78, y: 46, width: 278, height: 128 },
        prevRegion: { x: 78, y: 46, width: 248, height: 108 },
      },
    ])
  })

  it('拖左上角缩放：对象向反侧扩展，右下角锚点保持不动（角跟随指针）', () => {
    const { layer, floats } = transformSetup()
    floats.beginTransform('left-top', 104, 72)
    floats.transformMove(94, 64, false)
    const node = nodeOf(layer)
    expect({ x: node.x, y: node.y, width: node.width, height: node.height }).toEqual({
      x: 94,
      y: 64,
      width: 206,
      height: 64,
    })
  })

  it('拖边中点缩放：仅单轴变化（右缘拖动只改宽，垂直中心不动）', () => {
    const { layer, floats } = transformSetup()
    floats.beginTransform('right-middle', 300, 100)
    floats.transformMove(330, 90, false)
    const node = nodeOf(layer)
    expect({ x: node.x, y: node.y, width: node.width, height: node.height }).toEqual({
      x: 104,
      y: 72,
      width: 226,
      height: 56,
    })
  })

  it('旋转 90° 的对象缩放：指针位移先逆旋转到对象坐标系，旋转角保持不变', () => {
    const { layer, floats } = transformSetup(90)
    // 旋转后 right-bottom 手柄在层坐标 (174,198)；沿层 y +20 = 对象坐标系 x +20
    floats.beginTransform('right-bottom', 174, 198)
    floats.transformMove(174, 218, false)
    const node = nodeOf(layer)
    expect({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rotation: node.rotation,
    }).toEqual({ x: 94, y: 82, width: 216, height: 56, rotation: 90 })
  })

  it('Shift 拖角等比缩放（keepRatio）：两轴按缩放比大者统一', () => {
    const { layer, floats } = transformSetup()
    floats.beginTransform('right-bottom', 300, 128)
    // 原始比例 196:56；拖 (+60,+10) → 等比取 x 轴比例 256/196，高 56×256/196 ≈ 73
    floats.transformMove(360, 138, true)
    const node = nodeOf(layer)
    expect({ width: node.width, height: node.height }).toEqual({ width: 256, height: 73 })
    expect(node.height / node.width).toBeCloseTo(56 / 196, 1)
  })

  it('拖旋转手柄：角度 = 原角 + atan2 差值（顺时针为正）', () => {
    const { layer, floats } = transformSetup()
    // 手柄在中心正上方（方位角 -90°），拖到正右方（0°）→ 旋转 +90°
    floats.beginTransform('rotate', 202, 52)
    floats.transformMove(242, 100, false)
    expect(nodeOf(layer).rotation).toBe(90)
  })

  it('Shift 旋转吸附 15° 步进；角度归一化 0–360（350° 跨 0 转 5°）', () => {
    const { layer, floats } = transformSetup()
    floats.beginTransform('rotate', 202, 52)
    // 原始角差 +23° → Shift 吸附到 30°
    floats.transformMove(217.6, 63.2, true)
    expect(nodeOf(layer).rotation).toBe(30)

    const { layer: wrapLayer, floats: wrapFloats } = transformSetup(350)
    wrapFloats.beginTransform('rotate', 242, 100)
    // 350° + 15° = 365° → 归一化 5°（指针取正 15° 方位角上的精确点）
    wrapFloats.transformMove(
      202 + 40 * Math.cos(Math.PI / 12),
      100 + 40 * Math.sin(Math.PI / 12),
      false,
    )
    expect(nodeOf(wrapLayer).rotation).toBe(5)
  })

  it('onTransformEnd 载荷：按视觉位置反查锚点 + 新 size/rotation；拖拽过程不提交', () => {
    const { floats } = transformSetup()
    const events: FloatTransformEndEvent[] = []
    floats.onTransformEnd((event) => events.push(event))
    floats.beginTransform('right-bottom', 300, 128)
    floats.transformMove(330, 148, false)
    // 拖拽过程只改渲染态，不提交事件
    expect(events).toHaveLength(0)
    floats.endTransform()
    // 左上角 (104,72) 未动：from/to/偏移保持原锚点，size 为新尺寸
    expect(events).toEqual([
      {
        id: 'a',
        anchor: {
          from: { col: 1, row: 2 },
          to: { col: 2, row: 3 },
          offsetX: 4,
          offsetY: 8,
        },
        size: { width: 226, height: 76 },
        rotation: 0,
      },
    ])
    expect(floats.isTransforming()).toBe(false)
  })

  it('onTransformEnd 反向缩放载荷：from 平移到落点格、to 随 delta 平移；旋转结束只改 rotation', () => {
    const { floats } = transformSetup()
    const events: FloatTransformEndEvent[] = []
    floats.onTransformEnd((event) => events.push(event))
    floats.beginTransform('left-top', 104, 72)
    floats.transformMove(94, 64, false)
    floats.endTransform()
    // 左上角 (94,64) 落在格 (0,2)：格原点 (0,64)，余量 (94,0)；delta (-1,0)
    expect(events).toEqual([
      {
        id: 'a',
        anchor: {
          from: { col: 0, row: 2 },
          to: { col: 1, row: 3 },
          offsetX: 94,
          offsetY: 0,
        },
        size: { width: 206, height: 64 },
        rotation: 0,
      },
    ])

    events.length = 0
    const { floats: rotateFloats } = transformSetup()
    rotateFloats.onTransformEnd((event) => events.push(event))
    rotateFloats.beginTransform('rotate', 202, 52)
    rotateFloats.transformMove(242, 100, false)
    rotateFloats.endTransform()
    // 纯旋转：位置/尺寸不变，anchor 保持，rotation 为新角度
    expect(events).toEqual([
      {
        id: 'a',
        anchor: {
          from: { col: 1, row: 2 },
          to: { col: 2, row: 3 },
          offsetX: 4,
          offsetY: 8,
        },
        size: { width: 196, height: 56 },
        rotation: 90,
      },
    ])
  })

  it('阈值语义：位移 < 3px 不改渲染态，抬起不提交事件', () => {
    const { layer, floats } = transformSetup()
    const events: FloatTransformEndEvent[] = []
    floats.onTransformEnd((event) => events.push(event))
    floats.beginTransform('right-bottom', 300, 128)
    floats.transformMove(301.5, 129, false)
    const node = nodeOf(layer)
    expect({ width: node.width, height: node.height }).toEqual({ width: 196, height: 56 })
    floats.endTransform()
    expect(events).toHaveLength(0)
    expect(floats.isTransforming()).toBe(false)
  })

  it('只读（isReadonly 口径）：手柄可见可命中，但变换不启用', () => {
    const { floats } = transformSetup()
    expect(floats.handleAt(300, 128)).toBe('right-bottom')
    floats.isReadonly = true
    expect(floats.beginTransform('right-bottom', 300, 128)).toBe(false)
    expect(floats.isTransforming()).toBe(false)
  })
})
