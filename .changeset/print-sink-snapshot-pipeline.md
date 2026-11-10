---
'infinitable': minor
---

快照级打印/版面能力下沉库层：`@infinitable/sheet` 新增快照边界、快照行变换与快照打印供数；`@infinitable/plugins` 公开纸张可打印区推导；`@infinitable/render` 补命令式路径助手

**@infinitable/sheet**（新增导出，均为纯函数）：

- `snapshotContentBounds` / `clampSnapshotToBounds` / `ContentBounds`：无限画布快照的内容包围盒推导与裁剪（自 print-form-designer 的 content-bounds 下沉，原 `contentBounds` 更名）。
- `insertSnapshotRows` / `deleteSnapshotRows`：快照级静默插行/删行变换。与 `Sheet.applyStructureChange` 的命令级变换语义**有意分叉**：不平移公式引用（`f` 原文随格平移不改写）、不入 undo，见模块头注。
- `createSnapshotPrintSource` / `PrintSource`：「SheetSnapshot → 打印供数」结构化适配（cellData/effectiveStyle/displayValue 经显示链纯投影取值）。`PrintSource` 为 sheet 自有结构化类型，与 `@infinitable/plugins` 的 `PrintSource` 形状对齐、双侧注释互指。

**@infinitable/plugins**：公开 `derivePrintableArea` / `PrintableArea`（原 print 插件内部函数）——纸张预设 mm→px 与可打印区推导成为公共面，宿主侧不再复制同源常量。

**@infinitable/render**：新增 `dashedLine` / `roundRectPath` / `DashPattern` / `DashLineContext` / `RoundRectPathContext`——`RenderContext` 无 `setLineDash`/`roundRect` 场景下的命令式路径原语（窄结构化 ctx 接口，overlay painter 消费者直用）。

**动机**：print-form-designer 中这三组通用能力原先各留一份在实现层（其中纸张常量为逐字复制、靠测试锁同步）。下沉后任何 sheet 消费者（导出/打印/序列化）可直接复用；运行时行为零变化。新增符号随发布入口一并转出：`dashedLine`/`roundRectPath`/`derivePrintableArea`（+4 类型）入主入口，快照级版面/打印供数 7 符号入 `infinitable/sheet` 子路径白名单（`public-surface.test.ts` 快照同步更新：主入口 43 值 + 100 类型、`./sheet` 88 值 + 98 类型）。
