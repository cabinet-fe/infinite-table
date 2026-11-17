// 固定悬浮 Toast 通知系统：不挤开画布、不触发 ResizeObserver 抖动

import { AlertTriangleIcon, CheckCircleIcon, LightbulbIcon, XIcon } from './Icons'

export type ToastType = 'error' | 'success' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
}

export interface ToastHostProps {
  toasts: readonly ToastItem[]
  onDismiss: (id: string) => void
}

export function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  if (toasts.length === 0) {
    return null
  }

  return (
    <div className="st-toast-host" aria-live="polite" aria-label="系统通知">
      {toasts.map((toast) => (
        <div key={toast.id} className={`st-toast is-${toast.type}`} role="status">
          <span className="st-toast-icon">
            {toast.type === 'error' ? (
              <AlertTriangleIcon size={15} />
            ) : toast.type === 'success' ? (
              <CheckCircleIcon size={15} />
            ) : (
              <LightbulbIcon size={15} />
            )}
          </span>
          <span className="st-toast-msg">{toast.message}</span>
          <button
            type="button"
            className="st-icon-btn st-toast-close"
            onClick={() => onDismiss(toast.id)}
            aria-label="关闭通知"
          >
            <XIcon size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
