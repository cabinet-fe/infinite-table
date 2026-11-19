// 画布宿主容器定位上下文与尺寸同步辅助：防止静态容器导致绝对定位 Canvas 错位到祖先视口，并在初始化与 ResizeObserver 中保障有效宽高同步。

export interface HostContainerSize {
  width: number
  height: number
}

export interface HostContainerSizeSync {
  getLastValidSize: () => HostContainerSize
  syncNow: () => void
  dispose: () => void
}

function toPositiveSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function safeGetBoundingClientRect(container: HTMLElement): DOMRect | null {
  if (typeof container.getBoundingClientRect !== 'function') {
    return null
  }
  try {
    return container.getBoundingClientRect()
  } catch {
    return null
  }
}

function readComputedPosition(container: HTMLElement): string {
  const view = container.ownerDocument?.defaultView ?? globalThis
  if (typeof view.getComputedStyle !== 'function') {
    return ''
  }
  try {
    return view.getComputedStyle(container).position
  } catch {
    return ''
  }
}

/** 读取宿主容器当前有效宽高（优先 ResizeObserver contentRect 与 clientWidth/clientHeight，缺失时回落边界矩形） */
export function readHostContainerSize(
  container: HTMLElement,
  entry?: ResizeObserverEntry,
): HostContainerSize {
  const entryW = toPositiveSize(entry?.contentRect?.width)
  const entryH = toPositiveSize(entry?.contentRect?.height)
  const clientW = toPositiveSize(container.clientWidth)
  const clientH = toPositiveSize(container.clientHeight)
  const rect =
    (entryW === 0 && clientW === 0) || (entryH === 0 && clientH === 0)
      ? safeGetBoundingClientRect(container)
      : null
  return {
    width: entryW || clientW || toPositiveSize(rect?.width),
    height: entryH || clientH || toPositiveSize(rect?.height),
  }
}

/**
 * 保障宿主容器具备非 static 定位上下文，使内部绝对定位 Canvas 严格以容器为包含块；
 * 仅在计算样式为 static（或未设置）时注入 relative，销毁时仅在未遭外部覆盖的前提下还原原内联样式。
 */
export function ensureHostContainerPosition(container: HTMLElement): () => void {
  const prevInlinePosition = container.style.position
  const computedPosition = readComputedPosition(container)
  const effectivePosition = computedPosition || prevInlinePosition
  if (effectivePosition && effectivePosition !== 'static') {
    return () => {}
  }

  container.style.position = 'relative'
  return () => {
    if (container.style.position === 'relative') {
      container.style.position = prevInlinePosition
    }
  }
}

/** 绑定 ResizeObserver 与首帧布局补偿同步，仅在宽高均大于 0 时触发尺寸同步 */
export function attachHostContainerSizeSync(
  container: HTMLElement,
  initialSize: HostContainerSize,
  onResize: (width: number, height: number) => void,
): HostContainerSizeSync {
  let disposed = false
  let lastValidSize: HostContainerSize =
    initialSize.width > 0 && initialSize.height > 0 ? { ...initialSize } : { width: 0, height: 0 }

  const applySize = (size: HostContainerSize): void => {
    if (disposed || size.width <= 0 || size.height <= 0) {
      return
    }
    lastValidSize = size
    onResize(size.width, size.height)
  }

  let resizeObserver: ResizeObserver | null = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      applySize(readHostContainerSize(container, entries[0]))
    })
    resizeObserver.observe(container)
  }

  let rafId: number | null = null
  if (
    (initialSize.width <= 0 || initialSize.height <= 0) &&
    typeof requestAnimationFrame === 'function'
  ) {
    rafId = requestAnimationFrame(() => {
      rafId = null
      applySize(readHostContainerSize(container))
    })
  }

  return {
    getLastValidSize: () => lastValidSize,
    syncNow: () => {
      applySize(readHostContainerSize(container))
    },
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      resizeObserver?.disconnect()
      resizeObserver = null
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    },
  }
}
