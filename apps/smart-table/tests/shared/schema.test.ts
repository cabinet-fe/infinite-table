import { describe, expect, it } from 'vitest'
import {
  DERIVED_COLUMN_TYPES,
  MAX_DECIMAL_PLACES,
  MIN_DECIMAL_PLACES,
  RAW_COLUMN_TYPES,
  ROW_HEIGHT_VALUES,
  filterRawColumns,
  isDerivedColumn,
  isDerivedColumnType,
  isRawColumnType,
  isValidDecimalPlaces,
  mergeSmartColumns,
  splitColumnsByLayer,
  type ConditionalFormatRule,
  type DashboardChartType,
  type DashboardConfig,
  type DashboardKpiIcon,
  type KanbanConfig,
  type SmartApp,
  type SmartColumn,
  type SmartViewType,
  type WorkspaceView,
} from '../../src/shared/schema'

describe('shared schema extensions', () => {
  it('ROW_HEIGHT_VALUES 提供三档标准像素行高映射', () => {
    expect(ROW_HEIGHT_VALUES).toEqual({
      compact: 32,
      standard: 38,
      comfortable: 52,
    })
  })

  it('WorkspaceView 契约兼容四类视图与多层次样式配置', () => {
    const types: SmartViewType[] = ['table', 'kanban', 'pivot', 'dashboard']
    expect(types).toHaveLength(4)

    const cfRule: ConditionalFormatRule = {
      id: 'cf_1',
      field: 'status',
      operator: 'eq',
      value: '风险预警',
      scope: 'row',
      bgColor: '#fef2f2',
      textColor: '#991b1b',
    }
    const kanbanConfig: KanbanConfig = {
      groupByField: 'status',
      titleField: 'project_name',
      displayFields: ['owner_name', 'contract_amount'],
      laneOrder: ['待启动', '进行中', '已交付'],
    }
    const dashboardConfig: DashboardConfig = {
      kpis: [{ id: 'k1', title: '总数', field: '', agg: 'count' }],
      charts: [
        {
          id: 'c1',
          title: '状态分布',
          chartType: 'pie',
          dimensionField: 'status',
          measureField: '',
          agg: 'count',
          donut: true,
        },
      ],
    }

    const view: WorkspaceView = {
      id: 'view_1',
      appId: 'app_1',
      tableId: 'tbl_projects',
      name: '示例视图',
      type: 'table',
      sortOrder: 0,
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['status'],
      sortRules: [],
      columnOrder: ['project_code', 'project_name'],
      hiddenColumns: ['doc_url'],
      columnWidths: { project_name: 260 },
      frozenColCount: 2,
      rowHeight: 'comfortable',
      columnStyles: {
        contract_amount: { align: 'right', headerBgColor: '#eff6ff', bgColor: '#f8fafc' },
      },
      cellStyles: {
        rec_1: { project_name: { bgColor: '#fef9c3', textColor: '#854d0e' } },
      },
      conditionalFormats: [cfRule],
      kanbanConfig,
      dashboardConfig,
    }

    expect(view.tableId).toBe('tbl_projects')
    expect(view.conditionalFormats).toHaveLength(1)
    expect(view.kanbanConfig?.groupByField).toBe('status')
    expect(view.dashboardConfig?.charts[0]?.chartType).toBe('pie')
  })

  it('DashboardChartType 与 DashboardKpiConfig/DashboardChartConfig 支持六类图型、二级分组、堆叠与 KPI 图标', () => {
    const chartTypes: DashboardChartType[] = [
      'bar',
      'horizontalBar',
      'line',
      'area',
      'pie',
      'radar',
    ]
    const kpiIcons: DashboardKpiIcon[] = [
      'auto',
      'hash',
      'dollar',
      'percent',
      'trending',
      'award',
      'layers',
      'clock',
    ]
    expect(chartTypes).toHaveLength(6)
    expect(kpiIcons).toHaveLength(8)

    const config: DashboardConfig = {
      kpis: [
        { id: 'k1', title: '记录数', field: '__count__', agg: 'count', icon: 'auto' },
        {
          id: 'k2',
          title: '总金额',
          field: 'amount',
          agg: 'sum',
          numberFormat: 'currency',
          icon: 'dollar',
        },
      ],
      charts: [
        {
          id: 'c_hbar',
          title: '横向堆叠图',
          chartType: 'horizontalBar',
          dimensionField: 'region',
          seriesField: 'status',
          stacked: true,
          measureField: 'amount',
          agg: 'sum',
          limit: 5,
        },
        {
          id: 'c_area',
          title: '面积趋势图',
          chartType: 'area',
          dimensionField: 'month',
          seriesField: 'region',
          measureField: 'amount',
          agg: 'sum',
        },
        {
          id: 'c_radar',
          title: '能力雷达图',
          chartType: 'radar',
          dimensionField: 'category',
          seriesField: 'quarter',
          measureField: 'score',
          agg: 'avg',
        },
      ],
    }

    expect(config.kpis[0]?.icon).toBe('auto')
    expect(config.kpis[1]?.icon).toBe('dollar')
    expect(config.charts[0]?.seriesField).toBe('status')
    expect(config.charts[0]?.stacked).toBe(true)
    expect(config.charts[0]?.limit).toBe(5)
    expect(config.charts[1]?.chartType).toBe('area')
    expect(config.charts[2]?.chartType).toBe('radar')
  })

  it('SmartColumn 支持 required/align，SmartApp 支持 derivedColumns/lookupOverrides 及原始/派生拆分助手', () => {
    const rawCol: SmartColumn = {
      key: 'amount',
      title: '合同金额',
      type: 'number',
      width: 120,
      required: true,
      align: 'right',
      numberFormat: 'currency',
    }
    const lookupCol: SmartColumn = {
      key: 'lookup_dept',
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
    }
    const formulaCol: SmartColumn = {
      key: 'rate',
      title: '达成率',
      type: 'formula',
      width: 100,
      formulaExpr: '[paid] / [amount]',
    }

    const app: SmartApp = {
      id: 'app_prj',
      name: '项目管理台账',
      tableId: 'tbl_projects',
      sortOrder: 0,
      derivedColumns: [lookupCol, formulaCol],
      lookupOverrides: { rec_1: { grp_emp: 'emp_2' } },
    }

    expect(rawCol.required).toBe(true)
    expect(rawCol.align).toBe('right')
    expect(app.derivedColumns).toHaveLength(2)
    expect(app.lookupOverrides?.rec_1?.grp_emp).toBe('emp_2')

    expect(RAW_COLUMN_TYPES).not.toContain('lookup')
    expect(RAW_COLUMN_TYPES).not.toContain('formula')
    expect(DERIVED_COLUMN_TYPES).toEqual(['lookup', 'formula'])
    expect(isDerivedColumnType('lookup')).toBe(true)
    expect(isDerivedColumnType('formula')).toBe(true)
    expect(isDerivedColumnType('number')).toBe(false)
    expect(isRawColumnType('date')).toBe(true)
    expect(isRawColumnType('lookup')).toBe(false)
    expect(isDerivedColumn(lookupCol)).toBe(true)

    const mixed = [rawCol, lookupCol, formulaCol]
    expect(filterRawColumns(mixed)).toEqual([rawCol])
    expect(splitColumnsByLayer(mixed)).toEqual({
      rawColumns: [rawCol],
      derivedColumns: [lookupCol, formulaCol],
    })
    // mergeSmartColumns 自动过滤非法非派生列及与原始列重名列
    const merged = mergeSmartColumns(mixed, [
      { key: 'amount', title: '重复key', type: 'formula', width: 100, formulaExpr: '1' },
      { key: 'extra_raw', title: '非法原始列', type: 'text', width: 100 },
      lookupCol,
      formulaCol,
    ])
    expect(merged.map((c) => c.key)).toEqual(['amount', 'lookup_dept', 'rate'])
  })

  it('isValidDecimalPlaces 与 MIN/MAX_DECIMAL_PLACES 严格约束 0~6 整数', () => {
    expect(MIN_DECIMAL_PLACES).toBe(0)
    expect(MAX_DECIMAL_PLACES).toBe(6)
    for (let i = 0; i <= 6; i++) {
      expect(isValidDecimalPlaces(i)).toBe(true)
    }
    expect(isValidDecimalPlaces(-1)).toBe(false)
    expect(isValidDecimalPlaces(7)).toBe(false)
    expect(isValidDecimalPlaces(1.5)).toBe(false)
    expect(isValidDecimalPlaces(Number.NaN)).toBe(false)
    expect(isValidDecimalPlaces('2')).toBe(false)
    expect(isValidDecimalPlaces(null)).toBe(false)
    expect(isValidDecimalPlaces(undefined)).toBe(false)
  })
})
