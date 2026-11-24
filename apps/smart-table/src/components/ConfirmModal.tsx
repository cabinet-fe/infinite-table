// 破坏性操作二次确认弹窗：替代原生 window.confirm

import { useEffect } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'

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

  const Icon = danger ? AlertTriangle : Info

  return (
    <div
      className="st-overlay"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        className="st-modal max-w-md"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="st-confirm-title"
      >
        <div className="relative p-6">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                danger ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
              }`}
            >
              <Icon className="h-5 w-5" />
            </span>
            <h2 id="st-confirm-title" className="st-modal-title">
              {title}
            </h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">{description}</p>
          <button
            type="button"
            className="st-icon-btn absolute top-3 right-3"
            disabled={busy}
            onClick={onCancel}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="st-modal-footer">
          <button
            type="button"
            className="st-btn st-btn-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`st-btn ${danger ? 'st-btn-danger' : 'st-btn-primary'}`}
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
