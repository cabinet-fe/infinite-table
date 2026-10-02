# infinitable

高性能 canvas 表格引擎：多层 canvas 失效驱动渲染 + 全量虚拟滚动，为替代 [VisActor VTable](https://github.com/VisActor/VTable) 而生。10 万到 100 万行数据下，首次渲染、滚动与写入性能不随数据量劣化，最小构建 gzip 体积仅 **27KB**。

## 核心特性

- **虚拟窗口 O(1)**：构造与首次渲染只处理可视区，数据量 ×10 指标几乎不变（100 万行 TTFF 16.7ms）。
- **多层 canvas + 区域失效**：ground/body/media/sky 四层画布，滚动收敛为单条 band 失效，无全量重绘路径；拖滚动条大幅跳转不退化。
- **模型直挂**：`SheetStore.asModel()` 按格 O(1) 读写，免「批量写全量 setRecords 重放」绕法；`batchUpdate` 大块写收敛单次失效。
- **Excel 式交互**：选区/填充/hover/行列 resize（Excel 口径光标）/键盘导航/触控惯性滚动/编辑器注册表/冻结/合并单元格。
- **图表格位图路由**：Chart.js 离屏出图经 cell 级 MediaCache LRU blit 上屏，滚动滚回命中直贴无闪。
- **插件体系**：sheet（SheetBook 多表实例池）、图表、填充、undo 等以插件挂载。

## 性能对比：infinitable vs @visactor/vtable

同一页面、同一数据（10 万 / 100 万行 × 20 列）、同视口（1280×720、行高 32、列宽 100、无冻结、双方默认主题、公开 API 直调）。每个规模按 `[本仓, VTable, VTable, 本仓]` 对称跑序各 2 轮取均值。「快 N×」= VTable 耗时 / 本仓耗时（吞吐类反之），±5% 内记持平。

### 最小构建体积

| 口径     | infinitable | VTable 1.26.8 | 对比         |
| -------- | ----------- | ------------- | ------------ |
| minified | **93.8KB**  | 2076.3KB      | **快 22.1×** |
| gzip     | **27.3KB**  | 514.8KB       | **快 18.9×** |

最小渲染面入口（`ListTable` + `createRenderHost`），bun build `--minify --target=browser` 产物实测；gzip 按产物文件分别压缩求和。

### 10 万行 × 20 列（领先 8 / 10 项）

| 指标                     | infinitable    | VTable     | 对比     |
| ------------------------ | -------------- | ---------- | -------- |
| 构造耗时 P50             | **1.70ms**     | 26.85ms    | 快 15.8× |
| 单次大幅跳转 JS 耗时 P95 | **1.45ms**     | 11.10ms    | 快 7.7×  |
| 逐格写吞吐               | **316 ops/ms** | 127 ops/ms | 快 2.5×  |
| 首次渲染时间（TTFF）P50  | **17.15ms**    | 29.90ms    | 快 1.7×  |
| 整表重建（构造 + 首帧）  | **18.00ms**    | 27.82ms    | 快 1.6×  |
| 滚动调用 JS 耗时 P95     | **0.80ms**     | 1.05ms     | 快 1.3×  |
| 批量写 2000 格           | **16.10ms**    | 18.05ms    | 快 1.1×  |
| 滚动帧间隔 P95           | **17.15ms**    | 18.25ms    | 快 1.1×  |
| 稳态滚动 FPS             | 60.0           | 60.0       | 持平     |
| 快速拖滚动条 FPS         | 60.1           | 59.5       | 持平     |

### 100 万行 × 20 列（领先 7 / 10 项）

| 指标                     | infinitable    | VTable     | 对比    |
| ------------------------ | -------------- | ---------- | ------- |
| 单次大幅跳转 JS 耗时 P95 | **1.25ms**     | 10.25ms    | 快 8.2× |
| 构造耗时 P50             | **12.00ms**    | 42.30ms    | 快 3.5× |
| 逐格写吞吐               | **360 ops/ms** | 144 ops/ms | 快 2.5× |
| 首次渲染时间（TTFF）P50  | **16.70ms**    | 44.70ms    | 快 2.7× |
| 整表重建（构造 + 首帧）  | **17.27ms**    | 45.30ms    | 快 2.6× |
| 滚动调用 JS 耗时 P95     | **0.85ms**     | 1.00ms     | 快 1.2× |
| 滚动帧间隔 P95           | **17.30ms**    | 18.20ms    | 快 1.1× |
| 稳态滚动 FPS             | 60.0           | 60.0       | 持平    |
| 快速拖滚动条 FPS         | 60.2           | 60.4       | 持平    |
| 批量写 2000 格           | 16.10ms        | 16.85ms    | 持平    |

### 关键结论

- **全量合计 17 / 22 项领先、0 项落后**（另 5 项持平）。
- **数据量 ×10，首次渲染与整表重建几乎不变**（TTFF 17.15 → 16.70ms、重建 18.0 → 17.3ms），VTable 从 29.9ms 劣化到 44.7ms（+50%）、重建 27.8 → 45.3ms——规模越大优势越大。
- **体积差一个数量级**：gzip 27KB vs 515KB（1/19）。
- FPS 持平项为测试机（Apple Silicon Chrome）上两库均满帧的真实反映；帧预算敏感场景（低端机、大步长滚动）的差距体现在「滚动调用 JS 耗时」与「跳转 JS 耗时」上。

> 采样环境：macOS（Apple Silicon）Chrome headless · VTable 1.26.8 · 本仓 git `21c6a25` · 2026-09-28。完整可分发报告与 JSON 基线见 `playground/results/`。

## 复现基准

```bash
bun run test             # 全仓测试 + 量化基准回归（headless）：TTFF / 滚动 FPS / 失效面积 / sheet / 图表格 10 场景防回归
node scripts/smoke.mjs   # 浏览器冒烟自检（playground 下：构建 + preview + 页内断言；依赖全局 playwright-cli）
node scripts/vs.mjs      # vs-vtable 全量对比（playground 下：headless 驱动）：体积 + 10 万/100 万行双规模，产出静态 HTML/JSON 报告
```

playground 本地开发：`cd playground && bun run dev`（示例 + 页内「vs VTable 对比」按钮即跑 + 总览）。页内对比：左侧菜单「性能 → vs VTable 对比」，点击「运行对比」即在当前页面交替渲染两库并输出逐指标报告（与 `node scripts/vs.mjs` 同口径同跑序）。

## 快速开始

```bash
bun add infinitable
```

```ts
import { ListTable, createRenderHost } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const host = createRenderHost({ width: 1280, height: 720, container })

const table = new ListTable({
  width: 1280,
  height: 720,
  host,
  columns: [
    { field: 'name', title: '名称', width: 160 },
    { field: 'score', title: '分数', width: 100 },
  ],
  records: Array.from({ length: 100_000 }, (_, i) => ({ name: `行 ${i}`, score: i })),
})
```

数据三形态任选：`records` 数组 / `model`（如 `SheetStore.asModel()` 模型直挂）/ `rowCount` + `resolveDisplayValue` 钩子。交互接线（滚轮 `scrollBy`、编辑器、主题派生）与万行级完整示例见 `playground`。

## 仓库结构

```
packages/    core（表格主体）· render（canvas 渲染引擎）· plugins（sheet/图表/填充/undo）· formulas（公式引擎）· infinitable（统一发布包，单包 re-export 四层）
playground/  唯一应用：示例总览（显示/交互/编辑/sheet/报表/图表/图片）+ 页内 vs VTable 对比 + 量化基准（bench.html）+ 冒烟自检
```

## 开发

```bash
bun install
bun run build       # tsc -b（d.ts 产物）+ 各包 vite 库构建
bun run test        # vitest（含 headless 量化基准回归，一律吃 workspace 源码）
bun run check       # vp check：oxfmt + oxlint + tsgolint 类型检查三合一
bun run lint        # vp lint + core 依赖检查
```

MIT License。
