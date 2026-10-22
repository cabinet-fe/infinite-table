# 大数据量

这篇教程覆盖 10 万行与 100 万行两种规模：10 万行用模型直挂演示可编辑表格和 `batchUpdate`，100 万行用 `rowCount` + `resolveDisplayValue` 演示零行对象分配的只读表格。两种写法都能保持虚拟窗口 O(1)，滚动和首帧不随总行数线性增长。

<script setup>
import LargeDataDemo from '../.vitepress/theme/components/LargeDataDemo.vue'
import DemoBlock from '../.vitepress/theme/components/DemoBlock.vue'
</script>

## 在线演示

100 万行 × 8 列的真实实例。任意跳转都会在常数级时间内完成，下方会实时显示当前可视行区间。切换到「源码」可以直接查看这个演示的完整实现。

<DemoBlock>

<LargeDataDemo />

<template #source>

<<< @/.vitepress/theme/components/LargeDataDemo.vue

</template>

</DemoBlock>

## 场景说明

- 数据规模在 10 万到 100 万行，列数约 20。
- 需要先滚动到任意位置，再局部读写，不能接受每次操作都遍历全表。
- 只读场景优先用纯钩子；需要编辑回写时用模型直挂。
- 需要观测滚动帧和写入耗时，确认瓶颈不在业务侧回调。

## 数据形态怎么选

| 形态                               | 适用                               | 代价                                                        |
| ---------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `records` 数组                     | 数据本来就在内存里、只读或简单编辑 | 每行一个对象，100 万行时对象与字段开销明显                  |
| `model` 模型直挂                   | 需要按格 O(1) 读写、编辑回写       | 模型自己决定存储方式；`SheetModel` 会按行列数预分配二维数组 |
| `rowCount` + `resolveDisplayValue` | 只读、远程数据或可计算数据         | 没有行对象，取值逻辑必须纯函数、同步、O(1)                  |

三形态的优先级是 `model` > `records` > `rowCount`。`resolveDisplayValue` 可以叠在任意形态上，作用于取值管线末端。

## 10 万行：模型直挂与批量写

`SheetModel(rowCount, colCount)` 会按行列数预分配二维数组，适合 10 万行这个量级。构造只创建可视窗口内的场景节点，模型本身的分配与渲染窗口无关。

```html
<!-- 10 万行示例的容器与操作按钮 -->
<div id="table-model"></div>
<button id="fill">批量写 5000 行</button>
```

```css
#table-model {
  position: relative;
  width: 1280px;
  height: 720px;
  margin-bottom: 16px;
}
```

```ts
// src/main.ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const ROW_COUNT = 100_000
const COL_COUNT = 20

const model = new SheetModel(ROW_COUNT, COL_COUNT)

const registry = new EditorRegistry()
registry.registerEditor('text', {})

const container = document.querySelector<HTMLDivElement>('#table-model')!
const table = new ListTable({
  width: 1280,
  height: 720,
  columns: Array.from({ length: COL_COUNT }, (_, col) => ({
    title: `列 ${col}`,
    width: 100,
    editor: 'text',
  })),
  // 模型直挂：表格按格读写模型，不复制全量数据
  model,
  editorRegistry: registry,
  // 快速滚动时向滚动方向预建少量行列，减少滚动帧的建格成本
  overscanRows: 4,
  overscanCols: 2,
  hostOptions: { container },
})

// 首次灌数只预置可视区附近的数据；大块写包进 batchUpdate
table.batchUpdate(() => {
  for (let row = 0; row < 200; row++) {
    for (let col = 0; col < COL_COUNT; col++) {
      table.updateCell(col, row, `${col}-${row}`)
    }
  }
})

// 运行时大块写：5000 次 updateCell 的 cell 失效在批末合并为一次 band 提交
document.querySelector<HTMLButtonElement>('#fill')!.addEventListener('click', () => {
  table.batchUpdate(() => {
    for (let row = 0; row < 5_000; row++) {
      table.updateCell(1, row, `批-${row}`)
    }
  })
})

container.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    table.scrollBy(event.deltaX, event.deltaY)
  },
  { passive: false },
)

window.addEventListener('beforeunload', () => {
  table.destroy()
})
```

`updateCell` 只对模型形态生效：它把值写回模型，并刷新被编辑格以及模型同步回传的派生格。records 形态没有这条回写链路，改完行对象字段后要自己调 `refreshCell(col, row)`。

## 100 万行：rowCount + resolveDisplayValue

只读场景不需要为每一行创建对象。给 `rowCount` 和按格取值 hook，表格在滚动时按需取值：

```html
<div id="table-hook"></div>
```

```ts
import { ListTable } from 'infinitable'

const ROW_COUNT = 1_000_000
const COL_COUNT = 20

const container = document.querySelector<HTMLDivElement>('#table-hook')!
const table = new ListTable({
  width: 1280,
  height: 720,
  columns: Array.from({ length: COL_COUNT }, (_, col) => ({
    title: `列 ${col}`,
    width: 100,
  })),
  // 纯钩子形态：没有 records，也没有 model，行数由 rowCount 兜底
  rowCount: ROW_COUNT,
  // 每个可视格都会调用：必须是纯函数、同步、O(1)
  resolveDisplayValue: (col, row) => {
    if (col === 0) return `ID-${row}`
    if (col === 1) return `部门-${(row % 8) + 1}`
    return String((row * 37 + col * 13) % 10_000)
  },
  overscanRows: 6,
  overscanCols: 2,
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
```

这种形态下没有逐行对象分配，100 万行与 10 万行的构造差异主要来自行高前缀和等 O(行数) 的一次性计算；可视窗口仍然只由滚动位置和视口尺寸决定。

如果 100 万行也必须可编辑，不要直接 `new SheetModel(1_000_000, 20)`。它会预分配 100 万个行数组，内存和初始化成本都高。可以自己实现一个稀疏 `TableModel`，替换上例的 `rowCount` / `resolveDisplayValue` 配置，容器仍用 `#table-hook`：

```ts
import { EditorRegistry, ListTable, type CellChangeEvent, type TableModel } from 'infinitable'

class SparseModel implements TableModel {
  readonly rowCount = 1_000_000
  private readonly values = new Map<string, unknown>()
  private readonly listeners = new Set<(change: CellChangeEvent) => void>()

  getCellValue(col: number, row: number): unknown {
    return this.values.get(`${col}:${row}`)
  }

  setCellValue(col: number, row: number, value: unknown): void {
    const oldValue = this.values.get(`${col}:${row}`)
    this.values.set(`${col}:${row}`, value)
    for (const listener of this.listeners) {
      listener({ col, row, oldValue, newValue: value })
    }
  }

  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

const registry = new EditorRegistry()
registry.registerEditor('text', {})

const container = document.querySelector<HTMLDivElement>('#table-hook')!
const table = new ListTable({
  width: 1280,
  height: 720,
  columns: Array.from({ length: 20 }, (_, col) => ({
    title: `列 ${col}`,
    width: 100,
    editor: 'text',
  })),
  model: new SparseModel(),
  editorRegistry: registry,
  hostOptions: { container },
})
```

稀疏模型只存被写过的格，未写过的格返回 `undefined`，显示为空。模型事件让表格在外部变更时做局部刷新，`setCellValue` 让 `updateCell` 有回写入口。

## overscan 调优

`overscanRows` / `overscanCols` 控制可视窗口外两侧额外预建多少行、列场景节点：

- 默认是 `0`，快速滚动时新滚入的行列在滚动帧内现场建节点。
- 设置 4 到 8 行、1 到 2 列通常能明显减少快速滚动时的帧内分配，适合大行高或快速拖动滚动条的场景。
- 值越大，首帧和几何变更时预建的节点越多，内存与初始化成本越高。不要为了「更顺滑」盲目调到几十行。
- 它只扩大场景装配窗口，不改变滚动边界，也不改变 `getVisibleRange()` 的可见判定。
- `SheetGrid` 内部默认使用 10 行 / 4 列的缓冲；直接用 `ListTable` 时缺省为 0。

## 性能观测

### 构造到首帧

```ts
const started = performance.now()
const table = new ListTable({
  // ... 构造参数
})

requestAnimationFrame(() => {
  // 近似值：包含构造、首帧提交与浏览器绘制前的时间
  console.log(`构造到首帧约 ${(performance.now() - started).toFixed(1)}ms`)
})
```

更严谨的 TTFF 需要把首帧 flush 纳入统计，仓库的 `playground/src/bench/scenarios.ts` 就是用 `beginFrame / endFrame` 包裹构造与首帧来测量的。

### 滚动帧同步

`onScrollFrame` 在滚动发生的帧上触发一次，同帧多次滚动只触发一次。它适合做滚动条镜像、编辑浮层跟随、水印位置同步，也适合粗测滚动帧间隔：

```ts
let frames = 0
let windowStart = performance.now()

const offScroll = table.onScrollFrame(({ top }) => {
  frames++
  if (frames % 60 !== 0) return
  const now = performance.now()
  // 只在每 60 个滚动帧打印一次，避免 console 本身干扰测量
  console.log(`60 个滚动帧耗时 ${(now - windowStart).toFixed(1)}ms，top=${top}`)
  windowStart = now
})

// 卸载时退订
offScroll()
```

`onScrollFrame` 只在有滚动位移时触发；静止时没有回调，不能把它当成常驻的 rAF 循环。

### 单次滚动与单格写入

```ts
const scrollStarted = performance.now()
table.scrollBy(0, 120)
console.log(`scrollBy JS 调用 ${(performance.now() - scrollStarted).toFixed(2)}ms`)

const writeStarted = performance.now()
table.updateCell(1, 500_000, 42)
console.log(`单格写 ${(performance.now() - writeStarted).toFixed(3)}ms`)
```

这两个数字只包含引擎侧 JS 调用，不包含浏览器绘制和合成。判断滚动是否掉帧要结合 `onScrollFrame` 的帧间隔或 `requestAnimationFrame` 实测。

`getVisibleRange()` 返回当前滚动窗口（`[start, end)`，不含冻结区），跳转后可以用它确认窗口没有随总行数膨胀：

```ts
table.scrollTo(0, 32 * 500_000)
console.log(table.getVisibleRange().rows)
// => { start: 499990, end: 500013 } 之类的可视区间
```

## 常见坑

::: warning 钩子必须是纯函数
`resolveDisplayValue`、`resolveCellStyle`、`resolveCellRenderer`、`resolveCellImage` 都在滚动帧按格高频调用。不要在里面发请求、做深拷贝、读 DOM 或逐格计算并缓存，否则虚拟滚动的性能优势会被业务侧吃掉。
:::

- **`updateCell` 用在 records 上**：它只对 model 形态生效，records 形态直接返回。改完 `records[row].field` 后要调 `refreshCell(col, row)`。
- **`batchUpdate` 被当成数据批处理**：它只合并失效提交，不减少 `fn` 内的写入次数。写入逻辑照常执行，只是一帧内只提交一次 band 失效。
- **误以为窗口外也能刷新**：窗口外的行列没有场景节点，`refreshCell` 通常是空操作，`getCellRelativeRect` 返回 `null`。滚回来时会按模型值重建，这不是丢数据。
- **给 `SheetModel` 传了 100 万行**：构造会预分配 `rowCount × colCount` 的二维数组。大数据量且稀疏时用自定义 `TableModel`。
- **overscan 调得过大**：预建节点和文本测量都会增加，首帧变慢、内存上涨；按滚动速度小幅调整即可。
- **把 `height` 当成内容高度**：视口高度固定，虚拟滚动负责把 100 万行映射进这个视口。
- **只看 `scrollBy` 耗时判断流畅度**：JS 调用快不代表绘制快，反之亦然。结合帧间隔一起看。

继续阅读[可编辑表格](/examples/editing)了解编辑回写链路，或看[性能与虚拟滚动](/guide/performance)了解失效面积与前缀和原理。
