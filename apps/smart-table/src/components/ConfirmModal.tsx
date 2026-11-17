// 破坏性操作二次确认弹窗：替代原生 window.confirm

import { useEffect } from 'react'
import { AlertTriangleIcon, XIcon } from './Icons'

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
      className="st-confirm-backdrop"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        className="st-modal st-confirm-modal"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="st-confirm-title"
      >
        <div className="st-modal-header">
          <div className="st-confirm-head-left">
            <span className={`st-confirm-badge ${danger ? 'is-danger' : ''}`}>
              <AlertTriangleIcon size={16} />
            </span>
            <h2 id="st-confirm-title" className="st-modal-title">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="st-icon-btn"
            disabled={busy}
            onClick={onCancel}
            aria-label="关闭"
          >
            <XIcon size={14} />
          </button>
        </div>

        <div className="st-modal-body">
          <p className="st-confirm-desc">{description}</p>
        </div>

        <div className="st-modal-footer st-confirm-footer">
          <button type="button" className="st-btn" disabled={busy} onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`st-btn ${danger ? 'st-btn-danger-solid' : 'st-btn-primary'}`}
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
