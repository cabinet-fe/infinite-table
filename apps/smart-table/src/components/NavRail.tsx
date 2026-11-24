// 统一侧栏：品牌位 → 一级导航（按当前用户角色与能力快照过滤：工作台/数据录入/数据源/分享管理/权限管理）
// → 当前板块子目录（children 插槽，嵌在一级导航下方）→ 账户区（切换演示账号 / 前往登录页 / 退出登录）。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Check,
  ChevronsUpDown,
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
  /** 当前板块的子目录列表（Sidebar），渲染在一级导航与账户区之间 */
  children?: React.ReactNode
  onNavigate: (section: NavSection) => void
  onLogout: () => Promise<void> | void
  onSwitchAccount?: (account: DemoAccountInfo) => Promise<void> | void
  onOpenLoginSwitch?: () => void
}

function renderSectionIcon(section: NavSection) {
  switch (section) {
    case 'apps':
      return <Layers className="h-[18px] w-[18px]" />
    case 'entries':
      return <ClipboardList className="h-[18px] w-[18px]" />
    case 'datasources':
      return <Database className="h-[18px] w-[18px]" />
    case 'shares':
      return <Share2 className="h-[18px] w-[18px]" />
    case 'permissions':
      return <ShieldCheck className="h-[18px] w-[18px]" />
  }
}

function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'st-badge st-badge-violet'
    case 'manager':
      return 'st-badge st-badge-blue'
    default:
      return 'st-badge st-badge-gray'
  }
}

export function NavRail({
  user,
  userCapabilities,
  activeSection,
  demoAccounts = [],
  busy = false,
  children,
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
  const avatarColor = user.avatarColor ?? '#3370ff'

  return (
    <aside className="st-side">
      {/* 品牌位 */}
      <button
        type="button"
        onClick={() => onNavigate('apps')}
        title="多维数据台（DataDesk）"
        aria-label="返回工作台首页"
        className="flex h-12 w-full shrink-0 items-center gap-2.5 px-4 text-left"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-blue-600 text-white">
          <Table2 className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold text-slate-900">多维数据台</span>
        <span className="text-xs text-slate-400">DataDesk</span>
      </button>

      {/* 一级业务入口 */}
      <nav aria-label="主导航栏" className="shrink-0 px-2 pt-1">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const active = activeSection === item.id
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={busy}
                  title={item.description}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate(item.id)}
                  className={`st-nav-item ${active ? 'st-nav-item-active' : ''}`}
                >
                  {renderSectionIcon(item.id)}
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* 当前板块子目录 */}
      <div className="st-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>

      {/* 账户区：显示名 / 角色直接可见，菜单内切换演示账号 */}
      <div ref={menuContainerRef} className="relative shrink-0 p-2">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`账号菜单：${user.displayName}（${roleLabel}）`}
            aria-expanded={menuOpen}
            title={`${user.displayName}（${roleLabel}）· 点击切换账号或登出`}
            className="flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-slate-200/60 disabled:opacity-50"
          >
            <span className="st-avatar h-7 w-7 text-xs" style={{ backgroundColor: avatarColor }}>
              {avatarInitial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm leading-5 font-medium text-slate-900">
                {user.displayName}
              </span>
              <span className="block truncate text-xs leading-4 text-slate-500">
                {roleLabel} · @{user.username}
              </span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void onLogout()}
            aria-label="退出登录"
            title="退出登录"
            className="st-icon-btn"
          >
            <LogOut className="h-4 w-4" />
            <span className="sr-only">退出登录</span>
          </button>
        </div>

        {menuOpen && (
          <div
            role="dialog"
            aria-label="账号与角色切换"
            className="st-popover absolute bottom-full left-2 z-[950] mb-2 w-64"
          >
            <div className="mb-1 flex items-center gap-2.5 border-b border-slate-100 px-1.5 pb-2.5 pt-1.5">
              <span className="st-avatar h-9 w-9 text-sm" style={{ backgroundColor: avatarColor }}>
                {avatarInitial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {user.displayName}
                  </span>
                  <span className={`shrink-0 ${roleBadgeClass(user.role)}`}>{roleLabel}</span>
                </div>
                <div className="truncate text-xs text-slate-500">@{user.username}</div>
              </div>
            </div>

            {demoAccounts.length > 0 && onSwitchAccount && (
              <div>
                <div className="mb-1 flex items-center gap-1 px-2">
                  <ArrowLeftRight className="h-3 w-3" />
                  <span className="st-section-label">快速切换演示账号</span>
                </div>
                <div className="space-y-0.5">
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
                        className={`st-menu-item h-auto py-1.5 ${isCurrent ? 'st-menu-item-active' : ''}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{acc.displayName}</span>
                            <span className={`shrink-0 ${roleBadgeClass(acc.role)}`}>
                              {USER_ROLE_LABELS[acc.role]}
                            </span>
                          </div>
                          <div className="truncate text-xs text-slate-500">@{acc.username}</div>
                        </div>
                        {isCurrent && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="st-divider my-1" />
            {onOpenLoginSwitch && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false)
                  onOpenLoginSwitch()
                }}
                className="st-menu-item"
              >
                <ArrowLeftRight className="h-4 w-4 shrink-0 text-slate-400" />
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
              className="st-menu-item st-menu-item-danger"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span>退出当前登录</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
