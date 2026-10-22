// 按格超链接桥：Sheet 模型 Cell Meta（cell-link namespace）↔ 引擎链接渲染/事件通道。
// SheetGrid 构造时无条件安装 resolveCellLink（宿主无需传 hook），模型有链接的格自动
// 获得默认链接外观（蓝字下划线，可被 resolveCellStyle 覆盖）、悬停 pointer 光标与
// 链接 hover/leave/单击事件。写入/清除经 meta-change 定向刷新该格（引擎 resolveStyle
// 与交互命中均为 pull 式取值，刷新即重建外观与命中态）。

import type { CellLink, TableEngine } from '@infinitable/table'

import { CELL_LINK_META_NAMESPACE, type CellLinkPayload } from '../core/cell-meta'
import type { Sheet } from '../core/sheet'

/** 读取链接载荷（peek 原始引用，渲染热路径零深拷贝；不修改） */
function peekCellLink(sheet: Sheet, col: number, row: number): CellLinkPayload | undefined {
  return sheet.peekCellMeta({ row, col }, CELL_LINK_META_NAMESPACE) as CellLinkPayload | undefined
}

export class GridCellLinks {
  private readonly sheet: Sheet
  private table: TableEngine | null = null
  private readonly disposers: (() => void)[] = []
  private released = false

  constructor(sheet: Sheet) {
    this.sheet = sheet
  }

  /**
   * 注入引擎实例并开始监听模型事件（SheetGrid 在引擎构造之后调用；
   * resolveLink 不依赖引擎，构造期初始装配可直接调用）。
   */
  attach(table: TableEngine): void {
    this.table = table
    this.disposers.push(
      this.sheet.on('meta-change', ({ addr, namespace }) => {
        if (this.released) return
        if (namespace !== undefined && namespace !== CELL_LINK_META_NAMESPACE) return
        // 整表替换（restore / undo 回放，addr 为空）的窗口刷新由 SheetGrid 既有 resync 链负责
        if (addr) this.table?.refreshCell(addr.col, addr.row)
      }),
    )
  }

  dispose(): void {
    if (this.released) return
    this.released = true
    for (const dispose of this.disposers) dispose()
    this.disposers.length = 0
    this.table = null
  }

  /** 引擎 resolveCellLink 取值：模型有链接的格返回链接（URL 与显示文本） */
  resolveLink(col: number, row: number): CellLink | undefined {
    const payload = peekCellLink(this.sheet, col, row)
    if (!payload) return undefined
    return { url: payload.url, text: payload.text }
  }
}
