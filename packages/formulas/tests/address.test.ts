// address 纯函数：列字母换算 / A1 解析（$ 绝对标记）/ 区域规范化 / 格式化（含跨表引号表名）

import { describe, expect, it } from 'vitest'

import {
  colLetters,
  createRangeRef,
  formatCellRef,
  formatRangeRef,
  formatSheetName,
  parseCellRef,
  parseColLetters,
} from '../src/index'

describe('colLetters / parseColLetters', () => {
  it('0 基列号 ↔ 列字母互逆', () => {
    expect(colLetters(0)).toBe('A')
    expect(colLetters(25)).toBe('Z')
    expect(colLetters(26)).toBe('AA')
    expect(colLetters(27)).toBe('AB')
    expect(colLetters(701)).toBe('ZZ')
    expect(colLetters(702)).toBe('AAA')
    for (const col of [0, 1, 25, 26, 51, 52, 701, 702]) {
      expect(parseColLetters(colLetters(col))).toBe(col)
    }
  })

  it('列字母解析大小写不敏感；非法输入 -1', () => {
    expect(parseColLetters('a')).toBe(0)
    expect(parseColLetters('aA')).toBe(26)
    expect(parseColLetters('')).toBe(-1)
    expect(parseColLetters('A1')).toBe(-1)
    expect(parseColLetters('1')).toBe(-1)
  })

  it('非法列号抛 RangeError', () => {
    expect(() => colLetters(-1)).toThrow(RangeError)
    expect(() => colLetters(1.5)).toThrow(RangeError)
  })
})

describe('parseCellRef', () => {
  it('A1 解析为 0 基坐标', () => {
    expect(parseCellRef('A1')).toEqual({ col: 0, row: 0, colAbsolute: false, rowAbsolute: false })
    expect(parseCellRef('c10')).toEqual({ col: 2, row: 9, colAbsolute: false, rowAbsolute: false })
    expect(parseCellRef('AA100')).toEqual({
      col: 26,
      row: 99,
      colAbsolute: false,
      rowAbsolute: false,
    })
  })

  it('$ 绝对标记保留', () => {
    expect(parseCellRef('$A$1')).toEqual({ col: 0, row: 0, colAbsolute: true, rowAbsolute: true })
    expect(parseCellRef('$A1')).toEqual({ col: 0, row: 0, colAbsolute: true, rowAbsolute: false })
    expect(parseCellRef('A$1')).toEqual({ col: 0, row: 0, colAbsolute: false, rowAbsolute: true })
  })

  it('非法引用返回 null', () => {
    expect(parseCellRef('')).toBeNull()
    expect(parseCellRef('A0')).toBeNull() // 行号从 1 起
    expect(parseCellRef('1A')).toBeNull()
    expect(parseCellRef('A')).toBeNull()
    expect(parseCellRef('A1:B2')).toBeNull()
  })
})

describe('createRangeRef / formatRangeRef', () => {
  it('区域规范化：start ≤ end（角点乱序归一）', () => {
    const ref = createRangeRef(parseCellRef('D5')!, parseCellRef('B2')!)
    expect(ref).toEqual({ startCol: 1, startRow: 1, endCol: 3, endRow: 4 })
  })

  it('sheet 取起点引用', () => {
    const start = { ...parseCellRef('B2')!, sheet: 'Sheet2' }
    const ref = createRangeRef(start, parseCellRef('D5')!)
    expect(ref.sheet).toBe('Sheet2')
    expect(formatRangeRef(ref)).toBe('Sheet2!B2:D5')
  })

  it('单格区域只格式化一次地址', () => {
    const ref = createRangeRef(parseCellRef('B2')!, parseCellRef('B2')!)
    expect(formatRangeRef(ref)).toBe('B2')
  })
})

describe('格式化（含跨表）', () => {
  it('formatCellRef 还原 $ 与跨表前缀', () => {
    expect(formatCellRef(parseCellRef('$B$3')!)).toBe('$B$3')
    expect(formatCellRef({ ...parseCellRef('A1')!, sheet: 'Sheet2' })).toBe('Sheet2!A1')
    expect(formatCellRef({ ...parseCellRef('A1')!, sheet: 'Sheet 2' })).toBe("'Sheet 2'!A1")
  })

  it('formatSheetName：安全名直出，其余引号包裹并转义', () => {
    expect(formatSheetName('Sheet2')).toBe('Sheet2')
    expect(formatSheetName('数据_1')).toBe("'数据_1'")
    expect(formatSheetName("It's")).toBe("'It''s'")
    expect(formatSheetName('2Sheet')).toBe("'2Sheet'")
  })
})
