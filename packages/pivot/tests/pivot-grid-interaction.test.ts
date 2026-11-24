// @vitest-environment happy-dom
// PivotGrid 组高亮交互回归：选区不复用 sheet 交互面（interactiveSelection 关闭），
// 组格点击回写整行带状段（组的可见行块 × 全部列），图标折叠/展开后按新结构重算
// 组块再回写（旧实现按折叠前区间回写到新结构，高亮滞后于结构——本文件锚定该缺陷）。
// 拖拽释放（down/up 位移超阈）不触发高亮。事件经真实 DOM 派发（容器 rect 为零矩形，
// clientX/clientY 即容器相对坐标）；选区快照经引擎 getSelection 读取。

import { describe, expect, it, vi } from 'vitest'

import { ListTable, type CellRenderer } from '@infinitable/table'

import { PivotGrid } from '../src/pivot-grid'
import type { PivotDimension, PivotMeasure, PivotRecord } from '../src/types'

const DIMENSIONS: PivotDimension[] = [
  { key: 'status', title: '状态', width: 120 },
  { key: 'priority', title: '优先级', width: 100 },
]
const MEASURES: PivotMeasure[] = [
  { key: 'amount', title: '金额和', field: 'amount', agg: 'sum', width: 120 },
  { key: 'count', title: '记录数', field: 'amount', agg: 'count', width: 120 },
]
/** 已完成×{中,低} + 待启动×{中,低}：引擎行序 row1-4 leaf + row5 总计（row0 表头） */
const RECORDS: PivotRecord[] = [
  { status: '已完成', priority: '中', amount: 1 },
  { status: '已完成', priority: '低', amount: 2 },
  { status: '待启动', priority: '中', amount: 3 },
  { status: '待启动', priority: '低', amount: 4 },
]

function createPivot(): { pivot: PivotGrid; table: ListTable; container: HTMLElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const pivot = new PivotGrid({
    container,
    dimensions: DIMENSIONS,
    measures: MEASURES,
    records: RECORDS,
    rowDimensions: ['status', 'priority'],
    columnDimensions: [],
  })
  return { pivot, table: pivot.getTable() as unknown as ListTable, container }
}

/** 引擎行 r 的中点 y（表头 1 行 + 数据行统一高 32） */
const rowMidY = (row: number) => row * 32 + 16

function click(container: HTMLElement, x: number, y: number): void {
  container.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y }))
  container.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y }))
}

describe('PivotGrid 组高亮（选区不复用 sheet 交互面）', () => {
  it('主题默认无边框：高亮为纯填充（selectionBorderWidth 压 0）', () => {
    const { pivot } = createPivot()
    expect(pivot.getTable().getTheme().interaction.selectionBorderWidth).toBe(0)
    pivot.destroy()
  })

  it('点击组格：高亮从命中维度列起的整行带（延展到最后一列，含数据列）', () => {
    const { pivot, table, container } = createPivot()
    // 组格「已完成」主格 (0,1)，合并区 rows 1-2；点在格身（非左缘图标带）
    click(container, 60, rowMidY(1))
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 1 }, end: { col: 3, row: 2 } },
    ])
    expect(table.getSelection().focus).toEqual({ col: 0, row: 1 })
    pivot.destroy()
  })

  it('点击深层维度格：高亮从该维度列（col 1）起，不含更浅维度列', () => {
    const { pivot, table, container } = createPivot()
    // 优先级列格「中」(1,1)：前缀 [已完成, 中] → 单行 leaf，带从 col 1 起
    click(container, 120 + 50, rowMidY(1))
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 1 }, end: { col: 3, row: 1 } },
    ])
    pivot.destroy()
  })

  it('点击列维度表头：高亮该列组 × 全部数据行（度量行单列，含总计行）', () => {
    const { pivot, table, container } = createPivot()
    // 度量标题头「金额和」(2,0)：单列 × 数据行 rows 1-5
    click(container, 220 + 60, 16)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 2, row: 1 }, end: { col: 2, row: 5 } },
    ])
    expect(table.getSelection().focus).toEqual({ col: 2, row: 0 })
    pivot.destroy()
  })

  it('点击数据格：高亮单元格自身', () => {
    const { pivot, table, container } = createPivot()
    click(container, 220 + 60, rowMidY(2))
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 2, row: 2 }, end: { col: 2, row: 2 } },
    ])
    expect(table.getSelection().focus).toEqual({ col: 2, row: 2 })
    pivot.destroy()
  })

  it('点击总计行头：高亮总计行（从合并主格列起）', () => {
    const { pivot, table, container } = createPivot()
    click(container, 60, rowMidY(5))
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 5 }, end: { col: 3, row: 5 } },
    ])
    pivot.destroy()
  })

  it('图标折叠后按新结构重放：高亮收敛为载体行整行，不残留旧区间（滞后缺陷锚点）', () => {
    const { pivot, table, container } = createPivot()
    // 左缘图标带内点击「已完成」主格：折叠 → 组收敛为载体行 row1（y=63 避开行边界，
    // 合并区竖直中线 64 处的图标命中带 ±12）
    click(container, 5, 63)
    expect(pivot.getVisibleRowCount()).toBe(4)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 1 }, end: { col: 3, row: 1 } },
    ])
    // 再点图标展开：组恢复 rows 1-2，高亮重放回整组
    click(container, 5, 32 + 16)
    expect(pivot.getVisibleRowCount()).toBe(5)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 1 }, end: { col: 3, row: 2 } },
    ])
    pivot.destroy()
  })

  it('拖拽释放不触发高亮：down/up 位移超阈的 click 被忽略（无拖选能力）', () => {
    const { pivot, table, container } = createPivot()
    click(container, 60, rowMidY(1))
    const before = table.getSelection().ranges
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: 60, clientY: 48 }))
    container.dispatchEvent(new MouseEvent('click', { clientX: 300, clientY: 48 }))
    expect(table.getSelection().ranges).toEqual(before)
    pivot.destroy()
  })

  it('结构变化清空旧高亮：领域操作（收起全部）后无残留段', () => {
    const { pivot, table, container } = createPivot()
    click(container, 60, rowMidY(1))
    expect(table.getSelection().ranges).toHaveLength(1)
    pivot.collapseAll()
    expect(table.getSelection().ranges).toEqual([])
    pivot.destroy()
  })

  it('setRecords / setDimensions / setMeasurePool 原地更新矩阵与结构', () => {
    const { pivot } = createPivot()
    pivot.setRecords([
      { status: '已完成', priority: '高', amount: 50 },
      { status: '进行中', priority: '低', amount: 70 },
    ])
    expect(pivot.getRecordCount()).toBe(2)
    expect(pivot.getVisibleRowCount()).toBe(3) // 2 leaf + 1 总计
    expect(pivot.getCellValue(2, 3)).toBe(120) // 总计金额和

    pivot.setDimensions([...DIMENSIONS, { key: 'dept', title: '部门', width: 110 }])
    expect(pivot.getDimensions().map((d) => d.key)).toEqual(['status', 'priority', 'dept'])

    pivot.setMeasurePool([
      { key: 'amount', title: '金额和', field: 'amount', agg: 'sum', width: 120 },
      { key: 'max-amount', title: '最大金额', field: 'amount', agg: 'max', width: 120 },
    ])
    expect(pivot.getMeasurePool().map((m) => m.key)).toEqual(['amount', 'max-amount'])
    pivot.setMeasures(['max-amount'])
    expect(pivot.getCellValue(2, 3)).toBe(70)
    pivot.destroy()
  })
})

/** 模拟引擎列宽拖拽落定：更新列宽并触发 onColResizeEnd 监听 */
function simulateColResizeEnd(table: ListTable, col: number, width: number): void {
  table.setColWidth(col, width)
  for (const listener of table.interactionState.colResizeEndListeners) {
    listener({ col, width })
  }
}

describe('PivotGrid 列宽保留与短路', () => {
  it('用户拖拽列宽在 toggleNode / collapseAll / expandAll 后保留，且未变宽度短路不调 setColWidth', () => {
    const { pivot, table } = createPivot()
    try {
      // 用户将第 0 列（status）和第 2 列（amount）拖宽
      simulateColResizeEnd(table, 0, 180)
      simulateColResizeEnd(table, 2, 210)
      expect(table.getColWidth(0)).toBe(180)
      expect(table.getColWidth(2)).toBe(210)

      const setColWidthSpy = vi.spyOn(table, 'setColWidth')

      pivot.toggleNode(['已完成'])
      expect(table.getColWidth(0)).toBe(180)
      expect(table.getColWidth(2)).toBe(210)
      expect(setColWidthSpy).not.toHaveBeenCalled()

      pivot.collapseAll()
      expect(table.getColWidth(0)).toBe(180)
      expect(table.getColWidth(2)).toBe(210)
      expect(setColWidthSpy).not.toHaveBeenCalled()

      pivot.expandAll()
      expect(table.getColWidth(0)).toBe(180)
      expect(table.getColWidth(2)).toBe(210)
      expect(setColWidthSpy).not.toHaveBeenCalled()
    } finally {
      pivot.destroy()
    }
  })

  it('setMeasures / setRowDimensions 重排或重建列后按稳定键还原用户拖拽列宽', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const pivot = new PivotGrid({
      container,
      dimensions: DIMENSIONS,
      measures: MEASURES,
      records: [
        { status: '已完成', priority: '中', amount: 1 },
        { status: '待启动', priority: '低', amount: 4 },
      ],
      rowDimensions: ['status', 'priority'],
      columnDimensions: ['priority'],
    })
    const table = pivot.getTable() as unknown as ListTable
    try {
      // 初始列：0=status(120), 1=priority(100), 2=(低,amount), 3=(低,count), 4=(中,amount), 5=(中,count)
      simulateColResizeEnd(table, 0, 175)
      simulateColResizeEnd(table, 4, 240)

      // 切换度量序列：仅保留 amount → (中, amount) 移到 col 3
      pivot.setMeasures(['amount'])
      expect(table.getColWidth(0)).toBe(175)
      expect(table.getColWidth(3)).toBe(240)

      // 恢复两度量：原列宽仍按稳定键还原
      pivot.setMeasures(['amount', 'count'])
      expect(table.getColWidth(0)).toBe(175)
      expect(table.getColWidth(4)).toBe(240)

      // 切换行维度顺序：priority 在前(col 0), status 在后(col 1) → status 仍保留 175
      pivot.setRowDimensions(['priority', 'status'])
      expect(table.getColWidth(0)).toBe(100)
      expect(table.getColWidth(1)).toBe(175)
      expect(table.getColWidth(4)).toBe(240)
    } finally {
      pivot.destroy()
    }
  })
})

describe('PivotGrid 运行时切换 showGrandTotal', () => {
  it('原地增删总计行，保留用户列宽、折叠态与选区高亮对齐，且交叉数据与下钻准确', () => {
    const { pivot, table, container } = createPivot()
    const drillEvents: Array<{ col: number; row: number; count: number }> = []
    const stopDrill = pivot.onCellDrill((event) => {
      drillEvents.push({ col: event.col, row: event.row, count: event.records.length })
    })
    try {
      expect(pivot.getShowGrandTotal()).toBe(true)
      expect(pivot.getVisibleRowCount()).toBe(5) // 4 leaf + 1 grand
      expect(pivot.rowCount).toBe(6)
      expect(pivot.getCellValue(2, 5)).toBe(10)

      // 调整用户列宽 + 折叠「已完成」+ 选中列头（覆盖到旧总计行 row 4）
      simulateColResizeEnd(table, 0, 185)
      simulateColResizeEnd(table, 2, 205)
      pivot.toggleNode(['已完成'])
      expect(pivot.getVisibleRowCount()).toBe(4) // 1 branch + 2 leaf + 1 grand
      click(container, 185 + 100 + 60, 16)
      expect(table.getSelection().ranges).toEqual([
        { start: { col: 2, row: 1 }, end: { col: 2, row: 4 } },
      ])

      // 同值短路：不清空既有选区
      pivot.setShowGrandTotal(true)
      expect(table.getSelection().ranges).toHaveLength(1)

      // 关闭总计行：原地移除总计行与合并区，清空滞后选区，保留列宽与折叠载体
      const setColWidthSpy = vi.spyOn(table, 'setColWidth')
      pivot.setShowGrandTotal(false)
      expect(pivot.getShowGrandTotal()).toBe(false)
      expect(pivot.getTable()).toBe(table)
      expect(pivot.getVisibleRowCount()).toBe(3) // 1 branch + 2 leaf
      expect(pivot.rowCount).toBe(4)
      expect(table.rowCount).toBe(4)
      expect(pivot.getSubtotalRowCount()).toBe(1)
      expect(pivot.getCellValue(0, 1)).toBe('已完成')
      expect(pivot.getCellValue(2, 1)).toBe(3)
      expect(pivot.getCellValue(2, 4)).toBeUndefined()
      expect(table.getColWidth(0)).toBe(185)
      expect(table.getColWidth(2)).toBe(205)
      expect(setColWidthSpy).not.toHaveBeenCalled()
      expect(table.getSelection().ranges).toEqual([])
      expect(table.geometryState.mergeCells.rangeAt(0, 4)).toBeNull()

      // 点击列头重新高亮：末行精确落在新尾行 row 3
      click(container, 185 + 100 + 60, 16)
      expect(table.getSelection().ranges).toEqual([
        { start: { col: 2, row: 1 }, end: { col: 2, row: 3 } },
      ])

      // 再次开启总计行：恢复总计行、合并区与下钻，仍保留折叠态与列宽
      pivot.setShowGrandTotal(true)
      expect(pivot.getShowGrandTotal()).toBe(true)
      expect(pivot.getVisibleRowCount()).toBe(4)
      expect(pivot.rowCount).toBe(5)
      expect(pivot.getSubtotalRowCount()).toBe(1)
      expect(pivot.getCellValue(0, 4)).toBe('总计')
      expect(pivot.getCellValue(2, 4)).toBe(10)
      expect(pivot.getCellValue(3, 4)).toBe(4)
      expect(table.geometryState.mergeCells.rangeAt(0, 4)).toEqual({
        startCol: 0,
        endCol: 1,
        startRow: 4,
        endRow: 4,
      })
      expect(table.getColWidth(0)).toBe(185)
      expect(table.getColWidth(2)).toBe(205)
      expect(pivot.getCellRecords(2, 4)).toHaveLength(4)
      expect(pivot.getCellRecords(2, 1)).toHaveLength(2)

      // 双击总计数据格触发下钻，返回全部 4 条明细
      container.dispatchEvent(
        new MouseEvent('dblclick', { clientX: 185 + 100 + 60, clientY: rowMidY(4) }),
      )
      expect(drillEvents).toEqual([{ col: 2, row: 4, count: 4 }])
    } finally {
      stopDrill()
      pivot.destroy()
    }
  })

  it('初始 showGrandTotal=false 时，运行时开启可正常展示总计行与下钻', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const pivot = new PivotGrid({
      container,
      dimensions: DIMENSIONS,
      measures: MEASURES,
      records: RECORDS,
      rowDimensions: ['status', 'priority'],
      columnDimensions: [],
      showGrandTotal: false,
    })
    try {
      expect(pivot.getShowGrandTotal()).toBe(false)
      expect(pivot.getVisibleRowCount()).toBe(4)
      pivot.setShowGrandTotal(true)
      expect(pivot.getShowGrandTotal()).toBe(true)
      expect(pivot.getVisibleRowCount()).toBe(5)
      expect(pivot.getCellValue(0, 5)).toBe('总计')
      expect(pivot.getCellValue(2, 5)).toBe(10)
      expect(pivot.getCellRecords(2, 5)).toHaveLength(4)
    } finally {
      pivot.destroy()
    }
  })
})

/** 绘制坐标捕获桩：记录 treeCell 绘制的三角路径 y 坐标与文本基线 y 坐标 */
function paintTreeCellAndCapture(
  table: ListTable,
  col: number,
  row: number,
): { triangleCenterY: number; textBaselineY: number } {
  let targetNode: { paint: (ctx: Parameters<CellRenderer>[0]['ctx']) => void } | undefined
  for (const node of table.sceneState.cellNodes.values()) {
    if (node.col === col && node.row === row) {
      targetNode = node
      break
    }
  }
  if (!targetNode) {
    throw new Error(`未找到场景节点 (${col}, ${row})`)
  }
  const pathYs: number[] = []
  let textBaselineY = Number.NaN
  const noop = (): void => {}
  const ctx: Parameters<CellRenderer>[0]['ctx'] = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    save: noop,
    restore: noop,
    setTransform: noop,
    translate: noop,
    beginPath: noop,
    rect: noop,
    moveTo: (_x, y) => {
      pathYs.push(y)
    },
    lineTo: (_x, y) => {
      pathYs.push(y)
    },
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    closePath: noop,
    stroke: noop,
    fill: noop,
    clip: noop,
    clearRect: noop,
    fillRect: noop,
    fillText: (_text, _x, y) => {
      textBaselineY = y
    },
    drawImage: noop,
    measureText: (text) => ({ width: text.length * 7 }),
  }
  targetNode.paint(ctx)
  // 展开钮由 drawTreeToggleButton(cx, cy, true) 绘出：12×12 圆角方框（y 范围为 [cy - 6, cy + 6]）与中心横线（y = cy）
  const minY = Math.min(...pathYs)
  const maxY = Math.max(...pathYs)
  const triangleCenterY = (minY + maxY) / 2
  return { triangleCenterY, textBaselineY }
}

describe('PivotGrid treeCell 粘性居中渲染与同源点击命中', () => {
  function createTallPivot(): { pivot: PivotGrid; table: ListTable; container: HTMLElement } {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const records: PivotRecord[] = [
      ...Array.from({ length: 20 }, (_, i) => ({
        status: 'A组',
        priority: `项${String(i + 1).padStart(2, '0')}`,
        amount: i + 1,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        status: 'B组',
        priority: `项${String(i + 1).padStart(2, '0')}`,
        amount: 100 + i,
      })),
    ]
    // height=256（含 1 行冻结表头 32px → 可滚动表体视口 [32, 256]，高 224px）
    // 总宽度 120 + 100 + 120 = 340 < 600，无横向滚动条槽
    const pivot = new PivotGrid({
      container,
      width: 600,
      height: 256,
      dpr: 1,
      dimensions: DIMENSIONS,
      measures: [MEASURES[0]!],
      records,
      rowDimensions: ['status', 'priority'],
      columnDimensions: [],
    })
    return { pivot, table: pivot.getTable() as unknown as ListTable, container }
  }

  it('长合并组底部裁出视口时（scrollTop=0）：三角与文本粘性居中于可见区间，点击精确折叠', () => {
    const { pivot, table, container } = createTallPivot()
    try {
      expect(pivot.getVisibleRowCount()).toBe(26) // 20 A + 5 B + 1 grand
      // A组 spans rows 1..20 (height=640), origin.y=32, 可见区间 [32, 256] → 局部 [0, 224], centerY=112
      const painted = paintTreeCellAndCapture(table, 0, 1)
      expect(painted.triangleCenterY).toBe(112)
      expect(painted.textBaselineY).toBe(116)

      // 视口 y = origin.y(32) + centerY(112) = 144：点击命中折叠 A组
      click(container, 9, 144)
      expect(pivot.getVisibleRowCount()).toBe(7) // 1 branch(A) + 5 B + 1 grand
    } finally {
      pivot.destroy()
    }
  })

  it('长合并组上下两端均裁出视口时（scrollTop=160，首行滚出窗口）：仍粘性居中于表体中线并命中点击', () => {
    const { pivot, table, container } = createTallPivot()
    try {
      table.scrollBy(0, 160) // 滚过 5 行：origin.y = 32 - 160 = -128；局部可见 [160, 384] → centerY=272
      const painted = paintTreeCellAndCapture(table, 0, 1)
      expect(painted.triangleCenterY).toBe(272)
      expect(painted.textBaselineY).toBe(276)

      // 视口 y = -128 + 272 = 144：原格顶附近的 (9, 48) 不应再触发折叠，仅高亮 A组
      click(container, 9, 48)
      expect(pivot.getVisibleRowCount()).toBe(26)
      expect(table.getSelection().ranges).toEqual([
        { start: { col: 0, row: 1 }, end: { col: 2, row: 20 } },
      ])

      // 点击粘性居中后的三角坐标 (9, 144) 精确折叠 A组
      click(container, 9, 144)
      expect(pivot.getVisibleRowCount()).toBe(7)
    } finally {
      pivot.destroy()
    }
  })

  it('长合并组仅底端局部留在视口时（scrollTop=544）：居中于剩余可见段并在对应坐标命中点击', () => {
    const { pivot, table, container } = createTallPivot()
    try {
      table.scrollBy(0, 544) // origin.y = 32 - 544 = -512, 组底端在 128；局部可见 [544, 640] → centerY=592
      const painted = paintTreeCellAndCapture(table, 0, 1)
      expect(painted.triangleCenterY).toBe(592)
      expect(painted.textBaselineY).toBe(596)

      // 视口 y = -512 + 592 = 80（[32, 128] 中点）
      click(container, 9, 80)
      expect(pivot.getVisibleRowCount()).toBe(7)
    } finally {
      pivot.destroy()
    }
  })

  it('长合并组仅剩不足一行贴顶时（scrollTop=628）：按半行内边距夹紧到 mergedHeight - 16', () => {
    const { pivot, table } = createTallPivot()
    try {
      table.scrollBy(0, 628) // 局部可见 [628, 640]，rawCenterY=634 夹紧至 640 - 16 = 624
      const painted = paintTreeCellAndCapture(table, 0, 1)
      expect(painted.triangleCenterY).toBe(624)
      expect(painted.textBaselineY).toBe(628)
    } finally {
      pivot.destroy()
    }
  })
})
