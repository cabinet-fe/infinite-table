---
title: infinitable 快速上手
description: 从零安装 infinitable 并渲染第一个可滚动、可编辑、带主题的 canvas 表格：安装（含 peerDependency @cat-kit/core）、建容器、构造 ListTable、接线滚轮、订阅事件、销毁。完成后得到一个 10 万行虚拟滚动表格页。
aliases: [快速开始, 入门, quick start, infinitable 安装]
keywords: [infinitable, 安装, bun add, npm install, ListTable, createRenderHost, hostOptions, scrollBy, wheel, onCellChange, onSelectionChange, EditorRegistry, SheetModel, records, columns, 快速上手, 入门, 第一个表格, 虚拟滚动]
---

# infinitable 快速上手

本指南从空项目开始，完成一个 10 万行虚拟滚动、可双击编辑、带自定义主题的 infinitable 表格页。适用 `infinitable` 0.1.x 与浏览器 DOM 环境（Vite 项目；Vue/React 宿主把挂载代码放进对应生命周期即可）。

## 前置条件

- 运行时：现代浏览器（Canvas 2D、PointerEvent、ResizeObserver 无要求）；构建工具 Vite/webpack 均可（ESM 包）。
- 包管理器：bun / npm / pnpm / yarn 任一。
- peer 依赖：`@cat-kit/core@^1.2.1`（公式引擎精确计算依赖，必须与 `infinitable` 一起安装）。
- 不需要：`chart.js`（仅用图表插件时才装）。

## 步骤

1. 安装依赖：

   ```bash
   bun add infinitable @cat-kit/core
   ```

2. 准备 HTML 容器，写入 `index.html`：

   ```html
   <!-- index.html -->
   <!doctype html>
   <html lang="zh-CN">
     <head>
       <meta charset="utf-8" />
       <title>infinitable 快速上手</title>
       <style>
         /* 容器 position 非 static：四层 canvas 以绝对定位叠放其内 */
         #table {
           position: relative;
           width: 800px;
           height: 400px;
         }
       </style>
     </head>
     <body>
       <div id="table"></div>
       <script type="module" src="/src/main.ts"></script>
     </body>
   </html>
   ```

3. 创建表格并接线滚轮与事件，写入 `src/main.ts`：

   ```ts
   // src/main.ts
   import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

   // 1) 编辑器注册表：列定义 editor 引用注册名
   const registry = new EditorRegistry()
   registry.registerEditor('text', {})

   // 2) 数据：三形态任选，这里用内存坐标模型（可编辑）
   const model = new SheetModel(
     Array.from({ length: 100_000 }, (_, row) => [`ID-${row}`, `商品-${row}`, row % 97]),
   )

   // 3) 容器与表格
   const container = document.querySelector<HTMLDivElement>('#table')!
   const table = new ListTable({
     width: 800,
     height: 400,
     columns: [
       { title: '编号', width: 120, editor: 'text' },
       { title: '名称', width: 160, editor: 'text' },
       { title: '数量', width: 100 },
     ],
     model,
     editorRegistry: registry,
     frozenColCount: 1, // 冻结首列
     theme: { header: { background: '#dbeafe', textAlign: 'center' } },
     hostOptions: { container }, // 引擎自建四层 canvas 挂进容器
   })

   // 4) 滚轮接线（引擎内置触控/键盘/内建滚动条；鼠标滚轮由宿主接）
   container.addEventListener(
     'wheel',
     (event) => {
       event.preventDefault()
       table.scrollBy(event.deltaX, event.deltaY)
     },
     { passive: false },
   )

   // 5) 事件订阅
   table.onCellChange((change) => {
     console.log(`(${change.col},${change.row}) ${String(change.oldValue)} -> ${String(change.newValue)}`)
   })
   table.onSelectionChange((snapshot) => {
     console.log('选区段数', snapshot.ranges.length)
   })
   ```

4. 启动开发服务器：

   ```bash
   bunx vite --open
   ```

## 完整示例

步骤合并后的最终形态，可直接复制：

```html
<!-- index.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>infinitable 快速上手</title>
    <style>
      #table {
        position: relative;
        width: 800px;
        height: 400px;
      }
    </style>
  </head>
  <body>
    <div id="table"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```ts
// src/main.ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {})

const model = new SheetModel(
  Array.from({ length: 100_000 }, (_, row) => [`ID-${row}`, `商品-${row}`, row % 97]),
)

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 800,
  height: 400,
  columns: [
    { title: '编号', width: 120, editor: 'text' },
    { title: '名称', width: 160, editor: 'text' },
    { title: '数量', width: 100 },
  ],
  model,
  editorRegistry: registry,
  frozenColCount: 1,
  theme: { header: { background: '#dbeafe', textAlign: 'center' } },
  hostOptions: { container },
})

container.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    table.scrollBy(event.deltaX, event.deltaY)
  },
  { passive: false },
)

table.onCellChange((change) => {
  console.log(`(${change.col},${change.row}) ${String(change.oldValue)} -> ${String(change.newValue)}`)
})

// 页面卸载时销毁（幂等）
window.addEventListener('beforeunload', () => {
  table.destroy()
})
```

## 验证

```bash
bunx vite --open
# => 浏览器打开后：表格渲染列头（蓝底居中）+ 行号列 + 首列冻结
# => 鼠标滚轮滚动：只重绘滚动 band，100000 行与 100 行观感一致
# => 双击前两列任意格：出现 DOM 编辑浮层，Enter 提交后控制台输出 (col,row) oldValue -> newValue
# => 拖列头右缘：改列宽（最小 20px）
# => 点击左上角角点：全选
```

控制台验证查询 API：

```ts
// 浏览器控制台（接上面示例的 table 变量）
table.getScrollTop() // => 滚动位置
table.getVisibleRange() // => { rows: { start, end }, cols: { start, end } } 可视窗口（不含冻结区）
table.getBodyVisibleCellRange() // => 可视数据格范围（冻结行列并入）
table.getCellText(0, 0) // => 'ID-0'
```

## 注意事项

> [!WARNING]
> - `@cat-kit/core` 必须显式安装（peerDependency）：漏装时依赖 formulas 层的构建/运行会报找不到模块。
> - 容器 `position` 必须非 static（`relative`/`absolute`/`fixed`）：四层 canvas 绝对定位叠放，static 容器下画布会飘到页面左上角。
> - 鼠标滚轮不内置：漏接 `wheel → table.scrollBy` 时鼠标无法滚动（触控、键盘方向键、内建滚动条不受影响）。
> - 双击编辑需要三个条件齐备：列声明 `editor`、注册表有同名编辑器、有回写目标（model 形态恒有；records 形态列须有 `field`）。
> - `width/height` 是视口尺寸（CSS 像素），不是数据量；数据量由 `records.length`/`model.rowCount`/`rowCount` 决定。
> - 构造后销毁用 `table.destroy()`；再次使用须重新构造（destroy 后调用渲染方法行为未定义）。
