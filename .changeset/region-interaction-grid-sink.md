---
'infinitable': minor
---

区域交互几何下沉 grid 并与浮层变换手柄几何单源收敛

**@infinitable/grid**（新增导出，均为纯函数/常量）：

- `resize-geometry`（新模块）：`ResizeEdge`（8 方向边/角词汇）与 `cursorForEdge`（方向 → 鼠标光标，对角 nwse/nesw、正边 ns/ew）。方向 → 光标语义自此单源：table 浮层变换手柄的私有光标真值表改为 `cursorForEdge(floatHandleEdge(handle))` 推导，逐字面等价（指针派发测试锁死）。
- `floatHandleEdge`：浮层 8 缩放手柄名 → 共享 8 方向边（由 `SCALE_HANDLES` 轴向符号推导，不另立真值表）；`FloatObjectLayer` 手柄命中同步改用共享 `hitSquare`。
- `region-interaction`（新模块，自 print-form-designer 纯搬运）：`regionBoundsOf`（格区间区域视口包围盒）、`regionHandleRect` + `REGION_HANDLE_SIZE`/`REGION_HANDLE_SIZE_ACTIVE`/`REGION_HANDLE_INSET`（右下角单元格内角手柄几何）、`hitRegionHandle`/`hitRegionEdge` + `REGION_EDGE_HIT_PX`（手柄/边缘热区命中）、`resizeRegionRect`（拖拽落点合入区域矩形，start ≤ end 恒成立）。模型矩形口径收敛到既有 `CellRange`，方向语义复用 `ResizeEdge`。

**动机**：print-form-designer 的数据块画布交互几何原留一份在应用实现层；且方向 → 光标知识此前在 table（浮层手柄）与 app（区域边缘）各有一份字面表。下沉后宿主构建「格区间区域」类设计器（数据块/打印区/命名区域）可直接复用，浮层手柄与区域拖拽共用同一份方向词汇。新增符号随发布入口一并转出：11 值 + 4 类型入主入口（`public-surface.test.ts` 快照同步：43→54 值 + 100→104 类型）。运行时行为零变化。
