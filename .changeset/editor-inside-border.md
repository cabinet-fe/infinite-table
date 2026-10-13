---
"infinitable": patch
---

feat(core,sheet): 编辑浮层边框内缩 editorInsideBorder——ListTableOptions/SheetGridOptions 新增 opt-in 开关（缺省 false 行为不变），开启后编辑浮层按锚定格（合并主格归一）四周可视边框线宽内缩（含浮层自带边框骑缘补偿 1px），浮层落在边框内侧、格边框编辑期保持可见（对齐 Excel/WPS），双击编辑不再吞掉本格自画的 right/bottom 粗边框；只读查看器不开编辑浮层不受影响
