import { describe, expect, it } from 'vitest'

import {
  normalizeRange,
  SelectionState,
  type SelectionRange,
  type SelectionSnapshot,
} from '../src/selection'

describe('SelectionState 拖选与整行整列', () => {
  it('拖选：beginDrag 锚定单格，updateDrag 扩展并同步焦点，支持反向拖拽', () => {
    const selection = new SelectionState()
    const seen: SelectionSnapshot[] = []
    selection.onChange((snapshot) => seen.push(snapshot))

    selection.beginDrag(2, 3)
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 2, row: 3 }, end: { col: 2, row: 3 } },
    ])
    expect(selection.snapshot.focus).toEqual({ col: 2, row: 3 })

    selection.updateDrag(4, 5)
    expect(normalizeRange(selection.snapshot.ranges[0]!)).toEqual({
      minCol: 2,
      minRow: 3,
      maxCol: 4,
      maxRow: 5,
    })
    expect(selection.snapshot.focus).toEqual({ col: 4, row: 5 })

    // 反向拖拽：锚点不动，焦点同步到左上角目标
    selection.updateDrag(0, 1)
    expect(selection.snapshot.ranges[0]).toEqual({
      start: { col: 2, row: 3 },
      end: { col: 0, row: 1 },
    })
    expect(normalizeRange(selection.snapshot.ranges[0]!)).toEqual({
      minCol: 0,
      minRow: 1,
      maxCol: 2,
      maxRow: 3,
    })
    expect(selection.snapshot.focus).toEqual({ col: 0, row: 1 })

    selection.endDrag()
    // 拖选结束后 updateDrag 不再生效
    selection.updateDrag(9, 9)
    expect(selection.snapshot.focus).toEqual({ col: 0, row: 1 })
    expect(seen.length).toBe(3)
  })

  it('整行/整列/全选：选区覆盖对应维度，焦点落在首格', () => {
    const selection = new SelectionState()
    selection.selectRow(4, 10)
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 0, row: 4 }, end: { col: 9, row: 4 } },
    ])
    expect(selection.snapshot.focus).toEqual({ col: 0, row: 4 })

    selection.selectCol(2, 100)
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 2, row: 0 }, end: { col: 2, row: 99 } },
    ])
    expect(selection.snapshot.focus).toEqual({ col: 2, row: 0 })

    selection.selectAll(10, 100)
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 9, row: 99 } },
    ])
  })

  it('beginDragRange/selectAll 可选焦点：缺省仍落 start/首格，显式传入时取传入值（表头点击可视位）', () => {
    const selection = new SelectionState()
    // 缺省：焦点同步 start（普通拖选与合并区「点按即整块、焦点同步主格」不回退）
    selection.beginDragRange({ col: 1, row: 2 }, { col: 3, row: 5 })
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 1, row: 2 }, end: { col: 3, row: 5 } },
    ])
    expect(selection.snapshot.focus).toEqual({ col: 1, row: 2 })

    // 显式传入：焦点取传入值（表头点击的交互可视位），选区段照常
    const explicit: SelectionRange = { start: { col: 2, row: 0 }, end: { col: 2, row: 99 } }
    selection.beginDragRange(explicit.start, explicit.end, { col: 2, row: 40 })
    expect(selection.snapshot.ranges).toEqual([explicit])
    expect(selection.snapshot.focus).toEqual({ col: 2, row: 40 })
    // 入参焦点被复制：外部改动不影响内部状态
    const passedFocus = { col: 4, row: 50 }
    selection.beginDragRange({ col: 4, row: 0 }, { col: 4, row: 99 }, passedFocus)
    passedFocus.row = 0
    expect(selection.snapshot.focus).toEqual({ col: 4, row: 50 })

    // selectAll 缺省焦点左上角首格；显式传入取可视位
    selection.selectAll(10, 100)
    expect(selection.snapshot.focus).toEqual({ col: 0, row: 0 })
    selection.selectAll(10, 100, { col: 3, row: 40 })
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 9, row: 99 } },
    ])
    expect(selection.snapshot.focus).toEqual({ col: 3, row: 40 })
  })

  it('shift 扩展：以锚点扩展到目标格，焦点同步到最新扩展目标（选区修正补丁行为）', () => {
    const selection = new SelectionState()
    selection.selectCell(2, 2)
    selection.selectCell(5, 6, true)
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 2, row: 2 }, end: { col: 5, row: 6 } },
    ])
    expect(selection.snapshot.focus).toEqual({ col: 5, row: 6 })

    // 继续 shift 扩展：锚点保持，焦点跟随新目标
    selection.selectCell(1, 0, true)
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 2, row: 2 }, end: { col: 1, row: 0 } },
    ])
    expect(selection.snapshot.focus).toEqual({ col: 1, row: 0 })
  })

  it('selectCells 多段选中：整组替换选区段，焦点落在末段焦点格，入参段被复制', () => {
    const selection = new SelectionState()
    const seen: SelectionSnapshot[] = []
    selection.onChange((snapshot) => seen.push(snapshot))
    selection.selectCell(9, 9)

    const input: SelectionRange[] = [
      { start: { col: 0, row: 0 }, end: { col: 1, row: 1 } },
      { start: { col: 3, row: 2 }, end: { col: 4, row: 5 } },
    ]
    selection.selectCells(input)
    expect(selection.snapshot.ranges).toEqual(input)
    expect(selection.snapshot.ranges).not.toBe(input)
    expect(selection.snapshot.ranges[0]).not.toBe(input[0])
    // 焦点落在末段焦点格（填充柄挂在焦点段上）
    expect(selection.snapshot.focus).toEqual({ col: 4, row: 5 })
    expect(seen).toHaveLength(2)

    // 空数组整组清空，焦点同步清空
    selection.selectCells([])
    expect(selection.snapshot.ranges).toEqual([])
    expect(selection.snapshot.focus).toBeNull()
  })

  it('addRange 在既有选区上追加一段（ctrlMultiSelect 的 Ctrl/Cmd 点选），焦点同步到新段焦点格', () => {
    const selection = new SelectionState()
    selection.selectCell(0, 0)
    selection.addRange({ start: { col: 2, row: 1 }, end: { col: 3, row: 1 } })
    expect(selection.snapshot.ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 0, row: 0 } },
      { start: { col: 2, row: 1 }, end: { col: 3, row: 1 } },
    ])
    expect(selection.snapshot.focus).toEqual({ col: 3, row: 1 })
    // 入参段被复制：外部改动不影响内部状态
    const appended: SelectionRange = { start: { col: 5, row: 5 }, end: { col: 6, row: 6 } }
    selection.addRange(appended)
    appended.end = { col: 9, row: 9 }
    expect(selection.snapshot.ranges[2]).toEqual({
      start: { col: 5, row: 5 },
      end: { col: 6, row: 6 },
    })
  })

  it('clear 清空选区并广播一次', () => {
    const selection = new SelectionState()
    const seen: SelectionSnapshot[] = []
    selection.onChange((snapshot) => seen.push(snapshot))
    selection.selectCell(1, 1)
    selection.clear()
    expect(selection.snapshot.ranges).toEqual([])
    expect(selection.snapshot.focus).toBeNull()
    expect(seen).toHaveLength(2)
    // 空选区重复 clear 不再广播
    selection.clear()
    expect(seen).toHaveLength(2)
  })
})

describe('SelectionState 回驱防递归', () => {
  it('外部回写 applyExternal：应用但不广播，订阅方回写不回环', () => {
    const selection = new SelectionState()
    let broadcasts = 0
    // 外部模型：订阅选区变更并回写（回驱），若不防递归将无限回环
    selection.onChange((snapshot) => {
      broadcasts++
      selection.applyExternal(snapshot)
    })
    selection.selectCell(1, 1)
    expect(broadcasts).toBe(1)
    expect(selection.snapshot.focus).toEqual({ col: 1, row: 1 })
  })

  it('监听内重入选中：嵌套广播被吞掉，只广播最外一次', () => {
    const selection = new SelectionState()
    const seen: SelectionSnapshot[] = []
    let reentered = false
    selection.onChange(() => {
      seen.push(selection.snapshot)
      if (!reentered) {
        reentered = true
        // 监听内重入选中：不应触发嵌套广播
        selection.selectCell(9, 9)
      }
    })
    selection.selectCell(1, 1)
    expect(seen).toHaveLength(1)
    expect(selection.snapshot.focus).toEqual({ col: 9, row: 9 })
  })
})
