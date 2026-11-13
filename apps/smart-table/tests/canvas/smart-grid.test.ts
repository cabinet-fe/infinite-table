// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import type { RenderContext } from '@infinitable/render'

import {
  SmartGridAdapter,
  formatSmartCellDisplayValue,
  formatSmartColumnTitle,
} from '../../src/canvas/smart-grid'
import type { LookupConflictInfo, SmartColumn, SmartRecord } from '../../src/shared/schema'
import type { SmartGridConflictClickInfo } from '../../src/canvas/smart-grid'

function createMockRenderContext(): {
  ctx: RenderContext
  texts: string[]
  arcs: number
  fills: number
} {
  const texts: string[] = []
  let arcs = 0
  let fills = 0
  const ctx: RenderContext = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '12px sans-serif',
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    translate: () => {},
    beginPath: () => {},
    rect: () => {},
    moveTo: () => {},
    lineTo: () => {},
    bezierCurveTo: () => {},
    quadraticCurveTo: () => {},
    arc: () => {
      arcs++
    },
    closePath: () => {},
    stroke: () => {},
    fill: () => {
      fills++
    },
    clip: () => {},
    clearRect: () => {},
    fillRect: () => {},
    fillText: (text: string) => {
      texts.push(text)
    },
    drawImage: () => {},
    measureText: (text: string) => ({ width: text.length * 7 }),
  }
  return {
    ctx,
    texts,
    get arcs() {
      return arcs
    },
    get fills() {
      return fills
    },
  }
}

const BASE_COLUMNS: SmartColumn[] = [
  { key: 'code', title: '项目编号', type: 'text', width: 100, isUniqueKey: true },
  { key: 'name', title: '项目名称', type: 'text', width: 140 },
  { key: 'owner', title: '负责人', type: 'person', width: 110 },
  {
    key: 'status',
    title: '状态',
    type: 'select',
    width: 100,
    options: [
      { label: '进行中', color: '#dbeafe', textColor: '#1d4ed8' },
      { label: '已交付', color: '#dcfce7', textColor: '#15803d' },
    ],
  },
  { key: 'progress', title: '进度', type: 'progress', width: 120 },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, numberFormat: 'currency' },
  { key: 'verified', title: '已核验', type: 'checkbox', width: 80 },
  { key: 'preview', title: '架构图', type: 'image', width: 100 },
  { key: 'doc', title: '立项书', type: 'link', width: 120 },
  {
    key: 'dept',
    title: '所属部门',
    type: 'lookup',
    width: 160,
    lookupConfig: {
      groupId: 'emp_lookup',
      targetTableId: 'employees',
      matchRules: [{ sourceField: 'owner', targetField: 'name' }],
      targetReturnField: 'dept',
      mode: 'one',
    },
  },
  {
    key: 'rate',
    title: '达成率',
    type: 'formula',
    width: 100,
    numberFormat: 'percent',
    formulaExpr: '[paid] / [amount]',
  },
]

const BASE_RECORDS: SmartRecord[] = [
  {
    _id: 'rec-1',
    code: 'PRJ-001',
    name: '智能表格一期',
    owner: '张三',
    status: '进行中',
    progress: 75,
    amount: 1234.56,
    verified: false,
    preview: 'https://example.com/arch.png',
    doc: 'https://example.com/doc/1',
    dept: '研发部',
    rate: 0.852,
  },
  {
    _id: 'rec-2',
    code: 'PRJ-002',
    name: '数据分析平台',
    owner: '李四',
    status: '已交付',
    progress: 100,
    amount: 1234,
    verified: true,
    preview: '',
    doc: { url: 'https://example.com/doc/2', text: '查看文档' },
    dept: '',
    rate: 1,
  },
]

function mountGrid(overrides?: Partial<ConstructorParameters<typeof SmartGridAdapter>[0]>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const conflictMap = new Map<string, Map<string, LookupConflictInfo>>([
    [
      'rec-1',
      new Map([
        [
          'emp_lookup',
          {
            groupId: 'emp_lookup',
            targetTableId: 'employees',
            candidates: [
              { _id: 'emp-1', name: '张三', dept: '研发部' },
              { _id: 'emp-2', name: '张三', dept: '销售部' },
            ],
            isResolved: false,
            selectedRecordId: 'emp-1',
          },
        ],
      ]),
    ],
  ])
  const adapter = new SmartGridAdapter({
    container,
    columns: BASE_COLUMNS,
    records: BASE_RECORDS.map((r) => ({ ...r })),
    conflictsByRow: conflictMap,
    ...overrides,
  })
  return { container, adapter, conflictMap }
}

describe('SmartGridAdapter', () => {
  it('正确格式化列头标识与数字展示文本', () => {
    expect(formatSmartColumnTitle(BASE_COLUMNS[0]!)).toBe('🔑 项目编号')
    expect(formatSmartColumnTitle(BASE_COLUMNS[9]!)).toBe('🔗 所属部门')
    expect(formatSmartColumnTitle(BASE_COLUMNS[10]!)).toBe('ƒx 达成率')

    expect(
      formatSmartCellDisplayValue(
        { key: 'a', title: 'A', type: 'number', width: 80, numberFormat: 'currency' },
        1234,
      ),
    ).toBe('¥1,234')
    expect(
      formatSmartCellDisplayValue(
        { key: 'a', title: 'A', type: 'number', width: 80, numberFormat: 'currency' },
        1234.56,
      ),
    ).toBe('¥1,234.56')
    expect(
      formatSmartCellDisplayValue(
        { key: 'a', title: 'A', type: 'formula', width: 80, numberFormat: 'percent' },
        0.852,
      ),
    ).toBe('85.2%')
    expect(
      formatSmartCellDisplayValue(
        { key: 'a', title: 'A', type: 'number', width: 80, numberFormat: 'integer' },
        1234,
      ),
    ).toBe('1,234')
    expect(
      formatSmartCellDisplayValue(
        { key: 'a', title: 'A', type: 'number', width: 80, numberFormat: 'decimal' },
        1234.5,
      ),
    ).toBe('1,234.50')
  })

  it('挂载 canvas 并校验列头、格式化文本、图片/链接通道与富媒体渲染器', () => {
    const { container, adapter } = mountGrid()
    const table = adapter.getTable()

    expect(container.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(2)
    expect(table.columns[0]?.title).toBe('🔑 项目编号')
    expect(table.columns[9]?.title).toBe('🔗 所属部门')
    expect(table.columns[10]?.title).toBe('ƒx 达成率')

    expect(table.getCellText(5, 0)).toBe('¥1,234.56')
    expect(table.getCellText(5, 1)).toBe('¥1,234')
    expect(table.getCellText(10, 0)).toBe('85.2%')
    expect(table.getCellText(9, 1)).toBe('-')

    expect(table.options.resolveCellImage?.(7, 0)).toBe('https://example.com/arch.png')
    expect(table.options.resolveCellImage?.(7, 1)).toBeNull()
    expect(table.options.resolveCellLink?.(8, 1)).toEqual({
      url: 'https://example.com/doc/2',
      text: '查看文档',
    })

    // select / person / progress / lookup 冲突单元格均可产出自定义渲染并正常绘制
    const selectRenderer = table.options.resolveCellRenderer?.(3, 0)
    expect(selectRenderer).not.toBeNull()
    const selectSpy = createMockRenderContext()
    selectRenderer?.({
      ctx: selectSpy.ctx,
      col: 3,
      row: 0,
      width: 100,
      height: 32,
      text: '进行中',
      value: '进行中',
      style: {},
    })
    expect(selectSpy.texts).toContain('进行中')
    expect(selectSpy.fills).toBeGreaterThanOrEqual(1)

    const personRenderer = table.options.resolveCellRenderer?.(2, 0)
    const personSpy = createMockRenderContext()
    personRenderer?.({
      ctx: personSpy.ctx,
      col: 2,
      row: 0,
      width: 110,
      height: 32,
      text: '张三',
      value: '张三',
      style: {},
    })
    expect(personSpy.arcs).toBe(1)
    expect(personSpy.texts).toEqual(['三', '张三'])

    const progressRenderer = table.options.resolveCellRenderer?.(4, 0)
    const progressSpy = createMockRenderContext()
    progressRenderer?.({
      ctx: progressSpy.ctx,
      col: 4,
      row: 0,
      width: 120,
      height: 32,
      text: '75%',
      value: 75,
      style: {},
    })
    expect(progressSpy.texts).toContain('75%')
    expect(progressSpy.fills).toBe(2)

    const lookupRenderer = table.options.resolveCellRenderer?.(9, 0)
    const lookupSpy = createMockRenderContext()
    lookupRenderer?.({
      ctx: lookupSpy.ctx,
      col: 9,
      row: 0,
      width: 160,
      height: 32,
      text: '研发部',
      value: '研发部',
      style: {},
    })
    expect(lookupSpy.texts).toContain('研发部')
    expect(lookupSpy.texts).toContain('⚠️ 2条重名')

    adapter.destroy()
    expect(container.querySelectorAll('canvas').length).toBe(0)
  })

  it('setData 在列未变时原地更新数据且不重建 ListTable 实例', () => {
    const { adapter } = mountGrid()
    const initialTable = adapter.getTable()

    const nextRecords: SmartRecord[] = [
      { ...BASE_RECORDS[0]!, amount: 9999 },
      { ...BASE_RECORDS[1]! },
      { ...BASE_RECORDS[1]!, _id: 'rec-3', code: 'PRJ-003', amount: 500 },
    ]
    adapter.setData(BASE_COLUMNS, nextRecords)

    expect(adapter.getTable()).toBe(initialTable)
    expect(initialTable.rowCount).toBe(3)
    expect(initialTable.getCellText(5, 0)).toBe('¥9,999')
    expect(initialTable.getCellText(5, 2)).toBe('¥500')

    // 缩减行数也能原地生效
    adapter.setData(BASE_COLUMNS, [nextRecords[0]!])
    expect(adapter.getTable()).toBe(initialTable)
    expect(initialTable.rowCount).toBe(1)

    adapter.destroy()
  })

  it('点击 checkbox 格直接翻转布尔值并触发 onCellValueChange，拖动不误触发', () => {
    const onCellValueChange =
      vi.fn<(recordId: string, fieldKey: string, newValue: unknown) => void>()
    const { container, adapter } = mountGrid({ onCellValueChange })
    const table = adapter.getTable()
    const rect = table.getCellRelativeRect(6, 0)!
    expect(rect).not.toBeNull()

    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2

    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: cx, clientY: cy }))
    container.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy }))

    expect(table.getCellValue(6, 0)).toBe(true)
    expect(onCellValueChange).toHaveBeenCalledTimes(1)
    expect(onCellValueChange).toHaveBeenCalledWith('rec-1', 'verified', true)

    // 拖拽超过阈值不触发切换
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: cx, clientY: cy }))
    container.dispatchEvent(new MouseEvent('click', { clientX: cx + 40, clientY: cy }))
    expect(table.getCellValue(6, 0)).toBe(true)
    expect(onCellValueChange).toHaveBeenCalledTimes(1)

    adapter.destroy()
  })

  it('可编辑列提交编辑写回并触发 onCellValueChange，只读/公式/关联/图片/checkbox 不打开编辑器', () => {
    const onCellValueChange =
      vi.fn<(recordId: string, fieldKey: string, newValue: unknown) => void>()
    const { container, adapter } = mountGrid({ onCellValueChange })
    const table = adapter.getTable()

    expect(table.startEdit(6, 0)).toBe(false) // checkbox
    expect(table.startEdit(7, 0)).toBe(false) // image
    expect(table.startEdit(9, 0)).toBe(false) // lookup
    expect(table.startEdit(10, 0)).toBe(false) // formula

    expect(table.startEdit(5, 0)).toBe(true)
    const input = container.querySelector('input, textarea') as HTMLInputElement | null
    expect(input).not.toBeNull()
    input!.value = '2500'
    expect(table.commitEdit()).toBe(true)

    expect(table.getCellValue(5, 0)).toBe(2500)
    expect(table.getCellText(5, 0)).toBe('¥2,500')
    expect(onCellValueChange).toHaveBeenCalledWith('rec-1', 'amount', 2500)

    adapter.destroy()
  })

  it('点击带重名冲突角标的 lookup 单元格触发 onConflictClick', () => {
    const onConflictClick = vi.fn<(info: SmartGridConflictClickInfo) => void>()
    const { container, adapter, conflictMap } = mountGrid({ onConflictClick })
    const table = adapter.getTable()
    table.scrollToCell({ col: 9, row: 0 })
    const rect = table.getCellRelativeRect(9, 0)!
    expect(rect).not.toBeNull()

    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: cx, clientY: cy }))
    container.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy }))

    expect(onConflictClick).toHaveBeenCalledTimes(1)
    const arg = onConflictClick.mock.calls[0]?.[0]
    expect(arg?.record._id).toBe('rec-1')
    expect(arg?.column.key).toBe('dept')
    expect(arg?.conflict.candidates).toHaveLength(2)
    expect(arg?.rect).toEqual(rect)

    // 已锁定状态再点依然可弹出卡片切换锁定目标
    conflictMap.set(
      'rec-1',
      new Map([
        [
          'emp_lookup',
          {
            groupId: 'emp_lookup',
            targetTableId: 'employees',
            candidates: [
              { _id: 'emp-1', name: '张三', dept: '研发部' },
              { _id: 'emp-2', name: '张三', dept: '销售部' },
            ],
            isResolved: true,
            selectedRecordId: 'emp-2',
          },
        ],
      ]),
    )
    adapter.setData(BASE_COLUMNS, BASE_RECORDS, conflictMap)
    const resolvedRenderer = table.options.resolveCellRenderer?.(9, 0)
    const resolvedSpy = createMockRenderContext()
    resolvedRenderer?.({
      ctx: resolvedSpy.ctx,
      col: 9,
      row: 0,
      width: 160,
      height: 32,
      text: '销售部',
      value: '销售部',
      style: {},
    })
    expect(resolvedSpy.texts).toContain('✅ 已锁定')

    adapter.destroy()
  })

  it('支持行选区回调、水印开关与打印插件挂载', () => {
    const onRowSelectionChange = vi.fn<(recordIds: string[]) => void>()
    const { adapter } = mountGrid({ onRowSelectionChange })
    const table = adapter.getTable()

    table.selectCell(1, 1)
    expect(onRowSelectionChange).toHaveBeenLastCalledWith(['rec-2'])

    expect(adapter.getWatermarkPlugin().isEnabled()).toBe(false)
    adapter.setWatermark(true, '机密数据')
    expect(adapter.getWatermarkPlugin().isEnabled()).toBe(true)
    expect(adapter.getWatermarkPlugin().getConfig().text).toBe('机密数据')
    adapter.setWatermark(false)
    expect(adapter.getWatermarkPlugin().isEnabled()).toBe(false)

    expect(adapter.getPrintPlugin().paginate().length).toBeGreaterThanOrEqual(1)

    adapter.destroy()
  })
})
