import { describe, expect, it } from 'vitest'

import { hitTest } from '../../src/scene/hit-test'
import { paintTree } from '../../src/scene/paint'
import { SceneNode } from '../../src/scene/scene-node'
import { FakeContext } from '../testing/fake-canvas'
import type { RenderContext } from '../../src/types'

class RectNode extends SceneNode {
  constructor(
    private readonly label: string,
    init: ConstructorParameters<typeof SceneNode>[0],
    private readonly sink?: string[],
  ) {
    super(init)
  }

  override paint(_ctx: RenderContext): void {
    this.sink?.push(this.label)
  }
}

describe('场景树节点模型', () => {
  it('appendChild/removeChild 维护父子链，重复挂载自动换父', () => {
    const a = new SceneNode()
    const b = new SceneNode()
    const c = new SceneNode()
    a.appendChild(c)
    b.appendChild(c)
    expect(a.children).toHaveLength(0)
    expect(c.parent).toBe(b)
    b.removeChild(c)
    expect(c.parent).toBeNull()
    b.appendChild(c)
    c.removeFromParent()
    expect(b.children).toHaveLength(0)
  })

  it('getGlobalBounds 累加父链坐标', () => {
    const root = new SceneNode({ x: 10, y: 20, width: 800, height: 600 })
    const group = new SceneNode({ x: 5, y: 5, width: 100, height: 100 })
    const leaf = new SceneNode({ x: 1, y: 2, width: 30, height: 40 })
    root.appendChild(group)
    group.appendChild(leaf)
    expect(leaf.getGlobalBounds()).toEqual({ x: 16, y: 27, width: 30, height: 40 })
  })
})

describe('命中测试', () => {
  it('返回最深层、绘制顺序最靠上的命中节点', () => {
    const root = new SceneNode({ width: 100, height: 100 })
    const bottom = new SceneNode({ width: 50, height: 50 })
    const top = new SceneNode({ width: 50, height: 50 })
    root.appendChild(bottom)
    root.appendChild(top)
    expect(hitTest(root, 10, 10)).toBe(top)
    top.removeFromParent()
    expect(hitTest(root, 10, 10)).toBe(bottom)
  })

  it('pickable=false 穿透本节点，子节点仍可命中；不可见节点整体跳过', () => {
    const root = new SceneNode({ width: 100, height: 100, pickable: false })
    const child = new SceneNode({ width: 50, height: 50 })
    root.appendChild(child)
    expect(hitTest(root, 10, 10)).toBe(child)
    expect(hitTest(root, 60, 60)).toBeNull()
    child.visible = false
    expect(hitTest(root, 10, 10)).toBeNull()
  })

  it('父坐标系外的点不命中', () => {
    const root = new SceneNode({ width: 100, height: 100 })
    expect(hitTest(root, -1, 10)).toBeNull()
    expect(hitTest(root, 10, 100)).toBeNull()
  })
})

describe('绘制遍历', () => {
  it('先自身后子节点，按 children 顺序绘制，并平移到局部原点', () => {
    const order: string[] = []
    const root = new RectNode('root', { x: 10, y: 20, width: 100, height: 100 }, order)
    root.appendChild(new RectNode('a', { x: 1, y: 1, width: 10, height: 10 }, order))
    root.appendChild(new RectNode('b', { x: 2, y: 2, width: 10, height: 10 }, order))
    const ctx = new FakeContext()
    paintTree(root, ctx)
    expect(order).toEqual(['root', 'a', 'b'])
    expect(ctx.callsOf('translate').map((c) => c.args)).toEqual([
      [10, 20],
      [1, 1],
      [2, 2],
    ])
  })

  it('visible=false 跳过整棵子树', () => {
    const order: string[] = []
    const root = new RectNode('root', { width: 100, height: 100 }, order)
    const hidden = new RectNode('hidden', { width: 10, height: 10 }, order)
    hidden.visible = false
    hidden.appendChild(new RectNode('child', { width: 5, height: 5 }, order))
    root.appendChild(hidden)
    paintTree(root, new FakeContext())
    expect(order).toEqual(['root'])
  })

  it('cull 脏区不相交的子树被裁剪跳过', () => {
    const order: string[] = []
    const root = new RectNode('root', { width: 800, height: 600 }, order)
    root.appendChild(new RectNode('near', { x: 0, y: 0, width: 100, height: 100 }, order))
    root.appendChild(new RectNode('far', { x: 500, y: 500, width: 100, height: 100 }, order))
    paintTree(root, new FakeContext(), { x: 0, y: 0, width: 50, height: 50 })
    expect(order).toEqual(['root', 'near'])
  })
})
