# univer / ureport2 调研沉淀（univer-suite）

univer 能力套件（打印/水印插件、浮动图缩放旋转）的前置调研结论。本轮实现已消费这些机制要点：打印/水印插件见 `packages/plugins/src/print|watermark/`，引擎侧公开面红线见 `docs/plugin-interface-map.md`，逐项取舍见文末两节。调研日期 2026-10-06，来源快照：

- univer：master 分支克隆快照（monorepo，`packages/`）
- ureport2：原仓库 youseries/ureport2 已删除，用 youseries/ureport 完整引擎源码 + sham2k/ureport2 镜像核对
- univer Pro 打印：docs.univer.ai/zh-CN/guides/sheets/features/print（代码闭源，只取 API 形态）

## 1. univer 插件机制

- **基类与生命周期**：插件基类是抽象类 `Plugin`（`packages/core/src/services/plugin/plugin.service.ts`），钩子 `onStarting / onReady / onRendered / onSteady` 四阶段，由 `LifecycleService`（`services/lifecycle/lifecycle.service.ts`）的 `LifecycleStages` 驱动；插件注册晚于当前阶段时经 `getLifecycleStagesAndBefore` 补跑已错过阶段。
- **注册与依赖拓扑**：`PluginService.registerPlugin(ctor, config)` 按 `UniverInstanceType`（SHEET/DOC/SLIDE/UNKNOWN）分桶；`@DependentOn(...)` 声明插件间依赖，加载做 DFS 拓扑排序，未注册的依赖以默认配置自动注册；同名重复注册抛错。
- **依赖注入**：直接复用 `@wendellhu/redi`（重导出于 `common/di.ts`）；服务用 `createIdentifier` 声明 token、构造函数 `@Inject` 注入；非渲染服务在 constructor 里 `_injector.add`，渲染控制器在 `onRendered` 经 `IRenderManagerService.registerRenderModule` 按渲染单元挂实例；`plugin-override.ts` 支持宿主替换插件内部服务（dependency override）。
- **命令三分类**（`services/command/command.service.ts`）：`COMMAND`（业务编排，可 undo，内部产生 Mutation）/ `MUTATION`（进快照与协作冲突解析的最小单元）/ `OPERATION`（不进快照的临时状态，如滚动选中）。命令是纯对象 `{ id, type, handler(accessor, params) }`，handler 经 `IAccessor` 拿 DI 容器，天然可测可序列化。
- **UI 扩展**：菜单走 `packages/ui/src/services/menu/`（`MenuManagerService.mergeMenu(schema)`，`ContextMenuPosition → Group → 命令 id → menuItemFactory` 树）；快捷键 `shortcut.service.ts` 只绑命令 id + precondition 不写业务。
- **Preset 装配**：preset 是返回 `{ plugins, configure }` 的函数（`presets/packages/preset-sheets-core/src/preset.ts`），把十几个插件按需组合统一分发 config，宿主一次 `registerPlugin(preset(...))` 接入。

对照：infinitable 插件契约刻意极简（`packages/core/src/plugin.ts` 的 `{ name, mount, unmount }`，无 DI/生命周期/依赖拓扑），插件靠 mount 时写引擎公开/预留面（chart 插件 `chartMediaResolver`、水印插件 `setOverlayPainter` 同一先例）。复杂度差异是定位差异：univer 是全功能办公套件平台，infinitable 是单表格引擎。

## 2. 打印骨架（开源三拦截点 + CanvasRenderMode.Printing）

开源仓库不含打印主实现——打印是 Pro 商业包（@univerjs-pro/sheets-print）；开源侧预留了完整挂载骨架：

- **三拦截点**：`packages/sheets-ui/src/services/print-interceptor.service.ts` 的 `SheetPrintInterceptorService` 用通用 `InterceptorManager` 暴露 `PRINTING_RANGE`（计算/扩展打印范围）、`PRINTING_COMPONENT_COLLECT`（向离屏 scene 收集要打印的 canvas 组件，如浮动图片）、`PRINTING_DOM_COLLECT`（收集必须 DOM 渲染的组件，如 FloatDom/图表）。各特性插件自行注册拦截器把副作用并入打印流程，主流程零耦合。另有 `SheetPrintingResourceCollector` 跟踪异步资源（图片加载）限时 10s 等待。
- **无头渲染模式**：`packages/engine-render/src/canvas.ts` 的 `CanvasRenderMode.Printing`——同一套渲染代码 + 离屏 canvas，仅摘掉键盘/指针/媒体查询监听；`BaseObject.printable` 标志决定对象是否进打印输出。保证打印与屏幕像素级一致。
- **drawing 打印适配**（`packages/sheets-drawing-ui/src/controllers/sheet-drawing-printing.controller.ts`）：拦截 RANGE 把浮动图形 transform 外接矩形并入打印范围；拦截 COMPONENT_COLLECT 把图片/图形按 zIndex 重画到离屏 scene；FloatDom 注册打印用替身组件换 React 组件。
- **Pro 侧 API 形态**（文档可见，实现闭源）：`workbook.openPrintDialog()/print()/updatePrintLayoutConfig()/updatePrintRenderConfig()`；布局配置 `area/paperSize(A3~Letter~自定义)/direction/scale(Origin|FitWidth|FitHeight|FitPage|Custom)/freeze(首行首列每页重复)/margin/maxRowsEachPage/maxColumnsEachPage`；渲染配置 gridlines、页眉页脚六宫格（topLeft~bottomRight），占位符 PageSize/WorkbookTitle/WorksheetTitle/Date/Time，支持打印水印与 enforceWatermark；Before/After 系列 lifecycle 事件；输出走 canvas 高 DPI 光栅化进浏览器打印/PDF。
- **优缺点**：优点是渲染一致性（同一管线离屏复用）+ 拦截器解耦 + 占位符模型简洁；缺点是闭源不可抄、全 canvas 光栅化对超多页报表内存压力大、依赖浏览器打印对话框。

本轮取舍：走 HTML + `@page` + 隐藏 iframe 的 headless 路线（ureport2-js `preview.js` 同源、与 meta report 既有打印链路同形态），不做 canvas 光栅化（见 §6 未移植清单）。

## 3. 图片编辑（双坐标 + Transformer 8 锚点 + 旋转手柄）

- **数据模型**（`packages/core/src/types/interfaces/i-drawing.ts`）：顶层 `IDrawingParam { unitId, subUnitId, drawingId, drawingType, transform, transforms, groupId, hidden, locks }`；变换态 `ITransformState = IAbsoluteTransform{left,top,width,height} + IRotationSkewFlipTransform{angle,skewX,skewY,flipX,flipY}` + 可禁用项 `rotateEnabled/resizeEnabled`；`locks` 细粒度锁 noMove/noResize/noRotate/noChangeAspect。
- **双坐标存储**（`packages/sheets-drawing/src/services/sheet-drawing.service.ts` + `basics/transform-position.ts`）：sheet 专属双份——单元格锚点 `sheetTransform: { from: {row,column,rowOffset,columnOffset}, to: {...}, angle, flipX }`（Excel 兼容）+ 绝对像素 `transform`，二者经 `SheetSkeleton` 互相换算；`axisAlignSheetTransform` 存 Excel「主轴切换轴对齐外接框」规则（角度 [-45°,45°)/[135°,225°) 用原框，[45°,135°)/[225°,315°) 宽高互换）；`anchorType` 三态 Position（位置跟随）/Both（位置+大小跟随）/None（浮动不动），插删行列时按 anchorType 重算并发 Mutation。
- **Transformer 交互**（`packages/engine-render/src/scene.transformer.ts`，思路借鉴 Konva）：挂在 Scene 上的特殊 Group——8 个缩放锚点（leftTop/centerTop/rightTop/leftMiddle/rightMiddle/leftBottom/centerBottom/rightBottom）+ 顶部旋转手柄；`keepRatio`（Shift 等比）、`centeredScaling`、`rotationSnaps`（角度吸附 + 容差）、`boundBoxFunc` 约束、多选组变换、`isCropper` 裁剪模式。旋转计算：`angle = 原角度 + atan2(当前指针-中心) - atan2(起始指针-中心)` 再归一化 0–360。锚点是 Transformer group 的子对象、随目标 angle 一起旋转，命中走 BaseObject 统一逆矩阵路径——这是「控制点随旋转仍可命中」的关键。对外 `changeStart$/changing$/changeEnd$` 三流，编辑结束才落 Mutation（拖拽过程只改 canvas 对象 transform）。
- **渲染层**：图片即 scene 里的 canvas `Image` 对象按 zIndex 入层（`packages/drawing-ui/src/services/drawing-render.service.ts` + `engine-render/src/shape/image.ts`）；编辑态 `scene.attachTransformerTo(image)`；裁剪 `clipBounds {left,top,width,height}` 渲染时 `ctx.rect + clip`（原图可恢复）；图源 URL/UUID/Base64 三种 + 缓存。

本轮移植：FloatObject 加 `rotation` + 8 缩放手柄 + 旋转手柄（Shift 等比 / Shift 15° 吸附）+ `onTransformEnd` 事件（拖拽结束才抛，宿主写模型），实现于 `packages/core/src/float/float-object-layer.ts`；锚点仍用本引擎 from/to 形态，未引入双坐标互算与 anchorType 重算（见 §6）。

## 4. 水印层（顶层平铺 rotate+opacity）

开源完整实现，插件 `packages/watermark/`（`UniverWatermarkPlugin`，@DependentOn 渲染引擎插件）：

- 类型三态 `IWatermarkTypeEnum.Text / Image / UserInfo`（UserInfo 取当前登录用户名平铺，防截屏溯源）。
- 配置（`engine-render/src/components/sheets/watermark/type.ts`）：`{ x, y, repeat, spacingX, spacingY, rotate, opacity, fontSize, color, bold, italic, direction }`，图片水印另有 width/height/maintainAspectRatio。
- 渲染：`WatermarkLayer extends Layer` 以 `UNIVER_WATERMARK_LAYER_INDEX = 10` 加到 Scene 顶层，`render()` 在主 canvas 直接绘制、支持 dirtyBounds 裁剪。平铺算法（util.ts）：双层 for 循环，步长 = 内容尺寸 + spacing，每个单元 `translate → rotate(角度) → fillText/drawImage`，整层 `globalAlpha`。
- 关键语义：平铺用 `ctx.canvas.width/height`（像素尺寸）不随视口滚动移动——**水印锚定屏幕而非内容**（防截屏语义）；配置持久化 LocalStorage，经 `WatermarkService.updateConfig$` 流通知各渲染单元重建。

本轮移植：文字平铺水印做成 TablePlugin（`packages/plugins/src/watermark/`），配置 `{ enabled, text, fontSize, color, opacity, rotate, gapX, gapY }` 同构；绘制挂引擎顶层 overlay 预留位（`setOverlayPainter`，承载节点在 sky 层最顶，与 univer 顶层 LayerIndex 同位语义），锚定视口不随滚动平移——两层预留位的差异见 `docs/plugin-interface-map.md` 第二节 overlay/underlay 两行。

## 5. ureport2 功能与移植价值

引擎源码 `ureport2-core/src/main/java/com/bstek/ureport/`（原仓库已删，社区镜像活跃）。功能清单按移植价值筛选：

| 功能 | 机制一句话 | 移植价值 |
| --- | --- | --- |
| 单元格扩展 | CellDefinition.expand=Down/Right/None，`build/ReportBuilder` BFS 逐格展开、父子格 leftParent/topParent 定分组粒度 | 高（数据驱动报表展开的算法原型；@meta/report expand 内核同类） |
| 页级函数 | `expression/function/page/`：PageNumber/PageCount/PageSum/PageAvg/PageMax/PageMin，每页构建时求值 | 高（页脚「本页小计」必需；univer 占位符只做页码不做聚合） |
| 条件属性 | ConditionPropertyItem：条件命中改样式，支持条件分页（表达式为真强制换页） | 高（条件换页是报表打印刚需） |
| 分页-fitpage | `build/paging/FitPagePagination`：可用高度=纸高-边距，逐行累加至放不下；rowSpan 跨页截断续排 | 高（fitpage 分页算法原型） |
| 分页-fixrows | `FixRowsPagination`：每页固定行数=fixRows-重复表头表脚，末页空白行补齐（套打对齐） | 高（票据/凭证套打刚需） |
| 页眉页脚/行 Band | HeaderFooterDefinition{left,center,right} 三段 + 行级 Band：title/headerrepeat/footerrepeat/summary 每页重复 | 高（三段式页眉 + 重复表头，比 univer 六宫格贴中国报表习惯） |
| 纸张/分栏 | Paper/PaperSize(A4/A3/B5/自定义)/Orientation/四边距/多栏 columnCount+columnMargin（多页拼一页多栏） | 高（多栏分栏打印 univer 开源没有） |
| 斜线表头 | SlashValue{svg, slashes[]}，设计器画斜线存 SVG base64 内嵌 | 中（canvas 画线+分区域文本可复刻） |
| 二维码/条形码 | ZxingValue{category,format,width,height}，core 返回 null 由宿主注入实现 | 中（前端 qrcode/jsbarcode 生成即可） |
| 数据集表达式 | ANTLR 语法 `${ds.field}` + 聚合 sum/avg/count/max/min/group + 50 内置函数含中文大写 | 中（infinitable 已有 formulas，缺数据集绑定语义） |
| 打印输出 | ureport2-js/preview.js：分页 HTML + @media print 样式注入隐藏 iframe → iframe.window.print() | 中（最简 web 打印路径，本轮直接采纳同路线） |
| 导出 Excel/PDF/Word/HTML | export/ 各格式独立导出器，只消费已算好的行列模型 | 低（Java 栈不可复用；「导出器只消费算好的模型」分层值得抄） |
| 图片/图表单元格 | ImageValue/ChartValue → 前端渲染 | 低（univer/本引擎图片体系更强） |
| 查询表单/数据源 | searchform 组件 + Sql/Bean 数据集 | 低（后端概念，前端仅借鉴字段元数据） |

## 6. 本轮已移植 / 未移植清单

### 已移植（univer-suite 交付，均为 plugins/core 公开面形态）

| 能力 | 来源思路 | 落地 |
| --- | --- | --- |
| fitpage/fixrows 双模式分页 | ureport2 FitPagePagination / FixRowsPagination | `packages/plugins/src/print/paginate.ts`：fitpage 行高累加划分页区间；fixrows 每页数据行数 = fixRows − headerRepeatRows |
| 每页重复表头 + 末页补空行 | ureport2 行 Band headerrepeat + blank row 补齐 | paginate 分页输出统一 Page 结构，页面构建时重复前 N 行、末页补空行保持行数一致 |
| 三段式页眉页脚 + 占位符 | ureport2 HeaderFooterDefinition{left,center,right} + univer 占位符 | `print/header-footer.ts`：left/center/right 三段，`{page}/{pageCount}/{date}/{time}/{title}` |
| 页级聚合 | ureport2 页级函数 PageSum/PageAvg/PageMax/PageMin | 占位符 `{pageSum:COL}/{pageAvg:COL}/{pageMax:COL}/{pageMin:COL}` 每页构建时对页内行求值 |
| 分组换页 | ureport2 条件分页（表达式为真换页）的列值分组形态 | print config `groupBreakBy`：指定列值变化处强制换页（v1 按列值分组，未做自由表达式） |
| 纸张/横竖/边距/缩放/打印水印 | univer Pro 布局配置 + ureport2 Paper | `print/paper.ts`（A3/A4/A5/Letter/自定义 mm、portrait/landscape、四边距）+ scale origin/fit-width + 水印每页平铺 |
| 打印输出与预览 | ureport2-js preview.js（iframe+print CSS）+ Pro 弹窗形态 | `print/print-output.ts` 隐藏 iframe → `window.print()` → 清理；`print/preview.ts` DOM 薄壳 openPrintPreview；数据经 PrintSource 抽象（宿主/适配器供数），headless 不依赖 DOM |
| 浮动图缩放旋转 | univer Transformer（8 锚点 + 旋转手柄 + keepRatio + snap + 结束才落 Mutation） | core `float/float-object-layer.ts`：rotation 字段、8 缩放 + 1 旋转手柄、Shift 等比/15° 吸附、`onTransformEnd` 抛 `{id, anchor, size, rotation}` |
| 文字平铺水印 | univer WatermarkLayer（顶层 + 双层 for 平铺 + rotate/opacity + 锚定屏幕） | `packages/plugins/src/watermark/`：挂顶层 overlay 预留位（`setOverlayPainter`），滚动不位移，配置变更一帧内重绘 |

### 未移植及原因

- **多栏（分栏）打印**：页面构建需「多页拼一页多栏」的二维排版模型，v1 无业务拉动，列后续单开。
- **斜线表头 / 二维码条形码**：国内报表高频但独立于分页内核，属页面内容渲染扩展；需要时在页面 HTML 构建层补（斜线 SVG / qrcode 生成图片），不动分页算法。
- **rowSpan 跨页截断续排、冻结列作每页重复标题列**：本引擎打印源经 PrintSource 行区间供数，跨页合并续排需要单元格级跨页状态机；v1 仅做表头行重复。
- **服务端打印 / PDF 文件导出 / 打印权限控制**：超出浏览器端插件范围（Pro 的 enforceWatermark/权限点同类）。
- **高 DPI canvas 光栅化（CanvasRenderMode.Printing 离屏复用路线）**：v1 走 HTML + @page + iframe（与 meta report 既有链路同源、可被 meta headless 直接消费）；若后续要求打印与屏幕像素级一致再评估离屏路线。
- **水印的 Image/UserInfo 类型、LocalStorage 持久化**：v1 只做文字水印（meta 三端一致消费同一文字配置）；图片水印需要图源管理与三端（屏幕/打印/xlsx）渲染适配，UserInfo 依赖用户态注入。
- **图片裁剪 clipBounds、flip、多选组变换、anchorType 联动重算、双坐标互算**：保持本引擎 from/to 锚点语义，仅新增 size/rotation 变换；Excel 主轴对齐外接框等兼容规则无业务需求。
- **in-cell 图片格缩放旋转**：图片格走 MediaCache blit 管线，与浮动对象层无关。

## 7. 三仓库接入现状（本轮收口后）

- infinite-table：`packages/plugins` 暴露 print/watermark 两插件（TablePlugin 形态，import 面零引擎内部 API，红线见 `docs/plugin-interface-map.md`）；core 公开浮动图变换 API 与 overlay/underlay 绘制预留位。
- ultra-ui：`packages/sheet-core` SheetImage 加 rotation，`grid-float-images.ts` 桥接 `onTransformEnd` → `sheet.updateImage` 写回命令栈（一次撤销还原变换）；宿主可经 `SheetGrid.getTable()` 自挂引擎打印/水印插件。
- meta：`packages/report` 打印改走打印插件 headless 核心（分页/页眉页脚/水印，对外 API 兼容），ReportWatermarkConfig 样式字段全可选（屏幕 `report-watermark.vue` / 打印 / xlsx 三端同配置），ReportBinding.transform 函数体转换（@meta/utils createExpressionCompiler 编译、失败回退原值）。

## 附：源码路径索引（univer 快照）

- 插件：`packages/core/src/services/plugin/plugin.service.ts`、`common/di.ts`、`services/command/command.service.ts`、`services/lifecycle/lifecycle.service.ts`、`packages/ui/src/services/menu/`、`presets/packages/preset-sheets-core/src/preset.ts`
- 打印骨架：`packages/sheets-ui/src/services/print-interceptor.service.ts`、`packages/engine-render/src/canvas.ts`（CanvasRenderMode）、`packages/sheets-drawing-ui/src/controllers/sheet-drawing-printing.controller.ts`
- drawing：`packages/core/src/types/interfaces/i-drawing.ts`、`packages/sheets-drawing/src/services/sheet-drawing.service.ts`、`basics/transform-position.ts`、`packages/engine-render/src/scene.transformer.ts`、`shape/image.ts`
- 水印：`packages/watermark/src/`、`packages/engine-render/src/components/sheets/watermark/`（type/util/watermark-layer）
- ureport2：`build/ReportBuilder.java`、`build/paging/{FitPagePagination,FixRowsPagination,BasePagination}.java`、`definition/{Paper,PagingMode,ConditionPropertyItem,HeaderFooterDefinition}.java`、`expression/function/page/`、`ureport2-js/src/preview.js`
