// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import type { RenderContext } from '@infinitable/render'

import {
  SmartGridAdapter,
  formatSmartCellDisplayValue,
  formatSmartColumnTitle,
  type SmartGridColWidthChangeInfo,
  type SmartGridConflictClickInfo,
  type SmartGridContextMenuInfo,
  type SmartGridHeaderMenuClickInfo,
  type SmartGridHeaderSortClickInfo,
  type SmartGridRichEditInfo,
  type SmartGridSummaryClickInfo,
} from '../../src/canvas/smart-grid'
import type { LookupConflictInfo, SmartColumn, SmartRecord } from '../../src/shared/schema'

function createMockRenderContext(): {
  ctx: RenderContext
  texts: string[]
  strokes: Array<{ color: string; lineWidth: number }>
  arcs: number
  fills: number
} {
  const texts: string[] = []
  const strokes: Array<{ color: string; lineWidth: number }> = []
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
    stroke: () => {
      strokes.push({ color: String(ctx.strokeStyle), lineWidth: ctx.lineWidth })
    },
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
    strokes,
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
    expect(adapter.getWatermarkPlugin().getConfig().text).toBe('多维数据台 · DataDesk')
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

  it('原生底部冻结汇总行展示计数与汇总值，none 格保持干净，点击汇总格触发 onSummaryCellClick', () => {
    const onSummaryCellClick = vi.fn<(info: SmartGridSummaryClickInfo) => void>()
    const { container, adapter } = mountGrid({
      summaries: { amount: 'sum', code: 'none' },
      totalCount: 5,
      onSummaryCellClick,
    })
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      right: 900,
      bottom: 550,
      width: 800,
      height: 500,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    })

    const table = adapter.getTable()
    expect(table.frozenBottomRowCount).toBe(1)

    // 底部行头展示筛选/总数计数
    const rowHeaderRenderer = table.options.resolveBottomRowHeaderRenderer?.(0)
    expect(rowHeaderRenderer).toBeTruthy()
    const rhSpy = createMockRenderContext()
    rowHeaderRenderer?.({
      ctx: rhSpy.ctx,
      col: -1,
      row: 0,
      width: table.rowHeaderWidth,
      height: table.bottomRowHeight,
      text: '',
      value: '',
      style: {},
    })
    expect(rhSpy.texts).toContain('2/5')

    // 未配置汇总（none）保持干净空白
    expect(table.options.resolveBottomCellRenderer?.(0, 0)).toBeNull()

    // 数值列 amount（col=5）展示汇总结果（1234.56 + 1234 = 2468.56 -> ¥2,468.56）
    const amountSummaryRenderer = table.options.resolveBottomCellRenderer?.(5, 0)
    expect(amountSummaryRenderer).toBeTruthy()
    const sumSpy = createMockRenderContext()
    amountSummaryRenderer?.({
      ctx: sumSpy.ctx,
      col: 5,
      row: 0,
      width: 120,
      height: table.bottomRowHeight,
      text: '',
      value: '',
      style: table.options.resolveBottomCellStyle?.(5, 0) ?? {},
    })
    expect(sumSpy.texts).toContain('求和')
    expect(sumSpy.texts).toContain('¥2,468.56')

    // 点击底部汇总格触发 onSummaryCellClick 并返回视口坐标锚点矩形
    const relRect = table.getBottomCellRelativeRect(5, 0)!
    expect(relRect).not.toBeNull()
    const clientX = 100 + relRect.x + relRect.width / 2
    const clientY = 50 + relRect.y + relRect.height / 2
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX, clientY, button: 0 }))
    container.dispatchEvent(new MouseEvent('pointerup', { clientX, clientY, button: 0 }))

    expect(onSummaryCellClick).toHaveBeenCalledTimes(1)
    expect(onSummaryCellClick.mock.calls[0]?.[0]).toMatchObject({
      columnKey: 'amount',
      colIndex: 5,
      summaryType: 'sum',
      rect: {
        x: 100 + relRect.x,
        y: 50 + relRect.y,
        width: relRect.width,
        height: relRect.height,
      },
    })

    // 原地更新汇总方式与总数不重建 ListTable 实例
    adapter.setSummaries({ amount: 'avg' }, 2)
    expect(adapter.getTable()).toBe(table)

    const updatedRhSpy = createMockRenderContext()
    table.options.resolveBottomRowHeaderRenderer?.(0)?.({
      ctx: updatedRhSpy.ctx,
      col: -1,
      row: 0,
      width: table.rowHeaderWidth,
      height: table.bottomRowHeight,
      text: '',
      value: '',
      style: {},
    })
    expect(updatedRhSpy.texts).toContain('共 2 条')

    const updatedAvgSpy = createMockRenderContext()
    table.options.resolveBottomCellRenderer?.(
      5,
      0,
    )?.({
      ctx: updatedAvgSpy.ctx,
      col: 5,
      row: 0,
      width: 120,
      height: table.bottomRowHeight,
      text: '',
      value: '',
      style: table.options.resolveBottomCellStyle?.(5, 0) ?? {},
    })
    expect(updatedAvgSpy.texts).toContain('均值')
    expect(updatedAvgSpy.texts).toContain('¥1,234.28')

    adapter.destroy()
  })

  it('列头右侧绘制排序/菜单按钮，点本体仅选列不排序，点按钮热区隔离选列并触发对应回调', () => {
    const onHeaderSortClick = vi.fn<(info: SmartGridHeaderSortClickInfo) => void>()
    const onHeaderMenuClick = vi.fn<(info: SmartGridHeaderMenuClickInfo) => void>()
    const { container, adapter } = mountGrid({ onHeaderSortClick, onHeaderMenuClick })
    const table = adapter.getTable()

    // 验证列头自定义渲染器绘制标题 + 排序按钮 + 菜单按钮
    const headerRenderer = table.options.resolveColHeaderRenderer?.(1)
    expect(headerRenderer).toBeTruthy()
    const initialHeaderSpy = createMockRenderContext()
    headerRenderer?.({
      ctx: initialHeaderSpy.ctx,
      col: 1,
      row: -1,
      width: 140,
      height: table.headerHeight,
      text: '项目名称',
      value: '项目名称',
      style: {},
    })
    expect(initialHeaderSpy.texts).toContain('项目名称')
    expect(initialHeaderSpy.texts).toContain('⋯')
    expect(initialHeaderSpy.strokes.filter((s) => s.color === '#94a3b8')).toHaveLength(2)

    // sortRules 变化原地刷新列头，不重建 ListTable 实例
    adapter.setData(
      BASE_COLUMNS,
      BASE_RECORDS.map((r) => ({ ...r })),
      undefined,
      [
        { field: 'name', direction: 'desc' },
        { field: 'code', direction: 'asc' },
      ],
    )
    expect(adapter.getTable()).toBe(table)

    const primarySortSpy = createMockRenderContext()
    table.options.resolveColHeaderRenderer?.(1)?.({
      ctx: primarySortSpy.ctx,
      col: 1,
      row: -1,
      width: 140,
      height: table.headerHeight,
      text: '项目名称',
      value: '项目名称',
      style: {},
    })
    expect(primarySortSpy.strokes.some((s) => s.color === '#2563eb')).toBe(true)
    expect(primarySortSpy.texts).toContain('1')

    const secondarySortSpy = createMockRenderContext()
    table.options.resolveColHeaderRenderer?.(0)?.({
      ctx: secondarySortSpy.ctx,
      col: 0,
      row: -1,
      width: 100,
      height: table.headerHeight,
      text: '🔑 项目编号',
      value: '🔑 项目编号',
      style: {},
    })
    expect(secondarySortSpy.strokes.some((s) => s.color === '#60a5fa')).toBe(true)
    expect(secondarySortSpy.texts).toContain('2')

    // 先选中表体 (0, 0)
    table.selectCell(0, 0)

    // 计算第 1 列（name, left=100, width=140）热区坐标
    const col1Left = table.rowHeaderWidth + 100
    const regions =
      table.options.resolveColHeaderRegions?.(1, {
        width: 140,
        height: table.headerHeight,
      }) ?? []
    const sortRegion = regions.find((r) => r.id === 'sort')!
    const menuRegion = regions.find((r) => r.id === 'menu')!
    expect(sortRegion).toBeDefined()
    expect(menuRegion).toBeDefined()

    // 1) 点击排序按钮热区（带 shiftKey）：触发 onHeaderSortClick 且不破坏既有表体选区
    const sortX = col1Left + sortRegion.rect.x + sortRegion.rect.width / 2
    const sortY = sortRegion.rect.y + sortRegion.rect.height / 2
    container.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: sortX, clientY: sortY, button: 0, shiftKey: true }),
    )
    container.dispatchEvent(
      new MouseEvent('pointerup', { clientX: sortX, clientY: sortY, button: 0, shiftKey: true }),
    )
    expect(onHeaderSortClick).toHaveBeenCalledTimes(1)
    expect(onHeaderSortClick.mock.calls[0]?.[0]).toMatchObject({
      field: 'name',
      colIndex: 1,
      additive: true,
    })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 0, row: 0 } },
    ])

    // 2) 点击菜单按钮热区：触发 onHeaderMenuClick 并携带按钮精确锚点矩形，不破坏选区
    const menuX = col1Left + menuRegion.rect.x + menuRegion.rect.width / 2
    const menuY = menuRegion.rect.y + menuRegion.rect.height / 2
    container.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: menuX, clientY: menuY, button: 0 }),
    )
    container.dispatchEvent(
      new MouseEvent('pointerup', { clientX: menuX, clientY: menuY, button: 0 }),
    )
    expect(onHeaderMenuClick).toHaveBeenCalledTimes(1)
    expect(onHeaderMenuClick.mock.calls[0]?.[0]).toMatchObject({
      columnKey: 'name',
      colIndex: 1,
      rect: {
        x: col1Left + menuRegion.rect.x,
        y: menuRegion.rect.y,
        width: menuRegion.rect.width,
        height: menuRegion.rect.height,
      },
      headerRect: {
        x: col1Left,
        y: 0,
        width: 140,
        height: table.headerHeight,
      },
    })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 0, row: 0 } },
    ])

    // 3) 点击列头本体：仅选中整列，不触发排序与菜单回调
    const bodyHeaderX = col1Left + 24
    const bodyHeaderY = table.headerHeight / 2
    container.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: bodyHeaderX, clientY: bodyHeaderY, button: 0 }),
    )
    container.dispatchEvent(
      new MouseEvent('pointerup', { clientX: bodyHeaderX, clientY: bodyHeaderY, button: 0 }),
    )
    expect(onHeaderSortClick).toHaveBeenCalledTimes(1)
    expect(onHeaderMenuClick).toHaveBeenCalledTimes(1)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 0 }, end: { col: 1, row: 1 } },
    ])

    adapter.destroy()
  })

  it('全区域右键事件透传 body / col-header / row-header，携带视口坐标、目标与多格选区范围', () => {
    const onContextMenu = vi.fn<(info: SmartGridContextMenuInfo) => void>()
    const { container, adapter } = mountGrid({ onContextMenu })
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 120,
      top: 40,
      right: 920,
      bottom: 540,
      width: 800,
      height: 500,
      x: 120,
      y: 40,
      toJSON: () => ({}),
    })

    const table = adapter.getTable()
    // 选中多格区域 (col 0..1, row 0..1)
    table.selectCells([{ start: { col: 0, row: 0 }, end: { col: 1, row: 1 } }])

    // 1) body 单元格右键
    const cellRect = table.getCellRelativeRect(1, 0)!
    const bodyClientX = 120 + cellRect.x + 20
    const bodyClientY = 40 + cellRect.y + 15
    const bodyEvent = new MouseEvent('contextmenu', {
      clientX: bodyClientX,
      clientY: bodyClientY,
      cancelable: true,
    })
    container.dispatchEvent(bodyEvent)
    expect(bodyEvent.defaultPrevented).toBe(true)
    expect(onContextMenu).toHaveBeenCalledTimes(1)
    expect(onContextMenu.mock.calls[0]?.[0]).toMatchObject({
      region: 'body',
      x: bodyClientX,
      y: bodyClientY,
      cell: { col: 1, row: 0 },
      colIndex: 1,
      rowIndex: 0,
      column: expect.objectContaining({ key: 'name' }),
      record: expect.objectContaining({ _id: 'rec-1' }),
      selection: {
        recordIds: ['rec-1', 'rec-2'],
        columnKeys: ['code', 'name'],
      },
    })

    // 2) col-header 右键
    const colHeaderClientX = 120 + table.rowHeaderWidth + 100 + 30
    const colHeaderClientY = 40 + table.headerHeight / 2
    container.dispatchEvent(
      new MouseEvent('contextmenu', {
        clientX: colHeaderClientX,
        clientY: colHeaderClientY,
        cancelable: true,
      }),
    )
    expect(onContextMenu).toHaveBeenCalledTimes(2)
    expect(onContextMenu.mock.calls[1]?.[0]).toMatchObject({
      region: 'col-header',
      x: colHeaderClientX,
      y: colHeaderClientY,
      cell: null,
      colIndex: 1,
      rowIndex: null,
      column: expect.objectContaining({ key: 'name' }),
      record: null,
    })

    // 3) row-header 右键（第 2 行 row=1）
    const row1Rect = table.getCellRelativeRect(0, 1)!
    const rowHeaderClientX = 120 + table.rowHeaderWidth / 2
    const rowHeaderClientY = 40 + row1Rect.y + row1Rect.height / 2
    container.dispatchEvent(
      new MouseEvent('contextmenu', {
        clientX: rowHeaderClientX,
        clientY: rowHeaderClientY,
        cancelable: true,
      }),
    )
    expect(onContextMenu).toHaveBeenCalledTimes(3)
    expect(onContextMenu.mock.calls[2]?.[0]).toMatchObject({
      region: 'row-header',
      x: rowHeaderClientX,
      y: rowHeaderClientY,
      cell: null,
      colIndex: null,
      rowIndex: 1,
      column: null,
      record: expect.objectContaining({ _id: 'rec-2' }),
    })

    adapter.destroy()
  })

  it('融合多层次样式渲染（条件格式 > 单元格 > 列级），支持原地配置更新与列宽拖拽写回', () => {
    const onColWidthChange = vi.fn<(info: SmartGridColWidthChangeInfo) => void>()
    const { container, adapter } = mountGrid({
      view: {
        frozenColCount: 1,
        rowHeight: 'standard',
        columnStyles: {
          name: {
            headerBgColor: '#eef2ff',
            headerTextColor: '#1d4ed8',
            bgColor: '#f8fafc',
            textColor: '#334155',
            align: 'center',
          },
          owner: {
            align: 'right',
          },
        },
        cellStyles: {
          'rec-1': {
            name: { bgColor: '#fef9c3', textColor: '#854d0e' },
          },
        },
        conditionalFormats: [
          {
            id: 'cf_delivered',
            field: 'status',
            operator: 'eq',
            value: '已交付',
            scope: 'row',
            bgColor: '#fef2f2',
            textColor: '#991b1b',
          },
        ],
      },
      onColWidthChange,
    })

    const table = adapter.getTable()
    expect(table.getFrozenColCount()).toBe(1)

    // 列头样式生效
    expect(table.styleAt(1, -1)).toMatchObject({
      background: '#eef2ff',
      color: '#1d4ed8',
      textAlign: 'center',
    })

    // rec-1.name：单元格自定义覆盖列级样式，同时继承列级 align
    expect(table.getCellStyle(1, 0)).toMatchObject({
      background: '#fef9c3',
      color: '#854d0e',
      textAlign: 'center',
    })

    // rec-2.name：整行条件格式覆盖列级底色与字色
    expect(table.getCellStyle(1, 1)).toMatchObject({
      background: '#fef2f2',
      color: '#991b1b',
      textAlign: 'center',
    })

    // 富媒体 person 单元格与水平右对齐及颜色协调绘制
    const personRenderer = table.options.resolveCellRenderer?.(2, 1)
    const personSpy = createMockRenderContext()
    personRenderer?.({
      ctx: personSpy.ctx,
      col: 2,
      row: 1,
      width: 110,
      height: 38,
      text: '李四',
      value: '李四',
      style: table.getCellStyle(2, 1),
    })
    expect(personSpy.arcs).toBe(1)
    expect(personSpy.texts).toEqual(['四', '李四'])

    // 原地更新冻结列与行高，不重建 ListTable 实例
    adapter.setFrozenColCount(2)
    expect(adapter.getTable()).toBe(table)
    expect(table.getFrozenColCount()).toBe(2)

    adapter.setRowHeight('comfortable')
    expect(adapter.getTable()).toBe(table)
    expect(table.getRowHeight(0)).toBe(52)

    // 原地更新列宽与样式（可见列键序未变不重建 ListTable）
    adapter.setViewPresentation({
      frozenColCount: 2,
      rowHeight: 'compact',
      columnWidths: { name: 210 },
      columnStyles: {
        name: { bgColor: '#ecfdf5', textColor: '#065f46', align: 'right' },
      },
    })
    expect(adapter.getTable()).toBe(table)
    expect(table.getColWidth(1)).toBe(210)
    expect(table.getRowHeight(0)).toBe(32)
    expect(table.getCellStyle(1, 0)).toMatchObject({
      background: '#ecfdf5',
      color: '#065f46',
      textAlign: 'right',
    })

    // setColumnOrder 重排列顺序并隐藏列
    adapter.setColumnOrder(['name', 'code'], ['owner', 'status'])
    const visibleKeys = adapter.getVisibleColumns().map((c) => c.key)
    expect(visibleKeys.slice(0, 2)).toEqual(['name', 'code'])
    expect(visibleKeys).not.toContain('owner')
    expect(visibleKeys).not.toContain('status')

    // 模拟列 0 右边界拖拽调整列宽写回 onColWidthChange
    const currentTable = adapter.getTable()
    const col0RightX = currentTable.rowHeaderWidth + currentTable.getColWidth(0)
    const headerY = currentTable.headerHeight / 2
    container.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: col0RightX, clientY: headerY, button: 0 }),
    )
    container.dispatchEvent(
      new MouseEvent('pointermove', { clientX: col0RightX + 30, clientY: headerY, button: 0 }),
    )
    container.dispatchEvent(
      new MouseEvent('pointerup', { clientX: col0RightX + 30, clientY: headerY, button: 0 }),
    )
    expect(onColWidthChange).toHaveBeenCalledTimes(1)
    expect(onColWidthChange.mock.calls[0]?.[0]).toMatchObject({
      columnKey: 'name',
      colIndex: 0,
      width: 240,
    })

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

  it('SmartColumn.align 驱动基础列对齐，且 required 列编辑空值时回滚格值并触发 onValidationError', () => {
    const onCellValueChange =
      vi.fn<(recordId: string, fieldKey: string, newValue: unknown) => void>()
    const onValidationError = vi.fn<(message: string) => void>()
    const cols: SmartColumn[] = [
      { key: 'name', title: '项目名称', type: 'text', width: 140, required: true, align: 'center' },
      { key: 'amount', title: '金额', type: 'number', width: 120, required: true, align: 'left' },
    ]
    const recs: SmartRecord[] = [{ _id: 'r1', name: '一期项目', amount: 1000 }]

    const { container, adapter } = mountGrid({
      columns: cols,
      records: recs,
      summaries: { amount: 'sum' },
      onCellValueChange,
      onValidationError,
    })
    const table = adapter.getTable()

    // 列级基础 align 覆盖默认文本左对齐 / 数值右对齐，并被视图 columnStyles 覆盖
    expect(table.styleAt(0, -1).textAlign).toBe('center')
    expect(table.getCellStyle(0, 0).textAlign).toBe('center')
    expect(table.getCellStyle(1, 0).textAlign).toBe('left')
    expect(table.options.resolveBottomCellStyle?.(1, 0)?.textAlign).toBe('left')

    // required 文本列输入纯空白并提交：拒绝修改、回滚格值、触发错误提示
    expect(table.startEdit(0, 0)).toBe(true)
    const nameInput = container.querySelector('input, textarea') as HTMLInputElement
    nameInput.value = '   '
    expect(table.commitEdit()).toBe(true)
    expect(onValidationError).toHaveBeenCalledWith('项目名称为必填项')
    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(table.getCellValue(0, 0)).toBe('一期项目')

    // required 数值列输入空串并提交：拒绝修改并回滚
    expect(table.startEdit(1, 0)).toBe(true)
    const amountInput = container.querySelector('input, textarea') as HTMLInputElement
    amountInput.value = ''
    expect(table.commitEdit()).toBe(true)
    expect(onValidationError).toHaveBeenCalledWith('金额为必填项')
    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(table.getCellValue(1, 0)).toBe(1000)

    adapter.destroy()
  })

  it('宿主容器定位上下文按 static 自动补 relative 并保留外部显式样式，初始化与 ResizeObserver 同步有效宽高', () => {
    // 1) 无定位上下文（static / 空串）自动注入 relative，销毁时干净还原且不破坏后续显式修改
    const staticContainer = document.createElement('div')
    document.body.appendChild(staticContainer)
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation(((
      el: Element,
    ) => {
      if (el === staticContainer && !staticContainer.style.position) {
        return { position: 'static' } as CSSStyleDeclaration
      }
      return { position: (el as HTMLElement).style.position || 'static' } as CSSStyleDeclaration
    }) as typeof window.getComputedStyle)

    const roCallbacks: ResizeObserverCallback[] = []
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        roCallbacks.push(cb)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    try {
      let cw = 0
      let ch = 0
      Object.defineProperty(staticContainer, 'clientWidth', {
        configurable: true,
        get: () => cw,
      })
      Object.defineProperty(staticContainer, 'clientHeight', {
        configurable: true,
        get: () => ch,
      })
      vi.spyOn(staticContainer, 'getBoundingClientRect').mockImplementation(
        () =>
          ({
            left: 0,
            top: 0,
            width: 520,
            height: 360,
            right: 520,
            bottom: 360,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          }) as DOMRect,
      )

      const staticAdapter = new SmartGridAdapter({
        container: staticContainer,
        columns: BASE_COLUMNS,
        records: BASE_RECORDS,
      })
      expect(staticContainer.style.position).toBe('relative')
      // 初始化阶段 clientWidth 为 0 时回落边界矩形 520x360
      expect(staticAdapter.getTable().width).toBe(520)
      expect(staticAdapter.getTable().height).toBe(360)

      // 忽略 0x0 过渡态，有效宽高触发同步
      roCallbacks[0]?.(
        [{ contentRect: { width: 0, height: 0 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      )
      expect(staticAdapter.getTable().width).toBe(520)
      expect(staticAdapter.getTable().height).toBe(360)

      cw = 720
      ch = 440
      roCallbacks[0]?.([], {} as ResizeObserver)
      expect(staticAdapter.getTable().width).toBe(720)
      expect(staticAdapter.getTable().height).toBe(440)

      staticAdapter.destroy()
      expect(staticContainer.style.position).toBe('')

      // 2) 外部显式定位样式（absolute / CSS fixed）构造与销毁均不被覆盖或清空
      const absContainer = document.createElement('div')
      absContainer.style.position = 'absolute'
      document.body.appendChild(absContainer)
      const absAdapter = new SmartGridAdapter({
        container: absContainer,
        columns: BASE_COLUMNS,
        records: BASE_RECORDS,
      })
      expect(absContainer.style.position).toBe('absolute')
      absAdapter.destroy()
      expect(absContainer.style.position).toBe('absolute')
    } finally {
      getComputedStyleSpy.mockRestore()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      staticContainer.remove()
    }
  })

  it('formatSmartCellDisplayValue 与画布进度/数值列遵循 decimalPlaces（0~6），并在 decimalPlaces 变化时刷新网格', () => {
    expect(
      formatSmartCellDisplayValue(
        {
          key: 'a',
          title: '金额',
          type: 'number',
          width: 120,
          numberFormat: 'currency',
          decimalPlaces: 3,
        },
        1200.5,
      ),
    ).toBe('¥1,200.500')
    expect(
      formatSmartCellDisplayValue(
        {
          key: 'p',
          title: '占比',
          type: 'number',
          width: 100,
          numberFormat: 'percent',
          decimalPlaces: 2,
        },
        0.5,
      ),
    ).toBe('50.00%')
    expect(
      formatSmartCellDisplayValue(
        { key: 'prog', title: '进度', type: 'progress', width: 120, decimalPlaces: 2 },
        75,
      ),
    ).toBe('75.00%')

    const { adapter, container } = mountGrid({
      columns: [
        { key: 'code', title: '编号', type: 'text', width: 100 },
        {
          key: 'amount',
          title: '金额',
          type: 'number',
          width: 120,
          numberFormat: 'currency',
          decimalPlaces: 2,
        },
        { key: 'prog', title: '进度', type: 'progress', width: 120, decimalPlaces: 1 },
      ],
      records: [{ _id: '1', code: 'A', amount: 1000, prog: 75 }],
    })
    const firstTable = adapter.getTable()
    const progRenderer1 = firstTable.options.resolveCellRenderer?.(2, 0)
    const progSpy1 = createMockRenderContext()
    progRenderer1?.({
      ctx: progSpy1.ctx,
      col: 2,
      row: 0,
      width: 120,
      height: 36,
      text: '',
      value: 75,
      style: {},
    })
    expect(progSpy1.texts).toContain('75.0%')

    // 修改列 decimalPlaces 应触发列结构重建并按新小数位渲染
    adapter.setData(
      [
        { key: 'code', title: '编号', type: 'text', width: 100 },
        {
          key: 'amount',
          title: '金额',
          type: 'number',
          width: 120,
          numberFormat: 'currency',
          decimalPlaces: 4,
        },
        { key: 'prog', title: '进度', type: 'progress', width: 120, decimalPlaces: 2 },
      ],
      [{ _id: '1', code: 'A', amount: 1000, prog: 75 }],
    )
    const nextTable = adapter.getTable()
    expect(nextTable).not.toBe(firstTable)
    expect(nextTable.getCellText(1, 0)).toBe('¥1,000.0000')

    const progSpy2 = createMockRenderContext()
    nextTable.options.resolveCellRenderer?.(
      2,
      0,
    )?.({
      ctx: progSpy2.ctx,
      col: 2,
      row: 0,
      width: 120,
      height: 36,
      text: '',
      value: 75,
      style: {},
    })
    expect(progSpy2.texts).toContain('75.00%')

    adapter.destroy()
    container.remove()
  })
})
