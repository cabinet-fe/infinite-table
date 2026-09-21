// 弹层与菜单公共件（对标 ultra-ui 单 UDropdown 宿主 + contextmenu.pop 的形态）：
// 全局单例弹层（锚点/坐标定位、点外关闭、Esc 关闭、窗口变化关闭）与危险确认对话框。

export interface PopupHandle {
  el: HTMLElement
  close(): void
}

let active: PopupHandle | null = null
let activeAnchor: HTMLElement | null = null

/** 关闭当前弹层（切换场景/打开新弹层前调用） */
export function closeActivePopup(): void {
  active?.close()
}

/** 当前弹层是否锚定在指定元素上（同按钮再点 = 关闭的 toggle 判定用） */
export function isPopupAnchoredTo(anchor: HTMLElement): boolean {
  return active !== null && activeAnchor === anchor
}

interface OpenOptions {
  /** 内容构建：el 为面板容器，close 为关闭函数（keepOpen 场景由调用方自行决定何时调用） */
  build: (el: HTMLElement, close: () => void) => void
  /** 面板挂载并定位完成后的回调（聚焦输入等；build 时元素尚未入 DOM，focus 会被吞） */
  onOpened?: (el: HTMLElement) => void
  onClosed?: () => void
}

/** 以锚点元素定位（面板左上角贴锚点左下角 +4px，越界翻转/夹取） */
export function openAnchoredPopup(anchor: HTMLElement, options: OpenOptions): PopupHandle {
  const rect = anchor.getBoundingClientRect()
  const handle = openPopup({
    ...options,
    x: rect.left,
    y: rect.bottom + 4,
    maxX: rect.right,
  })
  activeAnchor = anchor
  return handle
}

/** 以视口坐标定位（右键菜单：落点为面板左上角，整体夹取在窗口内） */
export function openFixedPopup(x: number, y: number, options: OpenOptions): PopupHandle {
  return openPopup({ ...options, x, y })
}

function openPopup(options: OpenOptions & { x: number; y: number; maxX?: number }): PopupHandle {
  active?.close()
  const el = document.createElement('div')
  el.className = 'sheet-popup-layer'
  let closed = false
  const listeners: Array<[EventTarget, string, EventListener]> = []

  const close = (): void => {
    if (closed) {
      return
    }
    closed = true
    for (const [target, type, listener] of listeners) {
      target.removeEventListener(type, listener)
    }
    el.remove()
    if (active === handle) {
      active = null
      activeAnchor = null
    }
    options.onClosed?.()
  }

  options.build(el, close)
  // 弹层（含右键菜单）内右键不弹浏览器原生菜单
  el.addEventListener('contextmenu', (event) => event.preventDefault())
  document.body.appendChild(el)
  // 先隐藏测量尺寸，再夹取定位（避免闪跳）
  el.style.visibility = 'hidden'
  const width = el.offsetWidth
  const height = el.offsetHeight
  const margin = 8
  let left = options.x
  if (left + width > window.innerWidth - margin) {
    // 右越界：优先右对齐锚点，仍越界则贴右边距
    left = options.maxX != null ? options.maxX - width : window.innerWidth - margin - width
    left = Math.max(margin, left)
  }
  let top = options.y
  if (top + height > window.innerHeight - margin) {
    // 下越界：翻转到锚点上方（估算锚点高度 ≈ 24px）
    top = Math.max(margin, options.y - height - 28)
  }
  el.style.left = `${Math.max(margin, left)}px`
  el.style.top = `${Math.max(margin, top)}px`
  el.style.visibility = ''
  options.onOpened?.(el)

  // 点面板外关闭（面板内交互不关；锚点按钮也放行——同按钮再点的关闭交给 click 的 toggle 判定）
  const onPointerDown = (event: Event): void => {
    if (event.target instanceof Node) {
      if (el.contains(event.target)) {
        return
      }
      if (activeAnchor && activeAnchor.contains(event.target)) {
        return
      }
    }
    close()
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  listeners.push([document, 'pointerdown', onPointerDown])
  const onKeyDown = (event: Event): void => {
    if ((event as KeyboardEvent).key === 'Escape') {
      close()
    }
  }
  document.addEventListener('keydown', onKeyDown, true)
  listeners.push([document, 'keydown', onKeyDown])
  const onResize = (): void => close()
  window.addEventListener('resize', onResize)
  listeners.push([window, 'resize', onResize])

  const handle: PopupHandle = { el, close }
  active = handle
  return handle
}

/** 危险确认对话框（对标 ultra-ui messageConfirm.danger）：Promise<boolean> */
export function confirmDanger(options: {
  message: string
  confirmText?: string
}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'sheet-dialog-overlay'
    const dialog = document.createElement('div')
    dialog.className = 'sheet-dialog'
    const message = document.createElement('p')
    message.className = 'sheet-dialog__message'
    message.textContent = options.message
    const actions = document.createElement('div')
    actions.className = 'sheet-dialog__actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'sheet-dialog__button'
    cancel.textContent = '取消'
    const confirm = document.createElement('button')
    confirm.type = 'button'
    confirm.className = 'sheet-dialog__button is-danger'
    confirm.textContent = options.confirmText ?? '删除'
    actions.append(cancel, confirm)
    dialog.append(message, actions)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    let settled = false
    const settle = (value: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(value)
    }
    cancel.addEventListener('click', () => settle(false))
    confirm.addEventListener('click', () => settle(true))
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) {
        settle(false)
      }
    })
    const onKey = (event: Event): void => {
      if ((event as KeyboardEvent).key === 'Escape') {
        settle(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    confirm.focus()
  })
}
