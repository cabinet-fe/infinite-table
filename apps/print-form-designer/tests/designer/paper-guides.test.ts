// P4 纸张边界与分页参考线：几何/绘制纯函数、挂载画布的 painter 端到端、以及两条
// spec 验收口径——参考线与纸张显示参数不落模板（保存 JSON 键集断言）、overlay 不
// 参与数据态渲染（打印产物逐字相等 + 画布模型快照不变）。
// bun test 不支持环境注释，happy-dom DOM 面挂法与 form-canvas.test.ts 同款。
import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'

import { createEnginePrintSource, createPrintPlugin, type PrintSource } from '@infinitable/plugins'

import { FormDoc } from '../../src/designer/form-doc'
import { mountFormCanvas } from '../../src/designer/form-canvas'
import {
  DEFAULT_PAPER_GUIDES,
  computePageGuides,
  createPaperGuidesPainter,
  drawPageGuides,
  paperAreaPx,
  type GuideContext,
  type PaperGuidesConfig,
} from '../../src/designer/paper-guides'

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

/** getContext('2d') 最小 mock（painter 不经真实 canvas，仅备引擎构造路径） */
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

// ─── 纯函数：纸张内容区与分页估算 ─────────────────────────────────────────────

/** 均匀行列的字面打印源（分页估算只消费行列几何） */
function uniformSource(
  rows: number,
  cols: number,
  rowHeight: number,
  colWidth: number,
): PrintSource {
  return {
    name: '演练',
    rowCount: rows,
    colCount: cols,
    rowHeight: () => rowHeight,
    colWidth: () => colWidth,
    merges: () => [],
    cellValue: () => undefined,
    cellStyle: () => undefined,
    displayValue: () => undefined,
  }
}

describe('paperAreaPx：纸张内容区尺寸（mm→px、扣边距、方向交换）', () => {
  test('A4 纵向 = 纸幅 96dpi 换算 − 四边 48px 边距', () => {
    const area = paperAreaPx(DEFAULT_PAPER_GUIDES)
    expect(area.width).toBeCloseTo((210 * 96) / 25.4 - 96, 6)
    expect(area.height).toBeCloseTo((297 * 96) / 25.4 - 96, 6)
  })

  test('landscape 交换宽高；预设尺寸表覆盖 A3/A5/Letter', () => {
    const landscape = paperAreaPx({ ...DEFAULT_PAPER_GUIDES, orientation: 'landscape' })
    expect(landscape.width).toBeCloseTo((297 * 96) / 25.4 - 96, 6)
    expect(landscape.height).toBeCloseTo((210 * 96) / 25.4 - 96, 6)
    const a3 = paperAreaPx({ ...DEFAULT_PAPER_GUIDES, paperSize: 'A3' })
    expect(a3.width).toBeCloseTo((297 * 96) / 25.4 - 96, 6)
    const a5 = paperAreaPx({ ...DEFAULT_PAPER_GUIDES, paperSize: 'A5' })
    expect(a5.height).toBeCloseTo((210 * 96) / 25.4 - 96, 6)
    const letter = paperAreaPx({ ...DEFAULT_PAPER_GUIDES, paperSize: 'Letter' })
    expect(letter.width).toBeCloseTo((215.9 * 96) / 25.4 - 96, 6)
  })
})

describe('computePageGuides：分页估算复用 print paginate', () => {
  test('超高超宽内容切行带/列带，边界偏移 = 行高/列宽累加', () => {
    // A4 纵向内容区高 1026.52px：60px 行放 17 行（1020）后换页；宽 697.70px：120px 列放 5 列（600）后换列带
    const geometry = computePageGuides(uniformSource(20, 8, 60, 120), DEFAULT_PAPER_GUIDES)
    expect(geometry.rowBreaks).toEqual([1020])
    expect(geometry.colBreaks).toEqual([600])
    expect(geometry.paper).toEqual(paperAreaPx(DEFAULT_PAPER_GUIDES))
  })

  test('单页内容无参考线（行带/列带各一）', () => {
    const geometry = computePageGuides(uniformSource(3, 2, 40, 80), DEFAULT_PAPER_GUIDES)
    expect(geometry.rowBreaks).toEqual([])
    expect(geometry.colBreaks).toEqual([])
  })

  test('与 paginate 内核同口径：内容区高度 ±1px 决定单页/换页（锁定本地纸张换算不漂移）', () => {
    const area = paperAreaPx(DEFAULT_PAPER_GUIDES)
    // 总高 = 内容区高 − 1 → 恰好单页（avail ≥ 总高）
    const fits = computePageGuides(
      uniformSource(3, 1, (area.height - 1) / 3, 80),
      DEFAULT_PAPER_GUIDES,
    )
    expect(fits.rowBreaks).toEqual([])
    // 总高 = 内容区高 + 1 → 换页（avail < 总高）
    const overflows = computePageGuides(
      uniformSource(3, 1, (area.height + 1) / 3, 80),
      DEFAULT_PAPER_GUIDES,
    )
    expect(overflows.rowBreaks.length).toBe(1)
  })
})

// ─── 绘制：录制上下文断言线条几何 ────────────────────────────────────────────

interface RecordedOp {
  op: 'rect' | 'moveTo' | 'lineTo' | 'stroke' | 'save' | 'restore'
  args: number[]
}

/** 录制型绘制上下文（drawPageGuides 的窄接口子集） */
function recordContext(): { ctx: GuideContext; ops: RecordedOp[] } {
  const ops: RecordedOp[] = []
  const ctx: GuideContext = {
    strokeStyle: '',
    lineWidth: 0,
    save: () => ops.push({ op: 'save', args: [] }),
    restore: () => ops.push({ op: 'restore', args: [] }),
    beginPath: () => {},
    rect: (x, y, width, height) => ops.push({ op: 'rect', args: [x, y, width, height] }),
    moveTo: (x, y) => ops.push({ op: 'moveTo', args: [x, y] }),
    lineTo: (x, y) => ops.push({ op: 'lineTo', args: [x, y] }),
    stroke: () => ops.push({ op: 'stroke', args: [] }),
  }
  return { ctx, ops }
}

describe('drawPageGuides：纸张边界矩形 + 分页虚线', () => {
  test('纸张内容区锚定画布内容原点；换页/换列线横贯/纵贯视口', () => {
    const { ctx, ops } = recordContext()
    drawPageGuides(
      ctx,
      { width: 900, height: 420 },
      { paper: { width: 697.7, height: 1026.5 }, rowBreaks: [960], colBreaks: [600] },
      { x: 46, y: 28 },
    )
    // 纸张边界（实线矩形）：一次 rect，锚点 = 行号列/列头偏移后的内容原点
    expect(ops.filter((item) => item.op === 'rect')).toEqual([
      { op: 'rect', args: [46, 28, 697.7, 1026.5] },
    ])
    // 换页虚线段：y = 28 + 960 = 988，起点 x=0 向右推进
    const dashYs = ops
      .filter((item) => item.op === 'moveTo' && item.args[1] === 988)
      .map((item) => item.args[0])
    expect(dashYs.length).toBeGreaterThan(0)
    expect(dashYs[0]).toBe(0)
    // 换列虚线段：x = 46 + 600 = 646，起点 y=0 向下推进
    const dashXs = ops
      .filter((item) => item.op === 'moveTo' && item.args[0] === 646)
      .map((item) => item.args[1])
    expect(dashXs.length).toBeGreaterThan(0)
    expect(dashXs[0]).toBe(0)
    // 两类线条分两次 stroke（纸张边界 + 参考线）
    expect(ops.filter((item) => item.op === 'stroke')).toHaveLength(2)
  })

  test('无分页时只画纸张边界（无虚线段）', () => {
    const { ctx, ops } = recordContext()
    drawPageGuides(
      ctx,
      { width: 900, height: 420 },
      { paper: { width: 697.7, height: 1026.5 }, rowBreaks: [], colBreaks: [] },
      { x: 46, y: 28 },
    )
    expect(ops.filter((item) => item.op === 'rect')).toHaveLength(1)
    expect(ops.filter((item) => item.op === 'moveTo')).toEqual([])
  })
})

// ─── 端到端：挂载画布 + 真引擎读取面 + 模板/数据态隔离 ───────────────────────

/** 挂载带参考线的画布（10 行 × 120px 高：10 行 × 120 = 1200 > A4 内容区高 1026.52 → 换页） */
function mountWithGuides(): {
  doc: FormDoc
  canvas: ReturnType<typeof mountFormCanvas>
  config: PaperGuidesConfig
} {
  const doc = FormDoc.create()
  doc.resizeRegionRows(0, 10) // 默认只有 3 行；撑到 10 行以触发 A4 换页
  for (let row = 0; row < doc.rows; row++) doc.setRowHeight(row, 120)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const canvas = mountFormCanvas({
    container,
    doc,
    width: 900,
    height: 420,
    paperGuides: DEFAULT_PAPER_GUIDES,
  })
  return { doc, canvas, config: DEFAULT_PAPER_GUIDES }
}

describe('画布 overlay painter（协议槽位显示层）', () => {
  test('经引擎读取面估算：换页线落在 8×120=960px（第 9 行放不下），原点含行号列/列头偏移', () => {
    const { canvas, config } = mountWithGuides()
    try {
      const { ctx, ops } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => config,
      )(ctx, { width: 900, height: 420 })
      const area = paperAreaPx(config)
      const rect = ops.find((item) => item.op === 'rect')
      expect(rect).toBeDefined()
      expect(rect!.args[0]).toBeGreaterThan(0) // 行号列偏移
      expect(rect!.args[1]).toBeGreaterThan(0) // 列头偏移
      expect(rect!.args[2]).toBeCloseTo(area.width, 6)
      expect(rect!.args[3]).toBeCloseTo(area.height, 6)
      // 换页虚线：origin.y + 960（行高全 120：17 行内放 8 行——960 ≤ 1026.52 < 1080）
      const breakY = rect!.args[1]! + 960
      expect(
        ops.some((item) => item.op === 'moveTo' && Math.abs(item.args[1]! - breakY) < 0.001),
      ).toBe(true)
    } finally {
      canvas.release()
    }
  })

  test('关闭参考线后 painter 不绘制任何内容', () => {
    const { canvas } = mountWithGuides()
    try {
      canvas.setPaperGuides(null)
      const { ctx, ops } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => null,
      )(ctx, { width: 900, height: 420 })
      expect(ops).toEqual([])
    } finally {
      canvas.release()
    }
  })
})

describe('参考线不落模板 / 不参与数据态渲染', () => {
  test('挂载并绘制参考线后：保存 JSON 键集恰为模板五键，深层无参考线/纸张/分页键', () => {
    const { doc, canvas, config } = mountWithGuides()
    try {
      const { ctx } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => config,
      )(ctx, { width: 900, height: 420 })
      canvas.setPaperGuides({ ...config, paperSize: 'A3', orientation: 'landscape' })
      canvas.setPaperGuides(null)
      canvas.setPaperGuides(config)

      const template = doc.toTemplate('演练')
      expect(Object.keys(template).sort()).toEqual([
        'cols',
        'name',
        'regions',
        'schemaVersion',
        'sheet',
      ])
      // 深层键扫描：任何层级都不出现参考线/纸张/分页类键名
      const forbidden =
        /^(paper|paperSize|paperGuides|orientation|margin|paging|scale|guides?|rowBreaks|colBreaks|pageBreaks?)$/i
      const walkKeys = (value: unknown): void => {
        if (Array.isArray(value)) {
          for (const item of value) walkKeys(item)
          return
        }
        if (value && typeof value === 'object') {
          for (const [key, child] of Object.entries(value)) {
            expect(forbidden.test(key)).toBe(false)
            walkKeys(child)
          }
        }
      }
      walkKeys(template)
    } finally {
      canvas.release()
    }
  })

  test('overlay 开/关与 painter 调用：画布模型快照不变，打印文档逐字相等且无画布元素', () => {
    const { doc, canvas, config } = mountWithGuides()
    try {
      const sheetBefore = JSON.stringify(doc.sheet.snapshot())
      const source = createEnginePrintSource(canvas.getGrid()!.getTable())
      const htmlOn = createPrintPlugin({ source }).buildDocumentHtml()

      const { ctx } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => config,
      )(ctx, { width: 900, height: 420 })
      canvas.setPaperGuides(null)
      const htmlOff = createPrintPlugin({ source }).buildDocumentHtml()

      expect(htmlOff).toBe(htmlOn)
      expect(htmlOn).not.toContain('<canvas')
      expect(JSON.stringify(doc.sheet.snapshot())).toBe(sheetBefore)
    } finally {
      canvas.release()
    }
  })
})
