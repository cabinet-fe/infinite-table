// 交互能力演示：拖选/整行整列、hover、行列 resize（canResizeRow/Col 第 0 行列禁用）、
// 键盘导航、触控滚动（容器 touch-action:none）、批量更新、contextmenu、onScrollFrame。
// 订阅事件经状态行可见化；按钮触发批量更新/全选/清空。

import { normalizeRange } from '@infinite-table/core'

import { addButton, addStatus, createSection, mountTable, type DemoMount } from '../mount'

export const INTERACTION_COL_COUNT = 8
export const INTERACTION_ROW_COUNT = 2000

export interface InteractionDemo {
  mount: DemoMount
  records: Array<Record<string, string>>
}

export function mountInteraction(root: HTMLElement): InteractionDemo {
  const section = createSection(
    root,
    '交互能力',
    '拖选 / 点行号整行 / 点列头整列 / 点左上角全选；shift+方向键扩展选区；hover 高亮；' +
      '拖行列头边缘 resize（第 0 行/列被 canResize 禁用）；方向键导航；触控惯性滚动；' +
      '右键触发 contextmenu 事件；onScrollFrame 实时回显滚动位置。',
  )

  const records: Array<Record<string, string>> = Array.from(
    { length: INTERACTION_ROW_COUNT },
    (_, row) =>
      Object.fromEntries(
        Array.from({ length: INTERACTION_COL_COUNT }, (_, col) => [`c${col}`, `v-${col}-${row}`]),
      ),
  )

  const mount: DemoMount = mountTable(section, {
    width: 720,
    height: 320,
    columns: Array.from({ length: INTERACTION_COL_COUNT }, (_, col) => ({
      field: `c${col}`,
      title: `列${col}`,
      width: 100,
    })),
    records,
    canResizeCol: (col) => col !== 0,
    canResizeRow: (row) => row !== 0,
  })
  const { table } = mount

  const selectionStatus = addStatus(section, '选区：无')
  table.onSelectionChange((snapshot) => {
    if (snapshot.ranges.length === 0) {
      selectionStatus.textContent = '选区：无'
      return
    }
    const parts = snapshot.ranges.map((range) => {
      const b = normalizeRange(range)
      return `(${b.minCol},${b.minRow})~(${b.maxCol},${b.maxRow})`
    })
    selectionStatus.textContent = `选区：${parts.join(' + ')}`
  })

  const menuStatus = addStatus(section, 'contextmenu：未触发')
  table.onContextMenu((event) => {
    menuStatus.textContent = event.cell
      ? `contextmenu：格 (${event.cell.col},${event.cell.row})`
      : `contextmenu：(${event.x},${event.y}) 非数据格`
  })

  const scrollStatus = addStatus(section, 'scroll：(0,0)')
  table.onScrollFrame((state) => {
    scrollStatus.textContent = `scroll：(${Math.round(state.left)},${Math.round(state.top)})`
  })

  addButton(section, '批量更新 100 格', () => {
    table.batchUpdate(() => {
      for (let row = 0; row < 100; row++) {
        const record = records[row]
        if (record) {
          record['c1'] = `B-${row}`
          table.refreshCell(1, row)
        }
      }
    })
  })
  addButton(section, '全选', () => table.selectAll())
  addButton(section, '清空选区', () => table.clearSelection())

  return { mount, records }
}
