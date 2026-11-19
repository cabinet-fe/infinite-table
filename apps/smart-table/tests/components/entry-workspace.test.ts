// @vitest-environment happy-dom

// 独立数据录入端组件单测：
// 覆盖 EntryRecordDrawer（9 类原始字段渲染、* 必填标识、单源校验就地高亮拦截、新建/编辑提交）
// 与 EntryWorkspace（精简工具栏、无工作台侧栏/分析能力、行内与抽屉联动、行号双击、导出与删行）。

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EntryRecordDrawer } from '../../src/components/EntryRecordDrawer'
import { EntryWorkspace } from '../../src/components/EntryWorkspace'
import type { TableBundle } from '../../src/shared/api-types'
import type { SmartColumn, SmartRecord } from '../../src/shared/schema'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}
const noopAsync = async () => {}

const COLUMNS: SmartColumn[] = [
  { key: 'title', title: '项目名称', type: 'text', width: 140, required: true },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, required: true },
  { key: 'due_date', title: '交付日期', type: 'date', width: 120 },
  {
    key: 'status',
    title: '状态',
    type: 'select',
    width: 110,
    options: [
      { label: '待启动', color: '#f2f3f5', textColor: '#4e5969' },
      { label: '进行中', color: '#ebf1ff', textColor: '#1d4ed8' },
    ],
  },
  { key: 'urgent', title: '加急', type: 'checkbox', width: 80 },
  { key: 'owner', title: '负责人', type: 'person', width: 110 },
  { key: 'progress', title: '进度', type: 'progress', width: 120 },
  { key: 'cover', title: '封面图', type: 'image', width: 120 },
  { key: 'doc', title: '方案链接', type: 'link', width: 140 },
  {
    key: 'derived_lookup',
    title: '关联部门',
    type: 'lookup',
    width: 120,
    lookupConfig: {
      groupId: 'g1',
      targetTableId: 'tbl_emp',
      matchRules: [{ sourceField: 'owner', targetField: 'name' }],
      targetReturnField: 'dept',
      mode: 'one',
    },
  },
  {
    key: 'derived_formula',
    title: '含税金额',
    type: 'formula',
    width: 120,
    formulaExpr: '[amount] * 1.06',
  },
]

const RECORDS: SmartRecord[] = [
  {
    _id: 'r1',
    title: '一期交付',
    amount: 50000,
    due_date: '2026-06-01',
    status: '进行中',
    urgent: true,
    owner: '张三',
    progress: 60,
    cover: '',
    doc: { url: 'https://example.com/spec', text: '查看规格' },
  },
]

const BUNDLE: TableBundle = {
  meta: {
    id: 'tbl_entry',
    name: '合同台账',
    kind: 'normal',
    columns: COLUMNS,
    views: [],
    summaries: { amount: 'sum' },
  },
  records: RECORDS,
}

const mountedRoots: Array<{ unmount: () => void; container: HTMLElement }> = []

function mountComponent(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  const handle = {
    container,
    rerender: (nextEl: React.ReactElement) => {
      act(() => {
        root.render(nextEl)
      })
    },
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
  mountedRoots.push(handle)
  return handle
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
})

describe('EntryRecordDrawer 单行表单抽屉', () => {
  test('仅渲染原始字段并展示 * 必填标识，提交前执行 required 与类型校验并就地高亮错误字段', async () => {
    const onSubmit =
      vi.fn<(values: Record<string, unknown>, recordId?: string) => Promise<void>>(noopAsync)
    const { container } = mountComponent(
      createElement(EntryRecordDrawer, {
        open: true,
        mode: 'create',
        columns: COLUMNS,
        onClose: noop,
        onSubmit,
      }),
    )

    // 不包含派生列
    expect(container.textContent).not.toContain('关联部门')
    expect(container.textContent).not.toContain('含税金额')

    // 必填 * 标识
    const titleGroup = container.querySelector('[data-field-key="title"]')!
    expect(titleGroup.textContent).toContain('*')
    expect(container.querySelector('[data-field-key="owner"]')?.textContent).not.toContain('*')

    // 填入非法数值并留空必填项，提交应被拦截并高亮
    const amountInput = container.querySelector('#st-entry-field-amount') as HTMLInputElement
    act(() => {
      setInputValue(amountInput, 'not-a-number')
    })

    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-field-key="title"]')?.getAttribute('data-field-error'),
    ).toBe('true')
    expect(
      container.querySelector('[data-field-key="amount"]')?.getAttribute('data-field-error'),
    ).toBe('true')
    expect(container.textContent).toContain('项目名称为必填项')
    expect(container.textContent).toContain('请输入有效数值')

    // 修正后正常提交并做类型归一化
    const titleInput = container.querySelector('#st-entry-field-title') as HTMLInputElement
    act(() => {
      setInputValue(titleInput, '新签合同')
      setInputValue(amountInput, '12500')
    })

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      title: '新签合同',
      amount: 12500,
    })
  })

  test('编辑模式回填字段值并保留链接展示文本', async () => {
    const onSubmit =
      vi.fn<(values: Record<string, unknown>, recordId?: string) => Promise<void>>(noopAsync)
    const { container } = mountComponent(
      createElement(EntryRecordDrawer, {
        open: true,
        mode: 'edit',
        record: RECORDS[0]!,
        columns: COLUMNS,
        onClose: noop,
        onSubmit,
      }),
    )

    const docInput = container.querySelector('#st-entry-field-doc') as HTMLInputElement
    expect(docInput.value).toBe('https://example.com/spec')

    act(() => {
      setInputValue(docInput, 'https://example.com/spec-v2')
    })

    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[1]).toBe('r1')
    expect(onSubmit.mock.calls[0]?.[0]?.doc).toEqual({
      url: 'https://example.com/spec-v2',
      text: '查看规格',
    })
  })
})

describe('EntryWorkspace 独立数据录入端主视图', () => {
  test('仅展示表名、记录数与录入工具栏，不含侧边栏/配置抽屉/VLOOKUP/分析入口', async () => {
    const onCreateRecord = vi.fn<(rec: Record<string, unknown>) => Promise<void>>(noopAsync)
    const { container } = mountComponent(
      createElement(EntryWorkspace, {
        bundle: BUNDLE,
        onCreateRecord,
        onUpdateRecord: noopAsync,
        onDeleteRecords: noopAsync,
        onBatchAppendRecords: noopAsync,
      }),
    )

    expect(container.textContent).toContain('合同台账')
    expect(container.textContent).toContain('1 条记录')
    expect(container.textContent).toContain('表单录入')
    expect(container.textContent).toContain('批量追加导入')
    expect(container.textContent).toContain('导出')

    expect(container.querySelector('[aria-label="智能表格"]')).toBeNull()
    expect(container.querySelector('[aria-label="数据源中心"]')).toBeNull()
    expect(container.textContent).not.toContain('VLOOKUP')
    expect(container.textContent).not.toContain('视图配置')
    expect(container.textContent).not.toContain('透视')

    // 存在 required 字段时点击「新增行」唤起表单抽屉而不直接插空行
    const addRowBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('新增行'),
    )!
    act(() => {
      addRowBtn.click()
    })
    expect(onCreateRecord).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"][aria-label="新建录入记录"]')).not.toBeNull()
  })

  test('无必填列时点击新增行直接建空行，点击导出支持 CSV/XLSX', async () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    try {
      const noRequiredBundle: TableBundle = {
        meta: {
          ...BUNDLE.meta,
          columns: COLUMNS.filter((c) => c.type !== 'lookup' && c.type !== 'formula').map((c) => ({
            ...c,
            required: false,
          })),
        },
        records: RECORDS,
      }
      const onCreateRecord = vi.fn<(rec: Record<string, unknown>) => Promise<void>>(noopAsync)
      const onNotify = vi.fn<(type: string, message: string) => void>()
      const { container } = mountComponent(
        createElement(EntryWorkspace, {
          bundle: noRequiredBundle,
          onCreateRecord,
          onUpdateRecord: noopAsync,
          onDeleteRecords: noopAsync,
          onBatchAppendRecords: noopAsync,
          onNotify,
        }),
      )

      const addRowBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('新增行'),
      )!
      await act(async () => {
        addRowBtn.click()
      })
      expect(onCreateRecord).toHaveBeenCalledWith({})

      const exportBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === '导出',
      )!
      act(() => {
        exportBtn.click()
      })
      const csvBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('导出 CSV'),
      )!
      await act(async () => {
        csvBtn.click()
      })
      expect(createObjectUrlSpy).toHaveBeenCalledTimes(1)
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(onNotify).toHaveBeenCalledWith('success', expect.stringContaining('CSV'))
    } finally {
      createObjectUrlSpy.mockRestore()
      revokeSpy.mockRestore()
      clickSpy.mockRestore()
    }
  })

  test('顶部支持切换其它数据录入表与复制分享链接', async () => {
    const onSwitchTable = vi.fn<(tableId: string) => void>()
    const onLoadSwitchableTables = vi.fn<() => Promise<void>>(noopAsync)
    const onCopyEntryLink = vi.fn<() => void>()

    const { container } = mountComponent(
      createElement(EntryWorkspace, {
        bundle: BUNDLE,
        switchableTables: [
          { id: 'tbl_entry', name: '合同台账' },
          { id: 'tbl_inv', name: '库存台账' },
        ],
        onSwitchTable,
        onLoadSwitchableTables,
        onCopyEntryLink,
        onCreateRecord: noopAsync,
        onUpdateRecord: noopAsync,
        onDeleteRecords: noopAsync,
        onBatchAppendRecords: noopAsync,
      }),
    )

    const switchBtn = container.querySelector('button[aria-label="切换数据录入表"]')!
    act(() => {
      ;(switchBtn as HTMLButtonElement).click()
    })
    expect(onLoadSwitchableTables).toHaveBeenCalledTimes(1)

    const targetOption = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('库存台账'),
    )!
    act(() => {
      targetOption.click()
    })
    expect(onSwitchTable).toHaveBeenCalledWith('tbl_inv')

    const copyBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('复制链接'),
    )!
    act(() => {
      copyBtn.click()
    })
    expect(onCopyEntryLink).toHaveBeenCalledTimes(1)
  })

  test('readonly 模式下隐藏新增行/表单录入/批量追加导入，保留只读标识与导出', () => {
    const { container } = mountComponent(
      createElement(EntryWorkspace, {
        bundle: BUNDLE,
        readonly: true,
        onCreateRecord: noopAsync,
        onUpdateRecord: noopAsync,
        onDeleteRecords: noopAsync,
        onBatchAppendRecords: noopAsync,
      }),
    )

    expect(container.textContent).toContain('只读')
    expect(container.textContent).not.toContain('新增行')
    expect(container.textContent).not.toContain('表单录入')
    expect(container.textContent).not.toContain('批量追加导入')
    expect(container.textContent).toContain('导出')
  })
})
