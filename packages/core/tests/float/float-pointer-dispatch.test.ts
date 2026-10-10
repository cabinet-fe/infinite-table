// @vitest-environment happy-dom
// 真实指针链路回归（P4 浏览器返工）：DOM 事件（clientX/clientY − getBoundingClientRect）
// → EventSystem 跨层命中（sky→media→body）→ 命中链冒泡 → body 根交互接线 → 浮动对象路由。
// 背景：media 层格内图片节点曾以默认 pickable 参与跨层命中，把压在图片格上的浮动对象
// （本体拖拽）与变换手柄（旋转/缩放）的指针事件截在 media 根链——body 根上接线的
// onPointerDown/Move/Up 全部收不到；既有单测直接在 body 根 handleEvent，永远暴露不了
// 这层「真实 DOM→canvas 坐标 + 跨层派发」的差异，本组用例整链走真实事件系统补上。

import { describe, expect, it } from 'vitest'

import type { ListTableOptions } from '../../src/types'
import { ListTable } from '../../src/list-table'

/** 容器在页面中的偏移（非零——暴露 clientX − rect.left 换算回归） */
const PAGE_OFFSET = { left: 428, top: 234.5 }

/**
 * 录制式容器：包装真实 addEventListener 记录监听器，测试以 DOM 事件对象直接调用
 * （走 EventSystem 真实 dispatch：坐标换算 + 跨层 hitTest + 冒泡，不绕过事件系统）；
 * getBoundingClientRect 覆写为非零页面偏移，模拟真实布局下的 DOM 坐标。
 */
function createRecordingContainer() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const originalAdd = container.addEventListener.bind(container)
  const originalRemove = container.removeEventListener.bind(container)
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  container.addEventListener = ((type: string, listener: (event: unknown) => void) => {
    const list = listeners.get(type) ?? []
    list.push(listener)
    listeners.set(type, list)
    return originalAdd(type, listener as EventListener)
  }) as typeof container.addEventListener
  container.removeEventListener = ((type: string, listener: (event: unknown) => void) => {
    const list = (listeners.get(type) ?? []).filter((item) => item !== listener)
    listeners.set(type, list)
    return originalRemove(type, listener as EventListener)
  }) as typeof container.removeEventListener
  container.getBoundingClientRect = () =>
    ({ left: PAGE_OFFSET.left, top: PAGE_OFFSET.top, width: 400, height: 260 }) as DOMRect
  return {
    container,
    /** 以 DOM 事件对象触发容器上注册的监听器（层坐标 + 偏移 = 页面坐标口径） */
    fire: (type: string, x: number, y: number, extra: Record<string, unknown> = {}): void => {
      const events = listeners.get(type) ?? []
      expect(events.length, `容器上应有 ${type} 监听器（EventSystem 接线）`).toBeGreaterThan(0)
      for (const listener of events) {
        listener({
          clientX: PAGE_OFFSET.left + x,
          clientY: PAGE_OFFSET.top + y,
          button: 0,
          ...extra,
        })
      }
    },
  }
}

/**
 * 台架：全表格声明格内图片（media 层铺满 ImageCellNode，最大化跨层命中截胡面），
 * 叠一个 45° 旋转浮动对象——本体中心与顶部旋转手柄均压在图片格上。
 * 几何：行号列 48、列头 36、列宽 100、行高 32；对象 (58,110) 尺寸 120×80 中心 (118,150)，
 * 旋转手柄（上缘外 20px）旋转后落 (160.4, 107.6)——第 1 列图片格内。
 */
function mountDispatchTable() {
  const { container, fire } = createRecordingContainer()
  const options: ListTableOptions = {
    // 高度 260：拖拽行程终点 (158,170) 距视口下缘留出钳制余量（编辑态位置钳制
    // 会把旋转 AABB + 装饰外扩钳在 body 视口内，本组只验证指针派发链路）
    width: 400,
    height: 260,
    rowHeight: 32,
    headerHeight: 36,
    rowHeaderWidth: 48,
    defaultColWidth: 100,
    columns: [
      { field: 'a', title: 'A' },
      { field: 'b', title: 'B' },
    ],
    rowCount: 8,
    resolveCellImage: (col, row) => `demo://img/${col}-${row}`,
    imageServiceOptions: {
      loadImage: async () => ({ source: {} as CanvasImageSource, width: 4, height: 4 }),
    },
    hostOptions: { container },
  }
  const table = new ListTable(options)
  table.floatObjects.add({
    id: 'fx',
    kind: 'image',
    anchor: { from: { col: 0, row: 2 }, to: { col: 1, row: 3 }, offsetX: 10, offsetY: 10 },
    size: { width: 120, height: 80 },
    rotation: 45,
  })
  return { table, container, fire }
}

describe('浮动对象真实指针链路（DOM 坐标→跨层命中→body 路由）', () => {
  it('media 层格内图片节点不可拾取：跨层命中穿透到 body 数据格（根因回归）', () => {
    const { table } = mountDispatchTable()
    const mediaRoot = table.media?.root
    expect(mediaRoot, 'media 层应存在（全表格声明格内图片）').toBeTruthy()
    expect(mediaRoot!.children.length).toBeGreaterThan(0)
    for (const node of mediaRoot!.children) {
      expect(node.pickable, '格内图片是数据格装饰层，不得截胡跨层命中').toBe(false)
    }
    table.destroy()
  })

  it('DOM 坐标换算：带页面偏移的 clientX/clientY 命中数据格（选区焦点）', () => {
    const { table, fire } = mountDispatchTable()
    // 层坐标 (98, 68) = 第 0 列第 1 行格内（带 428/234.5 页面偏移派发）
    fire('pointerdown', 98, 68)
    expect(table.selection.snapshot.focus).toEqual({ col: 0, row: 1 })
    fire('pointerup', 98, 68)
    table.destroy()
  })

  it('C4：45° 旋转对象本体压在图片格上，真实事件链完成点选与拖拽（onDragEnd 落点换算）', () => {
    const { table, fire } = mountDispatchTable()
    const floats = table.floatObjects
    const dragEnd: Array<{
      anchor: { from: { col: number; row: number }; offsetX: number; offsetY: number }
    }> = []
    floats.onDragEnd((event) => dragEnd.push({ anchor: event.anchor }))
    // 按下对象中心 (118,150)（第 0 列图片格上）：点选 + 开启拖拽会话
    fire('pointerdown', 118, 150)
    expect(floats.getSelectedId()).toBe('fx')
    expect(floats.isDragging()).toBe(true)
    // 拖动 +40/+20（超 3px 阈值）后抬起：落点换算 (98,130) → (0,2) 格偏移 (50,30)
    fire('pointermove', 158, 170)
    expect(floats.isDragging()).toBe(true)
    fire('pointerup', 158, 170)
    expect(dragEnd.length).toBe(1)
    expect(dragEnd[0]!.anchor.from).toEqual({ col: 0, row: 2 })
    expect(dragEnd[0]!.anchor.offsetX).toBe(50)
    expect(dragEnd[0]!.anchor.offsetY).toBe(30)
    table.destroy()
  })

  it('C3：旋转手柄压在图片格上，真实事件链拖拽旋转并提交 onTransformEnd（45°→90°）', () => {
    const { table, fire } = mountDispatchTable()
    const floats = table.floatObjects
    const events: Array<{ rotation: number; size: { width: number; height: number } }> = []
    floats.onTransformEnd((event) => events.push({ rotation: event.rotation, size: event.size }))
    // 先点选（按下/抬起来完成选中，未成拖拽不提交）
    fire('pointerdown', 118, 150)
    fire('pointerup', 118, 150)
    expect(floats.getSelectedId()).toBe('fx')
    // 按下旋转手柄 (160.4, 107.6)（第 1 列图片格上，对象体外）：开启旋转会话
    fire('pointerdown', 160.4, 107.6)
    expect(floats.isTransforming()).toBe(true)
    // 绕中心顺时针拖 45°：手柄方位 (0,-60)→R(90°) 后的落点 (178, 150)
    fire('pointermove', 178, 150)
    expect(floats.isTransforming()).toBe(true)
    fire('pointerup', 178, 150)
    expect(events.length).toBe(1)
    expect(events[0]!.rotation).toBeCloseTo(90, 2)
    expect(events[0]!.size).toEqual({ width: 120, height: 80 })
    table.destroy()
  })

  it('C3-Shift：同链路按住 Shift 拖拽旋转吸附 15° 步进', () => {
    const { table, fire } = mountDispatchTable()
    const floats = table.floatObjects
    const events: Array<{ rotation: number }> = []
    floats.onTransformEnd((event) => events.push({ rotation: event.rotation }))
    fire('pointerdown', 118, 150)
    fire('pointerup', 118, 150)
    fire('pointerdown', 160.4, 107.6)
    // 手柄起始方位 −45°（atan2），拖到方位 −20°：增量 +25° → 45°+25°=70° → 吸附 75°
    const rad = (70 * Math.PI) / 180
    fire('pointermove', 118 + 60 * Math.sin(rad), 150 - 60 * Math.cos(rad), { shiftKey: true })
    fire('pointerup', 118 + 60 * Math.sin(rad), 150 - 60 * Math.cos(rad), { shiftKey: true })
    expect(events.length).toBe(1)
    expect(events[0]!.rotation).toBe(75)
    table.destroy()
  })

  it('悬停光标：旋转手柄 grab、缩放手柄对角向、表体回落 auto（真实 pointermove 链）', () => {
    const { table, container, fire } = mountDispatchTable()
    fire('pointerdown', 118, 150)
    fire('pointerup', 118, 150)
    // 旋转手柄（第 1 列图片格上）→ grab
    fire('pointermove', 160.4, 107.6)
    expect(container.style.cursor).toBe('grab')
    // 左上缩放手柄：局部 (0,0) 相对中心 (-60,-40) 旋转 45° → (118-14.1, 150-70.7)
    fire('pointermove', 103.9, 79.3)
    expect(container.style.cursor).toBe('nwse-resize')
    // 离开手柄（表体图片格上）→ auto
    fire('pointermove', 230, 68)
    expect(container.style.cursor).toBe('auto')
    table.destroy()
  })
})
