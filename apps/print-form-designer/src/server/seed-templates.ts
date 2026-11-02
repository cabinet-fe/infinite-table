// 内置起点模板（P9）：列表样与中式单据两份种子模板的定义与构建，随 seed 幂等落库。
// 构建走 FormDoc 公共入口（fromTemplate + toTemplate 与设计器加载/保存同一条序列化
// 链路），落库 JSON 加载即完整还原画布；绑定全部指向 seed 数据集——列表样直吃销售
// 明细原始行（根数组 `[].列名` 平铺循环），中式单据订单头取 `rows[0]`、订单明细经
// 转换器表达式归组为嵌套二级数组（`[0].items[].列名` 循环取值 + 聚合合计）。
import {
  BORDER_STYLE_WIDTH,
  Sheet,
  type CellAddress,
  type CellRange,
  type CellStylePatch,
} from '@infinitable/sheet'

import { FormDoc } from '../designer/form-doc'
import {
  TEMPLATE_SCHEMA_VERSION,
  type FormBand,
  type FormCellBinding,
  type FormTemplate,
} from '../designer/template'

export const SEED_TEMPLATE_LIST_ID = 'seed-template-sales-list'
export const SEED_TEMPLATE_CN_DOC_ID = 'seed-template-cn-receipt'

const SALES_LINES_DATASET = 'seed-dataset-sales-lines'
const ORDER_HEADER_DATASET = 'seed-dataset-order-header'
const ORDER_ITEMS_DATASET = 'seed-dataset-order-items'

/** 订单头取数表达式：原始行数组 → 首行对象（单据头/信息/签字字段直取） */
const FIRST_ORDER_EXPRESSION = 'rows[0]'

/** 订单明细归组表达式：原始行 → [{ order_no, items: [...] }] 嵌套二级数组（明细循环与聚合共用形态） */
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

/** 空画布起建：骨架波段 → FormDoc → 布局回调 → 序列化模板 JSON */
function buildTemplate(
  name: string,
  bands: FormBand[],
  cols: number,
  layout: (doc: FormDoc) => void,
): FormTemplate {
  const doc = FormDoc.fromTemplate({
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name,
    bands,
    cols,
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

// ─── 列表样：销售明细清单 ─────────────────────────────────────────────────────

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
    '销售明细清单（列表样）',
    [
      { kind: 'pageHeader', startRow: 0, endRow: 1 },
      { kind: 'detail', startRow: 2, endRow: 2 },
      { kind: 'summary', startRow: 3, endRow: 3 },
      { kind: 'signature', startRow: 4, endRow: 4 },
    ],
    9,
    (doc) => {
      // 页眉：居中标题 + 列头行
      mergeText(doc, span(0, 0, 8), '销售明细清单', centered, bold, {
        font: { size: 16 },
      })
      const headers = ['单号', '日期', '客户', '品名', '规格', '单位', '数量', '单价', '金额']
      headers.forEach((text, col) =>
        putText(doc, cell(1, col), text, centered, bold, headerFill, bordered),
      )
      // 明细：销售明细原始行平铺循环（无需重塑表达式）
      LIST_COLUMNS.forEach(([key, patches], col) =>
        putBinding(
          doc,
          cell(2, col),
          { datasetId: SALES_LINES_DATASET, path: `[].${key}` },
          bordered,
          ...patches,
        ),
      )
      // 合计：数量/金额纵向聚合，单价列留空补框
      mergeText(doc, span(3, 0, 5), '合计', centered, bold, bordered)
      putBinding(
        doc,
        cell(3, 6),
        { datasetId: SALES_LINES_DATASET, path: '[].qty', aggregate: 'sum' },
        centered,
        bold,
        bordered,
      )
      paint(doc, cell(3, 7), [bordered])
      putBinding(
        doc,
        cell(3, 8),
        { datasetId: SALES_LINES_DATASET, path: '[].amount', aggregate: 'sum' },
        rightAligned,
        bold,
        fixed2,
        bordered,
      )
      // 签字：制表落款（静态文本，无边框）
      mergeText(doc, span(4, 0, 3), '制表人：', leftAligned)
      mergeText(doc, span(4, 4, 8), '制表日期：', leftAligned)
      geometry(doc, [36, 26, 26, 26, 30], [86, 78, 118, 92, 108, 40, 46, 52, 66])
    },
  )
}

// ─── 中式单据：销售出库单 ─────────────────────────────────────────────────────

function buildCnReceiptTemplate(): FormTemplate {
  const headerBinding = (path: string): FormCellBinding => ({
    datasetId: ORDER_HEADER_DATASET,
    expression: FIRST_ORDER_EXPRESSION,
    path,
  })
  const itemBinding = (
    path: string,
    aggregate?: FormCellBinding['aggregate'],
  ): FormCellBinding => ({
    datasetId: ORDER_ITEMS_DATASET,
    expression: GROUP_ORDER_ITEMS_EXPRESSION,
    path,
    ...(aggregate ? { aggregate } : {}),
  })
  return buildTemplate(
    '销售出库单（中式单据）',
    [
      { kind: 'pageHeader', startRow: 0, endRow: 1 },
      { kind: 'info', startRow: 2, endRow: 3 },
      // 列头独立成表头波段：明细波段整段按元素复制，列头混入会逐行重复
      { kind: 'pageHeader', startRow: 4, endRow: 4 },
      { kind: 'detail', startRow: 5, endRow: 5 },
      { kind: 'summary', startRow: 6, endRow: 6 },
      { kind: 'signature', startRow: 7, endRow: 8 },
    ],
    8,
    (doc) => {
      // 表头：单据标题 + 首单订单编号/日期
      mergeText(doc, span(0, 0, 7), '销售出库单', centered, bold, {
        font: { size: 20 },
      })
      putText(doc, cell(1, 0), '订单编号：', rightAligned)
      mergeBinding(doc, span(1, 1, 2), headerBinding('order_no'), leftAligned)
      putText(doc, cell(1, 5), '日期：', rightAligned)
      mergeBinding(doc, span(1, 6, 7), headerBinding('order_date'), leftAligned)
      // 信息：客户 / 收货地址（首单）
      putText(doc, cell(2, 0), '客户：', rightAligned)
      mergeBinding(doc, span(2, 1, 7), headerBinding('customer'), leftAligned)
      putText(doc, cell(3, 0), '地址：', rightAligned)
      mergeBinding(doc, span(3, 1, 7), headerBinding('address'), leftAligned)
      // 明细：列头行 + 首单 items 循环（嵌套二级数组取数）
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
      putBinding(doc, cell(5, 0), itemBinding('[0].items[].line_no'), centered, bordered)
      mergeBinding(doc, span(5, 1, 2), itemBinding('[0].items[].item_name'), leftAligned, bordered)
      putBinding(doc, cell(5, 3), itemBinding('[0].items[].spec'), leftAligned, bordered)
      putBinding(doc, cell(5, 4), itemBinding('[0].items[].unit'), centered, bordered)
      putBinding(doc, cell(5, 5), itemBinding('[0].items[].qty'), centered, bordered)
      putBinding(
        doc,
        cell(5, 6),
        itemBinding('[0].items[].unit_price'),
        rightAligned,
        fixed2,
        bordered,
      )
      putBinding(doc, cell(5, 7), itemBinding('[0].items[].amount'), rightAligned, fixed2, bordered)
      // 合计：大写金额横跨品名/规格/单位列，数量/金额对齐明细列，单价列留空补框
      mergeText(doc, span(6, 0, 1), '合计', centered, bold, bordered)
      mergeBinding(
        doc,
        span(6, 2, 4),
        itemBinding('[0].items[].amount', 'sum'),
        leftAligned,
        cnUpper,
        bordered,
      )
      putBinding(doc, cell(6, 5), itemBinding('[0].items[].qty', 'sum'), centered, bordered)
      paint(doc, cell(6, 6), [bordered])
      putBinding(
        doc,
        cell(6, 7),
        itemBinding('[0].items[].amount', 'sum'),
        rightAligned,
        bold,
        fixed2,
        bordered,
      )
      // 签字：经手/审核/制单/签收（首单人员，无边框）
      putText(doc, cell(7, 0), '经手人：', rightAligned)
      mergeBinding(doc, span(7, 1, 2), headerBinding('handler'), leftAligned)
      putText(doc, cell(7, 4), '审核：', rightAligned)
      mergeBinding(doc, span(7, 5, 6), headerBinding('auditor'), leftAligned)
      putText(doc, cell(8, 0), '制单：', rightAligned)
      mergeBinding(doc, span(8, 1, 2), headerBinding('maker'), leftAligned)
      putText(doc, cell(8, 4), '签收：', rightAligned)
      mergeBinding(doc, span(8, 5, 6), headerBinding('receiver'), leftAligned)
      geometry(doc, [44, 26, 26, 26, 26, 26, 28, 30, 30], [64, 110, 84, 116, 40, 46, 54, 72])
    },
  )
}

// ─── 种子模板集合 ─────────────────────────────────────────────────────────────

/** 内置起点模板：id 固定（幂等落库键），template 为完整 FormTemplate JSON */
export interface SeedTemplate {
  id: string
  template: FormTemplate
}

export const SEED_TEMPLATES: readonly SeedTemplate[] = [
  { id: SEED_TEMPLATE_LIST_ID, template: buildSalesListTemplate() },
  { id: SEED_TEMPLATE_CN_DOC_ID, template: buildCnReceiptTemplate() },
]
