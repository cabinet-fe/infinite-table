// @vitest-environment happy-dom

// 追加导入弹窗单测：
// 验证表头自动匹配、手动切换映射（含跳过导入）、全量行 required/类型校验拦截高亮与服务端行级错误展示。

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  AppendImportModal,
  extractBatchImportErrors,
  updateImportColumnMapping,
} from '../../src/components/AppendImportModal'
import type { BatchImportRowError } from '../../src/shared/api-types'
import type { SmartColumn } from '../../src/shared/schema'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

const COLUMNS: SmartColumn[] = [
  { key: 'name', title: '项目名称', type: 'text', width: 140, required: true },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, required: true },
  { key: 'due_date', title: '交付日期', type: 'date', width: 120 },
  {
    key: 'derived_calc',
    title: '税额',
    type: 'formula',
    width: 100,
    formulaExpr: '[amount] * 0.06',
  },
]

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

async function uploadCsv(container: HTMLElement, csvText: string, filename = 'append.csv') {
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File([csvText], filename, { type: 'text/csv' })
  Object.defineProperty(fileInput, 'files', {
    value: [file],
    configurable: true,
  })
  await act(async () => {
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
})

describe('AppendImportModal 追加导入与映射校验', () => {
  test('自动匹配表头并拦截包含缺失必填/非法数值的批次，高亮错误行', async () => {
    const onSubmitBatch = vi.fn<(records: Record<string, unknown>[]) => Promise<void>>()
    const { container } = mountComponent(
      createElement(AppendImportModal, {
        tableName: '合同台账',
        columns: COLUMNS,
        onClose: noop,
        onSubmitBatch,
      }),
    )

    const csv = ['项目名称,合同金额,交付日期', '项目A,12000,2026-05-01', ',abc,2026-05-02'].join(
      '\n',
    )
    await uploadCsv(container, csv)

    // 映射下拉仅含原始列（不含公式列）
    const amountMapTrigger = container.querySelector(
      'button[role="combobox"][aria-label="导入列 合同金额 映射目标"]',
    ) as HTMLButtonElement
    expect(amountMapTrigger.textContent).toContain('合同金额')
    act(() => {
      amountMapTrigger.click()
    })
    const optionTexts = Array.from(document.body.querySelectorAll('[role="option"]')).map(
      (el) => el.textContent,
    )
    expect(optionTexts.some((t) => t?.includes('跳过导入'))).toBe(true)
    expect(optionTexts.some((t) => t?.includes('税额'))).toBe(false)
    // 关闭下拉菜单
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    // 错误行被高亮
    const errorRow = container.querySelector('tr[data-row-index="1"]')
    expect(errorRow?.getAttribute('data-row-error')).toBe('true')
    expect(container.textContent).toContain('项目名称为必填项')
    expect(container.textContent).toContain('请输入有效数值')

    // 点击确认导入应被拦截，不调用 onSubmitBatch
    const submitBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('确认追加导入'),
    )!
    await act(async () => {
      submitBtn.click()
    })
    expect(onSubmitBatch).not.toHaveBeenCalled()
  })

  test('支持手动切换映射列为「跳过导入」，合法批次放行提交', async () => {
    const onSubmitBatch = vi.fn<(records: Record<string, unknown>[]) => Promise<void>>(
      async () => {},
    )
    const onClose = vi.fn<() => void>()
    const { container } = mountComponent(
      createElement(AppendImportModal, {
        tableName: '合同台账',
        columns: COLUMNS,
        onClose,
        onSubmitBatch,
      }),
    )

    const csv = ['项目名称,合同金额,交付日期', '项目A,12000,invalid-date'].join('\n')
    await uploadCsv(container, csv)

    // 初始交付日期为非法日期，切换映射为「跳过导入」后应通过校验
    const dateMapTrigger = container.querySelector(
      'button[role="combobox"][aria-label="导入列 交付日期 映射目标"]',
    ) as HTMLButtonElement
    act(() => {
      dateMapTrigger.click()
    })
    const skipOpt = Array.from(document.body.querySelectorAll('[role="option"]')).find((el) =>
      el.textContent?.includes('跳过导入'),
    ) as HTMLElement
    act(() => {
      skipOpt.click()
    })

    const submitBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('确认追加导入'),
    )!
    await act(async () => {
      submitBtn.click()
    })

    expect(onSubmitBatch).toHaveBeenCalledWith([{ name: '项目A', amount: 12000 }])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('展示服务端返回的行级错误并高亮对应行', async () => {
    const serverErr = Object.assign(new Error('批量导入校验失败'), {
      errors: [
        {
          rowIndex: 0,
          field: 'name',
          columnTitle: '项目名称',
          message: '服务端校验：名称重复',
        },
      ] satisfies BatchImportRowError[],
    })
    const onSubmitBatch = vi
      .fn<(records: Record<string, unknown>[]) => Promise<void>>()
      .mockRejectedValue(serverErr)
    const { container } = mountComponent(
      createElement(AppendImportModal, {
        tableName: '合同台账',
        columns: COLUMNS,
        onClose: noop,
        onSubmitBatch,
      }),
    )

    const csv = ['项目名称,合同金额', '项目A,100'].join('\n')
    await uploadCsv(container, csv)

    const submitBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('确认追加导入'),
    )!
    await act(async () => {
      submitBtn.click()
    })

    expect(container.textContent).toContain('批量导入校验失败')
    expect(container.textContent).toContain('服务端校验：名称重复')
    expect(container.querySelector('tr[data-row-index="0"]')?.getAttribute('data-row-error')).toBe(
      'true',
    )
  })

  test('updateImportColumnMapping 与 extractBatchImportErrors 纯函数辅助', () => {
    const next = updateImportColumnMapping(
      [{ sourceIndex: 0, sourceLabel: '名称', sourceKey: 'name', targetField: 'name' }],
      0,
      null,
    )
    expect(next[0]?.targetField).toBeNull()

    const parsed = extractBatchImportErrors(
      Object.assign(new Error('fail'), {
        errors: [{ rowIndex: 2, field: 'amount', columnTitle: '金额', message: '无效' }],
      }),
    )
    expect(parsed.message).toBe('fail')
    expect(parsed.errors).toHaveLength(1)
  })
})
