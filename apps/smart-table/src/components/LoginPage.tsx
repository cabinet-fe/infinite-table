// 独立无侧栏登录页（/login）：左侧品牌区 + 右侧登录区。
// 支持账号密码提交、行内错误提示、回跳提示及内置演示账号快捷填入与一键登录。

import { useState } from 'react'
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  LayoutGrid,
  LogIn,
  ShieldCheck,
  Sparkles,
  Table2,
  UserCheck,
} from 'lucide-react'
import { USER_ROLE_LABELS } from '../domain/workspace-helpers'
import type { DemoAccountInfo, UserRole } from '../shared/schema'

export interface LoginPageProps {
  demoAccounts: readonly DemoAccountInfo[]
  loadingAccounts?: boolean
  busy?: boolean
  errorMessage?: string | null
  redirectTo?: string
  onSubmit: (username: string, password: string) => Promise<void>
}

function roleBadgeStyle(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'st-badge st-badge-violet'
    case 'manager':
      return 'st-badge st-badge-blue'
    default:
      return 'st-badge st-badge-gray'
  }
}

function roleAvatarTone(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'bg-indigo-500'
    case 'manager':
      return 'bg-blue-500'
    default:
      return 'bg-slate-400'
  }
}

const BRAND_FEATURES = [
  { icon: LayoutGrid, text: '表格、看板、透视、仪表盘四类视图' },
  { icon: Sparkles, text: '向导式 VLOOKUP 跨表关联与公式列' },
  { icon: ShieldCheck, text: '两层权限隔离与一键对外分享' },
] as const

export function LoginPage({
  demoAccounts,
  loadingAccounts = false,
  busy = false,
  errorMessage,
  redirectTo,
  onSubmit,
}: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const displayError = localError || errorMessage || null

  async function handleFormSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedUser = username.trim()
    if (!trimmedUser || !password) {
      setLocalError('请输入账号和密码')
      return
    }
    setLocalError(null)
    try {
      await onSubmit(trimmedUser, password)
    } catch {
      // 错误文本由上层传入 errorMessage 或统一 Toast 展示
    }
  }

  function handleFillAccount(acc: DemoAccountInfo) {
    setUsername(acc.username)
    setPassword(acc.password)
    setLocalError(null)
  }

  async function handleQuickLogin(acc: DemoAccountInfo) {
    setUsername(acc.username)
    setPassword(acc.password)
    setLocalError(null)
    try {
      await onSubmit(acc.username, acc.password)
    } catch {
      // 错误文本由上层传入 errorMessage
    }
  }

  return (
    <div data-testid="login-page" className="flex min-h-screen bg-white">
      {/* 品牌区：品牌蓝渐变 + 细网格底纹，窄屏隐藏 */}
      <aside className="relative hidden w-[46%] max-w-[680px] shrink-0 flex-col overflow-hidden bg-blue-700 p-12 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,#4d82ff_0%,#3370ff_38%,#1f4bcc_100%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.2),transparent_46%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage: 'linear-gradient(to bottom, transparent, black 30%, black 85%, transparent)',
          }}
        />

        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <Table2 className="h-5 w-5" />
          </span>
          <div className="text-lg leading-6 font-semibold">
            多维数据台 <span className="font-normal text-white/70">· DataDesk</span>
          </div>
        </div>

        <div className="relative mt-auto mb-auto">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">
            多维数据分析与
            <br />
            企业协作工作台
          </h2>
          <ul className="mt-10 space-y-4 text-sm">
            {BRAND_FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-white/90">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* 登录区 */}
      <main className="flex min-w-0 flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[400px]">
          {/* 品牌区隐藏时（窄屏）在表单上方补品牌名 */}
          <div className="mb-8 lg:hidden">
            <div className="text-lg leading-6 font-semibold text-slate-900">
              多维数据台 <span className="font-normal text-slate-500">· DataDesk</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">多维数据分析与企业协作工作台</p>
          </div>

          <h1 className="text-2xl leading-8 font-semibold tracking-tight text-slate-900">
            登录工作台
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            使用企业账号登录，或选择下方演示角色快速体验。
          </p>
          {redirectTo && redirectTo !== '/' && (
            <div className="st-alert st-alert-blue mt-4">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="truncate">登录后将回跳至：{redirectTo}</span>
            </div>
          )}

          <form onSubmit={(e) => void handleFormSubmit(e)} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="st-login-username" className="st-label">
                账号
              </label>
              <input
                id="st-login-username"
                type="text"
                autoComplete="username"
                disabled={busy}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  if (localError) setLocalError(null)
                }}
                placeholder="请输入账号，如 admin / manager / member"
                className="st-input st-input-lg"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="st-login-password" className="st-label">
                密码
              </label>
              <div className="relative">
                <input
                  id="st-login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  disabled={busy}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (localError) setLocalError(null)
                  }}
                  placeholder="请输入登录密码"
                  className="st-input st-input-lg pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  className="st-icon-btn absolute inset-y-0 right-1 my-auto"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {displayError && (
              <div role="alert" className="st-alert st-alert-red">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{displayError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="st-btn st-btn-primary st-btn-lg w-full"
            >
              <LogIn className="h-4 w-4" />
              <span>{busy ? '登录中...' : '登录'}</span>
            </button>
          </form>

          {/* 演示账号：紧凑行，填入 / 一键登录 */}
          <div className="st-divider my-5" />
          <section aria-label="演示账号快捷切换">
            <div className="mb-3 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              <h3 className="st-section-label">演示账号快捷体验</h3>
            </div>

            {loadingAccounts ? (
              <div className="py-10 text-center text-sm text-slate-500">
                正在加载演示账号列表...
              </div>
            ) : demoAccounts.length === 0 ? (
              <div className="st-empty">暂无可用的内置演示账号，请使用上方账号密码登录。</div>
            ) : (
              <ul className="space-y-1">
                {demoAccounts.map((acc) => (
                  <li
                    key={acc.username}
                    data-demo-username={acc.username}
                    className="rounded-xl border border-slate-200 px-3 py-2 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={`st-avatar h-8 w-8 text-xs ${roleAvatarTone(acc.role)}`}>
                        {acc.displayName.slice(0, 1)}
                      </span>
                      <span className="truncate text-sm font-medium text-slate-900">
                        {acc.displayName}
                      </span>
                      <span className={roleBadgeStyle(acc.role)}>{USER_ROLE_LABELS[acc.role]}</span>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`填入 ${acc.displayName}`}
                          title="把账号密码填入上方表单"
                          onClick={() => handleFillAccount(acc)}
                          className="st-btn st-btn-xs st-btn-ghost"
                        >
                          填入
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`一键登录 ${acc.displayName}`}
                          onClick={() => void handleQuickLogin(acc)}
                          className="st-btn st-btn-xs st-btn-soft"
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>一键登录</span>
                        </button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex min-w-0 items-center gap-2 pl-[42px] text-xs text-slate-500">
                      <span className="shrink-0 font-mono">
                        {acc.username} / {acc.password}
                      </span>
                      <span className="truncate" title={acc.description}>
                        {acc.description}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
