---
title: 透视表（pivot）
description: PivotGrid 透视表引擎的装配与消费：维度/度量/记录配置、树形行头与多级表头形态、运行时勾选与折叠、双击下钻、EngineAssembly 协议面与插件挂载。
---

# 透视表（pivot）

pivot 是透视表领域引擎：行维度展开为多列树形布局、列维度展开为多级表头、交叉格为度量聚合值。它内部构造 `ListTable` 并复用 table 引擎的渲染与滚动原语，聚合状态机（`PivotModel`）在包内；对外实现 `EngineAssembly` 装配协议面，水印、打印等协议插件挂本引擎即生效。

消费口径是 `infinitable/pivot` 子路径（不经主入口转售）：

```ts
import { PivotGrid, type PivotDimension, type PivotMeasure, type PivotRecord } from 'infinitable/pivot'
```

## 快速上手

```ts
import { PivotGrid } from 'infinitable/pivot'

const dimensions: readonly PivotDimension[] = [
  { key: 'status', title: '状态', width: 110 },
  { key: 'priority', title: '优先级', width: 100 },
  { key: 'year', title: '年份', width: 90 },
  { key: 'month', title: '月份', width: 90 },
]

const measures: readonly PivotMeasure[] = [
  { key: 'amount-sum', title: '金额和', field: 'amount', agg: 'sum', width: 130 },
  { key: 'record-count', title: '记录数', field: '', agg: 'count', width: 100 },
]

const records: readonly PivotRecord[] = [
  { status: '进行中', priority: '高', year: '2024年', month: '7月', amount: 120 },
  // ...
]

const pivot = new PivotGrid({
  container: document.querySelector<HTMLDivElement>('#pivot')!,
  dimensions, // 维度池：行/列维度勾选候选全集
  measures, // 度量池：度量勾选候选全集
  records,
  rowDimensions: ['status', 'priority'], // 初始行维度（层级序）
  columnDimensions: ['year', 'month'], // 初始列维度（表头层级序）；空数组度量直排
  activeMeasures: ['amount-sum', 'record-count'],
  showGrandTotal: true, // 总计行，缺省 true
  collapsible: true, // 行维度树可折叠，缺省 true
})

pivot.destroy() // 卸载；幂等
```

## 数据与配置

`PivotRecord` 与引擎的 `DataRecord` 同形：字段 key 到值的普通对象。维度池与度量池是勾选候选全集，运行时勾选决定聚合矩阵形态。

| 字段               | 类型                          | 默认                        | 说明                                                         |
| ------------------ | ----------------------------- | --------------------------- | ------------------------------------------------------------ |
| `container`        | `HTMLElement`                 | 必填                        | 挂载容器（四层画布落点），需 `position` 非 `static`          |
| `width` / `height` | `number`                      | 容器当前尺寸（缺省 760/480） | 视口尺寸（CSS 像素）                                         |
| `dpr`              | `number`                      | 跟随环境                    | 设备像素比；像素断言等确定性场景可锁 `1`                     |
| `dimensions`       | `readonly PivotDimension[]`   | 必填                        | 维度池：`key` / `title` / 行头列宽 `width`                   |
| `measures`         | `readonly PivotMeasure[]`     | 必填                        | 度量池：`key` / `title` / 记录字段 `field` / 聚合 `agg` / 列宽 `width` |
| `records`          | `readonly PivotRecord[]`      | 必填                        | 原始记录                                                      |
| `rowDimensions`    | `readonly string[]`           | 全部维度                    | 初始行维度 key 序列；顺序即树层级序，至少一个                |
| `columnDimensions` | `readonly string[]`           | `[]`                        | 初始列维度 key 序列；顺序即多级表头层级序，空序列度量直排    |
| `activeMeasures`   | `readonly string[]`           | 全部度量                    | 初始度量 key 序列；顺序即数据列分组序，至少一个              |
| `showGrandTotal`   | `boolean`                     | `true`                      | 总计行                                                       |
| `collapsible`      | `boolean`                     | `true`                      | 行维度树可折叠；`false` 时始终平铺展开、不绘展开钮           |
| `theme`            | `ThemeOverride`               | —                           | 主题覆盖（`ThemeOverride` 从主入口导入）；选区边框宽被压 `0`（高亮为纯填充），宿主可经 `interaction` 显式覆盖 |

聚合器 `PivotAggregator` 五种：`sum` / `avg` / `min` / `max` 按 `field` 数值聚合，`count` 统计记录数（忽略 `field`）。同一记录字段可挂多个不同聚合的度量。聚合值显示：整数千分位、非整数保留 1 位小数。

## 形态与交互

- **行方向：多列树形布局**。每个行维度独占一列（冻结带），同组单元格跨行合并。点击组格左缘的展开图标折叠/展开——折叠组收敛为自带聚合值的单行载体（小计行）。点击组格其余区域不折叠，而是高亮该组从命中维度列起的整行带。
- **列方向：多级表头**。列维度逐层一行 + 度量标题行，以引擎冻结行落地；同层前缀的连续数据列横向合并。点击列维度表头高亮该列组 × 全部数据行。
- **数据格**：点击高亮自身；双击下钻带出该格聚合覆盖的原始记录（`onCellDrill`）。
- **选区即领域高亮**：透视表不启用拖选、表头拖选、键盘移动与填充柄；高亮为纯填充无边框，结构变化后按新几何立即重放。拖拽（位移超阈值）不改高亮。
- **只读引擎**：交叉格为聚合值，编辑面整体关闭。
- **滚动**：视口内虚拟滚动（滚轮与触摸惯性走 table 引擎原语），结构变化原地落地、不重建实例。

## 领域操作与查询

勾选与折叠都是「结构重算 + 引擎几何原地落地」，不重建实例：

| 方法                                              | 说明                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `setRowDimensions(keys)`                          | 勾选行维度序列（顺序即层级序；至少一个）                     |
| `setColumnDimensions(keys)`                       | 勾选列维度序列（空序列度量直排）                             |
| `setMeasures(keys)`                               | 勾选度量序列（顺序即数据列分组序）                           |
| `updateMeasure(key, patch)`                       | 更新度量定义（`agg` / `title` / `width`；不改勾选序列）      |
| `toggleNode(path)` / `expandAll()` / `collapseAll()` | 折叠切换 / 全部展开 / 全部收起（收拢到一级）               |
| `getCollapsible()` / `setCollapsible(enabled)`    | 读取/切换可折叠配置（关闭时折叠态清空、整树平铺）            |

查询面（勾选面板回读引擎真实结构）：

| 方法                       | 说明                                            |
| -------------------------- | ----------------------------------------------- |
| `getVisibleRowCount()`     | 可见数据行数（leaf + 折叠载体 + 总计，不含表头） |
| `getDataColumnCount()`     | 数据列数（列维度叶子路径数 × 度量数）           |
| `getRowHeaderCount()`      | 行头列数（= 行维度数）                          |
| `getHeaderRowCount()`      | 表头行数（列维度层数 + 度量行）                 |
| `getSubtotalRowCount()`    | 折叠载体行数（小计载体，不含总计）              |
| `getRecordCount()`         | 记录总数                                        |
| `getRowDimensionKeys()` 等 | 当前行/列维度与度量 key 序列、度量定义快照      |
| `getCellRecords(col, row)` | 交叉格明细：该格聚合覆盖的原始记录              |

```ts
pivot.onCellDrill((event) => {
  // 数据格双击下钻：{ col, row, records }
  openDetailPanel(event.records)
})
```

## 协议面与插件

`PivotGrid` 实现 `EngineAssembly`：`host`、数据面（`rowCount` / `getCellValue` / `updateCell` / `onCellChange`）、`getTheme` / `updateTheme`、`setUnderlayPainter` / `setOverlayPainter`、`use`、`destroy` 与可选导出读取面 `read`。只依赖协议面的插件挂本引擎即生效：

```ts
import { createWatermarkPlugin } from 'infinitable'
import { PivotGrid } from 'infinitable/pivot'

const pivot = new PivotGrid({ /* ... */ })

// 水印是协议插件：挂在 PivotGrid 上同样生效
pivot.use(createWatermarkPlugin({ enabled: true, text: '内部资料', opacity: 0.12 }))

// 打印经引擎导出读取面供数（主入口的 createEnginePrintSource）
// createPrintPlugin({ source: createEnginePrintSource(pivot, { name: '透视表' }) })
```

需要表格领域操作（滚动定位、几何读取等）时，经 `pivot.getTable()` 取 `TableEngine` 协议面（不暴露 `ListTable` 具体类型）。

包内还导出四个断言锚点常量：`PIVOT_ROW_HEIGHT`（数据行高 32）、`PIVOT_HEADER_BACKGROUND`（表头行底色）、`PIVOT_SUBTOTAL_BACKGROUND`（小计载体行底色）、`PIVOT_GRAND_BACKGROUND`（总计行底色），供像素/几何断言使用。

## 与 ListTable / sheet 的关系

- `ListTable` 是通用表格引擎，列头固定单层；透视形态（多列树形行头、多级列头、聚合矩阵）由 pivot 在其上组装：表头以冻结行 + 合并区落地、树格经 `resolveCellRenderer` 自绘、结构变化走 `batchUpdate` 合并为一次失效提交。
- sheet 是电子表格模型（公式、命令、IO）；pivot 不依赖 sheet，聚合在客户端记录集上完成。
- 三者发布口径：主入口转售 table 公共面，`infinitable/sheet` 与 `infinitable/pivot` 各转售领域引擎。
