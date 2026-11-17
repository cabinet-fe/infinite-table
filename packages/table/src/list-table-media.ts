// ListTable 媒体集成协作模块：
// L2 media 层惰性创建（固定容器组 scrollableMediaGroup → frozenMediaGroup → crossMergeMediaGroup）、
// 图片/图表格节点装配与局部刷新、ImageService 加载完成回写、窗口化调度、图表格出图路由。
// 以 ListTable 实例为参数的协作函数，只触碰表实例上的 @internal 状态容器。

import {
  computeScrollableColWindow,
  computeScrollableRowWindowFromOffsets,
  rangeCrossesBoundary,
  type ImageLoadEvent,
  type LoadedImage,
} from '@infinitable/grid'
import type { LayerHandle, Region, SceneNode } from '@infinitable/render'

import { borderInset } from './cell-style'
import type { ListTable } from './list-table'
import { cellKey } from './list-table-internal'
import { ensureMediaGroups } from './list-table-scene'
import { ChartCellNode } from './media/chart-cell-node'
import { ImageCellNode } from './media/image-cell-node'
import type { CellChartMedia, CellChartMediaSize } from './types'

/** 图片加载窗口余量（px）：可视区域四周外扩的预挂范围，滚出即取消降级 */
const IMAGE_WINDOW_MARGIN = 240

/** media 格绘制视口（按格的冻结带归属收口） */
function mediaViewport(table: ListTable, col: number, row: number): Region {
  const { frozenRowCount, frozenColCount, frozenRowsHeight, frozenColsWidth } = table.geometryState
  const viewport = table.bodyViewport
  const top = row < frozenRowCount ? viewport.y : viewport.y + frozenRowsHeight
  const left = col < frozenColCount ? viewport.x : viewport.x + frozenColsWidth
  return {
    x: left,
    y: top,
    width: Math.max(0, viewport.x + viewport.width - left),
    height: Math.max(0, viewport.y + viewport.height - top),
  }
}

/** L2 media 层惰性创建（无图片/图表格不建层；O(1) hitTest 禁用子节点遍历并建固定容器组） */
function mediaLayer(table: ListTable): LayerHandle {
  if (!table.sceneState.media) {
    const layer = table.host.createLayer({ kind: 'media', consumption: 'regions' })
    layer.root.hitTestChildren = false
    table.sceneState.media = layer
    ensureMediaGroups(table)
  }
  return table.sceneState.media
}

/** 按格冻结归属与跨界合并属性路由到对应的 media 容器组 */
function targetMediaGroup(table: ListTable, col: number, row: number): SceneNode {
  mediaLayer(table)
  const mediaGroups = ensureMediaGroups(table)
  const { frozenColCount, frozenRowCount, mergeCells } = table.geometryState
  const range = mergeCells.rangeAt(col, row)
  if (range && rangeCrossesBoundary(range, frozenColCount, frozenRowCount)) {
    return mediaGroups.crossMergeMediaGroup
  }
  const isFrozen = col < frozenColCount || row < frozenRowCount
  return isFrozen ? mediaGroups.frozenMediaGroup : mediaGroups.scrollableMediaGroup
}

/** 建图片格节点（media 层） */
export function appendImageCell(
  table: ListTable,
  col: number,
  row: number,
  url: string,
  x: number,
  y: number,
  width: number,
  height: number,
): ImageCellNode {
  const { mediaState, sceneState } = table
  const node = new ImageCellNode({
    col,
    row,
    x,
    y,
    width,
    height,
    url,
    fit: table.options.resolveCellImageFit?.(col, row) ?? 'contain',
    borderInset: borderInset(sceneState.cellNodes.get(cellKey(col, row))?.border),
    placeholderAfter: Date.now() + table.imageService.placeholderDelay,
    bodyViewport: mediaViewport(table, col, row),
  })
  const cacheKey = imageCacheKey(col, row, width, height)
  const cached = mediaState.mediaCache.get(cacheKey)
  const image = cached ?? table.imageService.getBitmap(url)
  if (image) {
    node.setBitmap(image)
    if (!cached) {
      mediaState.mediaCache.put(cacheKey, image, Math.round(width * height * 4))
    }
  } else {
    table.imageService.request(url, { col, row })
  }
  targetMediaGroup(table, col, row).appendChild(node)
  mediaState.imageCellNodes.set(cellKey(col, row), node)
  return node
}

/** 图片格局部刷新 */
export function refreshImageCell(table: ListTable, col: number, row: number): void {
  const { mediaState, sceneState } = table
  const key = cellKey(col, row)
  const node = mediaState.imageCellNodes.get(key)
  const url = table.options.resolveCellImage?.(col, row)
  if (!node) {
    const body = sceneState.cellNodes.get(key)
    if (!url || !body) {
      return
    }
    const appended = appendImageCell(table, col, row, url, body.x, body.y, body.width, body.height)
    table.host.submitInvalidation('media', { type: 'region', region: appended.getGlobalBounds() })
    return
  }
  if (!sceneState.media) {
    return
  }
  const region = node.getGlobalBounds()
  if (!url) {
    mediaState.mediaCache.invalidateKey(imageCacheKey(col, row, node.width, node.height))
    node.removeFromParent()
    mediaState.imageCellNodes.delete(key)
  } else if (url !== node.url) {
    mediaState.mediaCache.invalidateKey(imageCacheKey(col, row, node.width, node.height))
    node.removeFromParent()
    mediaState.imageCellNodes.delete(key)
    appendImageCell(table, col, row, url, node.x, node.y, node.width, node.height)
  } else {
    const fit = table.options.resolveCellImageFit?.(col, row) ?? 'contain'
    if (node.fit !== fit) {
      node.fit = fit
    }
  }
  table.host.submitInvalidation('media', { type: 'region', region })
}

/** body 格生效边框重算后的图片格联动 */
export function syncImageCellInset(table: ListTable, col: number, row: number): void {
  const node = table.mediaState.imageCellNodes.get(cellKey(col, row))
  if (node) {
    node.borderInset = borderInset(table.sceneState.cellNodes.get(cellKey(col, row))?.border)
  }
}

/** 图片加载完成：位图写回引用它的可见格节点 + cell 级 LRU，并逐格定向失效 */
export function onImageServiceLoad(table: ListTable, e: ImageLoadEvent): void {
  const { mediaState, sceneState } = table
  if (!sceneState.media) {
    return
  }
  const image = table.imageService.getBitmap(e.url)
  if (!image) {
    return
  }
  for (const cell of e.cells) {
    const node = mediaState.imageCellNodes.get(cellKey(cell.col, cell.row))
    if (!node || node.url !== e.url) {
      continue
    }
    node.setBitmap(image)
    mediaState.mediaCache.put(
      imageCacheKey(cell.col, cell.row, node.width, node.height),
      image,
      Math.round(node.width * node.height * 4),
    )
    table.host.submitInvalidation('media', { type: 'region', region: node.getGlobalBounds() })
  }
}

/** 图片加载窗口随滚动的窗口化调度 */
export function updateImageWindow(table: ListTable): void {
  const { geometryState } = table
  const { left, top } = table.scroll.state
  const rows = computeScrollableRowWindowFromOffsets(
    Math.max(0, top - IMAGE_WINDOW_MARGIN),
    table.viewportHeight - geometryState.frozenRowsHeight + IMAGE_WINDOW_MARGIN * 2,
    geometryState.rowOffsets,
    geometryState.frozenRowCount,
  )
  const cols = computeScrollableColWindow(
    Math.max(0, left - IMAGE_WINDOW_MARGIN),
    table.viewportWidth - geometryState.frozenColsWidth + IMAGE_WINDOW_MARGIN * 2,
    geometryState.colOffsets,
    geometryState.frozenColCount,
  )
  table.imageService.updateWindow(
    (cell) =>
      (cell.row < geometryState.frozenRowCount ||
        (cell.row >= rows.start && cell.row < rows.end)) &&
      (cell.col < geometryState.frozenColCount || (cell.col >= cols.start && cell.col < cols.end)),
  )
}

function imageCacheKey(col: number, row: number, width: number, height: number): string {
  return `image:${col}:${row}:${Math.round(width)}x${Math.round(height)}`
}

// ---- 图表格路由（L2 media 的 chart 预留位落地） ----

function chartCacheKey(contentKey: string, width: number, height: number, dpr: number): string {
  return `chart:${contentKey}:${Math.round(width)}x${Math.round(height)}@${dpr}`
}

/** 建图表格节点（media 层） */
export function appendChartCell(
  table: ListTable,
  col: number,
  row: number,
  media: CellChartMedia,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const { mediaState } = table
  const size: CellChartMediaSize = { width, height, dpr: mediaState.hostDpr }
  const cacheKey = chartCacheKey(media.key, width, height, mediaState.hostDpr)
  const node = new ChartCellNode({
    col,
    row,
    x,
    y,
    width,
    height,
    cacheKey,
    placeholderAfter: Date.now() + table.imageService.placeholderDelay,
    bodyViewport: mediaViewport(table, col, row),
  })
  const cached = mediaState.mediaCache.get(cacheKey)
  if (cached) {
    node.setBitmap(cached)
  } else {
    requestChartBitmap(table, cacheKey, media, size, col, row)
  }
  targetMediaGroup(table, col, row).appendChild(node)
  mediaState.chartCellNodes.set(cellKey(col, row), node)
}

/** 图表格局部刷新 */
export function refreshChartCell(table: ListTable, col: number, row: number): void {
  const { mediaState, sceneState } = table
  const key = cellKey(col, row)
  const node = mediaState.chartCellNodes.get(key)
  if (!node || !sceneState.media) {
    return
  }
  const region = node.getGlobalBounds()
  const media = table.options.resolveCellChart?.(col, row) ?? null
  if (!media) {
    node.removeFromParent()
    mediaState.chartCellNodes.delete(key)
  } else {
    const cacheKey = chartCacheKey(media.key, node.width, node.height, mediaState.hostDpr)
    if (cacheKey !== node.cacheKey) {
      node.removeFromParent()
      mediaState.chartCellNodes.delete(key)
      appendChartCell(table, col, row, media, node.x, node.y, node.width, node.height)
    }
  }
  table.host.submitInvalidation('media', { type: 'region', region })
}

function requestChartBitmap(
  table: ListTable,
  cacheKey: string,
  media: CellChartMedia,
  size: CellChartMediaSize,
  col: number,
  row: number,
): void {
  const { mediaState } = table
  let task = mediaState.chartRenderTasks.get(cacheKey)
  if (!task) {
    task = Promise.resolve()
      .then(() => media.produce(size))
      .catch((): LoadedImage | null => null)
    mediaState.chartRenderTasks.set(cacheKey, task)
    void task.then((image) => {
      mediaState.chartRenderTasks.delete(cacheKey)
      if (image && !table.destroyed) {
        mediaState.mediaCache.put(cacheKey, image, Math.round(image.width * image.height * 4))
      }
    })
  }
  void task.then((image) => {
    if (!image || table.destroyed) {
      return
    }
    const node = mediaState.chartCellNodes.get(cellKey(col, row))
    if (node && node.cacheKey === cacheKey) {
      node.setBitmap(image)
      table.host.submitInvalidation('media', { type: 'region', region: node.getGlobalBounds() })
    }
  })
}
