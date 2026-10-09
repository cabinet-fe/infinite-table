// 演示区装配的引擎公共件：挂表（滚轮接线）与本地演示图片加载器。
// 标题/描述/按钮等用户可见控件由 React 页面（src/app/views/**）承担，此处不建控件 DOM。

import type { LoadedImage } from '@infinitable/core'

import { ListTable, type ListTableOptions } from '@infinitable/core'

export interface DemoMount {
  container: HTMLElement
  table: ListTable
}

/** 是否处于冒烟模式（?smoke=1）：dpr 锁 1，保证页内像素断言确定性 */
export function isSmokeMode(): boolean {
  return new URLSearchParams(location.search).has('smoke')
}

/** dpr 解析：冒烟模式锁 1（页内像素断言确定性），否则取设备 dpr */
export function resolveDpr(): number {
  return isSmokeMode() ? 1 : window.devicePixelRatio || 1
}

/**
 * 鼠标滚轮 → scrollBy 接线（core 侧滚动接线为触控/键盘，滚轮由宿主负责）；
 * 返回退订函数（组件卸载时解绑）。
 */
export function attachWheel(container: HTMLElement, table: ListTable): () => void {
  const handler = (e: WheelEvent): void => {
    e.preventDefault()
    table.scrollBy(e.deltaX, e.deltaY)
  }
  container.addEventListener('wheel', handler, { passive: false })
  return () => container.removeEventListener('wheel', handler)
}

/**
 * 挂一个表演示：建相对定位容器承载四层 canvas 并创建 ListTable。
 * core 侧滚动接线为触控/键盘；鼠标滚轮由宿主（本 demo）接线到 scrollBy。
 */
export function mountTable(parent: HTMLElement, options: ListTableOptions): DemoMount {
  const container = document.createElement('div')
  container.className = 'table-mount'
  container.style.width = `${options.width}px`
  container.style.height = `${options.height}px`
  parent.appendChild(container)
  const table = new ListTable({
    ...options,
    hostOptions: { container, dpr: resolveDpr() },
  })
  attachWheel(container, table)
  return { container, table }
}

const IMAGE_WIDTH = 96
const IMAGE_HEIGHT = 28

function hashCode(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/** 本地生成位图（演示区共享）：按 URL 生成确定色 canvas（sheet 演示图片字节与此同源） */
function demoImageCanvas(url: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = IMAGE_WIDTH
  canvas.height = IMAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = `hsl(${hashCode(url) % 360} 70% 55%)`
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
    ctx.fillStyle = '#ffffff'
    ctx.font = '11px sans-serif'
    ctx.fillText(url.split('/').pop() ?? url, 6, 18)
  }
  return canvas
}

/** 本地图片加载器（演示区共享）：按 URL 生成确定色的 canvas 位图，40ms 人工延迟模拟异步加载 */
export async function demoLoadImage(url: string): Promise<LoadedImage> {
  await new Promise((resolve) => setTimeout(resolve, 40))
  const canvas = demoImageCanvas(url)
  return { source: canvas, width: canvas.width, height: canvas.height }
}

/** 本地生成位图 → PNG 字节（sheet 浮动图模型字节载荷；与 demoLoadImage 同一绘制源） */
export function demoImagePngBytes(url: string): Uint8Array {
  const encoded = demoImageCanvas(url).toDataURL('image/png')
  const raw = atob(encoded.slice(encoded.indexOf(',') + 1))
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) {
    bytes[index] = raw.charCodeAt(index)
  }
  return bytes
}
