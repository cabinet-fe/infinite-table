// 行列头高亮（S9-P3 覆盖语义）：选区段（合并盒扩展后）覆盖的行号格与列头格以
// theme.interaction.headerHighlight 高亮——框选多格时两轴表头点亮整个覆盖区间
// 而非仅焦点行列（对齐 Excel/WPS）；整行/整列选区不跨轴点亮对侧表头；
// appendCell 建格装配与 applyHeaderHighlight 选区变化重涂两条路径观感一致；
// 表头高亮重绘只登记表头条带 band 失效，不产生 body band/full。
// S8-P3：高亮背景以 token 与表头分区铬底预混的不透明色落格（style.background
// 即绘制 fillStyle，见 cell-node.ts），半透明 token 下其下滑入内容不再透出。

import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import { opaqueHeaderHighlight } from '../src/theme'
import type { ListTableOptions } from '../src/types'
import { findCellNode } from './testing/find-cell-node'
import { StubHost } from './testing/stub-host'

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  rowHeight: 32,
  headerHeight: 36,
  rowHeaderWidth: 48,
  defaultColWidth: 100,
  columns: Array.from({ length: 10 }, (_, i) => ({ field: 'name', title: `C${i}` })),
} satisfies Partial<ListTableOptions>

const RECORDS = Array.from({ length: 8 }, (_, i) => ({ name: `v${i}` }))

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, records: RECORDS, host, ...extra })
  host.submitted.length = 0
  return { host, table }
}

/** 高亮列头生效背景：token 与列头铬底（header.background）预混的不透明色 */
const colHighlightOf = (table: ListTable) =>
  opaqueHeaderHighlight(table.theme.interaction.headerHighlight, table.theme.header.background)

/** 高亮行号格生效背景：token 与行号列铬底（rowHeader.background）预混的不透明色 */
const rowHighlightOf = (table: ListTable) =>
  opaqueHeaderHighlight(table.theme.interaction.headerHighlight, table.theme.rowHeader.background)

/** 表头格节点：列头为 (col, -1)、行号格为 (-1, row)（递归查找：表头节点在表头容器内） */
function headerNode(host: StubHost, col: number, row: number) {
  const body = host.layers.get('body')
  return body ? findCellNode(body.root, col, row) : undefined
}

const colHeaderBg = (host: StubHost, col: number) => headerNode(host, col, -1)?.style.background
const rowHeaderBg = (host: StubHost, row: number) => headerNode(host, -1, row)?.style.background

describe('行列头高亮覆盖选区（S9-P3）', () => {
  it('appendCell 建格路径：选中单格后几何变更重建场景，覆盖行列头带高亮', () => {
    const { host, table } = createTable()
    const colHl = colHighlightOf(table)
    const rowHl = rowHighlightOf(table)
    table.selectCell(2, 3)
    // 几何变更 → 场景全量重建（appendCell 建格装配按当前选区点亮）
    table.setColWidth(0, 120)
    expect(colHeaderBg(host, 2)).toBe(colHl)
    expect(rowHeaderBg(host, 3)).toBe(rowHl)
    // 非焦点格的行列头不高亮
    expect(colHeaderBg(host, 3)).not.toBe(colHl)
    expect(rowHeaderBg(host, 2)).not.toBe(rowHl)
  })

  it('applyHeaderHighlight 重涂路径：焦点移动高亮随动、原格恢复', () => {
    const { host, table } = createTable()
    const colHl = colHighlightOf(table)
    const rowHl = rowHighlightOf(table)
    table.selectCell(2, 3)
    expect(colHeaderBg(host, 2)).toBe(colHl)
    expect(rowHeaderBg(host, 3)).toBe(rowHl)
    // 未高亮表头格的常态背景（恢复断言口径）
    const normalColBg = colHeaderBg(host, 4)
    const normalRowBg = rowHeaderBg(host, 4)
    table.selectCell(5, 1)
    expect(colHeaderBg(host, 5)).toBe(colHl)
    expect(rowHeaderBg(host, 1)).toBe(rowHl)
    expect(colHeaderBg(host, 2)).toBe(normalColBg)
    expect(rowHeaderBg(host, 3)).toBe(normalRowBg)
  })

  it('框选多格：两轴表头点亮整个覆盖区间（非仅焦点格行列）', () => {
    const { host, table } = createTable()
    const colHl = colHighlightOf(table)
    const rowHl = rowHighlightOf(table)
    // 覆盖 C2..E5（cols 2-4 × rows 2-4）的拖选段
    table.selectCells([{ start: { col: 2, row: 2 }, end: { col: 4, row: 4 } }])
    for (const col of [2, 3, 4]) {
      expect(colHeaderBg(host, col)).toBe(colHl)
    }
    for (const row of [2, 3, 4]) {
      expect(rowHeaderBg(host, row)).toBe(rowHl)
    }
    // 覆盖区间外的表头不高亮
    expect(colHeaderBg(host, 1)).not.toBe(colHl)
    expect(colHeaderBg(host, 5)).not.toBe(colHl)
    expect(rowHeaderBg(host, 1)).not.toBe(rowHl)
    expect(rowHeaderBg(host, 5)).not.toBe(rowHl)
  })

  it('多段选区覆盖区间取并集点亮', () => {
    const { host, table } = createTable()
    const colHl = colHighlightOf(table)
    const rowHl = rowHighlightOf(table)
    table.selectCells([
      { start: { col: 0, row: 0 }, end: { col: 1, row: 1 } },
      { start: { col: 4, row: 5 }, end: { col: 6, row: 7 } },
    ])
    for (const col of [0, 1, 4, 5, 6]) {
      expect(colHeaderBg(host, col)).toBe(colHl)
    }
    for (const row of [0, 1, 5, 6, 7]) {
      expect(rowHeaderBg(host, row)).toBe(rowHl)
    }
    // 两段之间的空档不高亮
    expect(colHeaderBg(host, 3)).not.toBe(colHl)
    expect(rowHeaderBg(host, 3)).not.toBe(rowHl)
  })

  it('合并区按整块点亮：覆盖格选段扩展到整块合并盒，重涂与建格两条路径一致', () => {
    const merges = [{ startCol: 1, startRow: 1, endCol: 2, endRow: 2 }]
    const { host, table } = createTable({ mergeCells: merges })
    const colHl = colHighlightOf(table)
    const rowHl = rowHighlightOf(table)
    // 程序化选中落在合并区覆盖格 (2,2)：段边界扩展到整块合并盒 (1,1)-(2,2)，
    // 覆盖到的列头 1/2 与行号 1/2 全部点亮（Excel 语义）
    table.selectCell(2, 2)
    expect(colHeaderBg(host, 1)).toBe(colHl)
    expect(colHeaderBg(host, 2)).toBe(colHl)
    expect(rowHeaderBg(host, 1)).toBe(rowHl)
    expect(rowHeaderBg(host, 2)).toBe(rowHl)
    expect(colHeaderBg(host, 0)).not.toBe(colHl)
    expect(rowHeaderBg(host, 0)).not.toBe(rowHl)
    // 建格路径（几何变更重建）同口径
    table.setColWidth(0, 120)
    expect(colHeaderBg(host, 1)).toBe(colHl)
    expect(colHeaderBg(host, 2)).toBe(colHl)
    expect(rowHeaderBg(host, 1)).toBe(rowHl)
    expect(rowHeaderBg(host, 2)).toBe(rowHl)
  })

  it('失效登记：表头高亮重绘只提交 body band 且落在表头条带内，无 body full', () => {
    const { host, table } = createTable()
    table.selectCell(2, 3)
    const bodyInvs = host.submitted
      .filter((entry) => entry.kind === 'body')
      .map((entry) => entry.inv)
    expect(bodyInvs.length).toBeGreaterThan(0)
    expect(bodyInvs.some((inv) => inv.type !== 'band')).toBe(false)
    // 表头条带：列头带（y 在表头高度内）或行号列带（x 在行号列宽内），不跨数据区
    const regions = bodyInvs.map((inv) => (inv.type === 'band' ? inv.region : null))
    const allInHeaderStrip = regions.every(
      (region) =>
        region !== null && (region.y < table.headerHeight || region.x < table.rowHeaderWidth),
    )
    expect(allInHeaderStrip).toBe(true)
    expect(host.submitted.some((entry) => entry.kind === 'body' && entry.inv.type === 'full')).toBe(
      false,
    )
  })

  it('整行选择：行号带点亮、列头不跨轴点亮（整轴不回退）', () => {
    const { host, table } = createTable()
    const rowHl = rowHighlightOf(table)
    const colHl = colHighlightOf(table)
    table.selectRow(3)
    expect(rowHeaderBg(host, 3)).toBe(rowHl)
    expect(rowHeaderBg(host, 4)).not.toBe(rowHl)
    expect(colHeaderBg(host, 0)).not.toBe(colHl)
    expect(colHeaderBg(host, 6)).not.toBe(colHl)
  })

  it('整列选择：列头带点亮、行号不跨轴点亮（整轴不回退）', () => {
    const { host, table } = createTable()
    const colHl = colHighlightOf(table)
    const rowHl = rowHighlightOf(table)
    table.selectCol(2)
    expect(colHeaderBg(host, 2)).toBe(colHl)
    expect(colHeaderBg(host, 3)).not.toBe(colHl)
    expect(rowHeaderBg(host, 0)).not.toBe(rowHl)
    expect(rowHeaderBg(host, 7)).not.toBe(rowHl)
  })

  it('全选：列头与行号带全部点亮（整轴不回退）', () => {
    const { table } = createTable()
    const colHl = colHighlightOf(table)
    const rowHl = rowHighlightOf(table)
    table.selectAll()
    expect(table.colHeaderNodes.size).toBeGreaterThan(0)
    expect(table.rowHeaderNodes.size).toBeGreaterThan(0)
    for (const node of table.colHeaderNodes.values()) {
      expect(node.style.background).toBe(colHl)
    }
    for (const node of table.rowHeaderNodes.values()) {
      expect(node.style.background).toBe(rowHl)
    }
  })
})

describe('拖选回写稳定性（焦点摆动不抖动）', () => {
  it('拖选中外部回写锚点焦点：覆盖区间高亮不动，且零重涂（无 body 失效提交）', () => {
    const { host, table } = createTable()
    const colHl = colHighlightOf(table)
    const rowHl = rowHighlightOf(table)
    // 交互拖选会话：按下 C3（col2,row2）拖到 E6（col4,row5）——引擎焦点随移动端点
    table.selection.beginDragRange({ col: 2, row: 2 }, { col: 2, row: 2 })
    table.selection.updateDragRange({ col: 2, row: 2 }, { col: 4, row: 5 })
    for (const col of [2, 3, 4]) {
      expect(colHeaderBg(host, col)).toBe(colHl)
    }
    for (const row of [2, 3, 4, 5]) {
      expect(rowHeaderBg(host, row)).toBe(rowHl)
    }
    // sheet 适配层回写（GridSelectionController.pushSelectionToTable 语义）：
    // 段归一化 + 焦点回落锚点——旧实现（高亮跟焦点格行列）在此摆动间重涂收缩，
    // 即下游「选区时行列头高亮抖动」；覆盖语义下高亮不动且不触发任何重涂
    host.submitted.length = 0
    table.applyExternalSelection({
      ranges: [{ start: { col: 2, row: 2 }, end: { col: 4, row: 5 } }],
      focus: { col: 2, row: 2 },
    })
    for (const col of [2, 3, 4]) {
      expect(colHeaderBg(host, col)).toBe(colHl)
    }
    for (const row of [2, 3, 4, 5]) {
      expect(rowHeaderBg(host, row)).toBe(rowHl)
    }
    expect(host.submitted.some((entry) => entry.kind === 'body')).toBe(false)
  })

  it('抬手后宿主回写仅移动焦点（段不变）：高亮保持且零重涂', () => {
    const { host, table } = createTable()
    const colHl = colHighlightOf(table)
    table.selectCells([{ start: { col: 2, row: 2 }, end: { col: 4, row: 5 } }])
    host.submitted.length = 0
    table.applyExternalSelection({
      ranges: [{ start: { col: 2, row: 2 }, end: { col: 4, row: 5 } }],
      focus: { col: 3, row: 4 },
    })
    for (const col of [2, 3, 4]) {
      expect(colHeaderBg(host, col)).toBe(colHl)
    }
    expect(host.submitted.some((entry) => entry.kind === 'body')).toBe(false)
  })
})

describe('表头高亮不透明合成（S8-P3）', () => {
  /** ultra-ui 现场形态：半透明高亮 token + 双分区异色铬底（每用例新建，避免串状态） */
  const TRANSPARENT_TOKEN = 'rgba(33, 112, 231, 0.1)'
  const coloredTable = () =>
    createTable({
      theme: {
        header: { background: '#f5f6f7' },
        rowHeader: { background: '#eef0f3' },
        interaction: { headerHighlight: TRANSPARENT_TOKEN },
      },
    })

  it('半透明 token：高亮表头格生效背景不透明且等于预混结果（style.background 即绘制 fillStyle）', () => {
    const { host, table } = coloredTable()
    table.selectCell(2, 3)
    // 期望值按 alpha 合成独立手算：0.1×token + 0.9×铬底，四舍五入
    // 列头铬底 #f5f6f7=(245,246,247) → (224,233,245)；行号铬底 #eef0f3=(238,240,243) → (218,227,242)
    expect(colHeaderBg(host, 2)).toBe('rgb(224, 233, 245)')
    expect(rowHeaderBg(host, 3)).toBe('rgb(218, 227, 242)')
    // rgb() 形态即无 alpha 通道：其下滚入内容不再透出
    expect(colHeaderBg(host, 2)).not.toBe(TRANSPARENT_TOKEN)
  })

  it('半透明 token：建格与重涂两条路径合成一致，原格恢复铬底', () => {
    const { host, table } = coloredTable()
    table.selectCell(2, 3)
    const colHl = colHeaderBg(host, 2)
    const rowHl = rowHeaderBg(host, 3)
    table.selectCell(5, 1)
    // 重涂路径（applyHeaderHighlight）同预混口径
    expect(colHeaderBg(host, 5)).toBe(colHl)
    expect(rowHeaderBg(host, 1)).toBe(rowHl)
    // 无高亮格铬底不变
    expect(colHeaderBg(host, 2)).toBe('#f5f6f7')
    expect(rowHeaderBg(host, 3)).toBe('#eef0f3')
    // 建格路径（几何变更重建）同口径
    table.setColWidth(0, 120)
    expect(colHeaderBg(host, 5)).toBe(colHl)
    expect(rowHeaderBg(host, 1)).toBe(rowHl)
  })

  it('不透明 token：行为不变，生效背景等于原值', () => {
    const token = '#2e6adb'
    const { host, table } = createTable({
      theme: {
        header: { background: '#f5f6f7' },
        rowHeader: { background: '#eef0f3' },
        interaction: { headerHighlight: token },
      },
    })
    table.selectCell(2, 3)
    expect(colHeaderBg(host, 2)).toBe(token)
    expect(rowHeaderBg(host, 3)).toBe(token)
    // alpha=1 的 rgba() 串同样原值透传
    const rgbaToken = 'rgba(46, 106, 219, 1)'
    const alpha1 = createTable({
      theme: { interaction: { headerHighlight: rgbaToken } },
    })
    alpha1.table.selectCell(0, 0)
    expect(colHeaderBg(alpha1.host, 0)).toBe(rgbaToken)
    expect(rowHeaderBg(alpha1.host, 0)).toBe(rgbaToken)
  })

  it('无高亮：表头铬底不受合成影响', () => {
    const { host, table } = coloredTable()
    expect(colHeaderBg(host, 2)).toBe('#f5f6f7')
    expect(rowHeaderBg(host, 3)).toBe('#eef0f3')
    table.selectCell(2, 3)
    expect(colHeaderBg(host, 4)).toBe('#f5f6f7')
    expect(rowHeaderBg(host, 4)).toBe('#eef0f3')
  })
})
