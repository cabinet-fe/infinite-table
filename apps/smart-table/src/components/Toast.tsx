// 固定悬浮 Toast 通知系统：不挤开画布、不触发 ResizeObserver 抖动

import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

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
    <div
      className="pointer-events-none fixed right-4 top-4 z-[1300] flex max-w-sm flex-col gap-2"
      aria-live="polite"
      aria-label="系统通知"
    >
      {toasts.map((toast) => {
        const styleClass =
          toast.type === 'error'
            ? 'border-red-200 bg-red-50 text-red-800'
            : toast.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-blue-200 bg-blue-50 text-blue-800'
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-md ${styleClass}`}
            role="status"
          >
            <span className="shrink-0">
              {toast.type === 'error' ? (
                <AlertTriangle className="h-4 w-4 text-red-600" />
              ) : toast.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <Info className="h-4 w-4 text-blue-600" />
              )}
            </span>
            <span className="flex-1 leading-snug">{toast.message}</span>
            <button
              type="button"
              className="rounded p-0.5 opacity-60 hover:bg-black/5 hover:opacity-100"
              onClick={() => onDismiss(toast.id)}
              aria-label="关闭通知"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
