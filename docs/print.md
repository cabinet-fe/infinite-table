# 打印插件（print）

headless 打印内核 + DOM 薄壳的分层、配置面与下游消费契约。代码入口 `packages/plugins/src/print/`。

## 分层

| 层 | 模块 | 触 DOM | 说明 |
| --- | --- | --- | --- |
| P1 内核 | `types` / `paper` / `paginate` | 否 | 数据面抽象（PrintSource）、纸张几何、分页引擎，纯函数可在测试环境直接消费 |
| P2 页面构建 | `page-html` / `header-footer` / `escape` | 否 | 分页结果 → 可打印文档 HTML（`@page` 纸张/方向/边距、colgroup、合并格 rowspan/colspan、td 内联样式、占位符求值、平铺水印） |
| P2 输出 | `print-output` | 是 | 隐藏 iframe 装载文档 → `contentWindow.print()` → afterprint/兜底定时器清理（Firefox/Safari 的异步 `print()` 不能在返回时立即移除 iframe） |
| P3 预览 | `preview` | 是 | `openPreview` 轻量弹层（缩略列表 + 当前页 iframe + 打印按钮），宿主也可用 shadcn 自建（playground PrintPage 即此形态） |

全部能力经 `createPrintPlugin({ source, config?, hooks? })` 句柄暴露：`paginate` / `buildDocumentHtml` / `print` / `openPreview`。打印链路不接线表格挂点（headless），可脱离表格实例消费。

## 分页语义速查

- **fitpage**（缺省）：行高（×缩放）累加至放不下即换页；单行超高独占一页不截断。
- **fixrows**：每页数据行数 = `fixRows − headerRepeatRows`；未满配额的页补空白行（套打行栅格）。
- **groupBreakBy**：列值变化处强制换页，两模式正交组合。
- **scale**：`origin` / `fit-width`（只缩不放）/ `{ percent: 1–1000 }` 自定义百分比（非法值抛错）。
- **rowRange / colRange** 打印区域：夹取后作为数据域；空/倒置区间返回空页列表。`rowRange` 与 `headerRepeatRows` 正交（重复表头恒取源表前 N 行，区间起点落在表头带内时数据域从表头带之后开始）。
- **横向分页**：origin/percent 缩放下列宽和超可用页宽时按列切带（fit-width 缩放后不超宽自然不切）；页序行带在外、列带在内（先下后右）；跨列带合并格按带裁剪（锚点移到带首列、colspan 截断）；每页重复表头行照常。页级聚合占位符（`{pageSum:COL}` 等）只统计本页列区间内的列。

## PDF 导出契约（下游消费）

打印内核的版式事实就是 **`buildDocumentHtml(source, config)` 的产物**——分页、重复表头、合并格、页眉页脚、水印全部在这一份 HTML 里。PDF 导出不在库内实现（浏览器侧无矢量 HTML→PDF 能力，headless Chrome 属服务端依赖），下游两条路径：

1. **零成本兜底**：`print()` 走浏览器打印对话框，Chrome/Edge 对话框内「另存为 PDF」即得同一版式的矢量 PDF。
2. **服务端渲染**（可控产物、可批量）：把 `buildDocumentHtml` 产物交给 headless Chrome：

```js
// puppeteer 侧最小 recipe：版式由文档内 @page 规则决定，浏览器纸张设置必须跟随
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'networkidle0' })
const pdf = await page.pdf({
  preferCSSPageSize: true, // 关键：以文档内 @page size 为准（纸张/方向/边距）
  printBackground: true,   // 关键：表头底纹/水印等背景色
})
```

注意事项：
- 字体：服务端需安装文档字体栈（Arial + PingFang SC/Hiragino Sans GB/Microsoft YaHei）或把字体随 HTML 内嵌（`@font-face` data URL），否则中文回落到系统默认导致列宽测算漂移。
- 分页规则已在 HTML 内声明（`.print-page` 整页容器 + `break-after: page`），不要再叠加浏览器 header/footer（`displayHeaderFooter: false` 即缺省）。
- 版式回归由 `packages/plugins/tests/print/page-html.test.ts` 契约测试守护（`@page` 规则、页数、结构关键串）；产物结构变更视为 breaking。

## 静默打印扩展点

`PrintHooks.print`（`createPrintPlugin({ hooks })` 或 `printPages` 第三参）可整体接管打印输出：钩子收到装载完毕的隐藏 iframe，宿主可注入桩（测试）、对接本地打印代理（PDF 流送本地进程，参考 FineReport FinePrint / JimuReport 直连打印形态）。库内不实现本地客户端；钩子返回 Promise 时等待其完成后再清理 iframe。
