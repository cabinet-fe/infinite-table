// 最左窄图标导航轨：按当前用户角色与能力快照过滤一级业务入口（工作台/数据录入/数据源/分享管理/权限管理），
// 并在底部展示当前用户头像、角色身份与登出/快速切换账号入口。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Check,
  ClipboardList,
  Database,
  Layers,
  LogOut,
  Share2,
  ShieldCheck,
  Table2,
} from 'lucide-react'
import type { NavSection } from '../domain/router'
import {
  getVisibleNavSections,
  NAV_MENU_DEFINITIONS,
  USER_ROLE_LABELS,
} from '../domain/workspace-helpers'
import type { AuthUser, DemoAccountInfo, UserCapabilities, UserRole } from '../shared/schema'

export interface NavRailProps {
  user: AuthUser
  userCapabilities: UserCapabilities
  activeSection: NavSection | null
  demoAccounts?: readonly DemoAccountInfo[]
  busy?: boolean
  onNavigate: (section: NavSection) => void
  onLogout: () => Promise<void> | void
  onSwitchAccount?: (account: DemoAccountInfo) => Promise<void> | void
  onOpenLoginSwitch?: () => void
}

function renderSectionIcon(section: NavSection) {
  switch (section) {
    case 'apps':
      return <Layers className="h-4 w-4" />
    case 'entries':
      return <ClipboardList className="h-4 w-4" />
    case 'datasources':
      return <Database className="h-4 w-4" />
    case 'shares':
      return <Share2 className="h-4 w-4" />
    case 'permissions':
      return <ShieldCheck className="h-4 w-4" />
  }
}

function roleBadgeStyle(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/30'
    case 'manager':
      return 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/30'
    default:
      return 'bg-slate-700 text-slate-300'
  }
}

function roleBadgeLightStyle(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'bg-indigo-50 text-indigo-700'
    case 'manager':
      return 'bg-sky-50 text-sky-700'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

export function NavRail({
  user,
  userCapabilities,
  activeSection,
  demoAccounts = [],
  busy = false,
  onNavigate,
  onLogout,
  onSwitchAccount,
  onOpenLoginSwitch,
}: NavRailProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuContainerRef = useRef<HTMLDivElement | null>(null)

  const visibleSections = useMemo(
    () => getVisibleNavSections(user, userCapabilities),
    [user, userCapabilities],
  )
  const navItems = useMemo(
    () => NAV_MENU_DEFINITIONS.filter((item) => visibleSections.includes(item.id)),
    [visibleSections],
  )

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (menuContainerRef.current?.contains(event.target as Node | null)) return
      setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const avatarInitial = (user.displayName || user.username).trim().slice(0, 1).toUpperCase()
  const roleLabel = USER_ROLE_LABELS[user.role]

  return (
    <nav
      aria-label="主导航栏"
      className="relative z-30 flex h-full w-[74px] shrink-0 flex-col items-center justify-between border-r border-slate-800 bg-slate-900 px-1.5 py-3 text-slate-300 select-none"
    >
      {/* 顶部品牌徽章 + 一级业务入口 */}
      <div className="flex w-full flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => onNavigate('apps')}
          title="多维数据台（DataDesk）"
          aria-label="返回工作台首页"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm transition-transform hover:scale-105 hover:bg-blue-500"
        >
          <Table2 className="h-5 w-5" />
        </button>

        <div className="h-px w-8 bg-slate-800" aria-hidden="true" />

        <ul className="flex w-full flex-col items-center gap-1.5">
          {navItems.map((item) => {
            const active = activeSection === item.id
            return (
              <li key={item.id} className="w-full">
                <button
                  type="button"
                  disabled={busy}
                  title={item.description}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate(item.id)}
                  className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium transition-colors disabled:opacity-50 ${
                    active
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {renderSectionIcon(item.id)}
                  <span className="max-w-full truncate leading-tight">{item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* 底部用户信息、快速切换账号与登出 */}
      <div ref={menuContainerRef} className="relative flex w-full flex-col items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={`账号菜单：${user.displayName}（${roleLabel}）`}
          aria-expanded={menuOpen}
          title={`${user.displayName}（${roleLabel}）· 点击切换账号或登出`}
          className="flex w-full flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-colors hover:bg-slate-800 disabled:opacity-50"
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-xs ring-2 ring-slate-700"
            style={{ backgroundColor: user.avatarColor ?? '#4f46e5' }}
          >
            {avatarInitial}
          </span>
          <span className="max-w-full truncate text-[10px] font-medium text-slate-200">
            {user.displayName}
          </span>
          <span
            className={`rounded-full px-1.5 py-0.2 text-[9px] font-medium ${roleBadgeStyle(user.role)}`}
          >
            {roleLabel}
          </span>
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => void onLogout()}
          aria-label="退出登录"
          title="退出登录"
          className="flex w-full items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[10px] text-slate-400 transition-colors hover:bg-slate-800 hover:text-red-300 disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>登出</span>
        </button>

        {menuOpen && (
          <div
            role="dialog"
            aria-label="账号与角色切换"
            className="absolute bottom-2 left-full z-[950] ml-2 w-68 rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-2.5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: user.avatarColor ?? '#4f46e5' }}
              >
                {avatarInitial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-slate-900">
                    {user.displayName}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${roleBadgeLightStyle(user.role)}`}
                  >
                    {roleLabel}
                  </span>
                </div>
                <div className="truncate text-[11px] text-slate-400">@{user.username}</div>
              </div>
            </div>

            {demoAccounts.length > 0 && onSwitchAccount && (
              <div className="mt-2.5">
                <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <ArrowLeftRight className="h-3 w-3" />
                  <span>快速切换演示账号</span>
                </div>
                <div className="space-y-1">
                  {demoAccounts.map((acc) => {
                    const isCurrent = acc.username === user.username
                    return (
                      <button
                        key={acc.username}
                        type="button"
                        disabled={busy || isCurrent}
                        onClick={() => {
                          setMenuOpen(false)
                          void onSwitchAccount(acc)
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                          isCurrent
                            ? 'bg-blue-50 font-semibold text-blue-700'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{acc.displayName}</span>
                            <span
                              className={`rounded px-1.5 py-0.2 text-[10px] font-medium ${roleBadgeLightStyle(acc.role)}`}
                            >
                              {USER_ROLE_LABELS[acc.role]}
                            </span>
                          </div>
                          <div className="truncate text-[10px] text-slate-400">@{acc.username}</div>
                        </div>
                        {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="mt-2.5 flex flex-col gap-1 border-t border-slate-100 pt-2">
              {onOpenLoginSwitch && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenLoginSwitch()
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5 text-slate-400" />
                  <span>前往登录页切换账号</span>
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false)
                  void onLogout()
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>退出当前登录</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
