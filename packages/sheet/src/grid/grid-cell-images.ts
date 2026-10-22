// 按格嵌入图桥：Sheet 模型 Cell Meta（cell-image namespace）↔ 引擎图片格渲染通道。
// SheetGrid 构造时无条件安装 resolveCellImage / resolveCellImageFit / resolveCellImageLink
// （宿主无需传 hook），模型有图的格自动进入引擎 media 请求并产出 ImageCellNode；
// 带链接嵌入图（载荷 link）单击由引擎派发图片链接点击事件。写入/清除经 meta-change
// 定向刷新（引擎 refreshImageCell 承担「URL 首次出现补建 / 变化重建 / 消失摘除」）。

import type { ListTable } from '@infinitable/table'

import { CELL_IMAGE_META_NAMESPACE, type CellImagePayload } from '../core/cell-meta'
import { IMAGE_MIME } from '../core/image'
import type { ImageFitMode, SheetImageType } from '../core/image'
import type { Sheet } from '../core/sheet'

/** 格坐标 → 字节来源 objectURL 缓存条目（data 引用复用，换字节重建） */
interface CellImageUrlEntry {
  url: string
  data: Uint8Array
}

/** 读取嵌入图载荷（peek 原始引用，渲染热路径零深拷贝；不修改） */
function peekCellImage(sheet: Sheet, col: number, row: number): CellImagePayload | undefined {
  return sheet.peekCellMeta({ row, col }, CELL_IMAGE_META_NAMESPACE) as CellImagePayload | undefined
}

/** 字节来源的 MIME（type 缺省按 png） */
function mimeOf(type: SheetImageType | undefined): string {
  return IMAGE_MIME[type ?? 'png']
}

export class GridCellImages {
  private readonly sheet: Sheet
  private table: ListTable | null = null
  /** `row,col` → objectURL（字节来源图）；peek 引用稳定，热路径命中不重建 */
  private readonly urls = new Map<string, CellImageUrlEntry>()
  private readonly disposers: (() => void)[] = []
  private released = false

  constructor(sheet: Sheet) {
    this.sheet = sheet
  }

  /**
   * 注入引擎实例并开始监听模型事件（SheetGrid 在 new ListTable 之后调用；
   * resolveUrl / resolveFit 不依赖 table，构造期初始装配可直接调用）。
   */
  attach(table: ListTable): void {
    this.table = table
    this.disposers.push(
      this.sheet.on('meta-change', ({ addr, namespace }) => {
        if (this.released) return
        if (namespace !== undefined && namespace !== CELL_IMAGE_META_NAMESPACE) return
        if (!addr) {
          // 整表替换（restore / undo 回放）：URL 缓存全量作废（窗口刷新由既有 resync 链负责）
          this.clearUrls()
          return
        }
        if (!peekCellImage(this.sheet, addr.col, addr.row)) {
          this.releaseCellUrl(addr.row, addr.col)
        }
        this.table?.refreshCell(addr.col, addr.row)
      }),
      // 结构平移后格坐标全变：objectURL 缓存按格 keyed，全量作废（引擎侧刷新遵循
      // 「行列数运行时变化交宿主重建」既有约定，激活/重建时重新装配）
      this.sheet.on('structure-change', () => {
        if (this.released) return
        this.clearUrls()
      }),
      this.sheet.on('content-reset', () => {
        if (this.released) return
        this.clearUrls()
      }),
    )
  }

  dispose(): void {
    if (this.released) return
    this.released = true
    for (const dispose of this.disposers) dispose()
    this.disposers.length = 0
    this.clearUrls()
    this.table = null
  }

  /** 引擎 resolveCellImage 取值：模型有图的格返回渲染 URL（src 直用 / 字节转 objectURL） */
  resolveUrl(col: number, row: number): string | undefined {
    const payload = peekCellImage(this.sheet, col, row)
    if (!payload) return undefined
    if (payload.src != null) return payload.src
    if (payload.data == null) return undefined
    const key = `${row},${col}`
    const cached = this.urls.get(key)
    if (cached && cached.data === payload.data) return cached.url
    if (cached) URL.revokeObjectURL(cached.url)
    const blob = new Blob([payload.data as BlobPart], { type: mimeOf(payload.type) })
    const url = URL.createObjectURL(blob)
    this.urls.set(key, { url, data: payload.data })
    return url
  }

  /** 引擎 resolveCellImageFit 取值：缺省 undefined（core 回落 contain 保比例） */
  resolveFit(col: number, row: number): ImageFitMode | undefined {
    return peekCellImage(this.sheet, col, row)?.fit
  }

  /** 引擎 resolveCellImageLink 取值：该格嵌入图的超链接 URL（无图或无链接 undefined） */
  resolveLink(col: number, row: number): string | undefined {
    return peekCellImage(this.sheet, col, row)?.link
  }

  /** 释放指定格的 objectURL（格已无图） */
  private releaseCellUrl(row: number, col: number): void {
    const entry = this.urls.get(`${row},${col}`)
    if (!entry) return
    URL.revokeObjectURL(entry.url)
    this.urls.delete(`${row},${col}`)
  }

  /** 全量释放 objectURL 缓存 */
  private clearUrls(): void {
    for (const entry of this.urls.values()) URL.revokeObjectURL(entry.url)
    this.urls.clear()
  }
}
