---
"infinitable": patch
---

fix: 修复编辑提交空值清掉单元格样式——仅设样式（如边框）无值的格，双击进入编辑后失焦提交不再丢失样式。SetCellValueCommand 清值分支保留既有样式（清样式仍走 setCellStyle 独立通道）；EditManager 无变化提交跳过写回与变更事件，不再污染数据与 undo 栈；导入清空适配为值/样式两步清除（同一事务单 undo 单元）
