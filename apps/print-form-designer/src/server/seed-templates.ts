// 内置起点模板库：2 份完整业务样（分组小计列表 / 中式单据）+ 7 份「示例 ·」教学样，
// 每份只讲一个配置主题（横向列表 / 计算列 / 聚合链式 / 非数组聚合引用 / 重塑表达式 /
// 固定排版 / 组头行），随 seed 幂等落库。构建走 FormDoc 公共入口（fromTemplate +
// toTemplate 与设计器加载/保存同一条序列化链路），落库 JSON 加载即完整还原画布。
//
// 函数格全部用 v5 判别联合载荷（FormCellFunction）直接书写：
// - `fn`（主路径）：结构化聚合 `regionFn('SUM', '明细', 'amount')` / 分组值 `groupFn('客户')`；
// - `expr`（逃生舱）：自定义 JS `exprFn('item.qty * item.unit_price')`。
// 占位符显示由 cellFunctionExpression 合成，与旧表达式写法完全一致（用户无感）。
//
// v6 口径的统一规范：
// - **聚合必有 type 且空数据安全**（提交路径空数据试跑强校验）：数组型作数据块循环源，
//   非数组型供任意格子直引；函数体在空入参/空 agg 下也不抛错（链式引用写
//   `agg.名 ?? []` 这类防御式）；
// - **数据块只出现在需要逐条展开的地方**（向下/向右 + 数据集或数组型聚合源）；
//   标题、表头、合计、签字都是数据块外的静态内容——固定文字不需要数据块；
// - **单据头字段直接引用非数组聚合**（中式单据）：`{ kind: 'agg', aggName, path }`
//   绑定直取首单字段（占位符 `{{agg.订单头.order_no}}`），不再套数据块；
// - **分组小计/合计**（列表样）：明细区配 groupBy + 小计行（groupFooter，SUBTOTAL/GROUP）
//   + 合计行（summary，SUM 同列省字段）；教学样「组头行与小计」另演示组头行（groupHeader）
//   与 GROUP() 省字段取首个分组字段；
// - **重塑表达式**（中式单据 + 教学样「重塑表达式」）：数据块数据源带 expression 把
//   原始行整成嵌套结构再绑定。
import {
  BORDER_STYLE_WIDTH,
  Sheet,
  type CellAddress,
  type CellRange,
  type CellStylePatch,
} from '@infinitable/sheet'

import { FormDoc } from '../domain/form-doc'
import {
  TEMPLATE_SCHEMA_VERSION,
  type FormAggregation,
  type FormCellBinding,
  type FormCellFunction,
  type FormRegion,
  type FormTemplate,
  type RegionFnName,
} from '../shared/template-schema'

export const SEED_TEMPLATE_LIST_ID = 'seed-template-sales-list'
export const SEED_TEMPLATE_CN_DOC_ID = 'seed-template-cn-receipt'
export const SEED_TEMPLATE_RIGHT_ID = 'seed-template-right-expand'
export const SEED_TEMPLATE_EXPR_ID = 'seed-template-computed-column'
export const SEED_TEMPLATE_AGG_ID = 'seed-template-agg-chain'
export const SEED_TEMPLATE_AGG_VALUE_ID = 'seed-template-agg-value'
export const SEED_TEMPLATE_RESHAPE_ID = 'seed-template-reshape-nested'
export const SEED_TEMPLATE_FIXED_ID = 'seed-template-fixed-layout'
export const SEED_TEMPLATE_GROUP_ID = 'seed-template-group-header'

const SALES_LINES_DATASET = 'seed-dataset-sales-lines'
const ORDER_HEADER_DATASET = 'seed-dataset-order-header'
const ORDER_ITEMS_DATASET = 'seed-dataset-order-items'

/** 订单明细归组表达式：原始行 → [{ order_no, items: [...] }] 嵌套二级数组（明细循环源） */
const GROUP_ORDER_ITEMS_EXPRESSION = `rows.reduce((orders, row) => {
  const line = {
    line_no: row.line_no,
    item_name: row.item_name,
    spec: row.spec,
    unit: row.unit,
    qty: row.qty,
    unit_price: row.unit_price,
    amount: row.amount,
  }
  const head = orders.find((order) => order.order_no === row.order_no)
  if (head) head.items.push(line)
  else orders.push({ order_no: row.order_no, items: [line] })
  return orders
}, [])`

/**
 * 中式单据的聚合：非数组型订单头（`orders[0] ?? {}` 空数据安全——空表也返回 `{}`）。
 * 表头/客户/签字字段用 `{ kind: 'agg' }` 绑定直引它的字段（首单语义），不需要数据块。
 */
const ORDER_AGGREGATION: FormAggregation = {
  name: '订单头',
  type: 'value',
  params: [{ datasetId: ORDER_HEADER_DATASET, varName: 'orders' }],
  expression: 'return orders[0] ?? {}',
}

/**
 * 「聚合加工与链式引用」教学样的聚合 1：销售明细扁平行 → 按单据归组的台账行数组
 * （品种数 / 数量 / 金额都在函数体里算好，数据块只管绑定现成字段）。
 * 数组型；空入参下 for 循环不执行、返回 `[]`，空数据试跑天然通过。
 */
const LEDGER_AGGREGATION: FormAggregation = {
  name: '订单台账',
  type: 'array',
  params: [{ datasetId: SALES_LINES_DATASET, varName: 'lines' }],
  expression: `const byOrder = new Map()
for (const row of lines) {
  const head = byOrder.get(row.order_no)
  if (head) {
    head.kinds += 1
    head.qty += row.qty
    head.amount += row.amount
  } else {
    byOrder.set(row.order_no, {
      order_no: row.order_no,
      customer: row.customer,
      order_date: row.order_date,
      kinds: 1,
      qty: row.qty,
      amount: row.amount,
    })
  }
}
return [...byOrder.values()]`,
}

/**
 * 「聚合加工与链式引用」教学样的聚合 2：零入参、只消费前序聚合 `agg.订单台账`
 * （声明序求值，后序聚合的 `agg` 里已有前序结果）——链式加工的教学点。
 * 非数组型；链式引用写防御式 `agg.订单台账 ?? []`，空数据试跑（agg = {}）不抛错。
 */
const OVERVIEW_AGGREGATION: FormAggregation = {
  name: '总览',
  type: 'value',
  params: [],
  expression: `const 台账 = agg.订单台账 ?? []
return {
  订单数: 台账.length,
  总数量: 台账.reduce((total, order) => total + order.qty, 0),
  总金额: 台账.reduce((total, order) => total + order.amount, 0),
}`,
}

/**
 * 「非数组聚合引用」教学样的聚合：销售明细 → 汇总对象（首单号/订单数/总数量/总金额）。
 * 非数组型、空数据安全（`lines[0]?.order_no ?? ''`、reduce 空数组回 0）——产出对象
 * 供数据块外的格子直引，教学「不展开的值不需要数据块」。
 */
const SALES_SUMMARY_AGGREGATION: FormAggregation = {
  name: '销售汇总',
  type: 'value',
  params: [{ datasetId: SALES_LINES_DATASET, varName: 'lines' }],
  expression: `return {
  首单号: lines[0]?.order_no ?? '',
  订单数: new Set(lines.map((row) => row.order_no)).size,
  总数量: lines.reduce((total, row) => total + row.qty, 0),
  总金额: lines.reduce((total, row) => total + row.amount, 0),
}`,
}

/**
 * 「重塑表达式」教学样的数据块重塑：明细原始行 → [{ order_no, items, qty, amount }]
 * 嵌套结构（items 保留嵌套明细，qty/amount 顺带归组合计；去绑定编辑器的路径树
 * 能看到 items 的 [] / [0] 下钻分支）。
 */
const NESTED_LEDGER_EXPRESSION = `rows.reduce((orders, row) => {
  const line = { line_no: row.line_no, item_name: row.item_name, qty: row.qty, amount: row.amount }
  const head = orders.find((order) => order.order_no === row.order_no)
  if (head) {
    head.items.push(line)
    head.qty += row.qty
    head.amount += row.amount
  } else {
    orders.push({ order_no: row.order_no, items: [line], qty: row.qty, amount: row.amount })
  }
  return orders
}, [])`

// ─── 布局书写小工具（仅本模块用） ─────────────────────────────────────────────

const cell = (row: number, col: number): CellAddress => ({ row, col })

const span = (row: number, colFrom: number, colTo: number): CellRange => ({
  start: cell(row, colFrom),
  end: cell(row, colTo),
})

const thinEdge = {
  style: 'thin',
  width: BORDER_STYLE_WIDTH.thin,
  color: '#000000',
} as const

const bordered: CellStylePatch = {
  border: { top: thinEdge, right: thinEdge, bottom: thinEdge, left: thinEdge },
}
const centered: CellStylePatch = { align: { horizontal: 'center', vertical: 'middle' } }
const leftAligned: CellStylePatch = { align: { horizontal: 'left', vertical: 'middle' } }
const rightAligned: CellStylePatch = { align: { horizontal: 'right', vertical: 'middle' } }
const bold: CellStylePatch = { font: { bold: true } }
const headerFill: CellStylePatch = { fill: { color: '#eef2f7' } }
const fixed2: CellStylePatch = { numFmt: { type: 'fixed', digits: 2 } }
const cnUpper: CellStylePatch = { numFmt: { type: 'cnUpper' } }

function paint(doc: FormDoc, target: CellAddress | CellRange, patches: CellStylePatch[]): void {
  const range = 'start' in target ? target : { start: target, end: target }
  for (const patch of patches) doc.sheet.setCellStyle(range, patch)
}

/** 静态文本格：值 + 样式 */
function putText(doc: FormDoc, at: CellAddress, text: string, ...patches: CellStylePatch[]): void {
  paint(doc, at, patches)
  doc.sheet.setCellValue(at, text)
}

/**
 * 数据块内格子的字段绑定：只写条目内相对字段。
 * 数据源由所在数据块继承（数据集或聚合），展开区按条目份取值、不展开的数据块取第 1 条。
 */
const itemField = (path: string): FormCellBinding => ({ path })

/** 非数组聚合直引绑定：`{{agg.名.路径}}`（任意格可设，不需要所在数据块） */
const aggField = (aggName: string, path: string): FormCellBinding => ({
  kind: 'agg',
  aggName,
  path,
})

/** 结构化数据块聚合载荷：`FN('数据块'[, '字段'])`（种子直接用 v5 判别联合形状） */
const regionFn = (fn: RegionFnName, region: string, field?: string): FormCellFunction =>
  field ? { kind: 'fn', fn, region, field } : { kind: 'fn', fn, region }

/** 结构化分组值载荷：`GROUP(['字段'])`；省字段 = 取数据块首个分组字段 */
const groupFn = (field?: string): FormCellFunction =>
  field ? { kind: 'fn', fn: 'GROUP', field } : { kind: 'fn', fn: 'GROUP' }

/** 自定义表达式载荷（逃生舱）：`item.qty * item.unit_price`、`agg.总览['总金额']` 等 */
const exprFn = (expression: string): FormCellFunction => ({ kind: 'expr', expression })

/** 绑定格：cell-meta sidecar + 样式（配置态画布显示 {{path}} 占位符） */
function putBinding(
  doc: FormDoc,
  at: CellAddress,
  binding: FormCellBinding,
  ...patches: CellStylePatch[]
): void {
  paint(doc, at, patches)
  doc.setCellBinding(at, binding)
}

/** 函数格：cell-meta sidecar + 样式（配置态画布显示 {{表达式}} 占位符） */
function putFunction(
  doc: FormDoc,
  at: CellAddress,
  fn: FormCellFunction,
  ...patches: CellStylePatch[]
): void {
  paint(doc, at, patches)
  doc.setCellFunction(at, fn)
}

/** 合并区静态文本：样式铺整区（边界边框供合并合成）→ 锚点值 → 合并 */
function mergeText(
  doc: FormDoc,
  region: CellRange,
  text: string,
  ...patches: CellStylePatch[]
): void {
  paint(doc, region, patches)
  doc.sheet.setCellValue(region.start, text)
  doc.sheet.mergeCells(region)
}

/** 合并区绑定（锚点承载 sidecar，随明细展开按份复制） */
function mergeBinding(
  doc: FormDoc,
  region: CellRange,
  binding: FormCellBinding,
  ...patches: CellStylePatch[]
): void {
  paint(doc, region, patches)
  doc.setCellBinding(region.start, binding)
  doc.sheet.mergeCells(region)
}

/** 合并区函数格（锚点承载 sidecar；小计/合计行标签常用） */
function mergeFunction(
  doc: FormDoc,
  region: CellRange,
  fn: FormCellFunction,
  ...patches: CellStylePatch[]
): void {
  paint(doc, region, patches)
  doc.setCellFunction(region.start, fn)
  doc.sheet.mergeCells(region)
}

/**
 * 空画布起建：数据块 + 聚合 → FormDoc → 布局回调 → 序列化模板 JSON。
 * 画布尺寸不由模板声明：`sheet` 快照的 rows/cols 由 FormDoc 序列化时按内容包围盒收紧。
 */
function buildTemplate(
  name: string,
  regions: FormRegion[],
  layout: (doc: FormDoc) => void,
  aggregations: FormAggregation[] = [],
): FormTemplate {
  const doc = FormDoc.fromTemplate({
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name,
    regions,
    aggregations,
    sheet: new Sheet('seed').snapshot(),
  })
  layout(doc)
  return doc.toTemplate(name)
}

/** 行高列宽（索引即行/列号；px） */
function geometry(doc: FormDoc, rowHeights: number[], colWidths: number[]): void {
  rowHeights.forEach((height, row) => doc.setRowHeight(row, height))
  colWidths.forEach((width, col) => doc.setColWidth(col, width))
}

// ─── 列表样：按客户分组的销售明细清单 ────────────────────────────────────────

/** 列表列定义：数据集字段 → 明细行样式（9 列宽合计 686px ≤ A4 纵向可用页宽） */
const LIST_COLUMNS: readonly [string, CellStylePatch[]][] = [
  ['order_no', []],
  ['order_date', [centered]],
  ['customer', []],
  ['item_name', []],
  ['spec', []],
  ['unit', [centered]],
  ['qty', [centered]],
  ['unit_price', [rightAligned, fixed2]],
  ['amount', [rightAligned, fixed2]],
]

function buildSalesListTemplate(): FormTemplate {
  return buildTemplate(
    '销售明细清单（按客户分组）',
    [
      // 唯一数据块 = 明细区（按客户分组，向下展开）：明细行逐条复制 + 小计行每组一条
      // + 合计行垫底。标题/列头/签字是数据块外的静态内容——数据块只为逐条展开而存在。
      {
        startRow: 2,
        endRow: 4,
        startCol: 0,
        endCol: 8,
        expand: 'down',
        name: '明细行',
        groupBy: ['customer'],
        rowRoles: [
          { row: 3, role: 'groupFooter' },
          { row: 4, role: 'summary' },
        ],
        source: { kind: 'dataset', datasetId: SALES_LINES_DATASET, path: '' },
      },
    ],
    (doc) => {
      // 页眉：居中标题 + 列头行（静态，不套数据块）
      mergeText(doc, span(0, 0, 8), '销售明细清单', centered, bold, {
        font: { size: 16 },
      })
      const headers = ['单号', '日期', '客户', '品名', '规格', '单位', '数量', '单价', '金额']
      headers.forEach((text, col) =>
        putText(doc, cell(1, col), text, centered, bold, headerFill, bordered),
      )
      // 明细行：数据块 source 已是原始行数组，格内只取条目相对字段
      LIST_COLUMNS.forEach(([key, patches], col) =>
        putBinding(doc, cell(2, col), itemField(key), bordered, ...patches),
      )
      // 小计行（每组一条）：GROUP() 出组名，SUBTOTAL 同列按组求和；单价列留空补框
      mergeFunction(doc, span(3, 0, 5), groupFn('customer'), centered, bold, bordered)
      putFunction(doc, cell(3, 6), regionFn('SUBTOTAL', '明细行'), centered, bold, bordered)
      paint(doc, cell(3, 7), [bordered])
      putFunction(doc, cell(3, 8), regionFn('SUBTOTAL', '明细行'), rightAligned, bold, fixed2, bordered)
      // 合计行（垫底一条）：SUM 同列全量
      mergeText(doc, span(4, 0, 5), '合计', centered, bold, bordered)
      putFunction(doc, cell(4, 6), regionFn('SUM', '明细行'), centered, bold, bordered)
      paint(doc, cell(4, 7), [bordered])
      putFunction(doc, cell(4, 8), regionFn('SUM', '明细行'), rightAligned, bold, fixed2, bordered)
      // 签字：制表落款（静态文本，无边框）
      mergeText(doc, span(5, 0, 3), '制表人：', leftAligned)
      mergeText(doc, span(5, 4, 8), '制表日期：', leftAligned)
      geometry(doc, [36, 26, 26, 26, 26, 30], [86, 78, 118, 92, 108, 40, 46, 52, 66])
    },
  )
}

// ─── 中式单据：销售出库单 ─────────────────────────────────────────────────────

function buildCnReceiptTemplate(): FormTemplate {
  /**
   * 首单字段绑定：非数组聚合 `订单头` 的直引（`{{agg.订单头.order_no}}`）。
   * 教学口径：单据头字段直接引用非数组聚合，不需要数据块——聚合引用绑定任意格可设，
   * 求值只看聚合环境、与所在数据块无关。
   */
  const headerField = (path: string): FormCellBinding =>
    aggField(ORDER_AGGREGATION.name, path)
  return buildTemplate(
    '销售出库单（中式单据）',
    [
      // 唯一数据块 = 明细（向下展开 + 数据集归组源）。表头/客户/合计/签字都不套数据块：
      // 表头字段是非数组聚合直引，列头/合计/签字是静态内容——数据块只为逐条展开而存在。
      {
        startRow: 5,
        endRow: 5,
        startCol: 0,
        endCol: 7,
        expand: 'down',
        name: '明细',
        source: {
          kind: 'dataset',
          datasetId: ORDER_ITEMS_DATASET,
          expression: GROUP_ORDER_ITEMS_EXPRESSION,
          path: '[0].items',
        },
      },
    ],
    (doc) => {
      // 表头：单据标题 + 首单订单编号/日期（聚合引用绑定，数据块外直取）
      mergeText(doc, span(0, 0, 7), '销售出库单', centered, bold, {
        font: { size: 20 },
      })
      putText(doc, cell(1, 0), '订单编号：', rightAligned)
      mergeBinding(doc, span(1, 1, 2), headerField('order_no'), leftAligned)
      putText(doc, cell(1, 5), '日期：', rightAligned)
      mergeBinding(doc, span(1, 6, 7), headerField('order_date'), leftAligned)
      // 信息：客户 / 收货地址（首单字段直引）
      putText(doc, cell(2, 0), '客户：', rightAligned)
      mergeBinding(doc, span(2, 1, 7), headerField('customer'), leftAligned)
      putText(doc, cell(3, 0), '地址：', rightAligned)
      mergeBinding(doc, span(3, 1, 7), headerField('address'), leftAligned)
      // 明细：列头行（静态）+ 首单 items 循环（数据块 source 出条目，格内只取相对字段）
      putText(doc, cell(4, 0), '序号', centered, bold, headerFill, bordered)
      mergeText(doc, span(4, 1, 2), '品名', centered, bold, headerFill, bordered)
      const detailHeaders: readonly [number, string][] = [
        [3, '规格'],
        [4, '单位'],
        [5, '数量'],
        [6, '单价'],
        [7, '金额'],
      ]
      for (const [col, text] of detailHeaders) {
        putText(doc, cell(4, col), text, centered, bold, headerFill, bordered)
      }
      putBinding(doc, cell(5, 0), itemField('line_no'), centered, bordered)
      mergeBinding(doc, span(5, 1, 2), itemField('item_name'), leftAligned, bordered)
      putBinding(doc, cell(5, 3), itemField('spec'), leftAligned, bordered)
      putBinding(doc, cell(5, 4), itemField('unit'), centered, bordered)
      putBinding(doc, cell(5, 5), itemField('qty'), centered, bordered)
      putBinding(doc, cell(5, 6), itemField('unit_price'), rightAligned, fixed2, bordered)
      putBinding(doc, cell(5, 7), itemField('amount'), rightAligned, fixed2, bordered)
      // 合计：大写金额横跨品名/规格/单位列（numFmt cnUpper 套在 SUM 结果上），
      // 数量/金额对齐明细列（同列 SUM 省字段），单价列留空补框——数据块外的静态函数格
      mergeText(doc, span(6, 0, 1), '合计', centered, bold, bordered)
      mergeFunction(
        doc,
        span(6, 2, 4),
        regionFn('SUM', '明细', 'amount'),
        leftAligned,
        cnUpper,
        bordered,
      )
      putFunction(doc, cell(6, 5), regionFn('SUM', '明细'), centered, bordered)
      paint(doc, cell(6, 6), [bordered])
      putFunction(doc, cell(6, 7), regionFn('SUM', '明细'), rightAligned, bold, fixed2, bordered)
      // 签字：经手/审核/制单/签收（首单人员直引，无边框）
      putText(doc, cell(7, 0), '经手人：', rightAligned)
      mergeBinding(doc, span(7, 1, 2), headerField('handler'), leftAligned)
      putText(doc, cell(7, 4), '审核：', rightAligned)
      mergeBinding(doc, span(7, 5, 6), headerField('auditor'), leftAligned)
      putText(doc, cell(8, 0), '制单：', rightAligned)
      mergeBinding(doc, span(8, 1, 2), headerField('maker'), leftAligned)
      putText(doc, cell(8, 4), '签收：', rightAligned)
      mergeBinding(doc, span(8, 5, 6), headerField('receiver'), leftAligned)
      geometry(doc, [44, 26, 26, 26, 26, 26, 28, 30, 30], [64, 110, 84, 116, 40, 46, 54, 72])
    },
    [ORDER_AGGREGATION],
  )
}

// ─── 示例 · 横向列表（横向商品一览） ─────────────────────────────────────────
//
// 演示：`expand: 'right'` 的数据块按数据条数**向右**整块复制（列轴），一列一个条目。
// 去哪里看：选中商品区（数据块面板第 1 项「商品」）→ 列表方式 = 横向列表；数据源 =
// 订单明细数据集。左列「品名/数量/单价/金额」是数据块外的静态标签——数据块不必覆盖
// 整张画布，静态内容可以贴着列表区摆放。预览时 5 条明细横铺成 5 列。
function buildRightExpandTemplate(): FormTemplate {
  return buildTemplate(
    '示例 · 横向列表（横向商品一览）',
    [
      {
        startRow: 1,
        endRow: 4,
        startCol: 1,
        endCol: 1,
        expand: 'right',
        name: '商品',
        source: { kind: 'dataset', datasetId: ORDER_ITEMS_DATASET, path: '' },
      },
    ],
    (doc) => {
      // 标题只能放单格：横向列表会向右复制所跨列的静态内容与合并区（跨列表列的合并
      // 会被丢弃），所以横向表头的标题不做合并、放在展开区外的第 0 列。
      putText(doc, cell(0, 0), '商品横向一览', leftAligned, bold, { font: { size: 15 } })
      const labels: readonly [number, string][] = [
        [1, '品名'],
        [2, '数量'],
        [3, '单价'],
        [4, '金额'],
      ]
      for (const [row, text] of labels) {
        putText(doc, cell(row, 0), text, centered, bold, headerFill, bordered)
      }
      // 展开区内一格一条目字段：预览/打印时整列按条目复制
      putBinding(doc, cell(1, 1), itemField('item_name'), leftAligned, bordered)
      putBinding(doc, cell(2, 1), itemField('qty'), centered, bordered)
      putBinding(doc, cell(3, 1), itemField('unit_price'), rightAligned, fixed2, bordered)
      putBinding(doc, cell(4, 1), itemField('amount'), rightAligned, fixed2, bordered)
      // 列宽合计 ≤ A4 纵向可用页宽：110 + 5 × 116 = 690px（5 条明细横铺不分带）
      geometry(doc, [34, 32, 26, 26, 28], [110, 116])
    },
  )
}

// ─── 示例 · 非数组聚合引用（汇总卡） ─────────────────────────────────────────
//
// 演示：非数组型聚合（value）产出一个对象，**整张模板零数据块**——数据块外的格子用
// `{ kind: 'agg' }` 绑定直引它的字段（占位符 `{{agg.销售汇总.总金额}}`），求值只看
// 聚合环境。比中式单据更聚焦：不展开的值（汇总数、单据头字段）不需要数据块。
// 去哪里看：聚合面板看「销售汇总」的非数组类型与函数体（空数据安全）；选中数值格看
// 绑定面板的聚合引用形态。
function buildAggValueTemplate(): FormTemplate {
  return buildTemplate(
    '示例 · 非数组聚合引用（汇总卡）',
    [],
    (doc) => {
      mergeText(doc, span(0, 0, 3), '销售汇总（非数组聚合直引）', centered, bold, {
        font: { size: 16 },
      })
      // 值格全部是聚合引用绑定：{{agg.销售汇总.字段}}，不需要任何数据块
      putText(doc, cell(1, 0), '首单号：', rightAligned, bold)
      putBinding(doc, cell(1, 1), aggField(SALES_SUMMARY_AGGREGATION.name, '首单号'), leftAligned)
      putText(doc, cell(1, 2), '订单数：', rightAligned, bold)
      putBinding(doc, cell(1, 3), aggField(SALES_SUMMARY_AGGREGATION.name, '订单数'), centered)
      putText(doc, cell(2, 0), '总数量：', rightAligned, bold)
      putBinding(doc, cell(2, 1), aggField(SALES_SUMMARY_AGGREGATION.name, '总数量'), centered)
      putText(doc, cell(2, 2), '总金额：', rightAligned, bold)
      putBinding(
        doc,
        cell(2, 3),
        aggField(SALES_SUMMARY_AGGREGATION.name, '总金额'),
        rightAligned,
        fixed2,
      )
      geometry(doc, [40, 30, 30], [90, 100, 90, 110])
    },
    [SALES_SUMMARY_AGGREGATION],
  )
}

// ─── 示例 · 计算列（自定义 JS 表达式） ───────────────────────────────────────
//
// 演示：明细区内的 `kind:'expr'` 函数格（自定义 JS 表达式逃生舱）——`item` 是当前
// 条目，`金额（现算）= item.qty * item.unit_price` 与数据集现成的 amount 列并排，
// 两列渲染结果完全一致；`税额` 再叠一层算术。合计行的税额表达式里还能直接调
// 数据块函数：`SUM('明细', 'amount') * 0.13`。
// 去哪里看：选中「金额（现算）」/「税额」格 → 绑定面板切「函数」→ 表达式形态。
function buildComputedColumnTemplate(): FormTemplate {
  return buildTemplate(
    '示例 · 计算列（自定义 JS 表达式）',
    [
      // 唯一数据块 = 明细（向下展开）；标题/列头/合计行是数据块外的静态内容
      {
        startRow: 2,
        endRow: 3,
        startCol: 0,
        endCol: 5,
        expand: 'down',
        name: '明细',
        rowRoles: [{ row: 3, role: 'summary' }],
        source: { kind: 'dataset', datasetId: SALES_LINES_DATASET, path: '' },
      },
    ],
    (doc) => {
      mergeText(doc, span(0, 0, 5), '销售明细（金额现算）', centered, bold, {
        font: { size: 16 },
      })
      const headers = ['品名', '数量', '单价', '金额（数据集）', '金额（现算）', '税额（13%）']
      headers.forEach((text, col) =>
        putText(doc, cell(1, col), text, centered, bold, headerFill, bordered),
      )
      putBinding(doc, cell(2, 0), itemField('item_name'), leftAligned, bordered)
      putBinding(doc, cell(2, 1), itemField('qty'), centered, bordered)
      putBinding(doc, cell(2, 2), itemField('unit_price'), rightAligned, fixed2, bordered)
      putBinding(doc, cell(2, 3), itemField('amount'), rightAligned, fixed2, bordered)
      // 计算列：item 语境里现算金额与税额（与 amount 列并排对照）
      putFunction(
        doc,
        cell(2, 4),
        exprFn('item.qty * item.unit_price'),
        rightAligned,
        fixed2,
        bordered,
      )
      putFunction(
        doc,
        cell(2, 5),
        exprFn('item.qty * item.unit_price * 0.13'),
        rightAligned,
        fixed2,
        bordered,
      )
      // 合计行：现算列没有绑定字段，SUM 写显式字段；税额合计在表达式里调数据块函数
      putText(doc, cell(3, 0), '合计', centered, bold, bordered)
      putFunction(doc, cell(3, 1), regionFn('SUM', '明细', 'qty'), centered, bold, bordered)
      paint(doc, cell(3, 2), [bordered])
      putFunction(
        doc,
        cell(3, 3),
        regionFn('SUM', '明细', 'amount'),
        rightAligned,
        bold,
        fixed2,
        bordered,
      )
      putFunction(
        doc,
        cell(3, 4),
        regionFn('SUM', '明细', 'amount'),
        rightAligned,
        bold,
        fixed2,
        bordered,
      )
      putFunction(
        doc,
        cell(3, 5),
        exprFn("SUM('明细', 'amount') * 0.13"),
        rightAligned,
        bold,
        fixed2,
        bordered,
      )
      geometry(doc, [36, 26, 26, 26], [128, 46, 52, 96, 96, 84])
    },
  )
}

// ─── 示例 · 聚合加工与链式引用（订单台账） ───────────────────────────────────
//
// 演示：两个聚合的链式流水线——
// 1. `订单台账`（聚合面板）：函数体把销售明细扁平行按单据归组，算好品种数/数量/
//    金额，产出数组挂到 `agg.订单台账`；
// 2. `总览`（零入参聚合）：只消费前序结果 `agg.订单台账`（聚合按声明序求值，后序
//    的 `agg` 里已有前序结果），再算订单数/总数量/总金额。
// 数据块侧：唯一数据块「台账」以 `kind:'agg'` 数据源直接循环数组型聚合产物；总览行的
// 静态标签旁用表达式函数格取 `agg.总览['订单数']` / `agg.总览['总金额']`（数据块外）。
// 去哪里看：聚合面板看两个聚合的类型与函数体（链式引用的防御式写法）；选中台账数据块
// 看 agg 数据源；选中底部两个数值格看表达式形态的函数。
function buildAggChainTemplate(): FormTemplate {
  return buildTemplate(
    '示例 · 聚合加工与链式引用（订单台账）',
    [
      // 唯一数据块 = 台账（向下展开 + 数组型聚合源）；标题/列头/合计/总览是静态内容
      {
        startRow: 2,
        endRow: 3,
        startCol: 0,
        endCol: 4,
        expand: 'down',
        name: '台账',
        rowRoles: [{ row: 3, role: 'summary' }],
        source: { kind: 'agg', aggName: LEDGER_AGGREGATION.name, path: '' },
      },
    ],
    (doc) => {
      mergeText(doc, span(0, 0, 4), '订单汇总台账（聚合加工）', centered, bold, {
        font: { size: 16 },
      })
      const headers = ['单号', '客户', '品种数', '数量', '金额']
      headers.forEach((text, col) =>
        putText(doc, cell(1, col), text, centered, bold, headerFill, bordered),
      )
      // 台账行：绑定的字段全是聚合函数体里算好的（order_no/customer/kinds/qty/amount）
      putBinding(doc, cell(2, 0), itemField('order_no'), centered, bordered)
      putBinding(doc, cell(2, 1), itemField('customer'), leftAligned, bordered)
      putBinding(doc, cell(2, 2), itemField('kinds'), centered, bordered)
      putBinding(doc, cell(2, 3), itemField('qty'), centered, bordered)
      putBinding(doc, cell(2, 4), itemField('amount'), rightAligned, fixed2, bordered)
      // 合计行：对台账数据块（聚合产物数组）做 SUM，字段写显式名
      mergeText(doc, span(3, 0, 1), '合计', centered, bold, bordered)
      putFunction(doc, cell(3, 2), regionFn('SUM', '台账', 'kinds'), centered, bold, bordered)
      putFunction(doc, cell(3, 3), regionFn('SUM', '台账', 'qty'), centered, bold, bordered)
      putFunction(
        doc,
        cell(3, 4),
        regionFn('SUM', '台账', 'amount'),
        rightAligned,
        bold,
        fixed2,
        bordered,
      )
      // 总览：链式聚合的结果经表达式函数格取值（agg.名['键']）
      putText(doc, cell(4, 0), '订单数：', rightAligned, bold)
      putFunction(doc, cell(4, 1), exprFn("agg.总览['订单数']"), leftAligned)
      putText(doc, cell(4, 2), '总金额：', rightAligned, bold)
      putFunction(doc, cell(4, 3), exprFn("agg.总览['总金额']"), leftAligned, fixed2)
      geometry(doc, [36, 26, 26, 26, 30], [96, 150, 64, 56, 84])
    },
    [LEDGER_AGGREGATION, OVERVIEW_AGGREGATION],
  )
}

// ─── 示例 · 重塑表达式（明细归组嵌套） ───────────────────────────────────────
//
// 演示：数据块数据源上的重塑表达式（expression，入参 rows）——订单明细扁平行被整成
// [{ order_no, items, qty, amount }] 嵌套结构：items 保留嵌套明细（绑定编辑器的
// 路径树里能看到 [] / [0] 下钻分支），qty/amount 是归组顺带算好的标量，台账区直接
// 绑定。品种数一格用表达式 `item.items.length` 下钻嵌套数组——条目里不止标量字段。
// 与「聚合加工」样的区别：JS 就写在数据块数据源上（就近服务本数据块的循环形态），
// 不进聚合面板。去哪里看：选中「台账」数据块 → 数据源的重塑表达式输入框。
function buildReshapeNestedTemplate(): FormTemplate {
  return buildTemplate(
    '示例 · 重塑表达式（明细归组嵌套）',
    [
      // 唯一数据块 = 台账（向下展开 + 重塑表达式源）；标题/列头/合计行是静态内容
      {
        startRow: 2,
        endRow: 2,
        startCol: 0,
        endCol: 3,
        expand: 'down',
        name: '台账',
        source: {
          kind: 'dataset',
          datasetId: ORDER_ITEMS_DATASET,
          expression: NESTED_LEDGER_EXPRESSION,
          path: '',
        },
      },
    ],
    (doc) => {
      mergeText(doc, span(0, 0, 3), '订单交货台账（重塑表达式）', centered, bold, {
        font: { size: 16 },
      })
      const headers = ['单号', '品种数', '数量', '金额']
      headers.forEach((text, col) =>
        putText(doc, cell(1, col), text, centered, bold, headerFill, bordered),
      )
      // 台账行：单号/数量/金额绑重塑产出的标量；品种数用表达式下钻嵌套 items
      putBinding(doc, cell(2, 0), itemField('order_no'), centered, bordered)
      putFunction(doc, cell(2, 1), exprFn('item.items.length'), centered, bordered)
      putBinding(doc, cell(2, 2), itemField('qty'), centered, bordered)
      putBinding(doc, cell(2, 3), itemField('amount'), rightAligned, fixed2, bordered)
      // 合计行（数据块外函数格）：SUM 对台账数据块的循环数组取字段
      mergeText(doc, span(3, 0, 1), '合计', centered, bold, bordered)
      putFunction(doc, cell(3, 2), regionFn('SUM', '台账', 'qty'), centered, bold, bordered)
      putFunction(
        doc,
        cell(3, 3),
        regionFn('SUM', '台账', 'amount'),
        rightAligned,
        bold,
        fixed2,
        bordered,
      )
      geometry(doc, [36, 26, 26, 26], [96, 64, 56, 84])
    },
  )
}

// ─── 示例 · 固定排版（空白领料单） ───────────────────────────────────────────
//
// 演示：整张单据**零数据块**——固定文字不需要数据块，静态文字与留白手写框直接铺在
// 画布上，不绑任何数据源；打印预览不需要任何数据集。适合套打或手工填写的空白单据。
// 去哪里看：数据块面板为空；预览/打印无需选数据集。
function buildFixedLayoutTemplate(): FormTemplate {
  return buildTemplate(
    '示例 · 固定排版（空白领料单）',
    [],
    (doc) => {
      // 单据头：标题 + 领料部门/日期/用途的手写留白
      mergeText(doc, span(0, 0, 5), '领料单', centered, bold, { font: { size: 18 } })
      putText(doc, cell(1, 0), '领料部门：', rightAligned)
      mergeText(doc, span(1, 1, 2), '', bordered)
      putText(doc, cell(1, 3), '领料日期：', rightAligned)
      mergeText(doc, span(1, 4, 5), '', bordered)
      putText(doc, cell(2, 0), '物料用途：', rightAligned)
      mergeText(doc, span(2, 1, 5), '', bordered)
      // 物料明细：列头 + 6 行空白手写行（只有样式与合并，没有任何值/绑定）
      mergeText(doc, span(3, 0, 2), '物料名称', centered, bold, headerFill, bordered)
      putText(doc, cell(3, 3), '单位', centered, bold, headerFill, bordered)
      putText(doc, cell(3, 4), '数量', centered, bold, headerFill, bordered)
      putText(doc, cell(3, 5), '用途', centered, bold, headerFill, bordered)
      for (let row = 4; row <= 9; row++) {
        mergeText(doc, span(row, 0, 2), '', bordered)
        for (let col = 3; col <= 5; col++) paint(doc, cell(row, col), [bordered])
      }
      // 签字与备注：固定文字 + 手写留白
      putText(doc, cell(10, 0), '领料人：', rightAligned)
      paint(doc, cell(10, 1), [bordered])
      putText(doc, cell(10, 2), '审批人：', rightAligned)
      paint(doc, cell(10, 3), [bordered])
      putText(doc, cell(10, 4), '仓管员：', rightAligned)
      paint(doc, cell(10, 5), [bordered])
      putText(doc, cell(11, 0), '备注：', rightAligned)
      mergeText(doc, span(11, 1, 5), '', bordered)
      geometry(
        doc,
        [40, 28, 28, 26, 26, 26, 26, 26, 26, 26, 30, 30],
        [76, 60, 60, 46, 46, 90],
      )
    },
  )
}

// ─── 示例 · 组头行与小计（按单据分组） ───────────────────────────────────────
//
// 演示：分组数据块的全套行角色第二角度——按单号 groupBy，数据块里四行分别是
// `groupHeader`（组头行：绑定的字段取组内第 1 条，渲染出「单号 + 客户」横条）、
// `detail`（明细行）、`groupFooter`（小计行：GROUP() 省字段取首个分组字段出组名，
// SUBTOTAL 同列省字段按组求和）、`summary`（合计行垫底）。
// 去哪里看：数据块面板「明细」的分组字段 = order_no；行角色在画布左侧行首或数据块
// 弹框里设置；选中组头横条看绑定、小计行看 GROUP/SUBTOTAL 函数格。
function buildGroupHeaderTemplate(): FormTemplate {
  return buildTemplate(
    '示例 · 组头行与小计（按单据分组）',
    [
      // 唯一数据块 = 明细（按单号分组，向下展开）；标题/列头/签字是静态内容
      {
        startRow: 2,
        endRow: 5,
        startCol: 0,
        endCol: 3,
        expand: 'down',
        name: '明细',
        groupBy: ['order_no'],
        rowRoles: [
          { row: 2, role: 'groupHeader' },
          { row: 4, role: 'groupFooter' },
          { row: 5, role: 'summary' },
        ],
        source: { kind: 'dataset', datasetId: SALES_LINES_DATASET, path: '' },
      },
    ],
    (doc) => {
      mergeText(doc, span(0, 0, 3), '按单据分组明细（组头 + 小计 + 合计）', centered, bold, {
        font: { size: 16 },
      })
      const headers = ['序号', '品名', '数量', '金额']
      headers.forEach((text, col) =>
        putText(doc, cell(1, col), text, centered, bold, headerFill, bordered),
      )
      // 组头行（每组一条）：绑定取组内第 1 条——单号 + 客户拼成组横条
      mergeBinding(doc, span(2, 0, 1), itemField('order_no'), leftAligned, bold, headerFill, bordered)
      mergeBinding(doc, span(2, 2, 3), itemField('customer'), leftAligned, bold, headerFill, bordered)
      // 明细行：序号/品名/数量/金额（数量、金额列有小计/合计同列函数，字段可省）
      putBinding(doc, cell(3, 0), itemField('line_no'), centered, bordered)
      putBinding(doc, cell(3, 1), itemField('item_name'), leftAligned, bordered)
      putBinding(doc, cell(3, 2), itemField('qty'), centered, bordered)
      putBinding(doc, cell(3, 3), itemField('amount'), rightAligned, fixed2, bordered)
      // 小计行（每组一条）：GROUP() 省字段 = 首个分组字段（单号）；金额列 SUBTOTAL
      // 同列省字段；数量列必须写显式字段——组头行在本列有 customer 绑定（合并锚点），
      // 同列省字段会先取到它而不是明细行的 qty
      mergeFunction(doc, span(4, 0, 1), groupFn(), leftAligned, bold, bordered)
      putFunction(doc, cell(4, 2), regionFn('SUBTOTAL', '明细', 'qty'), centered, bold, bordered)
      putFunction(
        doc,
        cell(4, 3),
        regionFn('SUBTOTAL', '明细'),
        rightAligned,
        bold,
        fixed2,
        bordered,
      )
      // 合计行（垫底一条）：SUM 同理，数量写显式字段、金额同列省字段
      mergeText(doc, span(5, 0, 1), '合计', leftAligned, bold, bordered)
      putFunction(doc, cell(5, 2), regionFn('SUM', '明细', 'qty'), centered, bold, bordered)
      putFunction(doc, cell(5, 3), regionFn('SUM', '明细'), rightAligned, bold, fixed2, bordered)
      // 签字：静态落款
      mergeText(doc, span(6, 0, 1), '制表人：', leftAligned)
      mergeText(doc, span(6, 2, 3), '制表日期：', leftAligned)
      geometry(doc, [36, 26, 28, 26, 26, 26, 30], [64, 160, 56, 84])
    },
  )
}

// ─── 种子模板集合 ─────────────────────────────────────────────────────────────

/** 内置起点模板：id 固定（幂等落库键），template 为完整 FormTemplate JSON */
interface SeedTemplate {
  id: string
  template: FormTemplate
}

let seedTemplatesCache: readonly SeedTemplate[] | undefined

/**
 * 内置起点模板集：首次调用才构建、构建一次后缓存。模块级 const 会在 import 时
 * 立即走 FormDoc 序列化链路构建 9 份模板，拖高所有 server 测试的启动成本——惰性化
 * 后只有真正 seed / 校验种子的调用方付这笔账。
 */
export function getSeedTemplates(): readonly SeedTemplate[] {
  seedTemplatesCache ??= [
    { id: SEED_TEMPLATE_LIST_ID, template: buildSalesListTemplate() },
    { id: SEED_TEMPLATE_CN_DOC_ID, template: buildCnReceiptTemplate() },
    { id: SEED_TEMPLATE_RIGHT_ID, template: buildRightExpandTemplate() },
    { id: SEED_TEMPLATE_EXPR_ID, template: buildComputedColumnTemplate() },
    { id: SEED_TEMPLATE_AGG_ID, template: buildAggChainTemplate() },
    { id: SEED_TEMPLATE_AGG_VALUE_ID, template: buildAggValueTemplate() },
    { id: SEED_TEMPLATE_RESHAPE_ID, template: buildReshapeNestedTemplate() },
    { id: SEED_TEMPLATE_FIXED_ID, template: buildFixedLayoutTemplate() },
    { id: SEED_TEMPLATE_GROUP_ID, template: buildGroupHeaderTemplate() },
  ]
  return seedTemplatesCache
}
