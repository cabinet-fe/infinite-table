// 演示区装配的公共件：建 section DOM、挂表（滚轮接线）、按钮与状态行、本地演示图片加载器。

import type { LoadedImage } from '@infinite-table/core'

import { ListTable, type ListTableOptions } from '@infinite-table/core'

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

export function createSection(root: HTMLElement, title: string, desc: string): HTMLElement {
  const section = document.createElement('section')
  const heading = document.createElement('h2')
  heading.textContent = title
  const paragraph = document.createElement('p')
  paragraph.className = 'desc'
  paragraph.textContent = desc
  section.append(heading, paragraph)
  root.appendChild(section)
  return section
}

export function createSubSection(section: HTMLElement, title: string): HTMLElement {
  const heading = document.createElement('h3')
  heading.textContent = title
  section.appendChild(heading)
  return section
}

/**
 * 挂一个表演示：建相对定位容器承载四层 canvas 并创建 ListTable。
 * core 侧滚动接线为触控/键盘；鼠标滚轮由宿主（本 demo）接线到 scrollBy。
 */
export function mountTable(section: HTMLElement, options: ListTableOptions): DemoMount {
  const container = document.createElement('div')
  container.className = 'table-mount'
  container.style.width = `${options.width}px`
  container.style.height = `${options.height}px`
  section.appendChild(container)
  const table = new ListTable({
    ...options,
    hostOptions: { container, dpr: resolveDpr() },
  })
  attachWheel(container, table)
  return { container, table }
}

export function addButton(section: HTMLElement, label: string, onClick: () => void): HTMLElement {
  let toolbar = section.querySelector<HTMLElement>(':scope > .toolbar')
  if (!toolbar) {
    toolbar = document.createElement('div')
    toolbar.className = 'toolbar'
    section.appendChild(toolbar)
  }
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', onClick)
  toolbar.appendChild(button)
  return button
}

/** 加一行状态文本（订阅事件的可见化）；返回的元素直接改 textContent */
export function addStatus(section: HTMLElement, initial = ''): HTMLElement {
  const status = document.createElement('div')
  status.className = 'status'
  status.textContent = initial
  section.appendChild(status)
  return status
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

/** 本地图片加载器（演示区共享）：按 URL 生成确定色的 canvas 位图，40ms 人工延迟模拟异步加载 */
export async function demoLoadImage(url: string): Promise<LoadedImage> {
  await new Promise((resolve) => setTimeout(resolve, 40))
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
  return { source: canvas, width: IMAGE_WIDTH, height: IMAGE_HEIGHT }
}
