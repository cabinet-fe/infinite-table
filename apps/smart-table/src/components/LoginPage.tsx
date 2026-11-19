// 独立无侧栏登录页（/login）：支持账号密码提交、行内错误提示、回跳提示及内置演示账号快捷填入与一键登录。

import { useState } from 'react'
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
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

function roleChipStyle(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/80'
    case 'manager':
      return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200/80'
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
  }
}

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
    <div
      data-testid="login-page"
      className="flex min-h-screen w-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-100 p-4 text-slate-900"
    >
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xl md:grid-cols-[1.05fr_1fr]">
        {/* 左侧：品牌与账号密码表单 */}
        <section className="flex flex-col justify-between p-7 sm:p-9">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                <Table2 className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-base font-bold tracking-tight text-slate-900">
                  多维数据台 · DataDesk
                </h1>
                <p className="text-[11px] text-slate-500">多维智能表格与企业协作数据工作台</p>
              </div>
            </div>

            <div className="mt-7">
              <h2 className="text-lg font-semibold text-slate-900">登录工作台</h2>
              <p className="mt-1 text-xs text-slate-500">
                使用企业账号登录，或从右侧选择演示角色快捷体验两层权限隔离。
              </p>
              {redirectTo && redirectTo !== '/' && (
                <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-[11px] text-blue-700">
                  <KeyRound className="h-3 w-3 shrink-0" />
                  <span className="truncate">登录后将回跳至：{redirectTo}</span>
                </div>
              )}
            </div>

            <form onSubmit={(e) => void handleFormSubmit(e)} className="mt-6 space-y-4" noValidate>
              <div>
                <label
                  htmlFor="st-login-username"
                  className="mb-1.5 block text-xs font-medium text-slate-700"
                >
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
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 focus:outline-none disabled:bg-slate-50"
                  autoFocus
                />
              </div>

              <div>
                <label
                  htmlFor="st-login-password"
                  className="mb-1.5 block text-xs font-medium text-slate-700"
                >
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
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-9 pl-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 focus:outline-none disabled:bg-slate-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {displayError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                  <span>{displayError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>{busy ? '登录中...' : '登录'}</span>
              </button>
            </form>
          </div>

          <p className="mt-6 text-[11px] text-slate-400">
            会话通过 HttpOnly Cookie 持久化存储，登出后立即失效。
          </p>
        </section>

        {/* 右侧：内置演示账号快捷填入与一键切换登录 */}
        <section
          aria-label="演示账号快捷切换"
          className="border-t border-slate-200/80 bg-slate-50/80 p-7 sm:p-8 md:border-t-0 md:border-l"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <h3 className="text-xs font-semibold text-slate-800">演示账号快捷体验</h3>
            </div>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200/80">
              三种角色权限
            </span>
          </div>

          {loadingAccounts ? (
            <div className="py-10 text-center text-xs text-slate-400">正在加载演示账号列表...</div>
          ) : demoAccounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-center text-xs text-slate-400">
              暂无可用的内置演示账号，请使用上方账号密码登录。
            </div>
          ) : (
            <div className="space-y-2.5">
              {demoAccounts.map((acc) => (
                <div
                  key={acc.username}
                  data-demo-username={acc.username}
                  className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs transition-colors hover:border-blue-200"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-slate-900">
                          {acc.displayName}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${roleChipStyle(acc.role)}`}
                        >
                          {USER_ROLE_LABELS[acc.role]}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        账号 <code className="text-slate-600">{acc.username}</code> · 密码{' '}
                        <code className="text-slate-600">{acc.password}</code>
                      </div>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                    {acc.description}
                  </p>
                  <div className="mt-2.5 flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`填入 ${acc.displayName}`}
                      onClick={() => handleFillAccount(acc)}
                      className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      填入
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`一键登录 ${acc.displayName}`}
                      onClick={() => void handleQuickLogin(acc)}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200/80 hover:bg-blue-100 disabled:opacity-50"
                    >
                      <UserCheck className="h-3 w-3" />
                      <span>一键登录</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
