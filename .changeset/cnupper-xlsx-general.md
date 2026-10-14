---
'infinitable': patch
---

fix: cnUpper 导出 xlsx 的通用格式关键字由中文 UI 写法 `G/通用格式` 改为跨 locale 标准写法 `General`（`[DBNum2][$-804]General`）——中文关键字在非中文 locale 的 Excel 中不被识别，格式码尾部被当字面量显示为「/通用格式」；`General` 中文 Excel 同样识别，导入侧按 `[DBNum2` 前缀识别不受影响，查看态显示路径不变。
