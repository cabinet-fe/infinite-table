import type { Region } from './types'

/** 两矩形是否相交（含边相接不算相交） */
export function intersects(a: Region, b: Region): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** 两矩形的包围盒 */
export function union(a: Region, b: Region): Region {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/** 四边外扩 n（防残影，对照 leafer clipSpread） */
export function spread(r: Region, n: number): Region {
  return { x: r.x - n, y: r.y - n, width: r.width + 2 * n, height: r.height + 2 * n }
}

/** 像素对齐：左上向下取整、右下向上取整（对照 leafer ceilPartPixel） */
export function ceil(r: Region): Region {
  const x = Math.floor(r.x)
  const y = Math.floor(r.y)
  return {
    x,
    y,
    width: Math.ceil(r.x + r.width) - x,
    height: Math.ceil(r.y + r.height) - y,
  }
}

/** 与边界矩形求交并裁剪；不相交返回 null */
export function clip(r: Region, bounds: Region): Region | null {
  const x = Math.max(r.x, bounds.x)
  const y = Math.max(r.y, bounds.y)
  const right = Math.min(r.x + r.width, bounds.x + bounds.width)
  const bottom = Math.min(r.y + r.height, bounds.y + bounds.height)
  if (right <= x || bottom <= y) {
    return null
  }
  return { x, y, width: right - x, height: bottom - y }
}

/** 判断两矩形是否完全相同 */
export function equals(a: Region, b: Region): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
