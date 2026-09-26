# Canvas 表格溢出渲染调研（s9-render-polish / P4）

调研 Luckysheet / Univer / x-spreadsheet 三个开源 Canvas 表格的溢出实现，作为 P5 引擎溢出语义重整的设计依据。每项结论给到源码级出处（项目 / 文件 / 函数 / 行号）；行号以调研当日（2026-09-25）拉取的分支快照为准：

- Luckysheet：`dream-num/Luckysheet` master 分支快照（v3.x 结构，`src/` 非构建产物）
- Univer：`dream-num/univer` dev 分支快照（monorepo，`packages/`）
- x-spreadsheet：`myliang/x-spreadsheet` master 分支快照（v4）

## 1. Excel / WPS 桌面版实测口径（行为终判依据）

本节为溢出语义的终判依据。口径按公开文档可复现行为记录，并与三个参照项目的实现互证（三项目在关键行为上一致收敛，见 §2–§4）；逐项标注置信度，其中一项（冻结带边界）标注待桌面复核。

| # | 行为 | 口径 | 置信度 |
| --- | --- | --- | --- |
| 1 | 溢出方向 | 左对齐（含缺省 General 的文本）向右溢；右对齐向左溢；居中对齐向两侧溢。数字 / 布尔永不溢出（过窄显示 `####` 或科学计数） | 高（三项目一致：Luckysheet `draw.js:1998-2025` 按 `ht` 分向；Univer `sheet.render-skeleton.ts:1068-1075` 按 `HorizontalAlign` 分向且 `1145-1150` 排除 NUMBER/BOOLEAN） |
| 2 | 走廊停止条件 | 溢出止于首个「非空」邻居：有值（含公式结果为非空）即停；不跳过非空格继续找空格（无洞穿越） | 高（Luckysheet `cellOverflow_trace` `draw.js:2094-2098`；Univer `_isOverflowSideBlocked` `sheet.render-skeleton.ts:1098-1112`） |
| 3 | 格式不阻断 | 邻居仅设背景色 / 字体等格式但无内容时，溢出照常画在其上（阻断只看内容与格性质，不看样式） | 高（Luckysheet `isRealNull` 只判值 `validate.js:16-22`；Univer `isCellCoverable` 只判 v / 富文本 p 与 coverable 标志 `core/src/shared/common.ts:127-142`） |
| 4 | 合并区 | 合并主格文本不溢出（裁剪在合并块内）；合并块作为非空格阻断他人溢出 | 高（Luckysheet 源格排除 `cell.mc != null` `draw.js:1993`、走廊被 `cell.mc != null` 阻断 `draw.js:2094-2098`；Univer `intersectMergeRange` 双向阻断 `sheet.render-skeleton.ts:1152-1155,1109-1111`、`core/src/sheets/sheet-skeleton.ts:487-490`） |
| 5 | wrap 换行 | 开启自动换行的格不参与溢出（源格不溢、走廊格按非空对待由换行文本自然阻断） | 高（Luckysheet `tb=="2"` 走换行分支不进溢出图 `draw.js:1993`（仅 `tb=="1"` 进图）+ `getRowlen.js:545,610,722`；Univer 仅 `WrapStrategy.OVERFLOW/UNSPECIFIED` 进 `_calculateOverflowCell` `sheet.render-skeleton.ts:1146`） |
| 6 | 冻结带 | 溢出文本不越过冻结窗格分界线（视觉上在分界线处截断） | 中（Luckysheet / Univer 均由「每个窗格独立画布 / 独立视口裁剪」达成：Luckysheet `freezen.js:499-519` 逐窗格 createCanvas；Univer 按 ViewPort 裁剪。Excel 桌面版逐像素口径待复核，采纳保守结论「不越带」，与本仓 spec 既定一致） |
| 7 | 空白字符 | 邻居内容为纯空白字符时是否阻断：Excel 中含空格的格非空、阻断溢出 | 中（Luckysheet `isRealNull` 把纯空白视为空、不阻断 `validate.js:16-22`，与 Excel 相反；Univer `isEmptyCell` 只认长度 0，空白串阻断，与 Excel 一致 `common.ts:127-137`。采纳 Univer / Excel 口径） |
| 8 | 两源对溢 | 同一空段两侧源同时向中间溢出、走廊重叠时，两段文本按确定性次序叠画（不做相互让位截断） | 中（Univer 行主序后画者赢，无让位逻辑；Luckysheet `cellOverflow_colIn` 每格只记录一个源、后扫到的覆盖先前的 `draw.js:2060-2066`。低频边界，采纳确定性次序即可） |
| 9 | 溢出文本锚点 | 溢出文本的对齐锚点固定在源格（居中格文本以源格中心对称展开，被截断侧在走廊边界裁掉），不因单侧走廊变短而重新居中 | 高（Luckysheet `cellTextRender` 按源格 `ht` 锚定 `draw.js:2214+`；Univer 普通文本路径文本盒保持源格 `startX/endX`、仅 clip 扩到走廊 `extensions/font.ts:529-623`） |

引擎自有类型对 #2 的扩展（写入 spec 的口径，Excel 无对应概念）：图片格、自定义渲染格、checkbox 格按「非空格」对待，阻断溢出（见 §7 取舍 5）。

## 2. Luckysheet 溢出实现

主绘制入口 `luckysheetDrawMain`（`src/global/draw.js:384`），单 canvas 全量重绘（无脏区），每帧流程：清屏 → 网格线 / 背景 / 单元格内容逐格画（行主序）→ 溢出文本在行内即时插入绘制。

### 2.1 溢出走廊 / 裁剪计算

- 溢出候选与走廊构建：`getCellOverflowMap(canvas, col_st, col_ed, row_st, row_end)`（`draw.js:1956`）。对可视区间每行全列扫描，源格条件：`cell != null && (!isRealNull(cell.v) || isInlineStringCell(cell)) && cell.mc == null && cell.tb == "1"`——有值、非合并、换行模式为「溢出」（`tb` 三态见下）；再判文本测量宽超列宽（`draw.js:2011-2013` `end_c - start_c < textMetrics`）。
- 走廊走查：`cellOverflow_trace(r, curC, traceC, traceDir, horizonAlign, textMetrics)`（`draw.js:2082`）。从源格向溢出方向逐格递归：越界停；被查格 `cell != null && (!isRealNull(cell.v) || cell.mc != null)` 停（非空或合并即阻断，纯样式格不阻断）；每步把剩余需宽 `w = textMetrics - (end_curC - start_curC)` 叠加到当前跨度上，与下一格边界比较，决定文本是否伸入该格，递归至文本放得下（`success: true` 返回走廊端列）或被阻断。
- 走廊端点：`getCellOverflowMap` 内按对齐组装 `stc/edc`（`draw.js:1998-2025`）：居中（`ht=="0"`）双向 trace；左对齐（`ht=="1"`）只向右；右对齐（`ht=="2"`）只向左。
- 裁剪：`cellOverflowRender`（`draw.js:1870`）把源格文本一次性画在整条走廊上，clip 矩形为走廊矩形（`rect(pos_x, pos_y, cellWidth, cellHeight); clip()`，`draw.js:1909-1912`，起止为 `visibledatacolumn[stc]`/`[edc]`，宽高各内缩 2px）；文本内部布局由 `getCellTextInfo` 测量、`cellTextRender`（`draw.js:2214`）按源格对齐锚点绘制。
- `tb` 三态（换行模式）：`"1"`=溢出、`"2"`=换行、`"0"`=截断，见工具栏映射 `src/controllers/menuButton.js:3849-3857` 与菜单项 `menuButton.js:1978-2003`；换行行高按 `tb=="2"` 计算（`src/global/getRowlen.js:545,610,722`）。

### 2.2 与网格线 / 边框 / 背景的绘制次序与 z 序

- 网格线与边框在内容之前画（边框循环 `draw.js:1060-1140` 在单元格循环之前），溢出文本靠「跳线」避免被压：边框循环对走廊覆盖格跳过竖向线——左线仅当该格是走廊首列才画、右线仅当是走廊末列才画（`draw.js:1085,1100`，经 `cellOverflow_colIn` 查询）；逐格网格线同样跳过走廊内的右缘线（`draw.js:1349-1361`，`!colIn || colLast` 才画右线）。
- 溢出文本的绘制时机内嵌在逐格循环里：行主序走到走廊末列格（`colLast`）时调用 `cellOverflowRender`（`draw.js:1332-1351`；空格路径 `nullCellRender` 内同逻辑 `draw.js:1536-1552`），此刻走廊内全部格（含背景）已画完，其后只有走廊右侧格的绘制，无重叠——文本天然压在走廊内全部背景与线上。这是「跳线 + 行内即时插入」的组合，而非第二遍补画。

### 2.3 阻断溢出的邻居状态判定

见 §2.1：值非空（`isRealNull`，纯空白串视作空 `src/global/validate.js:16-22`）或合并（`cell.mc != null`）即阻断。不检查图片、条件格式、自定义渲染；隐藏列格不作走廊候选（`draw.js:1985-1987`），但可被穿越（trace 不查 `colhidden`）。

### 2.4 对齐方向语义

`ht`：`"0"` 居中 → 双向；`"1"` 左 → 向右；`"2"` 右 → 向左（`draw.js:1998-2025`）。与 Excel §1#1 一致。

### 2.5 性能手段

- `measureText` 全局缓存：`Store.measureTextCache` / `Store.measureTextCellInfoCache`（`draw.js:402,1159-1161`）。
- 溢出图按行缓存：`Store.cellOverflowMapCache[r]`（`draw.js:1966-1967,2075`），滚动帧复用。
- 粗粒度失效：绘制结束起 100ms 空闲后一次性清空上述全部缓存（`draw.js:1159-1163` setTimeout）——编辑后短窗口内滚动用旧图，存在过期溢出图的已知风险，靠「空闲即清」兜底。
- 冻结窗格逐窗格独立 canvas（`src/controllers/freezen.js:499-519`），走廊计算与绘制按窗格列区间截断，溢出天然不越窗格界。

## 3. Univer 溢出实现

Univer 把「溢出区间计算」放在骨架层（skeleton），「绘制」放在渲染扩展层，两者经 `overflowCache` 解耦。

### 3.1 溢出走廊 / 裁剪计算

- 骨架侧入口：`SpreadsheetSkeleton._calculateOverflowCell(row, column, docsConfig, hasMergeData)`（`packages/engine-render/src/components/sheets/sheet.render-skeleton.ts:1125`），在建格样式 / 字体缓存时逐格调用（`sheet.render-skeleton.ts:1573`）。仅 `WrapStrategy.OVERFLOW / UNSPECIFIED` 且值类型非 NUMBER / BOOLEAN 参与（`1145-1150`）；合并格直接返回（`1152-1155`）。
- 走廊走查：`getOverflowPosition`（`sheet.render-skeleton.ts:1057-1081`）按对齐决定走查方向与需宽（居中各半 `contentWidth/2`，右对齐向左全宽，其余向右全宽），调用 `SheetSkeleton._getOverflowBound(row, startColumn, endColumn, contentWidth, horizontalAlign)`（`packages/core/src/sheets/sheet-skeleton.ts:493-545`）迭代累计列宽直至覆盖文本宽或被阻断，返回走廊端列。与 Luckysheet 的递归逐格「剩余宽」不同，Univer 是迭代「累计宽」，以文本宽为提前止步条件。
- 结果缓存：`appendToOverflowCache`（`sheet.render-skeleton.ts:1048-1055`）写入 `_overflowCache: ObjectMatrix<IRange>`（`294`，getter `391`，重置 `428,1352`）。
- 增量滚动：可视列区间向两侧各扩 `EXPAND_SIZE_FOR_RENDER_OVERFLOW = 20` 列补算字体 / 溢出缓存，遇非 coverable / 合并格提前止步（`sheet.render-skeleton.ts:545-612`；常量 `extensions/../constants.ts:24`）——解决「源格在视口外、走廊伸进视口」的可见性。

### 3.2 阻断溢出的邻居状态判定

- `_isOverflowBlockedByAdjacentCell`（`sheet.render-skeleton.ts:1083-1096`）：居中需左右两壁同时被阻断才算阻断（单侧空则向空侧溢）；右对齐只看左壁；左对齐（含缺省）只看右壁。
- `_isOverflowSideBlocked`（`1098-1112`）：越界即阻断；邻居原始格或字体缓存格非 coverable 即阻断；邻居落在合并区内即阻断。`isCellCoverable` = `isEmptyCell`（无 v 且无富文本 p，`core/src/shared/common.ts:127-137`）且未被 `coverable === false` 标记（`common.ts:139-142`）——纯样式格不阻断（§1#3），空白串阻断（§1#7）。

### 3.3 与网格线 / 边框 / 背景的绘制次序与 z 序

主组件 `Spreadsheet._drawAuxiliary`（`packages/engine-render/src/components/sheets/spreadsheet.ts:930-1045`）先画整幅网格线，随后**擦除**走廊区间内的网格线：`_clearRectangle(..., overflowCache.toNativeArray(), ...)`（`1057-1063`，注释 "clear line of overflow cell"）。之后按扩展次序绘制：背景扩展 → 其余扩展（边框、字体）（`spreadsheet.ts:364-407`）：

- 背景扩展先画全部格背景（`extensions/background.ts`）——溢出文本（字体扩展阶段）画在走廊内空格背景之上（§1#3）。
- 边框扩展画格线时跳过走廊内竖向线：`_getOverflowExclusion`（`extensions/border.ts:183-213`）——走廊内（非首列）的左线、走廊内（非末列）的右线不画（上 / 下线不受影响）。
- 字体扩展最后画全部文本：溢出源格经 `_clipByRenderBounds`（`extensions/font.ts:529-623`）把 clip 从本格扩到走廊矩形（居中扩到整条走廊、右对齐扩到 `startColumn..col`、其余扩到 `col..endColumn`，`563-613` 调 `_clipRectangleForOverflow` `760`），文本盒保持源格（`619-622` 写回不变）——锚点不随走廊漂移（§1#9）；普通格 clip 在本格（`614-618`）。

即 Univer 的 z 序保证是「分层扩展序」：背景（全部）→ 边框（全部，跳走廊线）→ 文本（全部）——溢出文本统一晚于全部背景与边框，无需对走廊节点做树内重排；文本与文本之间按行主序（两源对溢见 §1#8）。

### 3.4 对齐方向语义

`HorizontalAlign.CENTER` 双向、`RIGHT` 向左、其余（含 UNSPECIFIED 缺省）向右（`getOverflowPosition` `sheet.render-skeleton.ts:1068-1075`）；旋转文本的缺省对齐特判（`1130-1141`，对应 univer-pro#334）。与 Excel §1#1 一致。

### 3.5 性能手段

- 溢出区间随字体缓存一并计算并缓存（`_stylesCache.fontMatrix` / `_overflowCache`），滚动增量只补算 diff 区间与两侧 20 列扩展带（§3.1）。
- 便宜的溢出预判：`mayOverflowCurrentColumn = Boolean(documentSkeleton) || rawText.length * 4 > currentColumnWidth`（`1161`），按字符数粗估免走测量。
- 测量缓存：`FontCache.getMeasureText`（`1171` 调用）；数字溢出文本 `####` 直接按 `#` 宽度取整重复（`getNumberOverflowText` `103-109`），General 数字降有效位凑宽（`getGeneralNumberDisplayText` `119-153`）。
- 文本绘制走富文本文档骨架（`_renderDocuments`）或普通路径（`_renderText` `extensions/font.ts:625-670`），换行 / 旋转复用文档骨架分页能力。

## 4. x-spreadsheet 溢出实现

**不实现溢出**。这是三项目中的「零实现」参照：所有单元格内容被 clip 在自身矩形内。

- 逐格绘制：`renderCell`（`src/component/table.js:44-99`）→ `draw.rect(dbox, cb)`（`src/canvas/draw.js:381-394`）：`ctx.rect(格矩形内缩 1px); ctx.clip()` 后填背景并执行文本回调——无论对齐与内容，超格文本一律被格矩形裁掉（视觉等价于 Excel 的「截断」模式，且无省略号）。
- 文本绘制：`Draw.text`（`draw.js:218-270`）只处理换行（`textWrap` 参数，逐字符贪心断行）与对齐锚点，无走廊、无邻居判定、无省略号。
- 绘制次序：每视图区先网格（`renderContentGrid` `table.js:259`）后单元格（`renderContent` `table.js:125-165`，行主序：背景 → 边框 → 文本）、再表头（`table.js:325-360`）；冻结区按独立视图区平移绘制（`table.js:340-360`），同一 canvas。
- 性能：无测量 / 走廊缓存，每帧对可视区全量重画。

对照价值：x-spreadsheet 证明了「格内 clip + 逐格全量」模型若不做第二遍 / 插入式溢出绘制，溢出语义无法成立——溢出本质是跨格绘制次序问题，不是文本排版问题。

## 5. 三项目机制对照

| 维度 | Luckysheet | Univer | x-spreadsheet |
| --- | --- | --- | --- |
| 走廊计算 | 逐行构建溢出图 + 递归逐格 trace（剩余宽） | 骨架逐格计算 + 迭代累计宽走查，结果入 `overflowCache` | 无 |
| 停止条件 | 值非空 / 合并（空白串不阻断） | 非 coverable（空白串阻断）/ 合并 / 越界 | 无（一律格内裁） |
| 裁剪 | 源文本一次画满走廊，clip=走廊矩形 | clip 从本格扩到走廊（按对齐定向），文本盒保持源格 | clip=本格矩形 |
| 网格线 / 边框 | 走廊内竖线跳画（边框循环 + 逐格右线） | 先整幅画线再对走廊 `_clearRectangle` 擦除；边框扩展跳走廊内竖线 | 无处理（无溢出） |
| z 序 | 行内即时插入：行主序走到走廊末列时画溢出文本（跳线兜底） | 扩展分层序：背景 → 边框 → 字体，文本统一最后 | 无 |
| 对齐语义 | 中双向 / 左向右 / 右向左 | 同左（+ 旋转缺省对齐特判） | 无 |
| 合并区 | 源与走廊均排除 `mc` | `intersectMergeRange` 双向阻断 | 合并格单独重画（仍格内裁） |
| 冻结带 | 逐窗格独立 canvas，天然不越界 | 逐 ViewPort 裁剪 | 逐视图区绘制（无溢出可谈） |
| 性能 | measure 缓存 + 按行溢出图缓存 + 100ms 空闲粗失效 | 字体 / 溢出缓存随骨架增量维护 + 视口外扩 20 列 + 字符数预判 | 无缓存 |

共识结论：三项目中两个实现了溢出的项目，走廊判定都是「内容阻断」而非「样式阻断」；溢出方向语义完全一致；都把「溢出文本不被走廊内线 / 背景覆盖」作为绘制次序问题解决（跳线 / 擦线 + 文本后画），而非文本排版问题。

## 6. 本引擎现状（infinite-table，调研当日快照）

以下为调研当日（2026-09-25，S9-P4）的引擎快照，行号与符号名同首段「调研当日」口径，不再代表现行实现。sheet-ux-fixes-2/3 后：走廊为按对齐双向走查且按文本缘收边（`textOverflowLimits` / `corridorCols`），clip 按对齐取走廊界 `[textMinX, textMaxX]`，走廊覆盖范围内竖线跳画（`CellNode.corridorInterior`，`paintBorders` 判定 `corridorInterior > col + 1`），z 序重挂双向化（含左溢 `textMinX < 0`）并按行重标走廊内部标记，测量缓存为 `measureTextWidthWith`（测量函数注入，绘制侧与场景侧共用）。现行实现与逐项取舍见 §7 各条正文与修订记录。

- 走廊：`textOverflowLimitX`（`packages/core/src/list-table-scene.ts:563-594`）——仅左对齐溢出到右侧连续空格，遇非空格停，不越冻结列带（`bandEnd`）与末列；`isEmptyTextCell`（`548-556`）定义非空（text 类型、无自定义渲染、无图片、非合并覆盖、取值文本非空）。显式 `textOverflow`（ellipsis/clip）、`textWrap`、checkbox、合并、图片格不溢出。
- 绘制：`renderTextCell`（`packages/core/src/cell-renderer.ts:119-167`）——未设溢出样式时左对齐溢出画进右侧空格（clip 右界 `textMaxX`），中 / 右对齐裁剪在本格；溢出锚点在源格（`alignedX`），仅 clip 扩界。
- 节点绘制序：`CellNode.paint`（`packages/core/src/cell-node.ts:122-154`）——背景 → （溢出格右缘线先画）→ 内容 → 边框；溢出文本盖本格右缘共享网格线。
- z 序：全量重建带内列降序建格（左格后画）；增量窗口滚入行列降序补建 + 对 `textMaxX > width` 的存活溢出格按列升序重挂树尾（`packages/core/src/list-table-scene.ts:157-187` 契约注释、`256-300` 步骤③）；表头容器 / 外框恒为树尾。
- 数据联动：`refreshCellNode`（`packages/core/src/list-table.ts:513-584`）——本格变空 / 变非空 / 保持为空时重算自身 `textMaxX` 并经 `overflowSourceCol`（`list-table-scene.ts:600-608`）联动左侧源格走廊，新旧溢出区并入失效区域；编辑会话锚定格隐藏含溢出走廊（`setCellContentHidden`）。
- 测量缓存：`CellNode.measureTextWidth`（`packages/core/src/cell-node.ts:174-190`）按 font 串 / text 变更失效。
- 已知边界：溢出源在可视窗左侧窗外时，窗内走廊段无溢出文本（全量重建与增量窗口行为一致，逐像素一致但语义缺失；Univer 以外扩 20 列解决同类问题，见 §3.1）。

## 7. 本引擎采纳的设计与逐项取舍（P5 实施依据）

1. **走廊算法选型：按需逐格走查，走廊端点由文本缘收边（sheet-ux-fixes-3 修正）。**
   现状 `textOverflowLimits` 已是建格 / refresh 时的按需计算，按对齐方向双向走查：left/center 向右、right/center 向左。**修订记录（sheet-ux-fixes-3）**：本条「不按文本宽提前止步、走廊按空段扫满至阻断点」已被推翻。原口径（走廊端点只由邻居内容与带边界决定）让**每条文本都按整段空区跳画竖线**：两处 playground 演示页（`apps/playground` 与 `../ultra-ui/playground`）里真正造成整片竖线消失（第 G 列起）的是 `示例图→`（F1）、`a`（E2）、`b`（E3）、`84`（B4）这类右邻整段为空的短文本——旧口径下它们的走廊一路扫到 26 列带尾，第 G 列往右的竖线在数据行被整片跳画，观感即「网格线凭空消失」（用户截图红框圈的是 B 列数值，但大片缺失实际发生在 G 列起）；而 `135`（B1）/ `84`（B2）/ `67.5`（B3）右侧隔列即被内容阻断，旧口径下只吞掉 B/C 一条边界线，并非成片消失的成因。三个参照实现都不这么做。现口径与 Luckysheet `cellOverflow_trace`（按「剩余需宽」递归至文本放得下）与 Univer `_getOverflowBound`（迭代累计列宽至覆盖文本宽）一致：先按内容盒与对齐锚点求文本左右缘（`cellContentBox` / `cellTextAnchorX` 与 `renderTextCell` 同源），再向溢出方向逐列收边——只有列边界落在文本缘内的空格才纳入走廊，遇首个非空格提前停；文本未越出本格则无走廊（竖线全画），越出 N 列则只跳画这 N 列的竖线。代价与收益：文本宽参与走廊端点后，本格文本增减会牵动自身走廊（refreshCell 现有 `textMaxX/textMinX` 比对即覆盖，无需新增联动）；测量经 `CellNode.measureTextWidthWith` 复用绘制同一缓存（font/text 未变零重测，滚动帧重标走廊不新增测量），性能取舍不变。原「扫满」理由中的「端点与文本宽解耦」不再成立，但三重建路径逐像素一致（全量重建 / 滚动增量 / refreshCell 共用 `corridorCols`）仍成立。拒绝 Luckysheet 的整行溢出图 + 100ms 空闲粗失效（§2.5）：失效粒度与引擎三档失效模型冲突，且「滚动帧复用旧图」有过期风险；拒绝引入 Univer 的视口外扩 20 列缓存带（§3.1）：引擎窗口模型是精确装配，等价能力可由「窗缘列反查溢出来源」以更小成本达成（见取舍 8）。
2. **与网格线 / 边框 / 背景的绘制次序：走廊内竖线跳画（WPS / Luckysheet 口径），不做整幅擦线。**
   **推翻记录（sheet-ux-fixes-2 P3）**：本条原为 S9-P5 的「覆盖式」取舍——溢出文本直接盖走廊内共享网格线与空格背景，不引入跳线 / 擦线，理由是跳线要求绘制侧感知跨格走廊状态、与「节点自治绘制 + 共享边逐格裁决」（`effectiveBorder`）冲突。实际观感是溢出文本虽靠 z 序后画，但字形间隙与文字上下区域的走廊竖线仍可见（「表格线压字」类伪影），与 WPS / Luckysheet（§2.2）不符，故 P3 起改为走廊竖线跳画：场景装配逐行维护「走廊内部」标记（`CellNode.corridorInterior`——覆盖本格各走廊的最大右端列号，null = 不在任何走廊内；`markRowCorridorInterior` 先清后标，扫描复用 `corridorCols` 与 `textOverflowLimits` 同一实现，全量重建 / 滚动增量 / `refreshCell` 三路径同口径），right 共享边仅当本格与右邻同处同一走廊内部才绘制（跳画判定 `corridorInterior > col + 1`，`cell-node.ts` `paintBorders`）：溢出源格朝走廊侧竖边与走廊内部空格间共享竖线跳画，走廊末端竖线（文本缘与首个非空格左缘中的先至者，见取舍 1 修订记录）与走廊外竖线照常绘制，上下横边、背景、内容绘制不受影响，用户显式纵向边框与默认网格线同规则（不破坏 shared-edges 归属与 stronger 合并语义）；Univer 的整幅擦线（§3.3）仍不采纳。空格背景不阻断溢出（§1#3），溢出文本仍靠 z 序不变量（取舍 3）后画于走廊格背景之上，对齐 Excel。
3. **z 序不变量：溢出源节点后画于同条带全部走廊节点（spec 验收口径），经既有「溢出格重挂树尾」机制推广到双向。**
   全量重建「同行左格后画」（列降序）只对右溢成立；右溢源在走廊左端，列降序天然后画；左溢源在走廊右端，列降序会让走廊节点反盖文本——因此重挂机制必须同时覆盖右溢与左溢源（`textMaxX > width` 之外增加左溢判定），重挂集合内部次序取列升序（与 Univer 行主序等价，两源对溢时右溢源先、左溢源后，§1#8 的确定性次序）。重挂集合两两无绘制交叠的前提（走廊只含空格、文本右 / 左缘不越走廊末端）在双向下仍成立，唯两源对溢共享空段时例外（§1#8，接受叠画）。
4. **center / right 对齐语义（结论）：center 双侧溢、right 向左溢，阻断判定按 Univer 语义——center 两壁皆阻断才算阻断（单侧空即向空侧溢），right 只看左壁；锚点恒在源格。**
   三个参照系（Excel §1#1/#9、Luckysheet §2.4、Univer §3.4）完全一致，无分歧。实现形态：`renderTextCell` 的 clip 区间从单向 `textMaxX` 扩为 `[textMinX, textMaxX]`，对齐锚点 `alignedX` 不动（锚在源格内容盒）；`CellNode` 增加左溢下界，编辑隐藏、失效区域同步扩双向。
5. **阻断判定：维持内容判定（`isEmptyTextCell`），扩展双向；图片 / 自定义渲染 / checkbox / 合并格按「非空」阻断（引擎自有类型扩展，spec 既定）。**
   Excel 无图片 / checkbox / 自定义渲染的格内概念，将其视为阻断是引擎语义的最小保守选择（自定义渲染器可画任意内容，覆盖其上必然产生伪影）。空白串处理采 Univer / Excel 口径（空白串阻断，§1#7），`resolveText` 产物原样判定。
6. **冻结带：走廊不越冻结列带边界（维持 `bandEnd` 口径）。**
   Luckysheet / Univer 经窗格裁剪达成同效果（§1#6）；引擎按带截断走廊是等价的更廉价实现，且规避 §1#6 待复核项。
7. **性能：走廊计算挂建格 / refresh 一次性，滚动帧零重算。**
   存活节点滚动平移不改变局部 `textMaxX/textMinX`（走廊端点随节点同步平移），滚动帧渐进复杂度不增（spec 验收项）；阻断扫描复用 `resolveText` / `resolveStyle` 既有管线，不新增测量（`measureTextWidthWith` 缓存已有）；溢出区失效区域合并维持 `refreshCellNode` 既有并区逻辑（`list-table.ts:569-616`，P5 双向化后行号）的双向化。`apps/bench` 阈值回归为 P5 验收项。
8. **窗外源可见性：P5 以「窗缘反查」补齐，不做外扩缓存带。**
   §6 已知边界（源在窗外、走廊伸入窗内不可见）与全量重建行为一致，不破坏逐像素一致性；P5 若收敛该语义，在窗口装配时对紧贴窗缘的列做一次 `overflowSourceCol` / 右侧对应反查并补建或挂接源绘制，成本 O(窗缘行数)，避免 Univer 每帧 20 列全量字体缓存的外扩成本。
9. **显式样式优先级不变：ellipsis / clip 显式样式仍截断、header 分区保留 ellipsis、wrap 格不参与溢出（现状 + spec 非目标）。**
   三项目中 Univer 的 `WrapStrategy` 枚举与本引擎 `textOverflow` + `textWrap` 组合一一对应；playground `sheetChromeTheme` body 分区去掉强制 ellipsis 属 P5 缺省值调整，不影响显式语义。

## 8. 源码出处索引

- Luckysheet（`src/global/draw.js` 除非另注）：`luckysheetDrawMain` 384；`nullCellRender` 1217；`cellOverflowRender` 1870；`getCellOverflowMap` 1956；`cellOverflow_trace` 2082；`cellOverflow_colIn` 2169；`cellTextRender` 2214；边框跳线 1085/1100；逐格右线跳画 1349-1361；缓存超时 1159-1163；`tb` 映射 `src/controllers/menuButton.js` 3849-3857；`isRealNull` `src/global/validate.js` 16-22；换行行高 `src/global/getRowlen.js` 545/610/722；冻结 canvas `src/controllers/freezen.js` 499-519。
- Univer：`packages/engine-render/src/components/sheets/sheet.render-skeleton.ts`——`getNumberOverflowText` 103、`_overflowCache` 294、增量区间 524-612、`appendToOverflowCache` 1048、`getOverflowPosition` 1057、`_isOverflowBlockedByAdjacentCell` 1083、`_isOverflowSideBlocked` 1098、`_calculateOverflowCell` 1125（调用点 1573）；`packages/core/src/sheets/sheet-skeleton.ts`——`intersectMergeRange` 487、`_getOverflowBound` 493；`packages/core/src/shared/common.ts`——`isEmptyCell` 127、`isCellCoverable` 139；`extensions/font.ts`——overflowRange 309、`_clipByRenderBounds` 529、`_renderText` 625、`_renderDocuments` 672、`_clipRectangleForOverflow` 760；`extensions/border.ts`——`renderBorderByCell` 99、`_getOverflowExclusion` 183；`spreadsheet.ts`——扩展次序 364-407、`_drawAuxiliary` 930、走廊擦线 1057-1063；`constants.ts`——`EXPAND_SIZE_FOR_RENDER_OVERFLOW` 24。
- x-spreadsheet：`src/canvas/draw.js`——`Draw.text` 218、`fillText` 196、`rect` 381；`src/component/table.js`——`renderCell` 44、`renderContent` 125、绘制次序 325-360。
- 本引擎：见 §6 各文件行号。
