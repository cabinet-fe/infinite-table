// B1/B2 画布级回归：快照级静默 restore（行高列宽撤销、波段平移改写合并）后
// 引擎几何/合并随模型还原的断言。bun test 不支持 vitest 的环境注释，手工把
// happy-dom 的 DOM 面挂到全局（只增不覆盖，纯模型层用例不受影响）；canvas 2d
// 上下文 happy-dom 不实现，按 sheet 包 tests/grid/canvas-mock.ts 的最小口径 mock。
import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'

import type { SheetGrid } from '@infinitable/sheet'
import { FormDoc } from '../../src/designer/form-doc'
import { mountFormCanvas } from '../../src/designer/form-canvas'

const win = new Window()
Object.assign(globalThis, {
  window: win,
  document: win.document,
  HTMLElement: win.HTMLElement,
  HTMLCanvasElement: win.HTMLCanvasElement,
  HTMLInputElement: win.HTMLInputElement,
  HTMLTextAreaElement: win.HTMLTextAreaElement,
  Node: win.Node,
  Event: win.Event,
  MouseEvent: win.MouseEvent,
  KeyboardEvent: win.KeyboardEvent,
  WheelEvent: win.WheelEvent,
  CustomEvent: win.CustomEvent,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  devicePixelRatio: 1,
})

/** getContext('2d') 最小 mock：measureText 按字符宽估，其余绘制方法无操作 */
function setupCanvasContextMock(): void {
  const store: Record<string | symbol, unknown> = {}
  const context = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (prop === 'measureText') return (text: unknown) => ({ width: String(text).length * 8 })
      return () => {}
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  })
  const proto = win.HTMLCanvasElement.prototype
  proto.getContext = ((contextId: string) =>
    contextId === '2d' ? context : null) as typeof proto.getContext
}
setupCanvasContextMock()

const RANGE = (r1: number, c1: number, r2: number, c2: number) => ({
  start: { row: r1, col: c1 },
  end: { row: r2, col: c2 },
})

/** 引擎读取面：协议面 + 合并区读取（getMergeRanges 未收敛进 TableEngine 协议面，按实现窄化） */
type EngineView = ReturnType<SheetGrid['getTable']> & {
  getMergeRanges(): readonly { startRow: number }[]
}

/**
 * 挂载设计画布（固定视口绕开 happy-dom 无布局测量）。engine 现取现用：
 * 修复路径里键清除/合并变化会重建网格换引擎实例，持旧引用断言会读到弃用态。
 */
function mountCanvas(doc: FormDoc): {
  canvas: ReturnType<typeof mountFormCanvas>
  engine: () => EngineView
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const canvas = mountFormCanvas({ container, doc, width: 600, height: 400 })
  return {
    canvas,
    engine: () => canvas.getGrid()!.getTable() as EngineView,
  }
}

describe('画布视图同步（快照级静默 restore 后几何/合并还原）', () => {
  test('B1：行高/列宽撤销与清除后引擎几何回落默认', () => {
    const doc = FormDoc.create()
    const { canvas, engine } = mountCanvas(doc)
    try {
      const defaultHeight = engine().getRowHeight(1)
      const defaultWidth = engine().getColWidth(1)

      doc.setRowHeight(0, 48)
      expect(engine().getRowHeight(0)).toBe(48)
      expect(doc.history.undo()).toBe(true)
      expect(engine().getRowHeight(0)).toBe(defaultHeight)
      expect(doc.history.redo()).toBe(true)
      expect(engine().getRowHeight(0)).toBe(48)

      doc.setColWidth(0, 160)
      expect(engine().getColWidth(0)).toBe(160)
      expect(doc.history.undo()).toBe(true)
      expect(engine().getColWidth(0)).toBe(defaultWidth)

      // 清除自定义高度（面板输入 0）与撤销同走键清除路径
      doc.setRowHeight(0, 48)
      doc.setRowHeight(0, 0)
      expect(engine().getRowHeight(0)).toBe(defaultHeight)
    } finally {
      canvas.release()
    }
  })

  test('B2：波段移动/撤销/重做后合并区随行块还原', () => {
    const doc = FormDoc.create()
    doc.sheet.mergeCells(RANGE(0, 0, 0, 3)) // 页眉波段首行合并 4 格
    const { canvas, engine } = mountCanvas(doc)
    try {
      const mergeStartRow = () => engine().getMergeRanges()[0]?.startRow
      expect(mergeStartRow()).toBe(0)

      // info（行 2-3）与 pageHeader（行 0-1）交换，合并区随行块移至行 2
      doc.moveBand(1, -1)
      expect(mergeStartRow()).toBe(2)

      expect(doc.history.undo()).toBe(true)
      expect(mergeStartRow()).toBe(0)
      expect(doc.history.redo()).toBe(true)
      expect(mergeStartRow()).toBe(2)
    } finally {
      canvas.release()
    }
  })

  test('非重建路径保留：类型切换与行高正向编辑就地同步（实例不更替）', () => {
    const doc = FormDoc.create()
    const { canvas, engine } = mountCanvas(doc)
    try {
      const grid = canvas.getGrid()
      doc.setBandKind(1, 'detail')
      expect(canvas.getGrid()).toBe(grid)
      doc.setRowHeight(0, 48)
      expect(canvas.getGrid()).toBe(grid)
      expect(engine().getRowHeight(0)).toBe(48)
      doc.setRowHeight(0, 60)
      expect(canvas.getGrid()).toBe(grid)
      expect(engine().getRowHeight(0)).toBe(60)
    } finally {
      canvas.release()
    }
  })
})
