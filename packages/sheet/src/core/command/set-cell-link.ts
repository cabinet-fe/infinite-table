import type { CellAddress } from '../address'
import { CELL_LINK_META_NAMESPACE, type CellLinkPayload } from '../cell-meta'
import { ClearCellMetaCommand, SetCellMetaCommand } from './cell-meta'
import type { Command, CommandResult } from './types'

export interface SetCellLinkParams {
  addr: CellAddress
  link: CellLinkPayload
}

/**
 * 设置单元格超链接：固定 cell-link namespace，经 Cell Meta 命令通道执行
 * （before/after 捕获 + applyPatch + mutations 语义复用 SetCellMetaCommand，
 * 不另起存储与撤销机制）。相同链接视为无操作；合并格解析锚点由模型入口
 * （Sheet.setCellLink）完成。
 */
export const SetCellLinkCommand: Command<SetCellLinkParams> = {
  id: 'sheet.set-cell-link',

  handler(ctx, params): CommandResult | undefined {
    return SetCellMetaCommand.handler(ctx, {
      addr: params.addr,
      namespace: CELL_LINK_META_NAMESPACE,
      payload: params.link,
    })
  },
}

export interface ClearCellLinkParams {
  addr: CellAddress
}

/** 清除单元格超链接：固定 cell-link namespace，复用 ClearCellMetaCommand 语义（无链接无操作） */
export const ClearCellLinkCommand: Command<ClearCellLinkParams> = {
  id: 'sheet.clear-cell-link',

  handler(ctx, params): CommandResult | undefined {
    return ClearCellMetaCommand.handler(ctx, {
      addr: params.addr,
      namespace: CELL_LINK_META_NAMESPACE,
    })
  },
}
