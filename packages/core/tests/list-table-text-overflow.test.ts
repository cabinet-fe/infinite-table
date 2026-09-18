import type { RenderContext } from '@infinite-table/render'
import { describe, expect, it } from 'vitest'

import { CellNode } from '../src/cell-node'
import { ListTable } from '../src/list-table'
import { findCellNode } from './testing/find-cell-node'
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
