// @vitest-environment happy-dom
// 原生滚动条模式「真实传播路径」交互回归：合成 PointerEvent/KeyboardEvent 一律
// bubbles: true 派发在会到达引擎监听的 DOM 传播路径元素上——指针事件派发在真实
// hit-test 会命中的元素（按装配 pointer-events 计算值取，见 hitTarget），键盘
// 事件派发在宿主焦点契约元素（宿主容器 tabIndex=-1 聚焦，对齐 packages/sheet
// 的 bindFocus 形态），编辑器按键派发在编辑器 input 自身（startEdit 后焦点所在）。
// 禁止直投引擎私有监听元素或场景根（fire(root, ...) 式直调）——那正是缺陷漏检
// 盲区：引擎监听离路径时事件根本到不了，直投却恒绿。
// happy-dom 无布局：getBoundingClientRect 恒零 → clientX/Y 即层坐标；无级联
// 计算 → hitTarget 按装配内联值推导。默认几何：行号列 48、列头 36、行高 32、
// 列宽 100。防绕过验证记录：曾临时回退缺陷装配（spacer pointer-events: none 吞
// 命中 + 监听离路径的 sticky viewport）运行本套件，7 条用例全部转红；验证后已
// 恢复修复实现（详见 .agents/cooking/native-scroll-events/tasks/P2.md）。

import { afterEach, describe, expect, it } from 'vitest'

import { EditorRegistry } from '../../src/editor-registry'
import { ListTable } from '../../src/list-table'
import type { ListTableOptions } from '../../src/types'

const COLUMNS = Array.from({ length: 10 }, (_, i) => ({
  field: 'name',
  title: `C${i}`,
  editor: 'text',
}))

/** 各用例自建表的公共底座：原生档 + 可编辑 + Enter 进编辑 + Ctrl 加选 */
const BASE_OPTIONS = {
  width: 400,
  height: 200,
  columns: COLUMNS,
  records: Array.from({ length: 20 }, (_, i) => ({ name: `r${i}` })),
  scrollbar: { mode: 'native' as const },
  editCellOnEnter: true,
  ctrlMultiSelect: true,
} satisfies Partial<ListTableOptions>

const registry = new EditorRegistry()
registry.registerEditor('text', {})

function mountNative(extra: Partial<ListTableOptions> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const table = new ListTable({
    ...BASE_OPTIONS,
    // 逐用例深拷记录：编辑提交写值不跨用例泄漏
    records: BASE_OPTIONS.records.map((record) => ({ ...record })),
    editorRegistry: registry,
    hostOptions: { container },
    ...extra,
  })
  return { container, table }
}

/** 挂载树三件套：wrapper（滚动容器）→ spacer（撑滚动范围）→ viewport（sticky 层挂载点） */
function nativeParts(container: HTMLElement) {
  const wrapper = container.querySelector<HTMLElement>('[data-native-scroll]')
  if (!wrapper) {
    throw new Error('原生滚动容器未落宿主容器')
  }
  const spacer = wrapper.firstElementChild as HTMLElement
  const viewport = spacer.firstElementChild as HTMLElement
  return { wrapper, spacer, viewport }
}

/**
 * 真实 hit-test 会命中的元素：按装配的 pointer-events 计算值取——spacer 关闭
 * （pointer-events: none 经继承使 viewport/层 canvas 计算值同为 none）且
 * viewport 未显式恢复命中时，内容区点击命中上浮到 wrapper；若装配改为恢复
 * spacer/viewport 命中（事件源仍可达的等价修复形态），则派发在 viewport 自身。
 * 两者都沿祖先链冒泡必经监听元素（宿主容器），非引擎私有监听元素直投。
 * happy-dom 无样式级联，按「子代显式开启否则继承 spacer」口径推导计算值。
 */
function hitTarget(container: HTMLElement): HTMLElement {
  const { wrapper, spacer, viewport } = nativeParts(container)
  const spacerOff = spacer.style.pointerEvents === 'none'
  const viewportRestored =
    viewport.style.pointerEvents !== '' && viewport.style.pointerEvents !== 'none'
  return spacerOff && !viewportRestored ? wrapper : viewport
}

/** 键盘事件真实派发目标：宿主焦点契约元素（宿主容器 tabIndex=-1 + 聚焦，模拟 bindFocus） */
function focusHost(container: HTMLElement): HTMLElement {
  container.tabIndex = -1
  container.focus()
  return container
}

/** 在真实传播路径元素上派发合成指针事件（bubbles 冒泡经监听元素） */
function firePointer(
  target: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  init: { button?: number; ctrlKey?: boolean; metaKey?: boolean } = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...init }),
  )
}

/** 在焦点前置断言后派发合成键盘事件（真实浏览器 keydown 在焦点元素上触发并冒泡） */
function fireKey(target: HTMLElement, key: string, init: { shiftKey?: boolean } = {}): void {
  expect(document.activeElement).toBe(target)
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, ...init }))
}

/** 数据格 (col, row) 中心视口坐标（行号列 48、列头 36、列宽 100、行高 32） */
const cellX = (col: number) => 48 + col * 100 + 50
const cellY = (row: number) => 36 + row * 32 + 16

/** 完整单击序列：按下 + 抬起（含双击进编辑判定的点按落点记录） */
function clickCell(
  container: HTMLElement,
  col: number,
  row: number,
  init?: Parameters<typeof firePointer>[4],
): void {
  const target = hitTarget(container)
  firePointer(target, 'pointerdown', cellX(col), cellY(row), init)
  firePointer(target, 'pointerup', cellX(col), cellY(row))
}

describe('happy-dom 原生档真实传播路径交互', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => {
    for (const dispose of cleanup.splice(0)) {
      dispose()
    }
  })

  /** 挂载并登记清理（表销毁 + 容器摘除，防 activeElement 跨用例泄漏） */
  function mount(extra: Partial<ListTableOptions> = {}) {
    const { container, table } = mountNative(extra)
    cleanup.push(() => {
      table.destroy()
      container.remove()
    })
    return { container, table }
  }

  it('单击数据格：选区变为该格（事件冒泡 wrapper→宿主容器送达引擎）', () => {
    const { container, table } = mount()
    clickCell(container, 2, 3)
    const snapshot = table.getSelection()
    expect(snapshot.ranges).toHaveLength(1)
    expect(snapshot.ranges[0]).toMatchObject({ start: { col: 2, row: 3 }, end: { col: 2, row: 3 } })
    expect(snapshot.focus).toMatchObject({ col: 2, row: 3 })
  })

  it('按下拖到另一格：矩形选区含两格', () => {
    const { container, table } = mount()
    const target = hitTarget(container)
    firePointer(target, 'pointerdown', cellX(1), cellY(1))
    firePointer(target, 'pointermove', cellX(3), cellY(4))
    firePointer(target, 'pointerup', cellX(3), cellY(4))
    const snapshot = table.getSelection()
    expect(snapshot.ranges).toHaveLength(1)
    expect(snapshot.ranges[0]).toMatchObject({ start: { col: 1, row: 1 }, end: { col: 3, row: 4 } })
  })

  it('双击数据格进编辑，Enter 提交取到新值（提交后焦点回落宿主容器）', () => {
    const records = Array.from({ length: 20 }, (_, i) => ({ name: `r${i}` }))
    const { container, table } = mount({ records })
    focusHost(container)
    // 双击 = 双击窗口内同格两次点按（真实双击时序：down/up、down/up）
    clickCell(container, 1, 2)
    clickCell(container, 1, 2)
    expect(table.isEditing()).toBe(true)
    // 编辑器 input 是 startEdit 后的真实焦点元素（open 内 element.focus()）
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
    input!.value = 'edited'
    // 编辑器按键的真实传播路径：keydown 在焦点元素（input）上触发，编辑器监听在元素自身
    input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(table.isEditing()).toBe(false)
    expect(records[2]!.name).toBe('edited')
    // 原生档焦点回落目标为宿主容器（P1：restoreFocus 指宿主容器，键盘续可达）
    expect(document.activeElement).toBe(container)
  })

  it('单击后 Enter 进编辑（editCellOnEnter）', () => {
    const { container, table } = mount()
    clickCell(container, 2, 1)
    fireKey(focusHost(container), 'Enter')
    expect(table.isEditing()).toBe(true)
  })

  it('方向键移动活动格', () => {
    const { container, table } = mount()
    clickCell(container, 1, 1)
    const host = focusHost(container)
    fireKey(host, 'ArrowRight')
    expect(table.getSelection().focus).toMatchObject({ col: 2, row: 1 })
    fireKey(host, 'ArrowDown')
    expect(table.getSelection().focus).toMatchObject({ col: 2, row: 2 })
    fireKey(host, 'ArrowLeft')
    expect(table.getSelection().focus).toMatchObject({ col: 1, row: 2 })
    fireKey(host, 'ArrowUp')
    expect(table.getSelection().focus).toMatchObject({ col: 1, row: 1 })
  })

  it('Shift+方向键扩展选区', () => {
    const { container, table } = mount()
    clickCell(container, 1, 1)
    const host = focusHost(container)
    fireKey(host, 'ArrowRight', { shiftKey: true })
    fireKey(host, 'ArrowDown', { shiftKey: true })
    const snapshot = table.getSelection()
    expect(snapshot.ranges).toHaveLength(1)
    expect(snapshot.ranges[0]).toMatchObject({ start: { col: 1, row: 1 }, end: { col: 2, row: 2 } })
  })

  it('Ctrl+单击追加选区段', () => {
    const { container, table } = mount()
    clickCell(container, 0, 0)
    // 落点须在 400×200 视口内（可见行 0–4、部分可见行 5 只到 y=200）
    clickCell(container, 2, 4, { ctrlKey: true })
    expect(table.getSelection().ranges.length).toBeGreaterThanOrEqual(2)
  })
})
