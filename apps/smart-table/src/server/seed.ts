// 「项目与销售协同」三表联动演示种子数据：
// 表 1（普通表）：tbl_projects《项目跟进与业绩总表》（含富媒体列、两套 VLOOKUP、公式列、透视视图）
// 表 2（进阶 SQL 表）：tbl_employees《企业员工花名册》（biz_employees，含两条同名“张三”）
// 表 3（进阶 SQL 表）：tbl_payments《客户回款流水表》（biz_payments，36 条跨年度月度流水）
import type { Database } from 'bun:sqlite'
import type { SmartColumn, SmartRecord, SmartView, SummaryType } from '../shared/schema'

function buildBlueprintDataUrl(label: string, accent: string): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="52" viewBox="0 0 96 52">',
    `<rect width="96" height="52" rx="6" fill="#0f172a"/>`,
    `<rect x="6" y="7" width="34" height="14" rx="3" fill="${accent}" fill-opacity="0.22" stroke="${accent}" stroke-width="1.2"/>`,
    `<rect x="56" y="7" width="34" height="14" rx="3" fill="#38bdf8" fill-opacity="0.2" stroke="#38bdf8" stroke-width="1.2"/>`,
    `<rect x="26" y="31" width="44" height="14" rx="3" fill="#22c55e" fill-opacity="0.2" stroke="#22c55e" stroke-width="1.2"/>`,
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

function buildProjectsMeta(): {
  columns: SmartColumn[]
  views: SmartView[]
  summaries: Record<string, SummaryType>
} {
  const columns: SmartColumn[] = [
    { key: 'project_code', title: '项目编号', type: 'text', width: 130 },
    { key: 'project_name', title: '项目名称', type: 'text', width: 220 },
    { key: 'owner_name', title: '负责人', type: 'person', width: 120 },
    {
      key: 'status',
      title: '项目状态',
      type: 'select',
      width: 115,
      options: PROJECT_STATUS_OPTIONS,
    },
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
    { key: 'doc_url', title: '立项书链接', type: 'link', width: 185 },
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
  ]

  const views: SmartView[] = [
    {
      id: 'view_projects_table',
      name: '全部项目明细',
      type: 'table',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['status', 'lookup_emp_dept'],
      sortRules: [],
    },
    {
      id: 'view_projects_pivot',
      name: '部门 × 状态业绩多维分析',
      type: 'pivot',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['status'],
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

function buildEmployeesMeta(): {
  columns: SmartColumn[]
  views: SmartView[]
  summaries: Record<string, SummaryType>
} {
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

  return {
    columns,
    views,
    summaries: { emp_id: 'count' },
  }
}

function buildPaymentsMeta(): {
  columns: SmartColumn[]
  views: SmartView[]
  summaries: Record<string, SummaryType>
} {
  const columns: SmartColumn[] = [
    { key: 'pay_id', title: '流水号', type: 'text', width: 140, isUniqueKey: true },
    { key: 'project_code', title: '关联项目编号', type: 'text', width: 140 },
    { key: 'customer_name', title: '客户名称', type: 'text', width: 190 },
    { key: 'pay_date', title: '回款日期', type: 'date', width: 125 },
    { key: 'year', title: '年份', type: 'select', width: 100, options: YEAR_OPTIONS },
    { key: 'month', title: '月份', type: 'text', width: 95 },
    {
      key: 'amount',
      title: '回款金额',
      type: 'number',
      width: 140,
      numberFormat: 'currency',
    },
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
      quickFilterFields: ['year', 'pay_method'],
      sortRules: [{ field: 'pay_date', direction: 'desc' }],
    },
    {
      id: 'view_payments_pivot',
      name: '年度 × 月度回款分析',
      type: 'pivot',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: ['year'],
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
  ]

  return {
    columns,
    views,
    summaries: { pay_id: 'count', amount: 'sum' },
  }
}

const PROJECT_RECORDS: SmartRecord[] = [
  {
    _id: 'rec_prj_001',
    project_code: 'PRJ-2025-001',
    project_name: '星辰智能制造 MES 平台',
    // 故意留空 _lookupOverrides，与 PRJ-2025-006 共同演示“张三”重名冲突消歧
    owner_name: '张三',
    status: '进行中',
    progress: 75,
    contract_amount: 1200000,
    verified: true,
    blueprint_img: buildBlueprintDataUrl('MES', '#38bdf8'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-001',
  },
  {
    _id: 'rec_prj_002',
    project_code: 'PRJ-2025-002',
    project_name: '华北电力数字孪生系统',
    owner_name: '李四',
    status: '已交付',
    progress: 100,
    contract_amount: 850000,
    verified: true,
    blueprint_img: buildBlueprintDataUrl('TWIN', '#22c55e'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-002',
  },
  {
    _id: 'rec_prj_003',
    project_code: 'PRJ-2025-003',
    project_name: '粤港澳跨境支付风控中台',
    owner_name: '王五',
    status: '已交付',
    progress: 100,
    contract_amount: 1600000,
    verified: true,
    blueprint_img: buildBlueprintDataUrl('RISK', '#a855f7'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-003',
  },
  {
    _id: 'rec_prj_004',
    project_code: 'PRJ-2025-004',
    project_name: '长三角智慧物流调度云',
    owner_name: '赵六',
    status: '进行中',
    progress: 65,
    contract_amount: 980000,
    verified: true,
    blueprint_img: buildBlueprintDataUrl('TMS', '#f59e0b'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-004',
  },
  {
    _id: 'rec_prj_005',
    project_code: 'PRJ-2025-005',
    project_name: '西南医院医疗影像协同平台',
    owner_name: '钱七',
    status: '风险预警',
    progress: 35,
    contract_amount: 720000,
    verified: false,
    blueprint_img: buildBlueprintDataUrl('PACS', '#ef4444'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-005',
  },
  {
    _id: 'rec_prj_006',
    project_code: 'PRJ-2025-006',
    project_name: '华东零售全渠道数据湖项目',
    // 第二条“张三”记录，同样故意不设 _lookupOverrides
    owner_name: '张三',
    status: '进行中',
    progress: 55,
    contract_amount: 1100000,
    verified: true,
    blueprint_img: buildBlueprintDataUrl('LAKE', '#06b6d4'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-006',
  },
  {
    _id: 'rec_prj_007',
    project_code: 'PRJ-2025-007',
    project_name: '智联汽车研发 PLM 底座升级',
    owner_name: '孙八',
    status: '已交付',
    progress: 100,
    contract_amount: 1400000,
    verified: true,
    blueprint_img: buildBlueprintDataUrl('PLM', '#3b82f6'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-007',
  },
  {
    _id: 'rec_prj_008',
    project_code: 'PRJ-2025-008',
    project_name: '岭南供应链金融协同门户',
    owner_name: '周九',
    status: '风险预警',
    progress: 25,
    contract_amount: 640000,
    verified: false,
    blueprint_img: buildBlueprintDataUrl('SCF', '#f97316'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-008',
  },
  {
    _id: 'rec_prj_009',
    project_code: 'PRJ-2025-009',
    project_name: '江浙政务大数据治理一期',
    owner_name: '吴十',
    status: '进行中',
    progress: 80,
    contract_amount: 900000,
    verified: true,
    blueprint_img: buildBlueprintDataUrl('GOV', '#10b981'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-009',
  },
  {
    _id: 'rec_prj_010',
    project_code: 'PRJ-2025-010',
    project_name: '出海电商实时看板与 BI 底座',
    owner_name: '陈晨',
    status: '待启动',
    progress: 10,
    contract_amount: 500000,
    verified: false,
    blueprint_img: buildBlueprintDataUrl('BI', '#64748b'),
    doc_url: 'https://docs.example.com/projects/PRJ-2025-010',
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
]

interface PaymentSeedRow {
  pay_id: string
  project_code: string
  customer_name: string
  pay_date: string
  year: string
  month: string
  amount: number
  pay_method: string
}

const PAYMENT_ROWS: PaymentSeedRow[] = [
  // PRJ-2025-001（5 笔，合计 900,000）
  {
    pay_id: 'PAY-2024-001',
    project_code: 'PRJ-2025-001',
    customer_name: '星辰精密制造有限公司',
    pay_date: '2024-09-18',
    year: '2024年',
    month: '09月',
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
    amount: 200000,
    pay_method: '线上对公',
  },
  // PRJ-2025-002（4 笔，合计 850,000）
  {
    pay_id: 'PAY-2024-006',
    project_code: 'PRJ-2025-002',
    customer_name: '华北电网能源科技集团',
    pay_date: '2024-07-12',
    year: '2024年',
    month: '07月',
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
    amount: 180000,
    pay_method: '银行电汇',
  },
  // PRJ-2025-003（5 笔，合计 1,600,000）
  {
    pay_id: 'PAY-2024-010',
    project_code: 'PRJ-2025-003',
    customer_name: '湾区通金融控股有限公司',
    pay_date: '2024-06-15',
    year: '2024年',
    month: '06月',
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
    amount: 300000,
    pay_method: '银行电汇',
  },
  // PRJ-2025-004（4 笔，合计 588,000）
  {
    pay_id: 'PAY-2024-015',
    project_code: 'PRJ-2025-004',
    customer_name: '长三角速运物流股份',
    pay_date: '2024-08-19',
    year: '2024年',
    month: '08月',
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
    amount: 150000,
    pay_method: '银行电汇',
  },
  // PRJ-2025-005（3 笔，合计 180,000）
  {
    pay_id: 'PAY-2024-019',
    project_code: 'PRJ-2025-005',
    customer_name: '华西医学中心',
    pay_date: '2024-10-14',
    year: '2024年',
    month: '10月',
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
    amount: 50000,
    pay_method: '线上对公',
  },
  // PRJ-2025-006（4 笔，合计 550,000）
  {
    pay_id: 'PAY-2024-022',
    project_code: 'PRJ-2025-006',
    customer_name: '申城新零售商业集团',
    pay_date: '2024-09-05',
    year: '2024年',
    month: '09月',
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
    amount: 150000,
    pay_method: '银行电汇',
  },
  // PRJ-2025-007（4 笔，合计 1,400,000）
  {
    pay_id: 'PAY-2024-026',
    project_code: 'PRJ-2025-007',
    customer_name: '智联新能源汽车科技',
    pay_date: '2024-05-20',
    year: '2024年',
    month: '05月',
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
    amount: 300000,
    pay_method: '线上对公',
  },
  // PRJ-2025-008（2 笔，合计 128,000）
  {
    pay_id: 'PAY-2024-030',
    project_code: 'PRJ-2025-008',
    customer_name: '岭南商贸供应链公司',
    pay_date: '2024-12-03',
    year: '2024年',
    month: '12月',
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
    amount: 60000,
    pay_method: '银行电汇',
  },
  // PRJ-2025-009（4 笔，合计 630,000）
  {
    pay_id: 'PAY-2024-032',
    project_code: 'PRJ-2025-009',
    customer_name: '江浙数字政务研究院',
    pay_date: '2024-07-24',
    year: '2024年',
    month: '07月',
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
    amount: 140000,
    pay_method: '线上对公',
  },
  // PRJ-2025-010（1 笔预付款，合计 50,000）
  {
    pay_id: 'PAY-2025-036',
    project_code: 'PRJ-2025-010',
    customer_name: '海蓝跨境电商有限公司',
    pay_date: '2025-07-02',
    year: '2025年',
    month: '07月',
    amount: 50000,
    pay_method: '线上对公',
  },
]

export function seedSmartTableDemo(db: Database, options?: { force?: boolean }): void {
  if (!options?.force) {
    const row = db.query('SELECT COUNT(*) AS cnt FROM smart_tables').get() as
      | { cnt: number }
      | undefined
      | null
    if (row && row.cnt > 0) {
      return
    }
  } else {
    db.exec(`
      DELETE FROM smart_table_records;
      DELETE FROM smart_tables;
      DELETE FROM biz_employees;
      DELETE FROM biz_payments;
    `)
  }

  const now = new Date().toISOString()
  const insertTableStmt = db.query(
    'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )

  // 1. 表 1：《项目跟进与业绩总表》（normal）
  const projectsMeta = buildProjectsMeta()
  insertTableStmt.run(
    'tbl_projects',
    '项目跟进与业绩总表',
    'normal',
    null,
    null,
    JSON.stringify({
      description:
        '核心业务台账：含富媒体列、跨表 VLOOKUP 关联（重名消歧 + Rollup 汇总）与整列公式',
      columns: projectsMeta.columns,
      summaries: projectsMeta.summaries,
    }),
    JSON.stringify(projectsMeta.views),
    now,
  )

  const insertRecordStmt = db.query(
    'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
  )
  PROJECT_RECORDS.forEach((record, index) => {
    insertRecordStmt.run(record._id, 'tbl_projects', index, JSON.stringify(record))
  })

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
        '一对多业务回款流水物理表（pay_id 主键），支撑项目回款 Rollup 汇总与年度月度透视',
      columns: paymentsMeta.columns,
      summaries: paymentsMeta.summaries,
    }),
    JSON.stringify(paymentsMeta.views),
    now,
  )

  const insertPayStmt = db.query(
    'INSERT INTO biz_payments (pay_id, project_code, customer_name, pay_date, year, month, amount, pay_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  for (const pay of PAYMENT_ROWS) {
    insertPayStmt.run(
      pay.pay_id,
      pay.project_code,
      pay.customer_name,
      pay.pay_date,
      pay.year,
      pay.month,
      pay.amount,
      pay.pay_method,
    )
  }
}
