// Excel 键位预设：对齐 ultra-ui keyboardOptions 组合语义（Enter 进编辑、关闭 Ctrl 加选）。
// demo 以 options 展开使用；Tab 移动 / Enter 提交后下移为引擎内置行为，无需预设。

import type { ListTableOptions } from '@infinite-table/core'

/** 键位预设（Partial<ListTableOptions>，直接展开进 ListTableOptions） */
export const excelKeymapPreset: Partial<ListTableOptions> = {
  /** 非编辑态按 Enter 进入焦点格编辑（提交后仍按 Enter 语义下移） */
  editCellOnEnter: true,
  /** 关闭 Ctrl/Cmd 点选加选（对齐 ultra-ui ctrlMultiSelect:false） */
  ctrlMultiSelect: false,
}
