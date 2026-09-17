// 主题系统：默认主题全套 token（颜色/字体/边框/行高）+ extends 深覆盖派生。
// 派生主题经 ListTableOptions.theme 接入样式管线；显式 options（rowHeight 等）仍优先于主题。

/** 单元格样式 token（body 数据格与 header 行列头各一份） */
export interface CellStyleTokens {
  font: string
  color: string
  background: string
  borderColor: string
}

/** 表格主题：几何尺寸 + 数据格/行列头样式 */
export interface TableTheme {
  rowHeight: number
  headerHeight: number
  rowHeaderWidth: number
  defaultColWidth: number
  body: CellStyleTokens
  header: CellStyleTokens
}

/** extends 入参：token 全可选，嵌套对象按键深覆盖 */
export interface ThemeOverride {
  rowHeight?: number
  headerHeight?: number
  rowHeaderWidth?: number
  defaultColWidth?: number
  body?: Partial<CellStyleTokens>
  header?: Partial<CellStyleTokens>
}

/** 默认主题：开箱可用 */
export const defaultTheme: TableTheme = {
  rowHeight: 32,
  headerHeight: 36,
  rowHeaderWidth: 48,
  defaultColWidth: 100,
  body: {
    font: '12px sans-serif',
    color: '#1f2329',
    background: '#ffffff',
    borderColor: '#e5e6eb',
  },
  header: {
    font: '12px sans-serif',
    color: '#1f2329',
    background: '#f5f6f7',
    borderColor: '#e5e6eb',
  },
}

/** 基于 base（缺省默认主题）派生主题：覆盖键生效，未覆盖的 token 继承 base */
export function extendsTheme(
  override: ThemeOverride = {},
  base: TableTheme = defaultTheme,
): TableTheme {
  return {
    rowHeight: override.rowHeight ?? base.rowHeight,
    headerHeight: override.headerHeight ?? base.headerHeight,
    rowHeaderWidth: override.rowHeaderWidth ?? base.rowHeaderWidth,
    defaultColWidth: override.defaultColWidth ?? base.defaultColWidth,
    body: { ...base.body, ...override.body },
    header: { ...base.header, ...override.header },
  }
}
