# infinitable

高性能 canvas 表格引擎：多层 canvas 失效驱动渲染 + 全量虚拟滚动，为替代 [VisActor VTable](https://github.com/VisActor/VTable) 而生。10 万到 100 万行数据下，首次渲染、滚动与写入性能不随数据量劣化，最小构建 gzip 体积仅 **27KB**。

单包发布（本包），内含五层能力：表格主体（core）、自研 canvas 渲染引擎（render）、官方插件集（plugins：图表/打印/水印）、电子表格核心（sheet：模型/命令/IO/SheetGrid 适配，经 `infinitable/sheet` 子路径导出）、公式引擎（formulas）。chart.js 等重组件按需动态分包，不进主产物。

## 安装

```bash
npm i infinitable
```

## 快速开始

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

数据三形态任选：`records` 数组 / `model`（如 `SheetStore.asModel()` 模型直挂，按格 O(1) 读写）/ `rowCount` + `resolveDisplayValue` 钩子。

## 核心特性

- **虚拟窗口 O(1)**：构造与首次渲染只处理可视区，数据量 ×10 指标几乎不变（100 万行 TTFF 16.7ms）。
- **多层 canvas + 区域失效**：ground/body/media/sky 四层画布，滚动收敛为单条 band 失效，无全量重绘路径；拖滚动条大幅跳转不退化。
- **模型直挂**：`SheetStore.asModel()` 按格 O(1) 读写，免「批量写全量 setRecords 重放」绕法；`batchUpdate` 大块写收敛单次失效。
- **Excel 式交互**：选区/填充/hover/行列 resize/键盘导航/触控惯性滚动/编辑器注册表/冻结/合并单元格。
- **图表格位图路由**：Chart.js 离屏出图经 cell 级 MediaCache LRU blit 上屏，滚动滚回命中直贴无闪。
- **公式引擎**：A1 解析/Pratt 求值/内置函数/依赖图增量重算，四则与聚合走精确计算（`0.1+0.2 === 0.3`）。

## 性能对比：infinitable vs @visactor/vtable

同一页面、同一数据（10 万 / 100 万行 × 20 列）、同视口，对称跑序取均值：

| 口径     | infinitable | VTable 1.26.8 |
| -------- | ----------- | ------------- |
| minified | **93.8KB**  | 2076.3KB      |
| gzip     | **27.3KB**  | 514.8KB       |

完整 20 项指标（TTFF/滚动 FPS/写入吞吐/整表重建，17/22 项领先 0 项落后）见 [仓库 README](https://github.com/cabinet-fe/infinite-table)。

## License

MIT
