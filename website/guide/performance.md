# 性能与虚拟滚动

infinitable 的性能优势来自两件事：**只维护可视窗口**和**只重绘失效区域**。前者让首帧和滚动不随总行数增长，构造阶段只多一次廉价的前缀和计算；后者让写入和交互不触发整表重绘。

本页先给出量化基准，再解释虚拟滚动和失效面积控制的原理，最后列出常见性能陷阱与基准复现方式。

## 基准结论

基准数据来自仓库 README。口径如下：

- 同一页面、同一数据（10 万 / 100 万行 × 20 列）、同视口（1280×720、行高 32、列宽 100、无冻结、双方默认主题、公开 API 直调）。
- 每个规模按 `[本仓, VTable, VTable, 本仓]` 对称跑序各 2 轮取均值。
- “快 N×” = VTable 耗时 / 本仓耗时（吞吐类指标反之），±5% 内记为持平。

::: tip 采样环境
macOS（Apple Silicon）Chrome headless · VTable 1.26.8 · 本仓 git `21c6a25` · 2026-09-28。完整报告与 JSON 基线见 `playground/results/`。
:::

### 10 万行 × 20 列

| 指标                     | infinitable | VTable     | 对比     |
| ------------------------ | ----------- | ---------- | -------- |
| 构造耗时 P50             | 1.70ms      | 26.85ms    | 快 15.8× |
| 首次渲染时间（TTFF）P50  | 17.15ms     | 29.90ms    | 快 1.7×  |
| 整表重建（构造 + 首帧）  | 18.00ms     | 27.82ms    | 快 1.6×  |
| 逐格写吞吐               | 316 ops/ms  | 127 ops/ms | 快 2.5×  |
| 批量写 2000 格           | 16.10ms     | 18.05ms    | 快 1.1×  |
| 单次大幅跳转 JS 耗时 P95 | 1.45ms      | 11.10ms    | 快 7.7×  |
| 滚动调用 JS 耗时 P95     | 0.80ms      | 1.05ms     | 快 1.3×  |
| 稳态滚动 FPS             | 60.0        | 60.0       | 持平     |

### 100 万行 × 20 列

| 指标                     | infinitable | VTable     | 对比    |
| ------------------------ | ----------- | ---------- | ------- |
| 构造耗时 P50             | 12.00ms     | 42.30ms    | 快 3.5× |
| 首次渲染时间（TTFF）P50  | 16.70ms     | 44.70ms    | 快 2.7× |
| 整表重建（构造 + 首帧）  | 17.27ms     | 45.30ms    | 快 2.6× |
| 逐格写吞吐               | 360 ops/ms  | 144 ops/ms | 快 2.5× |
| 批量写 2000 格           | 16.10ms     | 16.85ms    | 持平    |
| 单次大幅跳转 JS 耗时 P95 | 1.25ms      | 10.25ms    | 快 8.2× |
| 滚动调用 JS 耗时 P95     | 0.85ms      | 1.00ms     | 快 1.2× |
| 稳态滚动 FPS             | 60.0        | 60.0       | 持平    |

### 怎么读这些数字

- 22 项指标中，infinitable 领先 17 项、持平 5 项、落后 0 项。
- 数据量 ×10 后，TTFF 从 17.15ms 变为 16.70ms，整表重建从 18.0ms 变为 17.3ms，基本不变；VTable 的 TTFF 和重建分别从 29.9ms / 27.8ms 劣化到 44.7ms / 45.3ms。
- 构造耗时从 1.70ms 增长到 12.00ms。这是行高/列宽前缀和的全量数组计算，属于 O(行数) 的一次性成本，不创建逐行对象；渲染相关的成本仍然只与可视窗口有关。
- FPS 持平是因为测试机上两库都跑满 60 帧。帧预算敏感的场景（低端设备、大步长滚动、拖动滚动条）更能体现差异，指标看“滚动调用 JS 耗时”和“大幅跳转 JS 耗时”。
- 对比的是公开 API 直调的引擎耗时，不包含业务侧的数据请求、数据转换和页面框架渲染。

## 虚拟滚动原理

### 可见窗口由滚动位置决定

行和列的位置用前缀和表示：`rowOffsets[i]` 是第 `i` 行的上缘，`colOffsets[i]` 是第 `i` 列的左缘。给定 `scrollTop` / `scrollLeft` 和视口尺寸后：

1. 在前缀和上二分定位窗口起点 `start`，复杂度 O(log n)。
2. 从 `start` 向后扫描到视口下/右缘，得到 `end`，成本与可见行列数相关。
3. 按 `overscanRows` / `overscanCols` 扩展装配窗口，再夹取冻结边界。

因此滚动帧的窗口计算不随总行数增长。滚动到第 50 万行和第 5 行，窗口大小都是视口能容纳的几十行。

### 只为窗口内行列建场景节点

场景树里只有：

- 可视窗口内的数据格和行列头。
- 冻结行列单独成带。
- 与窗口相交的合并单元格主格。
- 窗口外但仍需参与文本溢出的源格。
- 滚动缓冲（`overscanRows` / `overscanCols`）预建的行列。

窗口外的行列没有场景节点。这不是丢数据：`getCellRelativeRect` 对窗口外格返回 `null`，`refreshCell` 对窗口外格通常是空操作。滚回来时按需重建，数据始终留在模型里。

### 滚动帧做增量维护

滚动不重建整个窗口，而是：

1. 摘除滚出窗口的节点，存活节点按新位置原地平移。
2. 为新滚入的行补建整行，为新滚入的列补建对应格。
3. 维护合并主格、窗口外溢出源、冻结带和表头的 z 序。

新建和摘除的成本与滚入/滚出的行列数相关，而不是与窗口总格数相关。单轴滚动结束后只提交一条 `band` 失效，`body` 重绘那条带（存在 `media` 时一并重绘），`ground` 与冻结角不受影响。

### 大幅跳转不退化

拖滚动条或调用 `scrollTo` 时，新旧窗口可能完全不重叠。此时仍然只处理新窗口内的行列：旧节点被批量摘除，新节点按窗口装配，每条发生变化的轴各提交一条带失效。跳转的 JS 成本主要花在窗口计算和节点装配上，不会遍历中间经过的行。

## 为什么数据量 ×10 性能几乎不变

| 成本项       | 与总行数的关系                                                                    |
| ------------ | --------------------------------------------------------------------------------- |
| 构造场景     | 只装配可视窗口；`rowOffsets` / `colOffsets` 是一次 O(行数) 的数组计算，不建行对象 |
| 首次渲染     | 只绘制可视窗口                                                                    |
| 滚动窗口计算 | 起点二分 O(log n)，终点扫描与可见行列数相关                                       |
| 滚动场景维护 | 与滚入/滚出的行列数相关                                                           |
| 单格写入     | 模型按格 O(1)，只失效该格                                                         |
| 批量写入     | 只刷新窗口内有节点的格；窗口外格在批量路径中几乎不产生绘制成本                    |
| 内存         | `records` 形态仍持有全部行对象；虚拟滚动降低的是渲染节点和绘制成本，不是数据内存  |

所以“数据量 ×10，首次渲染几乎不变”指的是渲染管线的工作量不变。构造阶段的前缀和仍然随行数增长，但它是连续数组计算，1M 行约 12ms，相比逐行创建对象和场景节点低得多。

## overscanRows 与 overscanCols

`overscanRows` / `overscanCols` 在可视窗口两侧额外预建 N 行/N 列场景节点。它们：

- 只扩大**场景装配窗口**。
- 不改变滚动边界，也不改变“哪些格算可见”的判定。
- 把快速滚动时新滚入行列的建格、文本测量成本摊到缓冲区，减少滚动帧的分配和测量。

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const columns = Array.from({ length: 20 }, (_, col) => ({ title: `列${col}`, width: 100 }))

const table = new ListTable({
  width: 1280,
  height: 720,
  columns,
  rowCount: 500_000,
  resolveDisplayValue: (col, row) => `${col}-${row}`,
  overscanRows: 6,
  overscanCols: 2,
  hostOptions: { container },
})
```

默认值：

- `ListTable` 的 `overscanRows` / `overscanCols` 缺省为 0。
- `SheetGrid` 适配层缺省为 10 行 / 4 列。

取值没有统一最优解。数值越大，滚动越平滑，但构造和窗口重建时预建的节点越多、文本测量越多。建议从几行、几列开始，用真实滚动场景测试，不要盲目设成几十行。

## batchUpdate

`batchUpdate(fn)` 把 `fn` 内的多次 `cell` 失效先收集起来，结束时合并成一条 `band` 失效，一帧内只提交一次重绘。

```ts
import { ListTable, SheetModel } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const model = new SheetModel(1_000_000, 20)

const table = new ListTable({
  width: 1280,
  height: 720,
  columns: Array.from({ length: 20 }, (_, col) => ({ title: `列${col}`, width: 100 })),
  model,
  hostOptions: { container },
})

table.batchUpdate(() => {
  for (let row = 0; row < 2000; row++) {
    table.updateCell(1, row, row * 3)
  }
})
```

注意：

- `batchUpdate` 收敛的是**失效提交**，不是数据写入量。`fn` 内的写入逻辑照常执行，只是渲染提交合并为一次。
- `fn` 必须是同步函数。异步循环放在 `fn` 外，`batchUpdate` 在 `fn` 返回时就会结束。
- `batchUpdate` 可以嵌套；只有最外层结束时才提交。
- records 形态没有 `updateCell` 回写能力。修改 `records[row][field]` 后，用 `batchUpdate(() => { ... table.refreshCell(col, row) ... })` 合并刷新。

## 模型直挂

需要编辑回写时，优先使用 `model` 形态：

- 模型按格 O(1) 读写，不需要“改一行数据就重放全量数组”。
- `table.updateCell(col, row, value)` 回写模型，并局部刷新该格。
- 模型在回写期间同步 echo 的派生格变更会由 `ModelBinding` 收集去重，一并刷新，不会形成回环。
- 外部直接修改模型并触发 `onCellChange` 时，表格也只刷新受影响的格。

```ts
import { ListTable, SheetModel } from 'infinitable'

const model = new SheetModel(1_000_000, 20)
const table = new ListTable({
  width: 1280,
  height: 720,
  columns: Array.from({ length: 20 }, (_, col) => ({ title: `列${col}`, width: 100 })),
  model,
  hostOptions: { container },
})

model.setCellValue(3, 100, '外部变更') // 经 onCellChange 局部刷新
table.updateCell(4, 100, 42) // 回写模型 + 局部刷新
```

只读展示且数据已在内存中时，`records` 数组足够；数据不在内存中时，用 `rowCount` + `resolveDisplayValue` 按格取值，避免创建海量行对象。

## 失效面积控制

失效范围从大到小是：

```text
full（整层） > band（整行/整列带） > cell（单格或小矩形）
```

优先使用 `cell`，其次 `band`，尽量避免无必要的 `full`：

- 单格写入用 `updateCell` 或 `refreshCell`，不要重建实例。
- 多个连续格写入用 `batchUpdate`，合并为一条 `band`。
- 行高、列宽、冻结数、合并区、主题变化会触发场景全量重建或整层失效，这些是低频操作，不要放进滚动帧或高频交互循环。
- 选区、滚动条、浮动对象在 `sky` 层整层重画，这是设计上的便宜路径，不需要手动优化。
- 图片/图表完成加载时只失效对应格，不要因为一张图完成而提交 `full`。

`refreshCell` 会同时失效旧文本溢出走廊和新走廊，避免文本变短时留下残影。因此单格写入的失效面积可能略大于单元格本身，这是正确性所需的成本。

## 常见性能陷阱

### 在按格 hook 里做重活

`resolveDisplayValue`、`resolveCellStyle`、`resolveCellRenderer`、`resolveCellImage` 会在滚动帧按可见格高频调用。它们必须是纯函数、同步、O(1)：

- 不要发请求、读远程数据或等待 Promise。
- 不要深拷贝行对象。
- 不要在 hook 里做未缓存的复杂格式化、正则回溯或排序。
- 不要在 `resolveCellRenderer` 里对每格重新 `measureText`、创建渐变/Path2D 或重新计算布局；文本宽度应复用引擎测量缓存，或在数据侧预先算好。
- 不要在 hook 里调用会触发全表刷新的方法。

需要异步数据时，先在外部准备好缓存，hook 只读缓存。

### 用全量数据替换代替局部更新

`ListTable` 没有增量 `setRecords` API。不要为了更新几格而重建整个 `ListTable`，也不要把 `records` 全量复制后重新构造。局部更新走：

- 模型形态：`updateCell`。
- records 形态：修改字段后 `refreshCell`。
- 批量：`batchUpdate`。

### 频繁触发 full 失效

以下操作都会重建场景或整层失效，避免在高频路径调用：

- `resize` / 改行高列宽 / 改冻结数 / 改合并区。
- `updateTheme`。
- 切换 `showColHeader` / `showRowHeader` 等构造期选项（这些应重新构造，而不是运行时改）。

如果容器尺寸由 `ResizeObserver` 驱动，加入防抖。`SheetGrid` 内部对 resize 有 100ms 尾部防抖，宿主自行接 `ListTable.resize` 时也应避免每帧调用。

### 忽略窗口外更新的语义

窗口外行列没有场景节点：

- `getCellRelativeRect` 返回 `null`。
- `refreshCell` 对窗口外格通常是空操作，除了仍作为活跃溢出源的格。

这是虚拟化的预期行为，不是数据丢失。滚回窗口时节点会按模型重新装配。不要为了“让更新生效”而强行滚动或提交 `full`。

### 图片与图表缓存预算不足

图片位图走 LRU。缓存逐出后滚回会重新加载，出现一次占位或重载闪烁。按场景调整：

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!

const table = new ListTable({
  width: 800,
  height: 600,
  columns: [{ title: '缩略图', width: 120 }],
  rowCount: 500_000,
  resolveCellImage: (_col, row) => `https://cdn.example.com/t/${row}.png`,
  imageServiceOptions: {
    maxCacheBytes: 512 * 1024 * 1024,
    maxCacheCount: 2000,
    concurrency: 16,
  },
  hostOptions: { container },
})
```

图表格的位图按“声明内容 key + 格尺寸 + DPR”缓存；内容变化会换 key，旧缓存自然失效。不要为每帧生成新的声明对象，否则插件侧的声明 memo 无法复用，滚动帧会反复解析声明。

### overscan 设置过大

`overscanRows` / `overscanCols` 过大会让每次窗口重建预建大量节点和文本测量。它只应覆盖快速滚动的一个缓冲带，不应按“多预建几屏”来配置。

## 如何复现基准

仓库根目录：

```bash
bun run test
```

该命令执行全仓测试和 headless 量化基准回归，覆盖 TTFF、滚动 FPS、失效面积、sheet、图表格等 10 个场景。

浏览器冒烟自检在 `playground` 目录：

```bash
cd playground

# 浏览器冒烟自检：构建 + preview + 页内断言，依赖全局 playwright-cli
node scripts/smoke.mjs
```

本地开发：

```bash
cd playground
bun run dev
```

打开 playground 后，左侧菜单「性能与工程 → 量化基准」为独立基准页（TTFF / 滚动 FPS / 失效面积等 10 场景，JSON 落档 `playground/results/`）；「冒烟自检」为页内端到端断言套件。与 VTable 的对比数据为历史实测采样（见仓库 README），对比管线已随多引擎架构重构移除。

基准产物写入 `playground/results/`，`bench.html` 是浏览器基准入口。

## 自查清单

出现性能问题前，先按顺序检查：

1. 按格 hook 是否做了请求、深拷贝、复杂格式化或未缓存计算。
2. 是否在滚动或高频交互中调用 `resize`、`updateTheme`、改冻结数/合并区。
3. 是否用重建 `ListTable` 代替 `updateCell` / `refreshCell`。
4. 批量写入是否包在 `batchUpdate` 里。
5. `overscanRows` / `overscanCols` 是否过大。
6. 图片/图表缓存预算是否足够，是否每帧创建新的图表声明。
7. 是否对窗口外格反复调用 `refreshCell` 并期待它产生绘制。
