---
'infinitable': patch
---

feat(core,sheet): 公式引用拾取染色框——`SheetGrid.setHighlightRanges` 门面透出引擎 sky 浮层宿主高亮通道（每引用段一圈彩色细边框，随滚动/选区重绘，空数组清除），根包补导出 `scanFormulaReferences` 关联类型 `ScannedReference`/`RangeRef`，宿主可按公式文本扫描逐引用上框对齐 Excel 点选反馈
