// 引擎装配协议契约测试（P7）：ListTable 实现满足协议（中立本体 EngineAssembly +
// 表格引擎协议面 TableEngine）——数据面（TableModel 形态）、渲染宿主、主题、生命周期、
// painter 槽位（underlay/overlay）、插件槽位、导出读取面（有效数据/样式/几何/合并区）。
// 挂载参数只依赖协议面（G2/G21：插件槽位不绑定具体事件类型/引擎具体类型）；
// 合并区以几何区间语言进读取面而非协议本体（G17）。

import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import type { EngineAssembly, TableEngine } from '../src/engine'
import type { TablePlugin } from '../src/plugin'
import type { CellChangeEvent, TableModel } from '../src/types'
import { StubHost } from './testing/stub-host'

function createTable(options: Partial<ConstructorParameters<typeof ListTable>[0]> = {}): {
  host: StubHost
  table: ListTable
} {
  const host = new StubHost()
  const table = new ListTable({
    width: 400,
    height: 200,
    columns: [
      { field: 'a', title: 'a', width: 100 },
      { field: 'b', title: 'b', width: 120 },
    ],
    records: [
      { a: 'a0', b: 'b0' },
      { a: 'a1', b: 'b1' },
    ],
    host,
    ...options,
  })
  return { host, table }
}

describe('引擎装配协议契约（table 实现）', () => {
  it('ListTable 实例同时满足中立本体与表格协议面（结构类型即契约）', () => {
    const { table } = createTable()
    // 编译期：两个协议面均可承接；运行期：同一实例
    const assembly: EngineAssembly = table
    const face: TableEngine = table
    expect(assembly).toBe(table)
    expect(face.host).toBe(table.host)
    table.destroy()
  })

  it('数据面：rowCount / getCellValue / onCellChange 变更通知（TableModel 形态）', () => {
    const changes: CellChangeEvent[] = []
    const { table } = createTable()
    table.onCellChange((change) => changes.push(change))
    expect(table.rowCount).toBe(2)
    // 原始值口径（records 字段值，未经显示链）
    expect(table.getCellValue(0, 0)).toBe('a0')
    expect(table.getCellValue(1, 1)).toBe('b1')
    table.destroy()

    // 模型形态回驱（数据面 setCellValue 对应物）：updateCell 经绑定回写，取值随模型
    const cells = new Map<string, unknown>([['0,0', 'x']])
    const model: TableModel = {
      rowCount: 2,
      getCellValue: (col, row) => cells.get(`${col},${row}`),
      setCellValue: (col, row, value) => cells.set(`${col},${row}`, value),
      onCellChange: () => () => {},
    }
    const withModel = createTable({ records: undefined, model })
    expect(withModel.table.getCellValue(0, 0)).toBe('x')
    withModel.table.updateCell(0, 0, 'y')
    expect(withModel.table.getCellValue(0, 0)).toBe('y')
    expect(changes).toEqual([])
    withModel.table.destroy()
  })

  it('主题面：getTheme 读取生效主题，updateTheme 深覆盖生效（token 可配置）', () => {
    const { table } = createTable()
    const before = table.getTheme()
    expect(before.body.color).toBeTruthy()
    table.updateTheme({ body: { color: '#123456' } })
    expect(table.getTheme().body.color).toBe('#123456')
    table.destroy()
  })

  it('painter 槽位：overlay 写入触发 sky 整层失效，置 null 清屏（协议槽位语言）', () => {
    const { host, table } = createTable()
    host.submitted.length = 0
    const painter = () => {}
    table.setOverlayPainter(painter)
    expect(host.submitted).toEqual([{ kind: 'sky', inv: { type: 'full' } }])
    host.submitted.length = 0
    table.setOverlayPainter(null)
    expect(host.submitted).toEqual([{ kind: 'sky', inv: { type: 'full' } }])
    // underlay 同构（ground 层惰性创建）
    host.submitted.length = 0
    table.setUnderlayPainter(() => {})
    expect(host.submitted).toEqual([{ kind: 'ground', inv: { type: 'full' } }])
    table.destroy()
  })

  it('插件槽位：use 挂载参数为协议面（不绑定引擎具体类型与事件类型）', () => {
    const mounted: EngineAssembly[] = []
    const unmounted: EngineAssembly[] = []
    const plugin: TablePlugin = {
      name: 'contract-probe',
      mount(engine) {
        mounted.push(engine)
        // 协议面即槽位语言：经协议本体挂 overlay painter 生效
        engine.setOverlayPainter(() => {})
      },
      unmount(engine) {
        unmounted.push(engine)
      },
    }
    const { table } = createTable({ plugins: [plugin] })
    expect(mounted).toEqual([table])
    table.destroy()
    expect(unmounted).toEqual([table])
  })

  it('导出读取面（engine.read）：有效数据 / 样式 / 几何 / 合并区', () => {
    const { table } = createTable({
      resolveDisplayValue: (col, row, value) => `[${String(value)}]`,
      mergeCells: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }],
    })
    const read = table.read
    expect(read).toBeDefined()
    // 行列数与几何
    expect(read!.rowCount).toBe(2)
    expect(read!.colCount).toBe(2)
    expect(read!.getColWidth(0)).toBe(100)
    expect(read!.getRowHeight(0)).toBe(table.getTheme().rowHeight)
    // 有效显示文本（经取值管线）与原始值分离
    expect(read!.getCellText(0, 1)).toBe('[a1]')
    expect(read!.getCellValue(0, 1)).toBe('a1')
    // 被合并覆盖格路由主格
    expect(read!.getCellText(1, 0)).toBe('[a0]')
    // 有效样式（主题投影链产物）
    expect(read!.getCellStyle(0, 1)).toEqual(table.getCellStyle(0, 1))
    // 合并区（几何区间语言，非协议本体成员）
    expect(read!.getMergeRanges()).toEqual([{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }])
    table.destroy()
  })

  it('数据面 G11 扩展位：纯 hook 形态（rowCount 兜底 + 按格供给）不依赖模型/records', () => {
    const { table } = createTable({
      records: undefined,
      rowCount: 5,
      resolveDisplayValue: (col, row) => `hook:${col}-${row}`,
    })
    expect(table.rowCount).toBe(5)
    expect(table.getCellText(0, 4)).toBe('hook:0-4')
    expect(table.read!.getCellText(0, 4)).toBe('hook:0-4')
    table.destroy()
  })
})
