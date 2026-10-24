// 文档源注入（ListTableOptions.doc）：node 环境默认无全局 document，经 doc 替身
// 断言可构造 ListTable 并走出图路径（层 canvas 与测量画布创建、绘制调用落画布）；
// hostOptions.createCanvas 显式注入仍优先于 doc。

import { describe, expect, it } from 'vitest'

import type { RenderCanvas, RenderContext } from '@infinitable/render'

import { ListTable } from '../src/list-table'
import type { CanvasDocSource } from '../src/types'
import { RecordingContext } from './testing/recording-context'

/** 文档源创建的假画布：尺寸可写、2D 上下文为记录型（node 环境无 DOM） */
class DocCanvas implements RenderCanvas {
  width = 0
  height = 0
  readonly context = new RecordingContext()

  getContext(_contextId: '2d'): RenderContext {
    return this.context
  }
}

function createFakeDoc() {
  const canvases: DocCanvas[] = []
  const doc: CanvasDocSource = {
    createElement: () => {
      const canvas = new DocCanvas()
      canvases.push(canvas)
      return canvas
    },
  }
  return { doc, canvases }
}

/** 同步帧调度：构造期失效立即收敛出图（无 rAF 依赖） */
const syncFrame = {
  scheduleFrame: (cb: () => void) => {
    cb()
    return 1
  },
  cancelFrame: () => {},
}

describe('ListTable 文档源注入（无 DOM 环境）', () => {
  it('doc 注入：node 环境可构造并走出图路径，canvas 全部经文档源创建', () => {
    expect(typeof document).toBe('undefined')
    const { doc, canvases } = createFakeDoc()
    const table = new ListTable({
      width: 300,
      height: 200,
      columns: [
        { field: 'name', title: 'Name' },
        { field: 'score', title: 'Score' },
      ],
      records: [
        { name: 'alice', score: 1 },
        { name: 'bob', score: 2 },
      ],
      doc,
      hostOptions: syncFrame,
    })
    try {
      // body/sky 层画布 + 测量画布都经文档源创建，不触碰全局 document
      expect(canvases.length).toBeGreaterThan(2)
      // 出图：绘制调用落到文档源画布的上下文（表头与数据格文本）
      const texts = canvases.flatMap((canvas) =>
        canvas.context.callsOf('fillText').map((call) => call.args[0]),
      )
      expect(texts).toContain('Name')
      expect(texts).toContain('alice')
    } finally {
      table.destroy()
    }
  })

  it('hostOptions.createCanvas 显式注入优先于 doc', () => {
    const { doc, canvases } = createFakeDoc()
    const own: DocCanvas[] = []
    const table = new ListTable({
      width: 300,
      height: 200,
      columns: [{ field: 'name' }],
      records: [{ name: 'a' }],
      doc,
      hostOptions: {
        ...syncFrame,
        createCanvas: () => {
          const canvas = new DocCanvas()
          own.push(canvas)
          return canvas
        },
      },
    })
    try {
      expect(canvases).toHaveLength(0)
      expect(own.length).toBeGreaterThan(0)
    } finally {
      table.destroy()
    }
  })
})
