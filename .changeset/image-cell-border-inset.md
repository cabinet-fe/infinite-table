---
'infinitable': patch
---

fix(core): 格内图片不再盖住单元格边框——media 层绘制区按本格生效边框线宽内缩（默认网格线右/下 1px），显式边框变化经 refreshCell 联动同步
