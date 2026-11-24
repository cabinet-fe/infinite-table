// 一键分享弹窗：支持对当前多维数据台应用、单视图或普通数据录入表创建分享链接，
// 配置有效期与可选密码、一键复制 /s/:token 完整链接，并列出当前资源历史/有效链接支持立即失效。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Eye, EyeOff, Link2, Lock, Plus, RefreshCw, Share2, X } from 'lucide-react'
import { ApiError, createShare, listShares, revokeShare } from '../api'
import {
  buildShareFullUrl,
  copyTextToClipboard,
  formatShareTimestamp,
  SHARE_STATUS_LABELS,
  SHARE_TARGET_LABELS,
} from '../domain/workspace-helpers'
import type { ShareRecord, ShareStatus, ShareTargetType } from '../shared/schema'
import type { ToastType } from './Toast'

export interface ShareTargetOption {
  targetType: ShareTargetType
  targetId: string
  targetName: string
}

export interface ShareModalProps {
  open: boolean
  targets: readonly ShareTargetOption[]
  initialTarget?: { targetType: ShareTargetType; targetId: string }
  onClose: () => void
  onNotify?: (type: ToastType, message: string) => void
  onSharesChanged?: () => void
}

const EXPIRY_OPTIONS: readonly { label: string; days: number | null }[] = [
  { label: '1 天', days: 1 },
  { label: '7 天', days: 7 },
  { label: '30 天', days: 30 },
  { label: '永久', days: null },
]

function statusBadgeClass(status: ShareStatus): string {
  switch (status) {
    case 'active':
      return 'st-badge st-badge-green'
    case 'expired':
      return 'st-badge st-badge-amber'
    case 'revoked':
      return 'st-badge st-badge-gray'
  }
}

function resolveTargetOption(
  targets: readonly ShareTargetOption[],
  initialTarget?: { targetType: ShareTargetType; targetId: string },
): ShareTargetOption | null {
  if (targets.length === 0) return null
  if (initialTarget) {
    const matched = targets.find(
      (t) => t.targetType === initialTarget.targetType && t.targetId === initialTarget.targetId,
    )
    if (matched) return matched
  }
  return targets[0]!
}

export function ShareModal({
  open,
  targets,
  initialTarget,
  onClose,
  onNotify,
  onSharesChanged,
}: ShareModalProps) {
  const [selectedKey, setSelectedKey] = useState('')
  const [expiresInDays, setExpiresInDays] = useState<number | null>(7)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [shares, setShares] = useState<ShareRecord[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [latestCreated, setLatestCreated] = useState<ShareRecord | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const requestSeqRef = useRef(0)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onNotifyRef = useRef(onNotify)
  onNotifyRef.current = onNotify

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  // 打开弹窗时重置为传入的初始目标与表单默认值
  useEffect(() => {
    if (!open) return
    const fallback = resolveTargetOption(targets, initialTarget)
    setSelectedKey(fallback ? `${fallback.targetType}:${fallback.targetId}` : '')
    setExpiresInDays(7)
    setPassword('')
    setShowPassword(false)
    setLatestCreated(null)
    setCopiedId(null)
    setListError(null)
  }, [open, initialTarget?.targetType, initialTarget?.targetId, targets])

  const selectedTarget = useMemo(() => {
    if (targets.length === 0) return null
    return (
      targets.find((t) => `${t.targetType}:${t.targetId}` === selectedKey) ??
      resolveTargetOption(targets, initialTarget)
    )
  }, [targets, selectedKey, initialTarget])

  const loadTargetShares = useCallback(async (target: ShareTargetOption | null) => {
    if (!target) {
      setShares([])
      return
    }
    const seq = ++requestSeqRef.current
    setLoadingList(true)
    setListError(null)
    try {
      const items = await listShares({
        targetType: target.targetType,
        targetId: target.targetId,
      })
      if (seq !== requestSeqRef.current) return
      setShares(items)
    } catch (error) {
      if (seq !== requestSeqRef.current) return
      if (error instanceof ApiError && error.status === 401) return
      setListError(error instanceof Error ? error.message : '加载分享链接列表失败')
    } finally {
      if (seq === requestSeqRef.current) {
        setLoadingList(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadTargetShares(selectedTarget)
  }, [open, selectedTarget, loadTargetShares])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating && !revokingId) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, creating, revokingId, onClose])

  if (!open || !selectedTarget) {
    return null
  }

  function markCopied(shareId: string) {
    setCopiedId(shareId)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 2000)
  }

  async function handleCopyShare(share: ShareRecord) {
    const url = buildShareFullUrl(share.token)
    const ok = await copyTextToClipboard(url)
    markCopied(share.id)
    if (ok) {
      onNotifyRef.current?.('success', '已复制完整分享链接')
    } else {
      onNotifyRef.current?.('info', `分享链接：${url}`)
    }
  }

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedTarget || creating) return
    setCreating(true)
    try {
      const trimmedPassword = password.trim()
      const created = await createShare({
        targetType: selectedTarget.targetType,
        targetId: selectedTarget.targetId,
        expiresInDays,
        ...(trimmedPassword !== '' ? { password: trimmedPassword } : {}),
      })
      setShares((prev) => [created, ...prev])
      setLatestCreated(created)
      setPassword('')
      const copied = await copyTextToClipboard(buildShareFullUrl(created.token))
      if (copied) {
        markCopied(created.id)
        onNotifyRef.current?.('success', '已创建并复制分享链接')
      } else {
        onNotifyRef.current?.('success', '分享链接已生成')
      }
      onSharesChanged?.()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return
      const msg = error instanceof Error ? error.message : '创建分享链接失败'
      onNotifyRef.current?.('error', msg)
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(share: ShareRecord) {
    if (revokingId) return
    setRevokingId(share.id)
    try {
      const updated = await revokeShare(share.id)
      setShares((prev) => prev.map((item) => (item.id === share.id ? updated : item)))
      setLatestCreated((prev) => (prev?.id === share.id ? updated : prev))
      onNotifyRef.current?.('success', '分享链接已立即失效')
      onSharesChanged?.()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return
      const msg = error instanceof Error ? error.message : '失效分享链接失败'
      onNotifyRef.current?.('error', msg)
    } finally {
      setRevokingId(null)
    }
  }

  const busy = creating || revokingId !== null
  const latestMatchesCurrent =
    latestCreated &&
    latestCreated.targetType === selectedTarget.targetType &&
    latestCreated.targetId === selectedTarget.targetId &&
    latestCreated.status === 'active'
  const activeCount = shares.filter((s) => s.status === 'active').length

  return (
    <div className="st-overlay" onClick={() => !busy && onClose()}>
      <div
        data-testid="share-modal"
        role="dialog"
        aria-modal="true"
        aria-label="对外一键分享"
        onClick={(e) => e.stopPropagation()}
        className="st-modal flex max-h-[85vh] max-w-[560px] flex-col"
      >
        {/* 弹窗头 */}
        <header className="st-modal-header">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Share2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="st-modal-title">对外一键分享</h2>
                <span className="st-badge st-badge-blue">
                  {SHARE_TARGET_LABELS[selectedTarget.targetType]}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                目标资源：{selectedTarget.targetName}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {selectedTarget.targetType === 'entry'
                  ? '访客免登录填报，历史内部数据严格隔离'
                  : '访客免登录只读交互，数据边界不超过创建者权限'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="关闭分享弹窗"
            className="st-icon-btn"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="st-modal-body st-scroll max-h-[70vh] space-y-5">
          {/* 多目标切换（当应用与视图同时可分享时） */}
          {targets.length > 1 && (
            <div>
              <div className="st-label">选择分享对象</div>
              <div role="radiogroup" aria-label="选择分享对象" className="grid grid-cols-2 gap-2">
                {targets.map((opt) => {
                  const key = `${opt.targetType}:${opt.targetId}`
                  const active =
                    opt.targetType === selectedTarget.targetType &&
                    opt.targetId === selectedTarget.targetId
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={busy}
                      onClick={() => setSelectedKey(key)}
                      className={`st-choice flex flex-col items-start gap-0.5 ${
                        active ? 'st-choice-active' : ''
                      }`}
                    >
                      <span className="w-full truncate text-sm font-medium text-slate-900">
                        {opt.targetName}
                      </span>
                      <span className="truncate text-xs text-slate-500">
                        {SHARE_TARGET_LABELS[opt.targetType]}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 新建分享链接表单 */}
          <form onSubmit={(e) => void handleCreateSubmit(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="st-label-sm">链接有效期</div>
                <div role="radiogroup" aria-label="分享有效期" className="st-segment w-full">
                  {EXPIRY_OPTIONS.map((opt) => {
                    const active = expiresInDays === opt.days
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={busy}
                        onClick={() => setExpiresInDays(opt.days)}
                        className={`st-segment-item px-2 ${active ? 'st-segment-item-active' : ''}`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="st-share-password" className="st-label-sm">
                  访问密码（可选）
                </label>
                <div className="relative">
                  <input
                    id="st-share-password"
                    type={showPassword ? 'text' : 'password'}
                    disabled={busy}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="留空则免密直接访问"
                    className="st-input pr-9"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    onClick={() => setShowPassword((v) => !v)}
                    className="st-icon-btn absolute right-1 top-1/2 -translate-y-1/2"
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="st-alert st-alert-slate">
              生成后即可一键复制完整 <code className="font-mono">/s/:token</code> 链接分发给访客
            </div>

            <div className="flex justify-end">
              <button type="submit" disabled={busy} className="st-btn st-btn-primary">
                <Plus className="h-4 w-4" />
                <span>{creating ? '生成中...' : '生成分享链接'}</span>
              </button>
            </div>
          </form>

          {/* 新建成功高亮条 */}
          {latestMatchesCurrent && latestCreated && (
            <div data-testid="share-created-banner" className="st-alert st-alert-green">
              <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-semibold">
                    新链接已生成
                    {latestCreated.hasPassword && (
                      <span className="st-badge st-badge-amber">
                        <Lock className="h-3 w-3" />
                        已设密码
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyShare(latestCreated)}
                    className="st-btn st-btn-xs st-btn-secondary shrink-0"
                  >
                    {copiedId === latestCreated.id ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{copiedId === latestCreated.id ? '已复制' : '复制完整链接'}</span>
                  </button>
                </div>
                <div
                  className="truncate font-mono text-slate-600"
                  title={buildShareFullUrl(latestCreated.token)}
                >
                  {buildShareFullUrl(latestCreated.token)}
                </div>
              </div>
            </div>
          )}

          {/* 当前资源关联分享链接列表 */}
          <section aria-label="当前资源分享链接" className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  当前资源关联链接（{shares.length}）
                </h3>
                {activeCount > 0 && (
                  <span className="st-badge st-badge-green">{activeCount} 条生效中</span>
                )}
              </div>
              <button
                type="button"
                disabled={loadingList || busy}
                onClick={() => void loadTargetShares(selectedTarget)}
                className="st-btn st-btn-xs st-btn-ghost"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingList ? 'animate-spin' : ''}`} />
                <span>刷新</span>
              </button>
            </div>

            {loadingList && shares.length === 0 ? (
              <div className="st-empty py-6">正在加载分享链接...</div>
            ) : listError ? (
              <div className="st-alert st-alert-red">{listError}</div>
            ) : shares.length === 0 ? (
              <div className="st-empty py-6">
                当前资源暂未生成对外分享链接，点击上方「生成分享链接」即可创建。
              </div>
            ) : (
              <ul className="space-y-2">
                {shares.map((share) => {
                  const isActive = share.status === 'active'
                  const fullUrl = buildShareFullUrl(share.token)
                  return (
                    <li
                      key={share.id}
                      data-testid={`modal-share-item-${share.id}`}
                      className="st-card p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className={statusBadgeClass(share.status)}>
                          {SHARE_STATUS_LABELS[share.status]}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600"
                          title={fullUrl}
                        >
                          /s/{share.token}
                        </span>
                        <span
                          className="max-w-28 shrink-0 truncate text-xs text-slate-400 tabular-nums"
                          title={`有效期至：${formatShareTimestamp(share.expiresAt)}`}
                        >
                          {formatShareTimestamp(share.expiresAt)}
                        </span>
                        {isActive && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <a
                              href={fullUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="st-btn st-btn-xs st-btn-secondary"
                            >
                              打开
                            </a>
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`复制分享链接 ${share.token}`}
                              onClick={() => void handleCopyShare(share)}
                              className="st-btn st-btn-xs st-btn-secondary"
                            >
                              {copiedId === share.id ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              <span>{copiedId === share.id ? '已复制' : '复制'}</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`立即失效 ${share.token}`}
                              onClick={() => void handleRevoke(share)}
                              className="st-btn st-btn-xs st-btn-danger-soft"
                            >
                              <span>{revokingId === share.id ? '处理中...' : '立即失效'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
