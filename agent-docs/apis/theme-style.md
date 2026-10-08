---
title: TableTheme 主题与 CellStyle 单元格样式
description: infinitable 主题系统：extendsTheme 深覆盖派生、TableTheme/ThemeOverride 分区 token（body/header/rowHeader/corner/interaction/frameStyle，interaction 含滚动条三态色/圆角/内缩/隐藏延时 token），以及 CellStyle 逐格样式、projectCellStyle 样式投影与逐边边框 CellBorder。覆盖链「主题分区 token → 列级样式 → 按格 hook」。
aliases: [Theme, 主题, 样式, Style, extendsTheme, defaultTheme]
keywords: [extendsTheme, ThemeOverride, TableTheme, projectCellStyle, CellStyle, CellBorder, scrollbarThumb, scrollbarThumbHover, scrollbarThumbActive, scrollbarRadius, scrollbarSize, scrollbarMargin, scrollbarMarginHover, scrollbarHideDelay, textAlign, textOverflow, textWrap, borderColor, underlayBackgroundColor, selectionFill, 主题, 边框, 样式投影, 滚动条]
---

# TableTheme 主题与 CellStyle 单元格样式

`infinitable`（core 层）导出主题系统（`extendsTheme` 深覆盖派生、`TableTheme`、`ThemeOverride`）与逐格样式（`CellStyle` 边框族、`projectCellStyle` 投影纯函数）；分区 token 结构（`body`/`header`/`rowHeader`/`corner`/`interaction`/`frameStyle`）内嵌于 `TableTheme` 类型，未单独导出。样式生效链固定为「主题分区 token → 列级样式（`ColumnDefine.style`）→ 按格 hook（`resolveCellStyle`）」，逐字段覆盖、边框逐边独立合并；构造时经 `ListTableOptions.theme` 接入，运行时经 `table.updateTheme()` 深覆盖。默认主题值经 `extendsTheme()` 派生结果或 `table.getTheme()` 读取（`defaultTheme` 常量 0.1.2 起不再导出）。

## 快速上手

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 760,
  height: 420,
  columns: [
    { field: 'name', title: '名称', width: 140 },
    { field: 'qty', title: '数量', width: 80 },
  ],
  records: [{ name: '商品-0', qty: 3 }],
  // 主题覆盖：只写要改的键，其余继承默认主题
  theme: {
    rowHeight: 28,
    header: { background: '#dbeafe', textAlign: 'center' },
    body: { fontSize: 14, padding: [2, 6, 2, 6] },
    interaction: { selectionBorder: '#2170E7' },
  },
  hostOptions: { container },
})
// => 列头蓝底居中、正文 14px、行高 28

// 运行时换主题：以当前生效主题为 base 继续深覆盖，场景重建并整层失效
table.updateTheme({ body: { color: '#d1d5db' } })
```

## API 签名

```ts
/** 单元格样式 token（body 数据格与行列头各一份；corner/rowHeader 缺省随 header 派生）。
 *  未单独导出，作为 TableTheme 分区结构出现 */
interface CellStyleTokens {
  font: string
  color: string
  background: string
  /** 网格线色：投影为每格右/下 1px 默认网格边（收入本格） */
  borderColor: string
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  fontWeight?: number | string
  fontStyle?: string
  fontSize?: number
  fontFamily?: string
  underline?: boolean
  lineThrough?: boolean
  /** 超宽文本处理；缺省数据格保持 Excel 式溢出，行列头由表侧兜底 ellipsis */
  textOverflow?: 'ellipsis' | 'clip'
  /** 格内边距 [上,右,下,左]（CSS 像素）；缺省 [0, 8, 0, 8] */
  padding?: [top: number, right: number, bottom: number, left: number]
  /** 逐边边框；缺省的边不绘制 */
  border?: CellBorder
}

/** 交互浮层样式 token（未单独导出）：选区/填充柄/resize 拖拽线/内建滚动条的唯一颜色与尺寸来源 */
interface InteractionTokens {
  selectionFill: string
  selectionBorder: string
  selectionBorderWidth: number
  fillHandle: string
  resizeLine: string
  resizeLineWidth: number
  headerHighlight: string
  freezeDividerColor: string
  freezeDividerWidth: number
  /** 内建滚动条滑块默认色（灰阶三档的基准） */
  scrollbarThumb: string
  /** 内建滚动条滑块 hover 色（指针悬停滑块即时切换） */
  scrollbarThumbHover: string
  /** 内建滚动条滑块拖拽激活色（拖拽会话期间） */
  scrollbarThumbActive: string
  /** 内建滚动条圆角半径（CSS 像素；绘制时钳到厚度一半成胶囊形） */
  scrollbarRadius: number
  /** 内建滚动条条带厚度（CSS 像素；两轴交汇的右下空白角同厚） */
  scrollbarSize: number
  /** 滑块与条带边缘的内缩边距（仅厚度方向内缩变细；行程换算不受影响） */
  scrollbarMargin: number
  /** hover/拖拽态的内缩边距（收窄即视觉变粗） */
  scrollbarMarginHover: number
  /** 'scrolling' 显隐档静止后隐藏延时（ms；options.scrollbar.hideDelay 显式给定时优先） */
  scrollbarHideDelay: number
}

/** 表格外框样式 token（未单独导出） */
interface FrameStyle {
  /** 外框线宽（CSS 像素）；0 不绘制 */
  lineWidth: number
  color: string
  shadow: boolean
}

export interface TableTheme {
  rowHeight: number
  headerHeight: number
  rowHeaderWidth: number
  defaultColWidth: number
  body: CellStyleTokens
  header: CellStyleTokens
  /** 缺省随生效 header 派生 */
  rowHeader: CellStyleTokens
  /** 缺省随生效 header 派生 */
  corner: CellStyleTokens
  /** 数据区底色：格背景之下铺设 */
  underlayBackgroundColor: string
  interaction: InteractionTokens
  frameStyle: FrameStyle
}

/** extends 入参：token 全可选，嵌套对象按键深覆盖 */
export interface ThemeOverride {
  rowHeight?: number
  headerHeight?: number
  rowHeaderWidth?: number
  defaultColWidth?: number
  body?: Partial<CellStyleTokens>
  header?: Partial<CellStyleTokens>
  rowHeader?: Partial<CellStyleTokens>
  corner?: Partial<CellStyleTokens>
  underlayBackgroundColor?: string
  interaction?: Partial<InteractionTokens>
  frameStyle?: Partial<FrameStyle>
}

export function extendsTheme(override?: ThemeOverride, base?: TableTheme): TableTheme

/** 单元格样式（逐格投影的最终形态；按格 hook 与列级样式的字段集） */
export interface CellStyle {
  background?: string
  color?: string
  font?: string
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  fontWeight?: number | string
  fontStyle?: string
  fontSize?: number
  fontFamily?: string
  underline?: boolean
  lineThrough?: boolean
  textWrap?: boolean
  textOverflow?: 'ellipsis' | 'clip'
  padding?: [top: number, right: number, bottom: number, left: number]
  border?: CellBorder
}

/** 边框线型（内嵌于 CellBorderEdge，未单独导出） */
type CellBorderStyle = 'solid' | 'dashed' | 'dotted' | 'double'

export interface CellBorderEdge {
  width: number
  color: string
  style?: CellBorderStyle
  /** 网格派生边标记：宿主设置样式时不填 */
  grid?: boolean
}

export interface CellBorder {
  top?: CellBorderEdge
  right?: CellBorderEdge
  bottom?: CellBorderEdge
  left?: CellBorderEdge
}

/** 样式投影：override 逐字段覆盖 base，边框逐边独立合并；返回新对象 */
export function projectCellStyle(base: CellStyle, override: CellStyle | null | undefined): CellStyle
```

`ListTableOptions.resolveCellStyle`（按格样式 hook，未导出为独立类型）：`(col: number, row: number) => CellStyle | null`——纯函数、同步、O(1)，返回 null 沿用基础样式。

默认主题关键值（经 `extendsTheme()` 派生结果读取）：`rowHeight: 32`、`headerHeight: 36`、`rowHeaderWidth: 48`、`defaultColWidth: 100`；body/header/rowHeader/corner 均为 `12px sans-serif`、前景 `#1f2329`、表头底 `#f5f6f7`、网格线 `#e5e6eb`；`underlayBackgroundColor: '#ffffff'`；interaction：`selectionFill: 'rgba(46, 106, 219, 0.08)'`、`selectionBorder: '#2e6adb'`、`selectionBorderWidth: 2`、`fillHandle/resizeLine: '#2e6adb'`、`resizeLineWidth: 2`、`headerHighlight: 'rgba(46, 106, 219, 0.18)'`、`freezeDividerColor: '#c9cdd4'`、`freezeDividerWidth: 1`、`scrollbarThumb: 'rgba(31, 35, 41, 0.4)'`、`scrollbarThumbHover: 'rgba(31, 35, 41, 0.55)'`、`scrollbarThumbActive: 'rgba(31, 35, 41, 0.7)'`、`scrollbarRadius: 4`、`scrollbarSize: 10`、`scrollbarMargin: 2`、`scrollbarMarginHover: 1`、`scrollbarHideDelay: 1000`；`frameStyle.lineWidth: 0`（不绘制外框）。

## 参数说明

`extendsTheme(override, base)`：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `override` | `ThemeOverride` | `{}` | 否 | 覆盖键生效，未给键继承 base |
| `base` | `TableTheme` | 引擎内置默认主题 | 否 | 派生基座；`rowHeader`/`corner` 随「生效 header」（base+override 合并结果）派生后，再应用各自显式覆盖键 |

`CellStyle`/`CellStyleTokens` 关键缺省：

| 字段 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `textAlign` | 枚举 | `'left'` | left/center/right |
| `verticalAlign` | 枚举 | `'middle'` | top/middle/bottom |
| `textOverflow` | 枚举 | 未设置（Excel 式溢出） | ellipsis 省略号截断；clip 内容盒裁剪 |
| `textWrap` | `boolean` | 未设置（不换行） | true 时超宽文本格内断行（`\n` 强制换行始终生效） |
| `padding` | `CellPadding` | `[0, 8, 0, 8]` | [上,右,下,左]，CSS 像素 |
| `border.*.style` | 枚举 | `'solid'` | solid/dashed/dotted/double |
| `border.*.grid` | `boolean` | 不填 | 主题网格边的内部标记；宿主写样式禁止自填 |
| `font` vs 结构化字段 | — | — | 给了 fontStyle/fontWeight/fontSize/fontFamily 任一即组装 CSS font 串（缺省分量补 12px/sans-serif）；全未给出回退 `font` 简写 |

## 方法与事件

`extendsTheme(override, base): TableTheme` — 同步纯函数。嵌套对象（body/header/rowHeader/corner/interaction/frameStyle）按键深覆盖；标量（rowHeight 等）未给继承 base。`rowHeader`/`corner` 的派生序：`{ ...生效header, ...override.rowHeader }`。

`projectCellStyle(base, override): CellStyle` — 同步纯函数，返回新对象不改入参。override 逐字段覆盖 base；边框四边独立合并（override 只给左边框时 base 其余三边保留）。

`table.getTheme(): TableTheme` — 返回当前生效主题。`table.updateTheme(override: ThemeOverride): void` — 以当前生效主题为 base 深覆盖合并（未给的键继承现值，可多次调用累积覆盖），随后重建场景、提交 body 层 full 失效并刷新交互浮层；不触碰滚动位置、选区、冻结等运行时状态；rowHeight/headerHeight/rowHeaderWidth/defaultColWidth 等几何 token 的已生效值不重算（运行时改行列尺寸走 `setRowHeight`/`setColWidth`）。

## 典型示例

### 列级样式 + 按格 hook 叠加（覆盖链）

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 760,
  height: 420,
  columns: [
    { field: 'name', title: '名称', width: 140, style: { fontWeight: 'bold' } },
    { field: 'price', title: '单价', width: 100, style: { textAlign: 'right' } },
  ],
  records: Array.from({ length: 50 }, (_, row) => ({ name: `行-${row}`, price: row })),
  resolveCellStyle: (col, row) => {
    if (row % 2 === 1) return { background: '#f8fafc' } // 斑马纹：按格 hook 最上层
    return null // null 沿用「主题 token + 列级样式」
  },
  hostOptions: { container },
})
// => 名称列加粗（列级）、单价列右对齐（列级）、奇数行浅灰底（按格覆盖背景，其余字段沿用下层）
```

### 逐边边框（其余三边保留网格线）

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 400,
  height: 300,
  columns: [{ field: 'a', title: 'A' }, { field: 'b', title: 'B' }],
  records: [{ a: 1, b: 2 }],
  resolveCellStyle: (col, row) =>
    col === 0 && row === 0
      ? {
          border: {
            left: { width: 3, color: '#dc2626' }, // 左 3px 红
            right: { width: 2, color: '#2563eb', style: 'dashed' }, // 右 2px 蓝虚线
            // 未给的 top/bottom 保留主题网格线（1px #e5e6eb）
          },
        }
      : null,
  hostOptions: { container },
})
```

### 深色主题整体派生（含滚动条 token）

```ts
import { extendsTheme, ListTable, type ThemeOverride } from 'infinitable'

const dark: ThemeOverride = {
  underlayBackgroundColor: '#111318',
  body: { color: '#e5e6eb', background: '#16181d', borderColor: '#2b2f36' },
  header: { color: '#e5e6eb', background: '#1d2026', borderColor: '#2b2f36' },
  interaction: {
    selectionFill: 'rgba(96, 165, 250, 0.16)',
    selectionBorder: '#60a5fa',
    fillHandle: '#60a5fa',
    resizeLine: '#60a5fa',
    freezeDividerColor: '#3a3f47',
    // 滚动条 token 深覆盖：三态色逐级提亮 + 收窄内缩
    scrollbarThumb: 'rgba(229, 230, 235, 0.4)',
    scrollbarThumbHover: 'rgba(229, 230, 235, 0.55)',
    scrollbarThumbActive: 'rgba(229, 230, 235, 0.7)',
  },
}
const theme = extendsTheme(dark)
console.log(theme.body.color) // => '#e5e6eb'
console.log(theme.rowHeight) // => 32（未给键继承默认主题）
console.log(theme.interaction.scrollbarRadius) // => 4（未覆盖的滚动条 token 继承默认）

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 600,
  height: 400,
  columns: [{ field: 'k', title: '键', width: 120 }, { field: 'v', title: '值' }],
  records: [{ k: 'a', v: 1 }],
  theme: dark,
  hostOptions: { container },
})
```

## 注意事项

> [!WARNING]
> - `defaultTheme` 常量 0.1.2 起不再导出：默认主题值经 `extendsTheme()` 派生结果或 `table.getTheme()` 读取；分区 token 结构（`CellStyleTokens`/`InteractionTokens`/`FrameStyle`）内嵌于 `TableTheme`，未单独导出。
> - 本库样式链是「主题分区 token → 列级样式 → 按格 hook」三级逐字段覆盖，不是 CSS 类名体系；不要试图用 class 控制 infinitable 单元格样式。
> - 主题 `borderColor` 投影为每格右/下 1px 默认网格边（收入本格）；显式 `border.right/bottom` 整边替换网格边，显式边与相邻格共享边的裁决规则：显式边恒胜网格派生边。
> - `CellBorderEdge.grid` 是引擎内部标记，宿主设置样式时禁止自填 `grid: true`。
> - 内建滚动条样式全部走 interaction token（0.1.2 起）：滑块三态色 `scrollbarThumb`/`scrollbarThumbHover`/`scrollbarThumbActive`（取档：拖拽激活 > hover > 默认）、圆角 `scrollbarRadius`（钳到厚度一半成胶囊形）、条带厚度 `scrollbarSize`、内缩 `scrollbarMargin`/`scrollbarMarginHover`（hover/拖拽收窄内缩即视觉变粗）、`'scrolling'` 档静止隐藏延时 `scrollbarHideDelay`；token 只影响绘制观感，不影响命中与拖拽行程换算。显示策略经 `ListTableOptions.scrollbar` 配置（见 `apis/list-table.md`）。
> - `underlayBackgroundColor` 是数据区底色（格背景之下）；做「内容之下衬底水印」时 ground 层内容会被 body 不透明底色遮挡，须把 body/underlay 配透明色，或改用顶层 `setOverlayPainter`。
> - 表头分区（header/rowHeader/corner）的 `textOverflow` 缺省由表侧兜底 ellipsis；数据格缺省是 Excel 式溢出到右侧空格，两者行为不同。
> - `updateTheme` 后 rowHeight/headerHeight 等几何 token 的已生效值不重算；要改运行时几何用 `setRowHeight`/`setColWidth`/`resize`。

## 常见问题

### 改了主题 rowHeight 但表格行高没变

原因：构造时 `options.rowHeight`（或显式几何）优先于主题 token；`updateTheme` 不重算已生效几何。修复：构造时不传 `options.rowHeight` 只传 `theme.rowHeight`，或运行时走 `setRowHeight`。

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 400,
  height: 300,
  columns: [{ field: 'a', title: 'A' }],
  records: Array.from({ length: 20 }, (_, i) => ({ a: i })),
  theme: { rowHeight: 24 }, // 主题级：构造期生效
  hostOptions: { container },
})
// 运行时改单行高（覆盖主题值，其余行仍是 24）：
table.setRowHeight(0, 40)
```
