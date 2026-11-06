// seed 演练库：首次启动幂等内置一个 SQLite 演练数据源（销售订单两表）、三个演练数据集
// 与两份内置起点模板（P9 列表样/中式单据），数据口径覆盖模板取数——列表样（销售明细
// 平铺）与中式单据（订单头 + 明细，嵌套重塑交给前端转换器）。空库首启即可加载模板、
// 绑定 seed 数据集并直接预览打印，无需手工建数据。
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'
import { DEFAULT_DB_PATH } from './db'
import type { DatasetRow, DatasourceRow } from './rows'
import { SEED_TEMPLATES } from './seed-templates'

export const SEED_DATASOURCE_ID = 'seed-datasource-demo'

const SEED_CREATED_AT = '2026-11-02T00:00:00.000Z'

// 两表：sales_order 单据头（含经手/制单/审核/签收签字栏字段）、sales_order_item 明细行。
const DEMO_SCHEMA = `
CREATE TABLE IF NOT EXISTS sales_order (
  order_no TEXT PRIMARY KEY,
  order_date TEXT NOT NULL,
  customer TEXT NOT NULL,
  address TEXT NOT NULL,
  handler TEXT NOT NULL,
  maker TEXT NOT NULL,
  auditor TEXT NOT NULL,
  receiver TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales_order_item (
  order_no TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  spec TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  amount REAL NOT NULL,
  PRIMARY KEY (order_no, line_no)
);
`

const DEMO_ORDERS: [string, string, string, string, string, string, string, string][] = [
  [
    'SO-2026-001',
    '2026-11-01',
    '杭州锦绣纺织有限公司',
    '杭州市萧山区金城路 77 号',
    '陈明',
    '李小红',
    '王志强',
    '赵伟',
  ],
  [
    'SO-2026-002',
    '2026-11-02',
    '宁波海通印务有限公司',
    '宁波市鄞州区首南街道 88 号',
    '周涛',
    '李小红',
    '王志强',
    '钱磊',
  ],
]

const DEMO_ITEMS: [string, number, string, string, string, number, number, number][] = [
  ['SO-2026-001', 1, '全棉精梳府绸', '40×40 133×72 幅宽 150cm', '匹', 120, 8.5, 1020],
  ['SO-2026-001', 2, '涤纶四面弹面料', '75D 幅宽 160cm', '米', 3500, 3.2, 11200],
  ['SO-2026-001', 3, '涤纶缝纫线', '402 支 5000m', '卷', 200, 1.8, 360],
  ['SO-2026-002', 1, '铜版纸', '128g 正度 787×1092', '令', 60, 185, 11100],
  ['SO-2026-002', 2, '哑粉纸', '105g 大度 889×1194', '令', 45, 210, 9450],
]

const SEED_DATASETS: Omit<DatasetRow, 'datasource_id' | 'created_at'>[] = [
  {
    id: 'seed-dataset-order-header',
    name: '订单头（单据样）',
    sql: 'SELECT order_no, order_date, customer, address, handler, maker, auditor, receiver FROM sales_order ORDER BY order_no',
  },
  {
    id: 'seed-dataset-order-items',
    name: '订单明细（单据样）',
    sql: 'SELECT i.order_no, i.line_no, i.item_name, i.spec, i.unit, i.qty, i.unit_price, i.amount FROM sales_order_item i ORDER BY i.order_no, i.line_no',
  },
  {
    id: 'seed-dataset-sales-lines',
    name: '销售明细（列表样）',
    sql: 'SELECT o.order_no, o.order_date, o.customer, i.line_no, i.item_name, i.spec, i.unit, i.qty, i.unit_price, i.amount FROM sales_order o JOIN sales_order_item i ON i.order_no = o.order_no ORDER BY o.order_no, i.line_no',
  },
]

/** 演练 SQLite 文件的默认位置（与应用元数据库同目录） */
export const DEFAULT_DEMO_PATH = join(dirname(DEFAULT_DB_PATH), 'demo.sqlite')

interface SeedOptions {
  /** 演练 SQLite 文件路径 */
  demoPath: string
}

// 幂等口径：表 CREATE IF NOT EXISTS、数据与注册行全部 INSERT OR IGNORE，二次启动不重复建、不重复插。
export function seedDemoLibrary(db: Database, options: SeedOptions): DatasourceRow {
  const demoPath = options.demoPath
  mkdirSync(dirname(demoPath), { recursive: true })

  const demo = new Database(demoPath)
  try {
    demo.exec(DEMO_SCHEMA)
    for (const order of DEMO_ORDERS) {
      demo
        .query(
          'INSERT OR IGNORE INTO sales_order (order_no, order_date, customer, address, handler, maker, auditor, receiver) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(...order)
    }
    for (const item of DEMO_ITEMS) {
      demo
        .query(
          'INSERT OR IGNORE INTO sales_order_item (order_no, line_no, item_name, spec, unit, qty, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(...item)
    }
  } finally {
    demo.close()
  }

  const datasource: DatasourceRow = {
    id: SEED_DATASOURCE_ID,
    name: '销售演练库',
    type: 'sqlite',
    path: demoPath,
    created_at: SEED_CREATED_AT,
  }
  db.query(
    'INSERT OR IGNORE INTO datasource (id, name, type, path, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(datasource.id, datasource.name, datasource.type, datasource.path, datasource.created_at)
  const insertDataset = db.query(
    'INSERT OR IGNORE INTO dataset (id, datasource_id, name, sql, created_at) VALUES (?, ?, ?, ?, ?)',
  )
  for (const dataset of SEED_DATASETS) {
    insertDataset.run(dataset.id, datasource.id, dataset.name, dataset.sql, SEED_CREATED_AT)
  }

  // 内置起点模板：template 列口径与模板 REST 一致（FormTemplate 去 name 原样序列化）；
  // 用户改存（UPDATE）不改 id，再启不覆盖；删除后重启按 id 重新补种
  const insertTemplate = db.query(
    'INSERT OR IGNORE INTO template (id, name, template, created_at) VALUES (?, ?, ?, ?)',
  )
  for (const { id, template } of SEED_TEMPLATES) {
    const { name, ...payload } = template
    insertTemplate.run(id, name, JSON.stringify(payload), SEED_CREATED_AT)
  }
  return datasource
}
