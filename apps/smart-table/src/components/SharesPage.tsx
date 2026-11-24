// 分享管理页（/shares）：集中展示与管理对外分享链接，支持按状态筛选、搜索、复制 /s/:token 链接与一键失效；
// 管理员管理全空间链接，负责人仅管理本人创建的链接，普通成员展示明确无权管理提示。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Ban,
  Check,
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
import { PageHeading } from './PageHeading'
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

function statusBadgeClass(status: ShareStatus): string {
  switch (status) {
    case 'active':
      return 'st-badge-green'
    case 'expired':
      return 'st-badge-amber'
    case 'revoked':
      return 'st-badge-gray'
  }
}

function targetTypeBadgeClass(targetType: ShareTargetType): string {
  switch (targetType) {
    case 'app':
      return 'st-badge-violet'
    case 'view':
      return 'st-badge-blue'
    case 'entry':
      return 'st-badge-green'
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
        <div className="st-card flex max-w-md flex-col items-center p-8 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">无权访问分享管理</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            {forbiddenMessage ??
              '普通成员无权创建或管理对外分享链接，请联系管理员或资源负责人生成并管理链接。'}
          </p>
          {onBackToWorkbench && (
            <button
              type="button"
              onClick={onBackToWorkbench}
              className="st-btn st-btn-secondary mt-5"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回工作台</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div data-testid="shares-page" className="st-page overflow-hidden bg-white text-slate-900">
      {/* 页头：标题、检索与刷新（返回工作台由常驻侧栏承担） */}
      <header className="st-page-header justify-between">
        <PageHeading
          icon={<Share2 className="h-4 w-4" />}
          title="分享管理"
          meta={
            currentUser.role === 'admin'
              ? '管理员 · 全空间分享链接'
              : '负责人 · 仅本人创建的分享链接'
          }
        />

        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              aria-label="搜索分享链接"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索资源名、创建人或 Token..."
              className="st-input w-72 pr-8 pl-8"
            />
            {searchQuery !== '' && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setSearchQuery('')}
                className="st-icon-btn st-icon-btn-xs absolute top-1/2 right-1 -translate-y-1/2"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="刷新"
            disabled={loading || revokingId !== null}
            onClick={() => void loadShares()}
            className="st-tool st-tool-icon"
          >
            <RefreshCw className={`h-4 w-4${loading ? ' animate-spin' : ''}`} />
            <span className="sr-only">刷新</span>
          </button>
        </div>
      </header>

      {/* 状态筛选条 */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-6">
        <div className="flex items-center gap-0.5" role="tablist" aria-label="分享状态筛选">
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
                className={`st-chip${active ? ' st-chip-active' : ''}`}
              >
                <span>{tab.label}</span>
                <span
                  className={`ml-1 tabular-nums ${active ? 'text-blue-500' : 'text-slate-400'}`}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>
        <span className="min-w-0 truncate text-xs text-slate-500">
          在多维数据台、视图或数据录入端点击「分享」即可创建新链接
        </span>
      </div>

      {/* 主列表区 */}
      <div className="st-page-body">
        {loading && shares.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-500">
            <div className="st-spinner" aria-hidden="true" />
            <div className="text-xs">正在加载分享链接...</div>
          </div>
        ) : loadError && shares.length === 0 ? (
          <div
            data-testid="shares-error"
            className="st-card mx-auto mt-12 flex max-w-md flex-col items-center p-8 text-center"
          >
            <Share2 className="mb-2.5 h-7 w-7 text-slate-400" />
            <div className="text-sm font-semibold text-slate-900">分享列表加载失败</div>
            <p className="mt-1 text-xs text-slate-500">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadShares()}
              className="st-btn st-btn-sm st-btn-primary mt-4"
            >
              重试加载
            </button>
          </div>
        ) : filteredShares.length === 0 ? (
          <div className="st-empty mx-auto max-w-lg py-10">
            <Share2 className="mx-auto mb-2.5 h-7 w-7 text-slate-300" />
            <div className="text-sm font-semibold text-slate-800">
              {shares.length === 0 ? '暂无对外分享链接' : '没有符合当前筛选条件的分享链接'}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {shares.length === 0
                ? '前往多维数据台应用、单视图或数据录入表点击分享按钮，即可生成免登录访问链接。'
                : '尝试切换上方状态标签或清空搜索关键词。'}
            </p>
          </div>
        ) : (
          <div className="st-card w-full max-w-[1120px] overflow-hidden">
            <table className="st-table">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="st-th">资源名称与链接</th>
                  <th className="st-th">分享类型</th>
                  <th className="st-th">创建人</th>
                  <th className="st-th">状态</th>
                  <th className="st-th">访问验证</th>
                  <th className="st-th">到期时间</th>
                  <th className="st-th text-right">操作</th>
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
                      className={`transition-colors hover:bg-slate-50${isActive ? '' : ' bg-slate-50/50'}`}
                    >
                      <td className="st-td h-auto min-w-[320px] py-2.5">
                        <div
                          className={`truncate font-medium ${isActive ? 'text-slate-900' : 'text-slate-500'}`}
                          title={share.targetName}
                        >
                          {share.targetName}
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          <span
                            className="min-w-0 truncate rounded bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-500"
                            title={sharePath}
                          >
                            {sharePath}
                          </span>
                          <button
                            type="button"
                            aria-label={`复制分享链接 ${share.targetName}`}
                            onClick={() => void handleCopy(share)}
                            className="st-icon-btn st-icon-btn-xs"
                          >
                            {copiedId === share.id ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="st-td whitespace-nowrap">
                        <span className={`st-badge ${targetTypeBadgeClass(share.targetType)}`}>
                          {SHARE_TARGET_LABELS[share.targetType]}
                        </span>
                      </td>
                      <td className="st-td whitespace-nowrap">{share.createdByName}</td>
                      <td className="st-td whitespace-nowrap">
                        <span className={`st-badge ${statusBadgeClass(share.status)}`}>
                          {SHARE_STATUS_LABELS[share.status]}
                        </span>
                      </td>
                      <td className="st-td whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          {share.hasPassword ? (
                            <>
                              <Lock className="h-3.5 w-3.5" />
                              <span>密码保护</span>
                              <span className="sr-only">已设密码</span>
                            </>
                          ) : (
                            <>
                              <Unlock className="h-3.5 w-3.5" />
                              <span>免密访问</span>
                            </>
                          )}
                        </span>
                      </td>
                      <td className="st-td whitespace-nowrap tabular-nums">
                        {formatShareTimestamp(share.expiresAt)}
                      </td>
                      <td className="st-td whitespace-nowrap text-right">
                        {isActive ? (
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              aria-label={`复制分享链接 ${share.targetName}`}
                              onClick={() => void handleCopy(share)}
                              className="st-btn st-btn-xs st-btn-ghost"
                            >
                              {copiedId === share.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              <span>{copiedId === share.id ? '已复制' : '复制链接'}</span>
                            </button>
                            <a
                              href={sharePath}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`打开分享页 ${share.targetName}`}
                              className="st-btn st-btn-xs st-btn-ghost"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>打开</span>
                            </a>
                            <button
                              type="button"
                              disabled={revokingId !== null}
                              aria-label={`失效分享链接 ${share.id}`}
                              onClick={() => void handleRevoke(share)}
                              className="st-btn st-btn-xs st-btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              <span>{revokingId === share.id ? '处理中...' : '立即失效'}</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">
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
