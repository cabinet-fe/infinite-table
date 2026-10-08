// 交互能力演示：拖选/整行整列、行列 resize（canResizeRow/Col 第 0 行列禁用）、
// 键盘导航、触控滚动（容器 touch-action:none）、批量更新、contextmenu、onScrollFrame。
// 订阅事件可见化（状态行）与批量更新/全选/清空按钮由 React 页面（InteractionPage）驱动句柄承担。

import { mountTable, type DemoMount } from '../mount'

const INTERACTION_COL_COUNT = 8
const INTERACTION_ROW_COUNT = 2000

export interface InteractionDemo {
  mount: DemoMount
  records: Array<Record<string, string>>
}

export function mountInteraction(root: HTMLElement): InteractionDemo {
  const section = document.createElement('section')
  root.appendChild(section)

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

  return { mount, records }
}
