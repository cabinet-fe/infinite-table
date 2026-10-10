// 页内冒烟自检（?smoke=1 由 app/SmokeMode.tsx 触发）：对各演示区逐项断言——
// 层结构、取值管线、像素级显示能力（冻结/合并/逐边边框/自定义渲染/checkbox/主题）、
// 合成事件驱动的交互（拖选/整行整列/resize/键盘/触控/批量更新/contextmenu/onScrollFrame）、
// 图片加载与无闪回滚、浮动对象跟随、图表格（四类声明解析/离屏出图上屏/缓存命中/滚回无闪）、
// 编辑闭环（双击/键盘/API/滚动跟随与滚出提交）。
// 结果写 window.__SMOKE__ 与 document.title。

import { normalizeRange, type CellChangeEvent, type ListTable } from '@infinitable/core'

import type { DemoHandles } from './app/types'
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
import {
  CHART_SCROLL_CHART_COLS,
  CHART_SCROLL_VARIANTS,
  CHART_STATIC_COL_TYPES,
  CHART_STATIC_ROW_COUNT,
} from './sections/chart'
import { FLOAT_OBJECT_ID, imageUrlForRow } from './sections/media'
import {
  REPORT_COL_WIDTHS,
  REPORT_FLOAT_IMAGE_ID,
  REPORT_ROWS,
  REPORT_TITLE_BACKGROUND,
} from './sections/report'

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

/** 区域扫描：存在不透明像素（选区/图片等内容绘制判定） */
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

function dispatchKey(container: HTMLElement, key: string, shiftKey = false, ctrlKey = false): void {
  // cancelable 对齐真实 keydown（可取消）：非可取消事件上 preventDefault 是空操作，
  // grid 消费后 document 级兜底监听读不到 defaultPrevented 会重复撤销/重做
  container.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, shiftKey, ctrlKey }),
  )
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

  await checker.step(
    'resize 手柄光标：列缘 col-resize / 行缘 row-resize，数据格恢复缺省',
    async () => {
      const cursor = () => container.style.cursor
      // 列缘（列 1 右缘 = 列 2 左缘，列头带内）→ col-resize；列头带内非边缘 → 缺省
      dispatchPointer(container, 'pointermove', colLeftX(table, 2), HEADER_HEIGHT / 2)
      assert(cursor() === 'col-resize', `列缘光标为 ${cursor()}`)
      dispatchPointer(container, 'pointermove', colCenterX(table, 1), HEADER_HEIGHT / 2)
      assert(cursor() === 'auto', `列头带内非边缘光标为 ${cursor()}`)
      // 行缘（行 2 下缘 = 行 3 上缘，行号列带内）→ row-resize；数据格 → 缺省
      dispatchPointer(container, 'pointermove', ROW_HEADER_WIDTH / 2, rowTopY(table, 3))
      assert(cursor() === 'row-resize', `行缘光标为 ${cursor()}`)
      dispatchPointer(container, 'pointermove', colCenterX(table, 1), rowCenterY(table, 1))
      assert(cursor() === 'auto', `数据格光标为 ${cursor()}`)
    },
  )

  await checker.step('resize 会话期光标：拖离命中区不闪回，抬起按落点重判', async () => {
    const cursor = () => container.style.cursor
    const edge = colLeftX(table, 2)
    // 按下列缘后指针滑进行体深处（远离命中区）：会话期恒为 col-resize
    dispatchPointer(container, 'pointerdown', edge, HEADER_HEIGHT / 2)
    assert(cursor() === 'col-resize', `按下后光标为 ${cursor()}`)
    dispatchPointer(container, 'pointermove', edge, rowCenterY(table, 4))
    assert(cursor() === 'col-resize', `会话拖离后光标为 ${cursor()}`)
    // 原位抬起（x 不变 → 列宽不变）：落点已在表体 → 重判为缺省
    dispatchPointer(container, 'pointerup', edge, rowCenterY(table, 4))
    assert(cursor() === 'auto', `抬起后光标为 ${cursor()}`)
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
    // media 演示区挂载两个浮动对象：跟随演示（FLOAT_OBJECT_ID）+ 缩放旋转演示对象
    assert(table.floatObjects.size === 2, `浮动对象数 ${table.floatObjects.size}`)
    // 锚点 (2,1)+offset(8,8)：层坐标 x=256..548，y=76..164
    assert(table.floatObjects.getAt(300, 100)?.id === FLOAT_OBJECT_ID, '浮动对象未命中')
    table.scrollBy(0, 64)
    await frames(2)
    assert(table.floatObjects.getAt(300, 36)?.id === FLOAT_OBJECT_ID, '滚动后浮动对象未跟随')
    table.scrollBy(0, -64)
    await frames(2)
  })
}

/** 声明类型 → 规范化 spec 类型（area 归一为 line，插件解析语义的页面级抽查） */
const CHART_SPEC_TYPES: Record<(typeof CHART_STATIC_COL_TYPES)[number], string> = {
  bar: 'bar',
  line: 'line',
  area: 'line',
  pie: 'pie',
}

/** 等到表内图表格全部出图就绪（首次含 Chart.js 动态库加载，留足超时） */
async function waitChartBitmaps(table: ListTable, label: string): Promise<void> {
  const deadline = Date.now() + 8000
  for (;;) {
    const nodes = [...table.chartCellNodes.values()]
    if (nodes.length > 0 && nodes.every((node) => node.hasBitmap)) {
      return
    }
    assert(Date.now() < deadline, `${label}图表格出图超时`)
    await sleep(50)
  }
}

/** 图表格格区域在 media 层的像素存在断言（内缩 4px 避开格线） */
function expectChartPainted(
  canvas: HTMLCanvasElement,
  table: ListTable,
  col: number,
  row: number,
  label: string,
): void {
  const x0 = colLeftX(table, col)
  const y0 = rowTopY(table, row)
  assert(
    hasOpaquePixel(
      canvas,
      x0 + 4,
      y0 + 4,
      x0 + table.getColWidth(col) - 4,
      y0 + table.getRowHeight(row) - 4,
    ),
    `${label} (${col},${row}) media 层未上屏`,
  )
}

async function checkChart(checker: Checker, demos: DemoHandles): Promise<void> {
  const { staticMount, scrollMount, staticPlugin } = demos.chart
  const staticTable = staticMount.table
  const scrollTable = scrollMount.table

  await checker.step('图表：四类声明经插件解析成 spec（渲染成功）', () => {
    for (let row = 0; row < CHART_STATIC_ROW_COUNT; row++) {
      CHART_STATIC_COL_TYPES.forEach((type, index) => {
        const spec = staticPlugin.getChartSpec(index + 1, row)
        assert(spec, `(${index + 1},${row}) ${type} 声明未解析出 spec`)
        assert(
          spec.type === CHART_SPEC_TYPES[type],
          `${type} spec 类型 ${spec.type}，期望 ${CHART_SPEC_TYPES[type]}`,
        )
      })
    }
    assert(staticTable.chartMediaResolver !== null, '图表插件未挂到静态表')
    assert(
      staticTable.chartCellNodes.size === CHART_STATIC_ROW_COUNT * CHART_STATIC_COL_TYPES.length,
      `静态表图表格数 ${staticTable.chartCellNodes.size}`,
    )
  })

  await checker.step('图表：离屏出图位图上屏（media 层像素）', async () => {
    const media = layerCanvas(staticMount.container, 'media')
    await waitChartBitmaps(staticTable, '静态表')
    await frames(2)
    for (let row = 0; row < CHART_STATIC_ROW_COUNT; row++) {
      CHART_STATIC_COL_TYPES.forEach((_, index) => {
        expectChartPainted(media, staticTable, index + 1, row, '静态表图表格')
      })
    }
  })

  await checker.step('图表：位图落 cell 级 LRU（缓存直读命中）', async () => {
    await waitChartBitmaps(scrollTable, '滚动表')
    for (const node of staticTable.chartCellNodes.values()) {
      assert(staticTable.mediaCache.get(node.cacheKey), `静态表缓存缺失 ${node.cacheKey}`)
    }
    for (const node of scrollTable.chartCellNodes.values()) {
      assert(scrollTable.mediaCache.get(node.cacheKey), `滚动表缓存缺失 ${node.cacheKey}`)
    }
    assert(
      scrollTable.mediaCache.size <= CHART_SCROLL_VARIANTS * CHART_SCROLL_CHART_COLS.length,
      `滚动表缓存条目 ${scrollTable.mediaCache.size}，超出共享变体上限（未收敛单飞）`,
    )
  })

  await checker.step('图表滚动：滚出再滚回，首帧即位图（无闪 + 缓存命中）', async () => {
    const media = layerCanvas(scrollMount.container, 'media')
    scrollTable.scrollTo(0, 1600)
    await frames(3)
    scrollTable.scrollTo(0, 0)
    await frames(1) // 只等一帧：缓存命中的图表格必须首帧直贴
    for (const col of CHART_SCROLL_CHART_COLS) {
      const node = [...scrollTable.chartCellNodes.values()].find(
        (n) => n.col === col && n.row === 0,
      )
      assert(node, `滚动表 (${col},0) 图表格节点缺失`)
      assert(node.hasBitmap, `滚动表 (${col},0) 回滚首帧位图缺失（有闪）`)
      expectChartPainted(media, scrollTable, col, 0, '滚动表图表格')
    }
  })
}

async function checkEditing(checker: Checker, demos: DemoHandles): Promise<void> {
  const { table, container } = demos.editing.mount
  const { model } = demos.editing

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

  await checker.step('编辑：API startEdit/commitEdit/cancelEdit', () => {
    const { api, status } = demos.editing
    api.startEdit()
    const input = container.querySelector<HTMLInputElement>('input')
    assert(input, 'startEdit 未打开浮层')
    assert(input.value === '名称-3', `API 编辑初值 ${input.value}，期望 名称-3`)
    input.value = 'API-改'
    api.commitEdit()
    assert(model.getCellValue(0, 3) === 'API-改', `commitEdit 未回写：${model.getCellValue(0, 3)}`)
    assert(status.text.includes('已提交 (0,3)') === true, `状态回执：${status.text}`)
    api.startEdit()
    assert(container.querySelector('input'), '再次 startEdit 未打开浮层')
    api.cancelEdit()
    assert(!container.querySelector('input'), 'cancelEdit 未关闭浮层')
    assert(model.getCellValue(0, 3) === 'API-改', 'cancelEdit 改动了数据')
    assert(status.text.includes('已取消') === true, `状态回执：${status.text}`)
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
  await checkChart(checker, demos)
  await checkEditing(checker, demos)
  await checkReport(checker)
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

/** 报表演示区冒烟：快照全量灌入模型 + readonly 渲染（meta 迁移参考形态的行为锚点） */
async function checkReport(checker: Checker): Promise<void> {
  const handle = window.__REPORT_DEMO__
  assert(handle, '缺少 __REPORT_DEMO__ 句柄')
  const table = handle.getTable()
  const sheet = handle.getSheet()

  await checker.step('report 快照灌入：全量负载落模型，重采集等价（restore 往返）', () => {
    const fixture = handle.buildSnapshot()
    const roundTrip = handle.saveSnapshot()
    // 值：条目数一致 + 抽样（标题/表头带/数据行/合计行）
    assert(
      roundTrip.cells.length === fixture.cells.length,
      `快照格数 ${roundTrip.cells.length}，期望 ${fixture.cells.length}`,
    )
    assert(
      sheet.getDisplayValue({ row: REPORT_ROWS.title, col: 0 }) === '2026 Q3 销售汇总报表' &&
        sheet.getDisplayValue({ row: REPORT_ROWS.headerTop, col: 1 }) === '区域' &&
        sheet.getDisplayValue({ row: REPORT_ROWS.headerSub, col: 7 }) === '环比',
      '快照值抽样不符',
    )
    const dataSample = sheet.getDisplayValue({ row: 10, col: 2 })
    assert(dataSample !== undefined && dataSample !== null, '数据行值缺失')
    assert(
      typeof sheet.getDisplayValue({ row: REPORT_ROWS.summary, col: 4 }) === 'number',
      '合计行数值缺失',
    )
    // 合并/冻结/尺寸：按界关键字集合比对
    const keyOf = (r: { start: { col: number; row: number }; end: { col: number; row: number } }) =>
      `${r.start.col},${r.start.row},${r.end.col},${r.end.row}`
    assert(
      roundTrip.merges.map(keyOf).sort().join('|') === fixture.merges.map(keyOf).sort().join('|'),
      '合并区往返不等价',
    )
    assert(
      roundTrip.frozen.rows === fixture.frozen.rows &&
        roundTrip.frozen.cols === fixture.frozen.cols,
      `冻结往返 ${JSON.stringify(roundTrip.frozen)}`,
    )
    assert(
      (roundTrip.colWidths ?? []).map(([col, width]) => `${col}:${width}`).join('|') ===
        REPORT_COL_WIDTHS.map((width, col) => `${col}:${width}`).join('|'),
      '列宽覆盖往返不等价',
    )
    assert(
      (roundTrip.rowHeights ?? []).map(([row, height]) => `${row}:${height}`).join('|') ===
        (fixture.rowHeights ?? []).map(([row, height]) => `${row}:${height}`).join('|'),
      '行高覆盖往返不等价',
    )
    // 样式：池定义数一致 + 列级右对齐 + 标题格样式抽样（格 s 引用 → 池定义）
    assert(
      roundTrip.styles.length === fixture.styles.length,
      `样式池条目 ${roundTrip.styles.length}，期望 ${fixture.styles.length}`,
    )
    for (const col of [4, 5, 6, 7]) {
      const id = (roundTrip.colStyles ?? []).find(([c]) => c === col)?.[1]
      assert(
        id != null && roundTrip.styles[id - 1]?.align?.horizontal === 'right',
        `列 ${col} 级右对齐往返不等价`,
      )
    }
    const titleItem = roundTrip.cells.find(
      (item) => item.col === 0 && item.row === REPORT_ROWS.title,
    )
    const titleStyle = titleItem?.s != null ? roundTrip.styles[titleItem.s - 1] : undefined
    assert(
      titleStyle?.fill?.color === REPORT_TITLE_BACKGROUND && titleStyle?.font?.bold === true,
      '标题样式往返不符',
    )
    // meta：命名空间与条目（flat 条目）+ 报表级载荷抽样
    assert(
      (roundTrip.meta ?? [])
        .map((item) => item.namespace)
        .sort()
        .join(',') ===
        (fixture.meta ?? [])
          .map((item) => item.namespace)
          .sort()
          .join(','),
      'meta 命名空间往返不等价',
    )
    assert((roundTrip.meta ?? []).length === (fixture.meta ?? []).length, 'meta 条目数往返不等价')
    assert(
      JSON.stringify(sheet.getCellMeta({ row: REPORT_ROWS.title, col: 0 }, 'report')) ===
        JSON.stringify({ template: 'quarterly-sales', version: 3 }),
      '报表级 meta 抽样不符',
    )
    // 浮动图与选区随快照携带
    assert(
      roundTrip.images?.length === 1 && roundTrip.images[0]?.id === REPORT_FLOAT_IMAGE_ID,
      '浮动图未随快照携带',
    )
    assert(
      roundTrip.selection?.ranges.length === 1 &&
        keyOf(roundTrip.selection.ranges[0]!) ===
          `0,${REPORT_ROWS.summary},7,${REPORT_ROWS.summary}`,
      '选区未随快照携带',
    )
  })

  await checker.step('report 渲染可见：合并标题带跨满全表、快照内容上屏', async () => {
    const container = handle.getContainer()
    const body = layerCanvas(container, 'body')
    // 行列头关闭（内容原点 0,0）：标题合并区 (0,0)~(7,0) 跨满 734px、高 42 ——
    // 采样取带右端 (710,6)（避开居中标题文字的反锯齿），跨满即证明合并渲染生效
    expectColor(body, 710, 6, REPORT_TITLE_BACKGROUND, '报表标题合并带')
    // 表头带底色：(3,2)~(3,3) 纵合并跨行 [98,126)，x 落列 3 [256,366)
    expectColor(body, 300, 120, '#eef2f7', '表头带底色')
    assert(
      table.getCellText(0, REPORT_ROWS.title) === '2026 Q3 销售汇总报表',
      `标题显示 ${table.getCellText(0, REPORT_ROWS.title)}`,
    )
    assert(
      table.getCellText(4, REPORT_ROWS.summary) ===
        String(sheet.getDisplayValue({ row: REPORT_ROWS.summary, col: 4 })),
      '合计销售额未渲染',
    )
  })

  await checker.step('report 选区回灌与浮动图随快照接线 + 重灌幂等', async () => {
    assert(table.floatObjects.size === 1, `浮动图数 ${table.floatObjects.size}`)
    const floatImage = table.floatObjects.get(REPORT_FLOAT_IMAGE_ID)
    assert(floatImage?.anchor.from.col === 5, '浮动图锚点未随快照应用')
    const selection = table.getSelection()
    assert(selection.ranges.length === 1, '快照选区未应用')
    const bounds = normalizeRange(selection.ranges[0]!)
    assert(
      bounds.minCol === 0 &&
        bounds.maxCol === 7 &&
        bounds.minRow === REPORT_ROWS.summary &&
        bounds.maxRow === REPORT_ROWS.summary,
      `选区 (${bounds.minCol},${bounds.minRow})~(${bounds.maxCol},${bounds.maxRow})`,
    )
    // 重灌（restore 替换语义）：模型与浮动图对账后一切如初
    handle.reloadSnapshot()
    await frames(2)
    assert(table.floatObjects.size === 1, '重灌后浮动图对账异常')
    assert(sheet.merges.getMerges().length === 10, '重灌后合并区丢失')
    assert(table.getCellText(0, REPORT_ROWS.title) === '2026 Q3 销售汇总报表', '重灌后标题丢失')
  })

  await checker.step('report readonly 生效：禁编辑、禁尺寸拖改、填充柄无写路径', async () => {
    const container = handle.getContainer()
    // 双击数据格无编辑浮层（readonly 不注册编辑器）
    const cellRect = table.getCellRelativeRect(2, 8)
    assert(cellRect, '(2,8) 不在可视窗口')
    const cx = cellRect.x + cellRect.width / 2
    const cy = cellRect.y + cellRect.height / 2
    dispatchPointer(container, 'pointerdown', cx, cy)
    dispatchPointer(container, 'pointerup', cx, cy)
    dispatchPointer(container, 'pointerdown', cx, cy)
    dispatchPointer(container, 'pointerup', cx, cy)
    assert(!container.querySelector('input, textarea'), 'readonly 双击出现编辑浮层')
    assert(!table.startEdit(2, 8), 'readonly startEdit 未返回 false')
    // 拖列边缘 +24：readonly 禁 resize → 宽度不变（禁交互写路径之尺寸面）
    const edge = cellRect.x + cellRect.width
    dispatchPointer(container, 'pointerdown', edge, cy)
    dispatchPointer(container, 'pointermove', edge + 24, cy)
    dispatchPointer(container, 'pointerup', edge + 24, cy)
    assert(
      table.getColWidth(2) === REPORT_COL_WIDTHS[2],
      `readonly 列宽被拖改 ${table.getColWidth(2)}`,
    )
    // 填充柄拖拽：readonly 不接填充生成 → 拖后值不变（禁交互写路径之填充面）
    table.selectCells([{ start: { col: 4, row: 5 }, end: { col: 4, row: 7 } }])
    await frames(2)
    const anchorRect = table.getCellRelativeRect(4, 7)
    assert(anchorRect, '(4,7) 不在可视窗口')
    const hx = anchorRect.x + anchorRect.width - 2
    const hy = anchorRect.y + anchorRect.height - 2
    const before8 = sheet.getDisplayValue({ row: 8, col: 4 })
    const before9 = sheet.getDisplayValue({ row: 9, col: 4 })
    const dragX = anchorRect.x + anchorRect.width / 2
    const dragY = hy + 64
    dispatchPointer(container, 'pointerdown', hx, hy)
    dispatchPointer(container, 'pointermove', dragX, dragY)
    dispatchPointer(container, 'pointerup', dragX, dragY)
    assert(
      sheet.getDisplayValue({ row: 8, col: 4 }) === before8 &&
        sheet.getDisplayValue({ row: 9, col: 4 }) === before9,
      'readonly 填充拖拽产生了写入',
    )
  })
}
