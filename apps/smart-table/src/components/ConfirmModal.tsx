// 破坏性操作二次确认弹窗：替代原生 window.confirm

import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export interface ConfirmModalProps {
  open: boolean
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onCancel])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[1px]"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="st-confirm-title"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
                danger ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
              }`}
            >
              <AlertTriangle className="h-4 w-4" />
            </span>
            <h2 id="st-confirm-title" className="text-sm font-semibold text-slate-900">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-[13px] leading-relaxed text-slate-600">{description}</p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <button
            type="button"
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`h-8 rounded-md px-3 text-xs font-medium text-white disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
            disabled={busy}
            onClick={() => void onConfirm()}
            autoFocus
          >
            {busy ? '处理中...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
