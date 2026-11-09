// 选区样式订阅：把当前活动格的样式/几何反映到工具条控件（加粗按下态、字号、对齐、格式、边框）。
// 订阅 sheet 的 selection-change 与 doc 的 history-change（样式命令、快照级行高列宽编辑都走这里）。
import { useEffect, useState } from 'react'

import type { CellAddress, CellRange, CellStyle } from '@infinitable/sheet'

import type { FormDoc } from './form-doc'

interface SelectionStyleState {
  /** 当前选区首个范围（无选区为 null） */
  range: CellRange | null
  activeCell: CellAddress | null
  /** 活动格自身样式（原始存储语义；没写过的字段为 undefined） */
  style: CellStyle | undefined
  /** 活动格所在行/列的自定义尺寸（undefined = 用默认值） */
  rowHeight: number | undefined
  colWidth: number | undefined
}

/** 读取当前选区与样式快照（纯读，不写模型） */
function readState(doc: FormDoc): SelectionStyleState {
  const selection = doc.sheet.getSelection()
  const activeCell = selection.activeCell
  const range = selection.ranges[0] ?? null
  return {
    range,
    activeCell,
    style: activeCell ? doc.sheet.getCellStyle(activeCell) : undefined,
    rowHeight: activeCell ? doc.sheet.getRowHeights().get(activeCell.row) : undefined,
    colWidth: activeCell ? doc.sheet.getColWidths().get(activeCell.col) : undefined,
  }
}

/** 订阅选区/撤销链变化，返回最新样式状态（每次事件重建对象，供 memo 比较） */
export function useSelectionStyle(doc: FormDoc): SelectionStyleState {
  const [state, setState] = useState<SelectionStyleState>(() => readState(doc))

  useEffect(() => {
    const sync = (): void => setState(readState(doc))
    sync()
    const offSelection = doc.sheet.on('selection-change', sync)
    // 样式命令（setCellStyle）只发 sheet 的 history-change；快照级编辑（行高列宽/数据块）发
    // doc 的 history-change——两条都订阅，工具条才能同时跟上撤销链与几何变化
    const offSheetHistory = doc.sheet.on('history-change', sync)
    const offDocHistory = doc.on('history-change', sync)
    const offRegions = doc.on('regions-change', sync)
    return () => {
      offSelection()
      offSheetHistory()
      offDocHistory()
      offRegions()
    }
  }, [doc])

  return state
}
