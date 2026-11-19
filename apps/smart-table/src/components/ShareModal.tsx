// 一键分享弹窗：支持对当前智能表格应用、单视图或普通数据录入表创建分享链接，
// 配置有效期与可选密码、一键复制 /s/:token 完整链接，并列出当前资源历史/有效链接支持立即失效。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Ban,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  Share2,
  X,
} from 'lucide-react'
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

function statusBadgeStyle(status: ShareStatus): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80'
    case 'expired':
      return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80'
    case 'revoked':
      return 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
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
    <div
      className="fixed inset-0 z-[1080] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[1px]"
      onClick={() => !busy && onClose()}
    >
      <div
        data-testid="share-modal"
        role="dialog"
        aria-modal="true"
        aria-label="对外一键分享"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* 弹窗头 */}
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Share2 className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold text-slate-900">对外一键分享</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {SHARE_TARGET_LABELS[selectedTarget.targetType]}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              目标资源：
              <strong className="font-medium text-slate-800">{selectedTarget.targetName}</strong>
              {selectedTarget.targetType === 'entry'
                ? '（访客免登录填报，历史内部数据严格隔离）'
                : '（访客免登录只读交互，数据边界不超过创建者权限）'}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="关闭分享弹窗"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 多目标切换（当应用与视图同时可分享时） */}
          {targets.length > 1 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-500">选择分享对象</div>
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
                      className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-50/70 text-blue-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-[10px] font-medium text-slate-500">
                        {SHARE_TARGET_LABELS[opt.targetType]}
                      </span>
                      <span className="mt-0.5 w-full truncate text-xs font-semibold">
                        {opt.targetName}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 新建分享链接表单 */}
          <form
            onSubmit={(e) => void handleCreateSubmit(e)}
            className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600">链接有效期</div>
                <div
                  role="radiogroup"
                  aria-label="分享有效期"
                  className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5"
                >
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
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          active
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="min-w-[200px] flex-1 space-y-1">
                <label
                  htmlFor="st-share-password"
                  className="block text-[11px] font-medium text-slate-600"
                >
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
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white pr-8 pl-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600"
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

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-[11px] text-slate-500">
                生成后即可一键复制完整 <code className="text-slate-700">/s/:token</code>{' '}
                链接分发给访客
              </span>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{creating ? '生成中...' : '生成分享链接'}</span>
              </button>
            </div>
          </form>

          {/* 新建成功高亮条 */}
          {latestMatchesCurrent && latestCreated && (
            <div
              data-testid="share-created-banner"
              className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                  <Link2 className="h-3.5 w-3.5" />
                  <span>新链接已生成</span>
                  {latestCreated.hasPassword && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
                      <Lock className="h-2.5 w-2.5" />
                      <span>已设密码</span>
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyShare(latestCreated)}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  {copiedId === latestCreated.id ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedId === latestCreated.id ? '已复制' : '复制完整链接'}</span>
                </button>
              </div>
              <div className="mt-1.5 truncate rounded-md border border-emerald-200/80 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-700">
                {buildShareFullUrl(latestCreated.token)}
              </div>
            </div>
          )}

          {/* 当前资源关联分享链接列表 */}
          <section aria-label="当前资源分享链接" className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-slate-800">
                  当前资源关联链接（{shares.length}）
                </h3>
                {activeCount > 0 && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    {activeCount} 条生效中
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={loadingList || busy}
                onClick={() => void loadTargetShares(selectedTarget)}
                className="inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${loadingList ? 'animate-spin' : ''}`} />
                <span>刷新</span>
              </button>
            </div>

            {loadingList && shares.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 py-6 text-center text-xs text-slate-400">
                正在加载分享链接...
              </div>
            ) : listError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700">
                {listError}
              </div>
            ) : shares.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-6 text-center text-xs text-slate-400">
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
                      className={`rounded-xl border p-3 transition-colors ${
                        isActive
                          ? 'border-slate-200 bg-white'
                          : 'border-slate-200/80 bg-slate-50/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeStyle(share.status)}`}
                            >
                              {SHARE_STATUS_LABELS[share.status]}
                            </span>
                            {share.hasPassword ? (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                <Lock className="h-2.5 w-2.5" />
                                <span>已设密码</span>
                              </span>
                            ) : (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                                免密访问
                              </span>
                            )}
                            <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-500">
                              <Clock className="h-3 w-3 text-slate-400" />
                              <span>{formatShareTimestamp(share.expiresAt)}</span>
                            </span>
                          </div>

                          <div
                            className="truncate font-mono text-[11px] text-slate-600"
                            title={fullUrl}
                          >
                            /s/{share.token}
                          </div>

                          <div className="text-[10px] text-slate-400">
                            创建人：{share.createdByName} · 创建于{' '}
                            {formatShareTimestamp(share.createdAt, '-')}
                          </div>
                        </div>

                        {isActive && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`复制分享链接 ${share.token}`}
                              onClick={() => void handleCopyShare(share)}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                            >
                              {copiedId === share.id ? (
                                <Check className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              <span>{copiedId === share.id ? '已复制' : '复制链接'}</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`立即失效 ${share.token}`}
                              onClick={() => void handleRevoke(share)}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
                            >
                              <Ban className="h-3 w-3" />
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
