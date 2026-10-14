---
"infinitable": patch
---

fix: growOnScroll: false 固定尺寸网格不再被容器 resize 撑大——此前 bindResize 回调无条件调 growOnNearEdge，违背该选项「滚动与 resize 均不增长」的语义。growOnScroll 提为实例字段统一门控：滚动接线、容器 resize 补增长、初始网格估算三处同源；缺省（true）行为不变，容器放大后仍按新视口补增长
