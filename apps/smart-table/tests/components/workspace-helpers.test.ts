// 工作台双态权限、URL 参数同步、三区域右键菜单裁剪、选区样式更新、列顺序/显隐与 CSV/XLSX 导出单测

import { readXlsx } from 'hucre/xlsx'
import { describe, expect, test } from 'vitest'
import { buildGridMenuItems, type GridMenuContext } from '../../src/components/GridPopupMenu'
import {
  applyCellStyleToSelection,
  buildDefaultViewPayload,
  buildModeSearchUrl,
  formatRecordsAsCsv,
  buildRecordsXlsxBytes,
  getAvailableSummaryTypes,
  normalizeColumnOrder,
  reorderStringList,
  resolveAppModeFromSearch,
  toggleHiddenColumn,
} from '../../src/domain/workspace-helpers'
import type { TableBundle } from '../../src/shared/api-types'
import type { SmartColumn, SmartRecord } from '../../src/shared/schema'

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '编号', type: 'text', width: 100, isUniqueKey: true },
  {
    key: 'status',
    title: '状态',
    type: 'select',
    width: 110,
    options: [
      { label: '进行中', color: '#ebf1ff', textColor: '#1d4ed8' },
      { label: '已交付', color: '#dcfce7', textColor: '#166534' },
    ],
  },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, numberFormat: 'currency' },
  {
    key: 'dept',
    title: '部门',
    type: 'lookup',
    width: 120,
    lookupConfig: {
      groupId: 'grp_emp',
      targetTableId: 'tbl_emp',
      matchRules: [{ sourceField: 'owner', targetField: 'name' }],
      targetReturnField: 'dept',
      mode: 'one',
    },
  },
]

const RECORDS: SmartRecord[] = [
  { _id: 'r1', code: 'PRJ-01', status: '进行中', amount: 12000, dept: '研发部' },
  { _id: 'r2', code: 'PRJ-02', status: '已交付', amount: 8500.5, dept: '市场,一组' },
]

describe('双态 URL 解析与生成', () => {
  test('?mode=viewer 直达查看态，缺省或其它值进入运维配置态', () => {
    expect(resolveAppModeFromSearch('')).toBe('operator')
    expect(resolveAppModeFromSearch('?mode=operator')).toBe('operator')
    expect(resolveAppModeFromSearch('?mode=viewer')).toBe('viewer')
    expect(resolveAppModeFromSearch('?foo=1&mode=VIEWER')).toBe('viewer')
  })

  test('buildModeSearchUrl 切换模式时保留其余查询参数与 hash', () => {
    expect(buildModeSearchUrl('/', '?view=v1', '#sec', 'viewer')).toBe('/?view=v1&mode=viewer#sec')
    expect(buildModeSearchUrl('/', '?view=v1&mode=viewer', '#sec', 'operator')).toBe(
      '/?view=v1#sec',
    )
    expect(buildModeSearchUrl('/', '?mode=viewer', '', 'operator')).toBe('/')
  })
})

describe('三区域右键菜单双态权限裁剪', () => {
  function baseCtx(overrides: Partial<GridMenuContext>): GridMenuContext {
    return {
      mode: 'operator',
      region: 'body',
      x: 100,
      y: 100,
      colIndex: 1,
      column: COLUMNS[1]!,
      record: RECORDS[0]!,
      selection: { ranges: [], recordIds: [], columnKeys: [], focus: null },
      sortRules: [{ field: 'status', direction: 'asc' }],
      frozenColCount: 0,
      visibleColumnCount: COLUMNS.length,
      canRenameColumn: true,
      canDeleteColumn: true,
      hasSelectionCellStyles: true,
      isDatasourceMode: false,
      ...overrides,
    }
  }

  test('用户查看态（viewer）严格移除写操作与配置类菜单项，仅保留只读交互', () => {
    const colItems = buildGridMenuItems(baseCtx({ mode: 'viewer', region: 'col-header' }))
    expect(colItems.map((i) => i.id)).toEqual(['sort_asc', 'sort_desc', 'sort_clear'])

    const rowItems = buildGridMenuItems(baseCtx({ mode: 'viewer', region: 'row-header' }))
    expect(rowItems.map((i) => i.id)).toEqual(['copy_row'])

    const bodyItems = buildGridMenuItems(baseCtx({ mode: 'viewer', region: 'body' }))
    expect(bodyItems.map((i) => i.id)).toEqual(['copy_cell', 'filter_by_cell'])
  })

  test('运维配置态（operator）在三区域均露出对应配置与编辑动作', () => {
    const colItems = buildGridMenuItems(baseCtx({ mode: 'operator', region: 'col-header' }))
    expect(colItems.map((i) => i.id)).toContain('freeze_to_col')
    expect(colItems.map((i) => i.id)).toContain('open_col_style')
    expect(colItems.map((i) => i.id)).toContain('delete_col')

    const lookupColItems = buildGridMenuItems(
      baseCtx({ mode: 'operator', region: 'col-header', column: COLUMNS[3]! }),
    )
    expect(lookupColItems.map((i) => i.id)).toContain('edit_lookup_col')

    const bodyItems = buildGridMenuItems(baseCtx({ mode: 'operator', region: 'body' }))
    expect(bodyItems.map((i) => i.id)).toContain('edit_cell')
    expect(bodyItems.map((i) => i.id)).toContain('open_selection_style')
    expect(bodyItems.map((i) => i.id)).toContain('clear_selection_style')
    expect(bodyItems.map((i) => i.id)).toContain('delete_row')
  })
})

describe('选区样式、列显隐排序、汇总选项与导入导出', () => {
  test('applyCellStyleToSelection 支持批量设置与清除选区自定义配色', () => {
    const selection = {
      ranges: [
        {
          start: { col: 1, row: 0 },
          end: { col: 2, row: 1 },
          recordIds: ['r1', 'r2'],
          columnKeys: ['status', 'amount'],
        },
      ],
      recordIds: ['r1', 'r2'],
      columnKeys: ['status', 'amount'],
      focus: { col: 1, row: 0 },
    }
    const styled = applyCellStyleToSelection(undefined, selection, {
      bgColor: '#fef9c3',
      textColor: '#854d0e',
    })
    expect(styled?.r1?.status).toEqual({ bgColor: '#fef9c3', textColor: '#854d0e' })
    expect(styled?.r2?.amount).toEqual({ bgColor: '#fef9c3', textColor: '#854d0e' })

    const cleared = applyCellStyleToSelection(styled, selection, null)
    expect(cleared).toBeUndefined()
  })

  test('normalizeColumnOrder / reorderStringList / toggleHiddenColumn 保持至少 1 列可见', () => {
    expect(normalizeColumnOrder(COLUMNS, ['amount', 'code'])).toEqual([
      'amount',
      'code',
      'status',
      'dept',
    ])
    expect(reorderStringList(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(toggleHiddenColumn(COLUMNS, ['status', 'amount', 'dept'], 'code')).toBeNull()
    expect(toggleHiddenColumn(COLUMNS, ['status'], 'status')).toEqual([])
  })

  test('getAvailableSummaryTypes 区分数值列与非数值列', () => {
    expect(getAvailableSummaryTypes(COLUMNS[2]!)).toContain('sum')
    expect(getAvailableSummaryTypes(COLUMNS[2]!)).toContain('avg')
    expect(getAvailableSummaryTypes(COLUMNS[0]!)).toEqual(['none', 'count', 'filled_rate'])
  })

  test('CSV 与 XLSX 导出可生成合法内容与可解析工作簿', async () => {
    const csv = formatRecordsAsCsv(COLUMNS, RECORDS)
    expect(csv.startsWith('\uFEFF编号,状态,合同金额,部门')).toBe(true)
    expect(csv).toContain('"市场,一组"')

    const bytes = await buildRecordsXlsxBytes('测试导出', COLUMNS, RECORDS)
    const wb = await readXlsx(bytes)
    expect(wb.sheets[0]?.name).toBe('测试导出')
    expect(wb.sheets[0]?.rows[0]).toEqual(['编号', '状态', '合同金额', '部门'])
    expect(wb.sheets[0]?.rows[1]).toEqual(['PRJ-01', '进行中', 12000, '研发部'])
  })

  test('buildDefaultViewPayload 为四类视图生成合理初始配置', () => {
    const bundle: TableBundle = {
      meta: {
        id: 'tbl_demo',
        name: '示例表',
        kind: 'normal',
        columns: COLUMNS,
        views: [],
        summaries: {},
      },
      records: RECORDS,
    }
    expect(buildDefaultViewPayload('表格', 'table', bundle).rowHeight).toBe('standard')
    expect(buildDefaultViewPayload('看板', 'kanban', bundle).kanbanConfig?.groupByField).toBe(
      'status',
    )
    expect(buildDefaultViewPayload('透视', 'pivot', bundle).pivotConfig?.rowDimensions).toEqual([
      'status',
    ])
    expect(
      buildDefaultViewPayload('仪表盘', 'dashboard', bundle).dashboardConfig?.kpis.length,
    ).toBeGreaterThan(0)
  })
})
