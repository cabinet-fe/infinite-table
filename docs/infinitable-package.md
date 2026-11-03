# 统一发布包（infinitable）

九个 workspace 包到 npm 的唯一出口：显式转售各层公共 API + `./sheet`、`./pivot` 子路径，vp build 整体打成自包含 dist，公开面与跨入口类身份契约由脚本守卫。代码入口 `packages/infinitable/src/index.ts`（子路径 `src/sheet.ts` / `src/pivot.ts`）。

返回 [architecture.md](./architecture.md)

## 在整体架构中的位置

仓内按 workspace 分包开发（9 包），发布时收敛为 1 个公开 npm 包——发布层漏斗：

| 包 | 仓内身份 | 发布归宿 |
| --- | --- | --- |
| `@infinitable/render` | 渲染底座 | 打进 dist 共享 engine chunk |
| `@infinitable/grid` | 共享网格内核 | 打进 dist 共享 engine chunk |
| `@infinitable/protocol` | 装配协议（纯类型） | 类型并入 dist/types/protocol，运行时零体积 |
| `@infinitable/table` | ListTable 引擎 | 打进 dist 共享 engine chunk |
| `@infinitable/formulas` | 公式引擎 | 打进 dist 共享 engine chunk |
| `@infinitable/plugins` | 官方插件（chart/print/watermark） | 静态部分随各 entry 内联；chart.js 动态分包 |
| `@infinitable/sheet` | 电子表格核心 | 经 `infinitable/sheet` 子路径整体打包 |
| `@infinitable/pivot` | 透视表引擎 | 经 `infinitable/pivot` 子路径整体打包 |
| `infinitable` | **本包** | 唯一 npm 发布物（MIT，公开） |

为什么单包发布：

- **下游安装面最小**：`npm i infinitable` 一条命令拿到全栈能力（下游 ultra-ui 等自用产品不必逐层拼 8 个包），`@infinitable/*` 语义版本协调问题整体消失。
- **内部包保持私有**：分包只为仓内构建边界与依赖方向治理（见各包 docs），对外不承诺独立版本；`private: true`、版本恒 0.0.0、不发。
- **发布包不被仓内消费**：playground 直接依赖 `@infinitable/*` 子包（其 exports 带 `dev` 条件 → `./src/index.ts`，`vp dev` 走 dev 条件直接吃源码，HMR 不经构建）；`infinitable` 本体 exports 只有 `types`/`import` 两条件，纯粹为 npm 消费存在，playground 不消费它的 dist。

## 入口与子路径解剖

`package.json` exports 全貌（ESM only，`type: module`，`sideEffects: false`，无 main/module 字段）：

| 子路径 | types | import | 转售来源 |
| --- | --- | --- | --- |
| `.`（主入口） | `./dist/types/index.d.ts` | `./dist/infinitable.js` | 六层显式具名转售（见下表） |
| `./sheet` | `./dist/types/sheet.d.ts` | `./dist/sheet.js` | `@infinitable/sheet` 白名单全量 |
| `./pivot` | `./dist/types/pivot.d.ts` | `./dist/pivot.js` | `@infinitable/pivot` 白名单全量 |

`files: ["dist/*.js", "dist/types", "!dist/types/.tsbuildinfo"]`——JS 产物含 entry 三件 + engine/chart 分包 chunk，类型树整体带上；`dist/types-tests` 等其余产物不进 npm。

### 主入口转售面（src/index.ts）

显式具名导出，禁止星号转售；每个子包各自的 `src/index.ts` 已按同一判据收敛，本入口只转售不放大：

| 分组 | 值导出 | 类型导出（节选） |
| --- | --- | --- |
| render（渲染引擎） | `createRenderHost`、`SceneNode` | `RenderHost`、`RenderContext`、`LayerHandle`、`LayerKind`、`Invalidation`、`Region`、`Size`、`SceneEvent*`、`FrameTask` 等 16 个 |
| grid（网格内核） | `MergeCellMap`、`MergeOverlapError`、`extendsTheme`、`normalizeCellRange`、`normalizeRange`、`sanitizeMerges`、`warnMergeConflicts` | `CellRange`、`CellStyle`、`TableTheme`、`ThemeOverride`、`SelectionSnapshot`、`FloatObject*`、`ScrollbarOptions`/`ScrollbarMode` 等 17 个 |
| protocol（装配协议） | （纯类型零运行时） | `EngineAssembly`、`EnginePlugin`、`EngineReadView`、`OverlayPainter`、`UnderlayPainter`、`CellChangeEvent` |
| table（表格主体） | `ListTable`、`SheetModel`、`EditorRegistry`、`projectCellStyle` | `ListTableOptions`、`ColumnDefine`、`DataRecord`、`TableModel`、`TableEngine`、`CanvasDocSource`、`CellRenderer`、`ResolveDisplayValue` 等 20 个 |
| formulas（公式引擎） | `evaluate`、`parseFormula`、`DependencyGraph`、`registerFormulaFunction`、`listFormulaFunctions`、`parseCellRef`/`formatCellRef`、`shiftFormulaRefs` 等 23 个 | `AstNode`、`FormulaResolver`、`FormulaFunction*`、`RangeRef`、`ScalarValue` 等 15 个 |
| plugins（官方插件） | `createChartPlugin`、`createWatermarkPlugin`、`createPrintPlugin`、`createEnginePrintSource` | `ChartSpec*`、`ChartPluginOptions`、`PrintConfig`、`PrintSource`、`WatermarkHandle`、`WatermarkTextConfig` 等 22 个 |

同名消歧：grid 的格坐标 `CellRef` 与 formulas 的 A1 引用 `CellRef` 同名——A1 引用保留原名（配 `parseCellRef`/`formatCellRef`/`createRangeRef`），格坐标以 `GridCellRef` 别名导出。README 对外叙事按「五层能力」（table 含装配协议）口径。

### 子路径入口

- `src/sheet.ts`：具名转出 `@infinitable/sheet` 全部公共 API（模型 `Workbook`/`Sheet`/`CellStore`、命令族 `SetCellValueCommand` 等、`FormulaEngine`/`HistoryManager`、IO `exportWorkbookXlsx`/`importXlsx`/`exportSheetCsv`/`importCsv`、适配 `SheetGrid`，约 180 项）。公式引擎 API 不在此转售（需要时从主入口拿），本子路径只覆盖电子表格核心。
- `src/pivot.ts`：具名转出 `@infinitable/pivot` 全部公共 API（`PivotGrid`、`PivotModel`、4 个冒烟锚点常量 + 8 个类型）。

## 打包策略走读

构建命令 `vp build`（vite-plus 1.4.0 CLI），配置 `packages/infinitable/vite.config.ts`：

```ts
lib: { entry: { infinitable: 'src/index.ts', sheet: 'src/sheet.ts', pivot: 'src/pivot.ts' }, formats: ['es'] },
rollupOptions: {
  external: [/^@cat-kit\//],
  output: { manualChunks(id) { return /[\\/]packages[\\/](render|grid|table|formulas)[\\/]dist[\\/]/.test(id) ? 'engine' : undefined } },
}
```

要点：

- **`@infinitable/*` 不外部化**：入口吃各内部包 `import` 条件的 dist 产物（`vp build` 前置 8 内部包构建完成），整体打进本包产物——对外零 `@infinitable/*` 运行时依赖。
- **共享 engine chunk 钉死单副本**：render/grid/table/formulas 四包 dist 经 `manualChunks` 按路径钉进单一具名 `engine` chunk（不依赖 Rollup 自动分组的偶然行为）。主入口与 `./sheet`、`./pivot` 三个 entry 共同消费同一份引擎类实现——若引擎被打进各 entry，`infinitable/sheet` 里 `SheetGrid` 内部 `new` 的 ListTable 与主入口导出的 `ListTable` 会是两个类，`engine instanceof ListTable` 恒 false。钉单 chunk 后跨入口 `instanceof` 必然成立，由 `scripts/check-package-exports.mjs` 第 8 条守卫回归。仅单入口可达的模块（plugins 静态部分、pivot 领域状态机）不落 engine chunk，随所属 entry 内联。
- **chart.js 保持动态分包**：plugins 内唯一触碰 chart.js 的文件是 `src/chart/chart-loader.ts` 的动态 `import('chart.js')`，构建出独立 `chart-<hash>.js` chunk，主产物仅以 `import()` 引用；未启用图表插件的宿主不触发加载。`packages/plugins` 构建链最后一步 `scripts/assert-chart-chunk.mjs` 双向断言：主产物不得含 chart.js 特征串（`beforeInit` 生命周期钩子名字面量），且动态分包里必须找到它。
- **`@cat-kit/core` 外部化**：`external: [/^@cat-kit\//]` + `peerDependencies: { "@cat-kit/core": "^1.2.1" }`——消费方自装一份（formulas 精确计算 `0.1+0.2 === 0.3` 用它）。其余第三方依赖整体内联：chart.js 随动态 chunk、hucre（sheet 的 xlsx IO）打进 sheet.js——npm 消费者唯一运行时依赖就是 `@cat-kit/core`。

实际 dist 产物（一次构建的实测清单，体积量级供参考）：

| 产物 | 内容 | 量级 |
| --- | --- | --- |
| `infinitable.js` | 主入口壳（转售 + plugins 静态部分） | ~28KB |
| `sheet.js` | ./sheet 入口（含 hucre xlsx IO） | ~460KB |
| `pivot.js` | ./pivot 入口 | ~19KB |
| `engine-<hash>.js` | 共享引擎 chunk（render+grid+table+formulas） | ~200KB |
| `chart-<hash>.js` | chart.js 动态分包 | ~260KB |
| `types/` | 类型树（8 内部包 + 3 垫片） | — |

体积口径（README 对外承诺）：最小构建（主入口 + engine chunk，不含 sheet/chart）minified 230.1KB、gzip **61.4KB**；对照 VTable 1.26.8 同场景 2076.3KB / 514.8KB。

## 类型装配（scripts/build-types.mjs）

`vp build` 只出 JS，类型树由 `node scripts/build-types.mjs` 装配（前置：8 内部包与本体 vp build 完成）。三步：

1. **复制**：8 个内部包的 `dist/types` 树逐包复制为 `dist/types/<pkg>/`（剥 `.tsbuildinfo`）。
2. **改写跨包说明符**：遍历全部 `.d.ts`，把 `from/import` 语句里的 `@infinitable/*` 裸说明符改写为 dist/types 内相对路径——公共入口指向 `<pkg>/index.js`，深路径（`<pkg>/src/<module>`）指向 `<pkg>/<module>.js`，一律按 `.js` 写出、TS 按 `.d.ts` 解析。只匹配 from/import 上下文，注释文字提及不算。
3. **生成入口垫片**：`src/index.ts` / `src/sheet.ts` / `src/pivot.ts` 三个入口都是纯 re-export（无本地声明），直接取源文本做同口径说明符改写，落成根 `index.d.ts` / `sheet.d.ts` / `pivot.d.ts`——dist 类型面与 src 显式导出面恒一致（外部 TS 用户类型可见面 == 运行时面）。

exports 条件各归其位：

| 条件 | 内部包（`@infinitable/*`） | 发布包（`infinitable`） |
| --- | --- | --- |
| `types` | `./dist/types/index.d.ts` | `./dist/types/{index,sheet,pivot}.d.ts`（垫片） |
| `dev` | `./src/index.ts`（仓内 playground/dev 直吃源码） | **无此条件**（发布包不被仓内消费） |
| `import` | `./dist/<pkg>.js` | `./dist/{infinitable,sheet,pivot}.js` |

## 守卫契约

### scripts/check-package-exports.mjs（空项目消费冒烟，根 `bun run check:exports`）

以外部消费者姿态（无 dev 条件 → import → dist；happy-dom 无头 DOM 垫片）逐项校验，CI 发布前必跑：

| # | 守什么 | 怎么守 |
| --- | --- | --- |
| 1 | 产物齐备 | 9 包各校验 `dist/<pkg>.js` + `dist/types/index.d.ts` 存在 |
| 2 | dist 可消费 | 无头 `createRenderHost`（注入假画布/帧调度）+ `new ListTable` → 提交 full 失效 → flush 帧 → `getCellText(0,0)` 取值正确 |
| 3 | plugins 插件工厂 | `createChartPlugin`/`createWatermarkPlugin`/`createPrintPlugin` 均为函数；`createSheetPlugin` 不应存在（sheet 已独立成包） |
| 4 | formulas 求值 | `evaluate('0.1+0.2')` 严格等于 0.3（@cat-kit/core 精确计算）；内置函数 ≥47 个 |
| 5 | 发布包自包含 | `dist/infinitable.js` 源文本无 `@infinitable/` 残留；`dist/types/**/*.d.ts` 无 from/import 裸说明符残留 |
| 6 | `./sheet` 子路径 | 无头 `new Workbook()` → `setCellValue` + `setCellFormula('=A1*2')` → 求值得 42；`sheet.d.ts` 垫片存在 |
| 7 | `./pivot` 子路径 | 无头 `new PivotGrid(...)` 交叉聚合，总计 `sum=10`；`pivot.d.ts` 垫片存在 |
| 8 | **跨入口 instanceof 契约** | 结构面：`dist/engine-*.js` 恰有 1 份且三个 entry 源文本都消费它；运行面：sheet 侧 `SheetGrid` / pivot 侧 `PivotGrid` 取出内部引擎，对主入口 `ListTable`/`MergeCellMap`/`MergeOverlapError` 逐一 `instanceof` |

### tests/public-surface.test.ts（公开面冻结）

防 API 漏售/私售的快照测试（vitest，`vp test run` 覆盖）：

- 三个入口（`./`、`./sheet`、`./pivot`）的**值导出集合**走运行时命名空间 `Object.keys` 断言，与显式快照数组逐一相等——增删任何导出必须显式改快照。
- **类型导出**运行时不可见，用源码解析断言（解析 `export { }` / `export type { }` 块，`as` 取对外名），并以「解析值导出 == 运行时 keys」交叉校验解析器不脱靶。
- 每个入口单独断言源码不含 `export *`（星号转售禁令——防内部实现经星号泄漏成事实 API）。

## 示例集

以下示例的每个导出名均与 `src/index.ts` / `src/sheet.ts` / `src/pivot.ts` 核对；命令与 README、CI 对齐。

### 1. 安装与最小 ListTable

```bash
npm i infinitable
# peerDependency：@cat-kit/core ^1.2.1（npm 7+ 自动安装，其它包管理器显式装）
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
table.destroy() // 卸载时
```

### 2. 数据三形态与模型直挂

`records` 数组 / `model`（TableModel 直挂，按格 O(1) 读写）/ `rowCount + resolveDisplayValue` 钩子：

```ts
import { ListTable, SheetModel, createRenderHost } from 'infinitable'

const model = new SheetModel([['季度', '营收'], ['Q1', 1200], ['Q2', 1800]])
const table = new ListTable({
  width: 640, height: 320, host: createRenderHost({ width: 640, height: 320, container }),
  columns: [{ title: 'A', width: 120 }, { title: 'B', width: 120 }],
  model, // 开箱可编辑，写值同步通知引擎增量失效
})
model.setCellValue(1, 1, 2000) // 直接改模型，视口内格自动重绘
```

### 3. `infinitable/sheet` 子路径（建模 + 公式 + xlsx 导出）

```ts
import { Workbook, exportWorkbookXlsx } from 'infinitable/sheet'

const workbook = new Workbook()
const sheet = workbook.activeSheet
sheet.setCellValue({ row: 0, col: 0 }, 21)
sheet.setCellFormula({ row: 0, col: 1 }, '=A1*2')
sheet.getCellData({ row: 0, col: 1 }) // { v: 42, ... }

// xlsx 导出（hucre 已打进 sheet.js，无需额外依赖）
const bytes: Uint8Array = await exportWorkbookXlsx(workbook)
const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
// 挂 <a download> 或 URL.createObjectURL 下载
```

表格组件装配用 `SheetGrid`（经装配协议消费 table 引擎）：

```ts
import { SheetGrid } from 'infinitable/sheet'

const grid = new SheetGrid({ sheet, container, width: 800, height: 480 })
// grid.getTable() 取内部 ListTable 引擎（见示例 8 的 instanceof 契约）
```

### 4. `infinitable/pivot` 子路径

```ts
import { PivotGrid } from 'infinitable/pivot'

const pivot = new PivotGrid({
  container,
  dimensions: [
    { key: 'status', title: '状态', width: 120 },
    { key: 'priority', title: '优先级', width: 100 },
  ],
  measures: [{ key: 'amount', title: '金额和', field: 'amount', agg: 'sum', width: 120 }],
  records: [
    { status: '已完成', priority: '中', amount: 1 },
    { status: '待启动', priority: '低', amount: 4 },
    // ...
  ],
})
pivot.getRecordCount()   // 数据行数
pivot.getCellValue(2, 5) // 总计行聚合值
```

### 5. 挂官方插件（watermark / chart / print，均从主入口导入）

```ts
import {
  createWatermarkPlugin, createChartPlugin, createPrintPlugin, createEnginePrintSource,
  ListTable, createRenderHost, type ChartCellDeclaration,
} from 'infinitable'

// 水印：协议插件，任意引擎（ListTable/PivotGrid）可挂，运行时可 updateConfig
const watermark = createWatermarkPlugin({ enabled: true, text: '内部资料' })

// 图表：resolveCellChart 按格出声明；chart.js 按需动态加载，不启用不下载
const chart = createChartPlugin({
  resolveCellChart: (col, row): ChartCellDeclaration | null =>
    col === 1 ? { type: 'bar', labels: ['Q1', 'Q2'], datasets: [{ label: '销量', data: [12, 26] }] } : null,
})

const table = new ListTable({
  width: 800, height: 480,
  host: createRenderHost({ width: 800, height: 480, container }),
  columns: [{ title: '指标', width: 160 }, { title: '图表', width: 320 }],
  rowCount: 10,
  resolveDisplayValue: (col, row) => (col === 0 ? `指标-${row}` : ''),
  plugins: [watermark, chart], // 构造期挂载；运行时也可 table.use(plugin)
})

// 打印：createEnginePrintSource 从引擎导出读取面直接适配，无需手写 PrintSource
const printer = createPrintPlugin({ source: createEnginePrintSource(table, { name: '销售明细' }) })
table.use(printer)
printer.print() // 隐藏 iframe 装载分页文档 → 调起浏览器打印
```

### 6. 主题定制

```ts
import { ListTable, createRenderHost, extendsTheme, type TableTheme, type ThemeOverride } from 'infinitable'

// 构造期：ThemeOverride 深覆盖默认主题（未给的 token 继承）
const table = new ListTable({
  /* 同上 */
  theme: { header: { background: '#1f2937', color: '#f9fafb' }, rowHeight: 40, linkColor: '#2563eb' },
})

// 运行时：updateTheme 以当前生效主题为 base 累积覆盖，自动重建场景并整层失效
table.updateTheme({ body: { color: '#374151' } })

// 独立派生主题对象（跨实例共享 token 时）
const dark: TableTheme = extendsTheme({ underlayBackgroundColor: '#111827' })
table.getTheme() // 读当前生效主题
```

### 7. SSR / 无头测试环境（bun、vitest）

引擎构造与出图不依赖真实浏览器 DOM：`ListTableOptions.doc` 接受 `CanvasDocSource`（`createElement('canvas')` 最小面）注入替身；无头冒烟的正典形态即 `scripts/check-package-exports.mjs` 的做法——happy-dom 垫 `window`/`document`/`ResizeObserver`，画布 2d 上下文给 null（引擎各消费点容忍），注入式帧调度手动 flush：

```ts
// vitest / bun 无头：不装真实 canvas 也能建表、失效、取值（happy-dom 为根 devDependency）
import { Window } from 'happy-dom'
import { ListTable, createRenderHost } from 'infinitable'

// SheetGrid/PivotGrid 构造才需要 DOM 垫片；纯 ListTable 只需注入式画布与帧调度
const domWindow = new Window({ url: 'http://localhost/' })
globalThis.document = domWindow.document
if (typeof domWindow.ResizeObserver === 'function') globalThis.ResizeObserver = domWindow.ResizeObserver

const scheduled: Array<() => void> = []
const host = createRenderHost({
  width: 400, height: 200,
  createCanvas: () => ({ width: 0, height: 0, getContext: () => null }), // 假画布
  scheduleFrame: (cb) => { scheduled.push(cb); return scheduled.length },
  cancelFrame: () => {},
})
const table = new ListTable({ width: 400, height: 200, host, columns: [{ field: 'name' }], records: [{ name: 'r0' }] })
table.host.submitInvalidation('body', { type: 'full' })
for (const task of scheduled.splice(0)) task() // flush 一帧
table.getCellText(0, 0) // 'r0'
```

SSR（Node 无 `document`）另加 `doc: { createElement: () => stubCanvas }` 注入文档源替身即可构造并出图。

### 8. 跨入口 instanceof 一致性（共享 engine chunk 的存在理由）

下游常从主入口拿 `ListTable` 做类型判断、从子路径拿领域组件——两处必须看到同一个类：

```ts
import { ListTable, MergeCellMap, MergeOverlapError } from 'infinitable'
import { SheetGrid, Workbook } from 'infinitable/sheet'
import { PivotGrid } from 'infinitable/pivot'

const grid = new SheetGrid({ sheet: new Workbook().activeSheet, container, width: 400, height: 300 })
grid.getTable() instanceof ListTable          // true：sheet 内部 new 的引擎与主入口导出是同一类（单 engine chunk）
grid.getTable().mergeCells instanceof MergeCellMap // true

try {
  grid.getTable().setMergeCells([{ startCol: 0, startRow: 0, endCol: 2, endRow: 2 }])
  grid.getTable().addMergeCell({ startCol: 1, startRow: 1, endCol: 3, endRow: 3 }) // 重叠合并 fail-fast
} catch (error) {
  error instanceof MergeOverlapError // true：若引擎副本分裂，这里恒 false
}
```

该契约由构建配置（`manualChunks` 钉 `engine` chunk）+ `check-package-exports.mjs` 第 8 条（结构面 + 运行面）双重守卫。

### 9. 版本升级与 changeset 消费视角

版本流由 changesets 驱动（见下节），下游视角：CHANGELOG 逐版本列出 commit 级变更（如 `0.3.1` 的「feat(print): 横向分页、rowRange/colRange、自定义百分比缩放」）；minor 含新能力、patch 为修复，`0.3.0` 这类公共面收缩（移除从未实现的 API）也会以 minor + 说明明示。升级即常规 semver：

```bash
npm i infinitable@latest        # 跟最新
npm i infinitable@0.3           # 锁 0.3.x
npm view infinitable versions   # 查已发布版本（CI 幂等发布，无空版本）
```

## 发版流程走读（内部流程视角）

> 本节是仓库内部发版流程（`.agents/skills/release` 技能 + `scripts/release.ts` + `.github/workflows/release.yml`）的文档化走读；规范 A：公开 npm，一切 publish 由 CI 完成，本地只准备并触发。

本地（发版分支 main）：

1. 前置：`git status --porcelain` 干净、在 main、`git pull --ff-only` 不落后。
2. 确认待处理 changeset `ls .changeset/*.md`；没有就手写（不跑交互式 CLI）并 commit `chore: add changeset`：

   ```markdown
   ---
   "infinitable": patch
   ---

   fix: 修复 xxx
   ```

3. `bun run release`（= `bun run scripts/release.ts`）四阶段：前置检查 → `changeset version` + `bun install` → commit（`chore(release): publish infinitable`，暂存 `.changeset`/`packages`/`package.json`/`bun.lock`）→ push。`--dry-run` 到 version 后回滚不提交，`--force` 跳过分支检查。

远端 CI（release.yml，由 push main 触碰 `packages/*/CHANGELOG.md` 自动触发，亦可 workflow_dispatch；仅允许 main）：

| 步骤 | 内容 |
| --- | --- |
| 1 | bun 1.4.2 + `bun install --frozen-lockfile` |
| 2 | `bun run build`（tsc -b + 全部 `packages/*` vp build，含 build-types.mjs 类型装配与 assert-chart-chunk） |
| 3 | `bun run check:exports`（上表 8 条守卫） |
| 4 | Node 24 + 固定 npm@11（trusted publishing 需 ≥11.5.1；npm 12 改了 `npm info --json` 输出结构，changesets 2.31 解析不了） |
| 5 | `scripts/release/normalize-manifest.ts` 剥离 devDependencies（全是 `workspace:*` 内部包，无法发布；dist 已自包含。CI 专用临时改动，不落库） |
| 6 | `changesets/action@v1` → `bun run changeset publish`：npm OIDC trusted publishing 免 token（id-token: write + npmjs.com Trusted Publisher 配置），`NPM_CONFIG_PROVENANCE=true` 带 provenance |
| 7 | 推送 `refs/tags/infinitable@*` 版本 tag（不依赖 action 的 published 输出——该输出在 changesets v3 下恒 false） |

幂等：changeset publish 对已在 registry 的同名同版本自动跳过，同 commit 重跑安全。changesets 配置（`.changeset/config.json`）：access public、baseBranch main、commit false、updateInternalDependencies patch。

## 边界与红线

- **唯一发布物**：只有 `infinitable` 公开发布；8 个 `@infinitable/*` 子包与 playground、website 均 private 不发，版本恒 0.0.0。
- **公开面即红线文档面**：主入口与两个子路径的导出符号集合被 `public-surface.test.ts` 快照冻结——增删导出必须显式改快照；禁止 `export *`；判据为「稳定公共 API（类型/配置/注册函数/插件接口/插件工厂）导出，内部实现细节、实验性 API、跨层内部工具不导出」，全量清单见 `agent-docs/apis/exports.md`。
- **自包含红线**：dist JS 与类型树不得残留任何 `@infinitable/*` 说明符（check 5）；跨入口 instanceof 契约不得回退（check 8）；chart.js 不得静态混入主产物（assert-chart-chunk）。
- **playground 不消费 dist**：仓内一律走子包 `dev` 条件吃源码；发布包 dist 只属于 npm 消费者，`check-package-exports.mjs` 是唯一合法的「外部消费者姿态」试用入口。
- **发版红线**：禁止本地 `npm publish`、禁止推 `v*` tag 触发发版（旧路径已作废，tag 形态为 `infinitable@X.Y.Z`）、禁止 watch CI、禁止交互式 changeset CLI；normalize-manifest.ts 勿在本地跑（误跑 `git restore` 恢复）。
- 主题、协议、公式等各层行为契约分别见 [render-engine.md](./render-engine.md)、[grid-kernel.md](./grid-kernel.md)、[engine-assembly-protocol.md](./engine-assembly-protocol.md)、[list-table-engine.md](./list-table-engine.md)、[formulas.md](./formulas.md)、[pivot-engine.md](./pivot-engine.md)、[sheet.md](./sheet.md)；插件接口红线见 [plugin-interface-map.md](./plugin-interface-map.md)。
