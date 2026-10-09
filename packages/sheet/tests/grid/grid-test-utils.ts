import type { SelectionSnapshot } from '@infinitable/core'

import { SHEET_HEADER_HEIGHT, SHEET_ROW_HEADER_WIDTH } from '../../src/grid/grid-theme'

// TODO(P9)：SheetGrid 装配层（src/grid/sheet-grid.ts）随 P9 迁入后，回补挂载助手
// `createGrid`（容器入 DOM + 显式视口尺寸，返回 { grid, table, container, sheet }）
// 与 `CreatedGrid` 接口——二者依赖 SheetGrid 构造与 getTable()，本阶段仅迁入与其
// 无关的几何/事件/微任务工具。

/** 测试视口尺寸（显式给定，绕开 happy-dom 无布局测量） */
export const VIEW_W = 800
export const VIEW_H = 600

/** 数据格 (col, row) 的层坐标（几何：行号列 46、列头 28、列宽 80、行高 28） */
export const cellX = (col: number) => SHEET_ROW_HEADER_WIDTH + col * 80 + 5
export const cellY = (row: number) => SHEET_HEADER_HEIGHT + row * 28 + 5

/** 向容器派发 DOM 指针类事件（引擎 EventSystem 归一化为场景事件） */
export function fire(
  container: HTMLElement,
  type: string,
  init: {
    clientX?: number
    clientY?: number
    button?: number
    bubbles?: boolean
    ctrlKey?: boolean
    shiftKey?: boolean
  } = {},
): void {
  const event = new MouseEvent(type, {
    bubbles: init.bubbles ?? true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
  })
  container.dispatchEvent(event)
}

/** 等待微任务队列排空（适配层 resync / 浮动图同步走 queueMicrotask） */
export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** 读引擎当前选区快照（单段断言便捷形态） */
export function firstRange(snapshot: SelectionSnapshot): SelectionSnapshot['ranges'][number] {
  const range = snapshot.ranges[0]
  if (!range) throw new Error('选区为空')
  return range
}
