import type { CellAddress } from '../address'
import { CELL_IMAGE_META_NAMESPACE, type CellImagePayload } from '../cell-meta'
import { ClearCellMetaCommand, SetCellMetaCommand } from './cell-meta'
import type { Command, CommandResult } from './types'

export interface InsertCellImageParams {
  addr: CellAddress
  image: CellImagePayload
}

/**
 * 插入（或覆盖）按格嵌入图：固定 cell-image namespace，经 Cell Meta 命令通道执行
 * （before/after 捕获 + applyPatch + mutations 语义复用 SetCellMetaCommand，
 * 不另起存储与撤销机制）。相同载荷视为无操作；合并格解析锚点与空载荷拦截
 * 由模型入口（Sheet.insertCellImage）完成。
 */
export const InsertCellImageCommand: Command<InsertCellImageParams> = {
  id: 'sheet.insert-cell-image',

  handler(ctx, params): CommandResult | undefined {
    return SetCellMetaCommand.handler(ctx, {
      addr: params.addr,
      namespace: CELL_IMAGE_META_NAMESPACE,
      payload: params.image,
    })
  },
}

export interface RemoveCellImageParams {
  addr: CellAddress
}

/** 移除按格嵌入图：固定 cell-image namespace，复用 ClearCellMetaCommand 语义（无图无操作） */
export const RemoveCellImageCommand: Command<RemoveCellImageParams> = {
  id: 'sheet.remove-cell-image',

  handler(ctx, params): CommandResult | undefined {
    return ClearCellMetaCommand.handler(ctx, {
      addr: params.addr,
      namespace: CELL_IMAGE_META_NAMESPACE,
    })
  },
}
