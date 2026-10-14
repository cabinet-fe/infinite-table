---
'infinitable': minor
---

chore: 清理死代码与迁移遗留，公共面收缩——主入口移除从未实现的 print 浮动图类型 `PrintImagePayload`（`PrintSource.images`/`imageData` 字段随删：收数口存在但渲染链路从未实现，声明即撒谎）；`./sheet` 子路径移除零调用的模型方法（`MergeManager.merge/unmerge/isMerged/isCovered`、`CellMetaStore.delete/has/entries`、`SelectionModel.clear`、`CellStore.setCellValue/peekEntries`、`Sheet.entriesCellMeta`，均为 sheet 自 plugins 迁入后失去消费方的旧 handle 面），并补齐 `SelectionInterceptMeta` 类型转出（`@infinitable/sheet` 已导出而 `./sheet` 快照漏转，两包面对齐）。其余为包内死代码删除与重复实现收敛（core 等行高旧布局三函数、formulas 词法原语收敛 lexicon.ts、playground 孤儿组件与未用依赖），不影响公共 API。
