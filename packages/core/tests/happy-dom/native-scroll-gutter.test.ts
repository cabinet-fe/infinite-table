// @vitest-environment happy-dom
// 原生滚动条档 gutter 命中守卫回归：等几何复现 smoke「原生滚动条⑥」缺陷形态——
// Object.defineProperty 覆写 wrapper clientWidth/clientHeight 模拟原生 gutter
// 扣除（用法同 native-scrollbar-mount.test.ts），几何对齐 smoke 失败实例
// （880×420 视口、col0 宽 120 其余 110 共 14 列、1200 行记录、行号列 48/列头
// 36/行高 32 主题缺省、冻结 1×1、scrollTo(160, 320) 残留）：部分可见末列的
// 格节点命中盒是整列宽节点几何（不按绘制边界裁剪），伸进 gutter 带
// （scrollLeft=160 残留下命中盒 778..888，含 x=869=clientWidth+4），hitTest
// 命中并冒泡到 body 根——绘制边界外的 pointerdown 必须被 onPointerDown 入口
// 守卫直接返回，不启动任何命中会话。合成 PointerEvent 一律 bubbles: true
// 派发在真实传播路径元素上：按装配 pointer-events 推导真实命中元素（spacer
// 关闭继承使视口层计算值同为 none，内容区点击现状上浮到 wrapper），禁止直投
// 场景根或引擎监听元素。happy-dom 无布局：getBoundingClientRect 恒零 →
// clientX/Y 即层坐标。

import { afterEach, describe, expect, it } from 'vitest'

import { ListTable } from '../../src/list-table'
import type { ListTableOptions } from '../../src/types'

/** smoke 等几何锚点（对齐 playground/src/sections/native-scroll.ts 的 NATIVE_LIST_*） */
const VIEW_WIDTH = 880
const VIEW_HEIGHT = 420
const FROZEN_COL_WIDTH = 120
const COL_WIDTH = 110
const COL_COUNT = 14
const ROW_COUNT = 1200
/** 模拟原生经典滚动条两轴 gutter 扣除量（smoke 实测 15px：client 865×405） */
const GUTTER = 15
/** 缺陷残留偏移（smoke ⑤ 程序化滚动后的指针序列落点基准） */
const RESIDUAL_LEFT = 160
const RESIDUAL_TOP = 320

const COLUMNS = Array.from({ length: COL_COUNT }, (_, col) => ({
  field: `c${col}`,
  title: `列 ${col}`,
  width: col === 0 ? FROZEN_COL_WIDTH : COL_WIDTH,
}))

/** 等一帧：滚动窗口重建（updateSceneWindow 同步落地，等待兜底帧调度副作用） */
const waitFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 挂载等几何缺陷形态：原生档表 + 覆写 wrapper client 口径扣 gutter + 几何重算
 * + scrollTo(160, 320) 残留偏移。返回真实命中元素（见 hitTarget）与表实例。
 */
async function mountGutterScenario() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const table = new ListTable({
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    scrollbar: { mode: 'native' },
    columns: COLUMNS,
    records: Array.from({ length: ROW_COUNT }, (_, row) =>
      Object.fromEntries(COLUMNS.map((column) => [column.field, `格 ${column.field}-${row}`])),
    ),
    frozenColCount: 1,
    frozenRowCount: 1,
    hostOptions: { container },
  } satisfies ListTableOptions)
  const wrapper = container.querySelector<HTMLElement>('[data-native-scroll]')
  if (!wrapper) {
    throw new Error('原生滚动容器未落宿主容器')
  }
  Object.defineProperty(wrapper, 'clientWidth', { value: VIEW_WIDTH - GUTTER })
  Object.defineProperty(wrapper, 'clientHeight', { value: VIEW_HEIGHT - GUTTER })
  table.applyGeometryChange()
  table.scrollTo(RESIDUAL_LEFT, RESIDUAL_TOP)
  await waitFrame()
  return { container, wrapper, table }
}

/**
 * 真实 hit-test 会命中的元素：按装配 pointer-events 计算值推导——spacer 关闭
 * （经继承使 viewport/层 canvas 计算值同为 none）时内容区点击命中上浮到
 * wrapper；装配若改为恢复视口层命中（事件源仍可达的等价形态）则取 viewport。
 * 两者都沿祖先链冒泡必经引擎监听（宿主容器），非直投引擎私有监听元素。
 */
function hitTarget(wrapper: HTMLElement): HTMLElement {
  const spacer = wrapper.firstElementChild as HTMLElement
  const viewport = spacer.firstElementChild as HTMLElement
  const spacerOff = spacer.style.pointerEvents === 'none'
  const viewportRestored =
    viewport.style.pointerEvents !== '' && viewport.style.pointerEvents !== 'none'
  return spacerOff && !viewportRestored ? wrapper : viewport
}

/** 在真实传播路径元素上派发合成指针事件（bubbles 冒泡经引擎监听元素） */
function firePointer(
  target: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }))
}

describe('happy-dom 原生档 gutter 命中守卫', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => {
    for (const dispose of cleanup.splice(0)) {
      dispose()
    }
  })

  /** 挂载缺陷形态并登记清理（表销毁 + 容器摘除） */
  async function mount() {
    const mounted = await mountGutterScenario()
    cleanup.push(() => {
      mounted.table.destroy()
      mounted.container.remove()
    })
    return mounted
  }

  it('等几何复现：绘制边界 = client 口径且小于 CSS 视口，滚动残留在引擎与 wrapper 一致', async () => {
    const { wrapper, table } = await mount()
    // gutter 两轴扣减后绘制边界（client 口径）= clientWidth/clientHeight，且被
    // canvas（CSS 视口尺寸）覆盖的 gutter 带无内容绘制
    expect(table.rowHeaderWidth + table.viewportWidth).toBe(wrapper.clientWidth)
    expect(table.headerHeight + table.viewportHeight).toBe(wrapper.clientHeight)
    expect(wrapper.clientWidth).toBeLessThan(VIEW_WIDTH)
    expect(wrapper.clientHeight).toBeLessThan(VIEW_HEIGHT)
    expect(table.getScrollLeft()).toBe(RESIDUAL_LEFT)
    expect(table.getScrollTop()).toBe(RESIDUAL_TOP)
    expect(wrapper.scrollLeft).toBe(RESIDUAL_LEFT)
    expect(wrapper.scrollTop).toBe(RESIDUAL_TOP)
  })

  it('gutter 体带按下-拖动-抬起：不命中数据格、不改滚动位置（对应 smoke ⑥）', async () => {
    const { wrapper, table } = await mount()
    const target = hitTarget(wrapper)
    const x = wrapper.clientWidth + 4
    firePointer(target, 'pointerdown', x, 120)
    firePointer(target, 'pointermove', x, 180)
    firePointer(target, 'pointerup', x, 180)
    expect(table.getSelection().ranges).toHaveLength(0)
    expect(table.getScrollLeft()).toBe(RESIDUAL_LEFT)
    expect(table.getScrollTop()).toBe(RESIDUAL_TOP)
  })

  it('gutter 表头带同类落点：不启动表头拖选', async () => {
    const { wrapper, table } = await mount()
    const target = hitTarget(wrapper)
    const x = wrapper.clientWidth + 4
    firePointer(target, 'pointerdown', x, 10)
    firePointer(target, 'pointermove', x, 20)
    firePointer(target, 'pointerup', x, 20)
    expect(table.getSelection().ranges).toHaveLength(0)
  })

  it('gutter 序列后真实单击可视数据格：精确选中该格、无残留会话', async () => {
    const { wrapper, table } = await mount()
    const target = hitTarget(wrapper)
    // 先经历体带 + 表头带两组 gutter 序列（同一表实例），再验证无悬挂状态
    const gutterX = wrapper.clientWidth + 4
    firePointer(target, 'pointerdown', gutterX, 120)
    firePointer(target, 'pointermove', gutterX, 180)
    firePointer(target, 'pointerup', gutterX, 180)
    firePointer(target, 'pointerdown', gutterX, 10)
    firePointer(target, 'pointerup', gutterX, 20)
    table.clearSelection()
    // 滚动复位（DOM→引擎路径）：残留偏移下目标格（首个非冻结列 × 行 1）不可见
    wrapper.scrollLeft = 0
    wrapper.scrollTop = 0
    wrapper.dispatchEvent(new Event('scroll'))
    await waitFrame()
    expect(table.getScrollLeft()).toBe(0)
    expect(table.getScrollTop()).toBe(0)
    // 完整单击落在引擎口径的格中心：选区恰为该单格、焦点同格
    const rect = table.getCellRelativeRect(1, 1)
    expect(rect, '(1,1) 滚动复位后不在可视窗口').not.toBeNull()
    const x = rect!.x + rect!.width / 2
    const y = rect!.y + rect!.height / 2
    firePointer(target, 'pointerdown', x, y)
    firePointer(target, 'pointerup', x, y)
    const snapshot = table.getSelection()
    expect(snapshot.ranges).toHaveLength(1)
    expect(snapshot.ranges[0]).toMatchObject({
      start: { col: 1, row: 1 },
      end: { col: 1, row: 1 },
    })
    expect(snapshot.focus).toMatchObject({ col: 1, row: 1 })
  })
})
