# 主题与样式

infinitable 不使用 CSS 类名体系。所有单元格样式由一条固定的覆盖链决定：

```text
主题分区 token → 列级样式（ColumnDefine.style）→ 按格 hook（resolveCellStyle）
```

逐字段覆盖，边框逐边独立合并。上层给了的字段覆盖下层，未给的沿用下层。主题通过 `ListTableOptions.theme` 接入，运行时用 `table.updateTheme()` 深覆盖。

## 快速上手

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const table = new ListTable({
  width: 760,
  height: 420,
  columns: [
    { field: 'name', title: '名称', width: 160, style: { fontWeight: 'bold' } },
    { field: 'qty', title: '数量', width: 100, style: { textAlign: 'right' } },
  ],
  records: Array.from({ length: 100 }, (_, row) => ({ name: `商品-${row}`, qty: row })),
  theme: {
    rowHeight: 28,
    header: { background: '#dbeafe', textAlign: 'center' },
    body: { fontSize: 14, padding: [2, 6, 2, 6] },
    interaction: { selectionBorder: '#2170E7' },
  },
  resolveCellStyle: (_col, row) => (row % 2 === 1 ? { background: '#f8fafc' } : null),
  hostOptions: { container },
})

// 运行时换主题：以当前生效主题为 base 继续深覆盖
table.updateTheme({ body: { color: '#4b5563' } })
```

## 默认主题

`defaultTheme` 常量不在公共导出面。读取默认值用 `extendsTheme()` 的派生结果，或运行时的 `table.getTheme()`。

```ts
import { extendsTheme } from 'infinitable'

const theme = extendsTheme()
console.log(theme.rowHeight) // => 32
console.log(theme.interaction.scrollbarSize) // => 10
```

几何与底色：

| token                     | 默认值                                |
| ------------------------- | ------------------------------------- |
| `rowHeight`               | `32`                                  |
| `headerHeight`            | `36`                                  |
| `rowHeaderWidth`          | `48`                                  |
| `defaultColWidth`         | `100`                                 |
| `underlayBackgroundColor` | `'#ffffff'`（数据区底色，格背景之下） |
| `linkColor`               | `'#0563c1'`（有链接格的默认字色）     |

`body` / `header` / `rowHeader` / `corner` 四个分区：

| token           | body                | header / rowHeader / corner |
| --------------- | ------------------- | --------------------------- |
| `font`          | `'12px sans-serif'` | `'12px sans-serif'`         |
| `color`         | `'#1f2329'`         | `'#1f2329'`                 |
| `background`    | `'#ffffff'`         | `'#f5f6f7'`                 |
| `borderColor`   | `'#e5e6eb'`         | `'#e5e6eb'`                 |
| `textAlign`     | `'left'`            | `'left'`                    |
| `verticalAlign` | `'middle'`          | `'middle'`                  |
| `padding`       | `[0, 8, 0, 8]`      | `[0, 8, 0, 8]`              |

`interaction` 分区：

| token                  | 默认值                       | 用途                                             |
| ---------------------- | ---------------------------- | ------------------------------------------------ |
| `selectionFill`        | `'rgba(46, 106, 219, 0.08)'` | 选区填充                                         |
| `selectionBorder`      | `'#2e6adb'`                  | 选区边框                                         |
| `selectionBorderWidth` | `2`                          | 选区边框宽                                       |
| `fillHandle`           | `'#2e6adb'`                  | 填充柄                                           |
| `resizeLine`           | `'#2e6adb'`                  | resize 指示线                                    |
| `resizeLineWidth`      | `2`                          | resize 指示线宽                                  |
| `headerHighlight`      | `'rgba(46, 106, 219, 0.18)'` | 整行/整列选中时行号格、列头格高亮                |
| `freezeDividerColor`   | `'#c9cdd4'`                  | 冻结分隔线                                       |
| `freezeDividerWidth`   | `1`                          | 冻结分隔线宽                                     |
| `scrollbarThumb`       | `'rgba(31, 35, 41, 0.4)'`    | 滚动条滑块默认色                                 |
| `scrollbarThumbHover`  | `'rgba(31, 35, 41, 0.55)'`   | 滑块 hover 色                                    |
| `scrollbarThumbActive` | `'rgba(31, 35, 41, 0.7)'`    | 滑块拖拽激活色                                   |
| `scrollbarRadius`      | `4`                          | 滑块圆角；绘制时钳到厚度一半成胶囊形             |
| `scrollbarSize`        | `10`                         | 滚动条条带厚度                                   |
| `scrollbarTrackColor`  | `'#f0f1f3'`                  | 预留轨道的底色（`reserve` 开启时）               |
| `scrollbarMargin`      | `2`                          | 滑块内缩；hover/拖拽收窄即视觉变粗               |
| `scrollbarMarginHover` | `1`                          | hover/拖拽态内缩                                 |
| `scrollbarHideDelay`   | `1500`                       | `'hover'` / `'scrolling'` 档静止后隐藏延时（ms） |

外框：

| token                  | 默认值            |
| ---------------------- | ----------------- |
| `frameStyle.lineWidth` | `0`（不绘制外框） |
| `frameStyle.color`     | `'#e5e6eb'`       |
| `frameStyle.shadow`    | `false`           |

## extendsTheme 深覆盖

```ts
import { extendsTheme, type ThemeOverride, type TableTheme } from 'infinitable'

const override: ThemeOverride = {
  rowHeight: 24,
  header: { background: '#000000' },
  body: { fontSize: 13 },
}

const theme: TableTheme = extendsTheme(override)
```

```ts
function extendsTheme(override?: ThemeOverride, base?: TableTheme): TableTheme
```

- 标量（`rowHeight` 等）未给继承 `base`。
- 嵌套分区（`body` / `header` / `rowHeader` / `corner` / `interaction` / `frameStyle`）按键深覆盖一层，不递归多层对象（分区内的值都是标量或数组）。
- `rowHeader` 与 `corner` 缺省随「生效 header」派生：

```text
生效 header = { ...base.header, ...override.header }
rowHeader  = { ...生效 header, ...override.rowHeader }
corner     = { ...生效 header, ...override.corner }
```

所以只改 `header` 会自动带动行号列与角格；要单独区分，再给 `rowHeader` / `corner` 显式键。

`ThemeOverride` 的所有键都可选；`TableTheme` 是完整结果，分区 token 类型（`CellStyleTokens` / `InteractionTokens` / `FrameStyle`）内嵌在 `TableTheme` 里，未单独导出。

### updateTheme

```ts
table.updateTheme(override)
```

- 以**当前生效主题**为 base 再深覆盖，多次调用会累积，不会重置之前改过的键。
- 清空列级样式投影缓存、刷新交互浮层、重建场景并提交 body 层 `full` 失效。
- 不触碰滚动位置、选区、冻结等运行时状态。
- **不重算已生效的几何值**：`rowHeight` / `headerHeight` / `rowHeaderWidth` / `defaultColWidth` 在构造时已物化，运行时改行列尺寸请用 `setRowHeight` / `setColWidth`。

::: warning
`updateTheme` 是累积覆盖。深色切浅色时，必须把深色改过的每个键都用浅色值显式给回，否则会残留深色值；不想维护两套完整覆盖时，重建表格实例更简单。
:::

## 主题分区 token

`TableTheme` 的形态：

```ts
interface TableTheme {
  rowHeight: number
  headerHeight: number
  rowHeaderWidth: number
  defaultColWidth: number
  body: CellStyleTokens
  header: CellStyleTokens
  rowHeader: CellStyleTokens
  corner: CellStyleTokens
  underlayBackgroundColor: string
  linkColor: string
  interaction: InteractionTokens
  frameStyle: FrameStyle
}
```

`CellStyleTokens` 字段：

| 字段            | 类型                            | 说明                                                   |
| --------------- | ------------------------------- | ------------------------------------------------------ |
| `font`          | `string`                        | CSS font 简写；在未给结构化字体字段时使用              |
| `color`         | `string`                        | 文字色                                                 |
| `background`    | `string`                        | 背景色                                                 |
| `borderColor`   | `string`                        | 网格线色；投影为每格右/下 1px 默认网格边               |
| `textAlign`     | `'left' \| 'center' \| 'right'` | 缺省 `'left'`                                          |
| `verticalAlign` | `'top' \| 'middle' \| 'bottom'` | 缺省 `'middle'`                                        |
| `fontWeight`    | `number \| string`              | CSS font-weight                                        |
| `fontStyle`     | `string`                        | CSS font-style                                         |
| `fontSize`      | `number`                        | CSS 像素                                               |
| `fontFamily`    | `string`                        | CSS font-family                                        |
| `underline`     | `boolean`                       | 下划线                                                 |
| `lineThrough`   | `boolean`                       | 删除线                                                 |
| `textOverflow`  | `'ellipsis' \| 'clip'`          | 数据格缺省保持 Excel 式溢出；表头由表侧兜底 `ellipsis` |
| `padding`       | `[top, right, bottom, left]`    | 缺省 `[0, 8, 0, 8]`                                    |
| `border`        | `CellBorder`                    | 逐边边框；缺省的边不绘制                               |

## 列级样式

```ts
const table = new ListTable({
  width: 600,
  height: 300,
  columns: [
    { field: 'name', title: '名称', style: { fontWeight: 'bold' } },
    { field: 'price', title: '单价', style: { textAlign: 'right', color: '#dc2626' } },
  ],
  records: [{ name: 'A', price: 12 }],
  hostOptions: { container },
})
```

- `ColumnDefine.style` 只作用于数据格，不影响列头；列头样式走 `header` 分区。
- `ColumnDefine.textWrap` 会先并入主题层基础样式，再叠加 `style`，因此 `style.textWrap` 可覆盖列开关。
- 主题 token + 列级样式的合成结果按列缓存；`updateTheme` 时整体清空。

## 按格样式 hook

```ts
const table = new ListTable({
  width: 600,
  height: 300,
  columns: [
    { field: 'k', title: '键' },
    { field: 'v', title: '值' },
  ],
  records: Array.from({ length: 50 }, (_, row) => ({ k: `k-${row}`, v: row })),
  resolveCellStyle: (col, row) => {
    if (col === 1 && row < 10) return { background: '#fef2f2' }
    return null // 沿用主题 token + 列级样式
  },
  hostOptions: { container },
})
```

```ts
type ResolveCellStyle = (col: number, row: number) => CellStyle | null
```

- 纯函数、同步、O(1)；返回 `null` 表示不覆盖。
- 只有返回非空时才做第二级样式投影并分配新对象；滚动热路径上尽量减少非空返回。
- 有链接格会在列级样式之上先注入默认链接外观（`linkColor` + 下划线），再被本 hook 逐字段覆盖。

## projectCellStyle

```ts
import { projectCellStyle, type CellStyle } from 'infinitable'

const base: CellStyle = {
  background: '#ffffff',
  color: '#1f2329',
  border: { right: { width: 1, color: '#e5e6eb' } },
}

const result = projectCellStyle(base, {
  background: '#fff7ed',
  border: { left: { width: 2, color: '#dc2626' } },
})
// result.border => { right: 1px #e5e6eb 保留, left: 2px #dc2626 新增 }
```

```ts
function projectCellStyle(base: CellStyle, override: CellStyle | null | undefined): CellStyle
```

- 同步纯函数，返回新对象，不改入参。
- 标量字段逐字段覆盖；边框四边独立合并，`override` 只给一条边时 `base` 的其它三边保留。
- 这是样式链的底层投影函数，宿主做自定义样式合成时可复用。

## CellStyle 与逐边边框

```ts
interface CellStyle {
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

interface CellBorder {
  top?: CellBorderEdge
  right?: CellBorderEdge
  bottom?: CellBorderEdge
  left?: CellBorderEdge
}

interface CellBorderEdge {
  width: number
  color: string
  style?: 'solid' | 'dashed' | 'dotted' | 'double'
  /** 网格派生边标记；宿主设置样式时禁止自填 */
  grid?: boolean
}
```

边框规则：

- 主题 `borderColor` 投影为每格 **右/下** 1px 默认网格边，边归本格所有。
- 显式 `border.right` / `border.bottom` 整边替换网格边；显式 `border.left` / `border.top` 与左/上邻居共享边裁决，显式边恒胜网格派生边。
- 未设置的边不绘制；`style` 缺省 `'solid'`。
- `grid` 是引擎内部标记，用来区分网格派生边与用户显式边，宿主不要自填。
- 合并主格按整块包围盒归约右/下外缘，左/上由主格自身边框与邻居对侧边取强。

```ts
const table = new ListTable({
  width: 400,
  height: 300,
  columns: [
    { field: 'a', title: 'A' },
    { field: 'b', title: 'B' },
  ],
  records: [{ a: 1, b: 2 }],
  resolveCellStyle: (col, row) =>
    col === 0 && row === 0
      ? {
          border: {
            left: { width: 3, color: '#dc2626' },
            right: { width: 2, color: '#2563eb', style: 'dashed' },
            // top/bottom 未给，保留主题网格线
          },
        }
      : null,
  hostOptions: { container },
})
```

### 字体字段

`CellStyle` 同时支持 `font` 简写和结构化字段：

- 给了 `fontStyle` / `fontWeight` / `fontSize` / `fontFamily` 中任意一个，引擎组装 CSS font 串，缺省分量补 `12px` / `sans-serif`。
- 全部未给时回退 `font` 简写，再回退默认字体。
- 文本测量使用的 font 串与实际绘制同源，见下文「DPR 与字体测量」。

## 合并单元格样式

合并区的样式只取**主格**（区间左上角）的投影结果，覆盖整块包围盒；被合并覆盖的格不建节点，`resolveCellStyle` 也不会对它们调用。下方样式优先级中的「按格」指的是主格坐标。

```ts
const table = new ListTable({
  width: 640,
  height: 360,
  columns: [
    { field: 'name', title: '名称' },
    { field: 'note', title: '备注' },
  ],
  records: Array.from({ length: 20 }, (_, row) => ({ name: `行-${row}`, note: `备注-${row}` })),
  mergeCells: [{ startCol: 1, startRow: 2, endCol: 1, endRow: 4 }],
  resolveCellStyle: (col, row) =>
    col === 1 && row === 2
      ? {
          background: '#eff6ff',
          fontWeight: 'bold',
          border: {
            left: { width: 1, color: '#2563eb' },
            right: { width: 1, color: '#2563eb' },
            top: { width: 1, color: '#2563eb' },
            bottom: { width: 1, color: '#2563eb' },
          },
        }
      : null,
  hostOptions: { container },
})
```

编辑、取值、命中与样式都以主格为准；给被覆盖格设置样式不会生效。

## 滚动条样式

canvas 档滚动条的全部观感走 `interaction` token：

```ts
table.updateTheme({
  interaction: {
    scrollbarThumb: 'rgba(37, 99, 235, 0.45)',
    scrollbarThumbHover: 'rgba(37, 99, 235, 0.6)',
    scrollbarThumbActive: 'rgba(37, 99, 235, 0.8)',
    scrollbarRadius: 4,
    scrollbarSize: 12,
    scrollbarTrackColor: '#f8fafc',
    scrollbarMargin: 3,
    scrollbarMarginHover: 1,
    scrollbarHideDelay: 800,
  },
})
```

- 三态取色顺序：拖拽激活 > hover > 默认。
- `scrollbarRadius` 绘制时钳到 `scrollbarSize / 2`，最大为胶囊形。
- `scrollbarMargin` 只在厚度方向内缩；收窄即视觉变粗，但不改变滑块行程换算。
- `scrollbarTrackColor` 只在 `ListTableOptions.scrollbar.reserve` 为 `true`（缺省）时绘制预留轨道。
- token 只影响绘制，不影响命中与拖拽逻辑。
- 显隐策略由 `ListTableOptions.scrollbar` 配置，缺省 `'hover'`；`true` 等价 `'always'`；`false` 整体关闭。
- `scrollbar: { mode: 'native' }` 时滚动条由浏览器原生渲染，以上 token 不参与。

## DPR 与字体测量

### DPR

- `RenderHost` 的 `dpr` 缺省取运行环境 `window.devicePixelRatio`，无 `window` 时回落 `1`。
- `ListTable` 未注入 `host` 时把当前 DPR 透传给自建 host；显式 `hostOptions.dpr` 会锁定该值，`table.resize()` 沿用构造值，适合截图对比、像素断言和离屏出图。
- 未显式锁定 DPR 时，宿主在 `window.resize` 与 `matchMedia('(resolution: Xdppx)')` 两条通道上探测 DPR 变化，自动重设各层画布物理尺寸并重绘，实例不重建、滚动位置与场景内容不动。
- DPR 只影响画布背板像素密度，不改变 CSS 像素口径的宽高、行高、列宽与命中坐标。

### 字体测量

- 文本测量经 `RenderHost.measure(text, font)`，内部使用共享测量 canvas 的 `measureText`；测试或离屏场景可注入 `hostOptions.measureText`。
- 引擎按 font 串缓存逐字符推进宽，用于溢出走廊判定等快路径。font 串来自主题 token、列级样式或按格 hook，组装规则与实际绘制一致。
- 自定义字体未加载完成时，测量会落到回退字体，溢出与换行判断可能按回退字体计算。字体就绪后可调用 `table.updateTheme({})` 触发场景重建与重新测量；`{}` 不会改变现有 token。

::: tip
`updateTheme({})` 是空覆盖，但仍会清列级样式缓存、重建场景并整层失效。它适合在字体加载完成、外部测量环境变化后触发一次全量重算。
:::

## 可运行换肤示例

```html
<div id="table" style="position: relative; width: 800px; height: 400px"></div>
<button id="toggle-theme">切换主题</button>
```

```ts
import { ListTable, type ThemeOverride } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'
const toggle = document.querySelector<HTMLButtonElement>('#toggle-theme')!

const light: ThemeOverride = {
  underlayBackgroundColor: '#ffffff',
  linkColor: '#0563c1',
  body: { color: '#1f2329', background: '#ffffff', borderColor: '#e5e6eb' },
  header: { color: '#1f2329', background: '#f5f6f7', borderColor: '#e5e6eb' },
  interaction: {
    selectionFill: 'rgba(46, 106, 219, 0.08)',
    selectionBorder: '#2e6adb',
    fillHandle: '#2e6adb',
    resizeLine: '#2e6adb',
    headerHighlight: 'rgba(46, 106, 219, 0.18)',
    freezeDividerColor: '#c9cdd4',
    scrollbarThumb: 'rgba(31, 35, 41, 0.4)',
    scrollbarThumbHover: 'rgba(31, 35, 41, 0.55)',
    scrollbarThumbActive: 'rgba(31, 35, 41, 0.7)',
    scrollbarTrackColor: '#f0f1f3',
  },
}

const dark: ThemeOverride = {
  underlayBackgroundColor: '#111318',
  linkColor: '#60a5fa',
  body: { color: '#e5e6eb', background: '#16181d', borderColor: '#2b2f36' },
  header: { color: '#e5e6eb', background: '#1d2026', borderColor: '#2b2f36' },
  interaction: {
    selectionFill: 'rgba(96, 165, 250, 0.16)',
    selectionBorder: '#60a5fa',
    fillHandle: '#60a5fa',
    resizeLine: '#60a5fa',
    headerHighlight: 'rgba(96, 165, 250, 0.22)',
    freezeDividerColor: '#3a3f47',
    scrollbarThumb: 'rgba(229, 230, 235, 0.4)',
    scrollbarThumbHover: 'rgba(229, 230, 235, 0.55)',
    scrollbarThumbActive: 'rgba(229, 230, 235, 0.7)',
    scrollbarTrackColor: '#1b1e24',
  },
}

const table = new ListTable({
  width: 800,
  height: 400,
  columns: [
    { field: 'name', title: '名称', width: 200 },
    { field: 'qty', title: '数量', width: 120, style: { textAlign: 'right' } },
  ],
  records: Array.from({ length: 1_000 }, (_, row) => ({ name: `商品-${row}`, qty: row })),
  hostOptions: { container },
})

let isDark = false
toggle.addEventListener('click', () => {
  isDark = !isDark
  table.updateTheme(isDark ? dark : light)
  toggle.textContent = isDark ? '切换浅色' : '切换深色'
})
```

因为 `updateTheme` 累积深覆盖，`light` 里必须列出 `dark` 改过的全部键；上例两套覆盖键完全对称，所以可以来回切换。

## 相关

- [ListTable API](/api/list-table)：`theme` 选项、`getTheme` / `updateTheme`、`scrollbar` 配置。
- [核心类型与模型（core）](/api/core)：`TableTheme`、`ThemeOverride`、`CellStyle`、`CellBorder` 的导出面。
- [交互与编辑](/guide/interaction-editing)：选区、填充柄、冻结分隔线与编辑浮层内缩的运行时行为。
