---
"infinitable": patch
---

feat(print): 横向分页（列切带）、打印区域 rowRange/colRange、自定义百分比缩放
fix(print): 真实打印路径延迟回收 iframe，修复 Firefox/Safari 打印截断
fix(core,sheet): resize 沿构造期显式 dpr，不再被环境值覆盖
fix(sheet): xlsx 导出物化合并区覆盖格有效样式，修复多行/列合并外边框缺失
