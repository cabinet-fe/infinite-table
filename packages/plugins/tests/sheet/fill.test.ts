import { describe, expect, it } from 'vitest'

import { generateFill } from '../../src/sheet/fill'

/** 以固定源区读值构造 read */
function readFrom(values: Record<string, unknown>) {
  return (col: number, row: number) => values[`${col},${row}`]
}

describe('generateFill 数字序列', () => {
  it('单格数字源向下等差 1；向右同理', () => {
    const cells = generateFill(
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 },
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 3 },
      readFrom({ '0,0': 5 }),
    )
    expect(cells.map((cell) => cell.value)).toEqual([6, 7, 8])
    expect(cells.map((cell) => cell.row)).toEqual([1, 2, 3])

    const right = generateFill(
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 },
      { minCol: 0, maxCol: 2, minRow: 0, maxRow: 0 },
      readFrom({ '0,0': 10 }),
    )
    expect(right.map((cell) => cell.value)).toEqual([11, 12])
    expect(right.map((cell) => cell.col)).toEqual([1, 2])
  })

  it('多格源按相邻差推断步长（2,4 → 6,8）', () => {
    const cells = generateFill(
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 1 },
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 3 },
      readFrom({ '0,0': 2, '0,1': 4 }),
    )
    expect(cells.map((cell) => cell.value)).toEqual([6, 8])
  })

  it('向上负方向逆推：源 5,4（步长 -1）→ 上方 7,6（远离源递增）', () => {
    const cells = generateFill(
      { minCol: 0, maxCol: 0, minRow: 2, maxRow: 3 },
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 3 },
      readFrom({ '0,2': 5, '0,3': 4 }),
    )
    // 行 0、1（远离源端在前）：序列 7,6,5,4 连续
    expect(cells.map((cell) => cell.row)).toEqual([0, 1])
    expect(cells.map((cell) => cell.value)).toEqual([7, 6])
  })

  it('向左逆推', () => {
    const cells = generateFill(
      { minCol: 2, maxCol: 3, minRow: 0, maxRow: 0 },
      { minCol: 0, maxCol: 3, minRow: 0, maxRow: 0 },
      readFrom({ '2,0': 10, '3,0': 20 }),
    )
    expect(cells.map((cell) => cell.col)).toEqual([0, 1])
    expect(cells.map((cell) => cell.value)).toEqual([-10, 0])
  })
})

describe('generateFill 日期与文本序列', () => {
  it('Date 源按天递增', () => {
    const cells = generateFill(
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 },
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 2 },
      readFrom({ '0,0': new Date('2024-01-01T00:00:00Z') }),
    )
    expect(cells.map((cell) => (cell.value as Date).getTime())).toEqual([
      new Date('2024-01-02T00:00:00Z').getTime(),
      new Date('2024-01-03T00:00:00Z').getTime(),
    ])
  })

  it('文本尾数字递增；保留前导零宽度', () => {
    const cells = generateFill(
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 },
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 2 },
      readFrom({ '0,0': 'Item 1' }),
    )
    expect(cells.map((cell) => cell.value)).toEqual(['Item 2', 'Item 3'])

    const padded = generateFill(
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 },
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 1 },
      readFrom({ '0,0': 'A-007' }),
    )
    expect(padded.map((cell) => cell.value)).toEqual(['A-008'])
  })

  it('两格文本源推断数字步长（A-1, A-3 → A-5）', () => {
    const cells = generateFill(
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 1 },
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 2 },
      readFrom({ '0,0': 'A-1', '0,1': 'A-3' }),
    )
    expect(cells.map((cell) => cell.value)).toEqual(['A-5'])
  })
})

describe('generateFill 复制兜底与混合源', () => {
  it('非序列值循环复制', () => {
    const cells = generateFill(
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 1 },
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 4 },
      readFrom({ '0,0': 'a', '0,1': 'b' }),
    )
    expect(cells.map((cell) => cell.value)).toEqual(['a', 'b', 'a'])
  })

  it('混合源按列独立推断：数字列成序列、文本列复制', () => {
    const cells = generateFill(
      { minCol: 0, maxCol: 1, minRow: 0, maxRow: 1 },
      { minCol: 0, maxCol: 1, minRow: 0, maxRow: 2 },
      readFrom({ '0,0': 1, '0,1': 2, '1,0': 'x', '1,1': 'y' }),
    )
    const col0 = cells.filter((cell) => cell.col === 0)
    const col1 = cells.filter((cell) => cell.col === 1)
    expect(col0.map((cell) => cell.value)).toEqual([3])
    expect(col1.map((cell) => cell.value)).toEqual(['x'])
  })

  it('无扩展区（target == anchor）返回空数组', () => {
    const cells = generateFill(
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 },
      { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 },
      readFrom({ '0,0': 1 }),
    )
    expect(cells).toEqual([])
  })
})
