---
title: "@infinitable/sheet 电子表格核心"
description: infinitable 电子表格能力（infinitable/sheet 子路径转出 @infinitable/sheet 全量）：Sheet 单表模型（值/公式/样式/合并/冻结/浮动图/嵌入图/超链接/元数据，写操作一律经命令系统可撤销）、Workbook 多表簿（共享公式引擎跨表联动）、SheetGrid 画布装配适配层，以及 xlsx/csv 导入导出、快照持久化、填充生成与查找。
aliases: [sheet, 电子表格, Sheet 模型, Workbook, SheetGrid, 工作簿, 表格模型]
keywords: [Sheet, Workbook, SheetGrid, FormulaEngine, setCellValue, setCellFormula, setCellStyle, mergeCells, setFrozen, snapshot, restore, undo, redo, importXlsx, exportWorkbookXlsx, importCsv, exportSheetCsv, generateFill, setCellLink, setCellImage, 合并单元格, 冻结, 撤销, 快照, 电子表格, xlsx 导入导出]
---

# @infinitable/sheet 电子表格核心

`infinitable` 的 `./sheet` 子路径显式转出 `@infinitable/sheet` 全部公共 API，按域分四块：**模型**（`Sheet` 单表 + `Workbook` 多表簿 + `FormulaEngine` 公式门面 + 地址/存储/样式/合并/选区/图片工具）、**命令**（`HistoryManager` 撤销栈与 17 个 `XxxCommand` 可注册命令族）、**IO**（xlsx/csv 导入导出与快照替换）、**装配**（`SheetGrid`：Sheet 模型 ↔ 引擎 `ListTable` 适配层）。原 plugins 层的 sheet 插件族（`createSheetPlugin`）已整体删除——电子表格能力一律经本子路径的模型与函数消费。需要无 UI 数据面用 `Sheet`/`Workbook`；需要画布渲染与交互用 `SheetGrid` 装配。

## 快速上手

```ts
import { Sheet, SheetGrid } from 'infinitable/sheet'

const sheet = new Sheet('Sheet1')
sheet.setCellValue({ row: 0, col: 0 }, '季度报表') // 写值（'=' 前缀自动转公式）
sheet.setCellStyle(
  { start: { row: 0, col: 0 }, end: { row: 0, col: 3 } },
  { font: { bold: true }, align: { horizontal: 'center' } },
)
sheet.mergeCells({ start: { row: 0, col: 0 }, end: { row: 0, col: 3 } })
sheet.setFrozen(1, 0) // 冻结顶部 1 行

// SheetGrid 装配：容器 + 模型即成表（渲染/选区/编辑/填充柄/滚轮接线全部内置）
const container = document.querySelector<HTMLDivElement>('#grid')!
const grid = new SheetGrid({ container, sheet, width: 720, height: 400 })

sheet.setCellValue({ row: 1, col: 0 }, 42)
console.log(sheet.undo()) // => true（写操作经命令系统，可撤销）
grid.release() // 宿主收尾销毁
```

## API 签名

坐标统一用 0 基 `CellAddress`（`{ row, col }`）与 `CellRange`（`{ start, end }` 闭区间）；单元格数据 `CellData`（`v` 原始值 / `t` 类型 / `f` 公式原文不带 '=' / `s` 样式池引用），值类型 `CellValue = string | number | boolean | null`。

```ts
export class Sheet {
  readonly store: CellStore // 稀疏单元格存储
  readonly merges: MergeManager // 合并区
  readonly selection: SelectionModel // 选区
  readonly history: HistoryManager // 命令撤销栈
  readonly formulaGraph: FormulaEngine // 公式引擎（多表共享或自建）
  readonly stylePool: StylePool // 样式池（相同样式共享一份定义）

  constructor(name?: string, formulaGraph?: FormulaEngine)
  get name(): string // 改名必须经 Workbook.renameSheet
  get rowCount(): number // 有数据的高水位行列数
  get colCount(): number
  get rows(): number // 渲染行列数（0 = 未声明，由 SheetGrid 声明；结构操作后增长）
  get cols(): number

  // ---- 值与公式 ----
  getCellData(addr: CellAddress): CellData | undefined // 原始存储语义（被合并覆盖格 → undefined）
  getDisplayValue(addr: CellAddress): CellValue | undefined // 锚点解析语义（公式格返回计算缓存）
  setCellValue(addr: CellAddress, value: CellValue): void // '=' 前缀转 setCellFormula；空值 = 清除
  setCell(addr: CellAddress, data?: CellData): void
  setCellFormula(addr: CellAddress, formula: string): void // 可带 '=' 前缀；解析失败 → #ERROR!
  setCells(items: SetCellValueItem[]): void // 批量写入 = 一个 undo 单元

  // ---- 样式（全部经命令，可撤销）----
  setCellStyle(range: CellRange, partial: CellStylePatch): void // 部分合并语义（只给 fill 不动 border）
  setCellStyles(items: SetCellStyleItem[]): void
  clearCellStyle(range: CellRange): void
  getCellStyle(addr: CellAddress): CellStyle | undefined
  getEffectiveStyle(addr: CellAddress): CellStyle | undefined // 列 → 行 → 格字段级叠加
  setRowStyle(row: number, partial: CellStylePatch): void // 行/列默认样式
  setColStyle(col: number, partial: CellStylePatch): void
  getRowStyle(row: number): CellStyle | undefined
  getColStyle(col: number): CellStyle | undefined
  clearRowStyle(row: number): void
  clearColStyle(col: number): void

  // ---- 合并与冻结 ----
  mergeCells(range: CellRange): CellRange // 最终生效区域（相交取包围盒）；仅保留首个有值格
  mergeCellsBatch(ranges: CellRange[]): void // 批量合并 = 一个 undo 单元
  unmergeCells(range: CellRange): void
  getCellInfo(addr: CellAddress): CellInfo // normal | anchor | covered
  get frozen(): FrozenState // { rows, cols }
  setFrozen(rows: number, cols: number): void // 不进 undo

  // ---- 行列尺寸（px；不进 undo）----
  getRowHeight(row: number): number | undefined
  setRowHeight(row: number, height: number): void // ≤ 0 清除
  getColWidth(col: number): number | undefined
  setColWidth(col: number, width: number): void
  getRowHeights(): ReadonlyMap<number, number>
  getColWidths(): ReadonlyMap<number, number>
  get defaultRowHeight(): number | undefined // 未声明回落 SheetGrid 内置缺省
  setDefaultRowHeight(height: number | undefined): void
  get defaultColWidth(): number | undefined
  setDefaultColWidth(width: number | undefined): void

  // ---- 结构（行列插入删除；数据/合并/尺寸/图片随动，公式引用平移；可撤销）----
  insertRows(at: number, count?: number): void
  insertCols(at: number, count?: number): void
  deleteRows(at: number, count?: number): void
  deleteCols(at: number, count?: number): void

  // ---- 浮动图片（经命令，可撤销；随行列插删平移/收缩/移除）----
  insertImage(input: ImageInput): string // 返回图片 id
  removeImage(id: string): void
  updateImage(id: string, patch: ImageUpdateFields): void
  getImage(id: string): SheetImage | undefined
  getImages(): readonly SheetImage[]

  // ---- 按格嵌入图 / 超链接 / 只读标记 / Cell Meta（经命令，可撤销）----
  setCellImage(addr: CellAddress, image: CellImagePayload | null): void // null = 清除
  getCellImage(addr: CellAddress): CellImagePayload | undefined
  hasCellImage(addr: CellAddress): boolean
  setCellLink(addr: CellAddress, link: CellLinkPayload | null): void // URL 空白 = 清除
  getCellLink(addr: CellAddress): CellLinkPayload | undefined
  clearCellLink(addr: CellAddress): void
  setCellReadonly(addr: CellAddress, readonly?: boolean): void // 编辑拦截在 SheetGrid 层
  setRangeReadonly(range: CellRange, readonly?: boolean): void
  isCellReadonly(addr: CellAddress): boolean
  setCellMeta(addr: CellAddress, namespace: string, payload: unknown): void
  getCellMeta<T = unknown>(addr: CellAddress, namespace: string): T | undefined
  clearCellMeta(addr: CellAddress, namespace: string): void

  // ---- 撤销 / 事务 ----
  undo(): boolean
  redo(): boolean
  get canUndo(): boolean
  get canRedo(): boolean
  beginTransaction(): void // 事务内所有命令合并为一个 undo 单元（可嵌套）
  commit(): void
  rollback(): void

  // ---- 选区与快照 ----
  getSelection(): SelectionState // { activeCell, ranges }
  selectCell(addr: CellAddress): void
  selectRange(range: CellRange, active?: CellAddress): void
  snapshot(): SheetSnapshot // 全量快照（序列化持久化用）
  restore(snapshot: SheetSnapshot): void // 全量灌回（替换语义；冻结变化发 frozen-change）

  on<K extends keyof SheetEvents>(type: K, handler: (payload: SheetEvents[K]) => void): () => void
}

export class Workbook {
  readonly formulaGraph: FormulaEngine // 全部 sheet 共享
  get sheetCount(): number
  get activeSheet(): Sheet
  get activeSheetIndex(): number
  constructor() // 自带一个空 Sheet1
  getSheets(): Sheet[]
  getSheet(name: string): Sheet | undefined
  addSheet(name?: string, options?: AddSheetOptions): Sheet // 名称缺省 Sheet{n} 保证唯一
  removeSheet(name: string): boolean // 至少保留一个；引用方公式变 #REF!（不入 undo）
  renameSheet(oldName: string, newName: string): boolean // 空名/重名拒绝；跨表引用跟随改名
  activateSheet(name: string): boolean
  beginBatch(): void // 批量结构变更：事件抑制，endBatch 合并补发一次
  endBatch(): void
  on<K extends keyof WorkbookEvents>(type: K, handler: (payload: WorkbookEvents[K]) => void): () => void
}

/** 公式引擎门面（组合 @infinitable/formulas）：依赖图 + 增量重算编排。
 * Sheet/Workbook 构造期自建；独立 Sheet 间共享传同一实例。业务一般不直接调。 */
export class FormulaEngine {
  get nodeCount(): number
  getSheet(name: string): Sheet | undefined
  registerSheet(sheet: Sheet): void
}
```

独立函数（填充 / 查找 / IO）：

```ts
/** 由源选区 + 扩展选区 + 方向算出需填充的目标区（无新增区域返回 null） */
export function computeFillTargetRange(
  source: CellRange,
  direction: FillDirection,
  expanded: CellRange,
): CellRange | null

/** 生成填充写入项：非数字 tile 复制、数字/日期等差延续、公式相对引用位移 */
export function generateFill(options: GenerateFillOptions): SetCellValueItem[]

/** 查找：findAll 全量命中；findNext/findPrev 从指定格向后/向前（环绕）；
 * findNextFrom/findPrevFrom 在已有命中列表内定位（避免重复扫描） */
export function findAll(sheet: Sheet, query: string, options?: FindOptions): FindMatch[]
export function findNext(sheet: Sheet, query: string, from: CellAddress, options?: FindOptions): FindMatch | null
export function findPrev(sheet: Sheet, query: string, from: CellAddress, options?: FindOptions): FindMatch | null
export function findNextFrom(matches: FindMatch[], from: CellAddress): FindMatch | null
export function findPrevFrom(matches: FindMatch[], from: CellAddress): FindMatch | null

// ---- IO（xlsx/csv；内部消费 hucre 引擎，随包依赖无需自装）----
export async function importXlsx(
  buffer: ArrayBuffer | Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<Workbook>
export async function exportWorkbookXlsx(workbook: Workbook): Promise<Uint8Array> // ZIP 字节
export async function exportSheetXlsx(sheet: Sheet, options?: { fallbackName?: string }): Promise<Uint8Array>
export function exportSheetCsv(sheet: Sheet): string // UTF-8 BOM；公式格导计算缓存
export function importCsv(text: string, sheet: Sheet): void // 事务写入既有表（A1 起覆盖）
export function replaceWorkbookWithSnapshots(
  target: Workbook,
  snapshots: readonly SheetReplaceItem[],
  activeIndex: number,
): void // worker 导入链路：快照数组整簿替换
```

## 参数说明

`SheetGridOptions`（五要素）：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `container` | `HTMLElement` | — | 是 | 挂载容器；静态定位被归一为 `relative` |
| `sheet` | `Sheet` | — | 是 | 数据模型；冻结/合并/尺寸在构造期一次读取 |
| `rows` / `cols` | `number` | 缺省按「可视+缓冲」给足（下限 100×26） | 否 | 宿主声明即固定网格意图；构造后行列数变化须重建实例 |
| `width` / `height` | `number` | 测量容器（未布局回落 960×420） | 否 | 表视口 CSS 像素 |
| `readonly` | `boolean` | `false` | 否 | true 不注册编辑器、禁填充柄与行列拖改；`colResize: true` 可单独放开列宽拖拽 |
| `showRowHeader` / `showColHeader` | `boolean` | `true` | 否 | 行号列 / 列字母表头开关 |
| `scrollbar` | `boolean \| ScrollbarOptions` | `true` | 否 | `mode: 'native'` 切浏览器原生滚动条档（宿主滚轮接线自动让位） |
| `theme` | `ThemeOverride` | — | 否 | 以内置 `SHEET_GRID_THEME` 为底深覆盖；运行时换肤用 `grid.updateTheme` |
| `growOnScroll` | `boolean` | `true` | 否 | false 为固定尺寸网格：滚动与容器 resize 均不增长 |
| `openCellLinkOnClick` | `boolean` | `true` | 否 | false 关闭链接格单击默认打开，由宿主经事件接管 |
| `editorInsideBorder` | `boolean` | `false` | 否 | true 编辑浮层按锚定格边框内缩（粗边框格编辑不吞边框） |
| `header` | `SheetGridHeaderOptions` | — | 否 | 列头标题与自定义 DOM 表头（不传保持字母表头） |
| `editors` | `SheetGridEditorsOptions` | — | 否 | 类型化多编辑器注册与按格路由（readonly 下忽略） |
| `resolveDisplayValue` / `resolveCellStyle` / `resolveCellRenderer` | hook | — | 否 | 显示值 / 样式 / 渲染器按格注入，undefined 回落模型缺省口径 |
| `interceptSelection` | `(meta?: SelectionInterceptMeta) => boolean` | — | 否 | 返回 true 拦截本次选区手势（公式引用拾取用；meta 含 `shiftKey`/`extend`） |
| `onSelectionIntercept` / `onContextMenu` / `onEditStart` / `onEditEnd` / `onColResizeEnd` | 回调 | — | 否 | 交互事件（载荷为模型坐标） |

`SheetSnapshot`（`sheet.snapshot()` 产物，JSON 可序列化）：

| 字段 | 类型 | 缺省序列化 | 说明 |
| --- | --- | --- | --- |
| `cells` / `styles` | `CellSnapshotItem[]` / `CellStyle[]` | 必有 | 格数据与样式池 |
| `merges` / `frozen` / `rows` / `cols` | `CellRange[]` / `FrozenState` / `number` | 必有 | 合并、冻结、尺寸（0 = 未声明） |
| `rowHeights` / `colWidths` | `[number, number][]` | 未设置时省略 | 自定义行列尺寸（px） |
| `rowStyles` / `colStyles` | `[number, StyleId][]` | 未设置时省略 | 行/列默认样式（引用 styles 池） |
| `images` / `meta` | `SheetImage[]` / `CellMetaSnapshotItem[]` | 为空时省略 | 浮动图与 Cell Meta 侧车 |
| `selection` | `{ activeCell, ranges }` | 空选区省略 | 旧快照缺省回落 A1；不进 undo |

`SheetReplaceItem`（`replaceWorkbookWithSnapshots` 条目）：`{ name, snapshot, rowHeights?, colWidths?, defaultRowHeight?, defaultColWidth? }`——行高列宽与默认行列尺寸不进 `restore` 内容替换，随条目单独传输。

## 方法与事件

`Sheet` 事件（`sheet.on(type, handler)`，返回退订函数）：

| 事件 | 载荷 | 触发 |
| --- | --- | --- |
| `cell-change` | `{ addr }` | 单格数据变化（含清除） |
| `merge-change` | `{ range }` | 合并/取消合并 |
| `selection-change` | `SelectionState` | 选区变化 |
| `history-change` | `HistoryState` | 撤销栈变化（工具栏置灰） |
| `frozen-change` | `FrozenState` | 冻结变化（不进 undo） |
| `structure-change` | `StructureChange` | 行列插入/删除（宿主须重建 SheetGrid 实例） |
| `content-reset` | `undefined` | 整表内容替换（导入/undo 回放；视图层全量刷新信号） |
| `image-change` | `{ id? }` | 浮动图变化（无 id = 整表替换） |
| `meta-change` | `{ addr?, namespace? }` | Cell Meta 变化（无 addr = 整表替换） |
| `cell-image-change` | `{ addr? }` | 按格嵌入图变化 |
| `axis-style-change` | `{ axis, index }` | 行/列默认样式变化 |

`Workbook` 事件：`active-sheet-change`（`{ sheet, index }`）、`sheets-change`（`{ sheets }`）、`sheet-rename`（`{ sheet, oldName, newName }`）。

`SheetGrid` 实例面：

- `getTable(): ListTable` — 底层引擎表实例（调试/进阶用）。
- `hitTestSheetAddr(x, y): CellAddress | null` — 容器内相对坐标 → 模型地址（行列头返回 null）。
- `setSelectionAnchor(addr | null)` — 选区锚点持续高亮（fx 引用拾取）；纯视图态不写模型。
- `setHighlightRanges(items: readonly SheetGridHighlight[])` — 公式引用拾取染色框（`{ range, color }[]`）；空数组清除。
- `updateTheme(override: ThemeOverride)` — 运行时换肤：级联深覆盖 + 整表重绘，不重建网格、不触碰滚动/选区/冻结。
- `setVisible(on: boolean)` — LRU 可见性：隐藏只置脏；激活时一次性全量同步（多 tab 复用单实例用）。
- `applyAxisSizes(axis, indexes)` — 模型尺寸覆盖即时落到引擎（右键菜单数值项写入路径）。
- `setCellLink` / `getCellLink` / `clearCellLink` / `insertCellImage` / `removeCellImage` — 透传模型命令通道。
- `release()` — 销毁：拆线 + 引擎表销毁；`release` 后全部方法为空操作。

内建交互：容器聚焦后 Ctrl/Cmd+Z 撤销、Shift+Z / Ctrl+Y 重做（走模型命令栈）、Ctrl+A 全选、Delete 删除选中浮动图；只读态撤销重做与删除关闭。滚轮接线在引擎消费滚动时才 `preventDefault`（轴余量为 0 放行冒泡）；`scrollbar.mode: 'native'` 时整体让位给原生滚动容器。

## 典型示例

### 快照持久化（保存 / 恢复往返）

```ts
import { Sheet, type SheetSnapshot } from 'infinitable/sheet'

const sheet = new Sheet('Sheet1')
sheet.setCellValue({ row: 0, col: 0 }, '累计值')
sheet.setCellValue({ row: 1, col: 0 }, 10)
sheet.setCellValue({ row: 2, col: 0 }, 20)
sheet.setCellValue({ row: 4, col: 0 }, '=SUM(A2:A3)') // A5 引用 A2:A3（不可引用自身所在区间）

// 采集 → 任意持久化通道（JSON 可序列化）
const snap: SheetSnapshot = sheet.snapshot()
localStorage.setItem('sheet-snapshot', JSON.stringify(snap))

// 恢复（新实例或同实例均可；替换语义，快照内没有的状态被清场）
const raw = JSON.parse(localStorage.getItem('sheet-snapshot')!) as SheetSnapshot
const restored = new Sheet('Sheet1')
restored.restore(raw)
console.log(restored.getDisplayValue({ row: 4, col: 0 })) // => 30（公式计算缓存随快照恢复）
```

### xlsx 导入导出与 CSV

```ts
import {
  Sheet,
  exportWorkbookXlsx,
  exportSheetCsv,
  importCsv,
  importXlsx,
} from 'infinitable/sheet'

// 导入：xlsx 字节 → 新工作簿（每个 sheet 的写入 = 其自身历史栈上的单 undo 单元）
const buffer = await file.arrayBuffer() // <input type="file"> 读入的 .xlsx
const workbook = await importXlsx(buffer)
console.log(workbook.sheetCount) // => 文件内 sheet 数

// 导出：整簿 → xlsx 字节（值/公式/合并/样式（覆盖格自动物化锚点有效样式）/冻结/行列尺寸/浮动图）
const bytes = await exportWorkbookXlsx(workbook)
void bytes // 交宿主下载/上传

// CSV：导出活动表字符串；导入写入既有表（事务包裹 = 单 undo 单元）
const csv = exportSheetCsv(workbook.activeSheet)
const target = new Sheet('csv-target')
importCsv(csv, target)
target.undo() // => true（整次导入一并撤销）
```

### 填充生成与查找（宿主接线素材）

```ts
import { Sheet, computeFillTargetRange, findAll, generateFill } from 'infinitable/sheet'
import type { FindMatch } from 'infinitable/sheet'

const sheet = new Sheet('fill')
sheet.setCellValue({ row: 0, col: 0 }, 1)

// 引擎抛 onFillDragEnd 时宿主拿源区/扩展区/方向调这两个纯函数，结果经 setCells 落模型
const source = { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }
const expanded = { start: { row: 0, col: 0 }, end: { row: 3, col: 0 } }
const target = computeFillTargetRange(source, 'bottom', expanded) // => { start: {row:1,...}, end: {row:3,...} }
if (target) {
  sheet.setCells(
    generateFill({
      source,
      target,
      direction: 'bottom',
      getCellData: (addr) => sheet.getCellData(addr),
    }),
  )
}
console.log(sheet.getDisplayValue({ row: 1, col: 0 })) // => 2（单格数字步长 1 等差延续）

// 查找：全量命中 → 从某格起下一个（行主序环绕）；命中写回选区高亮
const matches = findAll(sheet, '2')
const hit: FindMatch | null = matches[0] ?? null
if (hit) sheet.selectRange({ start: hit.addr, end: hit.addr })
```

## 注意事项

> [!WARNING]
> - `createSheetPlugin` / `SheetPluginHandle` 已删除（0.2.x 清理，主入口与 plugins 层均不再导出）：电子表格能力一律经 `infinitable/sheet` 的 `Sheet`/`Workbook`/`SheetGrid` 消费。旧插件操作面对照——Store 直写 → `Sheet.setCellValue`/`setCellStyle` 等；`handle.undo/redo` → `sheet.undo()/redo()`；`saveSnapshot/restoreSnapshot` → `sheet.snapshot()/restore()`；`borderEdge/borderCells` → `buildBorderPresetItems` + `composeCellStyles`；`exportSheet` → `exportSheetXlsx`/`exportWorkbookXlsx`。
> - 一切写操作（值/公式/样式/合并/图片/meta/结构）都经命令系统执行并进入撤销栈；**不进 undo** 的清单：冻结、行列尺寸、默认行列尺寸、选区、`restore()` 全量灌回（对齐 Excel 有意为之）。
> - `sheet.rows`/`cols` 为 0 = 未声明（`SheetGrid` 构造期写入渲染尺寸）；行列插入/删除后模型行列数变化超出发擎适配面（引擎维度构造期固定），宿主必须重建 `SheetGrid` 实例——模型事件 `structure-change` 即此信号。
> - `growOnScroll` 缺省 `true`（WPS 式无限表格：初始网格按「可视+缓冲」给足，滚动触界后扩容）；`false` 为固定尺寸网格，滚动与容器 resize 均不增长。
> - v0.3.3 起，容器尺寸连续变化时，`SheetGrid` 在最后一次变化后 100ms 才按容器 `clientWidth`/`clientHeight` 调整视口（拖动期间保持上一尺寸，停手后落地一次）。宽或高为 0 时跳过，保留当前视口。
> - 公式口径：`setCellValue` 识别 `'='` 前缀转公式；解析失败记 `#ERROR!`；循环引用记 `#CYCLE!`；被引表删除后引用方记 `#REF!`（不入 undo）；公式原文存 `CellData.f`（不带 `'='`），`getDisplayValue` 返回计算缓存。
> - 合并值保留规则（同 Excel）：仅保留包围盒内按行主序第一个有值格的值写入新锚点，其余被覆盖格清空；相交合并自动取包围盒。
> - `SheetGrid` 的 `theme`/`scrollbar`/`editorInsideBorder`/`openCellLinkOnClick` 均为引擎 `ListTable` 同形透传：主题以内置 `SHEET_GRID_THEME` 为底经 `extendsTheme` 深覆盖；`mode: 'native'` 原生滚动条档下内建滚轮接线自动让位（引擎 `table.usesNativeScrollbar` 判定）。
> - 默认行列尺寸：`sheet.setDefaultRowHeight`/`setDefaultColWidth` 声明（px，不进 undo）后 `SheetGrid` 全部默认尺寸消费点优先读模型，未声明回落内置缺省 28px / 80px。xlsx 导入按文件声明写入：行高 pt→px `Math.round(v * 4 / 3)`（缺省 15pt→20px），列宽字符→px `Math.round(v * 7 + 5)`（缺省 8.43→64px）。
> - IO 映射：xlsx 往返日期用 1900 系序列数（`t: 'd'`）保真；`exportWorkbookXlsx`/`exportSheetXlsx` 对合并区覆盖格按有效样式（覆盖格解析到锚点，列 → 行 → 格叠加）自动物化纯样式格（值仍空），多行/列合并的外边框在 Excel 端完整渲染；`importCsv` 从 A1 覆盖写入既有表（空格不覆盖既有格，空串清除目标格）；`exportSheetCsv` 合并覆盖格输出空（同 Excel）、带 UTF-8 BOM。
> - 本库 A1 坐标系统有两套：本子路径的 `parseAddress`/`formatAddress`/`CellRange`（0 基格坐标域）与 formulas 层的 `parseCellRef`/`CellRef`（公式引用域）分立，禁止混用。

## 常见问题

### 改了 Sheet 数据但 SheetGrid 表现不对 / 行列插入后表格没变化

原因：行列数变化（`insertRows` 等）超出发擎适配面——引擎维度构造期固定，`SheetGrid` 不随 `structure-change` 自动扩引擎。修复：订阅 `structure-change` 重建 `SheetGrid` 实例；多实例场景切换前对隐藏实例调 `setVisible(false)`，切回 `setVisible(true)` 自动全量同步。

```ts
import { Sheet, SheetGrid } from 'infinitable/sheet'

const container = document.querySelector<HTMLDivElement>('#grid')!
let grid: SheetGrid | undefined
const sheet = new Sheet('Sheet1')

function mount(): void {
  grid?.release()
  grid = new SheetGrid({ container, sheet, width: 720, height: 400 })
}
mount()

sheet.on('structure-change', () => mount()) // 行列插入/删除后重建
sheet.insertRows(2, 1)
```

### undo 之后冻结、行高没有还原

原因：冻结、行列尺寸、默认行列尺寸、选区按约定不进 undo。修复：需要整体回退到某个状态时用快照——操作前 `sheet.snapshot()` 存底，需要时 `sheet.restore(snap)`（冻结变化会发 `frozen-change`，`SheetGrid` 自动跟随）。

```ts
import { Sheet, type SheetSnapshot } from 'infinitable/sheet'

declare const sheet: Sheet
const baseline: SheetSnapshot = sheet.snapshot() // 存底
sheet.setFrozen(2, 0)
sheet.setRowHeight(3, 48)
sheet.undo() // => false（冻结/行高不在撤销栈）
sheet.restore(baseline) // 整体回到存底状态
```
