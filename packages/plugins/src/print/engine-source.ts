// 引擎供数适配（P7）：装配协议的导出读取面（EngineReadView）→ PrintSource。
// 导出类插件（G12-G15）经协议读取引擎有效数据 / 样式 / 几何 / 合并区，而非只能拿
// 具体引擎类型——print 的供数链路由此面向协议：宿主打印引擎实例时不再自写适配器。
// 引擎未提供导出读取面（engine.read 缺失）时 fail-fast 抛错（透视 / 甘特等引擎
// 按自身几何语义决定是否提供，消费方探测后降级）。

import type { EngineAssembly } from '@infinitable/table'

import type { PrintSource } from './types'

/** 引擎供数选项 */
export interface EnginePrintSourceOptions {
  /** 表名（页面标题缺省源）；协议不内嵌 UI 文案（G20），名称由宿主给定，缺省空串 */
  name?: string
}

/**
 * 从引擎装配协议适配打印数据源：字段口径经引擎导出读取面逐项映射——
 * 行列数 / 行高列宽（几何）、merges（合并区几何区间）、cellValue（原始值）、
 * cellStyle（有效样式投影）、displayValue（取值管线的有效显示文本）。
 */
export function createEnginePrintSource(
  engine: EngineAssembly,
  options: EnginePrintSourceOptions = {},
): PrintSource {
  const read = engine.read
  if (!read) {
    throw new Error('引擎未提供导出读取面（engine.read），无法适配打印供数')
  }
  return {
    name: options.name ?? '',
    get rowCount(): number {
      return read.rowCount
    },
    get colCount(): number {
      return read.colCount
    },
    rowHeight: (row) => read.getRowHeight(row),
    colWidth: (col) => read.getColWidth(col),
    merges: () => read.getMergeRanges(),
    cellValue: (col, row) => read.getCellValue(col, row),
    cellStyle: (col, row) => read.getCellStyle(col, row),
    displayValue: (col, row) => read.getCellText(col, row),
  }
}
