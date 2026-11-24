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
      className="pointer-events-none fixed right-4 top-4 z-[1300] flex w-80 flex-col gap-2"
      aria-live="polite"
      aria-label="系统通知"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-700 shadow-panel animate-pop-in"
          role="status"
        >
          <span className="shrink-0">
            {toast.type === 'error' ? (
              <AlertTriangle className="h-[18px] w-[18px] text-red-500" />
            ) : toast.type === 'success' ? (
              <CheckCircle2 className="h-[18px] w-[18px] text-emerald-500" />
            ) : (
              <Info className="h-[18px] w-[18px] text-blue-500" />
            )}
          </span>
          <span className="flex-1 leading-snug">{toast.message}</span>
          <button
            type="button"
            className="st-icon-btn st-icon-btn-xs"
            onClick={() => onDismiss(toast.id)}
            aria-label="关闭通知"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
