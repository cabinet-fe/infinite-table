---
title: infinitable 性能与虚拟滚动
description: infinitable 大数据量实践：全量虚拟滚动窗口 O(1)、数据三形态选型（模型直挂免全量重放）、batchUpdate 批量写收敛、refreshCell 局部失效、图片窗口化加载与位图 LRU、容器 resize 原地自适应。完成后 100 万行表格的构造、滚动与写入性能不随数据量劣化。
aliases: [性能优化, 虚拟滚动, 大数据量, 百万行, 性能指南]
keywords: [虚拟滚动, 性能, 100万行, rowCount, records, model, 模型直挂, asModel, SheetStore, batchUpdate, updateCell, refreshCell, getVisibleRange, imageServiceOptions, resize, onScrollFrame, 大数据量, 失效, 局部刷新]
---

# infinitable 性能与虚拟滚动

本指南面向 10 万~100 万行场景：选对数据形态、用对写入 API、理解虚拟窗口与失效机制。完成后得到一个 100 万行可编辑表格——构造只建可视窗口内场景（O(1)）、滚动收敛为单条 band 失效、写入走 cell 级局部失效。适用 `infinitable` 0.1.x。

## 前置条件

- 已按 `guide/quick-start.md` 完成安装（`infinitable` + `@cat-kit/core`）与基础挂载。
- 大数据量来源：内存数组（records）或坐标模型（SheetModel/SheetStore）；远程分页数据用 `rowCount` + `resolveDisplayValue` 钩子按格取数。

## 步骤

1. 选数据形态（决策规则）：

   - 只读展示 10 万行以上：`records` 数组或 `rowCount` + `resolveDisplayValue`（纯 hook 形态零行对象分配，最快）。
   - 需要编辑回写：`model`（`SheetModel`/`SheetStore.asModel()` 模型直挂）——按格 O(1) 读写，免「批量写全量 setRecords 重放」绕法。
   - 三形态可叠加 `resolveDisplayValue`（作用于取值管线末端）。

   纯 hook 形态构造 100 万行：

   ```ts
   import { ListTable } from 'infinitable'

   const container = document.querySelector<HTMLDivElement>('#table')!
   const table = new ListTable({
     width: 1280,
     height: 720,
     columns: Array.from({ length: 20 }, (_, col) => ({ title: `列${col}`, width: 100 })),
     rowCount: 1_000_000, // 行数兜底：无 records、模型也未给 rowCount 时生效
     resolveDisplayValue: (col, row) => `${col}-${row}`, // 按格同步 O(1)
     hostOptions: { container },
   })
   ```

2. 批量写入收敛失效——大块写包进 `batchUpdate`，结束时只提交一次 band 失效：

   ```ts
   import { ListTable, SheetStore } from 'infinitable'

   const store = new SheetStore({ rowCount: 1_000_000, colCount: 20 })
   const container = document.querySelector<HTMLDivElement>('#table')!
   const table = new ListTable({
     width: 1280,
     height: 720,
     columns: Array.from({ length: 20 }, (_, col) => ({ title: `列${col}`, width: 100 })),
     model: store.asModel(), // 模型直挂
     hostOptions: { container },
   })

   table.batchUpdate(() => {
     for (let row = 0; row < 2000; row++) {
       table.updateCell(1, row, row * 3) // 回驱模型 + echo 派生格统一刷新
     }
   }) // 2000 次 cell 失效合并为一次 band 提交，一帧收敛
   ```

3. 单格/小批量写入走 cell 级局部失效：

   ```ts
   table.updateCell(0, 5, '新值') // 回写 + 该格 cell 级失效（records 形态直接改字段后调 refreshCell）
   table.refreshCell(0, 5) // 外部改了数据源的兜底刷新
   ```

4. 图片列给足 LRU 预算（图片窗口化加载：视口+余量内才发起请求、滚出即取消）：

   ```ts
   const table2 = new ListTable({
     width: 800,
     height: 600,
     columns: [{ title: '缩略图', width: 120 }],
     rowCount: 500_000,
     resolveCellImage: (_col, row) => `https://cdn.example.com/t/${row}.png`,
     imageServiceOptions: {
       maxCacheBytes: 512 * 1024 * 1024, // 解码位图 LRU（默认 256MB）
       maxCacheCount: 2000, // 默认 1000
       concurrency: 16, // 并发加载（默认 10）
     },
     hostOptions: { container: document.querySelector<HTMLElement>('#table2')! },
   })
   ```

5. 容器尺寸变化原地自适应（不重建实例、滚动与选区保留）：

   ```ts
   const resizeObserver = new ResizeObserver((entries) => {
     const rect = entries[0]?.contentRect
     if (rect) {
       table.resize(Math.round(rect.width), Math.round(rect.height))
     }
   })
   resizeObserver.observe(container)
   ```

6. 帧级滚动同步（水印跟随、编辑浮层跟随等场景）：

   ```ts
   const off = table.onScrollFrame((state) => {
     console.log(state.left, state.top) // 滚动帧上带最新位置（同帧多次滚动只触发一次）
   })
   ```

## 完整示例

步骤合并后的最终形态（100 万行模型直挂可编辑表），可直接复制：

```html
<!-- index.html 片段 -->
<style>
  #table {
    position: relative;
    width: 1280px;
    height: 720px;
  }
</style>
<div id="table"></div>
```

```ts
// src/main.ts
import { EditorRegistry, ListTable, SheetStore } from 'infinitable'

// 1) 模型直挂：SheetStore 是唯一事实源（值 O(1) 读写）
const store = new SheetStore({ rowCount: 1_000_000, colCount: 20 })
store.setFrozen({ colCount: 1, rowCount: 1 }) // Store 状态在构造前就位（SheetBook 场景自动接线）

const registry = new EditorRegistry()
registry.registerEditor('text', {})

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 1280,
  height: 720,
  columns: Array.from({ length: 20 }, (_, col) => ({
    title: `列${col}`,
    width: 100,
    editor: 'text', // 20 列全部可编辑（回写经 asModel().setCellValue 落 Store）
  })),
  model: store.asModel(), // 模型直挂：构造只处理可视窗口，与行数无关
  editorRegistry: registry,
  hostOptions: { container },
})

// 冻结（构造 options 也行；这里演示 Store 状态与引擎同步）
table.setFrozenColCount(1)
table.setFrozenRowCount(1)

// 2) 滚轮接线
container.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    table.scrollBy(event.deltaX, event.deltaY)
  },
  { passive: false },
)

// 3) 大块写：batchUpdate 收敛
const fill = document.querySelector<HTMLButtonElement>('#fill')!
fill.addEventListener('click', () => {
  table.batchUpdate(() => {
    for (let row = 1; row <= 5000; row++) {
      table.updateCell(1, row, row * 7)
    }
  })
})

// 4) 容器 resize 原地自适应
const observer = new ResizeObserver((entries) => {
  const rect = entries[0]?.contentRect
  if (rect) {
    table.resize(Math.round(rect.width), Math.round(rect.height))
  }
})
observer.observe(container)

// 5) 窗口与滚动状态查询
console.log(table.getVisibleRange()) // => { rows: { start: 0, end: 23 }, cols: { start: 0, end: 13 } }（视口内的行列区间）
console.log(table.getScrollState()) // => { left: 0, top: 0 }

table.onScrollFrame((state) => {
  // 帧级同步：滚动条位置镜像等
  void state
})

window.addEventListener('beforeunload', () => {
  observer.disconnect()
  table.destroy()
})
```

## 验证

```bash
bunx vite --open
# => 打开页面即渲染（构造不随行数劣化：100 万行构造 P50 12ms 量级）
```

浏览器控制台：

```ts
// 接完整示例的 table 变量
table.scrollTo(0, 32 * 500_000) // 跳转到第 50 万行附近
table.getVisibleRange() // => rows 窗口仍是 20 行左右（窗口 O(1)，与总行数无关）
table.updateCell(1, 500_000, 42) // 单格写：只有该格 cell 级失效
table.batchUpdate(() => {
  for (let row = 499_000; row < 501_000; row++) table.updateCell(1, row, 1)
}) // 2000 格批量写收敛一次 band 失效（一帧内完成）
```

量化基准口径（10 万行 × 20 列，1280×720，视行高 32/列宽 100）：构造 P50 1.70ms、TTFF P50 17.15ms、逐格写吞吐 316 ops/ms、大幅跳转 JS 耗时 P95 1.45ms；100 万行同口径：构造 P50 12.00ms、TTFF P50 16.70ms——数据量 ×10 首次渲染几乎不变。复现见仓库 README「复现基准」。

## 注意事项

> [!WARNING]
> - `resolveDisplayValue`/`resolveCellStyle`/`resolveCellRenderer`/`resolveCellImage` 全部要求纯函数、同步、O(1)：滚动帧每格高频调用，禁止在其中做请求、深拷贝或逐格计算缓存。
> - records 形态没有回写联动：改 `records[row].field` 后必须调 `refreshCell(col, row)` 才上屏；需要编辑回写用 model 形态（`updateCell` 自动回写 + echo 派生格刷新）。
> - `batchUpdate` 收敛的是失效提交，不是数据写入量：fn 内的写入逻辑照常执行，只是渲染一次收敛。
> - 窗口外行列没有场景节点：`getCellRelativeRect` 对窗口外格返回 null，`refreshCell` 对窗外格除「活跃溢出源」外为空操作——这是虚拟化的预期行为，不是丢数据。
> - `rowCount` 只是行数兜底：给了 `records` 时取 `records.length`，给了 `model` 时取 `model.rowCount`，都给时 model 优先。
> - 图片 LRU 逐出后再滚回会重新加载（一次占位/重载闪烁）：按场景调大 `imageServiceOptions.maxCacheBytes`/`maxCacheCount`。
> - `resize(w, h)` 与数据无关：它只改视口；改变行列数/尺寸分别走模型侧与 `setColWidth`/`setRowHeight`。
