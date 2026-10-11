---
'infinitable': patch
---

feat: sheet 超链接与图片能力（对齐 WPS 桌面核心体验）

- 单元格超链接全链路：sheet 模型按格存链接（URL+可选显示文本，可 undo/redo、随结构平移）；有链接格自动蓝字下划线（resolveCellStyle 可覆盖，主题 token `linkColor`）；悬停 pointer 光标 + hover/leave 事件；单击打开（`openCellLinkOnClick` 默认开、可关给宿主接管）；框选/拖选/键盘选中不误触；SheetGrid 经 `GridCellLinks` 桥自动接线，宿主零 hook
- 图片嵌入单元格：模型按格存图（字节或 URL），自动接入 media 渲染通道，随格缩放（contain 默认/fill 可选）、随行列插删平移；`insertCellImage`/`removeCellImage` 可 undo，`cell-image-change` 事件，`hasCellImage` 查询 API
- 浮动图片右键不穿透：contextmenu 优先命中浮动层，命中图片改派发 `floatObjects.onContextMenu`（带图片 id/位置），不再落到单元格菜单
- 图片超链接：`SheetImage`/嵌入图新增 `link` 字段（可 undo 写入/清除），带链接图片单击打开链接、无链接保持原选中行为
- 公共面新增 23 个类型与值导出（infinitable 主入口 + `infinitable/sheet` 子路径），快照与 agent-docs 同步；playground 新增 `hyperlink-image` 演示页
