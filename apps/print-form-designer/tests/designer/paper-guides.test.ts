// @vitest-environment happy-dom
// P4 纸张边界与分页参考线：几何/绘制纯函数、挂载画布的 painter 端到端、以及两条
// spec 验收口径——参考线与纸张显示参数不落模板（保存 JSON 键集断言）、overlay 不
// 参与数据态渲染（打印产物逐字相等 + 画布模型快照不变）。
// DOM 面由环境注释挂载，canvas 2d 桩由 testing/canvas-mock 补。
import { describe, expect, test } from 'vitest'
import { createEnginePrintSource, createPrintPlugin, type PrintSource } from '@infinitable/plugins'

import { FormDoc } from '../../src/domain/form-doc'
import { mountFormCanvas } from '../../src/designer/form-canvas'
import {
  DEFAULT_PAPER_GUIDES,
  computePageGuides,
  createPaperGuidesPainter,
  drawPageGuides,
  paperAreaPx,
  resolveContentOrigin,
  type GuideContext,
  type GuideOriginTable,
  type PaperGuidesConfig,
} from '../../src/designer/paper-guides'
import { setupCanvasMock } from './testing/canvas-mock'

setupCanvasMock()

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
    const geometry = computePageGuides(uniformSource(20, 8, 60, 120), DEFAULT_PAPER_GUIDES, {
      rowCount: 20,
      colCount: 8,
    })
    expect(geometry.rowBreaks).toEqual([1020])
    expect(geometry.colBreaks).toEqual([600])
    expect(geometry.paper).toEqual(paperAreaPx(DEFAULT_PAPER_GUIDES))
  })

  test('单页内容无参考线（行带/列带各一）', () => {
    const geometry = computePageGuides(uniformSource(3, 2, 40, 80), DEFAULT_PAPER_GUIDES, {
      rowCount: 3,
      colCount: 2,
    })
    expect(geometry.rowBreaks).toEqual([])
    expect(geometry.colBreaks).toEqual([])
  })

  test('与 paginate 内核同口径：内容区高度 ±1px 决定单页/换页（paperAreaPx 已委托 derivePrintableArea，同一推导零换算）', () => {
    const area = paperAreaPx(DEFAULT_PAPER_GUIDES)
    // 总高 = 内容区高 − 1 → 恰好单页（avail ≥ 总高）
    const fits = computePageGuides(
      uniformSource(3, 1, (area.height - 1) / 3, 80),
      DEFAULT_PAPER_GUIDES,
      { rowCount: 3, colCount: 1 },
    )
    expect(fits.rowBreaks).toEqual([])
    // 总高 = 内容区高 + 1 → 换页（avail < 总高）
    const overflows = computePageGuides(
      uniformSource(3, 1, (area.height + 1) / 3, 80),
      DEFAULT_PAPER_GUIDES,
      { rowCount: 3, colCount: 1 },
    )
    expect(overflows.rowBreaks.length).toBe(1)
  })

  test('domain 限定分页域：无限画布的扩容空行不进换页估算', () => {
    // 引擎口径 300 行 × 100 列（无限画布扩容结果）；真实内容只有 5 行 3 列
    const padded = uniformSource(300, 100, 60, 120)
    const unbounded = computePageGuides(padded, DEFAULT_PAPER_GUIDES, {
      rowCount: 300,
      colCount: 100,
    })
    // 不限定域：300 行 × 60px 会切出多页、100 列 × 120px 切出多条列带
    expect(unbounded.rowBreaks.length).toBeGreaterThan(5)
    expect(unbounded.colBreaks.length).toBeGreaterThan(10)

    const bounded = computePageGuides(padded, DEFAULT_PAPER_GUIDES, { rowCount: 5, colCount: 3 })
    // 5 行 × 60 = 300 ≤ 1026.52、3 列 × 120 = 360 ≤ 697.70 → 单页，无参考线
    expect(bounded.rowBreaks).toEqual([])
    expect(bounded.colBreaks).toEqual([])
    expect(bounded.paper).toEqual(paperAreaPx(DEFAULT_PAPER_GUIDES))
  })

  test('domain 只裁分页域，不改变边界偏移口径（行高/列宽累加）', () => {
    // 同一 60px 行源、20 行 × 8 列域：偏移口径与不受域限制时一致（1020 / 600）
    const source = uniformSource(20, 8, 60, 120)
    const bounded = computePageGuides(source, DEFAULT_PAPER_GUIDES, { rowCount: 20, colCount: 8 })
    expect(bounded.rowBreaks).toEqual([1020])
    expect(bounded.colBreaks).toEqual([600])
    // 域小于换页阈值 → 无参考线；域 = 0 → 空页列表（无参考线）
    expect(
      computePageGuides(source, DEFAULT_PAPER_GUIDES, { rowCount: 10, colCount: 4 }).rowBreaks,
    ).toEqual([])
    const empty = computePageGuides(source, DEFAULT_PAPER_GUIDES, { rowCount: 0, colCount: 0 })
    expect(empty.rowBreaks).toEqual([])
    expect(empty.colBreaks).toEqual([])
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

// ─── 内容原点反推：A1 滚出虚拟窗口后参考线不消失 ─────────────────────────────

/**
 * 窗口化字面表桩：均匀行列，窗口内格返回视口矩形（内容偏移 − 滚动 + 行列头偏移，
 * 与引擎 cellRectInViewport 同口径）、窗口外返回 null。
 */
function windowedTable(setup: {
  rowHeight: number
  colWidth: number
  rows: { start: number; end: number }
  cols: { start: number; end: number }
  headerHeight: number
  rowHeaderWidth: number
  scrollTop: number
  scrollLeft: number
}): GuideOriginTable {
  return {
    getCellRelativeRect: (col, row) => {
      const inWindow =
        row >= setup.rows.start &&
        row < setup.rows.end &&
        col >= setup.cols.start &&
        col < setup.cols.end
      if (!inWindow) return null
      return {
        x: col * setup.colWidth - setup.scrollLeft + setup.rowHeaderWidth,
        y: row * setup.rowHeight - setup.scrollTop + setup.headerHeight,
      }
    },
    getBodyVisibleCellRange: () => ({ rows: setup.rows, cols: setup.cols }),
    getRowHeight: () => setup.rowHeight,
    getColWidth: () => setup.colWidth,
  }
}

describe('resolveContentOrigin：A1 在视口内/上方滚出/左侧滚出', () => {
  const GEOMETRY = { rowHeight: 120, colWidth: 80, headerHeight: 28, rowHeaderWidth: 46 }

  test('A1 在视口内：直接取 (0,0) 格矩形（含行列头偏移）', () => {
    const origin = resolveContentOrigin(
      windowedTable({
        ...GEOMETRY,
        rows: { start: 0, end: 4 },
        cols: { start: 0, end: 6 },
        scrollTop: 0,
        scrollLeft: 0,
      }),
    )
    expect(origin).toEqual({ x: 46, y: 28 })
  })

  test('A1 向上滚出窗口：origin.y = 窗口首行矩形 y − 已滚出行高累计（负值，参考线仍可画）', () => {
    // 窗口首行 row 4（4×120=480 已滚出）；首行 y = 4×120 − 480 + 28 = 28，反推 28 − 480
    const origin = resolveContentOrigin(
      windowedTable({
        ...GEOMETRY,
        rows: { start: 4, end: 8 },
        cols: { start: 0, end: 6 },
        scrollTop: 480,
        scrollLeft: 0,
      }),
    )
    expect(origin).toEqual({ x: 46, y: 28 - 480 })
    expect(origin!.y).toBeLessThan(0)
  })

  test('A1 向左滚出窗口：origin.x = 窗口首列矩形 x − 已滚出列宽累计（负值）', () => {
    // 窗口首列 col 3（3×80=240 已滚出）；首列 x = 3×80 − 240 + 46 = 46，反推 46 − 240
    const origin = resolveContentOrigin(
      windowedTable({
        ...GEOMETRY,
        rows: { start: 0, end: 4 },
        cols: { start: 3, end: 7 },
        scrollTop: 0,
        scrollLeft: 240,
      }),
    )
    expect(origin).toEqual({ x: 46 - 240, y: 28 })
    expect(origin!.x).toBeLessThan(0)
  })

  test('两轴同时滚出仍可反推；可视窗口为空（空画布）返回 null', () => {
    const both = resolveContentOrigin(
      windowedTable({
        ...GEOMETRY,
        rows: { start: 2, end: 6 },
        cols: { start: 3, end: 7 },
        scrollTop: 240,
        scrollLeft: 240,
      }),
    )
    expect(both).toEqual({ x: 46 - 240, y: 28 - 240 })
    const empty = resolveContentOrigin(
      windowedTable({
        ...GEOMETRY,
        rows: { start: 0, end: 0 },
        cols: { start: 0, end: 0 },
        scrollTop: 0,
        scrollLeft: 0,
      }),
    )
    expect(empty).toBeNull()
  })
})

// ─── 端到端：挂载画布 + 真引擎读取面 + 模板/数据态隔离 ───────────────────────

/** 挂载带参考线的画布（10 行 × 120px 高：10 行 × 120 = 1200 > A4 内容区高 1026.52 → 换页） */
function mountWithGuides(): {
  doc: FormDoc
  canvas: ReturnType<typeof mountFormCanvas>
  config: PaperGuidesConfig
} {
  const doc = FormDoc.create(8)
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
    const { doc, canvas, config } = mountWithGuides()
    try {
      const { ctx, ops } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => config,
        () => doc.bounds,
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

  test('注入内容包围盒后只在包围盒内估算：内容不足一页则无换页线', () => {
    const { canvas, config } = mountWithGuides()
    try {
      const { ctx, ops } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => config,
        // 真实内容只有 3 行（画布撑了 10 行）→ 远不足一页
        () => ({ rows: 3, cols: 4 }),
      )(ctx, { width: 900, height: 420 })
      // 纸张边界照画，但没有换页虚线
      expect(ops.filter((item) => item.op === 'rect')).toHaveLength(1)
      expect(ops.filter((item) => item.op === 'moveTo')).toEqual([])
    } finally {
      canvas.release()
    }
  })

  test('内容包围盒为空 → 完全不绘制（没有内容就没有换页）', () => {
    const { canvas, config } = mountWithGuides()
    try {
      const { ctx, ops } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => config,
        () => ({ rows: 0, cols: 0 }),
      )(ctx, { width: 900, height: 420 })
      expect(ops).toEqual([])
    } finally {
      canvas.release()
    }
  })

  test('关闭参考线后 painter 不绘制任何内容', () => {
    const { doc, canvas } = mountWithGuides()
    try {
      canvas.setPaperGuides(null)
      const { ctx, ops } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => null,
        () => doc.bounds,
      )(ctx, { width: 900, height: 420 })
      expect(ops).toEqual([])
    } finally {
      canvas.release()
    }
  })
})

describe('滚动后参考线恒显示（A1 滚出虚拟窗口不整组消失）', () => {
  test('向下滚动 A1 出窗：纸张边界/换页线照画，原点随滚动上移为负、换页线恒画', () => {
    const { doc, canvas, config } = mountWithGuides()
    try {
      const table = canvas.getGrid()!.getTable()
      const { ctx: beforeCtx, ops: beforeOps } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => config,
        () => doc.bounds,
      )(beforeCtx, { width: 900, height: 420 })
      const before = beforeOps.find((item) => item.op === 'rect')!
      expect(before).toBeDefined()

      // 滚动同步生效（ScrollManager 广播 → 窗口重建同帧完成，无需真实浏览器）。
      // 滚过 overscan 缓冲（SheetGrid 上方预留 10 行）A1 才真正出窗：1300 > 10×120
      table.scrollBy(0, 1300)
      // 前置锁定 bug 触发条件：A1 确已滚出虚拟窗口（getCellRelativeRect 返回 null）
      expect(table.getCellRelativeRect(0, 0)).toBeNull()

      const { ctx, ops } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => config,
        () => doc.bounds,
      )(ctx, { width: 900, height: 420 })
      const rect = ops.find((item) => item.op === 'rect')
      // 修复前：painter 在 origin 处早退，rect/虚线整组消失
      expect(rect).toBeDefined()
      expect(rect!.args[1]).toBeCloseTo(before.args[1]! - table.getScrollTop(), 6)
      expect(rect!.args[1]).toBeLessThan(0)
      // 换页虚线仍画：y = origin.y + 960（10 行 × 120 的第一页边界；出视口部分由画布裁剪）
      const breakY = rect!.args[1]! + 960
      expect(
        ops.some((item) => item.op === 'moveTo' && Math.abs(item.args[1]! - breakY) < 0.001),
      ).toBe(true)
    } finally {
      canvas.release()
    }
  })

  test('向右滚动 A1 出窗（无限画布扩容列供滚动余量）：原点左移为负，参考线照画', () => {
    const { doc, canvas, config } = mountWithGuides()
    try {
      const table = canvas.getGrid()!.getTable()
      const { ctx: beforeCtx, ops: beforeOps } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => config,
        () => doc.bounds,
      )(beforeCtx, { width: 900, height: 420 })
      const before = beforeOps.find((item) => item.op === 'rect')!

      table.scrollBy(400, 0)
      expect(table.getCellRelativeRect(0, 0)).toBeNull()

      const { ctx, ops } = recordContext()
      createPaperGuidesPainter(
        () => canvas.getGrid(),
        () => config,
        () => doc.bounds,
      )(ctx, { width: 900, height: 420 })
      const rect = ops.find((item) => item.op === 'rect')
      expect(rect).toBeDefined()
      expect(rect!.args[0]).toBeCloseTo(before.args[0]! - table.getScrollLeft(), 6)
      expect(rect!.args[0]).toBeLessThan(0)
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
        () => doc.bounds,
      )(ctx, { width: 900, height: 420 })
      canvas.setPaperGuides({ ...config, paperSize: 'A3', orientation: 'landscape' })
      canvas.setPaperGuides(null)
      canvas.setPaperGuides(config)

      const template = doc.toTemplate('演练')
      // 画布尺寸由内容包围盒推导，模板不含声明 cols
      expect(Object.keys(template).sort()).toEqual([
        'aggregations',
        'name',
        'regions',
        'schemaVersion',
        'sheet',
      ])
      // 深层键扫描：任何层级都不出现参考线/纸张/分页类键名（先收集违规键，expect 平铺在外）
      const forbidden =
        /^(paper|paperSize|paperGuides|orientation|margin|paging|scale|guides?|rowBreaks|colBreaks|pageBreaks?)$/i
      const hits: string[] = []
      const walkKeys = (value: unknown): void => {
        if (Array.isArray(value)) {
          for (const item of value) walkKeys(item)
          return
        }
        if (value && typeof value === 'object') {
          for (const [key, child] of Object.entries(value)) {
            if (forbidden.test(key)) hits.push(key)
            walkKeys(child)
          }
        }
      }
      walkKeys(template)
      expect(hits).toEqual([])
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
        () => doc.bounds,
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
