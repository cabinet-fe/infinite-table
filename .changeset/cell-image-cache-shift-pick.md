---
'infinitable': patch
---

fix(core,media): 同格替换或移除后再嵌入图片，不再始终显示第一张图——`refreshImageCell` 在换 URL / 移除时同步失效 cell 级位图缓存（缓存 key 不含 URL，旧条目残留会让新 URL 永不发起加载）；undo/redo 回放 clone 载荷换 URL 的同源场景一并修复

feat(core,sheet): 函数参数格支持 shift+点选批量扩展——新增 `resolveShiftSelectAnchor` 锚点解析 hook 与选区拦截回交元信息 `SelectionInterceptMeta`（shiftKey/extend），引用拾取手势以上次拾取锚点连续扩展（宿主据此替换上次插入的引用）；普通模式 shift+点选按画布选区末段锚点扩展（键盘 shift 扩展的同语义指针版）
