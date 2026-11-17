// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import type { RenderContext } from '@infinitable/render'

import {
  SmartGridAdapter,
  formatSmartCellDisplayValue,
  formatSmartColumnTitle,
  type FooterLayout,
  type SmartGridConflictClickInfo,
  type SmartGridRichEditInfo,
} from '../../src/canvas/smart-grid'
import type { LookupConflictInfo, SmartColumn, SmartRecord } from '../../src/shared/schema'

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

  it('支持行选区回调与水印开关', () => {
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

    adapter.destroy()
  })

  it('应用现代浅灰表头/细边框主题与 38px 舒适行高，窄列冲突角标使用紧凑文案', () => {
    const { adapter } = mountGrid()
    const table = adapter.getTable()
    const theme = table.getTheme()

    expect(theme.rowHeight).toBe(38)
    expect(theme.headerHeight).toBe(38)
    expect(theme.header.background).toBe('#f7f8fa')
    expect(theme.body.borderColor).toBe('#ebedf0')
    expect(theme.interaction.selectionBorder).toBe('#3370ff')
    expect(theme.interaction.headerHighlight).toBe('#ebf1ff')
    // 填充柄关闭：不画柄也不命中，选区交互保持
    expect(table.options.fillHandle).toBe(false)

    const narrowLookupRenderer = table.options.resolveCellRenderer?.(9, 0)
    const narrowSpy = createMockRenderContext()
    narrowLookupRenderer?.({
      ctx: narrowSpy.ctx,
      col: 9,
      row: 0,
      width: 110,
      height: 38,
      text: '研发部',
      value: '研发部',
      style: {},
    })
    expect(narrowSpy.texts).toContain('研发部')
    expect(narrowSpy.texts).toContain('⚠️ 2')

    adapter.destroy()
  })

  it('onConflictClick 与 getCellViewportRect 返回视口坐标，scrollToRecord 可定位到越屏行', () => {
    const onConflictClick = vi.fn<(info: SmartGridConflictClickInfo) => void>()
    const manyRecords: SmartRecord[] = Array.from({ length: 30 }, (_, i) => ({
      ...BASE_RECORDS[0]!,
      _id: `rec-${i + 1}`,
      code: `PRJ-${i + 1}`,
    }))
    const { container, adapter } = mountGrid({
      records: manyRecords,
      onConflictClick,
    })
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 240,
      top: 80,
      right: 1040,
      bottom: 580,
      width: 800,
      height: 500,
      x: 240,
      y: 80,
      toJSON: () => ({}),
    })

    const table = adapter.getTable()
    table.scrollToCell({ col: 9, row: 0 })
    const relRect = table.getCellRelativeRect(9, 0)!
    expect(relRect).not.toBeNull()

    const clientX = 240 + relRect.x + relRect.width / 2
    const clientY = 80 + relRect.y + relRect.height / 2
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX, clientY }))
    container.dispatchEvent(new MouseEvent('click', { clientX, clientY }))

    expect(onConflictClick).toHaveBeenCalledTimes(1)
    expect(onConflictClick.mock.calls[0]?.[0].rect).toEqual({
      x: 240 + relRect.x,
      y: 80 + relRect.y,
      width: relRect.width,
      height: relRect.height,
    })
    expect(adapter.getCellViewportRect('rec-1', 'dept')).toEqual({
      x: 240 + relRect.x,
      y: 80 + relRect.y,
      width: relRect.width,
      height: relRect.height,
    })

    // 末行初始不在视口内，scrollToRecord 后可取到视口坐标
    expect(adapter.getCellViewportRect('rec-30', 'dept')).toBeNull()
    adapter.scrollToRecord('rec-30', 'dept')
    const lastRect = adapter.getCellViewportRect('rec-30', 'dept')
    expect(lastRect).not.toBeNull()
    expect(lastRect!.x).toBeGreaterThanOrEqual(240)
    expect(lastRect!.y).toBeGreaterThanOrEqual(80)

    adapter.destroy()
  })

  it('防原地变异、number/progress 校验失败回滚并触发 onValidationError，progress 夹取 [0, 100]', () => {
    const onCellValueChange =
      vi.fn<(recordId: string, fieldKey: string, newValue: unknown) => void>()
    const onValidationError = vi.fn<(message: string) => void>()
    const rawRecords = BASE_RECORDS.map((r) => ({ ...r }))
    const { container, adapter } = mountGrid({
      records: rawRecords,
      onCellValueChange,
      onValidationError,
    })
    const table = adapter.getTable()

    // number 列输入非法数字字符串：拒绝修改、恢复旧值并提示错误
    expect(table.startEdit(5, 0)).toBe(true)
    const numInput = container.querySelector('input, textarea') as HTMLInputElement
    numInput.value = 'abc'
    expect(table.commitEdit()).toBe(true)
    expect(onValidationError).toHaveBeenCalledWith('请输入有效数值')
    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(table.getCellValue(5, 0)).toBe(1234.56)
    expect(rawRecords[0]?.amount).toBe(1234.56)

    // progress 列输入超界数值：自动夹取到 [0, 100]，且不原地变异 rawRecords
    expect(table.startEdit(4, 0)).toBe(true)
    const progInput = container.querySelector('input, textarea') as HTMLInputElement
    progInput.value = '150'
    expect(table.commitEdit()).toBe(true)
    expect(table.getCellValue(4, 0)).toBe(100)
    expect(onCellValueChange).toHaveBeenCalledWith('rec-1', 'progress', 100)
    expect(rawRecords[0]?.progress).toBe(75)
    expect(adapter.getRecordsSnapshot()[0]?.progress).toBe(100)

    // revertCell 可静默回滚并刷新画布
    adapter.revertCell('rec-1', 'progress', 75)
    expect(table.getCellValue(4, 0)).toBe(75)
    expect(table.getCellText(4, 0)).toBe('75%')

    adapter.destroy()
  })

  it('挂载 onRichCellEdit 时，select/date 不弹文本 input，双击触发富交互编辑回调', () => {
    const onRichCellEdit = vi.fn<(info: SmartGridRichEditInfo) => void>()
    const columnsWithDate: SmartColumn[] = [
      ...BASE_COLUMNS,
      { key: 'dueDate', title: '截止日期', type: 'date', width: 120 },
    ]
    const recordsWithDate = BASE_RECORDS.map((r) => ({ ...r, dueDate: '2026-11-13' }))
    const { container, adapter } = mountGrid({
      columns: columnsWithDate,
      records: recordsWithDate,
      onRichCellEdit,
    })
    const table = adapter.getTable()

    expect(table.startEdit(3, 0)).toBe(false) // select
    expect(table.startEdit(11, 0)).toBe(false) // date

    table.scrollToCell({ col: 11, row: 0 })
    const dateRect = table.getCellRelativeRect(11, 0)!
    container.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: dateRect.x + dateRect.width / 2,
        clientY: dateRect.y + dateRect.height / 2,
      }),
    )
    expect(onRichCellEdit).toHaveBeenCalledTimes(1)
    expect(onRichCellEdit.mock.calls[0]?.[0]).toMatchObject({
      column: expect.objectContaining({ key: 'dueDate' }),
      value: '2026-11-13',
      rect: dateRect,
    })

    adapter.destroy()
  })

  it('支持 onScrollChange 同步横向滚动，点击编辑器 input 或视口外区域不误触发业务交互', () => {
    const onScrollChange = vi.fn<(scrollLeft: number, scrollTop: number) => void>()
    const onCellValueChange =
      vi.fn<(recordId: string, fieldKey: string, newValue: unknown) => void>()
    const { container, adapter } = mountGrid({ onScrollChange, onCellValueChange })
    const table = adapter.getTable()

    container.dispatchEvent(new WheelEvent('wheel', { deltaX: 120, deltaY: 0, cancelable: true }))
    expect(table.getScrollLeft()).toBeGreaterThan(0)
    expect(onScrollChange).toHaveBeenCalledWith(table.getScrollLeft(), table.getScrollTop())

    // 点击表头区（drawRange 之外）不触发 checkbox 切换
    const cbRect = table.getCellRelativeRect(6, 0)!
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: cbRect.x + 10, clientY: 10 }))
    container.dispatchEvent(new MouseEvent('click', { clientX: cbRect.x + 10, clientY: 10 }))
    expect(onCellValueChange).not.toHaveBeenCalled()

    // 来自输入框冒泡的 click 不触发 checkbox 切换
    const fakeInput = document.createElement('input')
    container.appendChild(fakeInput)
    fakeInput.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: cbRect.x + cbRect.width / 2,
        clientY: cbRect.y + cbRect.height / 2,
      }),
    )
    expect(onCellValueChange).not.toHaveBeenCalled()

    adapter.destroy()
  })

  it('getFooterLayout 返回画布几何镜像（行表头宽、列内容坐标、滚动条预留与内容总宽）', () => {
    const { adapter } = mountGrid()
    const table = adapter.getTable()
    const layout = adapter.getFooterLayout()

    expect(layout.rowHeaderWidth).toBe(table.rowHeaderWidth)
    expect(layout.scrollbarSize).toBe(table.theme.interaction.scrollbarSize)
    expect(layout.contentWidth).toBe(1250)
    expect(layout.columns).toHaveLength(BASE_COLUMNS.length)
    expect(layout.columns[0]).toEqual({ field: 'code', left: 0, width: 100 })
    expect(layout.columns[1]).toEqual({ field: 'name', left: 100, width: 140 })
    expect(layout.columns.map((c) => c.field)).toEqual(BASE_COLUMNS.map((c) => c.key))

    adapter.destroy()
  })

  it('建表与列宽拖拽结束推送 onFooterLayoutChange 布局快照', () => {
    const onFooterLayoutChange = vi.fn<(layout: FooterLayout) => void>()
    const { adapter } = mountGrid({ onFooterLayoutChange })
    expect(onFooterLayoutChange).toHaveBeenCalledTimes(1)
    expect(onFooterLayoutChange.mock.calls[0]?.[0].contentWidth).toBe(1250)

    adapter.destroy()
  })

  it('sortRules 变化重建列定义并追加方向指示：首规则实心、次级空心', () => {
    const { adapter } = mountGrid()
    const table = adapter.getTable()
    expect(table.columns[1]?.title).toBe('项目名称')

    adapter.setData(
      BASE_COLUMNS,
      BASE_RECORDS.map((r) => ({ ...r })),
      undefined,
      [{ field: 'name', direction: 'asc' }],
    )
    const rebuilt = adapter.getTable()
    expect(rebuilt).not.toBe(table)
    expect(rebuilt.columns[1]?.title).toBe('项目名称 ▲')

    adapter.setData(
      BASE_COLUMNS,
      BASE_RECORDS.map((r) => ({ ...r })),
      undefined,
      [
        { field: 'name', direction: 'desc' },
        { field: 'code', direction: 'asc' },
      ],
    )
    expect(adapter.getTable().columns[1]?.title).toBe('项目名称 ▼')
    expect(adapter.getTable().columns[0]?.title).toBe('🔑 项目编号 △')

    // 排序规则未变化时不重建实例
    const stable = adapter.getTable()
    adapter.setData(
      BASE_COLUMNS,
      BASE_RECORDS.map((r) => ({ ...r })),
      undefined,
      [
        { field: 'name', direction: 'desc' },
        { field: 'code', direction: 'asc' },
      ],
    )
    expect(adapter.getTable()).toBe(stable)

    adapter.destroy()
  })

  it('点击列头触发 onHeaderColumnClick（shift 附加排序），行号带/checkbox 列/列边界热区/拖拽不触发', () => {
    const onHeaderColumnClick = vi.fn<(field: string, meta: { additive: boolean }) => void>()
    const { container, adapter } = mountGrid({ onHeaderColumnClick })
    const table = adapter.getTable()
    const headerY = table.headerHeight / 2
    // name 列（col=1）视口中心：行表头宽 + 内容坐标 left + 半宽
    const nameX = table.rowHeaderWidth + 100 + 70

    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: nameX, clientY: headerY }))
    container.dispatchEvent(new MouseEvent('click', { clientX: nameX, clientY: headerY }))
    expect(onHeaderColumnClick).toHaveBeenCalledTimes(1)
    expect(onHeaderColumnClick).toHaveBeenLastCalledWith('name', { additive: false })

    // shift+点击 → additive
    container.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: nameX, clientY: headerY, shiftKey: true }),
    )
    container.dispatchEvent(
      new MouseEvent('click', { clientX: nameX, clientY: headerY, shiftKey: true }),
    )
    expect(onHeaderColumnClick).toHaveBeenLastCalledWith('name', { additive: true })
    expect(onHeaderColumnClick).toHaveBeenCalledTimes(2)

    // 行表头/角格带不触发
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: headerY }))
    container.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: headerY }))
    expect(onHeaderColumnClick).toHaveBeenCalledTimes(2)

    // checkbox 列（col=6，left=690）不参与点击排序
    const checkboxX = table.rowHeaderWidth + 690 + 40
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: checkboxX, clientY: headerY }))
    container.dispatchEvent(new MouseEvent('click', { clientX: checkboxX, clientY: headerY }))
    expect(onHeaderColumnClick).toHaveBeenCalledTimes(2)

    // 列边界拖拽热区（±4px）让位给列宽调整
    const boundaryX = table.rowHeaderWidth + 100 + 2
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: boundaryX, clientY: headerY }))
    container.dispatchEvent(new MouseEvent('click', { clientX: boundaryX, clientY: headerY }))
    expect(onHeaderColumnClick).toHaveBeenCalledTimes(2)

    // 拖拽位移超过阈值不触发
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: nameX, clientY: headerY }))
    container.dispatchEvent(new MouseEvent('click', { clientX: nameX + 30, clientY: headerY }))
    expect(onHeaderColumnClick).toHaveBeenCalledTimes(2)

    adapter.destroy()
  })

  it('双击可编辑 link 单元格进入编辑时只触发一次链接打开，不打开两次新标签页', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    try {
      const { container, adapter } = mountGrid()
      const table = adapter.getTable()
      table.scrollToCell({ col: 8, row: 0 })
      const linkRect = table.getCellRelativeRect(8, 0)!
      const cx = linkRect.x + linkRect.width / 2
      const cy = linkRect.y + linkRect.height / 2

      // 连续两次单击模拟双击：第一击打开链接，第二击触发编辑并跳过第二次打开
      container.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: cx, clientY: cy, button: 0 }),
      )
      container.dispatchEvent(new MouseEvent('pointerup', { clientX: cx, clientY: cy, button: 0 }))
      container.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: cx, clientY: cy, button: 0 }),
      )
      container.dispatchEvent(new MouseEvent('pointerup', { clientX: cx, clientY: cy, button: 0 }))

      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(container.querySelector('input, textarea')).not.toBeNull()
      adapter.destroy()
    } finally {
      openSpy.mockRestore()
    }
  })
})
