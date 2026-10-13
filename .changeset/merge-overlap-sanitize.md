---
'infinitable': minor
---

合并区重叠不再打断渲染：脏合并区（历史模板/外部导入/程序化拼装）在批量数据入口自动规范化——保留先声明区间、丢弃冲突项并 console 提示，不再以未捕获异常打断网格重建与快照恢复

- 新增类型化错误 `MergeOverlapError`：`MergeCellMap` 构造与 `addMergeCell`（程序化单命令 fail-fast 层）重叠时抛出，携带冲突坐标与两条冲突区间原文，宿主可 `instanceof` 定位
- 新增 `sanitizeMerges(ranges)` 纯函数导出：与 `MergeCellMap` 同一套归一化语义，宿主可在写快照前自救脏数据；`ListTable` 构造参数与 `setMergeCells` 内部同源消解（附带 `warnMergeConflicts` 与 `MergeConflict`/`SanitizedMerges` 类型导出）
- sheet 快照恢复（`restore` / `restoreContent`，含 RestoreSheetCommand 与 undo/redo 回放）对重叠合并区先规范化再入模型，脏快照的单条重叠不再污染合并索引
- 行为变更：`setMergeCells` 重叠不再抛错（改为规范化 + warning）；模型越界校验不变仍抛错保持原状
