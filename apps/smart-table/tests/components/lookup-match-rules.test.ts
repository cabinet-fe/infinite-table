// @vitest-environment happy-dom

// 关联查找匹配条件 UI 约束测试：
// 验证 DisambiguatePopover、LookupFieldPanel 与 LookupWizardModal 在配置/追加匹配条件时，
// 不会把本组带出字段、依赖自己的关联列或公式列暴露/默认选中到匹配条件中。

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test } from 'vitest'
import { DisambiguatePopover } from '../../src/components/DisambiguatePopover'
import { LookupFieldPanel } from '../../src/components/LookupFieldPanel'
import { LookupWizardModal } from '../../src/components/LookupWizardModal'
import { createLookupColumnsFromWizard } from '../../src/domain/lookup-engine'
import type { TableBundle } from '../../src/shared/api-types'
import type { SmartColumn, SmartRecord } from '../../src/shared/schema'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}
const noopAsync = async () => {}

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

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
})

function buildTestTables(): {
  sourceTable: TableBundle
  targetTable: TableBundle
  empCols: SmartColumn[]
} {
  const empCols = createLookupColumnsFromWizard({
    groupId: 'grp_emp',
    targetTableId: 'tbl_emp',
    matchRules: [{ sourceField: 'owner_name', targetField: 'name' }],
    mode: 'one',
    returnFields: [
      { field: 'dept', title: '所属部门' },
      { field: 'emp_id', title: '唯一工号' },
    ],
  })

  const sourceColumns: SmartColumn[] = [
    { key: 'project_code', title: '项目编号', type: 'text', width: 120 },
    { key: 'owner_name', title: '负责人', type: 'person', width: 120 },
    ...empCols,
    {
      key: 'formula_rate',
      title: '回款达成率',
      type: 'formula',
      width: 120,
      formulaExpr: '1',
    },
    { key: 'region', title: '所属大区', type: 'select', width: 120 },
  ]

  const targetColumns: SmartColumn[] = [
    { key: 'emp_id', title: '工号', type: 'text', width: 100 },
    { key: 'name', title: '姓名', type: 'person', width: 100 },
    { key: 'dept', title: '部门', type: 'select', width: 120 },
  ]

  const sourceRecords: SmartRecord[] = [
    { _id: 'r1', project_code: 'PRJ-1', owner_name: '张三', region: '华东' },
  ]
  const targetRecords: SmartRecord[] = [
    { _id: 'e1', emp_id: 'EMP-1', name: '张三', dept: '研发部' },
    { _id: 'e2', emp_id: 'EMP-2', name: '张三', dept: '销售部' },
  ]

  return {
    empCols,
    sourceTable: {
      meta: {
        id: 'tbl_prj',
        name: '项目表',
        kind: 'normal',
        columns: sourceColumns,
        views: [],
        summaries: {},
      },
      records: sourceRecords,
    },
    targetTable: {
      meta: {
        id: 'tbl_emp',
        name: '员工花名册',
        kind: 'advanced',
        primaryKeyField: 'emp_id',
        columns: targetColumns,
        views: [],
        summaries: {},
      },
      records: targetRecords,
    },
  }
}

describe('关联查找追加匹配条件字段过滤', () => {
  test('DisambiguatePopover 不默认选中且不提供本组带出字段与公式字段', () => {
    const { sourceTable, targetTable, empCols } = buildTestTables()
    const deptCol = empCols[0]!
    const { container } = mountComponent(
      createElement(DisambiguatePopover, {
        conflictInfo: {
          record: sourceTable.records[0]!,
          column: deptCol,
          conflict: {
            groupId: 'grp_emp',
            targetTableId: 'tbl_emp',
            candidates: targetTable.records,
            isResolved: false,
            selectedRecordId: 'e1',
          },
          rect: { x: 100, y: 100, width: 120, height: 32 },
        },
        sourceColumns: sourceTable.meta.columns,
        targetBundle: targetTable,
        onClose: noop,
        onSelectCandidate: noopAsync,
        onAppendMatchRule: noopAsync,
      }),
    )

    const openBuilderBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('追加联合匹配条件'),
    )!
    act(() => {
      openBuilderBtn.click()
    })

    const sourceTrigger = container.querySelector(
      'button[role="combobox"][aria-label="选择本表字段"]',
    ) as HTMLButtonElement
    expect(sourceTrigger.textContent).toBe('本表 · 项目编号')

    act(() => {
      sourceTrigger.click()
    })

    const optionsText = Array.from(document.body.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent,
    )
    expect(optionsText).toEqual(['本表 · 项目编号', '本表 · 所属大区'])
  })

  test('DisambiguatePopover 在无可用原生/非带出字段时禁用追加联合条件按钮', () => {
    const { targetTable, empCols } = buildTestTables()
    const minimalCols: SmartColumn[] = [
      { key: 'owner_name', title: '负责人', type: 'person', width: 120 },
      ...empCols,
      { key: 'formula_rate', title: '回款达成率', type: 'formula', width: 120, formulaExpr: '1' },
    ]
    const { container } = mountComponent(
      createElement(DisambiguatePopover, {
        conflictInfo: {
          record: { _id: 'r1', owner_name: '张三' },
          column: empCols[0]!,
          conflict: {
            groupId: 'grp_emp',
            targetTableId: 'tbl_emp',
            candidates: targetTable.records,
            isResolved: false,
            selectedRecordId: 'e1',
          },
          rect: { x: 100, y: 100, width: 120, height: 32 },
        },
        sourceColumns: minimalCols,
        targetBundle: targetTable,
        onClose: noop,
        onSelectCandidate: noopAsync,
        onAppendMatchRule: noopAsync,
      }),
    )

    const openBuilderBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('追加联合匹配条件'),
    )!
    expect(openBuilderBtn.disabled).toBe(true)
  })

  test('LookupFieldPanel 本表匹配字段下拉与追加默认项排除本组带出字段与公式字段', () => {
    const { sourceTable, targetTable, empCols } = buildTestTables()
    const { container } = mountComponent(
      createElement(LookupFieldPanel, {
        columnKey: empCols[0]!.key,
        rect: { x: 100, y: 100, width: 120, height: 32 },
        sourceTable,
        sourceComputedRecords: sourceTable.records,
        allTables: [sourceTable, targetTable],
        onClose: noop,
        onSave: noopAsync,
        onDeleteColumn: noopAsync,
      }),
    )

    const appendBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('追加'),
    )!
    act(() => {
      appendBtn.click()
    })

    const sourceTriggers = Array.from(
      container.querySelectorAll('button[role="combobox"][aria-label="本表匹配字段"]'),
    ) as HTMLButtonElement[]
    expect(sourceTriggers).toHaveLength(2)
    // 追加的第二条规则避开已用的 owner_name 与带出列/公式列，选中项目编号
    expect(sourceTriggers[1]!.textContent).toBe('项目编号')

    act(() => {
      sourceTriggers[1]!.click()
    })
    const optionsText = Array.from(document.body.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent,
    )
    expect(optionsText).toEqual(['项目编号', '负责人', '所属大区'])
  })

  test('LookupWizardModal 第 2 步匹配条件排除公式字段', () => {
    const { sourceTable, targetTable } = buildTestTables()
    const wizardSource: TableBundle = {
      ...sourceTable,
      meta: {
        ...sourceTable.meta,
        columns: [
          {
            key: 'formula_first',
            title: '前置公式',
            type: 'formula',
            width: 100,
            formulaExpr: '1',
          },
          ...sourceTable.meta.columns,
        ],
      },
    }
    const { container } = mountComponent(
      createElement(LookupWizardModal, {
        sourceTable: wizardSource,
        sourceComputedRecords: wizardSource.records,
        allTables: [wizardSource, targetTable],
        onClose: noop,
        onSubmitColumns: noopAsync,
      }),
    )

    const nextBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '下一步',
    )!
    act(() => {
      nextBtn.click()
    })

    const sourceTrigger = container.querySelector(
      'button[role="combobox"][aria-label="本表匹配字段"]',
    ) as HTMLButtonElement
    // 跳过第 0 列前置公式，默认选中第 1 列项目编号
    expect(sourceTrigger.textContent).toBe('本表 · 项目编号')

    act(() => {
      sourceTrigger.click()
    })
    const optionsText = Array.from(document.body.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent,
    )
    expect(optionsText.some((t) => t?.includes('前置公式'))).toBe(false)
    expect(optionsText.some((t) => t?.includes('回款达成率'))).toBe(false)
  })

  test('LookupWizardModal 目标表匹配字段与带出/汇总字段严格排除目标表中的派生列', () => {
    const { sourceTable, targetTable } = buildTestTables()
    const pollutedTarget: TableBundle = {
      ...targetTable,
      meta: {
        ...targetTable.meta,
        columns: [
          ...targetTable.meta.columns,
          {
            key: 'target_lookup',
            title: '目标表关联列',
            type: 'lookup',
            width: 120,
            lookupConfig: {
              groupId: 'g_other',
              targetTableId: 'tbl_other',
              matchRules: [{ sourceField: 'dept', targetField: 'name' }],
              targetReturnField: 'code',
              mode: 'one',
            },
          },
          {
            key: 'target_formula',
            title: '目标表公式列',
            type: 'formula',
            width: 120,
            formulaExpr: '1',
          },
        ],
      },
    }

    const { container } = mountComponent(
      createElement(LookupWizardModal, {
        sourceTable,
        sourceComputedRecords: sourceTable.records,
        allTables: [sourceTable, pollutedTarget],
        onClose: noop,
        onSubmitColumns: noopAsync,
      }),
    )

    const nextBtn1 = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '下一步',
    )!
    act(() => {
      nextBtn1.click()
    })

    // 第 2 步目标表匹配字段不包含 lookup/formula
    const targetTrigger = container.querySelector(
      'button[role="combobox"][aria-label="目标表匹配字段"]',
    ) as HTMLButtonElement
    act(() => {
      targetTrigger.click()
    })
    const targetOpts = Array.from(document.body.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent,
    )
    expect(targetOpts.some((t) => t?.includes('目标表关联列'))).toBe(false)
    expect(targetOpts.some((t) => t?.includes('目标表公式列'))).toBe(false)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    // 第 3 步带出字段不包含 lookup/formula
    const nextBtn2 = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '下一步',
    )!
    act(() => {
      nextBtn2.click()
    })
    expect(container.textContent).not.toContain('目标表关联列')
    expect(container.textContent).not.toContain('目标表公式列')
  })

  test('LookupFieldPanel 仅允许选择目标数据源表的原始字段，禁止目标表派生列', () => {
    const { sourceTable, targetTable, empCols } = buildTestTables()
    const pollutedTarget: TableBundle = {
      ...targetTable,
      meta: {
        ...targetTable.meta,
        columns: [
          ...targetTable.meta.columns,
          {
            key: 'target_formula',
            title: '目标表公式列',
            type: 'formula',
            width: 120,
            formulaExpr: '1',
          },
        ],
      },
    }

    const { container } = mountComponent(
      createElement(LookupFieldPanel, {
        columnKey: empCols[0]!.key,
        rect: { x: 100, y: 100, width: 120, height: 32 },
        sourceTable,
        sourceComputedRecords: sourceTable.records,
        allTables: [sourceTable, pollutedTarget],
        onClose: noop,
        onSave: noopAsync,
        onDeleteColumn: noopAsync,
      }),
    )

    const returnTrigger = container.querySelector(
      'button[role="combobox"][aria-label="带出字段"]',
    ) as HTMLButtonElement
    act(() => {
      returnTrigger.click()
    })
    const returnOpts = Array.from(document.body.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent,
    )
    expect(returnOpts).toEqual(['工号', '姓名', '部门'])
    expect(returnOpts).not.toContain('目标表公式列')
  })
})
