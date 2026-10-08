// 打印演示区装配：print 插件（createPrintPlugin）handle 形态的浏览器可验证路径——
// headless 打印内核（分页/页面构建/占位符求值）+ iframe 打印输出。示例表超过一页
// （两行表头带合并单元格 + 48 行数据），PrintSource 由本区数据函数直接适配供数
// （「宿主/适配器供数」形态，屏上表格与打印共用同一数据源）。控件面（纸张/方向/
// 缩放/分页模式参数与预览弹层）由 PrintPage 以 shadcn 渲染，经 PrintDemo.plugin
// 消费 paginate/buildDocumentHtml/print。window.print 在示例内替换为计数桩
// （不弹系统对话框），打印经 demo.print（记录最近配置 + 插件 print → 注入钩子汇到
// window.print 桩）；window.__DEMO__.print 暴露 getPrintCount/getLastPrintConfig
// 供冒烟判定。

import type { CellStyle, ListTableOptions } from '@infinitable/core'
import {
  createPrintPlugin,
  type PrintConfig,
  type PrintPluginHandle,
  type PrintSource,
} from '@infinitable/plugins'

import { createSection, mountTable, type DemoMount } from '../mount'

// ---- 示例数据维度（确定性生成，无随机） ----

/** 表头带行数（两行表头 = 每页重复表头行数；页面 buildConfig 消费） */
export const PRINT_HEADER_ROWS = 2
/** 数据行数（A4 纵向约 32 行/页 → 2 页起，fixrows/横向更多页） */
const PRINT_DATA_ROWS = 48
/** 逐列宽度（合计 598 ≤ 屏上演示区 640；A4 纵向可用宽 698 装得下） */
const PRINT_COL_WIDTHS = [56, 84, 84, 104, 90, 90, 90] as const
/** 数值列（页脚「本页小计 {pageSum:4}」取销售额列） */
const SALES_COL = 4
/** 全表行高（px，屏上演示与打印同口径） */
const PRINT_ROW_HEIGHT = 30

const REGION_CITIES: ReadonlyArray<{ region: string; city: string }> = [
  { region: '华东', city: '上海' },
  { region: '华东', city: '杭州' },
  { region: '华北', city: '北京' },
  { region: '华北', city: '天津' },
  { region: '华南', city: '广州' },
  { region: '西南', city: '成都' },
]
const CATEGORIES = ['办公用品', '家居生活', '数码电器'] as const

/** 数据行取值（row 为源表行号，含表头带偏移） */
function dataRowValue(col: number, row: number): unknown {
  const seq = row - PRINT_HEADER_ROWS + 1
  const entry = REGION_CITIES[seq % REGION_CITIES.length]!
  if (col === 0) return seq
  if (col === 1) return entry.region
  if (col === 2) return entry.city
  if (col === 3) return CATEGORIES[seq % CATEGORIES.length]!
  const sales = 180 + ((row * 37) % 220) + (row % 3) * 60
  if (col === SALES_COL) return sales
  if (col === 5) return sales + 40 + (row % 7) * 5
  const qoq = ((row % 5) - 2) * 2.1
  return `${qoq > 0 ? '+' : ''}${qoq.toFixed(1)}%`
}

function headerBandStyle(): CellStyle {
  return {
    fontWeight: 700,
    textAlign: 'center',
    background: '#eef2f7',
    border: { bottom: { width: 2, color: '#64748b' } },
  }
}

/** 表头带两行的格值（上行整列字段 + 「指标」横跨；下行指标细分，纵合并客格空） */
const HEADER_TOP_CELLS: Array<[number, string]> = [
  [0, '序号'],
  [1, '区域'],
  [2, '城市'],
  [3, '品类'],
  [4, '指标（Q3）'],
]
const HEADER_SUB_CELLS: Array<[number, string]> = [
  [SALES_COL, '销售额'],
  [5, '目标'],
  [6, '环比'],
]

/** 全表行数（表头带 + 数据行） */
const ROW_COUNT = PRINT_HEADER_ROWS + PRINT_DATA_ROWS

/** 合并区：整列字段纵合并（表头带两行）+「指标」横跨三列 */
const MERGES = [
  ...[0, 1, 2, 3].map((col) => ({ startCol: col, endCol: col, startRow: 0, endRow: 1 })),
  { startCol: SALES_COL, endCol: 6, startRow: 0, endRow: 0 },
]

/** 格值（表头带文本 / 数据行取值；合并客格空） */
function cellValue(col: number, row: number): unknown {
  if (row === 0) {
    return HEADER_TOP_CELLS.find(([c]) => c === col)?.[1] ?? null
  }
  if (row === 1) {
    return HEADER_SUB_CELLS.find(([c]) => c === col)?.[1] ?? null
  }
  return dataRowValue(col, row)
}

/** 有效格样式（表头带底纹；数据行负环比红字） */
function cellStyle(col: number, row: number): CellStyle | undefined {
  if (row < PRINT_HEADER_ROWS) {
    const declared = (row === 0 ? HEADER_TOP_CELLS : HEADER_SUB_CELLS).some(([c]) => c === col)
    return declared ? headerBandStyle() : undefined
  }
  const qoq = dataRowValue(6, row) as string
  return qoq.startsWith('-') ? { color: '#dc2626' } : undefined
}

// ---- 演示区装配 ----

export interface PrintDemo {
  mount: DemoMount
  /** 打印插件句柄（页面预览/打印消费：paginate 分页、buildDocumentHtml 文档、print 输出） */
  plugin: PrintPluginHandle
  /** 打印入口：记录最近配置并走插件 print（注入钩子汇到 window.print 计数桩） */
  print(config: PrintConfig): Promise<void>
  /** window.print 桩计数（打印按钮真实触发 print 链路 ≥1 即通过） */
  getPrintCount(): number
  /** 最近一次打印的完整配置（null = 尚未打印） */
  getLastPrintConfig(): PrintConfig | null
}

export function mountPrint(root: HTMLElement): PrintDemo {
  const section = createSection(
    root,
    '打印预览与输出',
    'print 插件（handle 形态）：分页（fitpage 按页高 / fixrows 固定行数补空行）、每页重复两行' +
      '表头、页眉页脚占位符（{title}/{date}/{page}/{pageCount} 与页级聚合 {pageSum:4}）。示例表超过' +
      '一页，右侧配置参数后打开预览弹层（缩略列表 + 当前页放大）；window.print 已替换为计数桩，' +
      '点打印按钮后状态行与 window.__DEMO__.print 可读取调用计数与最近配置。',
  )

  // ---- 数据面：PrintSource 由本区数据函数适配（屏上表格与打印共用的单一事实源） ----
  const source: PrintSource = {
    name: '2026 Q3 销售明细（打印示例）',
    rowCount: ROW_COUNT,
    colCount: PRINT_COL_WIDTHS.length,
    rowHeight: () => PRINT_ROW_HEIGHT,
    colWidth: (col) => PRINT_COL_WIDTHS[col] ?? 90,
    merges: () => MERGES,
    cellValue,
    cellStyle,
    // 显示链回落原始值口径（与缺省 SheetStore 显示链一致）
    displayValue: cellValue,
  }

  // ---- 屏上演示表格（只读渲染：样式走同一 cellStyle 读取面） ----
  const readonlyOptions: Partial<ListTableOptions> = {
    resolveEditable: () => false,
    canResizeCol: () => false,
    canResizeRow: () => false,
  }
  const printPlugin = createPrintPlugin({
    source,
    hooks: {
      print: () => {
        window.print()
      },
    },
  })
  const mount = mountTable(section, {
    width: 640,
    height: 320,
    columns: PRINT_COL_WIDTHS.map((width, col) => ({ title: `C${col}`, width })),
    rowCount: ROW_COUNT,
    rowHeight: PRINT_ROW_HEIGHT,
    resolveDisplayValue: (col, row) => String(cellValue(col, row) ?? ''),
    resolveCellStyle: (col, row) => cellStyle(col, row) ?? null,
    showColHeader: false,
    showRowHeader: false,
    plugins: [printPlugin],
    ...readonlyOptions,
  })
  mount.table.setMergeCells(MERGES.map((merge) => ({ ...merge })))
  mount.table.setFrozenRowCount(PRINT_HEADER_ROWS)

  // ---- 打印桩：替换 window.print 计数真实调用（打印链路终态汇到此处） ----
  let printCount = 0
  let lastPrintConfig: PrintConfig | null = null
  window.print = () => {
    printCount++
  }

  return {
    mount,
    plugin: printPlugin,
    print(config) {
      lastPrintConfig = config
      return printPlugin.print(config)
    },
    getPrintCount: () => printCount,
    getLastPrintConfig: () => lastPrintConfig,
  }
}
