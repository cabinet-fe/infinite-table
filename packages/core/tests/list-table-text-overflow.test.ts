import type { RenderContext } from '@infinitable/render'
import { describe, expect, it } from 'vitest'

import { CellNode } from '../src/cell-node'
import { ListTable } from '../src/list-table'
import { findCellNode } from './testing/find-cell-node'
import { paintTreeCanonical, paintTreeForTest } from './testing/paint-tree'
import { RecordingContext, type RecordedCall } from './testing/recording-context'
import { StubHost } from './testing/stub-host'
import type { CellChangeEvent, ListTableOptions, TableModel } from '../src/types'

const LONG_TEXT = 'A'.repeat(20) // StubContext 每字符宽 10px → 200px

interface TextCall {
  text: string
  x: number
  y: number
}

interface ClipCall {
  x: number
  y: number
  width: number
  height: number
}

/** 每字符固定 10px 宽的记录型上下文：记录 fillText/rect/clip/save/restore */
class MeasureStubContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  font = ''
  readonly texts: TextCall[] = []
  readonly rects: ClipCall[] = []
  readonly clips: ClipCall[] = []
  saves = 0
  restores = 0
  measureCalls = 0

  save(): void {
    this.saves++
  }
  restore(): void {
    this.restores++
  }
  setTransform(): void {}
  translate(): void {}
  beginPath(): void {}
  rect(x: number, y: number, width: number, height: number): void {
    this.rects.push({ x, y, width, height })
  }
  clip(): void {
    this.clips.push(...this.rects.slice(-1))
  }
  clearRect(): void {}
  drawImage(): void {}
  measureText(text: string): { width: number } {
    this.measureCalls++
    return { width: text.length * 10 }
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.rects.push({ x, y, width, height })
  }
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y })
  }
}

/** 同步 echo 的假模型：setCellValue 内同步发变更事件 */
class EchoModel implements TableModel {
  readonly data = new Map<string, unknown>()
  private readonly listeners = new Set<(change: CellChangeEvent) => void>()

  constructor(readonly rowCount: number) {}

  getCellValue(col: number, row: number): unknown {
    return this.data.get(`${col}:${row}`)
  }
  setCellValue(col: number, row: number, value: unknown): void {
    const oldValue = this.data.get(`${col}:${row}`)
    this.data.set(`${col}:${row}`, value)
    this.emit({ col, row, oldValue, newValue: value })
  }
  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(change: CellChangeEvent): void {
    for (const listener of this.listeners) {
      listener(change)
    }
  }
}

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  columns: Array.from({ length: 10 }, () => ({ field: 'name', title: 'C' })),
} satisfies Partial<ListTableOptions>

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, host, ...extra })
  return { host, table }
}

function findNode(host: StubHost, col: number, row: number): CellNode | undefined {
  const body = host.layers.get('body')
  return body ? findCellNode(body.root, col, row) : undefined
}

describe('renderTextCell 溢出与换行', () => {
  it('放得下：不裁剪直接单行绘制', () => {
    const ctx = new MeasureStubContext()
    new CellNode({ col: 0, row: 0, width: 100, height: 32, text: 'hello' }).paint(ctx)
    expect(ctx.clips).toEqual([])
    expect(ctx.texts).toEqual([{ text: 'hello', x: 8, y: 20 }])
  })

  it('超宽且允许溢出：clip 到允许右界，完整文本不截断', () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({ col: 0, row: 0, width: 100, height: 32, text: LONG_TEXT })
    node.textMaxX = 260
    node.paint(ctx)
    expect(ctx.clips).toEqual([{ x: 0, y: 0, width: 260, height: 32 }])
    expect(ctx.texts).toEqual([{ text: LONG_TEXT, x: 8, y: 20 }])
    expect(ctx.saves).toBe(1)
    expect(ctx.restores).toBe(1)
  })

  it('超宽不允许溢出（表头/合并/带边界）：clip 在本格内', () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({ col: 0, row: 0, width: 100, height: 32, text: LONG_TEXT })
    node.paint(ctx)
    expect(ctx.clips).toEqual([{ x: 0, y: 0, width: 100, height: 32 }])
    expect(ctx.texts).toEqual([{ text: LONG_TEXT, x: 8, y: 20 }])
  })

  it('右对齐左溢：clip 到允许左界（负向），锚点仍在源格', () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({
      col: 2,
      row: 0,
      width: 100,
      height: 32,
      text: LONG_TEXT,
      style: { textAlign: 'right' },
    })
    node.textMinX = -160
    node.paint(ctx)
    // clip [-160, 100)；锚点 x = 8 + 84 - 200 = -108（源格内容盒右缘对齐，整体左伸）
    expect(ctx.clips).toEqual([{ x: -160, y: 0, width: 260, height: 32 }])
    expect(ctx.texts).toEqual([{ text: LONG_TEXT, x: -108, y: 20 }])
  })

  it('center 双向溢出：clip 双界，锚点以源格对称展开', () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({
      col: 2,
      row: 0,
      width: 100,
      height: 32,
      text: LONG_TEXT,
      style: { textAlign: 'center' },
    })
    node.textMaxX = 250
    node.textMinX = -150
    node.paint(ctx)
    // clip [-150, 250)；锚点 x = 8 + (84 - 200) / 2 = -50
    expect(ctx.clips).toEqual([{ x: -150, y: 0, width: 400, height: 32 }])
    expect(ctx.texts).toEqual([{ text: LONG_TEXT, x: -50, y: 20 }])
  })

  it('center/right 未传走廊界（直构节点）：退化为格内裁剪', () => {
    for (const textAlign of ['center', 'right'] as const) {
      const ctx = new MeasureStubContext()
      const node = new CellNode({
        col: 0,
        row: 0,
        width: 100,
        height: 32,
        text: LONG_TEXT,
        style: { textAlign },
      })
      node.paint(ctx)
      expect(ctx.clips).toEqual([{ x: 0, y: 0, width: 100, height: 32 }])
    }
  })

  it('textWrap：格内逐字断行，行块垂直居中，clip 在本格', () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: LONG_TEXT,
      style: { textWrap: true },
    })
    node.paint(ctx)
    // 内容盒宽 84 → 每行 8 字符；格高 32 → 最多 2 行，超出舍弃
    expect(ctx.texts).toEqual([
      { text: 'A'.repeat(8), x: 8, y: 12 },
      { text: 'A'.repeat(8), x: 8, y: 28 },
    ])
    expect(ctx.clips).toEqual([{ x: 0, y: 0, width: 100, height: 32 }])
  })

  it('textOverflow ellipsis：超宽文本以省略号截断，不裁剪不溢出', () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: LONG_TEXT,
      style: { textOverflow: 'ellipsis' },
    })
    node.paint(ctx)
    // 内容盒宽 84：7 字符 + 省略号 80px 放得下，8 字符 + 省略号 90px 放不下
    expect(ctx.texts).toEqual([{ text: `${'A'.repeat(7)}…`, x: 8, y: 20 }])
    expect(ctx.clips).toEqual([])
    expect(ctx.saves).toBe(0)
  })

  it('textOverflow ellipsis + center：锚点按截断后宽居中', () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: LONG_TEXT,
      style: { textOverflow: 'ellipsis', textAlign: 'center' },
    })
    node.paint(ctx)
    // 截断后 80px：x = 8 + (84 - 80) / 2 = 10
    expect(ctx.texts).toEqual([{ text: `${'A'.repeat(7)}…`, x: 10, y: 20 }])
  })

  it('textOverflow clip：clip 在内缩内容盒，文本不截断不溢出', () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: LONG_TEXT,
      style: { textOverflow: 'clip' },
    })
    node.paint(ctx)
    expect(ctx.clips).toEqual([{ x: 8, y: 0, width: 84, height: 32 }])
    expect(ctx.texts).toEqual([{ text: LONG_TEXT, x: 8, y: 20 }])
    expect(ctx.saves).toBe(1)
    expect(ctx.restores).toBe(1)
  })

  it('padding 内缩绘制区：锚点与垂直定位按 [上,右,下,左] 生效', () => {
    const ctx = new MeasureStubContext()
    new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: 'hello',
      style: { padding: [4, 10, 6, 12] },
    }).paint(ctx)
    // 内容盒 x=12 宽 78（'hello' 50px 放得下）；垂直居中基线 = 4 + 22/2 + 4 = 19
    expect(ctx.texts).toEqual([{ text: 'hello', x: 12, y: 19 }])
    expect(ctx.clips).toEqual([])
  })

  it('文本测量按 text+font 缓存：同内容重复绘制只测一次，setContent 后重测', () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({ col: 0, row: 0, width: 100, height: 32, text: 'hello' })
    node.paint(ctx)
    node.paint(ctx)
    expect(ctx.measureCalls).toBe(1)
    node.setContent('world!', 1)
    node.paint(ctx)
    expect(ctx.measureCalls).toBe(2)
    // checkbox / 自定义渲染不测量
    const checkboxCtx = new MeasureStubContext()
    new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: 'true',
      cellType: 'checkbox',
    }).paint(checkboxCtx)
    expect(checkboxCtx.measureCalls).toBe(0)
  })

  it('文本测量缓存按 font 串失效：style 引用替换且 font 变化、text 不变时重测', () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: 'hello',
      style: { fontWeight: 400 },
    })
    node.paint(ctx)
    node.paint(ctx)
    expect(ctx.measureCalls).toBe(1)
    // refreshCell 经 projectCellStyle 产新 style 对象整引用替换：font 结果变化必须
    // 重测，否则 textAlign 锚点与溢出判定拿到旧 font 下的陈旧宽
    node.style = { fontWeight: 700 }
    node.paint(ctx)
    expect(ctx.measureCalls).toBe(2)
    // 仅换 style 引用而 font 串结果不变：命中缓存不重测
    node.style = { fontWeight: 700, color: '#f00' }
    node.paint(ctx)
    expect(ctx.measureCalls).toBe(2)
  })

  it("空文本往返后 font 变化仍重测：setContent('') 早退不吞掉样式失效", () => {
    const ctx = new MeasureStubContext()
    const node = new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: 'hello',
      style: { fontWeight: 400 },
    })
    node.paint(ctx)
    expect(ctx.measureCalls).toBe(1)
    node.setContent('', undefined)
    node.style = { fontWeight: 700 } // 空文本期 paint 早退，样式替换未被观察
    node.paint(ctx)
    node.setContent('hello', undefined)
    node.paint(ctx)
    expect(ctx.measureCalls).toBe(2)
  })
})

describe('ListTable 溢出右界', () => {
  it('右侧空格：溢出右界延伸到首个非空格左缘', () => {
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: LONG_TEXT }, {}, {}],
      rowCount: 1,
    })
    const node = findNode(host, 0, 0)
    expect(node?.width).toBe(100)
    // 右邻两格全空：右界 = 第 3 列右缘的局部坐标 300
    expect(node?.textMaxX).toBe(300)
  })

  it('右侧非空格：不溢出，裁剪在本格', () => {
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }],
      records: [{ a: LONG_TEXT, b: 'x' }],
      rowCount: 1,
    })
    expect(findNode(host, 0, 0)?.textMaxX).toBe(100)
  })

  it('checkbox/图片/自定义渲染/合并覆盖的右邻都算非空', () => {
    const checkbox = createTable({
      columns: [{ field: 'a' }, { cellType: 'checkbox' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
    })
    expect(findNode(checkbox.host, 0, 0)?.textMaxX).toBe(100)

    const image = createTable({
      columns: [{ field: 'a' }, { field: 'b' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
      resolveCellImage: (col) => (col === 1 ? 'x.png' : null),
    })
    expect(findNode(image.host, 0, 0)?.textMaxX).toBe(100)

    const custom = createTable({
      columns: [{ field: 'a' }, { field: 'b' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
      resolveCellRenderer: (col) => (col === 1 ? () => undefined : null),
    })
    expect(findNode(custom.host, 0, 0)?.textMaxX).toBe(100)

    const merged = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
      mergeCells: [{ startCol: 1, startRow: 0, endCol: 2, endRow: 0 }],
    })
    expect(findNode(merged.host, 0, 0)?.textMaxX).toBe(100)
  })

  it('合并主格与表头自身不溢出', () => {
    const { host } = createTable({
      columns: [
        { field: 'a', title: LONG_TEXT },
        { field: 'b', title: LONG_TEXT },
      ],
      records: [{ a: 'x' }],
      rowCount: 1,
      mergeCells: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }],
    })
    // 合并主格（宽 200）不溢出；列头不溢出
    expect(findNode(host, 0, 0)?.textMaxX).toBe(200)
    expect(findNode(host, 0, -1)?.textMaxX).toBe(100)
  })

  it('数据格设置 textOverflow 后不溢出：走廊收敛回本格', () => {
    const table = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 0 ? { textOverflow: 'ellipsis' } : null),
    })
    expect(findNode(table.host, 0, 0)?.textMaxX).toBe(100)

    const clipped = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 0 ? { textOverflow: 'clip' } : null),
    })
    expect(findNode(clipped.host, 0, 0)?.textMaxX).toBe(100)
  })

  it('列头与行号列缺省 ellipsis，数据格未设置保持 Excel 式溢出', () => {
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
    })
    expect(findNode(host, 0, -1)?.style.textOverflow).toBe('ellipsis')
    expect(findNode(host, -1, 0)?.style.textOverflow).toBe('ellipsis')
    // 数据格未设置：仍走 Excel 式溢出（右邻空格走廊）
    expect(findNode(host, 0, 0)?.style.textOverflow).toBeUndefined()
    expect(findNode(host, 0, 0)?.textMaxX).toBe(300)
  })

  it('列头超宽标题按缺省 ellipsis 截断绘制', () => {
    const { host } = createTable({
      columns: [{ field: 'a', title: LONG_TEXT }],
      records: [{ a: 'x' }],
      rowCount: 1,
    })
    const ctx = new MeasureStubContext()
    findNode(host, 0, -1)?.paint(ctx)
    // 列头宽 100 → 内容盒 84：7 字符 + 省略号；表头高 36 → 居中基线 22
    expect(ctx.texts).toEqual([{ text: `${'A'.repeat(7)}…`, x: 8, y: 22 }])
  })

  it('冻结列带边界截断：冻结格不越界溢出，带内空格可溢出', () => {
    const frozen = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
      frozenColCount: 1,
    })
    // 冻结带右缘即本格右缘（单列冻结带）
    expect(findNode(frozen.host, 0, 0)?.textMaxX).toBe(100)

    const frozen2 = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
      frozenColCount: 2,
    })
    // 带内第 2 列为空：右界 = 冻结带右缘（局部 200），不越进滚动带
    expect(findNode(frozen2.host, 0, 0)?.textMaxX).toBe(200)
  })

  it('center 对齐向两侧溢出：走廊双界按文本缘收边（短于空段止于文本缘）', () => {
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }, { field: 'd' }, { field: 'e' }],
      records: [{ c: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 2 ? { textAlign: 'center' } : null),
    })
    const node = findNode(host, 2, 0)!
    // 文本 200px 居中锚定源格（内容盒 [8, 92]，锚点 8 + (84 - 200) / 2 = -50）：
    // 文本缘 [-50, 150) 只跨到左右各一列（列 1 与列 3）→ 走廊 [1, 4)，局部界即外侧列边界
    // [-100, +200]；列 0/4 虽空但文本未及，不纳入走廊（其竖线照常画）
    expect(node.textMinX).toBe(-100)
    expect(node.textMaxX).toBe(200)
  })

  it('right 对齐向左溢出：只看左壁，右界收敛本格', () => {
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }, { field: 'd' }],
      records: [{ c: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 2 ? { textAlign: 'right' } : null),
    })
    const node = findNode(host, 2, 0)!
    expect(node.textMaxX).toBe(100)
    expect(node.textMinX).toBe(-200)
  })

  it('center 两壁皆阻断：不溢出；单侧空：向空侧溢', () => {
    const blocked = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: 'x', b: LONG_TEXT, c: 'y' }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 1 ? { textAlign: 'center' } : null),
    })
    expect(findNode(blocked.host, 1, 0)?.textMaxX).toBe(100)
    expect(findNode(blocked.host, 1, 0)?.textMinX).toBe(0)

    const rightEmpty = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: 'x', b: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 1 ? { textAlign: 'center' } : null),
    })
    expect(findNode(rightEmpty.host, 1, 0)?.textMinX).toBe(0)
    expect(findNode(rightEmpty.host, 1, 0)?.textMaxX).toBe(200)
  })

  it('right 对齐左壁阻断：不溢出', () => {
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }],
      records: [{ a: 'x', b: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 1 ? { textAlign: 'right' } : null),
    })
    expect(findNode(host, 1, 0)?.textMaxX).toBe(100)
    expect(findNode(host, 1, 0)?.textMinX).toBe(0)
  })

  it('空白串邻居按非空阻断（Univer/Excel 口径）', () => {
    const model = new EchoModel(1)
    model.data.set('0:0', LONG_TEXT)
    model.data.set('1:0', '   ')
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }],
      rowCount: 1,
      model,
    })
    expect(findNode(host, 0, 0)?.textMaxX).toBe(100)
  })

  it('左溢走廊不越冻结列带边界：带内源与滚动带源各自止于带缘', () => {
    const frozen1 = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ b: LONG_TEXT }],
      rowCount: 1,
      frozenColCount: 1,
      resolveCellStyle: (col) => (col === 1 ? { textAlign: 'right' } : null),
    })
    // 滚动带源（col 1）：左邻是冻结带 → 走廊止于带缘（本格左缘），不左溢
    expect(findNode(frozen1.host, 1, 0)?.textMinX).toBe(0)

    const frozen2 = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ b: LONG_TEXT }],
      rowCount: 1,
      frozenColCount: 2,
      resolveCellStyle: (col) => (col === 1 ? { textAlign: 'right' } : null),
    })
    // 冻结带内源（col 1）：带内左邻 col 0 为空 → 左溢一格（-100），不越带首
    expect(findNode(frozen2.host, 1, 0)?.textMinX).toBe(-100)
  })

  it('带内按列降序建节点：左格文本后画不被右格背景盖住', () => {
    const { host } = createTable({ records: [{ name: 'a' }], rowCount: 1 })
    const body = host.layers.get('body')
    const dataCols = body?.root.children
      .filter(
        (child): child is CellNode =>
          child instanceof CellNode && child.row === 0 && child.col >= 0,
      )
      .map((child) => child.col)
    expect(dataCols).toEqual([7, 6, 5, 4, 3, 2, 1, 0])
  })

  it('横向滚动增量补建保持溢出 z 序：左格溢出文本后画于新滚入格背景', () => {
    const { host, table } = createTable({
      columns: Array.from({ length: 10 }, (_, i) => ({ field: `f${i}`, title: 'C' })),
      records: [{ f3: LONG_TEXT }],
      rowCount: 1,
    })
    // 溢出格 col 3：右界延伸穿过后右侧全部空格（文本 200px > 格宽 100px）
    const before = findNode(host, 3, 0)
    expect(before?.textMaxX).toBeGreaterThan(before!.width)

    table.scrollTo(100, 0) // 窗口 [0,8) → [1,9)：col 8 滚入、col 0 滚出
    const body = host.layers.get('body')
    const cols = body?.root.children
      .filter(
        (child): child is CellNode =>
          child instanceof CellNode && child.row === 0 && child.col >= 0,
      )
      .map((child) => child.col)
    expect(cols).toContain(8)
    // 溢出格必须后画于其溢出走廊上的全部空格（含增量补建的 col 8），文本不被新格背景盖住
    expect(cols!.indexOf(3)).toBeGreaterThan(cols!.indexOf(8))
    expect(cols!.indexOf(3)).toBeGreaterThan(cols!.indexOf(7))
    expect(cols!.indexOf(3)).toBeGreaterThan(cols!.indexOf(4))
    // 存活格溢出右界随滚动平移保持不变（limitX 与 x 同步位移）
    const after = findNode(host, 3, 0)
    expect(after?.textMaxX).toBe(before?.textMaxX)
  })

  it('列级 textWrap 进样式投影，逐格 hook 可覆盖', () => {
    const column = createTable({
      columns: [{ field: 'a', textWrap: true }, { field: 'b' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
    })
    expect(findNode(column.host, 0, 0)?.style.textWrap).toBe(true)
    // 换行格不溢出
    expect(findNode(column.host, 0, 0)?.textMaxX).toBe(100)

    const overridden = createTable({
      columns: [{ field: 'a', textWrap: true }, { field: 'b' }],
      records: [{ a: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 0 ? { textWrap: false } : null),
    })
    // hook 覆盖为不换行：恢复溢出能力
    expect(findNode(overridden.host, 0, 0)?.style.textWrap).toBe(false)
    expect(findNode(overridden.host, 0, 0)?.textMaxX).toBe(200)
  })
})

describe('refreshCell 溢出联动失效', () => {
  it('本格变空：来源格溢出穿过本格，失效区并入其新走廊', () => {
    const model = new EchoModel(1)
    model.data.set('0:0', LONG_TEXT)
    model.data.set('1:0', 'x')
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      rowCount: 1,
      model,
    })
    expect(findNode(host, 0, 0)?.textMaxX).toBe(100)
    host.submitted.length = 0
    model.data.delete('1:0')
    model.emit({ col: 1, row: 0, oldValue: undefined, newValue: undefined })
    // (1,0) 自身边界 + 来源格 (0,0) 新走廊（穿过后到表缘 300）
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 48, y: 36, width: 300, height: 32 } } },
    ])
    expect(findNode(host, 0, 0)?.textMaxX).toBe(300)
  })

  it('本格变非空：来源格溢出收回，失效区并入其旧走廊', () => {
    const model = new EchoModel(1)
    model.data.set('0:0', LONG_TEXT)
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      rowCount: 1,
      model,
    })
    expect(findNode(host, 0, 0)?.textMaxX).toBe(300)
    host.submitted.length = 0
    model.data.set('1:0', 'x')
    model.emit({ col: 1, row: 0, oldValue: undefined, newValue: undefined })
    // (1,0) 自身边界 + 来源格旧走廊清除（新右界收回本格 100）；并集覆盖旧走廊 48..348
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 48, y: 36, width: 300, height: 32 } } },
    ])
    expect(findNode(host, 0, 0)?.textMaxX).toBe(100)
  })

  it('长文本变短：新旧溢出区都并入失效区防残影', () => {
    const model = new EchoModel(1)
    model.data.set('0:0', LONG_TEXT)
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      rowCount: 1,
      model,
    })
    host.submitted.length = 0
    model.data.set('0:0', 'hi')
    model.emit({ col: 0, row: 0, oldValue: undefined, newValue: undefined })
    // 'hi' 仍超宽（20px ≤ 92? 否：20 < 92 放得下）→ 新无溢出；旧走廊 300 并入
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 48, y: 36, width: 300, height: 32 } } },
    ])
  })

  it('左溢来源格联动：本格变非空 → 走廊收回；变空 → 走廊伸出', () => {
    const model = new EchoModel(1)
    model.data.set('2:0', LONG_TEXT)
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      rowCount: 1,
      model,
      resolveCellStyle: (col) => (col === 2 ? { textAlign: 'right' } : null),
    })
    // 初始：col 2 左溢穿 1、0 列（局部 [-200, 100)）
    expect(findNode(host, 2, 0)?.textMinX).toBe(-200)
    host.submitted.length = 0
    model.data.set('1:0', 'x')
    model.emit({ col: 1, row: 0, oldValue: undefined, newValue: undefined })
    // col 2 走廊收回本格；失效区并集覆盖旧走廊（x 从 48 = 248-200 起）
    expect(findNode(host, 2, 0)?.textMinX).toBe(0)
    expect(findNode(host, 2, 0)?.textMaxX).toBe(100)
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 48, y: 36, width: 300, height: 32 } } },
    ])
    host.submitted.length = 0
    model.data.delete('1:0')
    model.emit({ col: 1, row: 0, oldValue: 'x', newValue: undefined })
    // col 2 走廊重新伸出；并集同样覆盖整段
    expect(findNode(host, 2, 0)?.textMinX).toBe(-200)
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 48, y: 36, width: 300, height: 32 } } },
    ])
  })

  it('refresh 获得溢出：溢出源重挂树尾（后画于走廊格），表头容器仍在其上', () => {
    const model = new EchoModel(1)
    model.data.set('0:0', 'x')
    model.data.set('1:0', LONG_TEXT)
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      rowCount: 1,
      model,
      resolveCellStyle: (col) => (col === 1 ? { textAlign: 'center' } : null),
    })
    // 初建：两壁皆阻断，col 1 不溢出
    expect(findNode(host, 1, 0)?.textMinX).toBe(0)
    host.submitted.length = 0
    model.data.delete('0:0')
    model.emit({ col: 0, row: 0, oldValue: 'x', newValue: undefined })
    // 左壁放空：col 1 向左溢出，重挂树尾（行内其它数据格与全部走廊格之上）
    expect(findNode(host, 1, 0)?.textMinX).toBeLessThan(0)
    const root = host.layers.get('body')!.root
    const dataCols = root.children
      .filter((child): child is CellNode => child instanceof CellNode && child.row === 0)
      .map((child) => child.col)
    expect(dataCols[dataCols.length - 1]).toBe(1)
    // 表头容器与外框重挂后仍在溢出源之上
    expect(root.children.indexOf(findNode(host, 1, 0)!)).toBeLessThan(root.children.length - 2)
  })
})

describe('表头容器 z 序（R2-5）', () => {
  it('纵向滚动半行：顶部半可见数据格仍在表头容器之下（表头覆盖半格）', () => {
    const { host, table } = createTable({
      records: Array.from({ length: 100 }, (_, i) => ({ name: `r${i}` })),
      rowCount: 100,
    })
    table.scrollTo(0, 16) // 半行：行 0 上缘 = 36 - 16 = 20，顶部 16px 滑入列头带（0..36）
    const root = host.layers.get('body')!.root
    const headerGroup = root.children.at(-2)! // 末子节点为外框，表头容器次之
    const row0 = findNode(host, 0, 0)!
    // 半可见格确与列头带相交（覆盖关系有几何前提）
    expect(row0.y).toBeLessThan(36)
    expect(row0.y + row0.height).toBeGreaterThan(36)
    // 数据格在表头容器之前 → paintTree 后画表头，半格被表头覆盖
    expect(root.children.indexOf(row0)).toBeLessThan(root.children.indexOf(headerGroup))
  })

  it('滚动后合并主格上缘伸进列头带：主格仍在表头容器之下（表头最上）', () => {
    const { host, table } = createTable({
      records: Array.from({ length: 100 }, (_, i) => ({ name: `r${i}` })),
      rowCount: 100,
      mergeCells: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 3 }],
    })
    table.scrollTo(0, 32) // 主格 (0,0) 上缘 = 36 - 32 = 4，伸进列头带
    const root = host.layers.get('body')!.root
    const headerGroup = root.children.at(-2)! // 末子节点为外框，表头容器次之
    const master = findNode(host, 0, 0)!
    expect(master.y).toBeLessThan(36)
    expect(master.height).toBe(4 * 32) // 主格跨 4 行取完整尺寸
    expect(root.children.indexOf(master)).toBeLessThan(root.children.indexOf(headerGroup))
    expect(headerGroup.children.length).toBeGreaterThan(0)
  })
})

describe('溢出 z 序不变量（增量窗口）', () => {
  /** body root 中指定行的数据格列号（按树序） */
  function rowOrder(host: StubHost, row: number): number[] {
    const root = host.layers.get('body')!.root
    return root.children
      .filter(
        (child): child is CellNode =>
          child instanceof CellNode && child.row === row && child.col >= 0,
      )
      .map((child) => child.col)
  }

  function expectSourceAbove(order: number[], source: number, corridor: number[]): void {
    for (const col of corridor) {
      expect(order.indexOf(source)).toBeGreaterThan(order.indexOf(col))
    }
  }

  it('向左滚动增量补建保持左溢 z 序：右对齐溢出文本后画于新滚入格背景', () => {
    const { host, table } = createTable({
      columns: Array.from({ length: 10 }, (_, i) => ({ field: `f${i}`, title: 'C' })),
      records: [{ f5: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 5 ? { textAlign: 'right' } : null),
    })
    const before = findNode(host, 5, 0)
    expect(before?.textMinX).toBeLessThan(0)

    table.scrollTo(200, 0) // 窗口 [0,8) → [2,10)
    table.scrollTo(0, 0) // [2,10) → [0,8)：col 0、1 滚入
    const order = rowOrder(host, 0)
    expect(order).toContain(0)
    expect(order).toContain(1)
    // 左溢源（col 5）必须后画于走廊格（2..4）与新滚入格（0、1），
    // 文本不被新格背景/网格线盖住
    expectSourceAbove(order, 5, [0, 1, 2, 3, 4])
    // 存活格溢出走廊随滚动平移保持不变
    const after = findNode(host, 5, 0)
    expect(after?.textMinX).toBe(before?.textMinX)
  })

  it('横向滚动后行内规范序与全量重建一致：溢出源按列升序居于行尾', () => {
    const columns = Array.from({ length: 10 }, (_, i) => ({ field: `f${i}`, title: 'C' }))
    const style = (col: number): { textAlign: 'right' } | null =>
      col === 7 ? { textAlign: 'right' } : null
    const rebuilt = createTable({
      columns,
      records: [{ f2: LONG_TEXT, f7: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: style,
    })
    const scrolled = createTable({
      columns,
      records: [{ f2: LONG_TEXT, f7: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: style,
    })
    scrolled.table.scrollTo(300, 0)
    scrolled.table.scrollTo(0, 0)
    // 两路径的行内溢出源集合与相对次序（列升序居行尾）一致：
    // col 2（右溢）在 col 7（左溢）之前，且都在全部走廊格之后
    for (const { host } of [rebuilt, scrolled]) {
      const order = rowOrder(host, 0)
      expectSourceAbove(order, 2, [3, 4, 5, 6])
      expectSourceAbove(order, 7, [3, 4, 5, 6])
      expect(order.indexOf(2)).toBeLessThan(order.indexOf(7))
    }
  })
})

describe('三路径渲染一致（全量重建 / 滚动增量 / refreshCell）', () => {
  // 数据布局（无两源共享空段，三条路径像素可比）：
  // 行 0：col 1 左对齐长文本（右溢进 2、3）、col 5 右对齐长文本（左溢进 4、3、2）
  // 行 1：col 3 居中长文本（双向溢出）
  const COLS = 6
  const LEFT_TEXT = 'A'.repeat(14) // 140px
  const RIGHT_TEXT = 'A'.repeat(20) // 200px
  const CENTER_TEXT = 'A'.repeat(20) // 200px
  const OPTIONS = {
    columns: Array.from({ length: COLS }, (_, i) => ({ field: `f${i}`, title: 'C' })),
    rowCount: 2,
    resolveCellStyle: (col: number) =>
      col === 5
        ? ({ textAlign: 'right' } as const)
        : col === 3
          ? ({ textAlign: 'center' } as const)
          : null,
  }
  const RECORDS = [{ f1: LEFT_TEXT, f5: RIGHT_TEXT }, { f3: CENTER_TEXT }]

  function paintOps(host: StubHost): RecordedCall[] {
    const ctx = new RecordingContext()
    return paintTreeCanonical(host.layers.get('body')!.root, ctx)
  }

  function expectSourceAboveCorridors(host: StubHost): void {
    const root = host.layers.get('body')!.root
    const orderOf = (row: number): number[] =>
      root.children
        .filter(
          (child): child is CellNode =>
            child instanceof CellNode && child.row === row && child.col >= 0,
        )
        .map((child) => child.col)
    const row0 = orderOf(0)
    // 右溢源 col 1 与左溢源 col 5 都后画于本行全部非源格（含各自走廊格）
    for (const source of [1, 5]) {
      for (const col of [0, 2, 3, 4]) {
        expect(row0.indexOf(source)).toBeGreaterThan(row0.indexOf(col))
      }
    }
    // 行 1 的双向溢出源 col 3 后画于本行全部其它格
    const row1 = orderOf(1)
    for (const col of [0, 1, 2, 4, 5]) {
      expect(row1.indexOf(3)).toBeGreaterThan(row1.indexOf(col))
    }
    // 溢出源仍在表头容器之下（表头最上）
    const headerGroup = root.children.at(-2)!
    for (const source of [findNode(host, 1, 0)!, findNode(host, 5, 0)!, findNode(host, 3, 1)!]) {
      expect(root.children.indexOf(source)).toBeLessThan(root.children.indexOf(headerGroup))
    }
  }

  it('全量重建：溢出源后画于同条带全部走廊节点，规范序绘制流为基准', () => {
    const { host } = createTable({ ...OPTIONS, records: RECORDS })
    expectSourceAboveCorridors(host)
    expect(paintOps(host).length).toBeGreaterThan(0)
  })

  it('滚动增量窗口：同格同数据规范序绘制流与全量重建逐项一致', () => {
    const rebuilt = createTable({ ...OPTIONS, records: RECORDS })
    const scrolled = createTable({ ...OPTIONS, records: RECORDS })
    scrolled.table.scrollTo(250, 0)
    scrolled.table.scrollTo(100, 0)
    scrolled.table.scrollTo(0, 0)
    expectSourceAboveCorridors(scrolled.host)
    expect(paintOps(scrolled.host)).toEqual(paintOps(rebuilt.host))
  })

  it('refreshCell 路径：空表逐格写到同一份数据，规范序绘制流与全量重建逐项一致', () => {
    const rebuilt = createTable({ ...OPTIONS, records: RECORDS })
    const model = new EchoModel(2)
    const refreshed = createTable({ ...OPTIONS, model })
    const writes: Array<[number, number, unknown]> = [
      [1, 0, LEFT_TEXT],
      [5, 0, RIGHT_TEXT],
      [3, 1, CENTER_TEXT],
    ]
    for (const [col, row, value] of writes) {
      model.data.set(`${col}:${row}`, value)
      model.emit({ col, row, oldValue: undefined, newValue: value })
    }
    expectSourceAboveCorridors(refreshed.host)
    expect(paintOps(refreshed.host)).toEqual(paintOps(rebuilt.host))
  })
})

/** paintTree 绘制流的 fillRect（层坐标）：回放 save/restore/translate 折算绝对位置 */
function paintedRects(host: StubHost): Array<{
  x: number
  y: number
  width: number
  height: number
}> {
  const ctx = new RecordingContext()
  paintTreeForTest(host.layers.get('body')!.root, ctx)
  const stack: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }]
  const rects: Array<{ x: number; y: number; width: number; height: number }> = []
  for (const call of ctx.calls) {
    if (call.name === 'save') {
      stack.push({ ...stack[stack.length - 1]! })
    } else if (call.name === 'restore') {
      stack.pop()
    } else if (call.name === 'translate') {
      const top = stack[stack.length - 1]!
      top.x += call.args[0] as number
      top.y += call.args[1] as number
    } else if (call.name === 'fillRect') {
      const top = stack[stack.length - 1]!
      rects.push({
        x: top.x + (call.args[0] as number),
        y: top.y + (call.args[1] as number),
        width: call.args[2] as number,
        height: call.args[3] as number,
      })
    }
  }
  return rects
}

/**
 * 走廊竖线跳画像素断言（WPS 口径，P3）：行带内纵向线条 = 细高 fillRect（每格 right
 * 共享边 1px，横边/背景/文本排除），返回层坐标 x（升序）。行带取自该行任一数据格的
 * 实际几何，表头带/外框条带按「完全落在行带内」过滤。
 * 几何基准（缺省主题）：rowHeaderWidth 48、列宽 100、headerHeight 36、行高 32；
 * col c 右共享边的线 x = 48 + 100c - 1。
 */
function rowVerticalLineXs(host: StubHost, row: number): number[] {
  const root = host.layers.get('body')!.root
  const probe = root.children.find(
    (child): child is CellNode => child instanceof CellNode && child.row === row && child.col >= 0,
  )
  if (!probe) {
    return []
  }
  const top = probe.y
  const bottom = top + probe.height
  return paintedRects(host)
    .filter(
      (rect) =>
        rect.width <= 2 && rect.height >= 8 && rect.y >= top && rect.y + rect.height <= bottom,
    )
    .map((rect) => rect.x)
    .sort((a, b) => a - b)
}

/** 指定 y 上的横向细线 x 集合（层坐标，升序）：走廊格上下横边保留断言用 */
function horizontalLineXsAt(host: StubHost, y: number): number[] {
  return paintedRects(host)
    .filter((rect) => rect.height <= 2 && rect.width >= 8 && rect.y === y)
    .map((rect) => rect.x)
    .sort((a, b) => a - b)
}

describe('溢出走廊竖线跳画（WPS 口径）', () => {
  const FIVE_COLUMNS = [
    { field: 'f0' },
    { field: 'f1' },
    { field: 'f2' },
    { field: 'f3' },
    { field: 'f4' },
  ]

  it('左对齐右溢：走廊内（源格右缘到末段空格右缘）无纵向线条，走廊末端竖线保留', () => {
    // 行 0：col 0 长文本右溢（走廊 [0,3)，覆盖 col 1/2 空格），col 2 非空阻断走廊、
    // col 3/4 亦非空且右邻非空（自身走廊被立即阻断，排除短文本走廊干扰）
    const { host } = createTable({
      columns: FIVE_COLUMNS,
      records: [{ f0: LONG_TEXT, f2: 'x', f3: 'y', f4: 'z' }],
      rowCount: 1,
    })
    // 标记装配：源格与被覆盖空格在走廊内部（值 = 走廊右端列号），阻断格在外
    expect(findNode(host, 0, 0)?.corridorInterior).toBe(2)
    expect(findNode(host, 1, 0)?.corridorInterior).toBe(2)
    expect(findNode(host, 2, 0)?.corridorInterior).toBeNull()
    // 线 x：47 行号列右缘、247 走廊末端（col 1 right = col 2 左缘）、347/447/547 走廊外；
    // 147（源格 right，旧覆盖式分支位置）跳画
    expect(rowVerticalLineXs(host, 0)).toEqual([47, 247, 347, 447, 547])
  })

  it('短文本右溢不吞右侧空白区竖线（文本缘收边，sheet-ux-fixes-3 回归）', () => {
    // 回归：曾经走廊按「空段扫满」判定，短文本（135 / 84 / 67.5 这类）一旦右邻为空
    // 就把走廊一路扫到表缘，右侧大片空白的竖线被全部跳画（观感为「网格线凭空消失」）。
    // 现口径走廊按文本缘收边：文本尾未越过的列边界照常画线。
    const { host } = createTable({
      columns: FIVE_COLUMNS,
      records: [{ f0: '135' }],
      rowCount: 1,
    })
    // '135' 30px 未越出内容盒（84px）→ 无走廊、无跳画：双界收敛本格（textMinX 0、
    // textMaxX = 格宽 100）、整行竖线全在
    expect(findNode(host, 0, 0)?.corridorInterior).toBeNull()
    expect(findNode(host, 0, 0)?.textMaxX).toBe(100)
    expect(findNode(host, 0, 0)?.textMinX).toBe(0)
    expect(rowVerticalLineXs(host, 0)).toEqual([47, 147, 247, 347, 447, 547])

    // 越出本格但只跨过一列边界（100px 文本缘止于 108）：走廊 [0, 2) 只跳画源格右缘线
    // （147），被覆盖空格（col 1）右缘线（247）即走廊末端照画，第二列起竖线全在
    const shorter = createTable({
      columns: FIVE_COLUMNS,
      records: [{ f0: 'A'.repeat(10) }],
      rowCount: 1,
    })
    expect(findNode(shorter.host, 0, 0)?.corridorInterior).toBe(2)
    expect(findNode(shorter.host, 1, 0)?.corridorInterior).toBe(2)
    expect(rowVerticalLineXs(shorter.host, 0)).toEqual([47, 247, 347, 447, 547])

    // 跨过一列边界（200px 文本缘止于 208，落在 col 2 内）→ 走廊 [0, 3)：源格右缘（147）
    // 与 col 1 右缘（247）都在文本缘之内跳画，col 2 右缘（347）为走廊末端照画
    const crossing = createTable({
      columns: FIVE_COLUMNS,
      records: [{ f0: LONG_TEXT }],
      rowCount: 1,
    })
    expect(rowVerticalLineXs(crossing.host, 0)).toEqual([47, 347, 447, 547])
  })

  it('走廊格上下横边保留：走廊内格 bottom 与表头带 bottom 横线照画', () => {
    const { host } = createTable({
      columns: FIVE_COLUMNS,
      records: [{ f0: LONG_TEXT, f2: 'x', f3: 'y', f4: 'z' }],
      rowCount: 1,
    })
    // 行 0 bottom（y = 36 + 32 - 1 = 67）：走廊格 col 1（x=148）与其余格横线全在
    expect(horizontalLineXsAt(host, 67)).toEqual([0, 48, 148, 248, 348, 448])
    // 表头带 bottom（y = 35）：走廊格上缘横线照画
    expect(horizontalLineXsAt(host, 35)).toEqual([0, 48, 148, 248, 348, 448])
  })

  it('右对齐左溢：走廊内竖线隐藏，方向与右溢对称', () => {
    // 行 0：col 3 长文本（200px）右对齐左溢，锚点 8 + 84 - 200 = -108 → 文本缘 [-108, 92)
    // 只跨过 col 2 左缘（局部 -100）→ 走廊 [2, 4) 覆盖 col 2 空格；col 1 有短文本 'y'
    // （10px，不溢出）→ 无走廊，其右缘线照画；col 0 短文本同理
    const { host } = createTable({
      columns: [
        { field: 'f0' },
        { field: 'f1' },
        { field: 'f2' },
        { field: 'f3' },
        { field: 'f4' },
        { field: 'f5' },
      ],
      records: [{ f0: 'x', f1: 'y', f3: LONG_TEXT, f5: 'z' }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 3 ? { textAlign: 'right' } : null),
    })
    expect(findNode(host, 2, 0)?.corridorInterior).toBe(4)
    expect(findNode(host, 3, 0)?.corridorInterior).toBe(4)
    expect(findNode(host, 1, 0)?.corridorInterior).toBeNull()
    expect(findNode(host, 0, 0)?.corridorInterior).toBeNull()
    // 347（col 2 右缘 = 源格左缘）在文本缘内跳画；447 源格右缘为走廊末端（源格即文本尾所在格）
    // 照画；147/247 两侧短文本不溢出、547/647 走廊外，全数照画
    expect(rowVerticalLineXs(host, 0)).toEqual([47, 147, 247, 447, 547, 647])
  })

  it('居中双向溢：两侧走廊内竖线对称隐藏，走廊右末端竖线保留', () => {
    // 行 0：col 3 居中长文本（200px）双向溢，锚点 -50 → 文本缘 [-50, 150) 跨过 col 2 左缘
    // （-100）与 col 4 左缘（+100）→ 走廊 [2, 4) 只覆盖两侧各一列；col 1/5 的短文本
    // 自身不溢出，其右缘线照画
    const { host } = createTable({
      columns: [
        { field: 'f0' },
        { field: 'f1' },
        { field: 'f2' },
        { field: 'f3' },
        { field: 'f4' },
        { field: 'f5' },
      ],
      records: [{ f0: 'x', f1: 'y', f3: LONG_TEXT, f5: 'z' }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 3 ? { textAlign: 'center' } : null),
    })
    expect(findNode(host, 2, 0)?.corridorInterior).toBe(5)
    expect(findNode(host, 3, 0)?.corridorInterior).toBe(5)
    expect(findNode(host, 4, 0)?.corridorInterior).toBe(5)
    expect(findNode(host, 1, 0)?.corridorInterior).toBeNull()
    expect(findNode(host, 0, 0)?.corridorInterior).toBeNull()
    // 347/447 双向走廊内部跳画；547 走廊内末格右缘（源格文本尾所在格）照画；
    // 147/247 为两侧短文本（不溢出）所在格、647 走廊外，全数照画
    expect(rowVerticalLineXs(host, 0)).toEqual([47, 147, 247, 547, 647])
  })

  it('两源对溢共享空段：共享段竖线按更远走廊跳画（标记取最大右端）', () => {
    // col 1 右溢（200px，文本缘 [8, 208)）走廊 [1,4)；col 5 右对齐左溢（锚点 -108，
    // 文本缘 [-108, 92)）走廊 [3,6)：共享空段 col 3 被两走廊覆盖，标记取最大右端 6；
    // col 0 短文本自身不溢出，其右缘线（147）照画
    const { host } = createTable({
      columns: [
        { field: 'f0' },
        { field: 'f1' },
        { field: 'f2' },
        { field: 'f3' },
        { field: 'f4' },
        { field: 'f5' },
      ],
      records: [{ f1: LONG_TEXT, f5: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 5 ? { textAlign: 'right' } : null),
    })
    expect(findNode(host, 2, 0)?.corridorInterior).toBe(4)
    expect(findNode(host, 3, 0)?.corridorInterior).toBe(6)
    expect(findNode(host, 4, 0)?.corridorInterior).toBe(6)
    expect(findNode(host, 1, 0)?.corridorInterior).toBe(4)
    expect(findNode(host, 0, 0)?.corridorInterior).toBeNull()
    // 247/347/447/547 共享段全跳画；647 左溢源右缘（非走廊侧）保留
    expect(rowVerticalLineXs(host, 0)).toEqual([47, 147, 647])
  })

  it('走廊内用户显式纵向边框同规则隐藏，走廊外显式边框照画', () => {
    // col 0 长文本走廊 [0,3)：col 1 为走廊内部格（右缘非走廊末端）、col 3 走廊外
    const { host } = createTable({
      columns: FIVE_COLUMNS,
      records: [{ f0: LONG_TEXT, f3: 'x', f4: 'y' }],
      rowCount: 1,
      resolveCellStyle: (col) =>
        col === 1 || col === 3 ? { border: { right: { width: 2, color: '#f00' } } } : null,
    })
    // col 1 显式 2px right 处于走廊内部 → 与网格线同规则跳画；col 3 走廊外照画
    // （2px 线 x = 348 + 98 = 446）
    expect(rowVerticalLineXs(host, 0)).toEqual([47, 347, 446, 547])
    const explicit = paintedRects(host).filter((rect) => rect.width === 2)
    expect(explicit.map((rect) => rect.x)).toEqual([446])
  })
})

describe('走廊竖线三路径一致（全量重建 / refreshCell / 滚动增量）', () => {
  const FIVE_COLUMNS = [
    { field: 'f0' },
    { field: 'f1' },
    { field: 'f2' },
    { field: 'f3' },
    { field: 'f4' },
  ]

  it('邻居变空/变非空（refreshCell 联动）：走廊竖线状态与全量重建一致', () => {
    const model = new EchoModel(1)
    model.data.set('0:0', LONG_TEXT)
    model.data.set('2:0', 'x')
    model.data.set('4:0', 'y')
    const { host } = createTable({ columns: FIVE_COLUMNS, rowCount: 1, model })
    // 初始：col 0 长文本（200px，文本缘止于 208）走廊被 col 2 的 'x' 阻断 → [0, 2)：
    // 源格右缘（147）跳画、被覆盖的 col 1 右缘（247）为走廊内末格照画；'x' 自身
    // 不溢出，其右缘线（347）照画
    expect(findNode(host, 1, 0)?.corridorInterior).toBe(2)
    expect(findNode(host, 2, 0)?.corridorInterior).toBeNull()
    expect(findNode(host, 3, 0)?.corridorInterior).toBeNull()
    expect(rowVerticalLineXs(host, 0)).toEqual([47, 247, 347, 447, 547])
    // 邻居变空：col 0 走廊按文本缘续伸到 [0, 3)（文本尾仍落在 col 2 内），col 1 竖线跳画、
    // col 2 右缘线（347，走廊末端）保留
    model.data.delete('2:0')
    model.emit({ col: 2, row: 0, oldValue: 'x', newValue: undefined })
    expect(findNode(host, 3, 0)?.corridorInterior).toBeNull()
    expect(findNode(host, 2, 0)?.corridorInterior).toBe(3)
    expect(rowVerticalLineXs(host, 0)).toEqual([47, 347, 447, 547])
    // 与同数据全量重建逐像素一致
    const rebuilt = createTable({
      columns: FIVE_COLUMNS,
      records: [{ f0: LONG_TEXT, f4: 'y' }],
      rowCount: 1,
    })
    expect(rowVerticalLineXs(host, 0)).toEqual(rowVerticalLineXs(rebuilt.host, 0))
    // 邻居变非空：走廊被阻断收回，竖线状态回到初始全量重建水平
    model.data.set('2:0', 'x')
    model.emit({ col: 2, row: 0, oldValue: undefined, newValue: 'x' })
    expect(rowVerticalLineXs(host, 0)).toEqual([47, 247, 347, 447, 547])
  })

  it('溢出源 contentHidden 隐藏/恢复：走廊竖线状态不变（与全量重建一致）', () => {
    const { host } = createTable({
      columns: FIVE_COLUMNS,
      records: [{ f0: LONG_TEXT, f2: 'x', f3: 'y', f4: 'z' }],
      rowCount: 1,
    })
    const before = rowVerticalLineXs(host, 0)
    expect(before).toEqual([47, 247, 347, 447, 547])
    // 编辑会话隐藏源格内容：走廊扫描只看取值与样式，标记与竖线状态不随隐藏变化
    const source = findNode(host, 0, 0)!
    source.contentHidden = true
    expect(rowVerticalLineXs(host, 0)).toEqual(before)
    // 会话结束恢复：同样不变
    source.contentHidden = false
    expect(rowVerticalLineXs(host, 0)).toEqual(before)
  })

  it('滚动增量重建：走廊竖线状态与全量重建一致（含源格滚出窗口的走廊段）', () => {
    const columns = Array.from({ length: 10 }, (_, i) => ({ field: `f${i}` }))
    const records = [{ f2: LONG_TEXT, f7: 'x' }]
    const rebuilt = createTable({ columns, records, rowCount: 1 })
    const scrolled = createTable({ columns, records, rowCount: 1 })
    // 滚离再滚回：增量补建/摘除后整行重标，竖线状态与从未滚动的全量重建一致
    scrolled.table.scrollTo(350, 0)
    scrolled.table.scrollTo(0, 0)
    expect(rowVerticalLineXs(scrolled.host, 0)).toEqual(rowVerticalLineXs(rebuilt.host, 0))
    // 源格 col 2 滚出窗口（scroll 350）：窗外源格无节点不渲染文本，走廊段照常画线，
    // 增量路径与「同滚动位置全量重建」（几何变更触发）逐像素一致
    scrolled.table.scrollTo(350, 0)
    scrolled.table.setColWidth(0, 100)
    const rebuiltAtScroll = createTable({ columns, records, rowCount: 1 })
    rebuiltAtScroll.table.scrollTo(350, 0)
    expect(rowVerticalLineXs(scrolled.host, 0)).toEqual(rowVerticalLineXs(rebuiltAtScroll.host, 0))
  })
})

describe('走廊测宽快路径（P2）', () => {
  /** 计数宿主：包装 StubHost.measure 记调用次数（快路径命中 = 整串精测趋零，只剩字符级预热） */
  function countingHost(): { host: StubHost; calls: () => number } {
    const host = new StubHost()
    let count = 0
    const measure = host.measure.bind(host)
    host.measure = (text: string) => {
      count++
      return measure(text)
    }
    return { host, calls: () => count }
  }

  /** 数字表：10 列 × 200 行，取值 row*10+col（最长 4 位数字，StubHost 40px 放得下内容盒） */
  function numericTable(host: StubHost): ListTable {
    const columns = Array.from({ length: 10 }, (_, col) => ({ field: `f${col}`, title: 'C' }))
    const records = Array.from({ length: 200 }, (_, row) =>
      Object.fromEntries(columns.map((column, col) => [column.field, row * 10 + col])),
    )
    return new ListTable({ ...BASE_OPTIONS, host, columns, records, rowCount: 200 })
  }

  it('数字短文本建格只做字符级预热：0-9 各测一次，无整串精测', () => {
    const { host, calls } = countingHost()
    numericTable(host)
    expect(calls()).toBe(10)
  })

  it('数字表纵向滚动帧零测量：新滚入行建格、走廊重标与窗外反查全部快路径命中', () => {
    const { host, calls } = countingHost()
    const table = numericTable(host)
    expect(calls()).toBe(10)
    table.scrollTo(0, 320) // 10 行滚入，文本仍由已见字符组成
    expect(calls()).toBe(10)
  })

  it('快路径不吞真溢出：数字长文本上界证不出，回落精测产生走廊', () => {
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: '1'.repeat(20) }], // StubHost 10px/字 → 200px
      rowCount: 1,
    })
    expect(findNode(host, 0, 0)?.textMaxX).toBe(300)
  })

  it('居中恰满格：上界证不出回落精测，textLeft=0 边界仍判不溢出', () => {
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: 'A'.repeat(10) }], // 100px，锚点 8+(84-100)/2=0
      rowCount: 1,
      resolveCellStyle: (col) => (col === 0 ? { textAlign: 'center' } : null),
    })
    expect(findNode(host, 0, 0)?.textMinX).toBe(0)
    expect(findNode(host, 0, 0)?.textMaxX).toBe(100)
  })

  it('含代理对文本：推进宽不可证回落精测，走廊判定不回归', () => {
    const { host } = createTable({
      columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      records: [{ a: '😀'.repeat(15) }], // 30 码元 → 300px（StubHost 口径）
      rowCount: 1,
    })
    expect(findNode(host, 0, 0)?.textMaxX).toBe(300)
  })
})

describe('纯纵向滚动的窗外源反查短路（P2）', () => {
  const TWENTY_COLUMNS = Array.from({ length: 20 }, (_, i) => ({ field: `f${i}` }))
  /** 40 行，行号 %3==0 的行在 col 5 放右对齐长文本（右缘窗外左溢源，走廊 [3,6) 伸入窗内） */
  const OFF_WINDOW_OPTIONS = {
    width: 548, // 48 行号列 + 5 数据列：窗口 [0,5)，col 5 在右缘窗外
    columns: TWENTY_COLUMNS,
    records: Array.from({ length: 40 }, (_, row) => (row % 3 === 0 ? { f5: LONG_TEXT } : {})),
    resolveCellStyle: (col: number) => (col === 5 ? { textAlign: 'right' as const } : null),
  } satisfies Partial<ListTableOptions>

  it('存活行窗外源保留不动；新滚入行照常反查补建；滚出随行摘除', () => {
    const { host, table } = createTable(OFF_WINDOW_OPTIONS)
    // 初建全窗行反查：行 0 与行 3（初始可见的左溢源行）的窗外源已补建
    expect(findNode(host, 5, 0)?.textMinX).toBe(-200)
    expect(findNode(host, 3, 0)?.corridorInterior).toBe(6)
    expect(findNode(host, 5, 3)?.textMinX).toBe(-200)
    // 纵向滚动（列窗不动）：行 0 半出仍存活，其窗外源与走廊标记原样保留；
    // 滚入的行 18（左溢源行）照常反查补建自己的窗外源
    table.scrollTo(0, 16)
    expect(findNode(host, 5, 0)?.textMinX).toBe(-200)
    expect(findNode(host, 3, 0)?.corridorInterior).toBe(6)
    expect(findNode(host, 5, 18)?.textMinX).toBe(-200)
    expect(findNode(host, 3, 18)?.corridorInterior).toBe(6)
    // 继续纵向滚动：行 0 滚出随行摘除，行 3 存活期间窗外源不动
    table.scrollTo(0, 96)
    expect(findNode(host, 5, 0)).toBeUndefined()
    expect(findNode(host, 5, 3)?.textMinX).toBe(-200)
    expect(findNode(host, 3, 3)?.corridorInterior).toBe(6)
  })
})

describe('窗外溢出源可见性（P1 窗缘反查）', () => {
  const TWENTY_COLUMNS = Array.from({ length: 20 }, (_, i) => ({ field: `f${i}` }))

  /** body root 中指定行的数据格列号（按树序） */
  function rowOrder(host: StubHost, row: number): number[] {
    const root = host.layers.get('body')!.root
    return root.children
      .filter(
        (child): child is CellNode =>
          child instanceof CellNode && child.row === row && child.col >= 0,
      )
      .map((child) => child.col)
  }

  /** paintTree 绘制流的 fillText（层坐标）：回放 save/restore/translate 折算绝对位置 */
  function paintedTexts(host: StubHost): Array<{ text: string; x: number; y: number }> {
    const ctx = new RecordingContext()
    paintTreeForTest(host.layers.get('body')!.root, ctx)
    const stack: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }]
    const texts: Array<{ text: string; x: number; y: number }> = []
    for (const call of ctx.calls) {
      if (call.name === 'save') {
        stack.push({ ...stack[stack.length - 1]! })
      } else if (call.name === 'restore') {
        stack.pop()
      } else if (call.name === 'translate') {
        const top = stack[stack.length - 1]!
        top.x += call.args[0] as number
        top.y += call.args[1] as number
      } else if (call.name === 'fillText') {
        const top = stack[stack.length - 1]!
        texts.push({
          text: call.args[0] as string,
          x: top.x + (call.args[1] as number),
          y: top.y + (call.args[2] as number),
        })
      }
    }
    return texts
  }

  it('右溢源从左缘滚出：保留并原地平移，绘制指令仍覆盖窗内走廊段', () => {
    const { host, table } = createTable({
      columns: TWENTY_COLUMNS,
      records: [{ f0: LONG_TEXT }],
      rowCount: 1,
    })
    expect(findNode(host, 0, 0)?.textMaxX).toBe(300) // 走廊 [0,3)
    table.scrollTo(150, 0) // 窗口 [0,8) → [1,10)：col 0 完全滚出左缘
    expect(table.cols).toEqual({ start: 1, end: 10 })
    const source = findNode(host, 0, 0)
    expect(source).toBeDefined()
    // 走廊仍与可视列窗相交 → 保留，x/y 随滚动帧原地平移
    expect(source!.x).toBe(-102)
    expect(source!.y).toBe(36)
    // 同一段文本、同一锚点：局部走廊界不随滚动变化
    expect(source!.textMaxX).toBe(300)
    expect(source!.textMinX).toBe(0)
    const localCtx = new MeasureStubContext()
    source!.paint(localCtx)
    expect(localCtx.clips).toEqual([{ x: 0, y: 0, width: 300, height: 32 }])
    // 绘制指令覆盖窗内走廊段（层坐标文本 [-94, 106)，锚点仍在源格内容盒左缘）
    expect(paintedTexts(host)).toContainEqual({ text: LONG_TEXT, x: -94, y: 56 })
    // z 序不变量：窗外源后画于窗内走廊格、表头容器之下
    const order = rowOrder(host, 0)
    expect(order.indexOf(0)).toBeGreaterThan(order.indexOf(1))
    expect(order.indexOf(0)).toBeGreaterThan(order.indexOf(2))
    const root = host.layers.get('body')!.root
    expect(root.children.indexOf(source!)).toBeLessThan(root.children.length - 2)
    // 走廊内部标记覆盖窗外源走廊
    expect(findNode(host, 1, 0)?.corridorInterior).toBe(3)
    expect(findNode(host, 2, 0)?.corridorInterior).toBe(3)
    expect(findNode(host, 3, 0)?.corridorInterior).toBeNull()
    // 绘制边界纳入文本缘（cull 判定输入）：自身包围盒在窗外时走廊段不被脏区剔除
    expect(source!.paintedBounds()).toEqual({ x: 0, y: 0, width: 300, height: 32 })
  })

  it('走廊完全滚出后窗外源节点被摘除；滚回时窗缘反查补建（增量）', () => {
    const { host, table } = createTable({
      columns: TWENTY_COLUMNS,
      records: [{ f0: LONG_TEXT }],
      rowCount: 1,
    })
    table.scrollTo(300, 0) // 窗口 [3,11)：走廊 [0,3) 完全滚出左缘
    expect(findNode(host, 0, 0)).toBeUndefined()
    table.scrollTo(150, 0) // [1,10)：col 1、2 滚入，左缘反查命中窗外源 col 0
    const source = findNode(host, 0, 0)
    expect(source).toBeDefined()
    expect(source!.textMaxX).toBe(300)
    expect(source!.x).toBe(-102)
    // 补建源随行内规范重挂：后画于窗内走廊格
    const order = rowOrder(host, 0)
    expect(order.indexOf(0)).toBeGreaterThan(order.indexOf(1))
    expect(order.indexOf(0)).toBeGreaterThan(order.indexOf(2))
  })

  it('全量重建同样反查补建窗外源；走廊完全滚出时不补建', () => {
    const { host, table } = createTable({
      columns: TWENTY_COLUMNS,
      records: [{ f0: LONG_TEXT }],
      rowCount: 1,
    })
    table.scrollTo(150, 0)
    table.setColWidth(5, 100) // 几何变更 → 当前滚动位置全量重建
    expect(findNode(host, 0, 0)?.textMaxX).toBe(300)
    table.scrollTo(300, 0) // 走廊 [0,3) 完全滚出（窗口 [3,11)）
    table.setColWidth(5, 100)
    expect(findNode(host, 0, 0)).toBeUndefined()
  })

  it('左溢源在右缘窗外：装配反查补建，走廊滚出后摘除、滚回重建', () => {
    const { host, table } = createTable({
      width: 548, // 48 行号列 + 5 数据列：窗口 [0,5)，col 5 在右缘窗外
      columns: TWENTY_COLUMNS,
      records: [{ f5: LONG_TEXT }],
      rowCount: 1,
      resolveCellStyle: (col) => (col === 5 ? { textAlign: 'right' } : null),
    })
    const source = findNode(host, 5, 0)
    expect(source).toBeDefined()
    expect(source!.x).toBe(548)
    // 左溢走廊 [3,6)：局部界 [-200, 100)，锚点仍在源格
    expect(source!.textMinX).toBe(-200)
    expect(source!.textMaxX).toBe(100)
    expect(source!.paintedBounds()).toEqual({ x: -200, y: 0, width: 300, height: 32 })
    // 走廊内部标记覆盖窗外源走廊伸入窗内的 col 3、4
    expect(findNode(host, 3, 0)?.corridorInterior).toBe(6)
    expect(findNode(host, 4, 0)?.corridorInterior).toBe(6)
    expect(findNode(host, 2, 0)?.corridorInterior).toBeNull()
    // 绘制指令伸入窗内走廊段（局部 clip [-200, 100)，层坐标锚点 440）
    const localCtx = new MeasureStubContext()
    source!.paint(localCtx)
    expect(localCtx.clips).toEqual([{ x: -200, y: 0, width: 300, height: 32 }])
    expect(paintedTexts(host)).toContainEqual({ text: LONG_TEXT, x: 440, y: 56 })
    // 走廊 [3,6) 完全滚出（窗口 [6,11)）→ 摘除且不反查重建
    table.scrollTo(600, 0)
    expect(findNode(host, 5, 0)).toBeUndefined()
    // 滚回窗口 [0,5)：右缘反查命中窗外左溢源 → 重建
    table.scrollTo(0, 0)
    expect(findNode(host, 5, 0)?.textMinX).toBe(-200)
  })

  it('窗外源走廊竖线跳画与同滚动位置的全量重建一致', () => {
    const records = [{ f0: LONG_TEXT }]
    const scrolled = createTable({ columns: TWENTY_COLUMNS, records, rowCount: 1 })
    scrolled.table.scrollTo(150, 0)
    const rebuilt = createTable({ columns: TWENTY_COLUMNS, records, rowCount: 1 })
    rebuilt.table.scrollTo(150, 0)
    rebuilt.table.setColWidth(5, 100) // 同滚动位置全量重建
    expect(findNode(scrolled.host, 1, 0)?.corridorInterior).toBe(3)
    expect(rowVerticalLineXs(scrolled.host, 0)).toEqual(rowVerticalLineXs(rebuilt.host, 0))
  })

  it('refreshCell 修改窗外源文本：窗内走廊段按新走廊收敛（文本与失效区）', () => {
    const model = new EchoModel(1)
    model.data.set('0:0', LONG_TEXT)
    const { host, table } = createTable({ columns: TWENTY_COLUMNS, rowCount: 1, model })
    table.scrollTo(150, 0) // col 0 滚出左缘（走廊 [0,3) 仍相交 → 保留）
    expect(findNode(host, 0, 0)).toBeDefined()
    host.submitted.length = 0
    model.data.set('0:0', 'B'.repeat(30)) // 300px：走廊伸至 [0,4)
    model.emit({ col: 0, row: 0, oldValue: LONG_TEXT, newValue: 'B'.repeat(30) })
    const source = findNode(host, 0, 0)
    expect(source?.text).toBe('B'.repeat(30))
    expect(source?.textMaxX).toBe(400)
    expect(findNode(host, 1, 0)?.corridorInterior).toBe(4)
    expect(findNode(host, 3, 0)?.corridorInterior).toBe(4)
    expect(findNode(host, 4, 0)?.corridorInterior).toBeNull()
    // 失效区覆盖窗内走廊段（新走廊末端层坐标 298 = 48 + 400 - 150）
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: -102, y: 36, width: 400, height: 32 } } },
    ])
  })

  it('refreshCell 阻断窗外源走廊：窗内段与标记收敛回新走廊', () => {
    const model = new EchoModel(1)
    model.data.set('0:0', LONG_TEXT)
    const { host, table } = createTable({ columns: TWENTY_COLUMNS, rowCount: 1, model })
    table.scrollTo(150, 0)
    host.submitted.length = 0
    model.data.set('2:0', 'x')
    model.emit({ col: 2, row: 0, oldValue: undefined, newValue: 'x' })
    // 走廊收回 [0,2)；失效区并集覆盖旧走廊（至层坐标 198，宽度 300）
    expect(findNode(host, 0, 0)?.textMaxX).toBe(200)
    expect(findNode(host, 1, 0)?.corridorInterior).toBe(2)
    expect(findNode(host, 2, 0)?.corridorInterior).toBeNull()
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: -102, y: 36, width: 300, height: 32 } } },
    ])
  })

  it('refreshCell 清空窗内阻断格：窗外源反查补建并即时上屏；非候选窗外格不建节点', () => {
    const model = new EchoModel(1)
    model.data.set('0:0', LONG_TEXT)
    model.data.set('2:0', 'x')
    const { host, table } = createTable({ columns: TWENTY_COLUMNS, rowCount: 1, model })
    table.scrollTo(250, 0) // 窗口 [2,11)：col 0 走廊 [0,2) 完全滚出 → 未建
    expect(findNode(host, 0, 0)).toBeUndefined()
    host.submitted.length = 0
    model.data.delete('2:0')
    model.emit({ col: 2, row: 0, oldValue: 'x', newValue: undefined })
    // 左缘反查命中窗外源 col 0（走廊伸至 [0,3)）→ 补建，窗内走廊段即时上屏
    const source = findNode(host, 0, 0)
    expect(source).toBeDefined()
    expect(source?.textMaxX).toBe(300)
    expect(findNode(host, 2, 0)?.corridorInterior).toBe(3)
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: -202, y: 36, width: 300, height: 32 } } },
    ])
    // 非候选窗外格（走廊够不到窗内）刷新维持「无节点可刷」、零失效提交
    host.submitted.length = 0
    model.data.set('15:0', 'x')
    model.emit({ col: 15, row: 0, oldValue: undefined, newValue: 'x' })
    expect(findNode(host, 15, 0)).toBeUndefined()
    expect(host.submitted).toEqual([])
  })

  it('refreshCell 写入窗外走廊格：已保留窗外源走廊收敛（返工 B3）', () => {
    const model = new EchoModel(1)
    model.data.set('0:0', LONG_TEXT)
    const { host, table } = createTable({ columns: TWENTY_COLUMNS, rowCount: 1, model })
    table.scrollTo(250, 0) // 窗口 [2,11)：col 0 走廊 [0,3) 仍相交 → 保留
    expect(findNode(host, 0, 0)?.textMaxX).toBe(300)
    expect(findNode(host, 2, 0)?.corridorInterior).toBe(3)
    host.submitted.length = 0
    // 写入源与窗缘之间的窗外空格 col 1（无节点）：右溢源走廊被截断，窗内段同帧收敛
    model.data.set('1:0', 'x')
    model.emit({ col: 1, row: 0, oldValue: undefined, newValue: 'x' })
    expect(findNode(host, 1, 0)).toBeUndefined() // 写入格非溢出源，不补建
    expect(findNode(host, 0, 0)?.textMaxX).toBe(100) // 走廊收回 [0,1)
    expect(findNode(host, 2, 0)?.corridorInterior).toBeNull()
    // 失效区并集覆盖旧走廊窗内段（至层坐标 98 = col 2 右缘）
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: -202, y: 36, width: 300, height: 32 } } },
    ])
  })

  it('refreshCell 写入右缘窗外走廊格：已保留左溢源对称收敛（返工 B3）', () => {
    const model = new EchoModel(1)
    model.data.set('7:0', 'B'.repeat(39)) // 390px：左溢走廊 [4,8) 伸入窗口 [0,5)
    const { host } = createTable({
      width: 548, // 48 行号列 + 5 数据列：窗口 [0,5)，col 5、6 在右缘窗外
      columns: TWENTY_COLUMNS,
      rowCount: 1,
      model,
      resolveCellStyle: (col) => (col === 7 ? { textAlign: 'right' } : null),
    })
    const source = findNode(host, 7, 0)
    expect(source?.textMinX).toBe(-300)
    expect(findNode(host, 4, 0)?.corridorInterior).toBe(8)
    host.submitted.length = 0
    // 写入源与窗缘之间的窗外空格 col 6（无节点）：左溢源走廊被截断
    model.data.set('6:0', 'x')
    model.emit({ col: 6, row: 0, oldValue: undefined, newValue: 'x' })
    expect(findNode(host, 6, 0)).toBeUndefined()
    expect(source?.textMinX).toBe(0) // 走廊收回 [7,8)，源格不再溢出
    expect(source?.textMaxX).toBe(100)
    expect(findNode(host, 4, 0)?.corridorInterior).toBeNull()
    // 失效区并集覆盖旧走廊（层坐标 [448, 848)）
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 448, y: 36, width: 400, height: 32 } } },
    ])
  })
})
