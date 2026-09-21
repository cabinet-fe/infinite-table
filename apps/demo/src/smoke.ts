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
    // 共享边裁决：左边归左格（所有者）在其矩形内绘制，红线带 [265,268)；右边仍属本格 [346,348)
    expectColor(body, 266, 180, BORDER_LEFT_COLOR, '左边框')
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
    // 格矩形 x=48/y=26；浮层骑格缘定位外扩 1px（2px 边框内外各半）
    assert(
      input.style.left === '47px' && input.style.top === '25px',
      `浮层未跟随：left=${input.style.left} top=${input.style.top}`,
    )
    table.scrollBy(0, -10)
    await frames(2)
    const topAfter: string = input.style.top
    assert(topAfter === '35px', `滚回后浮层未跟随：top=${topAfter}`)
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
  await checkSheet(checker)
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

/** sheet 演示区冒烟（插件之上的完整 sheet 面）：公式显示/填充生成/样式/结构操作/撤销/查找替换/CSV/tabs/resize 持久化 */
async function checkSheet(checker: Checker): Promise<void> {
  const handle = window.__SHEET_DEMO__
  assert(handle, '缺少 __SHEET_DEMO__ 句柄')
  const table = handle.getTable()
  const store = handle.getStore()
  const activeContainer = (): HTMLElement => {
    const id = handle.book.activeId ?? ''
    const viewport = document.querySelector<HTMLElement>(`.sheet-viewport`)!
    const target = viewport.querySelector<HTMLElement>(`[data-sheet-id="${id}"]`)
    assert(target, `缺少活跃容器 ${id}`)
    return target
  }

  await checker.step('sheet 公式显示：Store 存原文、渲染求值、公式引擎', () => {
    assert(
      store.getValue(3, 2) === '=D1+D2',
      `Store 应存公式原文（${String(store.getValue(3, 2))}）`,
    )
    assert(table.getCellText(3, 2) === '12', `公式格显示 ${table.getCellText(3, 2)}（期望 12）`)
    assert(table.getCellText(3, 3) === '12', `SUM 区域显示 ${table.getCellText(3, 3)}`)
    assert(handle.controls.evaluate('D1*2+1') === 15, '公式引擎运算错误')
  })

  await checker.step('sheet 公式缓存失效：引用格变更后公式格重算', async () => {
    store.setValue(3, 0, 8)
    table.refreshCell(3, 2)
    await frames(2)
    assert(
      table.getCellText(3, 2) === '13',
      `D1 变更后公式格显示 ${table.getCellText(3, 2)}（期望 13）`,
    )
    store.setValue(3, 0, 7)
    table.refreshCell(3, 2)
    await frames(2)
    assert(table.getCellText(3, 2) === '12', '还原后公式格未重算')
  })

  await checker.step('sheet 跨表引用：=SUM(Sheet2!A1:A2) 求值', async () => {
    // Sheet2 A1=0、A2=1 → 1
    assert(handle.controls.evaluate('SUM(Sheet2!A1:A2)') === 1, '跨表区域求值错误')
    store.setValue(5, 15, '=SUM(Sheet2!A1:A2)')
    table.refreshCell(5, 15)
    await frames(2)
    assert(table.getCellText(5, 15) === '1', `跨表公式格显示 ${table.getCellText(5, 15)}（期望 1）`)
    // 引号表名形态
    assert(handle.controls.evaluate("'Sheet2'!A2*10") === 10, '引号表名求值错误')
    store.setValue(5, 15, null)
    table.refreshCell(5, 15)
  })

  await checker.step('sheet 错误值显示：=1/0 → #DIV/0!', async () => {
    store.setValue(5, 16, '=1/0')
    table.refreshCell(5, 16)
    await frames(2)
    assert(
      table.getCellText(5, 16) === '#DIV/0!',
      `错误格显示 ${table.getCellText(5, 16)}（期望 #DIV/0!）`,
    )
    assert(handle.controls.evaluate('1/0') === '#DIV/0!', '求值错误码不符')
    store.setValue(5, 16, null)
    table.refreshCell(5, 16)
  })

  await checker.step('sheet 财务函数：PMT 等额分期求值', () => {
    const pmt = handle.controls.evaluate('PMT(0.05/12, 36, 10000)')
    assert(
      typeof pmt === 'number' && Math.abs(pmt + 299.7089710466537) < 1e-6,
      `PMT 求值 ${String(pmt)}（期望 ≈ -299.709）`,
    )
  })

  await checker.step('sheet 公式栏补全：建议列表出现，Tab 确认后光标落括号内', () => {
    const input = document.querySelector<HTMLTextAreaElement>('.sheet-fx-input')
    assert(input, '公式输入区缺失')
    input.focus()
    input.value = '=PM'
    input.setSelectionRange(3, 3)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const suggest = document.querySelector('.sheet-fx-suggest')
    assert(suggest && suggest.children.length > 0, '补全列表未出现')
    assert(
      suggest.querySelector('.sheet-fx-suggest__signature')?.textContent?.startsWith('PMT('),
      `首项建议签名异常：${suggest.querySelector('.sheet-fx-suggest__signature')?.textContent}`,
    )
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    assert(input.value === '=PMT()', `确认后内容 ${input.value}（期望 =PMT()）`)
    assert(
      input.selectionStart === 5 && input.selectionEnd === 5,
      `光标未落括号内（selectionStart=${input.selectionStart}）`,
    )
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.blur()
  })

  await checker.step('sheet 参数提示 calltip：逗号深度高亮当前参数', () => {
    const input = document.querySelector<HTMLTextAreaElement>('.sheet-fx-input')
    assert(input, '公式输入区缺失')
    input.focus()
    input.value = '=SUM(1,'
    input.setSelectionRange(7, 7)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const calltip = document.querySelector('.sheet-fx-calltip')
    assert(calltip, 'calltip 未出现')
    assert(
      calltip.textContent === 'SUM(number1, [number2], ...)',
      `calltip 签名 ${calltip.textContent}`,
    )
    const active = calltip.querySelector('.sheet-fx-calltip__param.is-active')
    assert(active?.textContent === '[number2]', `高亮参数 ${active?.textContent}（期望 [number2]）`)
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.blur()
  })

  await checker.step('sheet tabs：切换状态隔离、切回恢复', async () => {
    handle.switchTo('sheet-2')
    await frames(2)
    const t2 = handle.getTable()
    assert(handle.book.activeId === 'sheet-2', '未切换到 sheet-2')
    assert(t2.getCellText(0, 0) === '0', `sheet-2 (0,0) 值 ${t2.getCellText(0, 0)}`)
    assert(handle.getStore().getValue(3, 2) !== '=D1+D2', 'sheet-2 不应带 sheet-1 公式')
    handle.switchTo('sheet-1')
    await frames(2)
    assert(handle.getTable().getCellText(3, 2) === '12', '切回后公式显示丢失')
  })

  await checker.step('sheet resize 持久化：拖列头边界 → Store 记录 → 切走切回还原', async () => {
    const container = activeContainer()
    const previous = store.getColWidth(2)
    // 列 2 右边界 = 46(行号列) + 80×3 = 286（列头带内触发列宽拖拽会话；表头高 28，取 y=14）
    dispatchPointer(container, 'pointerdown', 286, 14)
    dispatchPointer(container, 'pointermove', 346, 14)
    dispatchPointer(container, 'pointerup', 346, 14)
    assert(store.getColWidth(2) === 140, `resize 后 Store 列宽 ${store.getColWidth(2)}`)
    handle.switchTo('sheet-2')
    handle.switchTo('sheet-1')
    await frames(2)
    assert(store.getColWidth(2) === 140, '切回后 Store 尺寸丢失')
    assert(handle.getTable().getColWidth(2) === 140, '引擎未应用 Store 尺寸')
    store.setColWidth(2, previous)
    handle.getTable().setColWidth(2, previous)
  })

  await checker.step('sheet 填充生成：拖柄 → generateFill 写值（batchUpdate 收敛）', async () => {
    const container = activeContainer()
    store.setValue(1, 1, 100)
    store.setValue(1, 2, 200)
    table.refreshCell(1, 1)
    table.refreshCell(1, 2)
    table.selectCells([{ start: { col: 1, row: 1 }, end: { col: 1, row: 2 } }])
    await frames(2)
    // 柄挂在焦点段 (1,2) 右下角点：(46+80+80, 28+3×28) = (206,112)，方点内取 (204,110)；
    // 拖至 B 列中心 (46+80+40=166)、行 5 中心 y=28+28×3+44(行3加高)+28+14=198 → 向下扩展 3 行
    dispatchPointer(container, 'pointerdown', 204, 110)
    dispatchPointer(container, 'pointermove', 166, 198)
    dispatchPointer(container, 'pointerup', 166, 198)
    assert(store.getValue(1, 3) === 300, `填充 (1,3) = ${String(store.getValue(1, 3))}`)
    assert(store.getValue(1, 4) === 400 && store.getValue(1, 5) === 500, '填充序列不完整')
  })

  await checker.step('sheet 填充柄双击：按左邻数据块末行自动向下填充并扩选区', async () => {
    const container = activeContainer()
    const live = handle.getTable()
    // H 列(7) 行 10..14 连续数据作参考块；I 列(8) 行 10,11 为数字源 10,20（步长 10）
    for (let row = 10; row <= 14; row++) {
      store.setValue(7, row, `m${row}`)
    }
    store.setValue(8, 10, 10)
    store.setValue(8, 11, 20)
    live.selectCells([{ start: { col: 8, row: 10 }, end: { col: 8, row: 11 } }])
    await frames(2)
    // 柄挂在焦点段右下角格 (8,11) 的右下角点上，方点内取角点内缩 2px
    const anchorRect = live.getCellRelativeRect(8, 11)
    assert(anchorRect, '格 (8,11) 不在视口')
    const hx = anchorRect.x + anchorRect.width - 2
    const hy = anchorRect.y + anchorRect.height - 2
    dispatchPointer(container, 'pointerdown', hx, hy)
    dispatchPointer(container, 'pointerup', hx, hy)
    dispatchPointer(container, 'pointerdown', hx, hy)
    dispatchPointer(container, 'pointerup', hx, hy)
    await frames(2)
    assert(
      store.getValue(8, 12) === 30,
      `双击填充 (8,12) = ${String(store.getValue(8, 12))}（期望 30）`,
    )
    assert(store.getValue(8, 13) === 40 && store.getValue(8, 14) === 50, '双击填充序列不完整')
    const bounds = normalizeRange(live.getSelection().ranges[0]!)
    assert(
      bounds.minCol === 8 && bounds.maxCol === 8 && bounds.minRow === 10 && bounds.maxRow === 14,
      '双击填充后选区未扩展到源区∪新区',
    )
    // 清理夹具，避免污染后续 CSV/xlsx 导出断言
    for (let row = 10; row <= 14; row++) {
      store.setValue(7, row, null)
      store.setValue(8, row, null)
    }
  })

  await checker.step('sheet 公式引用染色框：编辑公式画同色框（循环色板），清空即撤', async () => {
    const container = activeContainer()
    const live = handle.getTable()
    const sky = layerCanvas(container, 'sky')
    const input = document.querySelector<HTMLTextAreaElement>('.sheet-fx-input')
    assert(input, '公式输入区缺失')
    input.focus()
    input.value = '=B2+C3'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await frames(2)
    // B2 上边框中点应为首色 #2e75b6；C3 上边框中点应为次色 #c00000
    const b2 = live.getCellRelativeRect(1, 1)
    const c3 = live.getCellRelativeRect(2, 2)
    assert(b2 && c3, '引用格不在视口')
    expectColor(sky, b2.x + b2.width / 2, b2.y + 1, '#2e75b6', 'B2 染色框')
    expectColor(sky, c3.x + c3.width / 2, c3.y + 1, '#c00000', 'C3 染色框')
    // 清空公式文本并失焦：染色框撤除（像素恢复透明）
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.blur()
    await frames(2)
    const [, , , alpha] = readPixel(sky, b2.x + b2.width / 2, b2.y + 1)
    assert(alpha === 0, `清空后染色框未撤除（α=${alpha}）`)
  })

  await checker.step('sheet 样式工具栏：选区写样式 + toggle 取消', () => {
    table.selectCells([{ start: { col: 0, row: 20 }, end: { col: 0, row: 20 } }])
    handle.controls.toolbar.applyFragment({ fontWeight: 700 }, 'set')
    assert(store.getStyle(0, 20)?.fontWeight === 700, 'Store 样式未写入')
    handle.controls.toolbar.applyFragment({ fontWeight: 700 }, 'toggle')
    const after = store.getStyle(0, 20)
    assert(after === undefined || after.fontWeight === undefined, 'toggle 未取消样式')
  })

  await checker.step('sheet 撤销/重做：编辑提交入栈、undo/redo 回写 Store', () => {
    const container = activeContainer()
    store.setValue(0, 10, '原始')
    table.refreshCell(0, 10)
    table.selectCell(0, 10)
    assert(table.startEdit(0, 10), '进入编辑失败')
    const editor = container.querySelector<HTMLInputElement>('textarea, input')
    assert(editor, '编辑器浮层缺失')
    editor.value = '修改'
    assert(table.commitEdit(), '提交失败')
    assert(store.getValue(0, 10) === '修改', '编辑提交未落 Store')
    handle.undo()
    assert(store.getValue(0, 10) === '原始', '撤销未回写')
    handle.redo()
    assert(store.getValue(0, 10) === '修改', '重做未回写')
    store.setValue(0, 10, null)
  })

  await checker.step('sheet 查找替换：命中选中 + 全量替换', () => {
    store.setValue(6, 6, '查找目标甲')
    store.setValue(6, 7, '查找目标乙')
    const hit = handle.controls.find.findNext('查找目标')
    assert(hit && hit.col === 6 && hit.row === 6, `查找未命中 (${hit?.col},${hit?.row})`)
    const count = handle.controls.find.replaceAll('查找目标', '已替换')
    assert(count === 2, `替换数量 ${count}`)
    assert(store.getValue(6, 7) === '已替换乙', '替换内容错误')
    store.setValue(6, 6, null)
    store.setValue(6, 7, null)
  })

  await checker.step('sheet CSV 导出：原文公式与引号转义', () => {
    store.setValue(5, 5, 'a,"b')
    const csv = handle.controls.csv.exportCurrent()
    assert(csv.includes('=D1+D2'), 'CSV 应含公式原文')
    assert(csv.includes('"a,""b"'), 'CSV 引号转义缺失')
    store.setValue(5, 5, null)
  })

  await checker.step('sheet 结构操作：插入/删除行（Store 平移 + 引擎合并区同步）', () => {
    const label = store.getValue(0, 2)
    handle.controls.insertRow(1)
    assert(store.getValue(0, 3) === label && store.getValue(0, 2) == null, '插入行未平移')
    // 合并区随平移：Store (2,11)→(2,12)；引擎侧被覆盖格 (3,13) 命中主格文本
    assert(
      store.getMerges()[0]?.startRow === 12,
      `Store 合并区未平移（${String(store.getMerges()[0]?.startRow)}）`,
    )
    assert(
      handle.getTable().getCellText(3, 13).includes('合并区'),
      `引擎合并区未随平移同步（${handle.getTable().getCellText(3, 13).slice(0, 8)}）`,
    )
    handle.controls.deleteRow(1)
    assert(store.getValue(0, 2) === label, '删除行未还原')
    assert(store.getMerges()[0]?.startRow === 11, '删除行后 Store 合并区未还原')
    assert(
      handle.getTable().getCellText(3, 12).includes('合并区') &&
        handle.getTable().getCellText(3, 13) === '',
      '删除行后引擎合并区未还原',
    )
  })

  await checker.step('sheet 共享边裁决：相邻格对侧边不叠画，线宽恰为设定值（非双倍）', async () => {
    const container = activeContainer()
    const body = layerCanvas(container, 'body')
    // 竖向共享边 (5,10)|(6,10)：两侧各设 3px 红/蓝对侧边
    store.setStyle(5, 10, { border: { right: { width: 3, color: '#dc2626' } } })
    store.setStyle(6, 10, { border: { left: { width: 3, color: '#2563eb' } } })
    // 横向共享边 (5,8)|(5,9)：同上
    store.setStyle(5, 8, { border: { bottom: { width: 3, color: '#dc2626' } } })
    store.setStyle(5, 9, { border: { top: { width: 3, color: '#2563eb' } } })
    table.batchUpdate(() => {
      table.refreshCell(5, 10)
      table.refreshCell(6, 10)
      table.refreshCell(5, 8)
      table.refreshCell(5, 9)
    })
    // 前序步骤可能滚过表：回到原点再按实时几何采样
    table.scrollTo(0, 0)
    await frames(2)
    // 列边界 = (5,10) 右缘；所有者 (5,10) 在自己矩形内画 3px（等宽取所有者红边）；
    // 界外邻居格白底（不叠蓝、不加宽）
    const vertical = table.getCellRelativeRect(5, 10)
    assert(vertical, '(5,10) 不在可视窗口')
    const bx = Math.round(vertical.x + vertical.width)
    const cy = Math.round(vertical.y + vertical.height / 2)
    expectColor(body, bx - 3, cy, '#dc2626', '共享竖边左端')
    expectColor(body, bx - 1, cy, '#dc2626', '共享竖边右端')
    expectColor(body, bx, cy, '#ffffff', '共享竖边界外不叠画')
    expectColor(body, bx + 1, cy, '#ffffff', '共享竖边不双倍宽')
    // 行边界 = (5,8) 下缘；所有者 (5,8) 画 3px
    const horizontal = table.getCellRelativeRect(5, 8)
    assert(horizontal, '(5,8) 不在可视窗口')
    const by = Math.round(horizontal.y + horizontal.height)
    const cx = Math.round(horizontal.x + horizontal.width / 2)
    expectColor(body, cx, by - 3, '#dc2626', '共享横边上端')
    expectColor(body, cx, by - 1, '#dc2626', '共享横边下端')
    expectColor(body, cx, by, '#ffffff', '共享横边界外不叠画')
    expectColor(body, cx, by + 1, '#ffffff', '共享横边不双倍宽')
    // 还原（不污染后续步骤）
    store.clearStyle(5, 10)
    store.clearStyle(6, 10)
    store.clearStyle(5, 8)
    store.clearStyle(5, 9)
    table.batchUpdate(() => {
      table.refreshCell(5, 10)
      table.refreshCell(6, 10)
      table.refreshCell(5, 8)
      table.refreshCell(5, 9)
    })
  })

  await checker.step('sheet 冻结分隔线：sky 浮层画冻结行/列边界线', async () => {
    const container = activeContainer()
    table.clearSelection()
    table.setFrozenColCount(1)
    table.setFrozenRowCount(1)
    await frames(2)
    const sky = layerCanvas(container, 'sky')
    // 竖线：冻结列右缘 x = 46 + 80 = 126（线体贴边界 [125,126)）；横线：冻结行下缘 y = 28 + 28 = 56（[55,56)）
    expectColor(sky, 125, 100, '#B6BABF', '冻结列分隔线')
    expectColor(sky, 200, 55, '#B6BABF', '冻结行分隔线')
    table.setFrozenColCount(0)
    table.setFrozenRowCount(0)
    await frames(2)
    // 冻结数归零后分隔线消失（sky 重绘后该处无像素）
    const [r, g, b, a] = readPixel(sky, 125, 100)
    assert(a === 0, `取消冻结后分隔线仍在 rgb(${r},${g},${b}) α=${a}`)
  })

  await checker.step('sheet numFmt：右键菜单设千分位 → 显示格式化；清除恢复', async () => {
    const container = activeContainer()
    table.scrollTo(0, 0)
    store.setValue(8, 9, 1234.5)
    table.refreshCell(8, 9)
    await frames(2)
    assert(table.getCellText(8, 9) === '1234.5', `裸值显示 ${table.getCellText(8, 9)}`)
    // 右键 (8,9)：x = 46 + 8×80 + 40 = 726；y = 28(列头) + 9×28 + 16(行3加高) + 14 = 310
    const openMenu = (): void => {
      const rect = container.getBoundingClientRect()
      container.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: rect.left + 726,
          clientY: rect.top + 310,
        }),
      )
    }
    const menuItem = (text: string): HTMLElement => {
      const item = [...document.querySelectorAll<HTMLElement>('.sheet-menu__item')].find(
        (el) => el.textContent === text || el.textContent?.startsWith(text),
      )
      assert(item, `菜单项「${text}」未出现`)
      return item
    }
    openMenu()
    menuItem('设置数据格式').click()
    menuItem('千分位金额').click()
    await frames(2)
    assert(
      table.getCellText(8, 9) === '1,234.50',
      `千分位显示 ${table.getCellText(8, 9)}（期望 1,234.50）`,
    )
    assert(handle.controls.numFmt.get(8, 9)?.kind === 'thousands', 'numFmt 侧车未写入')
    assert(store.getValue(8, 9) === 1234.5, 'numFmt 不应改动原始值')
    // 清除格式 → 恢复原始显示
    openMenu()
    menuItem('设置数据格式').click()
    menuItem('清除格式').click()
    await frames(2)
    assert(table.getCellText(8, 9) === '1234.5', `清除后显示 ${table.getCellText(8, 9)}`)
    assert(handle.controls.numFmt.get(8, 9) === undefined, 'numFmt 侧车未清除')
    store.setValue(8, 9, null)
    table.refreshCell(8, 9)
  })

  await checker.step(
    'sheet xlsx round-trip：导出整本 → 导入重建，值/公式/合并/冻结/尺寸/样式/numFmt 保真',
    async () => {
      // 造 fixture（冻结/行列尺寸/样式/numFmt 均入 Store 与侧车，导出端从这里取）
      store.setValue(0, 20, 3.14159)
      handle.controls.numFmt.set(0, 20, { kind: 'fixed', digits: 2 })
      store.setValue(1, 20, 45000) // 1900 序列数 = 2023-03-15
      handle.controls.numFmt.set(1, 20, { kind: 'date' })
      store.setStyle(2, 20, { background: '#ff0000' })
      store.setFrozen({ colCount: 1, rowCount: 1 })
      store.setColWidth(1, 120)
      store.setRowHeight(5, 40)
      // 页内 round-trip：导出整本 → 字节直接回导（无需二进制 fixture）
      const bytes = await handle.controls.xlsx.exportBook()
      assert(bytes.length > 100, `导出字节数异常 ${bytes.length}`)
      await handle.controls.xlsx.importBuffer(bytes)
      await frames(3)
      // 重建后改从句柄重取（旧 store/table 已随 book 替换失效）
      const store2 = handle.getStore()
      const table2 = handle.getTable()
      const ids = handle.ids()
      assert(ids.length === 2, `导入后表数 ${ids.length}（期望 2）`)
      const tabTexts = [...document.querySelectorAll('.sheet-tab')].map((el) => el.textContent)
      assert(
        tabTexts[0] === 'Sheet1' && tabTexts[1] === 'Sheet2',
        `表名未沿用：${tabTexts.join('/')}`,
      )
      // 值抽样
      assert(
        store2.getValue(0, 2) === '样式矩阵 ↓',
        `值抽样 (0,2)=${String(store2.getValue(0, 2))}`,
      )
      assert(store2.getValue(0, 20) === 3.14159, '数字值未保真')
      // 公式格：Store 存 '=' 原文、显示求值结果
      assert(store2.getValue(3, 2) === '=D1+D2', `公式原文 ${String(store2.getValue(3, 2))}`)
      assert(table2.getCellText(3, 2) === '12', `公式格显示 ${table2.getCellText(3, 2)}（期望 12）`)
      // 合并区
      assert(
        store2
          .getMerges()
          .some((m) => m.startCol === 2 && m.startRow === 11 && m.endCol === 4 && m.endRow === 12),
        `合并区丢失：${JSON.stringify(store2.getMerges())}`,
      )
      // 冻结（Store 与引擎实例两侧）
      assert(
        store2.getFrozen().colCount === 1 && store2.getFrozen().rowCount === 1,
        `Store 冻结 ${JSON.stringify(store2.getFrozen())}`,
      )
      assert(
        table2.getFrozenColCount() === 1 && table2.getFrozenRowCount() === 1,
        '引擎冻结数未随导入应用',
      )
      // 列宽：120px → (120-5)/7 ≈ 16 字符 → 16×7+5 = 117px；行高：40px → 30pt → 40px（精确）
      assert(store2.getColWidth(1) === 117, `列宽 ${store2.getColWidth(1)}（期望 117）`)
      assert(store2.getRowHeight(5) === 40, `行高 ${store2.getRowHeight(5)}（期望 40）`)
      // 样式抽样：背景 / 粗体 / 边框（solid 2px → medium → solid 2px）
      assert(store2.getStyle(2, 20)?.background === '#ff0000', '背景色未保真')
      assert(store2.getStyle(1, 4)?.fontWeight === 700, '粗体未保真')
      const edge = store2.getStyle(1, 7)?.border?.left
      assert(
        edge?.width === 2 && edge.color === '#2563eb' && edge.style === 'solid',
        `边框未保真：${JSON.stringify(edge)}`,
      )
      // numFmt 显示（fixed(2) 两位小数、date 1900 序列数 → 日期文本）
      assert(table2.getCellText(0, 20) === '3.14', `fixed(2) 显示 ${table2.getCellText(0, 20)}`)
      assert(
        table2.getCellText(1, 20) === '2023-03-15',
        `date 显示 ${table2.getCellText(1, 20)}（期望 2023-03-15）`,
      )
      assert(handle.controls.numFmt.get(0, 20)?.kind === 'fixed', 'numFmt 未随导入还原')
      // 第二张表值抽样 + 切回第一张
      handle.switchTo(ids[1]!)
      await frames(2)
      assert(
        handle.getStore().getValue(0, 0) === 0 && handle.getStore().getValue(3, 5) === 35,
        'Sheet2 值未保真',
      )
      handle.switchTo(ids[0]!)
      await frames(2)
    },
  )
}
