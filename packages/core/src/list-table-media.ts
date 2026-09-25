// ListTable 媒体集成协作模块（拆自 list-table.ts，纯移动不改行为）：
// L2 media 层惰性创建、图片/图表格节点装配与局部刷新、ImageService 加载完成回写、
// 图片加载窗口随滚动的窗口化调度、图表格出图路由（chart 预留位落地：位图由插件侧
// 离屏出图，经 cell 级 MediaCache LRU 缓存与 blit，无闪协议同图片）。
// 以 ListTable 实例为参数的协作函数，只触碰表实例上标注 @internal 的内部成员。

import type { LayerHandle } from '@infinite-table/render'

import { computeScrollableColWindow, computeScrollableRowWindowFromOffsets } from './grid-layout'
import { ChartCellNode } from './media/chart-cell-node'
import { ImageCellNode } from './media/image-cell-node'
import type { ImageLoadEvent, LoadedImage } from './media/image-service'
import type { ListTable } from './list-table'
import { cellKey } from './list-table-internal'
import type { CellChartMedia, CellChartMediaSize } from './types'

/** 图片加载窗口余量（px）：可视区域四周外扩的预挂范围，滚出即取消降级 */
const IMAGE_WINDOW_MARGIN = 240

/** L2 media 层惰性创建（无图片格不建层） */
function mediaLayer(table: ListTable): LayerHandle {
  if (!table.media) {
    table.media = table.host.createLayer({ kind: 'media' })
  }
  return table.media
}

/**
 * 建图片格节点（media 层）。无闪协议：
 * cell 级 LRU 或 ImageService 已就绪 → 首帧直接画真实位图（无"先占位一帧再调整"）；
 * 未就绪 → 登记窗口化请求，placeholderDelay 内连占位都不画（防快速滚动占位闪烁），
 * 加载完成经 onImageServiceLoad 定向失效本格、单帧切换。
 */
export function appendImageCell(
  table: ListTable,
  col: number,
  row: number,
  url: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const node = new ImageCellNode({
    col,
    row,
    x,
    y,
    width,
    height,
    url,
    placeholderAfter: Date.now() + table.imageService.placeholderDelay,
    // 边缘半格图片经 body 视口裁剪，不越界画进表头/行号列区域
    bodyViewport: table.bodyViewport,
  })
  const cacheKey = imageCacheKey(col, row, width, height)
  const cached = table.mediaCache.get(cacheKey)
  const image = cached ?? table.imageService.getBitmap(url)
  if (image) {
    node.setBitmap(image)
    if (!cached) {
      table.mediaCache.put(cacheKey, image, Math.round(width * height * 4))
    }
  } else {
    table.imageService.request(url, { col, row })
  }
  mediaLayer(table).root.appendChild(node)
  table.imageCellNodes.set(cellKey(col, row), node)
}

/** 图片格局部刷新：URL 变化则原位重建节点；URL 消失则摘除 media 节点 */
export function refreshImageCell(table: ListTable, col: number, row: number): void {
  const key = cellKey(col, row)
  const node = table.imageCellNodes.get(key)
  if (!node || !table.media) {
    return
  }
  const region = node.getGlobalBounds()
  const url = table.options.resolveCellImage?.(col, row)
  if (!url) {
    table.media.root.removeChild(node)
    table.imageCellNodes.delete(key)
  } else if (url !== node.url) {
    table.media.root.removeChild(node)
    table.imageCellNodes.delete(key)
    appendImageCell(table, col, row, url, node.x, node.y, node.width, node.height)
  }
  table.host.submitInvalidation('media', { type: 'cell', region })
}

/** 图片加载完成：位图写回引用它的可见格节点 + cell 级 LRU，并逐格定向失效 */
export function onImageServiceLoad(table: ListTable, e: ImageLoadEvent): void {
  if (!table.media) {
    return
  }
  const image = table.imageService.getBitmap(e.url)
  if (!image) {
    return
  }
  for (const cell of e.cells) {
    const node = table.imageCellNodes.get(cellKey(cell.col, cell.row))
    if (!node || node.url !== e.url) {
      continue
    }
    node.setBitmap(image)
    table.mediaCache.put(
      imageCacheKey(cell.col, cell.row, node.width, node.height),
      image,
      Math.round(node.width * node.height * 4),
    )
    table.host.submitInvalidation('media', { type: 'cell', region: node.getGlobalBounds() })
  }
}

/**
 * 图片加载窗口 = 可视区域（冻结带 + 滚动窗口）外扩余量；
 * 随滚动调度：窗口内 idle 提权加载，滚出窗口的 loading 取消降级。
 */
export function updateImageWindow(table: ListTable): void {
  const { left, top } = table.scroll.state
  const rows = computeScrollableRowWindowFromOffsets(
    Math.max(0, top - IMAGE_WINDOW_MARGIN),
    table.viewportHeight - table.frozenRowsHeight + IMAGE_WINDOW_MARGIN * 2,
    table.rowOffsets,
    table.frozenRowCount,
  )
  const cols = computeScrollableColWindow(
    Math.max(0, left - IMAGE_WINDOW_MARGIN),
    table.viewportWidth - table.frozenColsWidth + IMAGE_WINDOW_MARGIN * 2,
    table.colOffsets,
    table.frozenColCount,
  )
  table.imageService.updateWindow(
    (cell) =>
      (cell.row < table.frozenRowCount || (cell.row >= rows.start && cell.row < rows.end)) &&
      (cell.col < table.frozenColCount || (cell.col >= cols.start && cell.col < cols.end)),
  )
}

function imageCacheKey(col: number, row: number, width: number, height: number): string {
  return `image:${col}:${row}:${Math.round(width)}x${Math.round(height)}`
}

// ---- 图表格路由（L2 media 的 chart 预留位落地） ----

/**
 * cell 级缓存 key：插件侧内容 key（按图表声明内容生成）+ 格几何 + 出图 DPR。
 * 内容、尺寸、DPR 任一变更自然换 key（旧条目留在 LRU 由预算淘汰，不主动清理）。
 */
function chartCacheKey(contentKey: string, width: number, height: number, dpr: number): string {
  return `chart:${contentKey}:${Math.round(width)}x${Math.round(height)}@${dpr}`
}

/**
 * 建图表格节点（media 层）。无闪协议同图片格：
 * cell 级 LRU 命中 → 首帧直接画真实位图（滚动滚回直接回贴，无占位帧）；
 * 未命中 → 登记出图（插件侧离屏同步出图，首次含库加载为异步），placeholderDelay 内
 * 连占位都不画，出图完成后定向失效本格、单帧切换。
 */
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
  const size: CellChartMediaSize = { width, height, dpr: table.hostDpr }
  const cacheKey = chartCacheKey(media.key, width, height, table.hostDpr)
  const node = new ChartCellNode({
    col,
    row,
    x,
    y,
    width,
    height,
    cacheKey,
    placeholderAfter: Date.now() + table.imageService.placeholderDelay,
    // 边缘半格图表格经 body 视口裁剪，不越界画进表头/行号列区域
    bodyViewport: table.bodyViewport,
  })
  const cached = table.mediaCache.get(cacheKey)
  if (cached) {
    node.setBitmap(cached)
  } else {
    requestChartBitmap(table, cacheKey, media, size, col, row)
  }
  mediaLayer(table).root.appendChild(node)
  table.chartCellNodes.set(cellKey(col, row), node)
}

/**
 * 图表格局部刷新：声明内容变更（换 key）则原位重建节点，声明消失则摘除 media 节点。
 * 位图未变的格（key 相同）不做任何重建——缓存命中语义下重贴与保留等价。
 */
export function refreshChartCell(table: ListTable, col: number, row: number): void {
  const key = cellKey(col, row)
  const node = table.chartCellNodes.get(key)
  if (!node || !table.media) {
    return
  }
  const region = node.getGlobalBounds()
  const media = table.chartMediaResolver?.(col, row) ?? null
  if (!media) {
    table.media.root.removeChild(node)
    table.chartCellNodes.delete(key)
  } else {
    const cacheKey = chartCacheKey(media.key, node.width, node.height, table.hostDpr)
    if (cacheKey !== node.cacheKey) {
      table.media.root.removeChild(node)
      table.chartCellNodes.delete(key)
      appendChartCell(table, col, row, media, node.x, node.y, node.width, node.height)
    }
  }
  table.host.submitInvalidation('media', { type: 'cell', region })
}

/**
 * 出图请求：同 key 并发请求收敛为一次 produce（单飞），落定后位图写回 cell 级 LRU，
 * 并回填各自仍在窗口内且 key 未变的请求格、定向失效（单飞共享任务，回填按请求方各自登记）。
 * 出图失败按占位容错（不抛错），仅剥除单飞记录以便下次重试。
 */
function requestChartBitmap(
  table: ListTable,
  cacheKey: string,
  media: CellChartMedia,
  size: CellChartMediaSize,
  col: number,
  row: number,
): void {
  let task = table.chartRenderTasks.get(cacheKey)
  if (!task) {
    task = Promise.resolve()
      .then(() => media.produce(size))
      .catch((): LoadedImage | null => null)
    table.chartRenderTasks.set(cacheKey, task)
    task.then((image) => {
      table.chartRenderTasks.delete(cacheKey)
      if (image && !table.destroyed) {
        table.mediaCache.put(cacheKey, image, Math.round(image.width * image.height * 4))
      }
    })
  }
  // 每个请求方各自等待落定回填（同 key 多格共享一次出图、各贴各格）
  task.then((image) => {
    if (!image || table.destroyed) {
      return
    }
    const node = table.chartCellNodes.get(cellKey(col, row))
    if (node && node.cacheKey === cacheKey) {
      node.setBitmap(image)
      table.host.submitInvalidation('media', { type: 'cell', region: node.getGlobalBounds() })
    }
  })
}
