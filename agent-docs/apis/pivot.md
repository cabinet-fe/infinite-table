---
title: "@infinitable/pivot 透视表引擎"
description: infinitable 透视表能力（infinitable/pivot 子路径转出 @infinitable/pivot 白名单）：PivotGrid 领域引擎——行维度树多列树形布局（同组跨行合并、折叠组收敛为小计载体行）× 列维度多级表头（冻结行 + 合并区落地）× 度量交叉聚合（PivotModel 展平为引擎 TableModel 数据面）；维度/度量运行时勾选与改聚合结构原地落地不重建实例；双击数据格下钻明细记录；实现 EngineAssembly 装配协议面，水印/打印等协议插件跨引擎挂载。
aliases: [pivot, 透视表, 交叉表, 数据透视, PivotGrid, PivotModel, 多级表头]
keywords: [PivotGrid, PivotModel, PivotGridOptions, PivotDimension, PivotMeasure, PivotAggregator, PivotRecord, PivotRow, PivotColumn, PivotCellDrillEvent, setRowDimensions, setColumnDimensions, setMeasures, updateMeasure, toggleNode, expandAll, collapseAll, onCellDrill, getCellRecords, getVisibleRowCount, EngineAssembly, 维度, 度量, 聚合, 小计, 总计, 下钻, 折叠, 多级表头, 树形布局]
---

# @infinitable/pivot 透视表引擎

`infinitable` 的 `./pivot` 子路径显式转出 `@infinitable/pivot` 全部公共 API（包本体 private 不发布，本子路径即其唯一对外发布面）。`PivotGrid` 是平级领域引擎经引擎装配协议接入 table 引擎的参考实现：内部构造 `ListTable` 后以 `TableEngine` 协议面持有，交叉聚合、维度树展开/折叠、动态勾选是本层领域状态机（`PivotModel` 展平为引擎 `TableModel` 数据面），渲染/滚动全走 table 引擎原语。布局语言：行方向为**多列树形布局**（每个行维度独占一列冻结带，同组单元格跨行合并，折叠组收敛为自带聚合值的单行载体即小计）；列方向为**多级表头**（列维度逐层一行 + 度量标题行，以引擎冻结行 + 合并区落地，无列维度时度量直排）。`PivotGrid` 对外实现 `EngineAssembly` 转发面，水印/打印等协议插件挂本引擎即生效。

## 快速上手

```ts
import { PivotGrid } from 'infinitable/pivot'

const container = document.querySelector<HTMLDivElement>('#pivot')!
const pivot = new PivotGrid({
  container,
  dimensions: [
    { key: 'status', title: '状态', width: 110 },
    { key: 'priority', title: '优先级', width: 100 },
    { key: 'year', title: '年份', width: 90 },
  ],
  measures: [
    { key: 'amount-sum', title: '金额和', field: 'amount', agg: 'sum', width: 130 },
    { key: 'record-count', title: '记录数', field: '', agg: 'count', width: 100 },
  ],
  records: [
    { status: '已完成', priority: '高', year: '2024年', amount: 200 },
    { status: '进行中', priority: '中', year: '2024年', amount: 91 },
  ],
  rowDimensions: ['status', 'priority'], // 树层级序
  columnDimensions: ['year'], // 多级表头；[] 为度量直排
})

pivot.setMeasures(['amount-sum']) // 运行时勾选：结构原地落地，不重建实例
console.log(pivot.getVisibleRowCount(), pivot.getDataColumnCount())

pivot.onCellDrill(({ records }) => {
  console.log('下钻明细', records) // 双击数据格带出该格聚合覆盖的原始记录
})

pivot.destroy() // 宿主收尾销毁
```

## API 签名

坐标统一为引擎坐标（0 基）：行坐标含表头偏移——前 `headerRowCount` 行为表头区（冻结带），其下为数据行；列坐标前 `rowHeaderCount` 列为行维度列（冻结带），其后为数据列。记录 `PivotRecord` 与引擎 `DataRecord` 同形（字段 key → 值）。

```ts
/** 聚合器：count 记录数（忽略 field）；sum/avg/min/max 按 field 数值聚合（非有限数跳过） */
export type PivotAggregator = 'sum' | 'count' | 'avg' | 'min' | 'max'

/** 维度（行/列方向挂载的分组字段；序列位置即树层级/表头层级） */
export interface PivotDimension {
  key: string
  title: string
  width: number // 行头列宽（多列树形布局下每行维度一列）
}

/** 度量（交叉格聚合字段；同记录字段可挂多个不同聚合的度量） */
export interface PivotMeasure {
  key: string // 度量唯一 key（勾选引用；与记录字段名无关）
  title: string
  field: string // 记录字段（agg 为 count 时忽略）
  agg: PivotAggregator
  width: number // 度量列宽
}

export type PivotRecord = DataRecord

/** 装配选项（维度池/度量池是勾选候选全集；运行时勾选序列决定聚合矩阵形态） */
export interface PivotGridOptions {
  container: HTMLElement // 挂载容器（四层画布落点）
  width?: number // 视口宽（缺省取容器当前宽度，0 回落 760）
  height?: number // 视口高（缺省取容器当前高度，0 回落 480）
  dpr?: number // 渲染设备像素比（像素断言等确定性场景锁 1）
  dimensions: readonly PivotDimension[]
  measures: readonly PivotMeasure[]
  records: readonly PivotRecord[]
  rowDimensions?: readonly string[] // 初始行维度 key 序列（层级序；缺省全部维度）
  columnDimensions?: readonly string[] // 初始列维度 key 序列（层级序即表头层级；空数组度量直排；缺省空）
  activeMeasures?: readonly string[] // 初始度量 key 序列（调用方顺序；缺省全部度量）
  showGrandTotal?: boolean // 总计行（缺省 true）
  collapsible?: boolean // 行维度树可折叠（缺省 true；false 时无展开钮、始终平铺）
  theme?: ThemeOverride // 主题深覆盖（选区边框被压 0：高亮为纯填充）
}

/** 可见行：leaf 最深维度值 / branch 折叠组载体行（自带聚合即小计）/ grand 总计行 */
export interface PivotRow {
  type: 'branch' | 'leaf' | 'grand'
  path: readonly string[] // 行维度路径（branch 为组前缀；leaf 到最深层；grand 为空）
  depth: number // path.length - 1（0 基；总计行 -1）
  expanded: boolean // branch 恒 false；leaf/grand 恒 true
  hasChildren: boolean // branch 恒 true；leaf/grand 恒 false
}

/** 列描述：行维度列（冻结带）或数据列（列维度路径 × 度量） */
export type PivotColumn =
  | { kind: 'row-header'; title: string; width: number }
  | { kind: 'measure'; colPath: readonly string[]; measure: PivotMeasure }

/** 双击下钻事件：命中数据格时携带该格聚合覆盖的原始记录 */
export interface PivotCellDrillEvent {
  col: number
  row: number
  records: readonly PivotRecord[]
}

export class PivotGrid implements EngineAssembly {
  constructor(options: PivotGridOptions)

  // ---- 领域操作（结构重算 + 引擎几何原地落地，不重建实例） ----
  setRowDimensions(keys: readonly string[]): void // 勾选行维度序列（顺序即树层级序；至少一个）
  setColumnDimensions(keys: readonly string[]): void // 勾选列维度序列（空序列度量直排）
  setMeasures(keys: readonly string[]): void // 勾选度量序列（顺序即数据列分组序；至少一个）
  updateMeasure(key: string, patch: Partial<Pick<PivotMeasure, 'agg' | 'title' | 'width'>>): void
  toggleNode(path: readonly string[]): void // 切换 branch 节点展开态
  getCollapsible(): boolean
  setCollapsible(enabled: boolean): void // 关闭时既有折叠态清空，整树平铺
  expandAll(): void
  collapseAll(): void // 整树收拢到一级

  // ---- 领域查询 ----
  getVisibleRowCount(): number // 可见数据行数（leaf + 折叠载体 + 总计，不含表头行）
  getDataColumnCount(): number // 数据列数（列维度叶子路径数 × 度量数）
  getRowHeaderCount(): number // 行头列数（= 当前行维度数）
  getHeaderRowCount(): number // 表头行数（列维度层数 + 度量行）
  getSubtotalRowCount(): number // 折叠载体行数（小计载体，不含总计）
  getRecordCount(): number
  getRowDimensionKeys(): readonly string[] // 当前勾选序列（面板回读引擎真实结构）
  getColumnDimensionKeys(): readonly string[]
  getMeasureKeys(): readonly string[]
  getMeasures(): readonly PivotMeasure[] // 当前度量定义快照（副本，防外改池）
  getCellRecords(col: number, row: number): readonly PivotRecord[] // 交叉格明细（下钻数据源）
  onCellDrill(listener: (event: PivotCellDrillEvent) => void): () => void // 双击数据格下钻
  getTable(): TableEngine // 引擎协议面出口（调试/领域外操作的窄接口）

  // ---- EngineAssembly 转发面（协议插件挂本引擎即生效） ----
  get host()
  get rowCount(): number
  getCellValue(col: number, row: number): unknown
  updateCell(col: number, row: number, value: unknown): void
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
  getTheme()
  updateTheme(override: ThemeOverride): void
  setUnderlayPainter(painter: UnderlayPainter | null): void
  setOverlayPainter(painter: OverlayPainter | null): void
  use(plugin: TablePlugin): void
  get read(): EngineReadView
  destroy(): void // 幂等
}

/**
 * 透视表聚合模型：行维度树 × 列维度树 × 度量 → 展平行序列与聚合矩阵，
 * 实现 TableModel 数据面（经 ListTableOptions.model 直挂；只读模型）。
 * 独立消费（无画布聚合计算/测试断言）可用；画布渲染与交互用 PivotGrid 装配。
 */
export class PivotModel implements TableModel {
  constructor(options: {
    dimensions: readonly PivotDimension[]
    measures: readonly PivotMeasure[]
    records: readonly PivotRecord[]
    rowDimensions?: readonly string[]
    columnDimensions?: readonly string[]
    activeMeasures?: readonly string[]
    showGrandTotal?: boolean
    collapsible?: boolean
  })

  get rowCount(): number // 表头行数 + 数据行数（引擎坐标）
  getCellValue(col: number, row: number): unknown
  onCellChange(): () => void // 只读模型：空实现

  get rows(): readonly PivotRow[] // 展平数据行序列快照（不含表头伪行）
  get columns(): readonly PivotColumn[] // 列序列快照
  get rowHeaderCount(): number
  get headerRowCount(): number
  get collapsible(): boolean
  setCollapsible(enabled: boolean): boolean // 结构变化返回 true
  get dataColumnCount(): number
  get branchRowCount(): number // branch 行数（不含总计）
  get recordCount(): number
  get mergeRanges(): readonly CellRange[] // 合并区快照（引擎坐标，含表头偏移）
  get activeRowDimensions(): readonly PivotDimension[]
  get activeColumnDimensions(): readonly PivotDimension[]
  get activeMeasures(): readonly PivotMeasure[]
  getColumnWidth(col: number): number | undefined
  getCellRecords(col: number, row: number): readonly PivotRecord[]
  groupRange(path: readonly string[]): { startRow: number; endRow: number } | null // 组的可见行区块
  headerColumnRange(col: number, row: number): { startCol: number; endCol: number } | null

  // 结构变化返回 true（由 PivotGrid 落地引擎几何；独立消费时自行响应）
  setRowDimensions(keys: readonly string[]): boolean
  setColumnDimensions(keys: readonly string[]): boolean
  setMeasures(keys: readonly string[]): boolean
  updateMeasure(key: string, patch: Partial<Pick<PivotMeasure, 'agg' | 'title' | 'width'>>): boolean
  toggleNode(path: readonly string[]): boolean
  expandAll(): boolean
  collapseAll(): boolean
}

// 冒烟像素/几何断言锚点常量（多级表头/折叠载体/总计行底色与行高）
export const PIVOT_ROW_HEIGHT = 32
export const PIVOT_HEADER_BACKGROUND = '#f5f6f7'
export const PIVOT_SUBTOTAL_BACKGROUND = '#f1f5f9'
export const PIVOT_GRAND_BACKGROUND = '#e2e8f0'
```

## 方法与事件

`PivotGrid` 内建交互（宿主零接线）：

- **滚轮**：引擎消费滚动时才 `preventDefault`（轴余量为 0 放行冒泡）；Shift+滚轮横向滚动。
- **点击路由**（选区不复用 sheet 交互面——无拖选/表头拖选/键盘移动/填充柄，选区是本层领域高亮，纯填充无边框）：
  - 数据格：高亮单元格自身。
  - 列维度表头：高亮该列组（同前缀合并跨度）× 全部数据行。
  - 行维度组格：高亮从命中的维度列起延展到最后一列的组整行带；点击组格左缘展开图标（合并区域竖直中线带内）折叠/展开，结构落地后高亮按新几何重放。
  - 行维度标题竖条（表头区 × 行头列）：无操作。
  - 拖拽（down/up 位移超 10px）不触发高亮变化。
- **双击下钻**：数据格双击经 `onCellDrill` 带出明细记录（无记录不派发）；返回退订函数。

结构落地：勾选/折叠变更经 `batchUpdate` 一次提交（行数/列数/冻结带/逐列宽/合并区），不重建实例；结构变化后旧选区坐标失效，高亮清空后由点击链路按新几何重放。

样式投影：表头行底色 `PIVOT_HEADER_BACKGROUND` 居中；折叠载体行底色 `PIVOT_SUBTOTAL_BACKGROUND` 加粗；总计行底色 `PIVOT_GRAND_BACKGROUND` 加粗；交叉格聚合数值右对齐，整数千分位（`en-US`）、非整数保留 1 位小数。

## 典型示例

### 飞书式字段配置面板（勾选序列回读引擎）

```ts
import { PivotGrid } from 'infinitable/pivot'

declare const pivot: PivotGrid
declare const panel: {
  rowDims: readonly string[]
  colDims: readonly string[]
  measures: readonly string[]
}

// 面板每次从引擎回读真实结构（引擎为唯一事实源），写入走领域操作
pivot.setRowDimensions(panel.rowDims)
pivot.setColumnDimensions(panel.colDims) // [] 即度量直排
pivot.setMeasures(panel.measures)
console.log(pivot.getRowDimensionKeys(), pivot.getColumnDimensionKeys(), pivot.getMeasureKeys())
```

### 双击下钻明细

```ts
import { PivotGrid } from 'infinitable/pivot'

declare const pivot: PivotGrid

const off = pivot.onCellDrill(({ col, row, records }) => {
  // records 为该交叉格聚合覆盖的原始记录（branch 载体取前缀路径全体）
  console.log(`(${col},${row}) 明细 ${records.length} 条`)
})

// 编程式取数（同一数据源，不依赖双击交互）
const detail = pivot.getCellRecords(2, 4)
off() // 退订
```

### 协议插件跨引擎挂载（水印）

```ts
import { PivotGrid } from 'infinitable/pivot'
import { createWatermarkPlugin } from 'infinitable'

declare const pivot: PivotGrid

// PivotGrid 实现 EngineAssembly：水印插件只收协议装配面，不感知底下是 ListTable
pivot.use(createWatermarkPlugin({ enabled: true, text: '内部资料' }))
pivot.updateTheme({}) // 主题与 painter 槽位同经协议面操作
```

## 注意事项

> [!WARNING]
> - 只读引擎：交叉格为聚合值，编辑面整体关闭（`resolveEditable` 恒 false）、引擎交互选区关闭（`interactiveSelection: false`）——无编辑器/拖选/键盘移动/填充柄能力。
> - 容器 `position` 必须非 static：四层 canvas 绝对定位叠放其内（同 `ListTable` 口径）。
> - 鼠标滚轮由本引擎内置接线（非 `ListTable` 的宿主自接口径），无需宿主再挂 `wheel` 监听。
> - 聚合口径：`count` 忽略 `field` 记记录数；`sum`/`avg`/`min`/`max` 只聚合有限数值（非有限数跳过）；空集 `count`/`sum` 为 0，`avg`/`min`/`max` 无值（显示层出空）。
> - 维度值空值（`null`/`undefined`/空串/非标量）归 `(空)` 组；维度值与列头序均为码点比较（不走 `localeCompare`），跨环境确定。
> - 勾选序列去重且按调用方顺序生效（不回池序）；`setRowDimensions`/`setMeasures` 至少一项有效，空序列整体忽略。
> - 结构变化（行/列维度序列、度量序列、度量聚合、折叠态）全部原地落地：引擎行列数、冻结带、合并区、列宽经 `batchUpdate` 收敛单次失效提交，不重建实例、不丢滚动位置语义之外的引擎状态。
> - 主题注入会压 `interaction.selectionBorderWidth = 0`（高亮为纯填充）：宿主显式给 `theme.interaction.selectionBorderWidth` 仍可覆盖。
> - `getTable()` 返回 `TableEngine` 协议面（窄接口），不暴露 `ListTable` 具体类型；领域操作一律走 `PivotGrid` 方法，勿经引擎面改结构。
> - 本子路径转售符号集合（6 值 + 8 类型）与 `packages/pivot/src/index.ts` 白名单同步维护，被 `packages/infinitable/tests/public-surface.test.ts` 快照冻结（判据与逐项清单见 `apis/exports.md`）。

## 常见问题

### 折叠/勾选后表格没变化或高亮错位

原因：绕过 `PivotGrid` 领域操作（如经 `getTable()` 直接改引擎结构）不会触发结构落地。修复：一切结构变更走 `setRowDimensions`/`setColumnDimensions`/`setMeasures`/`updateMeasure`/`toggleNode`；结构变化后高亮由引擎按新几何重放，无需宿主补偿。

```ts
import { PivotGrid } from 'infinitable/pivot'

declare const pivot: PivotGrid

pivot.setRowDimensions(['status', 'priority']) // 正确：领域操作落地几何
pivot.toggleNode(['已完成']) // 折叠一级组：组收敛为小计载体行
console.log(pivot.getSubtotalRowCount()) // => 当前折叠载体行数
```

### 想拿到聚合矩阵做导出/二次计算

`PivotModel` 可独立于画布构造（`TableModel` 数据面），`getCellValue(col, row)` 按 `rows`/`columns` 快照遍历即得展平矩阵；行坐标含表头偏移（前 `headerRowCount` 行为表头区）。

```ts
import { PivotModel } from 'infinitable/pivot'

const model = new PivotModel({
  dimensions: [{ key: 'status', title: '状态', width: 110 }],
  measures: [{ key: 'amount-sum', title: '金额和', field: 'amount', agg: 'sum', width: 130 }],
  records: [{ status: '已完成', amount: 7 }, { status: '进行中', amount: 3 }],
})

for (let i = 0; i < model.rows.length; i++) {
  const row = model.rows[i]!
  for (let col = model.rowHeaderCount; col < model.rowHeaderCount + model.dataColumnCount; col++) {
    console.log(row.path.join('/'), model.getCellValue(col, model.headerRowCount + i))
  }
}
```
