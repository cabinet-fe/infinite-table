// 打印单演示区装配：配置驱动的「打印单配置 + 绑定数据集 → 按配置渲染 → 打印」接入形态。
// 配置（形态/版面/明细列/头尾区）不再携带数据：全形态共用单一模拟 SQL 数据集
// （PRINT_FORM_DATASET，schema 固定含类型标注的扁平行记录——每行是字段→标量值对象：
// 日期存 ISO 字符串、金额存数值、签名图存 dataURL）。配置经适配器产出 PrintSource
// （行/列几何、merges、cellStyle、cellImage 同一口径）：屏上 ListTable 只读渲染
// （merges 经 setMergeCells、签名图经 resolveCellImage 走 media 层），打印走 print 插件
// handle（paginate/buildDocumentHtml/print）。两种形态：列表样（A4 纵向 fitpage + 两行
// 表头带每页重复 + 页脚页码/本页合计占位符）与中国式表格单据（标题合并跨全列 + 信息区
// 标签值合并 + 全格四边完整边框 + groupBreakBy 单据号每单一页——分组判定走 col 0 的
// cellValue 原始单据号通道，显示链格式化不影响分组语义）。交互配置面板（PrintFormPage）
// 的格级映射地基：resolveCellBinding 反查格 → 配置节点（判别联合，合并格归锚点格），
// demo 句柄提供 applyConfig 整体重建与内建选区点选反馈（选中以配置节点为锚，重建后
// 按节点重映射）。控件面（面板/打印入口/产物预览）由 PrintFormPage 以 shadcn 渲染。

import type { CellRange, CellRef, CellStyle } from '@infinitable/grid'
import type { DataRecord, ListTable } from '@infinitable/table'
import {
  createPrintPlugin,
  type PrintConfig,
  type PrintPluginHandle,
  type PrintSource,
} from '@infinitable/plugins'

import { mountTable, type DemoMount } from '../mount'

// ---- 打印单配置模型（版面/列/头尾区声明；数据集固定，不在配置内） ----

/** 打印单形态：list 行式明细列表 / document 中国式表格单据 */
export type PrintFormKind = 'list' | 'document'

/** 字段格式化四档：无（缺省原样）/ date-cn ISO → YYYY年MM月DD日 / date-iso ISO 日期原样 / amount 千分位（两位小数） */
export type PrintFieldFormat = 'date-cn' | 'date-iso' | 'amount'

/** 明细列声明：绑定数据集字段（field）→ 表头文案 + 列宽 + 格式化方式 */
export interface PrintFormColumn {
  field: string
  title: string
  width: number
  format?: PrintFieldFormat
  /** 表头分组标题：相邻同 group 列在表头带上层合并为组格（列表样两行表头带） */
  group?: string
}

/** 单据头信息区字段：标签 + 绑定字段（document 形态，按列均分合并摆放） */
export interface PrintFormInfoField {
  label: string
  field: string
  format?: PrintFieldFormat
}

/** 签字栏字段：label 展示文案；field 指向签名图字段（dataURL）时签名格渲染图片 */
export interface PrintFormSignField {
  label: string
  field?: string
}

/** 打印单配置：形态 + 版面（映射 print 插件 PrintConfig）+ 明细列 + 单据头尾区 */
export interface PrintFormConfig {
  id: string
  title: string
  kind: PrintFormKind
  /** 版面参数（映射 PrintConfig；document 形态由适配器补 groupBreakBy 单据号列） */
  layout: PrintConfig
  /** 明细列（字段绑定 + 表头文案 + 列宽 + 格式化） */
  columns: readonly PrintFormColumn[]
  /** 分组换页字段（document 形态：字段值变化处换页，即每单一页） */
  groupField?: string
  /** 单据头信息区字段（document 形态） */
  infoFields?: readonly PrintFormInfoField[]
  /** 单据尾合计行金额字段（document 形态） */
  summaryField?: string
  /** 签字栏字段（document 形态尾行） */
  signFields?: readonly PrintFormSignField[]
}

// ---- 格式化器（屏上 displayValue 与打印 displayValue 同口径；cellValue 保持原始值） ----

/** ISO 日期（YYYY-MM-DD）→ YYYY年MM月DD日（手工切分，不受时区解析偏移影响） */
export function formatDateCn(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${year}年${month}月${day}日`
}

/** ISO 日期原样显示（兼容完整 ISO 时间串：取日期部，不做时区运算） */
export function formatDateIso(iso: string): string {
  return iso.slice(0, 10)
}

/** 数值 → 千分位（两位小数；显式 en-US 跨环境确定） */
export function formatAmount(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 按声明格式化字段值（四档；未声明格式的原样字符串化；null/undefined 出空串） */
function formatFieldValue(format: PrintFieldFormat | undefined, value: unknown): string {
  if (value == null) {
    return ''
  }
  if (format === 'date-cn') {
    return formatDateCn(String(value))
  }
  if (format === 'date-iso') {
    return formatDateIso(String(value))
  }
  if (format === 'amount') {
    return formatAmount(Number(value))
  }
  return String(value)
}

// ---- 共享样式常量 ----

/** 表头带底纹（列表样表头带 / 单据明细表头共用） */
const HEADER_BAND_BG = '#eef2f7'
/** 列表样网格线色（数据格细线） */
const LIST_GRID_COLOR = '#b6bdc9'
/** 中国式单据边框色（全格四边完整边框） */
const DOC_BORDER_COLOR = '#334155'
/** 基准行高（px，屏上演示与打印同口径；单据形态标题/信息/合计/签字行按种类加高） */
const BASE_ROW_HEIGHT = 30
/** 列表样表头带行数（上层组格 + 下层列标题；即每页重复表头行数） */
const LIST_BAND_ROWS = 2

/** 四边完整边框（各边同宽同色；document 形态全格、list 数据格细线共用工厂） */
function fullBorder(color: string): CellStyle['border'] {
  const edge = { width: 1, color }
  return { top: edge, right: edge, bottom: edge, left: edge }
}

// ---- 列表样适配器（两行表头带 + 数据行；cellValue 原始值、displayValue 格式化） ----

/** 列表样表头带几何：无 group 列纵合并两行；相邻同 group 列上层组格横跨 */
function buildListBand(columns: readonly PrintFormColumn[]): {
  merges: CellRange[]
  topText: Map<number, string>
  subText: Map<number, string>
} {
  const merges: CellRange[] = []
  const topText = new Map<number, string>()
  const subText = new Map<number, string>()
  for (let col = 0; col < columns.length;) {
    const column = columns[col]!
    let end = col
    if (column.group) {
      while (end + 1 < columns.length && columns[end + 1]!.group === column.group) {
        end++
      }
    }
    if (end > col) {
      // 组格横跨 [col, end]（上层），组内列标题落下层
      merges.push({ startCol: col, endCol: end, startRow: 0, endRow: 0 })
      topText.set(col, column.group!)
      for (let c = col; c <= end; c++) {
        subText.set(c, columns[c]!.title)
      }
    } else {
      // 无组（或组内单列）：列标题纵合并两行
      merges.push({ startCol: col, endCol: col, startRow: 0, endRow: 1 })
      topText.set(col, column.title)
    }
    col = end + 1
  }
  return { merges, topText, subText }
}

/** 列表样式集（表头带底纹居中加粗；数据格细线网格 + 格式化列右对齐） */
function createListStyles(): { band: CellStyle; cell: CellStyle; numericCell: CellStyle } {
  return {
    band: {
      fontWeight: 700,
      textAlign: 'center',
      background: HEADER_BAND_BG,
      border: fullBorder(LIST_GRID_COLOR),
    },
    cell: { border: fullBorder(LIST_GRID_COLOR) },
    numericCell: { border: fullBorder(LIST_GRID_COLOR), textAlign: 'right' },
  }
}

function createListSource(config: PrintFormConfig): PrintSource {
  const columns = config.columns
  const band = buildListBand(columns)
  const numericCols = new Set(columns.flatMap((column, col) => (column.format ? [col] : [])))
  const styles = createListStyles()
  const records = PRINT_FORM_DATASET.records
  const rowCount = LIST_BAND_ROWS + records.length

  const cellValue = (col: number, row: number): unknown => {
    if (row === 0) {
      return band.topText.get(col) ?? null
    }
    if (row === 1) {
      return band.subText.get(col) ?? null
    }
    const record = records[row - LIST_BAND_ROWS]
    return record ? record[columns[col]!.field] : null
  }
  const displayValue = (col: number, row: number): unknown => {
    if (row < LIST_BAND_ROWS) {
      return cellValue(col, row)
    }
    return formatFieldValue(columns[col]!.format, cellValue(col, row))
  }
  const cellStyle = (col: number, row: number): CellStyle | undefined => {
    if (row === 0) {
      return band.topText.has(col) ? styles.band : undefined
    }
    if (row === 1) {
      return band.subText.has(col) ? styles.band : undefined
    }
    return numericCols.has(col) ? styles.numericCell : styles.cell
  }

  return {
    name: config.title,
    rowCount,
    colCount: columns.length,
    rowHeight: () => BASE_ROW_HEIGHT,
    colWidth: (col) => columns[col]?.width ?? 90,
    merges: () => band.merges,
    cellValue,
    cellStyle,
    displayValue,
  }
}

// ---- 中国式单据适配器（每单据块：标题/信息区/表头/明细/合计/签字） ----

/** 单据行种类（每单据块自上而下的段结构） */
type DocRowKind = 'title' | 'info' | 'header' | 'detail' | 'total' | 'sign'

/** 单据块：相邻同单据号记录切成的连续段（同一单据的行连续为数据集不变量） */
interface DocBlock {
  docNo: string
  /** 块内明细的 records 下标区间 [start, end) */
  records: { start: number; end: number }
  rows: { title: number; info: number; header: number; total: number; sign: number }
}

/** 单据形态行平面（row → 行种类 / 所属块 / 明细 record 下标） */
interface DocGeometry {
  blocks: DocBlock[]
  rowKind: DocRowKind[]
  rowBlock: number[]
  detailRecord: number[]
}

/** 单据形态行高（px；种类差异化，屏上与打印同口径） */
const DOC_ROW_HEIGHTS: Record<DocRowKind, number> = {
  title: 44,
  info: 32,
  header: 32,
  detail: BASE_ROW_HEIGHT,
  total: 34,
  sign: 48,
}

/** 单据数据集平面展开：按相邻单据号切段，每块依次排 标题/信息/表头/明细/合计/签字 */
function buildDocGeometry(records: readonly DataRecord[], groupField: string): DocGeometry {
  const blocks: DocBlock[] = []
  for (let i = 0; i < records.length; i++) {
    const docNo = String(records[i]![groupField] ?? '')
    const last = blocks[blocks.length - 1]
    if (last && last.docNo === docNo) {
      last.records.end = i + 1
    } else {
      blocks.push({
        docNo,
        records: { start: i, end: i + 1 },
        rows: { title: -1, info: -1, header: -1, total: -1, sign: -1 },
      })
    }
  }
  const rowKind: DocRowKind[] = []
  const rowBlock: number[] = []
  const detailRecord: number[] = []
  const emit = (kind: DocRowKind, block: number, record = -1): void => {
    rowKind.push(kind)
    rowBlock.push(block)
    detailRecord.push(record)
  }
  blocks.forEach((block, index) => {
    block.rows.title = rowKind.length
    emit('title', index)
    block.rows.info = rowKind.length
    emit('info', index)
    block.rows.header = rowKind.length
    emit('header', index)
    for (let r = block.records.start; r < block.records.end; r++) {
      emit('detail', index, r)
    }
    block.rows.total = rowKind.length
    emit('total', index)
    block.rows.sign = rowKind.length
    emit('sign', index)
  })
  return { blocks, rowKind, rowBlock, detailRecord }
}

/** 信息区列分段：n 个字段均分全部列（段宽 > 1 即合并为标签值格） */
function buildInfoSegments(
  colCount: number,
  count: number,
): Array<{ startCol: number; endCol: number }> {
  return Array.from({ length: count }, (_, i) => ({
    startCol: Math.floor((colCount * i) / count),
    endCol: Math.floor((colCount * (i + 1)) / count) - 1,
  }))
}

/** 签字栏格布局：每字段一对格（标签格 + 签名/手写格）；列数有余时尾字段签名格吞并剩余列 */
interface SignCell {
  label: string
  field?: string
  labelCol: number
  valueStartCol: number
  valueEndCol: number
}

function buildSignCells(colCount: number, signFields: readonly PrintFormSignField[]): SignCell[] {
  return signFields.map((field, i) => ({
    label: field.label,
    field: field.field,
    labelCol: i * 2,
    valueStartCol: i * 2 + 1,
    valueEndCol: i === signFields.length - 1 ? colCount - 1 : i * 2 + 1,
  }))
}

/** 单据形态布局平面（供数与格绑定反查共用）：行几何 + 信息区分段 + 签字栏格 + 合计列下标 + 合并区 */
interface DocLayout {
  geometry: DocGeometry
  infoSegments: Array<{ startCol: number; endCol: number }>
  signCells: SignCell[]
  /** 合计金额列下标（summaryField 未命中任何列为 -1） */
  summaryIndex: number
  merges: CellRange[]
}

function buildDocLayout(config: PrintFormConfig): DocLayout {
  const colCount = config.columns.length
  const geometry = buildDocGeometry(PRINT_FORM_DATASET.records, config.groupField ?? 'docNo')
  const infoSegments = buildInfoSegments(colCount, (config.infoFields ?? []).length)
  const signCells = buildSignCells(colCount, config.signFields ?? [])
  const summaryIndex = config.columns.findIndex((column) => column.field === config.summaryField)
  // 合并区：标题跨全列 + 信息区标签值分段 + 合计行标签跨列 + 签字栏尾格吞并列
  const merges: CellRange[] = []
  for (const block of geometry.blocks) {
    merges.push({
      startCol: 0,
      endCol: colCount - 1,
      startRow: block.rows.title,
      endRow: block.rows.title,
    })
    for (const segment of infoSegments) {
      if (segment.endCol > segment.startCol) {
        merges.push({
          startCol: segment.startCol,
          endCol: segment.endCol,
          startRow: block.rows.info,
          endRow: block.rows.info,
        })
      }
    }
    if (summaryIndex > 0) {
      merges.push({
        startCol: 0,
        endCol: summaryIndex - 1,
        startRow: block.rows.total,
        endRow: block.rows.total,
      })
    }
    for (const cell of signCells) {
      if (cell.valueEndCol > cell.valueStartCol) {
        merges.push({
          startCol: cell.valueStartCol,
          endCol: cell.valueEndCol,
          startRow: block.rows.sign,
          endRow: block.rows.sign,
        })
      }
    }
  }
  return { geometry, infoSegments, signCells, summaryIndex, merges }
}

function createDocumentSource(config: PrintFormConfig): PrintSource {
  const columns = config.columns
  const colCount = columns.length
  const records = PRINT_FORM_DATASET.records
  const infoFields = config.infoFields ?? []
  const { geometry, infoSegments, signCells, summaryIndex, merges } = buildDocLayout(config)
  const numericCols = new Set(columns.flatMap((column, col) => (column.format ? [col] : [])))

  const blockAt = (row: number): DocBlock => geometry.blocks[geometry.rowBlock[row]!]!
  const kindAt = (row: number): DocRowKind => geometry.rowKind[row]!
  /** 块首记录（单据级字段：单据号/日期/客户/签名图的取数源） */
  const firstRecord = (block: DocBlock): DataRecord => records[block.records.start]!
  /** 块合计金额（summaryField 数值求和，原始值口径） */
  const blockTotal = (block: DocBlock): number => {
    let sum = 0
    for (let i = block.records.start; i < block.records.end; i++) {
      sum += Number(records[i]![config.summaryField ?? ''] ?? 0)
    }
    return sum
  }

  // 单据样式集：全格四边完整边框 + 分种类变体（表头底纹/标题大字/合计加粗/数值右对齐）
  const border = fullBorder(DOC_BORDER_COLOR)
  const styles = {
    title: { border, fontWeight: 700, fontSize: 16, textAlign: 'center' } as CellStyle,
    header: {
      border,
      fontWeight: 700,
      textAlign: 'center',
      background: HEADER_BAND_BG,
    } as CellStyle,
    cell: { border } as CellStyle,
    numericCell: { border, textAlign: 'right' } as CellStyle,
    totalLabel: { border, fontWeight: 700, textAlign: 'center' } as CellStyle,
    totalAmount: { border, fontWeight: 700, textAlign: 'right' } as CellStyle,
  }

  const cellValue = (col: number, row: number): unknown => {
    if (row < 0 || row >= geometry.rowKind.length) {
      return null
    }
    const block = blockAt(row)
    if (col === 0) {
      // 分组换页原始通道：col 0 恒为所在块单据号（displayValue 照常渲染该列显示内容）
      return block.docNo
    }
    switch (kindAt(row)) {
      case 'title':
        return null
      case 'info': {
        const index = infoSegments.findIndex((segment) => segment.startCol === col)
        const field = index >= 0 ? infoFields[index] : undefined
        return field ? firstRecord(block)[field.field] : null
      }
      case 'header':
        return columns[col]?.title ?? null
      case 'detail':
        return records[geometry.detailRecord[row]!]![columns[col]!.field]
      case 'total':
        return col === summaryIndex ? blockTotal(block) : null
      case 'sign': {
        const cell = signCells.find((item) => item.labelCol === col)
        return cell ? cell.label : null
      }
    }
  }
  const displayValue = (col: number, row: number): unknown => {
    const block = blockAt(row)
    switch (kindAt(row)) {
      case 'title':
        return col === 0 ? config.title : null
      case 'info': {
        const index = infoSegments.findIndex((segment) => segment.startCol === col)
        const field = index >= 0 ? infoFields[index] : undefined
        return field
          ? `${field.label}${formatFieldValue(field.format, firstRecord(block)[field.field])}`
          : null
      }
      case 'header':
        return columns[col]?.title ?? null
      case 'detail': {
        // col 0 的 cellValue 是分组单据号通道：明细显示直取记录字段，不经 cellValue
        const record = records[geometry.detailRecord[row]!]!
        return formatFieldValue(columns[col]!.format, record[columns[col]!.field])
      }
      case 'total': {
        if (col === 0) {
          return '合计'
        }
        if (col === summaryIndex) {
          return formatAmount(blockTotal(block))
        }
        return null
      }
      case 'sign': {
        const cell = signCells.find((item) => item.labelCol === col)
        return cell ? cell.label : ''
      }
    }
  }
  const cellStyle = (col: number, row: number): CellStyle => {
    switch (kindAt(row)) {
      case 'title':
        return styles.title
      case 'header':
        return styles.header
      case 'info':
        return styles.cell
      case 'total':
        return col === summaryIndex ? styles.totalAmount : styles.totalLabel
      case 'sign':
        return styles.cell
      case 'detail':
        return numericCols.has(col) ? styles.numericCell : styles.cell
    }
  }
  const cellImage = (col: number, row: number): string | null => {
    if (kindAt(row) !== 'sign') {
      return null
    }
    const cell = signCells.find((item) => item.valueStartCol === col && item.field)
    if (!cell) {
      return null
    }
    const url = firstRecord(blockAt(row))[cell.field!]
    return typeof url === 'string' ? url : null
  }

  return {
    name: config.title,
    rowCount: geometry.rowKind.length,
    colCount,
    rowHeight: (row) => DOC_ROW_HEIGHTS[kindAt(row)] ?? BASE_ROW_HEIGHT,
    colWidth: (col) => columns[col]?.width ?? 90,
    merges: () => merges,
    cellValue,
    cellStyle,
    displayValue,
    cellImage,
  }
}

/** 配置 → PrintSource 适配器（屏上渲染与打印供数同源） */
export function createPrintFormSource(config: PrintFormConfig): PrintSource {
  return config.kind === 'list' ? createListSource(config) : createDocumentSource(config)
}

/** 页脚本页合计占位符（列下标动态重写目标：{pageSum} 与既有 {pageSum:N} 一律按当前列结构重写） */
const PAGE_SUM_TOKEN_RE = /\{pageSum(?::[^}]*)?\}/

/**
 * 列表样页脚 {pageSum} 段动态重写：占位符重写为当前 amount 格式化列（首个）下标，
 * 无 amount 格式化列时移除含该占位符的整段（列增删后页脚页合计不撒谎）。
 * 页脚未出现占位符时原样返回 layout。
 */
function rewriteListFooterPageSum(
  layout: PrintConfig,
  columns: readonly PrintFormColumn[],
): PrintConfig {
  const footer = layout.headerFooter?.footer
  if (
    !footer ||
    ![footer.left, footer.center, footer.right].some(
      (text) => text !== undefined && PAGE_SUM_TOKEN_RE.test(text),
    )
  ) {
    return layout
  }
  const amountCol = columns.findIndex((column) => column.format === 'amount')
  const rewrite = (text: string | undefined): string | undefined => {
    if (text === undefined || !PAGE_SUM_TOKEN_RE.test(text)) {
      return text
    }
    return amountCol >= 0 ? text.replace(PAGE_SUM_TOKEN_RE, `{pageSum:${amountCol}}`) : undefined
  }
  return {
    ...layout,
    headerFooter: {
      ...layout.headerFooter,
      footer: {
        left: rewrite(footer.left),
        center: rewrite(footer.center),
        right: rewrite(footer.right),
      },
    },
  }
}

/**
 * 配置版面 → 打印配置：document 形态补 groupBreakBy（col 0 单据号原始值通道，每单一页）；
 * list 形态页脚 {pageSum} 占位符按当前列结构动态重写。屏上供数、打印与预览统一经此
 * 解析（三口径同源）。
 */
export function resolveFormPrintConfig(config: PrintFormConfig): PrintConfig {
  if (config.kind === 'document') {
    return config.layout.groupBreakBy === undefined
      ? { ...config.layout, groupBreakBy: 0 }
      : config.layout
  }
  return rewriteListFooterPageSum(config.layout, config.columns)
}

// ---- 单一模拟 SQL 数据集（出库单语义扁平行记录，schema 固定含类型标注；确定性生成，无随机） ----

/** 数据集字段类型标注（字段绑定下拉分组与「无」档之外的可选格式建议；image 走 cellImage 通道） */
export type PrintFormSchemaType = 'text' | 'date' | 'number' | 'image'

/** 数据集字段条目：字段名 + 展示标签 + 类型标注 */
export interface PrintFormSchemaField {
  field: string
  label: string
  type: PrintFormSchemaType
}

/** 模拟 SQL 数据集：schema（字段标注）+ 扁平行记录（两形态预设与全部面板绑定共用） */
export interface PrintFormDataset {
  schema: readonly PrintFormSchemaField[]
  records: readonly DataRecord[]
}

/** ISO 日期（基准 2026-10-01 起按天推移；UTC 运算跨环境确定） */
function isoDate(dayOffset: number): string {
  return new Date(Date.UTC(2026, 9, 1 + dayOffset)).toISOString().slice(0, 10)
}

/** 手写签名图（内联 SVG dataURL，确定性生成：签字人名草书风格文本） */
function signatureDataUrl(name: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="36">' +
    `<text x="8" y="27" font-family="cursive, 'PingFang SC', serif" font-size="22" ` +
    `font-style="italic" fill="#1d4ed8">${name}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** 单据级客户（按单据轮转；同一单据的物料行连续） */
const DOC_CUSTOMERS = [
  '华东精密仪器有限公司',
  '苏州绿能材料科技有限公司',
  '广州新港物流装备制造',
  '上海宏远贸易',
  '杭州云启科技',
  '北京华辰实业',
] as const

/** 单据级制单人（签名图随单据轮转） */
const DOC_MAKERS = ['王立群', '沈一舟', '陈曦', '赵蕙敏', '韩磊', '秦少楠'] as const

/** 物料池条目：[物料名称, 规格型号, 单位, 基准单价]（确定性轮转取数） */
type MaterialItem = readonly [string, string, string, number]

const MATERIAL_POOL: readonly MaterialItem[] = [
  ['铝合金支架', 'AL-6061-T6', '件', 86.5],
  ['不锈钢螺柱', 'M8×60', '盒', 42],
  ['工业传感器', 'SN-4000', '支', 320],
  ['密封圈套装', 'NBR-40', '套', 18.5],
  ['碳纤维板材', 'CF-2.0mm', '张', 265],
  ['锂电池模组', 'Li-48V-20Ah', '组', 480],
  ['高压线束', 'HV-25mm²', '条', 58],
  ['伺服减速电机', 'SE-750W', '台', 890],
  ['重型输送辊筒', 'RO-89mm', '支', 128],
  ['光电开关', 'PE-1000mm', '只', 96],
]

/** 单据数与每单物料行数：6 张 × 8 行 = 48 行（列表样 A4 纵向 fitpage ≥2 页；每单一页 ≥5 页） */
const DOC_COUNT = 6
const DOC_ITEM_COUNT = 8

/**
 * 单一模拟 SQL 数据集：出库单明细整表。行数与单据数驱动两形态演示约束（列表样分页/
 * 重复表头/每页合计、单据形态每单一页）；字段绑定下拉选项即 schema。确定性生成（物料
 * 池轮转 + 公式化数量），无随机——冒烟期望值可手算锚定。
 */
export const PRINT_FORM_DATASET: PrintFormDataset = {
  schema: [
    { field: 'docNo', label: '单据号', type: 'text' },
    { field: 'date', label: '出库日期', type: 'date' },
    { field: 'customer', label: '客户', type: 'text' },
    { field: 'material', label: '物料名称', type: 'text' },
    { field: 'spec', label: '规格型号', type: 'text' },
    { field: 'unit', label: '单位', type: 'text' },
    { field: 'qty', label: '数量', type: 'number' },
    { field: 'price', label: '单价', type: 'number' },
    { field: 'amount', label: '金额', type: 'number' },
    { field: 'makerSign', label: '制单人签名', type: 'image' },
  ],
  records: Array.from({ length: DOC_COUNT * DOC_ITEM_COUNT }, (_, i) => {
    const doc = Math.floor(i / DOC_ITEM_COUNT)
    const line = i % DOC_ITEM_COUNT
    const date = isoDate(32 + doc) // 2026-11-02 起逐单推移
    const [material, spec, unit, price] = MATERIAL_POOL[(doc * 3 + line) % MATERIAL_POOL.length]!
    const qty = 12 + ((doc * 5 + line * 3) % 15)
    return {
      docNo: `PF-${date.slice(0, 4)}-${date.slice(5).replace('-', '')}-${String(doc + 1).padStart(2, '0')}`,
      date,
      customer: DOC_CUSTOMERS[doc % DOC_CUSTOMERS.length]!,
      material,
      spec,
      unit,
      qty,
      price,
      amount: Math.round(qty * price * 100) / 100,
      makerSign: signatureDataUrl(DOC_MAKERS[doc % DOC_MAKERS.length]!),
    }
  }),
}

// ---- 内置打印单配置（列表样 + 中国式表格单据各一） ----

export const PRINT_FORM_LIST_ID = 'order-list'
export const PRINT_FORM_DOC_ID = 'delivery-doc'

/** 列表样：两行表头带（「出库金额」组格横跨）+ 数据集全量明细，A4 纵向 fitpage 每页重复表头；
 *  页脚 {pageSum} 为符号占位符，resolveFormPrintConfig 按当前 amount 格式化列动态重写 */
const ORDER_LIST_FORM: PrintFormConfig = {
  id: PRINT_FORM_LIST_ID,
  title: '2026 Q4 出库明细表',
  kind: 'list',
  layout: {
    paperSize: 'A4',
    orientation: 'portrait',
    headerRepeatRows: LIST_BAND_ROWS,
    headerFooter: {
      footer: {
        left: '打印时间：{date} {time}',
        center: '第 {page} 页 / 共 {pageCount} 页',
        right: '本页金额合计：{pageSum}',
      },
    },
  },
  columns: [
    // 列宽合计 ≤ A4 纵向可用页宽（≈698px）：整表落单列带，分页只纵向切页
    { field: 'docNo', title: '单据号', width: 96 },
    { field: 'date', title: '出库日期', width: 108, format: 'date-cn' },
    { field: 'customer', title: '客户', width: 110 },
    { field: 'material', title: '物料名称', width: 84 },
    { field: 'spec', title: '规格型号', width: 72 },
    { field: 'unit', title: '单位', width: 36 },
    { field: 'qty', title: '数量', width: 40 },
    { field: 'price', title: '单价（元）', width: 68, group: '出库金额（元）' },
    { field: 'amount', title: '金额（元）', width: 80, format: 'amount', group: '出库金额（元）' },
  ],
}

/** 中国式表格单据：标题跨全列 + 信息区标签值合并 + 完整边框 + 合计/签字行，docNo 分组每单一页 */
const DELIVERY_DOC_FORM: PrintFormConfig = {
  id: PRINT_FORM_DOC_ID,
  title: '产品出库单',
  kind: 'document',
  groupField: 'docNo',
  layout: { paperSize: 'A4', orientation: 'portrait' },
  columns: [
    { field: 'material', title: '物料名称', width: 150 },
    { field: 'spec', title: '规格型号', width: 110 },
    { field: 'unit', title: '单位', width: 50 },
    { field: 'qty', title: '数量', width: 64 },
    { field: 'price', title: '单价（元）', width: 90, format: 'amount' },
    { field: 'amount', title: '金额（元）', width: 96, format: 'amount' },
  ],
  infoFields: [
    { label: '单据号：', field: 'docNo' },
    { label: '日期：', field: 'date', format: 'date-cn' },
    { label: '客户：', field: 'customer' },
  ],
  summaryField: 'amount',
  signFields: [
    { label: '制单人：', field: 'makerSign' },
    { label: '审核人：' },
    { label: '收货人：' },
  ],
}

/** 内置打印单配置清单（页面配置切换的单一事实源） */
export const PRINT_FORM_CONFIGS: readonly PrintFormConfig[] = [ORDER_LIST_FORM, DELIVERY_DOC_FORM]

// ---- 格 → 配置节点反查（格级面板点选映射；合并格任一位置 → 合并区锚点格） ----

/** 格 → 配置节点绑定（判别联合）：属性面板按 kind 定位配置节点并呈现对应编辑器 */
export type PrintCellBinding =
  /** 明细列声明（列表样表头带格/数据格、单据明细表头格/明细数据格；组标题格锚定组首列） */
  | { kind: 'column'; index: number }
  /** 单据标题合并格（静态文本 config.title） */
  | { kind: 'title' }
  /** 单据信息区字段（一段的标签格与值格同绑一个节点） */
  | { kind: 'info'; index: number }
  /** 单据合计行（金额格与「合计」标签格；金额字段为 summaryField） */
  | { kind: 'summary' }
  /** 签字栏字段（一对标签格/签名值格同绑一个节点） */
  | { kind: 'sign'; index: number }
  /** 结构补位格（不可编辑，由相邻配置决定） */
  | { kind: 'none' }

const NONE_BINDING: PrintCellBinding = { kind: 'none' }

/** (col,row) 落入合并区时重定向到该区锚点格（左上角），否则原坐标（复用 merges 几何） */
function anchorCell(merges: readonly CellRange[], col: number, row: number): CellRef {
  for (const range of merges) {
    if (
      col >= range.startCol &&
      col <= range.endCol &&
      row >= range.startRow &&
      row <= range.endRow
    ) {
      return { col: range.startCol, row: range.startRow }
    }
  }
  return { col, row }
}

function resolveListCellBinding(
  config: PrintFormConfig,
  col: number,
  row: number,
): PrintCellBinding {
  const columns = config.columns
  const band = buildListBand(columns)
  const cell = anchorCell(band.merges, col, row)
  if (cell.col < 0 || cell.col >= columns.length) {
    return NONE_BINDING
  }
  if (cell.row === 1) {
    // 组内列标题格（组格下层）；无组列标题格经纵合并已重定向到 row 0
    return band.subText.has(cell.col) ? { kind: 'column', index: cell.col } : NONE_BINDING
  }
  // row 0：无组列标题格（纵合并锚点）或组标题格（横跨锚点 = 组首列）；数据行同为列绑定
  return cell.row >= 0 && cell.row < LIST_BAND_ROWS + PRINT_FORM_DATASET.records.length
    ? { kind: 'column', index: cell.col }
    : NONE_BINDING
}

function resolveDocumentCellBinding(
  config: PrintFormConfig,
  col: number,
  row: number,
): PrintCellBinding {
  const layout = buildDocLayout(config)
  const cell = anchorCell(layout.merges, col, row)
  const kind = layout.geometry.rowKind[cell.row]
  if (kind === undefined || cell.col < 0 || cell.col >= config.columns.length) {
    return NONE_BINDING
  }
  switch (kind) {
    case 'title':
      return { kind: 'title' }
    case 'info': {
      const index = layout.infoSegments.findIndex(
        (segment) => cell.col >= segment.startCol && cell.col <= segment.endCol,
      )
      return index >= 0 ? { kind: 'info', index } : NONE_BINDING
    }
    case 'header':
    case 'detail':
      return { kind: 'column', index: cell.col }
    case 'total':
      // 「合计」标签格（含被合并吞并位置，锚点 col 0）与金额格同绑 summary 节点
      return cell.col === 0 || cell.col === layout.summaryIndex ? { kind: 'summary' } : NONE_BINDING
    case 'sign': {
      const index = layout.signCells.findIndex(
        (item) =>
          cell.col === item.labelCol ||
          (cell.col >= item.valueStartCol && cell.col <= item.valueEndCol),
      )
      return index >= 0 ? { kind: 'sign', index } : NONE_BINDING
    }
  }
}

/**
 * 格 → 配置节点反查（纯函数，点选映射的单一事实源）：list 表头带格（组标题格/列标题格）
 * 与数据格 → column；document 标题/信息区/表头/明细/合计/签字各段 → 对应节点；结构补位
 * 格与越界格 → none。合并格任一位置解析到该合并区锚点格的绑定。
 */
export function resolveCellBinding(
  config: PrintFormConfig,
  col: number,
  row: number,
): PrintCellBinding {
  return config.kind === 'list'
    ? resolveListCellBinding(config, col, row)
    : resolveDocumentCellBinding(config, col, row)
}

/**
 * 绑定节点 → 当前配置渲染下的锚点格（选中重映射用；节点在新配置中不存在返回 null）。
 * list 形态只承载 column 节点（title/info/summary/sign 为单据形态专属）；document 形态
 * 按首块各段行定位。
 */
function findBindingCell(config: PrintFormConfig, binding: PrintCellBinding): CellRef | null {
  if (config.kind === 'list') {
    if (binding.kind !== 'column' || binding.index >= config.columns.length) {
      return null
    }
    // 组内列标题格在表头带下层，无组列标题格为纵合并格（锚点在带顶行）
    const grouped = buildListBand(config.columns).subText.has(binding.index)
    return { col: binding.index, row: grouped ? 1 : 0 }
  }
  const layout = buildDocLayout(config)
  const first = layout.geometry.blocks[0]
  if (!first) {
    return null
  }
  switch (binding.kind) {
    case 'column':
      return binding.index < config.columns.length
        ? { col: binding.index, row: first.rows.header }
        : null
    case 'title':
      return { col: 0, row: first.rows.title }
    case 'info': {
      const segment = layout.infoSegments[binding.index]
      return segment ? { col: segment.startCol, row: first.rows.info } : null
    }
    case 'summary':
      return { col: layout.summaryIndex >= 0 ? layout.summaryIndex : 0, row: first.rows.total }
    case 'sign': {
      const cell = layout.signCells[binding.index]
      return cell && cell.labelCol < config.columns.length
        ? { col: cell.labelCol, row: first.rows.sign }
        : null
    }
    case 'none':
      return null
  }
}

// ---- 演示区装配 ----

/** 一次配置渲染的落地产物（切换配置时整体重建） */
interface FormRender {
  config: PrintFormConfig
  source: PrintSource
  plugin: PrintPluginHandle
  mount: DemoMount
}

/** 打印单演示句柄：配置应用/切换 / 格点选 / 打印供数 / 打印计数（页面与冒烟共用） */
export interface PrintFormDemo {
  /** 可切换的打印单配置清单 */
  readonly configs: readonly PrintFormConfig[]
  /** 演示区挂载容器（屏上表格随配置切换在容器内重建） */
  getContainer(): HTMLElement
  /** 当前配置 */
  getConfig(): PrintFormConfig
  /** 当前屏上表格（只读渲染；切换配置后引用随之更新） */
  getTable(): ListTable
  /** 打印插件句柄（供数随配置切换重建；paginate/buildDocumentHtml/print 缺省吃当前配置） */
  getPlugin(): PrintPluginHandle
  /** 应用配置：销毁当前屏上渲染并按给定配置对象整体重建（供数与打印配置一并切换；面板每次改动走这里） */
  applyConfig(config: PrintFormConfig): void
  /** 切换内置预设：按预设重置（同一重建路径；保留为预设初始态入口） */
  switchConfig(id: string): void
  /** 订阅格点选（内建选区 sky 层高亮即点选反馈；载荷为选中格坐标，清空为 null）；返回退订函数 */
  onCellSelect(listener: (cell: CellRef | null) => void): () => void
  /** 程序化点选：内建选区高亮并滚动到格（与点选同链，触发 onCellSelect） */
  selectCell(col: number, row: number): void
  /** 当前选中格坐标（无选中为 null） */
  getSelectedCell(): CellRef | null
  /** 打印入口：记录最近配置并走插件 print（缺省真实浏览器打印；可经 setPrintHook 注入桩） */
  print(config?: PrintConfig): Promise<void>
  /** 浏览器打印调起次数（打印链路真实完成 iframe 装载并调起打印即 +1） */
  getPrintCount(): number
  /** 最近一次打印的完整配置（null = 尚未打印） */
  getLastPrintConfig(): PrintConfig | null
  /** 注入/清除 hooks.print 桩（冒烟判定装载 iframe 文档用；清空后恢复真实浏览器打印） */
  setPrintHook(hook?: (iframe: HTMLIFrameElement) => void | Promise<void>): void
}

export function mountPrintForm(root: HTMLElement): PrintFormDemo {
  const section = document.createElement('section')
  root.appendChild(section)
  const holder = document.createElement('div')
  section.appendChild(holder)

  // hooks 对象跨配置切换复用（print 桩注入后切换配置仍生效；未注入走真实浏览器打印）
  const printHooks: { print?: (iframe: HTMLIFrameElement) => void | Promise<void> } = {}
  let printCount = 0
  let lastPrintConfig: PrintConfig | null = null

  // 选中模型：以配置节点为锚记录（内建选区变化即点选反馈；重建后按节点重映射，节点已删清空）
  let selectedCell: CellRef | null = null
  let selectedBinding: PrintCellBinding | null = null
  const cellSelectListeners = new Set<(cell: CellRef | null) => void>()
  const notifyCellSelect = (): void => {
    for (const listener of cellSelectListeners) {
      listener(selectedCell ? { ...selectedCell } : null)
    }
  }

  const render = (config: PrintFormConfig): FormRender => {
    const source = createPrintFormSource(config)
    const plugin = createPrintPlugin({
      source,
      config: resolveFormPrintConfig(config),
      hooks: printHooks,
    })
    const contentWidth = config.columns.reduce((sum, column) => sum + column.width, 0)
    const mount = mountTable(holder, {
      width: contentWidth + 24,
      height: 360,
      columns: config.columns.map((column) => ({ title: column.title, width: column.width })),
      rowCount: source.rowCount,
      rowHeight: BASE_ROW_HEIGHT,
      resolveDisplayValue: (col, row) => String(source.displayValue(col, row) ?? ''),
      resolveCellStyle: (col, row) => source.cellStyle(col, row) ?? null,
      resolveCellImage: (col, row) => source.cellImage?.(col, row) ?? null,
      showColHeader: false,
      showRowHeader: false,
      plugins: [plugin],
      resolveEditable: () => false,
      canResizeCol: () => false,
      canResizeRow: () => false,
    })
    mount.table.setMergeCells(source.merges().map((range) => ({ ...range })))
    if (config.kind === 'list') {
      // 列表样冻结表头带（滚动浏览明细时表头常驻）
      mount.table.setFrozenRowCount(LIST_BAND_ROWS)
    } else {
      // 单据形态行高按种类差异化（标题/信息/合计/签字行更高）：逐行落地非基准行高
      for (let row = 0; row < source.rowCount; row++) {
        const height = source.rowHeight(row)
        if (height !== BASE_ROW_HEIGHT) {
          mount.table.setRowHeight(row, height)
        }
      }
    }
    // 点选反馈接线：内建选区变化 → 记录选中格与所属配置节点（合并格经绑定反查归到锚点节点）。
    // 装配期即订阅：rebuild 后的程序化重映射点选同样经此链更新选中并通知
    mount.table.onSelectionChange((snapshot) => {
      const focus = snapshot.focus ?? snapshot.ranges[0]?.start ?? null
      selectedCell = focus ? { col: focus.col, row: focus.row } : null
      selectedBinding = selectedCell
        ? resolveCellBinding(config, selectedCell.col, selectedCell.row)
        : null
      notifyCellSelect()
    })
    return { config, source, plugin, mount }
  }

  /** 整体重建：销毁当前渲染按新配置重建（供数与打印配置一并切换），选中按节点重映射 */
  const rebuild = (next: PrintFormConfig): void => {
    current.mount.table.destroy()
    current.mount.container.remove()
    current = render(next)
    const anchor =
      selectedBinding !== null && selectedBinding.kind !== 'none'
        ? findBindingCell(next, selectedBinding)
        : null
    if (anchor) {
      current.mount.table.selectCell(anchor.col, anchor.row)
    } else {
      selectedCell = null
      selectedBinding = null
      notifyCellSelect()
    }
  }

  let current = render(PRINT_FORM_CONFIGS[0]!)

  return {
    configs: PRINT_FORM_CONFIGS,
    getContainer: () => current.mount.container,
    getConfig: () => current.config,
    getTable: () => current.mount.table,
    getPlugin: () => current.plugin,
    applyConfig(config) {
      if (config === current.config) {
        return
      }
      rebuild(config)
    },
    switchConfig(id) {
      const next = PRINT_FORM_CONFIGS.find((config) => config.id === id)
      if (!next || next === current.config) {
        return
      }
      rebuild(next)
    },
    onCellSelect(listener) {
      cellSelectListeners.add(listener)
      return () => cellSelectListeners.delete(listener)
    },
    selectCell(col, row) {
      current.mount.table.selectCell(col, row)
    },
    getSelectedCell() {
      return selectedCell ? { ...selectedCell } : null
    },
    async print(config) {
      lastPrintConfig = config ?? resolveFormPrintConfig(current.config)
      await current.plugin.print(config)
      printCount++
    },
    getPrintCount: () => printCount,
    getLastPrintConfig: () => lastPrintConfig,
    setPrintHook(hook) {
      printHooks.print = hook
    },
  }
}
