// 六表联动全场景演示种子数据（共 6 张互关联表、121 行记录，事务包裹幂等初始化）：
// 1. tbl_projects《项目跟进与业绩总表》（normal，16 行，含重名消歧、边界行、3 视图）
// 2. tbl_employees《企业员工花名册》（advanced -> biz_employees，system，15 行，含同名“张三”）
// 3. tbl_payments《客户回款流水表》（advanced -> biz_payments，system，48 行，含大区与 3 视图）
// 4. tbl_inventory《产品库存与采购台账》（normal，16 行，关联供应商 + 双公式列 + 透视）
// 5. tbl_suppliers《供应商名录》（normal，8 行，含 { url, text } 官网链接）
// 6. tbl_tickets《客户工单与 SLA 追踪》（normal，18 行，关联项目表 + SLA 公式 + 透视）
//
// 种子版本约定：SEED_VERSION 随种子内容演进 +1（列序、行数据、system 标记等任何变化都要升），
// 存 PRAGMA user_version；ensureSeeded 依据它对旧库自愈重种（见文件尾部）。
import type { Database } from 'bun:sqlite'
import type {
  SmartColumn,
  SmartRecord,
  SmartView,
  SummaryType,
  WorkspaceView,
} from '../shared/schema'
import { runInTransaction } from './db'

/**
 * 当前种子版本。历史沿革：
 * - <2（含未写入 user_version 的旧库）：初始六表种子（进阶表无 system 标记、项目表 lookup 列离 owner_name 较远）
 * - 2：进阶表补 system:true；项目表默认视图列序调整（lookup_emp_id/dept/level 紧邻 owner_name，
 *   rollup 汇总列前置），打开即见关联查找示例
 * - 3：新增独立应用视图空间（workspace_views），预置跨 6 表的四类示范应用视图
 *   （含列样式/选区样式/条件格式/冻结列/汇总的表格、看板、多维透视、KPI+图表仪表盘）
 * - 4：补齐企业员工花名册与供应商名录应用视图，确保 6 张种子表均可在应用视图空间直接浏览
 */
export const SEED_VERSION = 4

/** 种子内置表 id 集合：smart_tables 中出现集合之外的表即视为用户自建表 */
const SEED_TABLE_IDS: ReadonlySet<string> = new Set([
  'tbl_projects',
  'tbl_employees',
  'tbl_payments',
  'tbl_inventory',
  'tbl_suppliers',
  'tbl_tickets',
])

function readSeedVersion(db: Database): number {
  const row = db.query('PRAGMA user_version').get() as { user_version?: number } | undefined | null
  return row?.user_version ?? 0
}

function writeSeedVersion(db: Database, version: number): void {
  db.exec(`PRAGMA user_version = ${version};`)
}

function buildSvgThumbDataUrl(label: string, accent: string): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="52" viewBox="0 0 96 52">',
    '<rect width="96" height="52" rx="6" fill="#0f172a"/>',
    `<rect x="6" y="7" width="34" height="14" rx="3" fill="${accent}" fill-opacity="0.22" stroke="${accent}" stroke-width="1.2"/>`,
    '<rect x="56" y="7" width="34" height="14" rx="3" fill="#38bdf8" fill-opacity="0.2" stroke="#38bdf8" stroke-width="1.2"/>',
    '<rect x="26" y="31" width="44" height="14" rx="3" fill="#22c55e" fill-opacity="0.2" stroke="#22c55e" stroke-width="1.2"/>',
    '<path d="M40 14 H56 M23 21 L40 31 M73 21 L56 31" stroke="#94a3b8" stroke-width="1.2" fill="none"/>',
    `<text x="48" y="41" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#e2e8f0">${label}</text>`,
    '</svg>',
  ].join('')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const PROJECT_STATUS_OPTIONS = [
  { label: '进行中', color: '#dbeafe', textColor: '#1d4ed8' },
  { label: '已交付', color: '#dcfce7', textColor: '#15803d' },
  { label: '风险预警', color: '#fee2e2', textColor: '#b91c1c' },
  { label: '待启动', color: '#f1f5f9', textColor: '#475569' },
]

const DEPT_OPTIONS = [
  { label: '研发部', color: '#e0e7ff', textColor: '#3730a3' },
  { label: '华东销售部', color: '#fef3c7', textColor: '#b45309' },
  { label: '华北销售部', color: '#fce7f3', textColor: '#be185d' },
  { label: '华南销售部', color: '#dcfce7', textColor: '#15803d' },
  { label: '西南销售部', color: '#cffafe', textColor: '#0e7490' },
  { label: '解决方案部', color: '#ede9fe', textColor: '#6d28d9' },
  { label: '交付实施部', color: '#ffedd5', textColor: '#c2410c' },
  { label: '产品研发部', color: '#dbeafe', textColor: '#1d4ed8' },
  { label: '财务风控部', color: '#f1f5f9', textColor: '#334155' },
  { label: '采购供应链部', color: '#fae8ff', textColor: '#a21caf' },
]

const LEVEL_OPTIONS = [
  { label: 'P6', color: '#f1f5f9', textColor: '#475569' },
  { label: 'P7', color: '#dbeafe', textColor: '#1d4ed8' },
  { label: 'P8', color: '#fef3c7', textColor: '#b45309' },
]

const REGION_OPTIONS = [
  { label: '华南大区', color: '#dcfce7', textColor: '#15803d' },
  { label: '华东大区', color: '#dbeafe', textColor: '#1d4ed8' },
  { label: '华北大区', color: '#fce7f3', textColor: '#be185d' },
  { label: '西南大区', color: '#ffedd5', textColor: '#c2410c' },
]

const YEAR_OPTIONS = [
  { label: '2024年', color: '#f1f5f9', textColor: '#475569' },
  { label: '2025年', color: '#dbeafe', textColor: '#1d4ed8' },
]

const PAY_METHOD_OPTIONS = [
  { label: '银行电汇', color: '#dbeafe', textColor: '#1d4ed8' },
  { label: '承兑汇票', color: '#fef3c7', textColor: '#b45309' },
  { label: '支票', color: '#ede9fe', textColor: '#6d28d9' },
  { label: '线上对公', color: '#dcfce7', textColor: '#15803d' },
]

const INVENTORY_CATEGORY_OPTIONS = [
  { label: '核心主机', color: '#dbeafe', textColor: '#1d4ed8' },
  { label: '传感模块', color: '#dcfce7', textColor: '#15803d' },
  { label: '工业网关', color: '#ede9fe', textColor: '#6d28d9' },
  { label: '电源配件', color: '#fef3c7', textColor: '#b45309' },
  { label: '辅材耗材', color: '#f1f5f9', textColor: '#475569' },
]

const WAREHOUSE_OPTIONS = [
  { label: '华东仓', color: '#dbeafe', textColor: '#1d4ed8' },
  { label: '华南仓', color: '#dcfce7', textColor: '#15803d' },
  { label: '华北仓', color: '#fce7f3', textColor: '#be185d' },
  { label: '西南仓', color: '#ffedd5', textColor: '#c2410c' },
]

const TICKET_CATEGORY_OPTIONS = [
  { label: '功能咨询', color: '#dbeafe', textColor: '#1d4ed8' },
  { label: '接口故障', color: '#fee2e2', textColor: '#b91c1c' },
  { label: '性能调优', color: '#ede9fe', textColor: '#6d28d9' },
  { label: '权限配置', color: '#fef3c7', textColor: '#b45309' },
  { label: '账务结算', color: '#dcfce7', textColor: '#15803d' },
]

const TICKET_PRIORITY_OPTIONS = [
  { label: 'P0 紧急', color: '#fee2e2', textColor: '#b91c1c' },
  { label: 'P1 高', color: '#ffedd5', textColor: '#c2410c' },
  { label: 'P2 中', color: '#dbeafe', textColor: '#1d4ed8' },
  { label: 'P3 低', color: '#f1f5f9', textColor: '#475569' },
]

const TICKET_STATUS_OPTIONS = [
  { label: '待受理', color: '#f1f5f9', textColor: '#475569' },
  { label: '处理中', color: '#dbeafe', textColor: '#1d4ed8' },
  { label: '待客户确认', color: '#fef3c7', textColor: '#b45309' },
  { label: '已关闭', color: '#dcfce7', textColor: '#15803d' },
]

interface TableMetaParts {
  columns: SmartColumn[]
  views: SmartView[]
  summaries: Record<string, SummaryType>
}

function buildProjectsMeta(): TableMetaParts {
  // 列序约定：lookup_emp_id/dept/level 紧邻 owner_name（首屏可见关联查找示例，含张三重名冲突），
  // rollup 汇总（累计回款/笔数/达成率）随后前置，富媒体与长文本列靠后
  const columns: SmartColumn[] = [
    { key: 'project_code', title: '项目编号', type: 'text', width: 130 },
    { key: 'project_name', title: '项目名称', type: 'text', width: 220 },
    { key: 'owner_name', title: '负责人', type: 'person', width: 130 },
    // VLOOKUP 1：一对一跨表关联员工花名册（共享 groupId: 'grp_emp'）
    {
      key: 'lookup_emp_id',
      title: '唯一工号',
      type: 'lookup',
      width: 125,
      lookupConfig: {
        groupId: 'grp_emp',
        targetTableId: 'tbl_employees',
        matchRules: [{ sourceField: 'owner_name', targetField: 'name' }],
        targetReturnField: 'emp_id',
        mode: 'one',
      },
    },
    {
      key: 'lookup_emp_dept',
      title: '所属部门',
      type: 'lookup',
      width: 135,
      lookupConfig: {
        groupId: 'grp_emp',
        targetTableId: 'tbl_employees',
        matchRules: [{ sourceField: 'owner_name', targetField: 'name' }],
        targetReturnField: 'dept',
        mode: 'one',
      },
    },
    {
      key: 'lookup_emp_level',
      title: '负责人职级',
      type: 'lookup',
      width: 110,
      lookupConfig: {
        groupId: 'grp_emp',
        targetTableId: 'tbl_employees',
        matchRules: [{ sourceField: 'owner_name', targetField: 'name' }],
        targetReturnField: 'level',
        mode: 'one',
      },
    },
    // VLOOKUP 2：一对多 Rollup 关联客户回款流水表（共享 groupId: 'grp_pay'）
    {
      key: 'lookup_paid_sum',
      title: '累计回款金额',
      type: 'lookup',
      width: 145,
      numberFormat: 'currency',
      lookupConfig: {
        groupId: 'grp_pay',
        targetTableId: 'tbl_payments',
        matchRules: [{ sourceField: 'project_code', targetField: 'project_code' }],
        targetReturnField: 'amount',
        mode: 'rollup',
        rollupAgg: 'sum',
      },
    },
    {
      key: 'lookup_paid_count',
      title: '回款笔数',
      type: 'lookup',
      width: 100,
      numberFormat: 'integer',
      lookupConfig: {
        groupId: 'grp_pay',
        targetTableId: 'tbl_payments',
        matchRules: [{ sourceField: 'project_code', targetField: 'project_code' }],
        targetReturnField: 'pay_id',
        mode: 'rollup',
        rollupAgg: 'count',
      },
    },
    // 整列计算公式列
    {
      key: 'formula_pay_rate',
      title: '回款达成率',
      type: 'formula',
      width: 120,
      formulaExpr: '[lookup_paid_sum] / [contract_amount]',
      numberFormat: 'percent',
    },
    { key: 'region', title: '所属大区', type: 'select', width: 115, options: REGION_OPTIONS },
    {
      key: 'status',
      title: '项目状态',
      type: 'select',
      width: 115,
      options: PROJECT_STATUS_OPTIONS,
    },
    { key: 'plan_delivery_date', title: '计划交付日', type: 'date', width: 120 },
    { key: 'progress', title: '项目进度', type: 'progress', width: 130 },
    {
      key: 'contract_amount',
      title: '合同总额',
      type: 'number',
      width: 140,
      numberFormat: 'currency',
    },
    { key: 'verified', title: '财务已核验', type: 'checkbox', width: 105 },
    { key: 'blueprint_img', title: '架构缩略图', type: 'image', width: 115 },
    { key: 'doc_url', title: '立项书链接', type: 'link', width: 195 },
  ]

  const views: SmartView[] = [
    {
      id: 'view_projects_table',
      name: '全部项目明细',
      type: 'table',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['status', 'region', 'lookup_emp_dept'],
      sortRules: [],
    },
    {
      id: 'view_projects_pivot',
      name: '部门 × 状态业绩多维分析',
      type: 'pivot',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['status', 'region'],
      sortRules: [],
      pivotConfig: {
        rowDimensions: ['lookup_emp_dept', 'lookup_emp_level'],
        columnDimensions: ['status'],
        measures: [
          { key: 'm_contract', title: '合同总额', field: 'contract_amount', agg: 'sum' },
          { key: 'm_paid', title: '累计回款', field: 'lookup_paid_sum', agg: 'sum' },
          { key: 'm_count', title: '项目数', field: '', agg: 'count' },
        ],
        showGrandTotal: true,
        collapsible: true,
      },
    },
    {
      id: 'view_projects_risk',
      name: '高风险与未核验项目',
      type: 'table',
      filterGroup: {
        conjunction: 'or',
        conditions: [
          { id: 'flt_risk_status', field: 'status', operator: 'eq', value: '风险预警' },
          { id: 'flt_risk_verified', field: 'verified', operator: 'eq', value: false },
        ],
      },
      quickFilterFields: ['status', 'region'],
      sortRules: [{ field: 'contract_amount', direction: 'desc' }],
    },
  ]

  const summaries: Record<string, SummaryType> = {
    contract_amount: 'sum',
    lookup_paid_sum: 'sum',
    lookup_paid_count: 'sum',
    progress: 'avg',
    formula_pay_rate: 'avg',
    verified: 'filled_rate',
  }

  return { columns, views, summaries }
}

function buildEmployeesMeta(): TableMetaParts {
  const columns: SmartColumn[] = [
    { key: 'emp_id', title: '工号', type: 'text', width: 120, isUniqueKey: true },
    { key: 'name', title: '姓名', type: 'person', width: 130 },
    { key: 'dept', title: '所属部门', type: 'select', width: 140, options: DEPT_OPTIONS },
    { key: 'level', title: '职级', type: 'select', width: 100, options: LEVEL_OPTIONS },
    { key: 'region', title: '负责大区', type: 'select', width: 120, options: REGION_OPTIONS },
    { key: 'email', title: '企业邮箱', type: 'text', width: 220 },
  ]

  const views: SmartView[] = [
    {
      id: 'view_emp_table',
      name: '员工花名册明细',
      type: 'table',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['dept', 'region', 'level'],
      sortRules: [],
    },
  ]

  return { columns, views, summaries: { emp_id: 'count' } }
}

function buildPaymentsMeta(): TableMetaParts {
  const columns: SmartColumn[] = [
    { key: 'pay_id', title: '流水号', type: 'text', width: 140, isUniqueKey: true },
    { key: 'project_code', title: '关联项目编号', type: 'text', width: 140 },
    { key: 'customer_name', title: '客户名称', type: 'text', width: 190 },
    { key: 'pay_date', title: '回款日期', type: 'date', width: 125 },
    { key: 'year', title: '年份', type: 'select', width: 100, options: YEAR_OPTIONS },
    { key: 'month', title: '月份', type: 'text', width: 95 },
    { key: 'region', title: '所属大区', type: 'select', width: 115, options: REGION_OPTIONS },
    { key: 'amount', title: '回款金额', type: 'number', width: 140, numberFormat: 'currency' },
    {
      key: 'pay_method',
      title: '结算方式',
      type: 'select',
      width: 125,
      options: PAY_METHOD_OPTIONS,
    },
  ]

  const views: SmartView[] = [
    {
      id: 'view_payments_table',
      name: '回款流水明细',
      type: 'table',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['year', 'region', 'pay_method'],
      sortRules: [{ field: 'pay_date', direction: 'desc' }],
    },
    {
      id: 'view_payments_pivot',
      name: '年度 × 方式回款分析',
      type: 'pivot',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['year', 'region'],
      sortRules: [],
      pivotConfig: {
        rowDimensions: ['year', 'month'],
        columnDimensions: ['pay_method'],
        measures: [
          { key: 'm_amount', title: '回款金额', field: 'amount', agg: 'sum' },
          { key: 'm_cnt', title: '笔数', field: '', agg: 'count' },
        ],
        showGrandTotal: true,
        collapsible: true,
      },
    },
    {
      id: 'view_payments_region_pivot',
      name: '年度 × 月度 × 大区透视',
      type: 'pivot',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['year'],
      sortRules: [],
      pivotConfig: {
        rowDimensions: ['year', 'month'],
        columnDimensions: ['region'],
        measures: [
          { key: 'm_amount', title: '回款金额', field: 'amount', agg: 'sum' },
          { key: 'm_cnt', title: '笔数', field: '', agg: 'count' },
        ],
        showGrandTotal: true,
        collapsible: true,
      },
    },
  ]

  return { columns, views, summaries: { pay_id: 'count', amount: 'sum' } }
}

function buildInventoryMeta(): TableMetaParts {
  const columns: SmartColumn[] = [
    { key: 'sku', title: 'SKU 编码', type: 'text', width: 130, isUniqueKey: true },
    { key: 'product_name', title: '产品名称', type: 'text', width: 200 },
    {
      key: 'category',
      title: '产品类别',
      type: 'select',
      width: 115,
      options: INVENTORY_CATEGORY_OPTIONS,
    },
    {
      key: 'warehouse_region',
      title: '仓库大区',
      type: 'select',
      width: 110,
      options: WAREHOUSE_OPTIONS,
    },
    {
      key: 'current_stock',
      title: '当前库存',
      type: 'number',
      width: 110,
      numberFormat: 'integer',
    },
    { key: 'safety_stock', title: '安全库存', type: 'number', width: 110, numberFormat: 'integer' },
    { key: 'capacity_rate', title: '库容占用率', type: 'progress', width: 125 },
    { key: 'counted', title: '已盘点', type: 'checkbox', width: 90 },
    { key: 'product_img', title: '产品图', type: 'image', width: 110 },
    { key: 'po_link', title: '采购单链接', type: 'link', width: 175 },
    { key: 'supplier_code', title: '供应商编码', type: 'text', width: 115 },
    {
      key: 'lookup_supplier_name',
      title: '供应商名称',
      type: 'lookup',
      width: 180,
      lookupConfig: {
        groupId: 'grp_sup',
        targetTableId: 'tbl_suppliers',
        matchRules: [{ sourceField: 'supplier_code', targetField: 'supplier_id' }],
        targetReturnField: 'supplier_name',
        mode: 'one',
      },
    },
    {
      key: 'lookup_lead_days',
      title: '标准交期(天)',
      type: 'lookup',
      width: 120,
      numberFormat: 'integer',
      lookupConfig: {
        groupId: 'grp_sup',
        targetTableId: 'tbl_suppliers',
        matchRules: [{ sourceField: 'supplier_code', targetField: 'supplier_id' }],
        targetReturnField: 'lead_days',
        mode: 'one',
      },
    },
    {
      key: 'formula_stock_gap',
      title: '库存缺口',
      type: 'formula',
      width: 110,
      formulaExpr: '[安全库存] - [当前库存]',
      numberFormat: 'integer',
    },
    {
      key: 'formula_restock_alert',
      title: '补货预警',
      type: 'formula',
      width: 110,
      formulaExpr: 'IF([当前库存] < [安全库存], "需补货", "充足")',
    },
  ]

  const views: SmartView[] = [
    {
      id: 'view_inv_table',
      name: '库存台账明细',
      type: 'table',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['category', 'warehouse_region', 'formula_restock_alert'],
      sortRules: [{ field: 'formula_stock_gap', direction: 'desc' }],
    },
    {
      id: 'view_inv_pivot',
      name: '类别 × 仓库大区库存分析',
      type: 'pivot',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['category'],
      sortRules: [],
      pivotConfig: {
        rowDimensions: ['category'],
        columnDimensions: ['warehouse_region'],
        measures: [
          { key: 'm_stock', title: '现有库存', field: 'current_stock', agg: 'sum' },
          { key: 'm_gap', title: '库存缺口', field: 'formula_stock_gap', agg: 'sum' },
          { key: 'm_sku_cnt', title: 'SKU数', field: '', agg: 'count' },
        ],
        showGrandTotal: true,
        collapsible: true,
      },
    },
  ]

  return {
    columns,
    views,
    summaries: {
      current_stock: 'sum',
      safety_stock: 'sum',
      formula_stock_gap: 'sum',
      capacity_rate: 'avg',
      counted: 'filled_rate',
    },
  }
}

function buildSuppliersMeta(): TableMetaParts {
  const columns: SmartColumn[] = [
    { key: 'supplier_id', title: '供应商编号', type: 'text', width: 130, isUniqueKey: true },
    { key: 'supplier_name', title: '供应商名称', type: 'text', width: 210 },
    {
      key: 'main_category',
      title: '主营品类',
      type: 'select',
      width: 120,
      options: INVENTORY_CATEGORY_OPTIONS,
    },
    { key: 'rating', title: '综合评分', type: 'number', width: 110, numberFormat: 'decimal' },
    {
      key: 'lead_days',
      title: '标准交期天数',
      type: 'number',
      width: 125,
      numberFormat: 'integer',
    },
    { key: 'contact_person', title: '联系人', type: 'person', width: 120 },
    { key: 'website', title: '官网', type: 'link', width: 200 },
  ]

  const views: SmartView[] = [
    {
      id: 'view_sup_table',
      name: '供应商名录明细',
      type: 'table',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['main_category'],
      sortRules: [{ field: 'rating', direction: 'desc' }],
    },
  ]

  return {
    columns,
    views,
    summaries: { supplier_id: 'count', rating: 'avg', lead_days: 'avg' },
  }
}

function buildTicketsMeta(): TableMetaParts {
  const columns: SmartColumn[] = [
    { key: 'ticket_id', title: '工单号', type: 'text', width: 130, isUniqueKey: true },
    { key: 'customer_name', title: '客户名称', type: 'text', width: 185 },
    { key: 'project_code', title: '关联项目编号', type: 'text', width: 135 },
    {
      key: 'lookup_project_name',
      title: '关联项目名称',
      type: 'lookup',
      width: 200,
      lookupConfig: {
        groupId: 'grp_ticket_prj',
        targetTableId: 'tbl_projects',
        matchRules: [{ sourceField: 'project_code', targetField: 'project_code' }],
        targetReturnField: 'project_name',
        mode: 'one',
      },
    },
    {
      key: 'issue_category',
      title: '问题分类',
      type: 'select',
      width: 115,
      options: TICKET_CATEGORY_OPTIONS,
    },
    {
      key: 'priority',
      title: '优先级',
      type: 'select',
      width: 110,
      options: TICKET_PRIORITY_OPTIONS,
    },
    { key: 'assignee', title: '处理人', type: 'person', width: 115 },
    {
      key: 'ticket_status',
      title: '处理状态',
      type: 'select',
      width: 115,
      options: TICKET_STATUS_OPTIONS,
    },
    { key: 'sla_progress', title: '响应进度', type: 'progress', width: 125 },
    { key: 'created_date', title: '受理日期', type: 'date', width: 120 },
    { key: 'is_overdue', title: '是否超时', type: 'checkbox', width: 95 },
    {
      key: 'formula_sla_flag',
      title: 'SLA 状态',
      type: 'formula',
      width: 110,
      formulaExpr: 'IF([是否超时], "SLA违约", "正常")',
    },
  ]

  const views: SmartView[] = [
    {
      id: 'view_tickets_table',
      name: '全部客户工单',
      type: 'table',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['priority', 'ticket_status', 'issue_category'],
      sortRules: [{ field: 'created_date', direction: 'desc' }],
    },
    {
      id: 'view_tickets_pivot',
      name: '优先级 × 处理状态工单分布',
      type: 'pivot',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['issue_category'],
      sortRules: [],
      pivotConfig: {
        rowDimensions: ['priority'],
        columnDimensions: ['ticket_status'],
        measures: [
          { key: 'm_cnt', title: '工单数', field: '', agg: 'count' },
          { key: 'm_sla', title: '平均响应进度', field: 'sla_progress', agg: 'avg' },
        ],
        showGrandTotal: true,
        collapsible: true,
      },
    },
  ]

  return {
    columns,
    views,
    summaries: { ticket_id: 'count', sla_progress: 'avg', is_overdue: 'filled_rate' },
  }
}

const PROJECT_RECORDS: SmartRecord[] = [
  {
    _id: 'rec_prj_001',
    project_code: 'PRJ-2025-001',
    project_name: '星辰智能制造 MES 平台',
    // 故意不设 _lookupOverrides，用于开箱展示「⚠️ 2条重名」未消歧冲突
    owner_name: '张三',
    region: '华南大区',
    status: '进行中',
    plan_delivery_date: '2025-09-30',
    progress: 75,
    contract_amount: 1200000,
    verified: true,
    blueprint_img: buildSvgThumbDataUrl('MES', '#38bdf8'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-001',
  },
  {
    _id: 'rec_prj_002',
    project_code: 'PRJ-2025-002',
    project_name: '华北电力数字孪生系统',
    owner_name: '李四',
    region: '华北大区',
    status: '已交付',
    plan_delivery_date: '2025-04-30',
    progress: 100,
    contract_amount: 850000,
    verified: true,
    blueprint_img: buildSvgThumbDataUrl('TWIN', '#22c55e'),
    doc_url: { url: 'https://docs.example.com/projects/PRJ-2025-002', text: '电力孪生立项书 v2.1' },
  },
  {
    _id: 'rec_prj_003',
    project_code: 'PRJ-2025-003',
    project_name: '粤港澳跨境支付风控中台',
    owner_name: '王五',
    region: '华南大区',
    status: '已交付',
    plan_delivery_date: '2025-05-15',
    progress: 100,
    contract_amount: 1600000,
    verified: true,
    blueprint_img: buildSvgThumbDataUrl('RISK', '#a855f7'),
    doc_url: { url: 'https://docs.example.com/projects/PRJ-2025-003', text: '跨境支付架构方案' },
  },
  {
    _id: 'rec_prj_004',
    project_code: 'PRJ-2025-004',
    project_name: '长三角智慧物流调度云',
    owner_name: '赵六',
    region: '华东大区',
    status: '进行中',
    plan_delivery_date: '2025-10-20',
    progress: 65,
    contract_amount: 980000,
    verified: true,
    blueprint_img: buildSvgThumbDataUrl('TMS', '#f59e0b'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-004',
  },
  {
    _id: 'rec_prj_005',
    project_code: 'PRJ-2025-005',
    project_name: '西南医院医疗影像协同平台',
    owner_name: '钱七',
    region: '西南大区',
    status: '风险预警',
    plan_delivery_date: '2025-07-15',
    progress: 35,
    contract_amount: 720000,
    verified: false,
    blueprint_img: buildSvgThumbDataUrl('PACS', '#ef4444'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-005',
  },
  {
    _id: 'rec_prj_006',
    project_code: 'PRJ-2025-006',
    project_name: '华东零售全渠道数据湖项目',
    // 预置消歧锁定至华东销售部 EMP-009，与 PRJ-2025-001 形成「✅ 已锁定 vs ⚠️ 未消歧」对比
    owner_name: '张三',
    region: '华东大区',
    status: '进行中',
    plan_delivery_date: '2025-08-31',
    progress: 55,
    contract_amount: 1100000,
    verified: true,
    blueprint_img: buildSvgThumbDataUrl('LAKE', '#06b6d4'),
    doc_url: {
      url: 'https://docs.example.com/projects/PRJ-2025-006',
      text: '零售数据湖需求说明书',
    },
    _lookupOverrides: { grp_emp: 'EMP-009' },
  },
  {
    _id: 'rec_prj_007',
    project_code: 'PRJ-2025-007',
    project_name: '智联汽车研发 PLM 底座升级',
    owner_name: '孙八',
    region: '华北大区',
    status: '已交付',
    plan_delivery_date: '2025-03-20',
    progress: 100,
    contract_amount: 1400000,
    verified: true,
    blueprint_img: buildSvgThumbDataUrl('PLM', '#3b82f6'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-007',
  },
  {
    _id: 'rec_prj_008',
    project_code: 'PRJ-2025-008',
    project_name: '岭南供应链金融协同门户',
    owner_name: '周九',
    region: '华南大区',
    status: '风险预警',
    plan_delivery_date: '2025-08-10',
    progress: 25,
    contract_amount: 640000,
    verified: false,
    blueprint_img: buildSvgThumbDataUrl('SCF', '#f97316'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-008',
  },
  {
    _id: 'rec_prj_009',
    project_code: 'PRJ-2025-009',
    project_name: '江浙政务大数据治理一期',
    owner_name: '吴十',
    region: '华东大区',
    status: '进行中',
    plan_delivery_date: '2025-11-15',
    progress: 80,
    contract_amount: 900000,
    verified: true,
    blueprint_img: buildSvgThumbDataUrl('GOV', '#10b981'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-009',
  },
  {
    _id: 'rec_prj_010',
    project_code: 'PRJ-2025-010',
    project_name: '出海电商实时看板与 BI 底座',
    owner_name: '陈晨',
    region: '华南大区',
    status: '待启动',
    plan_delivery_date: '2025-12-20',
    progress: 10,
    contract_amount: 500000,
    verified: false,
    blueprint_img: buildSvgThumbDataUrl('BI', '#64748b'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-010',
  },
  {
    _id: 'rec_prj_011',
    project_code: 'PRJ-2025-011',
    project_name: '成渝双城工业互联网安全审计',
    // 边界用例：未匹配到花名册员工（lookup 一对一列展示 '-'）
    owner_name: '外部顾问-林夕',
    region: '西南大区',
    status: '进行中',
    plan_delivery_date: '2025-10-12',
    progress: 60,
    contract_amount: 460000,
    verified: true,
    blueprint_img: buildSvgThumbDataUrl('SEC', '#14b8a6'),
    doc_url: { url: 'https://docs.example.com/projects/PRJ-2025-011', text: '安全审计基线方案' },
  },
  {
    _id: 'rec_prj_012',
    project_code: 'PRJ-2025-012',
    project_name: '公益医疗 AI 辅助阅片联合试点',
    // 边界用例：0 笔回款且合同金额为 0，验证除零安全收敛为 0%
    owner_name: '黄浩',
    region: '西南大区',
    status: '待启动',
    plan_delivery_date: '2025-12-31',
    progress: 15,
    contract_amount: 0,
    verified: false,
    blueprint_img: buildSvgThumbDataUrl('AI', '#6366f1'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-012',
  },
  {
    _id: 'rec_prj_013',
    project_code: 'PRJ-2025-013',
    project_name: '待补充立项信息线索项目',
    // 边界用例：多字段留空，用于演示快捷筛选 '(空)' 与空值置底排序
    owner_name: '林琳',
    region: '',
    status: '',
    plan_delivery_date: '',
    progress: 0,
    contract_amount: 280000,
    verified: false,
    blueprint_img: buildSvgThumbDataUrl('TBD', '#94a3b8'),
    doc_url: '',
  },
  {
    _id: 'rec_prj_014',
    project_code: 'PRJ-2025-014',
    project_name: '京津冀智慧园区能耗管控中心',
    owner_name: '周雪',
    region: '华北大区',
    status: '已交付',
    plan_delivery_date: '2025-06-30',
    progress: 100,
    contract_amount: 1050000,
    verified: true,
    blueprint_img: buildSvgThumbDataUrl('EMS', '#22c55e'),
    doc_url: { url: 'https://docs.example.com/projects/PRJ-2025-014', text: '园区能耗验收报告' },
  },
  {
    _id: 'rec_prj_015',
    project_code: 'PRJ-2025-015',
    project_name: '沪杭生物医药 GMP 追溯云',
    owner_name: '郑凯',
    region: '华东大区',
    status: '进行中',
    plan_delivery_date: '2025-09-18',
    progress: 70,
    contract_amount: 1320000,
    verified: true,
    blueprint_img: buildSvgThumbDataUrl('GMP', '#0ea5e9'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-015',
  },
  {
    _id: 'rec_prj_016',
    project_code: 'PRJ-2025-016',
    project_name: '深港冷链物联网仓储中控',
    owner_name: '刘洋',
    region: '华南大区',
    status: '风险预警',
    plan_delivery_date: '2025-08-25',
    progress: 40,
    contract_amount: 880000,
    verified: false,
    blueprint_img: buildSvgThumbDataUrl('COLD', '#f43f5e'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-016',
  },
]

interface EmployeeSeedRow {
  emp_id: string
  name: string
  dept: string
  level: string
  region: string
  email: string
}

const EMPLOYEE_ROWS: EmployeeSeedRow[] = [
  {
    emp_id: 'EMP-001',
    name: '张三',
    dept: '研发部',
    level: 'P7',
    region: '华南大区',
    email: 'zhangsan.dev@company.com',
  },
  {
    emp_id: 'EMP-002',
    name: '李四',
    dept: '华北销售部',
    level: 'P7',
    region: '华北大区',
    email: 'lisi@company.com',
  },
  {
    emp_id: 'EMP-003',
    name: '王五',
    dept: '华南销售部',
    level: 'P8',
    region: '华南大区',
    email: 'wangwu@company.com',
  },
  {
    emp_id: 'EMP-004',
    name: '赵六',
    dept: '解决方案部',
    level: 'P7',
    region: '华东大区',
    email: 'zhaoliu@company.com',
  },
  {
    emp_id: 'EMP-005',
    name: '钱七',
    dept: '交付实施部',
    level: 'P6',
    region: '西南大区',
    email: 'qianqi@company.com',
  },
  {
    emp_id: 'EMP-006',
    name: '孙八',
    dept: '产品研发部',
    level: 'P8',
    region: '华北大区',
    email: 'sunba@company.com',
  },
  {
    emp_id: 'EMP-007',
    name: '周九',
    dept: '华南销售部',
    level: 'P6',
    region: '华南大区',
    email: 'zhoujiu@company.com',
  },
  {
    emp_id: 'EMP-008',
    name: '吴十',
    dept: '交付实施部',
    level: 'P7',
    region: '华东大区',
    email: 'wushi@company.com',
  },
  {
    emp_id: 'EMP-009',
    name: '张三',
    dept: '华东销售部',
    level: 'P6',
    region: '华东大区',
    email: 'zhangsan.sales@company.com',
  },
  {
    emp_id: 'EMP-010',
    name: '陈晨',
    dept: '解决方案部',
    level: 'P8',
    region: '华南大区',
    email: 'chenchen@company.com',
  },
  {
    emp_id: 'EMP-011',
    name: '林琳',
    dept: '财务风控部',
    level: 'P6',
    region: '华北大区',
    email: 'linlin@company.com',
  },
  {
    emp_id: 'EMP-012',
    name: '黄浩',
    dept: '西南销售部',
    level: 'P7',
    region: '西南大区',
    email: 'huanghao@company.com',
  },
  {
    emp_id: 'EMP-013',
    name: '周雪',
    dept: '华北销售部',
    level: 'P7',
    region: '华北大区',
    email: 'zhouxue@company.com',
  },
  {
    emp_id: 'EMP-014',
    name: '郑凯',
    dept: '采购供应链部',
    level: 'P7',
    region: '华东大区',
    email: 'zhengkai@company.com',
  },
  {
    emp_id: 'EMP-015',
    name: '刘洋',
    dept: '交付实施部',
    level: 'P6',
    region: '华南大区',
    email: 'liuyang@company.com',
  },
]

interface PaymentSeedRow {
  pay_id: string
  project_code: string
  customer_name: string
  pay_date: string
  year: string
  month: string
  region: string
  amount: number
  pay_method: string
}

const PAYMENT_ROWS: PaymentSeedRow[] = [
  // PRJ-2025-001（5 笔，华南大区）
  {
    pay_id: 'PAY-2024-001',
    project_code: 'PRJ-2025-001',
    customer_name: '星辰精密制造有限公司',
    pay_date: '2024-09-18',
    year: '2024年',
    month: '09月',
    region: '华南大区',
    amount: 200000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2024-002',
    project_code: 'PRJ-2025-001',
    customer_name: '星辰精密制造有限公司',
    pay_date: '2024-11-22',
    year: '2024年',
    month: '11月',
    region: '华南大区',
    amount: 180000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-003',
    project_code: 'PRJ-2025-001',
    customer_name: '星辰精密制造有限公司',
    pay_date: '2025-01-15',
    year: '2025年',
    month: '01月',
    region: '华南大区',
    amount: 170000,
    pay_method: '承兑汇票',
  },
  {
    pay_id: 'PAY-2025-004',
    project_code: 'PRJ-2025-001',
    customer_name: '星辰精密制造有限公司',
    pay_date: '2025-03-10',
    year: '2025年',
    month: '03月',
    region: '华南大区',
    amount: 150000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-005',
    project_code: 'PRJ-2025-001',
    customer_name: '星辰精密制造有限公司',
    pay_date: '2025-05-20',
    year: '2025年',
    month: '05月',
    region: '华南大区',
    amount: 200000,
    pay_method: '线上对公',
  },
  // PRJ-2025-002（4 笔，华北大区）
  {
    pay_id: 'PAY-2024-006',
    project_code: 'PRJ-2025-002',
    customer_name: '华北电网能源科技集团',
    pay_date: '2024-07-12',
    year: '2024年',
    month: '07月',
    region: '华北大区',
    amount: 250000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2024-007',
    project_code: 'PRJ-2025-002',
    customer_name: '华北电网能源科技集团',
    pay_date: '2024-10-25',
    year: '2024年',
    month: '10月',
    region: '华北大区',
    amount: 220000,
    pay_method: '承兑汇票',
  },
  {
    pay_id: 'PAY-2025-008',
    project_code: 'PRJ-2025-002',
    customer_name: '华北电网能源科技集团',
    pay_date: '2025-01-19',
    year: '2025年',
    month: '01月',
    region: '华北大区',
    amount: 200000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-009',
    project_code: 'PRJ-2025-002',
    customer_name: '华北电网能源科技集团',
    pay_date: '2025-04-08',
    year: '2025年',
    month: '04月',
    region: '华北大区',
    amount: 180000,
    pay_method: '银行电汇',
  },
  // PRJ-2025-003（5 笔，华南大区）
  {
    pay_id: 'PAY-2024-010',
    project_code: 'PRJ-2025-003',
    customer_name: '湾区通金融控股有限公司',
    pay_date: '2024-06-15',
    year: '2024年',
    month: '06月',
    region: '华南大区',
    amount: 320000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2024-011',
    project_code: 'PRJ-2025-003',
    customer_name: '湾区通金融控股有限公司',
    pay_date: '2024-09-28',
    year: '2024年',
    month: '09月',
    region: '华南大区',
    amount: 380000,
    pay_method: '线上对公',
  },
  {
    pay_id: 'PAY-2024-012',
    project_code: 'PRJ-2025-003',
    customer_name: '湾区通金融控股有限公司',
    pay_date: '2024-12-18',
    year: '2024年',
    month: '12月',
    region: '华南大区',
    amount: 300000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-013',
    project_code: 'PRJ-2025-003',
    customer_name: '湾区通金融控股有限公司',
    pay_date: '2025-02-21',
    year: '2025年',
    month: '02月',
    region: '华南大区',
    amount: 300000,
    pay_method: '支票',
  },
  {
    pay_id: 'PAY-2025-014',
    project_code: 'PRJ-2025-003',
    customer_name: '湾区通金融控股有限公司',
    pay_date: '2025-05-11',
    year: '2025年',
    month: '05月',
    region: '华南大区',
    amount: 300000,
    pay_method: '银行电汇',
  },
  // PRJ-2025-004（4 笔，华东大区）
  {
    pay_id: 'PAY-2024-015',
    project_code: 'PRJ-2025-004',
    customer_name: '长三角速运物流股份',
    pay_date: '2024-08-19',
    year: '2024年',
    month: '08月',
    region: '华东大区',
    amount: 148000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2024-016',
    project_code: 'PRJ-2025-004',
    customer_name: '长三角速运物流股份',
    pay_date: '2024-11-09',
    year: '2024年',
    month: '11月',
    region: '华东大区',
    amount: 150000,
    pay_method: '承兑汇票',
  },
  {
    pay_id: 'PAY-2025-017',
    project_code: 'PRJ-2025-004',
    customer_name: '长三角速运物流股份',
    pay_date: '2025-02-14',
    year: '2025年',
    month: '02月',
    region: '华东大区',
    amount: 140000,
    pay_method: '线上对公',
  },
  {
    pay_id: 'PAY-2025-018',
    project_code: 'PRJ-2025-004',
    customer_name: '长三角速运物流股份',
    pay_date: '2025-06-03',
    year: '2025年',
    month: '06月',
    region: '华东大区',
    amount: 150000,
    pay_method: '银行电汇',
  },
  // PRJ-2025-005（3 笔，西南大区）
  {
    pay_id: 'PAY-2024-019',
    project_code: 'PRJ-2025-005',
    customer_name: '华西医学中心',
    pay_date: '2024-10-14',
    year: '2024年',
    month: '10月',
    region: '西南大区',
    amount: 70000,
    pay_method: '支票',
  },
  {
    pay_id: 'PAY-2025-020',
    project_code: 'PRJ-2025-005',
    customer_name: '华西医学中心',
    pay_date: '2025-01-27',
    year: '2025年',
    month: '01月',
    region: '西南大区',
    amount: 60000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-021',
    project_code: 'PRJ-2025-005',
    customer_name: '华西医学中心',
    pay_date: '2025-04-18',
    year: '2025年',
    month: '04月',
    region: '西南大区',
    amount: 50000,
    pay_method: '线上对公',
  },
  // PRJ-2025-006（4 笔，华东大区）
  {
    pay_id: 'PAY-2024-022',
    project_code: 'PRJ-2025-006',
    customer_name: '申城新零售商业集团',
    pay_date: '2024-09-05',
    year: '2024年',
    month: '09月',
    region: '华东大区',
    amount: 150000,
    pay_method: '线上对公',
  },
  {
    pay_id: 'PAY-2024-023',
    project_code: 'PRJ-2025-006',
    customer_name: '申城新零售商业集团',
    pay_date: '2024-12-11',
    year: '2024年',
    month: '12月',
    region: '华东大区',
    amount: 120000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-024',
    project_code: 'PRJ-2025-006',
    customer_name: '申城新零售商业集团',
    pay_date: '2025-03-22',
    year: '2025年',
    month: '03月',
    region: '华东大区',
    amount: 130000,
    pay_method: '承兑汇票',
  },
  {
    pay_id: 'PAY-2025-025',
    project_code: 'PRJ-2025-006',
    customer_name: '申城新零售商业集团',
    pay_date: '2025-06-16',
    year: '2025年',
    month: '06月',
    region: '华东大区',
    amount: 150000,
    pay_method: '银行电汇',
  },
  // PRJ-2025-007（4 笔，华北大区）
  {
    pay_id: 'PAY-2024-026',
    project_code: 'PRJ-2025-007',
    customer_name: '智联新能源汽车科技',
    pay_date: '2024-05-20',
    year: '2024年',
    month: '05月',
    region: '华北大区',
    amount: 400000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2024-027',
    project_code: 'PRJ-2025-007',
    customer_name: '智联新能源汽车科技',
    pay_date: '2024-08-29',
    year: '2024年',
    month: '08月',
    region: '华北大区',
    amount: 350000,
    pay_method: '承兑汇票',
  },
  {
    pay_id: 'PAY-2024-028',
    project_code: 'PRJ-2025-007',
    customer_name: '智联新能源汽车科技',
    pay_date: '2024-11-30',
    year: '2024年',
    month: '11月',
    region: '华北大区',
    amount: 350000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-029',
    project_code: 'PRJ-2025-007',
    customer_name: '智联新能源汽车科技',
    pay_date: '2025-02-26',
    year: '2025年',
    month: '02月',
    region: '华北大区',
    amount: 300000,
    pay_method: '线上对公',
  },
  // PRJ-2025-008（2 笔，华南大区）
  {
    pay_id: 'PAY-2024-030',
    project_code: 'PRJ-2025-008',
    customer_name: '岭南商贸供应链公司',
    pay_date: '2024-12-03',
    year: '2024年',
    month: '12月',
    region: '华南大区',
    amount: 68000,
    pay_method: '支票',
  },
  {
    pay_id: 'PAY-2025-031',
    project_code: 'PRJ-2025-008',
    customer_name: '岭南商贸供应链公司',
    pay_date: '2025-03-08',
    year: '2025年',
    month: '03月',
    region: '华南大区',
    amount: 60000,
    pay_method: '银行电汇',
  },
  // PRJ-2025-009（4 笔，华东大区）
  {
    pay_id: 'PAY-2024-032',
    project_code: 'PRJ-2025-009',
    customer_name: '江浙数字政务研究院',
    pay_date: '2024-07-24',
    year: '2024年',
    month: '07月',
    region: '华东大区',
    amount: 180000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2024-033',
    project_code: 'PRJ-2025-009',
    customer_name: '江浙数字政务研究院',
    pay_date: '2024-10-31',
    year: '2024年',
    month: '10月',
    region: '华东大区',
    amount: 150000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-034',
    project_code: 'PRJ-2025-009',
    customer_name: '江浙数字政务研究院',
    pay_date: '2025-04-12',
    year: '2025年',
    month: '04月',
    region: '华东大区',
    amount: 160000,
    pay_method: '支票',
  },
  {
    pay_id: 'PAY-2025-035',
    project_code: 'PRJ-2025-009',
    customer_name: '江浙数字政务研究院',
    pay_date: '2025-06-25',
    year: '2025年',
    month: '06月',
    region: '华东大区',
    amount: 140000,
    pay_method: '线上对公',
  },
  // PRJ-2025-010（1 笔，华南大区）
  {
    pay_id: 'PAY-2025-036',
    project_code: 'PRJ-2025-010',
    customer_name: '海蓝跨境电商有限公司',
    pay_date: '2025-07-02',
    year: '2025年',
    month: '07月',
    region: '华南大区',
    amount: 50000,
    pay_method: '线上对公',
  },
  // PRJ-2025-011（2 笔，西南大区）
  {
    pay_id: 'PAY-2024-037',
    project_code: 'PRJ-2025-011',
    customer_name: '巴蜀智网安全科技',
    pay_date: '2024-11-12',
    year: '2024年',
    month: '11月',
    region: '西南大区',
    amount: 130000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-038',
    project_code: 'PRJ-2025-011',
    customer_name: '巴蜀智网安全科技',
    pay_date: '2025-04-22',
    year: '2025年',
    month: '04月',
    region: '西南大区',
    amount: 150000,
    pay_method: '线上对公',
  },
  // PRJ-2025-014（4 笔，华北大区）
  {
    pay_id: 'PAY-2024-039',
    project_code: 'PRJ-2025-014',
    customer_name: '京冀生态园区运营集团',
    pay_date: '2024-08-14',
    year: '2024年',
    month: '08月',
    region: '华北大区',
    amount: 300000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2024-040',
    project_code: 'PRJ-2025-014',
    customer_name: '京冀生态园区运营集团',
    pay_date: '2024-12-05',
    year: '2024年',
    month: '12月',
    region: '华北大区',
    amount: 250000,
    pay_method: '承兑汇票',
  },
  {
    pay_id: 'PAY-2025-041',
    project_code: 'PRJ-2025-014',
    customer_name: '京冀生态园区运营集团',
    pay_date: '2025-03-19',
    year: '2025年',
    month: '03月',
    region: '华北大区',
    amount: 250000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-042',
    project_code: 'PRJ-2025-014',
    customer_name: '京冀生态园区运营集团',
    pay_date: '2025-06-28',
    year: '2025年',
    month: '06月',
    region: '华北大区',
    amount: 250000,
    pay_method: '线上对公',
  },
  // PRJ-2025-015（4 笔，华东大区）
  {
    pay_id: 'PAY-2024-043',
    project_code: 'PRJ-2025-015',
    customer_name: '张江康泰生物制药',
    pay_date: '2024-09-10',
    year: '2024年',
    month: '09月',
    region: '华东大区',
    amount: 260000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2024-044',
    project_code: 'PRJ-2025-015',
    customer_name: '张江康泰生物制药',
    pay_date: '2024-12-20',
    year: '2024年',
    month: '12月',
    region: '华东大区',
    amount: 240000,
    pay_method: '支票',
  },
  {
    pay_id: 'PAY-2025-045',
    project_code: 'PRJ-2025-015',
    customer_name: '张江康泰生物制药',
    pay_date: '2025-02-27',
    year: '2025年',
    month: '02月',
    region: '华东大区',
    amount: 220000,
    pay_method: '银行电汇',
  },
  {
    pay_id: 'PAY-2025-046',
    project_code: 'PRJ-2025-015',
    customer_name: '张江康泰生物制药',
    pay_date: '2025-05-30',
    year: '2025年',
    month: '05月',
    region: '华东大区',
    amount: 200000,
    pay_method: '线上对公',
  },
  // PRJ-2025-016（2 笔，华南大区）
  {
    pay_id: 'PAY-2025-047',
    project_code: 'PRJ-2025-016',
    customer_name: '深港鲜速冷链仓储',
    pay_date: '2025-01-11',
    year: '2025年',
    month: '01月',
    region: '华南大区',
    amount: 180000,
    pay_method: '承兑汇票',
  },
  {
    pay_id: 'PAY-2025-048',
    project_code: 'PRJ-2025-016',
    customer_name: '深港鲜速冷链仓储',
    pay_date: '2025-04-29',
    year: '2025年',
    month: '04月',
    region: '华南大区',
    amount: 160000,
    pay_method: '银行电汇',
  },
]

const SUPPLIER_RECORDS: SmartRecord[] = [
  {
    _id: 'rec_sup_001',
    supplier_id: 'SUP-001',
    supplier_name: '苏州精工工控科技',
    main_category: '核心主机',
    rating: 4.9,
    lead_days: 7,
    contact_person: '沈工',
    website: { url: 'https://sup-001.example.com', text: '精工工控官网' },
  },
  {
    _id: 'rec_sup_002',
    supplier_id: 'SUP-002',
    supplier_name: '深圳微感传感股份',
    main_category: '传感模块',
    rating: 4.8,
    lead_days: 5,
    contact_person: '陆敏',
    website: { url: 'https://sup-002.example.com', text: '微感传感门户' },
  },
  {
    _id: 'rec_sup_003',
    supplier_id: 'SUP-003',
    supplier_name: '北京边缘智联网络',
    main_category: '工业网关',
    rating: 4.7,
    lead_days: 10,
    contact_person: '方明',
    website: { url: 'https://sup-003.example.com', text: '边缘智联官网' },
  },
  {
    _id: 'rec_sup_004',
    supplier_id: 'SUP-004',
    supplier_name: '杭州稳压电源系统',
    main_category: '电源配件',
    rating: 4.6,
    lead_days: 6,
    contact_person: '唐伟',
    website: { url: 'https://sup-004.example.com', text: '稳压电源中心' },
  },
  {
    _id: 'rec_sup_005',
    supplier_id: 'SUP-005',
    supplier_name: '成都天府线缆辅材',
    main_category: '辅材耗材',
    rating: 4.5,
    lead_days: 3,
    contact_person: '罗丹',
    website: { url: 'https://sup-005.example.com', text: '天府线缆商城' },
  },
  {
    _id: 'rec_sup_006',
    supplier_id: 'SUP-006',
    supplier_name: '无锡博锐嵌入式设备',
    main_category: '核心主机',
    rating: 4.85,
    lead_days: 12,
    contact_person: '许涛',
    website: { url: 'https://sup-006.example.com', text: '博锐嵌入式' },
  },
  {
    _id: 'rec_sup_007',
    supplier_id: 'SUP-007',
    supplier_name: '东莞光电子测控',
    main_category: '传感模块',
    rating: 4.4,
    lead_days: 8,
    contact_person: '谢婷',
    website: { url: 'https://sup-007.example.com', text: '光电子测控' },
  },
  {
    _id: 'rec_sup_008',
    supplier_id: 'SUP-008',
    supplier_name: '上海云桥通讯模组',
    main_category: '工业网关',
    rating: 4.75,
    lead_days: 9,
    contact_person: '曹阳',
    website: { url: 'https://sup-008.example.com', text: '云桥通讯官网' },
  },
]

const INVENTORY_RECORDS: SmartRecord[] = [
  {
    _id: 'rec_inv_001',
    sku: 'SKU-IPC-101',
    product_name: 'X86 工业边缘主机 Pro',
    category: '核心主机',
    warehouse_region: '华东仓',
    current_stock: 42,
    safety_stock: 60,
    capacity_rate: 68,
    counted: true,
    product_img: buildSvgThumbDataUrl('IPC', '#38bdf8'),
    po_link: { url: 'https://po.example.com/PO-2025-101', text: 'PO-101 待入库' },
    supplier_code: 'SUP-001',
  },
  {
    _id: 'rec_inv_002',
    sku: 'SKU-IPC-102',
    product_name: 'ARM 无风扇嵌入式工控机',
    category: '核心主机',
    warehouse_region: '华南仓',
    current_stock: 115,
    safety_stock: 80,
    capacity_rate: 82,
    counted: true,
    product_img: buildSvgThumbDataUrl('ARM', '#22c55e'),
    po_link: { url: 'https://po.example.com/PO-2025-102', text: 'PO-102 已验收' },
    supplier_code: 'SUP-006',
  },
  {
    _id: 'rec_inv_003',
    sku: 'SKU-SEN-201',
    product_name: '高精度温湿度 LoRa 传感器',
    category: '传感模块',
    warehouse_region: '华南仓',
    current_stock: 180,
    safety_stock: 250,
    capacity_rate: 54,
    counted: true,
    product_img: buildSvgThumbDataUrl('LORA', '#f59e0b'),
    po_link: { url: 'https://po.example.com/PO-2025-103', text: 'PO-103 加急单' },
    supplier_code: 'SUP-002',
  },
  {
    _id: 'rec_inv_004',
    sku: 'SKU-SEN-202',
    product_name: '三轴振动加速度采集头',
    category: '传感模块',
    warehouse_region: '华北仓',
    current_stock: 320,
    safety_stock: 150,
    capacity_rate: 91,
    counted: true,
    product_img: buildSvgThumbDataUrl('VIB', '#a855f7'),
    po_link: 'https://po.example.com/PO-2025-104',
    supplier_code: 'SUP-007',
  },
  {
    _id: 'rec_inv_005',
    sku: 'SKU-GW-301',
    product_name: '5G 双卡工业智能网关',
    category: '工业网关',
    warehouse_region: '华东仓',
    current_stock: 28,
    safety_stock: 50,
    capacity_rate: 45,
    counted: false,
    product_img: buildSvgThumbDataUrl('5G-GW', '#ef4444'),
    po_link: { url: 'https://po.example.com/PO-2025-105', text: 'PO-105 审批中' },
    supplier_code: 'SUP-003',
  },
  {
    _id: 'rec_inv_006',
    sku: 'SKU-GW-302',
    product_name: 'Modbus-TCP 协议转换网关',
    category: '工业网关',
    warehouse_region: '西南仓',
    current_stock: 96,
    safety_stock: 70,
    capacity_rate: 73,
    counted: true,
    product_img: buildSvgThumbDataUrl('MODBUS', '#06b6d4'),
    po_link: { url: 'https://po.example.com/PO-2025-106', text: 'PO-106 归档' },
    supplier_code: 'SUP-008',
  },
  {
    _id: 'rec_inv_007',
    sku: 'SKU-PWR-401',
    product_name: '24V/10A 导轨开关电源',
    category: '电源配件',
    warehouse_region: '华东仓',
    current_stock: 210,
    safety_stock: 160,
    capacity_rate: 79,
    counted: true,
    product_img: buildSvgThumbDataUrl('24V', '#10b981'),
    po_link: 'https://po.example.com/PO-2025-107',
    supplier_code: 'SUP-004',
  },
  {
    _id: 'rec_inv_008',
    sku: 'SKU-PWR-402',
    product_name: '工业级 UPS 备电模块',
    category: '电源配件',
    warehouse_region: '华北仓',
    current_stock: 19,
    safety_stock: 40,
    capacity_rate: 38,
    counted: false,
    product_img: buildSvgThumbDataUrl('UPS', '#f97316'),
    po_link: '',
    supplier_code: 'SUP-004',
  },
  {
    _id: 'rec_inv_009',
    sku: 'SKU-MAT-501',
    product_name: '超六类屏蔽抗干扰网线(箱)',
    category: '辅材耗材',
    warehouse_region: '西南仓',
    current_stock: 450,
    safety_stock: 200,
    capacity_rate: 88,
    counted: true,
    product_img: buildSvgThumbDataUrl('CAT6A', '#3b82f6'),
    po_link: { url: 'https://po.example.com/PO-2025-109', text: 'PO-109 常规补货' },
    supplier_code: 'SUP-005',
  },
  {
    _id: 'rec_inv_010',
    sku: 'SKU-MAT-502',
    product_name: 'IP67 防水航空接插件套件',
    category: '辅材耗材',
    warehouse_region: '华南仓',
    current_stock: 85,
    safety_stock: 120,
    capacity_rate: 52,
    counted: true,
    product_img: buildSvgThumbDataUrl('IP67', '#ec4899'),
    po_link: { url: 'https://po.example.com/PO-2025-110', text: 'PO-110 在途' },
    supplier_code: 'SUP-005',
  },
  {
    _id: 'rec_inv_011',
    sku: 'SKU-IPC-103',
    product_name: 'GPU 视觉质检推理工作站',
    category: '核心主机',
    warehouse_region: '华东仓',
    current_stock: 12,
    safety_stock: 25,
    capacity_rate: 42,
    counted: false,
    product_img: buildSvgThumbDataUrl('GPU', '#8b5cf6'),
    po_link: { url: 'https://po.example.com/PO-2025-111', text: 'PO-111 紧急采购' },
    supplier_code: 'SUP-001',
  },
  {
    _id: 'rec_inv_012',
    sku: 'SKU-SEN-203',
    product_name: '激光雷达防碰撞扫描仪',
    category: '传感模块',
    warehouse_region: '华东仓',
    current_stock: 58,
    safety_stock: 45,
    capacity_rate: 76,
    counted: true,
    product_img: buildSvgThumbDataUrl('LIDAR', '#14b8a6'),
    po_link: 'https://po.example.com/PO-2025-112',
    supplier_code: 'SUP-002',
  },
  {
    _id: 'rec_inv_013',
    sku: 'SKU-GW-303',
    product_name: '防爆型矿用无线采集网关',
    category: '工业网关',
    warehouse_region: '华北仓',
    current_stock: 14,
    safety_stock: 30,
    capacity_rate: 35,
    counted: true,
    product_img: buildSvgThumbDataUrl('EX-GW', '#ef4444'),
    po_link: { url: 'https://po.example.com/PO-2025-113', text: 'PO-113 备货中' },
    supplier_code: 'SUP-003',
  },
  {
    _id: 'rec_inv_014',
    sku: 'SKU-PWR-403',
    product_name: 'PoE+ 工业级供电交换机',
    category: '电源配件',
    warehouse_region: '华南仓',
    current_stock: 74,
    safety_stock: 60,
    capacity_rate: 81,
    counted: true,
    product_img: buildSvgThumbDataUrl('POE', '#0ea5e9'),
    po_link: 'https://po.example.com/PO-2025-114',
    supplier_code: 'SUP-008',
  },
  {
    _id: 'rec_inv_015',
    sku: 'SKU-SEN-204',
    product_name: '红外热成像测温模组',
    category: '传感模块',
    warehouse_region: '西南仓',
    current_stock: 31,
    safety_stock: 50,
    capacity_rate: 49,
    counted: false,
    product_img: buildSvgThumbDataUrl('IR', '#f43f5e'),
    po_link: { url: 'https://po.example.com/PO-2025-115', text: 'PO-115 待发货' },
    supplier_code: 'SUP-007',
  },
  {
    _id: 'rec_inv_016',
    sku: 'SKU-MAT-503',
    product_name: '防静电控制柜安装导轨',
    category: '辅材耗材',
    warehouse_region: '华北仓',
    current_stock: 260,
    safety_stock: 180,
    capacity_rate: 84,
    counted: true,
    product_img: buildSvgThumbDataUrl('RAIL', '#64748b'),
    po_link: '',
    supplier_code: 'SUP-006',
  },
]

const TICKET_RECORDS: SmartRecord[] = [
  {
    _id: 'rec_tkt_001',
    ticket_id: 'TKT-2025-001',
    customer_name: '星辰精密制造有限公司',
    project_code: 'PRJ-2025-001',
    issue_category: '接口故障',
    priority: 'P0 紧急',
    assignee: '张三',
    ticket_status: '处理中',
    sla_progress: 65,
    created_date: '2025-06-01',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_002',
    ticket_id: 'TKT-2025-002',
    customer_name: '华北电网能源科技集团',
    project_code: 'PRJ-2025-002',
    issue_category: '性能调优',
    priority: 'P1 高',
    assignee: '李四',
    ticket_status: '已关闭',
    sla_progress: 100,
    created_date: '2025-05-12',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_003',
    ticket_id: 'TKT-2025-003',
    customer_name: '湾区通金融控股有限公司',
    project_code: 'PRJ-2025-003',
    issue_category: '权限配置',
    priority: 'P2 中',
    assignee: '王五',
    ticket_status: '已关闭',
    sla_progress: 100,
    created_date: '2025-05-18',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_004',
    ticket_id: 'TKT-2025-004',
    customer_name: '长三角速运物流股份',
    project_code: 'PRJ-2025-004',
    issue_category: '接口故障',
    priority: 'P0 紧急',
    assignee: '赵六',
    ticket_status: '处理中',
    sla_progress: 40,
    created_date: '2025-06-08',
    is_overdue: true,
  },
  {
    _id: 'rec_tkt_005',
    ticket_id: 'TKT-2025-005',
    customer_name: '华西医学中心',
    project_code: 'PRJ-2025-005',
    issue_category: '接口故障',
    priority: 'P0 紧急',
    assignee: '钱七',
    ticket_status: '待受理',
    sla_progress: 15,
    created_date: '2025-06-14',
    is_overdue: true,
  },
  {
    _id: 'rec_tkt_006',
    ticket_id: 'TKT-2025-006',
    customer_name: '申城新零售商业集团',
    project_code: 'PRJ-2025-006',
    issue_category: '性能调优',
    priority: 'P1 高',
    assignee: '张三',
    ticket_status: '待客户确认',
    sla_progress: 88,
    created_date: '2025-05-29',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_007',
    ticket_id: 'TKT-2025-007',
    customer_name: '智联新能源汽车科技',
    project_code: 'PRJ-2025-007',
    issue_category: '功能咨询',
    priority: 'P3 低',
    assignee: '孙八',
    ticket_status: '已关闭',
    sla_progress: 100,
    created_date: '2025-04-25',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_008',
    ticket_id: 'TKT-2025-008',
    customer_name: '岭南商贸供应链公司',
    project_code: 'PRJ-2025-008',
    issue_category: '账务结算',
    priority: 'P1 高',
    assignee: '周九',
    ticket_status: '处理中',
    sla_progress: 55,
    created_date: '2025-06-05',
    is_overdue: true,
  },
  {
    _id: 'rec_tkt_009',
    ticket_id: 'TKT-2025-009',
    customer_name: '江浙数字政务研究院',
    project_code: 'PRJ-2025-009',
    issue_category: '权限配置',
    priority: 'P2 中',
    assignee: '吴十',
    ticket_status: '待客户确认',
    sla_progress: 90,
    created_date: '2025-06-03',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_010',
    ticket_id: 'TKT-2025-010',
    customer_name: '海蓝跨境电商有限公司',
    project_code: 'PRJ-2025-010',
    issue_category: '功能咨询',
    priority: 'P2 中',
    assignee: '陈晨',
    ticket_status: '待受理',
    sla_progress: 20,
    created_date: '2025-06-15',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_011',
    ticket_id: 'TKT-2025-011',
    customer_name: '巴蜀智网安全科技',
    project_code: 'PRJ-2025-011',
    issue_category: '性能调优',
    priority: 'P1 高',
    assignee: '黄浩',
    ticket_status: '处理中',
    sla_progress: 70,
    created_date: '2025-06-09',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_012',
    ticket_id: 'TKT-2025-012',
    customer_name: '京冀生态园区运营集团',
    project_code: 'PRJ-2025-014',
    issue_category: '账务结算',
    priority: 'P2 中',
    assignee: '周雪',
    ticket_status: '已关闭',
    sla_progress: 100,
    created_date: '2025-05-22',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_013',
    ticket_id: 'TKT-2025-013',
    customer_name: '张江康泰生物制药',
    project_code: 'PRJ-2025-015',
    issue_category: '权限配置',
    priority: 'P1 高',
    assignee: '郑凯',
    ticket_status: '待客户确认',
    sla_progress: 85,
    created_date: '2025-06-06',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_014',
    ticket_id: 'TKT-2025-014',
    customer_name: '深港鲜速冷链仓储',
    project_code: 'PRJ-2025-016',
    issue_category: '接口故障',
    priority: 'P0 紧急',
    assignee: '刘洋',
    ticket_status: '处理中',
    sla_progress: 30,
    created_date: '2025-06-12',
    is_overdue: true,
  },
  {
    _id: 'rec_tkt_015',
    ticket_id: 'TKT-2025-015',
    customer_name: '星辰精密制造有限公司',
    project_code: 'PRJ-2025-001',
    issue_category: '功能咨询',
    priority: 'P3 低',
    assignee: '张三',
    ticket_status: '已关闭',
    sla_progress: 100,
    created_date: '2025-05-03',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_016',
    ticket_id: 'TKT-2025-016',
    customer_name: '长三角速运物流股份',
    project_code: 'PRJ-2025-004',
    issue_category: '性能调优',
    priority: 'P2 中',
    assignee: '赵六',
    ticket_status: '待客户确认',
    sla_progress: 92,
    created_date: '2025-06-10',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_017',
    ticket_id: 'TKT-2025-017',
    customer_name: '江浙数字政务研究院',
    project_code: 'PRJ-2025-009',
    issue_category: '账务结算',
    priority: 'P3 低',
    assignee: '林琳',
    ticket_status: '已关闭',
    sla_progress: 100,
    created_date: '2025-04-19',
    is_overdue: false,
  },
  {
    _id: 'rec_tkt_018',
    ticket_id: 'TKT-2025-018',
    customer_name: '潜在售前咨询客户',
    project_code: '',
    issue_category: '功能咨询',
    priority: 'P3 低',
    assignee: '陈晨',
    ticket_status: '待受理',
    sla_progress: 10,
    created_date: '2025-06-16',
    is_overdue: false,
  },
]

function buildDemoWorkspaceViews(): WorkspaceView[] {
  return [
    {
      id: 'wv_projects_table',
      tableId: 'tbl_projects',
      name: '项目跟进总台账',
      type: 'table',
      sortOrder: 0,
      description:
        '核心项目总台账：含冻结列、列级对齐/配色、重点单元格高亮、条件格式预警与底部汇总',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['status', 'region', 'lookup_emp_dept'],
      sortRules: [],
      frozenColCount: 2,
      rowHeight: 'standard',
      columnStyles: {
        project_code: {
          align: 'left',
          headerBgColor: '#f8fafc',
          headerTextColor: '#334155',
        },
        contract_amount: {
          align: 'right',
          headerBgColor: '#eff6ff',
          headerTextColor: '#1d4ed8',
          bgColor: '#f8fafc',
        },
        lookup_paid_sum: {
          align: 'right',
          headerBgColor: '#ecfdf5',
          headerTextColor: '#047857',
        },
        lookup_paid_count: {
          align: 'right',
        },
        formula_pay_rate: {
          align: 'right',
          headerBgColor: '#f0fdf4',
          headerTextColor: '#15803d',
        },
        progress: {
          align: 'center',
        },
      },
      cellStyles: {
        rec_prj_003: {
          contract_amount: { bgColor: '#fef9c3', textColor: '#854d0e' },
        },
        rec_prj_001: {
          project_name: { bgColor: '#eff6ff', textColor: '#1e40af' },
        },
      },
      conditionalFormats: [
        {
          id: 'cf_prj_risk_row',
          name: '风险预警整行高亮',
          enabled: true,
          field: 'status',
          operator: 'eq',
          value: '风险预警',
          scope: 'row',
          bgColor: '#fef2f2',
          textColor: '#991b1b',
        },
        {
          id: 'cf_prj_rate_high',
          name: '高回款达成率标绿',
          enabled: true,
          field: 'formula_pay_rate',
          operator: 'gte',
          value: 0.8,
          scope: 'cell',
          bgColor: '#dcfce7',
          textColor: '#166534',
        },
        {
          id: 'cf_prj_progress_low',
          name: '低进度单元格橙色预警',
          enabled: true,
          field: 'progress',
          operator: 'lt',
          value: 40,
          scope: 'cell',
          bgColor: '#fff7ed',
          textColor: '#c2410c',
        },
      ],
      summaries: {
        project_code: 'count',
        contract_amount: 'sum',
        lookup_paid_sum: 'sum',
        lookup_paid_count: 'sum',
        progress: 'avg',
        formula_pay_rate: 'avg',
        verified: 'filled_rate',
      },
    },
    {
      id: 'wv_projects_kanban',
      tableId: 'tbl_projects',
      name: '项目交付状态看板',
      type: 'kanban',
      sortOrder: 1,
      description: '按项目状态分泳道展示，运维态支持拖拽卡片变更状态并实时写回数据源',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['region', 'lookup_emp_dept'],
      sortRules: [],
      kanbanConfig: {
        groupByField: 'status',
        titleField: 'project_name',
        displayFields: [
          'project_code',
          'owner_name',
          'region',
          'contract_amount',
          'progress',
          'plan_delivery_date',
        ],
        laneOrder: ['待启动', '进行中', '风险预警', '已交付'],
      },
    },
    {
      id: 'wv_projects_pivot',
      tableId: 'tbl_projects',
      name: '部门 × 状态业绩透视',
      type: 'pivot',
      sortOrder: 2,
      description: '跨表关联部门与项目状态多维交叉透视，支持双击下钻底层明细',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['status', 'region'],
      sortRules: [],
      pivotConfig: {
        rowDimensions: ['lookup_emp_dept', 'lookup_emp_level'],
        columnDimensions: ['status'],
        measures: [
          { key: 'm_contract', title: '合同总额', field: 'contract_amount', agg: 'sum' },
          { key: 'm_paid', title: '累计回款', field: 'lookup_paid_sum', agg: 'sum' },
          { key: 'm_count', title: '项目数', field: '', agg: 'count' },
        ],
        showGrandTotal: true,
        collapsible: true,
      },
    },
    {
      id: 'wv_exec_dashboard',
      tableId: 'tbl_projects',
      name: '项目经营总览仪表盘',
      type: 'dashboard',
      sortOrder: 3,
      description: '经营核心指标卡与多维图表总览，支持筛选联动',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['region', 'status'],
      sortRules: [],
      dashboardConfig: {
        kpis: [
          {
            id: 'kpi_prj_count',
            title: '在管项目数',
            field: 'project_code',
            agg: 'count',
            suffix: '个',
            accentColor: '#2563eb',
          },
          {
            id: 'kpi_contract_sum',
            title: '合同总金额',
            field: 'contract_amount',
            agg: 'sum',
            numberFormat: 'currency',
            accentColor: '#0f766e',
          },
          {
            id: 'kpi_paid_sum',
            title: '累计回款总额',
            field: 'lookup_paid_sum',
            agg: 'sum',
            numberFormat: 'currency',
            accentColor: '#15803d',
          },
          {
            id: 'kpi_pay_rate',
            title: '平均回款达成率',
            field: 'formula_pay_rate',
            agg: 'avg',
            numberFormat: 'percent',
            accentColor: '#7c3aed',
          },
        ],
        charts: [
          {
            id: 'chart_region_contract',
            title: '各大区合同总额对比',
            chartType: 'bar',
            dimensionField: 'region',
            measureField: 'contract_amount',
            agg: 'sum',
            sortBy: 'value_desc',
          },
          {
            id: 'chart_status_pie',
            title: '项目状态占比分布',
            chartType: 'pie',
            dimensionField: 'status',
            measureField: '',
            agg: 'count',
            donut: true,
          },
          {
            id: 'chart_dept_paid',
            title: '各部门累计回款排行',
            chartType: 'bar',
            dimensionField: 'lookup_emp_dept',
            measureField: 'lookup_paid_sum',
            agg: 'sum',
            sortBy: 'value_desc',
          },
          {
            id: 'chart_delivery_trend',
            title: '计划交付日期合同分布趋势',
            chartType: 'line',
            dimensionField: 'plan_delivery_date',
            measureField: 'contract_amount',
            agg: 'sum',
            sortBy: 'label_asc',
          },
        ],
      },
    },
    {
      id: 'wv_tickets_kanban',
      tableId: 'tbl_tickets',
      name: '客户工单处理看板',
      type: 'kanban',
      sortOrder: 4,
      description: '跨表关联项目名称的售后工单泳道看板',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['priority', 'issue_category'],
      sortRules: [],
      kanbanConfig: {
        groupByField: 'ticket_status',
        titleField: 'customer_name',
        displayFields: [
          'ticket_id',
          'lookup_project_name',
          'priority',
          'issue_category',
          'assignee',
          'sla_progress',
          'formula_sla_flag',
        ],
        laneOrder: ['待受理', '处理中', '待客户确认', '已关闭'],
      },
    },
    {
      id: 'wv_payments_pivot',
      tableId: 'tbl_payments',
      name: '年度 × 大区回款透视',
      type: 'pivot',
      sortOrder: 5,
      description: '基于客户回款 SQL 物理表的年度×月度×大区多维透视分析',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['year', 'pay_method'],
      sortRules: [],
      pivotConfig: {
        rowDimensions: ['year', 'month'],
        columnDimensions: ['region'],
        measures: [
          { key: 'm_amount', title: '回款金额', field: 'amount', agg: 'sum' },
          { key: 'm_cnt', title: '笔数', field: '', agg: 'count' },
        ],
        showGrandTotal: true,
        collapsible: true,
      },
    },
    {
      id: 'wv_payments_dashboard',
      tableId: 'tbl_payments',
      name: '回款流水趋势仪表盘',
      type: 'dashboard',
      sortOrder: 6,
      description: '回款流水指标总览与月度趋势/结算方式分布',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['year', 'region'],
      sortRules: [],
      dashboardConfig: {
        kpis: [
          {
            id: 'kpi_pay_cnt',
            title: '回款总笔数',
            field: 'pay_id',
            agg: 'count',
            suffix: '笔',
            accentColor: '#2563eb',
          },
          {
            id: 'kpi_pay_total',
            title: '回款总金额',
            field: 'amount',
            agg: 'sum',
            numberFormat: 'currency',
            accentColor: '#15803d',
          },
          {
            id: 'kpi_pay_avg',
            title: '单笔平均回款',
            field: 'amount',
            agg: 'avg',
            numberFormat: 'currency',
            accentColor: '#0284c7',
          },
          {
            id: 'kpi_pay_max',
            title: '最大单笔回款',
            field: 'amount',
            agg: 'max',
            numberFormat: 'currency',
            accentColor: '#d97706',
          },
        ],
        charts: [
          {
            id: 'chart_pay_month',
            title: '月度回款金额趋势',
            chartType: 'line',
            dimensionField: 'month',
            measureField: 'amount',
            agg: 'sum',
            sortBy: 'label_asc',
            span: 2,
          },
          {
            id: 'chart_pay_method',
            title: '结算方式金额占比',
            chartType: 'pie',
            dimensionField: 'pay_method',
            measureField: 'amount',
            agg: 'sum',
            donut: true,
          },
          {
            id: 'chart_pay_region',
            title: '各大区回款总额',
            chartType: 'bar',
            dimensionField: 'region',
            measureField: 'amount',
            agg: 'sum',
            sortBy: 'value_desc',
          },
        ],
      },
    },
    {
      id: 'wv_inventory_table',
      tableId: 'tbl_inventory',
      name: '库存补货预警台账',
      type: 'table',
      sortOrder: 7,
      description: '供应链库存与采购台账：缺口公式列 + 需补货整行条件格式高亮',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['category', 'warehouse_region', 'formula_restock_alert'],
      sortRules: [{ field: 'formula_stock_gap', direction: 'desc' }],
      frozenColCount: 2,
      rowHeight: 'compact',
      columnStyles: {
        current_stock: { align: 'right' },
        safety_stock: { align: 'right' },
        formula_stock_gap: { align: 'right' },
      },
      conditionalFormats: [
        {
          id: 'cf_inv_restock',
          name: '需补货整行提醒',
          enabled: true,
          field: 'formula_restock_alert',
          operator: 'eq',
          value: '需补货',
          scope: 'row',
          bgColor: '#fef2f2',
          textColor: '#b91c1c',
        },
      ],
      summaries: {
        sku: 'count',
        current_stock: 'sum',
        safety_stock: 'sum',
        formula_stock_gap: 'sum',
        capacity_rate: 'avg',
        counted: 'filled_rate',
      },
    },
    {
      id: 'wv_employees_table',
      tableId: 'tbl_employees',
      name: '企业员工花名册',
      type: 'table',
      sortOrder: 8,
      description: '企业主数据 SQL 物理表视图：按部门/大区/职级快速筛选（含同名「张三」示例）',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['dept', 'region', 'level'],
      sortRules: [{ field: 'emp_id', direction: 'asc' }],
      frozenColCount: 2,
      rowHeight: 'standard',
      columnStyles: {
        emp_id: {
          align: 'left',
          headerBgColor: '#f8fafc',
          headerTextColor: '#334155',
        },
        level: { align: 'center' },
      },
      summaries: {
        emp_id: 'count',
      },
    },
    {
      id: 'wv_suppliers_table',
      tableId: 'tbl_suppliers',
      name: '核心供应商名录',
      type: 'table',
      sortOrder: 9,
      description: '供应链主数据视图：高评分供应商高亮与标准交期汇总',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['main_category'],
      sortRules: [{ field: 'rating', direction: 'desc' }],
      frozenColCount: 2,
      rowHeight: 'standard',
      columnStyles: {
        rating: { align: 'right' },
        lead_days: { align: 'right' },
      },
      conditionalFormats: [
        {
          id: 'cf_sup_top_rating',
          name: '高评分优质供应商标绿',
          enabled: true,
          field: 'rating',
          operator: 'gte',
          value: 4.8,
          scope: 'cell',
          bgColor: '#dcfce7',
          textColor: '#166534',
        },
      ],
      summaries: {
        supplier_id: 'count',
        rating: 'avg',
        lead_days: 'avg',
      },
    },
  ]
}

export function seedSmartTableDemo(db: Database, options?: { force?: boolean }): void {
  runInTransaction(db, () => {
    if (!options?.force) {
      const row = db.query('SELECT COUNT(*) AS cnt FROM smart_tables').get() as
        | { cnt: number }
        | undefined
        | null
      if (row && row.cnt > 0) {
        // 已有表：幂等跳过，种子版本推进交给 ensureSeeded 决策
        return
      }
    } else {
      db.exec(`
        DELETE FROM workspace_views;
        DELETE FROM smart_table_records;
        DELETE FROM smart_tables;
        DELETE FROM biz_employees;
        DELETE FROM biz_payments;
      `)
    }
    // 实际执行播种时同步记录种子版本（随事务提交/回滚）
    writeSeedVersion(db, SEED_VERSION)

    const now = new Date().toISOString()
    const insertTableStmt = db.query(
      'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const insertRecordStmt = db.query(
      'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
    )

    const seedNormalTable = (
      id: string,
      name: string,
      description: string,
      metaParts: TableMetaParts,
      records: readonly SmartRecord[],
    ): void => {
      insertTableStmt.run(
        id,
        name,
        'normal',
        null,
        null,
        JSON.stringify({
          description,
          columns: metaParts.columns,
          summaries: metaParts.summaries,
        }),
        JSON.stringify(metaParts.views),
        now,
      )
      records.forEach((record, index) => {
        insertRecordStmt.run(record._id, id, index, JSON.stringify(record))
      })
    }

    // 1. 表 1：《项目跟进与业绩总表》（normal）
    seedNormalTable(
      'tbl_projects',
      '项目跟进与业绩总表',
      '核心业务台账：含富媒体列、跨表 VLOOKUP 关联（重名消歧 + Rollup 汇总）、整列公式与多视图',
      buildProjectsMeta(),
      PROJECT_RECORDS,
    )

    // 2. 表 2：《企业员工花名册》（advanced -> biz_employees）
    const employeesMeta = buildEmployeesMeta()
    insertTableStmt.run(
      'tbl_employees',
      '企业员工花名册',
      'advanced',
      'emp_id',
      'biz_employees',
      JSON.stringify({
        description: '企业主数据物理表（emp_id 主键），含同名「张三」用于演示 VLOOKUP 重名消歧',
        columns: employeesMeta.columns,
        summaries: employeesMeta.summaries,
        system: true,
      }),
      JSON.stringify(employeesMeta.views),
      now,
    )
    const insertEmpStmt = db.query(
      'INSERT INTO biz_employees (emp_id, name, dept, level, region, email) VALUES (?, ?, ?, ?, ?, ?)',
    )
    for (const emp of EMPLOYEE_ROWS) {
      insertEmpStmt.run(emp.emp_id, emp.name, emp.dept, emp.level, emp.region, emp.email)
    }

    // 3. 表 3：《客户回款流水表》（advanced -> biz_payments）
    const paymentsMeta = buildPaymentsMeta()
    insertTableStmt.run(
      'tbl_payments',
      '客户回款流水表',
      'advanced',
      'pay_id',
      'biz_payments',
      JSON.stringify({
        description:
          '一对多业务回款流水物理表（pay_id 主键），支撑项目回款 Rollup 汇总与年度×月度×大区透视',
        columns: paymentsMeta.columns,
        summaries: paymentsMeta.summaries,
        system: true,
      }),
      JSON.stringify(paymentsMeta.views),
      now,
    )
    const insertPayStmt = db.query(
      'INSERT INTO biz_payments (pay_id, project_code, customer_name, pay_date, year, month, region, amount, pay_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    for (const pay of PAYMENT_ROWS) {
      insertPayStmt.run(
        pay.pay_id,
        pay.project_code,
        pay.customer_name,
        pay.pay_date,
        pay.year,
        pay.month,
        pay.region,
        pay.amount,
        pay.pay_method,
      )
    }

    // 4. 表 4：《产品库存与采购台账》（normal）
    seedNormalTable(
      'tbl_inventory',
      '产品库存与采购台账',
      '供应链库存台账：VLOOKUP 关联供应商交期 + 库存缺口/补货预警双公式列 + 仓库大区透视',
      buildInventoryMeta(),
      INVENTORY_RECORDS,
    )

    // 5. 表 5：《供应商名录》（normal）
    seedNormalTable(
      'tbl_suppliers',
      '供应商名录',
      '供应链核心供应商主数据：含评分、交期与 { url, text } 对象格式官网链接',
      buildSuppliersMeta(),
      SUPPLIER_RECORDS,
    )

    // 6. 表 6：《客户工单与 SLA 追踪》（normal）
    seedNormalTable(
      'tbl_tickets',
      '客户工单与 SLA 追踪',
      '售后运维与 SLA 追踪：跨普通表 VLOOKUP 关联项目名称、响应进度与 SLA 违约预警',
      buildTicketsMeta(),
      TICKET_RECORDS,
    )

    // 7. 预置独立应用视图空间示范视图（覆盖表格/看板/透视/仪表盘四类）
    const insertViewStmt = db.query(
      'INSERT INTO workspace_views (id, table_id, name, type, sort_order, config_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    for (const view of buildDemoWorkspaceViews()) {
      const { id, tableId, name, type, sortOrder, updatedAt: _ua, ...config } = view
      insertViewStmt.run(id, tableId, name, type, sortOrder, JSON.stringify(config), now)
    }
  })
}

/**
 * 种子自愈（服务启动时调用）：库中种子版本低于 SEED_VERSION 且不存在用户自建表
 * （smart_tables 全部在 SEED_TABLE_IDS 内）时自动 force 重种旧库；存在用户自建表则
 * 不自动重种（避免毁数据），版本记录保持原样不动，待用户手动 POST /api/reset-seed。
 */
export function ensureSeeded(db: Database): void {
  if (readSeedVersion(db) >= SEED_VERSION) return
  const rows = db.query('SELECT id FROM smart_tables').all() as { id: string }[]
  const hasUserTables = rows.some((row) => !SEED_TABLE_IDS.has(row.id))
  if (hasUserTables) return
  seedSmartTableDemo(db, { force: true })
}
