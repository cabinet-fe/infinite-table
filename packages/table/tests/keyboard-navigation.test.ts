import { describe, expect, it } from 'vitest'

import { nextActiveCell, revealAxis } from '../src/keyboard-navigation'

describe('nextActiveCell 键盘导航', () => {
  const cur = { col: 2, row: 2 }

  it('方向键四向移动一格', () => {
    expect(nextActiveCell('ArrowUp', cur, 10, 10)).toEqual({ col: 2, row: 1 })
    expect(nextActiveCell('ArrowDown', cur, 10, 10)).toEqual({ col: 2, row: 3 })
    expect(nextActiveCell('ArrowLeft', cur, 10, 10)).toEqual({ col: 1, row: 2 })
    expect(nextActiveCell('ArrowRight', cur, 10, 10)).toEqual({ col: 3, row: 2 })
  })

  it('Tab 右移、Shift+Tab 左移', () => {
    expect(nextActiveCell('Tab', cur, 10, 10)).toEqual({ col: 3, row: 2 })
    expect(nextActiveCell('Tab', cur, 10, 10, true)).toEqual({ col: 1, row: 2 })
  })

  it('越界夹取到表格边缘', () => {
    expect(nextActiveCell('ArrowUp', { col: 0, row: 0 }, 10, 10)).toEqual({ col: 0, row: 0 })
    expect(nextActiveCell('ArrowLeft', { col: 0, row: 0 }, 10, 10)).toEqual({ col: 0, row: 0 })
    expect(nextActiveCell('ArrowDown', { col: 9, row: 9 }, 10, 10)).toEqual({ col: 9, row: 9 })
    expect(nextActiveCell('Tab', { col: 9, row: 9 }, 10, 10)).toEqual({ col: 9, row: 9 })
  })

  it('无法处理的键与空表返回 null', () => {
    expect(nextActiveCell('Enter', cur, 10, 10)).toBeNull()
    expect(nextActiveCell('ArrowUp', cur, 0, 0)).toBeNull()
  })
})

describe('revealAxis 滚动跟随', () => {
  it('已完整可见时不调整', () => {
    expect(revealAxis(100, 500, 150, 32)).toBe(100)
  })

  it('目标在视口上方：对齐上缘', () => {
    expect(revealAxis(100, 500, 20, 32)).toBe(20)
  })

  it('目标在视口下方：对齐下缘', () => {
    expect(revealAxis(100, 500, 700, 32)).toBe(700 + 32 - 500)
  })

  it('部分露出下缘也算不可见，按完整进入调整', () => {
    // 区间 [590, 622)，视口 [100, 600)：下缘超出
    expect(revealAxis(100, 500, 590, 32)).toBe(122)
  })
})
