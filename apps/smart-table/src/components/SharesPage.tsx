// 分享管理页（/shares）：集中展示与管理对外分享链接，支持按状态筛选、搜索、复制 /s/:token 链接与一键失效；
// 管理员管理全空间链接，负责人仅管理本人创建的链接，普通成员展示明确无权管理提示。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Ban,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Lock,
  RefreshCw,
  Search,
  Share2,
  Unlock,
  X,
} from 'lucide-react'
import { ApiError, listShares, revokeShare } from '../api'
import { buildRoutePath } from '../domain/router'
import {
  buildShareFullUrl,
  copyTextToClipboard,
  formatShareTimestamp,
  SHARE_STATUS_LABELS,
  SHARE_TARGET_LABELS,
} from '../domain/workspace-helpers'
import type {
  AuthUser,
  ShareRecord,
  ShareStatus,
  ShareTargetType,
  UserCapabilities,
} from '../shared/schema'
import type { ToastType } from './Toast'

export interface SharesPageProps {
  currentUser: AuthUser
  userCapabilities: UserCapabilities
  onBackToWorkbench?: () => void
  onNotify?: (type: ToastType, message: string) => void
}

type StatusFilter = 'all' | ShareStatus

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

function targetTypeBadgeStyle(targetType: ShareTargetType): string {
  switch (targetType) {
    case 'app':
      return 'bg-blue-50 text-blue-700'
    case 'view':
      return 'bg-violet-50 text-violet-700'
    case 'entry':
      return 'bg-emerald-50 text-emerald-700'
  }
}

export function SharesPage({
  currentUser,
  userCapabilities,
  onBackToWorkbench,
  onNotify,
}: SharesPageProps) {
  const isAuthorizedRole = currentUser.role !== 'member' && userCapabilities.canManageShares

  const [shares, setShares] = useState<ShareRecord[]>([])
  const [loading, setLoading] = useState(isAuthorizedRole)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [forbiddenMessage, setForbiddenMessage] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const requestSeqRef = useRef(0)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onNotifyRef = useRef(onNotify)
  onNotifyRef.current = onNotify

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const loadShares = useCallback(async () => {
    if (!isAuthorizedRole) return
    const seq = ++requestSeqRef.current
    setLoading(true)
    setLoadError(null)
    setForbiddenMessage(null)
    try {
      const list = await listShares()
      if (seq !== requestSeqRef.current) return
      setShares(list)
    } catch (error) {
      if (seq !== requestSeqRef.current) return
      if (error instanceof ApiError && error.status === 401) return
      if (error instanceof ApiError && error.status === 403) {
        setForbiddenMessage(error.message)
        return
      }
      setLoadError(error instanceof Error ? error.message : '加载分享列表失败')
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false)
      }
    }
  }, [isAuthorizedRole])

  useEffect(() => {
    setShares([])
    setLoadError(null)
    setForbiddenMessage(null)
    setStatusFilter('all')
    setSearchQuery('')
    if (!isAuthorizedRole) {
      setLoading(false)
      return
    }
    void loadShares()
  }, [currentUser.id, isAuthorizedRole, loadShares])

  const counts = useMemo(() => {
    let active = 0
    let revoked = 0
    let expired = 0
    for (const share of shares) {
      if (share.status === 'active') active += 1
      else if (share.status === 'revoked') revoked += 1
      else expired += 1
    }
    return { all: shares.length, active, revoked, expired }
  }, [shares])

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredShares = useMemo(() => {
    return shares.filter((share) => {
      if (statusFilter !== 'all' && share.status !== statusFilter) {
        return false
      }
      if (!normalizedQuery) return true
      return (
        share.targetName.toLowerCase().includes(normalizedQuery) ||
        share.createdByName.toLowerCase().includes(normalizedQuery) ||
        share.token.toLowerCase().includes(normalizedQuery) ||
        SHARE_TARGET_LABELS[share.targetType].toLowerCase().includes(normalizedQuery)
      )
    })
  }, [shares, statusFilter, normalizedQuery])

  async function handleCopy(share: ShareRecord) {
    const url = buildShareFullUrl(share.token)
    const ok = await copyTextToClipboard(url)
    setCopiedId(share.id)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 2000)
    if (ok) {
      onNotifyRef.current?.('success', '已复制分享链接')
    } else {
      onNotifyRef.current?.('info', `分享链接：${url}`)
    }
  }

  async function handleRevoke(share: ShareRecord) {
    if (revokingId) return
    setRevokingId(share.id)
    try {
      const updated = await revokeShare(share.id)
      setShares((prev) => prev.map((item) => (item.id === share.id ? updated : item)))
      onNotifyRef.current?.('success', `已失效「${share.targetName}」的分享链接`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return
      const msg = error instanceof Error ? error.message : '失效分享链接失败'
      onNotifyRef.current?.('error', msg)
    } finally {
      setRevokingId(null)
    }
  }

  if (!isAuthorizedRole || forbiddenMessage) {
    return (
      <div
        data-testid="shares-forbidden"
        className="flex h-full w-full flex-col items-center justify-center bg-slate-50 p-6"
      >
        <div className="flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900">无权访问分享管理</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            {forbiddenMessage ??
              '普通成员无权创建或管理对外分享链接，请联系管理员或资源负责人生成并管理链接。'}
          </p>
          {onBackToWorkbench && (
            <button
              type="button"
              onClick={onBackToWorkbench}
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>返回工作台</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="shares-page"
      className="flex h-full w-full flex-col overflow-hidden bg-slate-50 text-slate-900"
    >
      {/* 顶部标题与搜索 */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {onBackToWorkbench && (
            <button
              type="button"
              onClick={onBackToWorkbench}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>工作台</span>
            </button>
          )}
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Share2 className="h-4 w-4" />
          </span>
          <h1 className="truncate text-sm font-semibold text-slate-900">分享管理</h1>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              currentUser.role === 'admin'
                ? 'bg-indigo-50 text-indigo-700'
                : 'bg-sky-50 text-sky-700'
            }`}
          >
            {currentUser.role === 'admin'
              ? '管理员 · 全空间分享链接'
              : '负责人 · 仅本人创建的分享链接'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              aria-label="搜索分享链接"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索资源名、创建人或 Token..."
              className="h-7 w-56 rounded-md border border-slate-200 bg-slate-50/70 pr-7 pl-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
            {searchQuery !== '' && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setSearchQuery('')}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={loading || revokingId !== null}
            onClick={() => void loadShares()}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
        </div>
      </header>

      {/* 状态过滤 Tab 条 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/80 px-5 py-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label="分享状态筛选"
        >
          {(
            [
              { id: 'all', label: '全部链接', count: counts.all },
              { id: 'active', label: '生效中', count: counts.active },
              { id: 'revoked', label: '已失效', count: counts.revoked },
              { id: 'expired', label: '已过期', count: counts.expired },
            ] as const
          ).map((tab) => {
            const active = statusFilter === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatusFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                    active ? 'bg-white/20 text-white' : 'bg-white text-slate-500'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        <span className="text-[11px] text-slate-500">
          可在智能表格、视图或数据录入端点击「分享」创建新链接，此处统一管理生命周期
        </span>
      </div>

      {/* 主列表区 */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {loading && shares.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-500">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
              aria-hidden="true"
            />
            <div className="text-xs">正在加载分享链接...</div>
          </div>
        ) : loadError && shares.length === 0 ? (
          <div
            data-testid="shares-error"
            className="mx-auto mt-12 flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"
          >
            <Share2 className="mb-2.5 h-7 w-7 text-slate-400" />
            <div className="text-sm font-semibold text-slate-900">分享列表加载失败</div>
            <p className="mt-1 text-xs text-slate-500">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadShares()}
              className="mt-4 inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              重试加载
            </button>
          </div>
        ) : filteredShares.length === 0 ? (
          <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
            <Share2 className="mx-auto mb-2.5 h-7 w-7 text-slate-300" />
            <div className="text-sm font-semibold text-slate-800">
              {shares.length === 0 ? '暂无对外分享链接' : '没有符合当前筛选条件的分享链接'}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {shares.length === 0
                ? '前往智能表格应用、单视图或数据录入表点击分享按钮，即可生成免登录访问链接。'
                : '尝试切换上方状态标签或清空搜索关键词。'}
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-500">
                  <th className="px-4 py-2.5">资源名称与链接</th>
                  <th className="px-3 py-2.5">分享类型</th>
                  <th className="px-3 py-2.5">创建人</th>
                  <th className="px-3 py-2.5">状态</th>
                  <th className="px-3 py-2.5">访问验证</th>
                  <th className="px-3 py-2.5">到期时间</th>
                  <th className="px-4 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredShares.map((share) => {
                  const isActive = share.status === 'active'
                  const sharePath = buildRoutePath({ kind: 'share', token: share.token })
                  return (
                    <tr
                      key={share.id}
                      data-testid={`share-row-${share.id}`}
                      className={
                        isActive ? 'hover:bg-slate-50/70' : 'bg-slate-50/40 text-slate-500'
                      }
                    >
                      <td className="max-w-xs px-4 py-3">
                        <div
                          className="truncate font-semibold text-slate-900"
                          title={share.targetName}
                        >
                          {share.targetName}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                          {sharePath}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${targetTypeBadgeStyle(share.targetType)}`}
                        >
                          {SHARE_TARGET_LABELS[share.targetType]}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-700">
                        {share.createdByName}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeStyle(share.status)}`}
                        >
                          {SHARE_STATUS_LABELS[share.status]}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {share.hasPassword ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            <Lock className="h-2.5 w-2.5" />
                            <span>已设密码</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                            <Unlock className="h-2.5 w-2.5" />
                            <span>免密访问</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3 text-slate-400" />
                          <span>{formatShareTimestamp(share.expiresAt)}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isActive ? (
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              aria-label={`复制分享链接 ${share.targetName}`}
                              onClick={() => void handleCopy(share)}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              {copiedId === share.id ? (
                                <Check className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              <span>{copiedId === share.id ? '已复制' : '复制链接'}</span>
                            </button>
                            <a
                              href={sharePath}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`打开分享页 ${share.targetName}`}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <ExternalLink className="h-3 w-3" />
                              <span>打开</span>
                            </a>
                            <button
                              type="button"
                              disabled={revokingId !== null}
                              aria-label={`失效分享链接 ${share.id}`}
                              onClick={() => void handleRevoke(share)}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
                            >
                              <Ban className="h-3 w-3" />
                              <span>{revokingId === share.id ? '处理中...' : '立即失效'}</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {share.status === 'revoked' && share.revokedAt
                              ? `失效于 ${formatShareTimestamp(share.revokedAt, '')}`
                              : '不可访问'}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
