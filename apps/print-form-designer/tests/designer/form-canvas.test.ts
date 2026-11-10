// B1/B2 画布级回归：快照级静默 restore（行高列宽撤销、波段平移改写合并）后
// 引擎几何/合并随模型还原的断言。DOM 面与 canvas 2d 桩由 testing/dom 统一挂载。
import { describe, expect, test } from 'bun:test'
import type { SheetGrid } from '@infinitable/sheet'
import { FormDoc } from '../../src/domain/form-doc'
import { mountFormCanvas } from '../../src/designer/form-canvas'
import { setupDom } from './testing/dom'
import { RANGE } from './testing/fixtures'

setupDom()

/** 引擎读取面：协议面 + 合并区读取（getMergeRanges 未收敛进 TableEngine 协议面，按实现窄化） */
type EngineView = ReturnType<SheetGrid['getTable']> & {
  getMergeRanges(): readonly { startRow: number }[]
  /** 场景格节点（文本溢出走廊断言用：textMinX/textMaxX 为格内局部坐标） */
  cellNodes: Map<number, CellNodeView>
}

/** 场景格节点的断言用窄化（只取走廊相关字段） */
interface CellNodeView {
  col: number
  row: number
  width: number
  textMinX: number
  textMaxX: number
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
    const doc = FormDoc.create(8)
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

  test('B2：数据块上方插行/撤销/重做后合并区随行块还原', () => {
    const doc = FormDoc.create(8)
    doc.sheet.mergeCells(RANGE(2, 0, 2, 3)) // 默认数据块末行合并 4 格
    const { canvas, engine } = mountCanvas(doc)
    try {
      const mergeStartRow = () => engine().getMergeRanges()[0]?.startRow
      expect(mergeStartRow()).toBe(2)

      // 默认数据块 0..2 变高到 5 行：数据块上方行的合并区不下移
      doc.resizeRegionRows(0, 5)
      expect(mergeStartRow()).toBe(2)

      expect(doc.history.undo()).toBe(true)
      expect(mergeStartRow()).toBe(2)
      expect(doc.history.redo()).toBe(true)
    } finally {
      canvas.release()
    }
  })

  test('窄列长占位符不跨格溢出：两侧走廊都收敛在本格（无文本堆叠）', () => {
    const doc = FormDoc.create(8)
    doc.sheet.ensureTableSize(3, 8)
    // 相邻两格都超宽且第 3 格留空：引擎缺省 Excel 式溢出会让右对齐格向左、左对齐格
    // 向右同时穿过空格，两段文本叠在同一片空间（设计画布的「文本堆叠」）
    doc.setCellBinding({ row: 0, col: 1 }, { path: '[0].items[].qty' })
    doc.setCellBinding({ row: 0, col: 3 }, { path: '[0].items[].amount' })
    doc.setColWidth(1, 40)
    doc.setColWidth(3, 40)
    const { canvas, engine } = mountCanvas(doc)
    try {
      const nodes = engine().cellNodes
      const node = (col: number) => [...nodes.values()].find((n) => n.col === col && n.row === 0)!
      for (const col of [1, 3]) {
        // 走廊收敛在本格：绘制区不与任何邻格相交
        expect(node(col).textMinX).toBe(0)
        expect(node(col).textMaxX).toBe(node(col).width)
      }
    } finally {
      canvas.release()
    }
  })

  test('非重建路径保留：展开方式切换与行高正向编辑就地同步（实例不更替）', () => {
    const doc = FormDoc.create(8)
    const { canvas, engine } = mountCanvas(doc)
    try {
      const grid = canvas.getGrid()
      // 展开方式必须有数据源才能设（份数由数据块 source 决定）
      doc.setRegionSource(0, { kind: 'dataset', datasetId: 'ds1', path: '' })
      doc.setRegionExpand(0, 'down')
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

  test('无限画布：引擎行列扩容与数据块增删都不重建网格（行数不再是重建依据）', () => {
    const doc = FormDoc.create(8)
    const { canvas, engine } = mountCanvas(doc)
    try {
      const grid = canvas.getGrid()
      const rowsBefore = doc.sheet.rows
      // growOnScroll 的等价效果：引擎行列被撑大（sheet.rows 会远超内容）
      doc.sheet.ensureTableSize(rowsBefore + 120, doc.sheet.cols + 12)
      canvas.refresh()
      expect(canvas.getGrid()).toBe(grid)
      expect(engine()).toBeDefined()

      doc.addRegion(3)
      expect(canvas.getGrid()).toBe(grid)

      // 合并区变化仍是重建依据（引擎合并 Map 只能整体替换）
      doc.sheet.mergeCells(RANGE(0, 0, 0, 2))
      canvas.refresh()
      expect(canvas.getGrid()).not.toBe(grid)
    } finally {
      canvas.release()
    }
  })
})
