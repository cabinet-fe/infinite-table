# 替换路线图：ultra-ui `sheet-core/src/grid/` 重写为 infinite-table 底座

> 定位：本文是 ultra-ui 侧执行「重写 `packages/sheet-core/src/grid/`（VTable 适配层，10 文件 2919 行）」的**操作手册**。
> 接口面的权威清单是 [`docs/plugin-interface-map.md`](./plugin-interface-map.md)（下称「清单」）；本文按替换执行视角组织，与之冲突处以清单为准。
> 历史背景与依赖面提取见 `.agents/analysis/ultra-ui-sheet-gap.md`（其差距清单已全部闭环，仅作素材来源）。

## 〇、前置条件核对清单（全部满足才开工）

| # | 前置 | 状态 | 核对方式 |
| --- | --- | --- | --- |
| 1 | 交互浮层主题 token（选区/hover/填充柄/resize 线/表头高亮）+ `underlayBackgroundColor` + `frameStyle` | ✅ S1 | `packages/core/src/theme.ts` `InteractionTokens/FrameStyle` |
| 2 | `corner`/`rowHeader` 独立主题分区（缺省随 header 派生） | ✅ S1 | 同上 |
| 3 | `onEditStart`/`onEditEnd` 编辑生命周期事件（公式栏镜像依赖） | ✅ S1 | `ListTable.onEditStart/onEditEnd` |
| 4 | sheet 插件七件：SheetStore（asModel 模型适配）/generateFill 填充生成/bindSelectionSync 选区双向同步/createFormulaDisplay 公式显示/excelKeymapPreset 键位/SheetBook 实例池/UndoStack 撤销栈 | ✅ S3 | `packages/plugins/src/sheet/`，导出面见 `packages/plugins/src/index.ts` |
| 5 | demo sheet 功能对照全绿（对标 playground sheet） | ✅ S4 | `apps/demo` sheet 区 + `?smoke=1` 41/41（含 sheet 段 9 项） |
| 6 | 包可被外部消费（exports 三条件 types/dev/import→dist） | ✅ S5 | `bun run check:exports` |
| 7 | bench sheet 口径基线与防回归阈值 | ✅ S5 | `apps/bench/results/`、`src/thresholds.ts`（切换/逐格写/粘贴/冻结切换四场景） |
| 8 | happy-dom 挂载安全（下游测试环境前提） | ✅ S5 | `packages/core/tests/happy-dom/`、`packages/plugins/tests/sheet/happy-dom-mount.test.ts` |

替换红线：**grid/ 重写只允许 import `@infinite-table/core` 与 `@infinite-table/plugins` 两个公共入口的导出**（`hucre` 仅限 xlsx 导入导出的映射与装配用途，同清单红线修订）；清单与本文的映射表即允许面全集。发现缺口时先在本仓立项补公开面，不得绕行内部 API。

## 一、接口面逐条映射表（VTable → infinite-table）

六分区对应 grid/ 的六类消费点（`sheet-grid.ts` buildOptions/实例方法、`grid-sync-manager.ts` 事件、`vtable-theme.ts` 主题、`grid-editor-router.ts` 编辑器、`grid-style-resolver.ts` 样式回调）。

### 1. 构造 options（`buildOptions()`）

| VTable option | infinite-table 对应 | 语义差异 / 注意点 |
| --- | --- | --- |
| `records + columns[]`（field/title/width/style/editor/customLayout 回调） | `ListTableOptions.records/columns`（`ColumnDefine`） | **建议直接用 `model` 形态挂 SheetStore（见下行）**，records 展开可整体省略 |
| —（VTable 无直挂模型，靠 `setRecords` 全量重放） | `model: store.asModel()`（SheetStore → TableModel） | 架构优势：按格 O(1) 读，免「批量 >64 格就 setRecords 全量刷」绕法（grid-sync-manager BATCH_FULL_REBUILD_THRESHOLD 整段消失） |
| `widthMode: 'standard'` / `defaultRowHeight: 28` | `rowHeight`（options 或主题 token） | 无 mode 概念，固定行高即缺省 |
| `enableLineBreak` / `maxCharactersNumber: 50000` | 文本管线原生识别 `\n`；`ListTableOptions.editorMaxLength` / `ColumnDefine.editorMaxLength` | 引擎已公开字符上限（S7 P3：列级优先、options 兜底，未配置不截断） |
| `customComputeRowHeight({row})` | `get/setRowHeight` + SheetStore 行高覆盖（resize 持久化接线见 demo `sheet/persist.ts`） | 稀疏覆盖模型而非回调；切 sheet 由 SheetBook.applyGeometry 还原 |
| `resize: {columnResizeMode, rowResizeMode}` | `canResizeCol/canResizeRow` options | 公开能力替代 `_canResizeRow` 私有猴补丁；行高拖拽默认全区可拖，若需「仅行号列」在 canResizeRow 回调里按 `table.isSeriesNumber(col,row)` 判定 |
| `theme: themes.DEFAULT.extends(...)` | `extendsTheme(override)` + 分区 token | 见第 4 节主题面 |
| `showHeader` / `rowSeriesNumber{width,style}` | `showRowHeader/showColHeader` options + 行号列宽 `rowHeaderWidth` + 主题 `rowHeader` 分区 | 行列头开关引擎已公开（S7 P4：缺省 true；false 归一化为 `rowHeaderWidth=0`/`headerHeight=0`，与显式零宽/零高等价）；行号列样式走 `rowHeader` token |
| `excelOptions: {fillHandle}` | 内置填充柄原语 + `bindFillGeneration`（生成写值） | 内核画柄+抛事件；生成算法在插件 `generateFill`（数字/日期/文本尾数字/复制） |
| `editor: EDITOR_NAME` + `editCellTrigger: 'doubleclick'` | `EditorRegistry.registerEditor` + 双击内置 + `excelKeymapPreset`（editCellOnEnter） | 双击触发内置；Enter 键位用预设展开 options |
| `frozenRowCount/frozenColCount`（**计数含表头**） | 构造 options + `setFrozenRowCount/setFrozenColCount` | **±1 换算**：ultra-ui 传「数据冻结数+1」，infinite-table 只收数据冻结数 |
| `keyboardOptions` | `editCellOnEnter`、`ctrlMultiSelect` | 组合语义用 `excelKeymapPreset`；Ctrl+A 全选内置（角落点击）；编辑态方向键语义锁定：编辑会话中方向键不提交（`onEditEnd` 不触发）不移格（活动格不变），光标移动留在编辑器内——已由 `packages/core/tests/editing/editing-semantics.test.ts` 回归单测锁定 |
| `customMergeCell(col,row,table)` | 构造 `mergeCells` + `setMergeCells/addMergeCell/removeMergeCell` | 动态回调改为显式集合替换（Store 为源，见 demo 冻结/合并面板）；合并不跨冻结边界校验内置（越界抛错保持原状） |
| `hover: {disableHover:true}` | 主题 `interaction.hoverCell/hoverBand` 置全透明 | 等价关闭 |
| `eventOptions: {preventDefaultContextMenu:true}` | 无需配置 | 引擎无默认菜单，`onContextMenu` 纯事件 |

### 2. 实例方法 / 属性面

| VTable / SheetGrid 调用 | infinite-table 公开 API | 语义差异 / 注意点 |
| --- | --- | --- |
| `setRecords`（全量重建） | 多 sheet 用 `SheetBook` 实例池（切换重挂）；值写入走模型直挂 | 不需要等价物——这是要**删掉**的调用面 |
| `changeCellValue(col,row,value)` | `updateCell(col,row,value)`（回驱模型）+ SheetStore 写路径 | 大块写入包 `batchUpdate`（收敛单次 band） |
| `updateCellContent(col,row)` | `refreshCell(col,row)` | 窗口外格为 no-op（引擎语义） |
| `selectCells(ranges[])` / `getSelectedCellRanges()` | 同名方法 | start/end 均为 0 基数据坐标（不含行列头） |
| 外部选区回写 | `applyExternalSelection` + `onSelectionChange`；双向防回环用插件 `bindSelectionSync` | VTable 无防回环原语，GridSelectionController 的签名判重逻辑由插件承担；`applyExternalSelection` 不滚动回推语义锁定——应用外部选区快照只更新选区与浮层、不驱动滚动（视口外选区不带回滚动），已由 `packages/core/tests/list-table-interaction.test.ts` 回归单测锁定 |
| `scrollToCell({col,row})` | `scrollToCell` | 冻结轴恒可见语义一致 |
| `getCellAtRelativePosition(x,y)` | `getCellAtRelativePosition` | 行列头/空白返回 null |
| `getCellRelativeRect(col,row)` | `getCellRelativeRect` | 窗口外返回 null |
| `getDrawRange()` | `getDrawRange` | 一致 |
| `getBodyVisibleCellRange()` | `getBodyVisibleCellRange` | 已含冻结区并入语义 |
| `isSeriesNumber(col,row)` | `isSeriesNumber` | 一致（-1 坐标体系） |
| `columnHeaderLevelCount` | `getHeaderLevelCount()` | 方法而非属性，恒 1 |
| `rowCount / colCount` | SheetStore `getRowCount()/getColCount()` | 引擎不公开维度；事实源在 Store |
| `frozenRowCount/frozenColCount`（可写属性） | `get/setFrozenRowCount/get/setFrozenColCount` | 属性赋值改 setter 调用；**±1 换算**同上 |
| `get/setColWidth`、`get/setRowHeight` | 同名方法 | 一致 |
| `get/setScrollLeft/get/setScrollTop`（+属性兜底） | 同名方法 | 无属性兜底需要 |
| `on/off` | `on*` 订阅方法返回退订函数 | `off` = 调退订函数 |
| `release()` | `destroy()` | 注入的 host 不随 destroy 销毁（ownHost 语义） |
| `table._canResizeRow`（私有猴补丁） | `canResizeRow` 公开 options | 猴补丁删除 |
| 撤销/重做 | `UndoStack` + `bindCellChangeUndo`（值命令）；结构命令按 `UndoCommand` 包装 | 撤销回写经 Store 直写模型，天然不回环 |

### 3. 事件面（`ListTable.EVENT_TYPE` → `on*`）

| VTable 事件 | infinite-table 订阅 | 注意点 |
| --- | --- | --- |
| `CHANGE_CELL_VALUE` | `onCellChange`（col/row/oldValue/newValue） | 「程序化绕行回滚视图」语义由模型 echo 防回环（ModelBinding）承担 |
| `RESIZE_ROW_END` / `RESIZE_COLUMN_END` | `onRowResizeEnd` / `onColResizeEnd` | 携带夹取后终值；持久化写 Store（demo persist.ts 先例） |
| `CONTEXTMENU_CELL` | `onContextMenu` | 事件坐标为视口坐标；demo context-menu.ts 有定位先例 |
| `SELECTED_CELL` / `DRAG_SELECT_END` | `onSelectionChange` | 变更级粒度（更细）；拖选结束判定由消费方自行节流 |
| `MOUSEDOWN_FILL_HANDLE` / `DRAG_FILL_HANDLE_END` | `onFillHandleDown` / `onFillDragEnd` | 事件带 anchor/target 归一化边界；生成写值用 `bindFillGeneration` |
| `SCROLL` | `onScrollFrame` | 帧级同步（强于事件后知后觉）；浮动层跟随可直接用 |
| 编辑会话开始/结束（EditContext onStart/onEnd） | `onEditStart` / `onEditEnd` | payload 含初值/终值/是否提交；公式栏镜像的挂点 |

### 4. 主题面（`vtable-theme.ts` extends → `extendsTheme`）

| VTable 主题项 | infinite-table token | 语义差异 / 注意点 |
| --- | --- | --- |
| `underlayBackgroundColor` | `underlayBackgroundColor` | — |
| `frameStyle`（线宽/色/阴影） | `frameStyle: { lineWidth, color, shadow }` | 阴影为布尔开关（固定观感），非 VTable 的自由阴影参数 |
| `selectionStyle`（填充/边框/线宽） | `interaction.selectionFill/selectionBorder/selectionBorderWidth` | — |
| `defaultStyle` | `body` 分区 | — |
| `headerStyle` / `cornerHeaderStyle` / `rowHeaderStyle` | `header` / `corner` / `rowHeader` 分区 | corner/rowHeader 缺省随生效 header 派生；显式覆盖键优先生效 |
| hover 关闭/变色 | `interaction.hoverCell/hoverBand` | 全透明=等价关闭（无 disableHover 开关） |
| `cellBorderClipDirection: 'bottom-right'` | 无对应 token（逐边边框语义已可表达） | 替换时按 ultra-ui 视觉核对邻格覆盖表现（清单 P1-12 注记） |

### 5. 编辑器契约（`grid-editor-router.ts` → `EditorRegistry` + 插件）

| ultra-ui 现状 | infinite-table 对应 | 注意点 |
| --- | --- | --- |
| `register.editor(name, editor)` 全局注册表 + 单例 WeakMap 路由（绕 VTable 注册表泄露坑 #1） | `EditorRegistry.registerEditor`（实例级） | 泄露坑随 VTable 消失，路由层整段可删 |
| `InputEditor/EditContext.onStart`（可替换初值：公式格显示 `=原文`） | 编辑初值=基础值口径（Store 存原文即天然成立）+ `createFormulaDisplay({ evaluate })` 显示层求值 | mini 求值器为 demo 参考实现；正式替换接 ultra-ui core/ 公式引擎 |
| `onEnd`（通知公式栏退出镜像） | `onEditEnd`（committed 区分提交/取消） | 一致 |
| `resolveEditText` 语义 | 同上：编辑见原文、渲染见求值结果 | — |

### 6. 样式回调（`grid-style-resolver.ts` ITextStyleOption → `CellStyle`）

| ITextStyleOption 字段 | CellStyle 字段 | 注意点 |
| --- | --- | --- |
| `bgColor` / `color` | `background` / `color` | — |
| `fontWeight` / `fontStyle` / `underline` / `lineThrough` | 同名字段 | fontWeight 收数值或关键字 |
| `fontSize`（pt） | `fontSize`（CSS 像素数值） | **pt→px 换算在适配层做**（×96/72） |
| `fontFamily` | `fontFamily` | — |
| `textAlign` | `textAlign`（left/center/right） | 垂直对齐另有 `verticalAlign` |
| `padding` | `padding: [上,右,下,左]` | ultra-ui `[2,6,2,6]` 直接可用 |
| `borderColor[4] / borderLineWidth[4] / borderLineDash[4]` | `border: { top/right/bottom/left: { width, color, style } }` | 逐边数组→逐边对象；五线型映射 `style`（solid/dashed/dotted/double 引擎原生绘制，dash 线型→dashed） |

### 7. 触控滚动与惯性（sheet-core `bindTouchScroll` → 引擎内置）

| 项 | ultra-ui 现状 | infinite-table 对应 |
| --- | --- | --- |
| 触控滚动 | sheet-core `bindTouchScroll` 手写触控滚动（约 156 行：touch + pointer(touch/pen) 双通路增量驱动，无惯性段） | 引擎内置触控滚动 + 惯性（`packages/core/src/touch-scroll.ts`：TouchScrollTracker 最近 4 采样、end 按首末差求初速度；InertiaScroller 摩擦 0.95 按 16ms 基准帧幂次衰减、停止阈值 0.05 px/ms、双轴独立、位移取帧内平均速度），可直接替换手写实现 |

参数/行为差异清单：

1. 下游无惯性段，引擎多出惯性——参数与 vtable 对齐（摩擦 0.95 / 停止阈值 0.05 px/ms / 16ms 基准帧）。
2. 下游 pointer 触控旁路与图片拖拽/选中让位 guard 不再需要——引擎浮动对象画在 canvas 层、事件天然穿透到容器接线。
3. 图片浮层 shift+wheel 横滚：下游 `image-layer.ts` 的 wheel 转发 + shift+deltaY→deltaX 换轴 capture 补丁可整体删除，引擎侧滚轮归宿主接线（`scrollBy(deltaX, deltaY)`），demo smoke 已有「浮动图上 shift+wheel 驱动横向滚动」断言；shift+deltaY→deltaX 换轴（Chrome 不自动换轴）属宿主滚轮接线职责，下游迁移时在其接线内保留 3 行换轴即可。

行为锚点：`packages/core/tests/list-table-interaction.test.ts`（甩动惯性接管/衰减停止、轻点无惯性）与 demo smoke 触控滚动断言。

## 二、测试改写重灾区清单

ultra-ui 侧测试对 VTable 实例的依赖集中在三类手法，逐类给等价替换：

| 重灾区 | 现状手法 | infinite-table 侧等价做法 | 先例 |
| --- | --- | --- | --- |
| grid 层 11 个 vitest 的 `getTable()` 直调 | 测试拿 VTable 实例直调内部方法断言 | 改持 `ListTable` 公开面（本表第二节的同名/等价方法）；维度/合并等状态断言改走 SheetStore | `packages/plugins/tests/sheet/`（注入 StubHost 构造实例、公开 API 断言） |
| `fireListeners(EVENT_TYPE.X, payload)` 事件模拟 | 手工向 VTable 派发内部事件 | ① 状态类：直接调公开 API（`selectCells/setFrozenColCount/...`）后断言订阅回调；② 指针类：合成 DOM 事件驱动（`dispatchPointer` 模式）；③ 编辑类：`startEdit/commitEdit` API + 假文档 | `apps/demo/src/smoke.ts`（合成事件全先例）、`packages/core/tests/list-table-interaction.test.ts`、`tests/editing/edit-manager.test.ts`（FakeDoc） |
| 无 canvas 环境挂载 | ultra-ui 已踩「element 未挂载」坑，测试侧绕行 | happy-dom 直接挂载（引擎容忍 null 2d 上下文） | `packages/core/tests/happy-dom/mount.test.ts` |
| formula-bar 组件测试（镜像引擎编辑态） | mock VTable 实例事件 | `onEditStart/onEditEnd` 真实事件驱动；编辑器元素经容器 DOM 查询（demo formula-bar.ts 先例） | `apps/demo/src/sections/sheet/formula-bar.ts` |
| sheet-component 测试（渲染快照/交互） | VTable DOM 结构选择器 | canvas 分层结构：按 `canvas[data-layer-kind]` 选择器定位；像素断言用页内冒烟模式（dpr 锁 1） | `apps/demo/scripts/smoke.mjs` + `smoke.ts` 的像素断言先例 |

替换期间 ultra-ui 侧测试策略：grid 单测随重写逐文件迁移（旧 fireListeners 用例不迁移、按上表重写）；组件/e2e 层最后动。

## 三、Playwright e2e 跑法（4 个）

ultra-ui `packages/sheet` 的 4 个 Playwright e2e 的迁移原则：**驱动层不动、被测实现层替换**。

1. **保留**：e2e 的页面驱动（打开 playground、键盘/鼠标操作、断言 DOM/截图）全部不变——它们走 `SheetGrid` facade 之上的 Vue 层，而 Vue 层（`@veltra/sheet`）基本不替换。
2. **需要核对的点**（每条 e2e 过一遍）：
   - 选择器若命中 VTable 特有 DOM（内部容器类名、canvas 生成结构），改为 infinite-table 的稳定选择器：容器 `[data-layer-kind]` 分层 canvas、编辑浮层 `textarea/input`；
   - 等待策略若依赖 VTable 渲染完成信号，改等 `?smoke=1` 同款的帧收敛（infinite-table 失效单帧收敛，无异步 scenegraph 重建等待）；
   - 断言画布像素的用例：宿主容器 dpr 锁 1（demo `resolveDpr` 先例）。
3. **跑法**：替换分支上 `pnpm test:e2e`（ultra-ui 既有命令）逐条跑绿；任何一条连绿三轮再进下一灰度级。

## 四、灰度顺序与回退点

```
第 0 级（准备）：infinite-table 侧全量验证（bun run test / demo smoke / bench headless）全绿
     ↓
第 1 级：playground `sheet-big-data` 页面切 infinite-table 底座
  - 改动点：playground 该页的 grid 装配换 SheetBook + SheetStore 装配（参照 apps/demo/src/sections/sheet.ts）
  - 验证点：该页手工回归（滚动/冻结/合并/编辑/填充/右键）+ 4 个 e2e 中涉及 sheet 的用例
  - 回退点：装配开关切回 VTable 实现（facade 不变，页面其余部分无感）
     ↓
第 2 级：`packages/sheet`（正式组件）整体切换
  - 改动点：`sheet-core/src/grid/` 10 文件重写为 infinite-table 适配（按本文第一节映射表逐条落），
    GridSyncManager/编辑器路由/样式解析器的 VTable 绕坑代码全部删除（模型直挂、公开能力、实例级注册表）
  - 验证点：sheet 单测迁移完成（第二节清单）→ 4 个 e2e 连绿三轮 → playground 全站回归
  - 回退点：git revert 重写提交（grid/ 旧实现保留到第 2 级稳定一个迭代后删除）
```

两级共同的验收底线：**适配层 import 面仅两包公共入口**（对照 `docs/plugin-interface-map.md` 红线）；bench sheet 四场景阈值全过（性能不回退）。

## 五、替换后可以删掉的 ultra-ui 代码（清单）

- `grid-sync-manager.ts` 的 BATCH_FULL_REBUILD_THRESHOLD 与 records 全量重放路径（模型直挂免重放）；
- `grid-editor-router.ts` 的单例 WeakMap 路由与泄露坑绕行注释（#1 修复）；
- `sheet-grid.ts` 的 `_canResizeRow` 猴补丁、`customLayout` 关 fast-update 绕行注释、`patchColumnHeaderDragExpand` 表头拖选连续扩展私有补丁（引擎已内置）；
- 逐列 `setColWidth` 触发 scenegraph 全重建的绕行计数逻辑（infinite-table 列宽更新走增量失效）；
- sheet-core `bindTouchScroll` 手写触控滚动（约 156 行，引擎内置触控 + 惯性直接替换，参数差异见第一节第 7 节）；
- `image-layer.ts` 的 wheel 转发 + shift+deltaY→deltaX 换轴 capture 补丁（引擎侧滚轮归宿主接线 `scrollBy(deltaX, deltaY)`；换轴 3 行保留在宿主滚轮接线内）。
