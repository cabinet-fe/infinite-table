// 页内冒烟自检（?smoke=1 由 main.ts 触发）：对五个演示区逐项断言——
// 层结构、取值管线、像素级显示能力（冻结/合并/逐边边框/自定义渲染/checkbox/主题）、
// 合成事件驱动的交互（拖选/整行整列/hover/resize/键盘/触控/批量更新/contextmenu/onScrollFrame）、
// 图片加载与无闪回滚、浮动对象跟随、编辑闭环（双击/键盘/API/滚动跟随与滚出提交）。
// 结果写 window.__SMOKE__ 与 document.title。

import { normalizeRange, type CellChangeEvent, type ListTable } from '@infinite-table/core'

import type { DemoHandles } from './main'
import {
  BORDER_LEFT_COLOR,
  BORDER_RIGHT_COLOR,
  DISPLAY_ROW_COUNT,
  FROZEN_COL_BACKGROUND,
  HEADER_BACKGROUND,
  MERGED_BACKGROUND,
  RATING_BAR_COLOR,
} from './sections/display'
import { DISABLED_CELL, DISPLAY_COL } from './sections/editing'
import { FLOAT_OBJECT_ID, imageUrlForRow } from './sections/media'

export interface SmokeResult {
  done: boolean
  pass: boolean
  total: number
  failures: string[]
}

declare global {
  interface Window {
    __SMOKE__?: SmokeResult
  }
}

// 默认主题几何（demo 未覆盖）：行号列宽 / 列头高 / 行高
const ROW_HEADER_WIDTH = 48
const HEADER_HEIGHT = 36
const ROW_HEIGHT = 32

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 等 n 个动画帧：失效 → 单帧收敛 flush 完成后再采样 */
function frames(count: number): Promise<void> {
  let chain = Promise.resolve()
  for (let i = 0; i < count; i++) {
    chain = chain.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  }
  return chain
}

function layerCanvas(container: HTMLElement, kind: string): HTMLCanvasElement {
  const canvas = container.querySelector<HTMLCanvasElement>(`canvas[data-layer-kind="${kind}"]`)
  assert(canvas, `缺少 ${kind} 层 canvas`)
  return canvas
}

type Rgba = [number, number, number, number]

function readPixel(canvas: HTMLCanvasElement, x: number, y: number): Rgba {
  const ctx = canvas.getContext('2d')
  assert(ctx, '无法获取 canvas 2d 上下文')
  const data = ctx.getImageData(x, y, 1, 1).data
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0]
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

/** 像素颜色断言（fillRect 色值精确，留 ±8 容差） */
function expectColor(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  hex: string,
  label: string,
): void {
  const [r, g, b, a] = readPixel(canvas, x, y)
  const [er, eg, eb] = hexToRgb(hex)
  assert(
    a > 200 && Math.abs(r - er) <= 8 && Math.abs(g - eg) <= 8 && Math.abs(b - eb) <= 8,
    `${label}：(${x},${y}) 颜色 rgb(${r},${g},${b}) α=${a}，期望 ${hex}`,
  )
}

/** 区域扫描：存在不透明像素（hover/图片等内容绘制判定） */
function hasOpaquePixel(
  canvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      if (readPixel(canvas, x, y)[3] > 0) {
        return true
      }
    }
  }
  return false
}

// ---- 合成事件 ----

function dispatchPointer(
  container: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
): void {
  const rect = container.getBoundingClientRect()
  container.dispatchEvent(
    new PointerEvent(type, { bubbles: true, clientX: rect.left + x, clientY: rect.top + y }),
  )
}

function dispatchKey(container: HTMLElement, key: string, shiftKey = false): void {
  container.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, shiftKey }))
}

function dispatchTouch(
  container: HTMLElement,
  type: 'touchstart' | 'touchmove' | 'touchend',
  x: number,
  y: number,
): void {
  const rect = container.getBoundingClientRect()
  const event = new Event(type, { bubbles: true })
  // EventSystem 按结构化类型读取 changedTouches[0]
  Object.assign(event, { changedTouches: [{ clientX: rect.left + x, clientY: rect.top + y }] })
  container.dispatchEvent(event)
}

/** 双击进编辑：同一格两次落点（指针事件流判定，时长与位移均在阈值内） */
function doubleTapCell(container: HTMLElement, table: ListTable, col: number, row: number): void {
  const x = colCenterX(table, col)
  const y = rowCenterY(table, row)
  dispatchPointer(container, 'pointerdown', x, y)
  dispatchPointer(container, 'pointerup', x, y)
  dispatchPointer(container, 'pointerdown', x, y)
  dispatchPointer(container, 'pointerup', x, y)
}

// ---- 非冻结表的格几何（含滚动偏移） ----

function colLeftX(table: ListTable, col: number): number {
  let x = ROW_HEADER_WIDTH - table.getScrollState().left
  for (let c = 0; c < col; c++) {
    x += table.getColWidth(c)
  }
  return x
}

function colCenterX(table: ListTable, col: number): number {
  return colLeftX(table, col) + table.getColWidth(col) / 2
}

function rowTopY(table: ListTable, row: number): number {
  let y = HEADER_HEIGHT - table.getScrollState().top
  for (let r = 0; r < row; r++) {
    y += table.getRowHeight(r)
  }
  return y
}

function rowCenterY(table: ListTable, row: number): number {
  return rowTopY(table, row) + table.getRowHeight(row) / 2
}

// ---- 断言收集 ----

class Checker {
  total = 0
  readonly failures: string[] = []

  async step(name: string, fn: () => void | Promise<void>): Promise<void> {
    this.total++
    try {
      await fn()
    } catch (error) {
      this.failures.push(`${name}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// ---- 分组检查 ----

async function checkLayersAndDataForms(checker: Checker, demos: DemoHandles): Promise<void> {
  const { display, media, dataForms } = demos

  await checker.step('渲染骨架：body/sky/media 层 canvas 就位且首帧已上屏', () => {
    const body = layerCanvas(display.mount.container, 'body')
    layerCanvas(display.mount.container, 'sky')
    layerCanvas(media.mount.container, 'media')
    assert(hasOpaquePixel(body, 100, 50, 700, 400), 'display 表 body 层无已绘制像素（首帧未上屏）')
  })

  await checker.step('数据形态①：records/columns 数组取值', () => {
    assert(
      dataForms.records.table.getCellText(0, 3) === '用户-3',
      `records(0,3) = ${dataForms.records.table.getCellText(0, 3)}`,
    )
    assert(
      dataForms.records.table.getCellText(1, 10) === '10',
      `records(1,10) = ${dataForms.records.table.getCellText(1, 10)}`,
    )
  })

  await checker.step('数据形态②：按格 hook 取值与样式', () => {
    assert(
      dataForms.hooks.table.getCellText(2, 4) === '格(2,4)=402',
      `hook(2,4) = ${dataForms.hooks.table.getCellText(2, 4)}`,
    )
  })

  await checker.step('数据形态③：模型事件订阅局部刷新 + 回驱防回环', async () => {
    const { model, modelMount } = dataForms
    const before = model.changeCount
    // 外部模型变更（不经表格）→ 事件订阅 → 表格局部刷新
    model.setCellValue(1, 1, 'EXT-1')
    await frames(2)
    assert(modelMount.table.getCellText(1, 1) === 'EXT-1', '外部变更后表格未刷新')
    // 表格回驱：模型值更新、echo 被吞（changeCount 只 +1，无回环）
    modelMount.table.updateCell(1, 1, 'WB-1')
    await frames(2)
    assert(model.getCellValue(1, 1) === 'WB-1', '回驱未写入模型')
    assert(modelMount.table.getCellText(1, 1) === 'WB-1', '回驱后表格未刷新')
    assert(model.changeCount === before + 2, `changeCount=${model.changeCount}，期望 ${before + 2}`)
  })
}

async function checkDisplay(checker: Checker, demos: DemoHandles): Promise<void> {
  const { table, container } = demos.display.mount
  // display 列宽：id 80 / name 140 / qty 80 / price 100 / rating 120 / done 80 / note 160（滚动归零）
  const body = layerCanvas(container, 'body')

  await checker.step('主题 extends：列头底色覆盖生效', () => {
    expectColor(body, 130, 2, HEADER_BACKGROUND, '列头底色')
  })

  await checker.step('虚拟滚动：10 万行只建可视窗口，滚动后窗口与取值一致', async () => {
    const initial = table.getVisibleRange()
    assert(
      initial.rows.end - initial.rows.start < 80,
      `首屏窗口行数 ${initial.rows.end - initial.rows.start} 超出虚拟滚动预期`,
    )
    table.scrollTo(0, ROW_HEIGHT * 50000)
    await frames(2)
    const scrolled = table.getVisibleRange()
    assert(
      Math.abs(scrolled.rows.start - 50000) <= 5,
      `滚动后窗口起始行 ${scrolled.rows.start}，期望 ≈50000`,
    )
    assert(
      table.getCellText(0, scrolled.rows.start) === `ID-${scrolled.rows.start}`,
      '滚动后窗口内取值与行号不一致',
    )
    table.scrollTo(0, 0)
    await frames(2)
  })

  await checker.step('冻结：首列不随横向滚动', async () => {
    expectColor(body, 70, 222, FROZEN_COL_BACKGROUND, '冻结列底色（滚动前）')
    table.scrollTo(400, 0)
    await frames(2)
    assert(table.getVisibleRange().cols.start > 0, '横向滚动后滚动窗口未移动')
    expectColor(body, 70, 222, FROZEN_COL_BACKGROUND, '冻结列底色（滚动后仍在原位）')
    table.scrollTo(0, 0)
    await frames(2)
  })

  await checker.step('合并单元格：覆盖区由主格统一绘制', () => {
    // 合并区 (2,2)~(3,3)：覆盖格 (3,3) 中心应为主格底色
    expectColor(body, 398, 148, MERGED_BACKGROUND, '合并覆盖区')
  })

  await checker.step('逐边边框：(2,4) 左红右蓝', () => {
    expectColor(body, 269, 180, BORDER_LEFT_COLOR, '左边框')
    expectColor(body, 346, 180, BORDER_RIGHT_COLOR, '右边框')
  })

  await checker.step('自定义渲染 hook：rating 列紫色条形', () => {
    expectColor(body, 490, 84, RATING_BAR_COLOR, 'rating 条形')
  })

  await checker.step('checkbox 单元格类型：勾选/未勾选两态', () => {
    expectColor(body, 583, 52, '#3370ff', '勾选态实心块')
    expectColor(body, 583, 84, '#f8fafc', '未勾选态（条纹底）')
  })

  assert(DISPLAY_ROW_COUNT === 100_000, 'display 行数配置变更')
}

async function checkInteraction(checker: Checker, demos: DemoHandles): Promise<void> {
  const { table, container } = demos.interaction.mount
  const { records } = demos.interaction

  await checker.step('拖选：跨格拖出选区', async () => {
    dispatchPointer(container, 'pointerdown', colCenterX(table, 1), rowCenterY(table, 1))
    dispatchPointer(container, 'pointermove', colCenterX(table, 3), rowCenterY(table, 2))
    dispatchPointer(container, 'pointerup', colCenterX(table, 3), rowCenterY(table, 2))
    const snapshot = table.getSelection()
    assert(snapshot.ranges.length === 1, `选区段数 ${snapshot.ranges.length}`)
    const b = normalizeRange(snapshot.ranges[0]!)
    assert(
      b.minCol === 1 && b.minRow === 1 && b.maxCol === 3 && b.maxRow === 2,
      `拖选结果 (${b.minCol},${b.minRow})~(${b.maxCol},${b.maxRow})`,
    )
    assert(snapshot.focus?.col === 3 && snapshot.focus?.row === 2, '焦点未落在拖选终点')
  })

  await checker.step('整行整列：点行号选整行、点列头选整列', () => {
    dispatchPointer(container, 'pointerdown', ROW_HEADER_WIDTH / 2, rowCenterY(table, 4))
    dispatchPointer(container, 'pointerup', ROW_HEADER_WIDTH / 2, rowCenterY(table, 4))
    let b = normalizeRange(table.getSelection().ranges[0]!)
    assert(b.minRow === 4 && b.maxRow === 4 && b.minCol === 0 && b.maxCol === 7, '整行选择不符')
    dispatchPointer(container, 'pointerdown', colCenterX(table, 2), HEADER_HEIGHT / 2)
    dispatchPointer(container, 'pointerup', colCenterX(table, 2), HEADER_HEIGHT / 2)
    b = normalizeRange(table.getSelection().ranges[0]!)
    assert(b.minCol === 2 && b.maxCol === 2 && b.minRow === 0 && b.maxRow === 1999, '整列选择不符')
    table.clearSelection()
  })

  await checker.step('hover：指针悬停绘制浮层高亮', async () => {
    table.clearSelection()
    await frames(2)
    dispatchPointer(container, 'pointermove', colCenterX(table, 2), rowCenterY(table, 3))
    await frames(2)
    const sky = layerCanvas(container, 'sky')
    const x0 = Math.round(colLeftX(table, 2))
    const y0 = Math.round(rowTopY(table, 3))
    assert(hasOpaquePixel(sky, x0 + 2, y0 + 2, x0 + 98, y0 + 30), 'hover 后 sky 浮层无内容')
  })

  await checker.step('键盘导航：方向键移动焦点、shift 扩展选区', () => {
    table.selectCell(1, 1)
    dispatchKey(container, 'ArrowDown')
    let focus = table.getSelection().focus
    assert(focus?.col === 1 && focus?.row === 2, `ArrowDown 后焦点 (${focus?.col},${focus?.row})`)
    dispatchKey(container, 'ArrowRight', true)
    focus = table.getSelection().focus
    assert(
      focus?.col === 2 && focus?.row === 2,
      `shift+ArrowRight 后焦点 (${focus?.col},${focus?.row})`,
    )
  })

  await checker.step('contextmenu 事件：命中数据格坐标', () => {
    const received: { cell: { col: number; row: number } | null } = { cell: null }
    const unsubscribe = table.onContextMenu((event) => {
      received.cell = event.cell
    })
    const rect = container.getBoundingClientRect()
    container.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: rect.left + colCenterX(table, 1),
        clientY: rect.top + rowCenterY(table, 1),
      }),
    )
    unsubscribe()
    assert(received.cell?.col === 1 && received.cell?.row === 1, 'contextmenu 未命中 (1,1)')
  })

  await checker.step('onScrollFrame：滚动帧级同步一次回执', async () => {
    let count = 0
    let lastTop = -1
    const unsubscribe = table.onScrollFrame((state) => {
      count++
      lastTop = state.top
    })
    table.scrollBy(0, 96)
    await frames(3)
    unsubscribe()
    assert(count >= 1, '滚动帧未触发 onScrollFrame')
    assert(Math.round(lastTop) === 96, `onScrollFrame 位置 ${lastTop}`)
    table.scrollTo(0, 0)
    await frames(2)
  })

  await checker.step('滚轮滚动（宿主接线）', async () => {
    const before = table.getScrollState().top
    const rect = container.getBoundingClientRect()
    container.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 120,
        clientX: rect.left + 200,
        clientY: rect.top + 200,
      }),
    )
    await frames(2)
    assert(table.getScrollState().top === before + 120, '滚轮未驱动滚动')
    table.scrollTo(0, 0)
    await frames(2)
  })

  await checker.step('触控滚动：touchstart/move/end 驱动位移', async () => {
    const before = table.getScrollState().top
    dispatchTouch(container, 'touchstart', 300, 300)
    dispatchTouch(container, 'touchmove', 300, 220)
    await frames(2)
    assert(
      table.getScrollState().top > before + 40,
      `触控位移不足（top ${table.getScrollState().top}）`,
    )
    dispatchTouch(container, 'touchend', 300, 220)
    await sleep(500) // 惯性衰减落定
    table.scrollTo(0, 0)
    await frames(2)
  })

  await checker.step('批量更新：batchUpdate 多格一次收敛', async () => {
    table.batchUpdate(() => {
      for (let row = 5; row < 10; row++) {
        const record = records[row]
        if (record) {
          record['c1'] = `B-${row}`
          table.refreshCell(1, row)
        }
      }
    })
    await frames(2)
    assert(table.getCellText(1, 5) === 'B-5', `批更新 (1,5)=${table.getCellText(1, 5)}`)
    assert(table.getCellText(1, 9) === 'B-9', `批更新 (1,9)=${table.getCellText(1, 9)}`)
  })

  await checker.step('列 resize：拖列头边缘改宽，canResizeCol(0) 禁用', async () => {
    // 禁用列：第 0 列右缘拖拽不生效
    dispatchPointer(container, 'pointerdown', colLeftX(table, 1), HEADER_HEIGHT / 2)
    dispatchPointer(container, 'pointermove', colLeftX(table, 1) + 24, HEADER_HEIGHT / 2)
    dispatchPointer(container, 'pointerup', colLeftX(table, 1) + 24, HEADER_HEIGHT / 2)
    assert(table.getColWidth(0) === 100, `禁用列宽被改为 ${table.getColWidth(0)}`)
    // 第 1 列右缘拖拽 +24
    const edge = colLeftX(table, 2)
    dispatchPointer(container, 'pointerdown', edge, HEADER_HEIGHT / 2)
    dispatchPointer(container, 'pointermove', edge + 24, HEADER_HEIGHT / 2)
    dispatchPointer(container, 'pointerup', edge + 24, HEADER_HEIGHT / 2)
    assert(table.getColWidth(1) === 124, `列 1 宽 ${table.getColWidth(1)}，期望 124`)
    await frames(2)
    table.clearSelection()
  })

  await checker.step('行 resize：拖行号下缘改高，canResizeRow(0) 禁用', async () => {
    dispatchPointer(container, 'pointerdown', ROW_HEADER_WIDTH / 2, rowTopY(table, 1))
    dispatchPointer(container, 'pointermove', ROW_HEADER_WIDTH / 2, rowTopY(table, 1) + 16)
    dispatchPointer(container, 'pointerup', ROW_HEADER_WIDTH / 2, rowTopY(table, 1) + 16)
    assert(table.getRowHeight(0) === ROW_HEIGHT, `禁用行高被改为 ${table.getRowHeight(0)}`)
    const edge = rowTopY(table, 3)
    dispatchPointer(container, 'pointerdown', ROW_HEADER_WIDTH / 2, edge)
    dispatchPointer(container, 'pointermove', ROW_HEADER_WIDTH / 2, edge + 16)
    dispatchPointer(container, 'pointerup', ROW_HEADER_WIDTH / 2, edge + 16)
    assert(table.getRowHeight(2) === ROW_HEIGHT + 16, `行 2 高 ${table.getRowHeight(2)}`)
    await frames(2)
    table.clearSelection()
  })
}

async function checkMedia(checker: Checker, demos: DemoHandles): Promise<void> {
  const { table, container } = demos.media.mount

  await checker.step('格内图片：窗口化加载落图到 media 层', async () => {
    const media = layerCanvas(container, 'media')
    // 等首张图加载完成（40ms 人工延迟，留足余量）
    const deadline = Date.now() + 3000
    while (!table.imageService.getBitmap(imageUrlForRow(0))) {
      assert(Date.now() < deadline, '图片加载超时')
      await sleep(50)
    }
    await frames(2)
    // 图片格 (1,0) 中心：x=48+100+50=148，y=36+16=52
    const [r, g, b, a] = readPixel(media, 148, 52)
    assert(
      a > 200 && !(r > 230 && g > 230 && b > 230),
      `图片格未绘制位图 rgb(${r},${g},${b}) α=${a}`,
    )
  })

  await checker.step('图片无闪：滚出再滚回，首帧即真实位图（LRU 命中）', async () => {
    const media = layerCanvas(container, 'media')
    table.scrollTo(0, 1600)
    await frames(3)
    table.scrollTo(0, 0)
    await frames(1) // 只等一帧：位图须首帧直接画，不允许先空白
    const [r, g, b, a] = readPixel(media, 148, 52)
    assert(a > 200 && !(r > 230 && g > 230 && b > 230), '回滚后首帧位图缺失（有闪）')
  })

  await checker.step('浮动对象：承载命中 + 滚动帧级跟随', async () => {
    assert(table.floatObjects.size === 1, `浮动对象数 ${table.floatObjects.size}`)
    // 锚点 (2,1)+offset(8,8)：层坐标 x=256..548，y=76..164
    assert(table.floatObjects.getAt(300, 100)?.id === FLOAT_OBJECT_ID, '浮动对象未命中')
    table.scrollBy(0, 64)
    await frames(2)
    assert(table.floatObjects.getAt(300, 36)?.id === FLOAT_OBJECT_ID, '滚动后浮动对象未跟随')
    table.scrollBy(0, -64)
    await frames(2)
  })
}

async function checkEditing(checker: Checker, demos: DemoHandles): Promise<void> {
  const { table, container } = demos.editing.mount
  const { model, status } = demos.editing

  await checker.step('编辑：双击可编格出现浮层，初值为基础值且聚焦', () => {
    doubleTapCell(container, table, 0, 0)
    const input = container.querySelector<HTMLInputElement>('input')
    assert(input, '双击后编辑浮层未出现')
    assert(input.value === '名称-0', `编辑初值 ${input.value}，期望 名称-0`)
    assert(document.activeElement === input, '编辑浮层未聚焦')
  })

  await checker.step('编辑：Esc 取消不回写、浮层关闭', () => {
    const input = container.querySelector<HTMLInputElement>('input')
    assert(input, '编辑浮层丢失')
    input.value = '不该写入'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    assert(!table.isEditing(), 'Esc 后仍在编辑态')
    assert(!container.querySelector('input'), 'Esc 后浮层未关闭')
    assert(model.getCellValue(0, 0) === '名称-0', 'Esc 后数据被回写')
  })

  await checker.step('编辑：Enter 提交回写并下移一格；Tab 提交回写并右移一格', () => {
    doubleTapCell(container, table, 0, 0)
    let input = container.querySelector<HTMLInputElement>('input')
    assert(input, '双击后浮层未出现')
    input.value = '名称-0改'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    assert(model.getCellValue(0, 0) === '名称-0改', `Enter 未回写：${model.getCellValue(0, 0)}`)
    let focus = table.getSelection().focus
    assert(focus?.col === 0 && focus?.row === 1, `Enter 后焦点 (${focus?.col},${focus?.row})`)
    assert(!container.querySelector('input'), 'Enter 提交后浮层未关闭')

    doubleTapCell(container, table, 0, 1)
    input = container.querySelector<HTMLInputElement>('input')
    assert(input, '第二次双击浮层未出现')
    input.value = '名称-1改'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    assert(model.getCellValue(0, 1) === '名称-1改', `Tab 未回写：${model.getCellValue(0, 1)}`)
    focus = table.getSelection().focus
    assert(focus?.col === 1 && focus?.row === 1, `Tab 后焦点 (${focus?.col},${focus?.row})`)
  })

  await checker.step('编辑：格级禁编格与纯展示列双击无反应，startEdit 返回 false', () => {
    doubleTapCell(container, table, DISABLED_CELL.col, DISABLED_CELL.row)
    assert(!container.querySelector('input'), '格级禁编格出现浮层')
    assert(
      !table.startEdit(DISABLED_CELL.col, DISABLED_CELL.row),
      '格级禁编格 startEdit 未返回 false',
    )
    doubleTapCell(container, table, DISPLAY_COL, 0)
    assert(!container.querySelector('input'), '纯展示列出现浮层')
    assert(!table.startEdit(DISPLAY_COL, 0), '纯展示列 startEdit 未返回 false')
  })

  await checker.step('编辑：API 按钮 startEdit/commitEdit/cancelEdit', () => {
    const section = container.parentElement
    assert(section, '编辑区容器不在 section 内')
    const buttons = section.querySelectorAll<HTMLButtonElement>('.toolbar button')
    assert(buttons.length >= 3, `API 按钮数 ${buttons.length}`)
    buttons[0]!.click()
    const input = container.querySelector<HTMLInputElement>('input')
    assert(input, 'startEdit 按钮未打开浮层')
    assert(input.value === '名称-3', `API 编辑初值 ${input.value}，期望 名称-3`)
    input.value = 'API-改'
    buttons[1]!.click()
    assert(model.getCellValue(0, 3) === 'API-改', `commitEdit 未回写：${model.getCellValue(0, 3)}`)
    assert(status.textContent?.includes('已提交 (0,3)') === true, `状态行：${status.textContent}`)
    buttons[0]!.click()
    assert(container.querySelector('input'), '再次 startEdit 未打开浮层')
    buttons[2]!.click()
    assert(!container.querySelector('input'), 'cancelEdit 未关闭浮层')
    assert(model.getCellValue(0, 3) === 'API-改', 'cancelEdit 改动了数据')
    assert(status.textContent?.includes('已取消') === true, `状态行：${status.textContent}`)
  })

  await checker.step('编辑滚动跟随：滚动帧上浮层逐帧对齐锚定格', async () => {
    assert(table.startEdit(0, 0), 'startEdit 失败')
    const input = container.querySelector<HTMLInputElement>('input')
    assert(input, '浮层未出现')
    table.scrollBy(0, 10)
    await frames(2)
    assert(
      input.style.left === '48px' && input.style.top === '26px',
      `浮层未跟随：left=${input.style.left} top=${input.style.top}`,
    )
    table.scrollBy(0, -10)
    await frames(2)
    const topAfter: string = input.style.top
    assert(topAfter === '36px', `滚回后浮层未跟随：top=${topAfter}`)
  })

  await checker.step('编辑滚出视口：按 Enter 语义自动提交，内容不丢', async () => {
    const input = container.querySelector<HTMLInputElement>('input')
    assert(input, '浮层丢失')
    input.value = '滚动提交'
    const received: { change: CellChangeEvent | null } = { change: null }
    const unsubscribe = table.onCellChange((event) => {
      received.change = event
    })
    // 视口体高 184：滚动 184 后行 0 完全滚出
    table.scrollBy(0, 184)
    await frames(3)
    unsubscribe()
    assert(!table.isEditing(), '滚出视口后仍在编辑态')
    assert(!container.querySelector('input'), '滚出视口后浮层未关闭')
    const change = received.change
    assert(
      change !== null &&
        change.col === 0 &&
        change.row === 0 &&
        change.oldValue === '名称-0改' &&
        change.newValue === '滚动提交',
      `滚出提交事件不符：${JSON.stringify(received.change)}`,
    )
    assert(model.getCellValue(0, 0) === '滚动提交', '滚出自动提交未写入模型')
    const focus = table.getSelection().focus
    assert(
      focus?.col === 0 && focus?.row === 1,
      `Enter 语义选区未下移 (${focus?.col},${focus?.row})`,
    )
  })
}

/** 页内冒烟入口：逐项跑完后把结果写到 window.__SMOKE__ 与 document.title */
export async function runSmoke(demos: DemoHandles): Promise<void> {
  const checker = new Checker()
  await frames(3) // 各表首帧上屏
  await checkLayersAndDataForms(checker, demos)
  await checkDisplay(checker, demos)
  await checkInteraction(checker, demos)
  await checkMedia(checker, demos)
  await checkEditing(checker, demos)
  const result: SmokeResult = {
    done: true,
    pass: checker.failures.length === 0,
    total: checker.total,
    failures: checker.failures,
  }
  window.__SMOKE__ = result
  document.title = result.pass
    ? `SMOKE PASS ${result.total}/${result.total}`
    : `SMOKE FAIL ${result.failures.length}/${result.total}`
  console.log('[smoke]', result.pass ? 'PASS' : 'FAIL', result.failures)
}
