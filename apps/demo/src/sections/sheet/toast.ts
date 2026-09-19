// 轻量消息提示（对标 ultra-ui 的 message 顶出形态）：顶部居中堆叠、自动消退。
// 取代旧演示区的常驻状态文本行（sheet 卡片内无状态栏，与 ultra-ui 一致）。

export type NotifyKind = 'info' | 'warn'

export interface Notifier {
  notify(text: string, kind?: NotifyKind): void
  destroy(): void
}

const AUTO_DISMISS_MS: Record<NotifyKind, number> = { info: 2400, warn: 3600 }

export function createToaster(): Notifier {
  const host = document.createElement('div')
  host.className = 'sheet-toast-host'
  document.body.appendChild(host)

  const notify = (text: string, kind: NotifyKind = 'info'): void => {
    const toast = document.createElement('div')
    toast.className = `sheet-toast is-${kind}`
    const dot = document.createElement('span')
    dot.className = 'sheet-toast__dot'
    const label = document.createElement('span')
    label.textContent = text
    toast.append(dot, label)
    host.appendChild(toast)
    // 同屏最多 3 条：挤掉最早的
    while (host.children.length > 3) {
      host.firstElementChild?.remove()
    }
    window.setTimeout(() => {
      toast.classList.add('is-leaving')
      window.setTimeout(() => toast.remove(), 200)
    }, AUTO_DISMISS_MS[kind])
  }

  return {
    notify,
    destroy() {
      host.remove()
    },
  }
}
