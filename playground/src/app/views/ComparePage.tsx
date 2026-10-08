// vs VTable 对比页：按钮触发在当前页面跑同口径对比（数据/视口/跑序与 scripts/vs.mjs 完全一致），
// 进度卡实时展示当前「规模 × 库 × 场景」，跑完渲染自包含报告（renderReportHtml）注入 #vs-report 并滚动定位。
// 对比引擎与 @visactor/vtable 全部经动态 import 独立分包：不进 index 主入口 chunk，
// 只在点击运行或 ?vsrun=1 自动开跑时才加载。

import { CircleCheck, LoaderCircle, MonitorPlay, Play, RotateCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { VsProgress } from '../../bench/vs/scenarios'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

declare global {
  interface Window {
    /** 对比报告（scripts/vs.mjs 轮询提取的自动化契约句柄） */
    __VS_REPORT__?: unknown
  }
}

/** 对比视口固定尺寸（两库测量口径；页内按容器宽等比缩放展示） */
const STAGE_WIDTH = 1280
const STAGE_HEIGHT = 720

/** 跑批起点展示（真实进度由 runComparison 回调驱动） */
const INITIAL_PROGRESS: VsProgress = {
  percent: 0,
  scale: 100_000,
  library: '',
  scenario: '准备数据',
}

export function ComparePage() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<VsProgress | null>(null)
  const [reportHtml, setReportHtml] = useState('')
  const [errorText, setErrorText] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)

  const stageRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  /** ref 版运行标记：挡住 ?vsrun=1 自动开跑与按钮点击的双触发 */
  const runningRef = useRef(false)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }, [])

  /** 1280×720 对比视口按容器宽等比缩放（transform 不影响布局尺寸，两库测量口径不变） */
  const applyStageScale = useCallback(() => {
    const stage = stageRef.current
    const host = hostRef.current
    if (!stage || !host) return
    const scale = Math.min(1, stage.clientWidth / STAGE_WIDTH)
    host.style.transform = `scale(${scale})`
    host.style.transformOrigin = '0 0'
    stage.style.height = `${Math.round(STAGE_HEIGHT * scale)}px`
  }, [])

  const run = useCallback(async (): Promise<void> => {
    const host = hostRef.current
    if (runningRef.current || !host) return
    runningRef.current = true
    setRunning(true)
    setErrorText('')
    setReportHtml('')
    setProgress(INITIAL_PROGRESS)
    const t0 = performance.now()
    setElapsedMs(0)
    elapsedTimerRef.current = setInterval(() => {
      setElapsedMs(performance.now() - t0)
    }, 200)
    try {
      const [
        { oursLibrary, vtableLibrary },
        { runComparison },
        { buildComparisonReport, renderReportHtml },
      ] = await Promise.all([
        import('../../bench/vs/adapters'),
        import('../../bench/vs/scenarios'),
        import('../../bench/vs/report'),
      ])
      const runResult = await runComparison(host, [oursLibrary, vtableLibrary], setProgress)
      const report = buildComparisonReport(runResult)
      window.__VS_REPORT__ = report
      setReportHtml(renderReportHtml(report))
    } catch (error) {
      setErrorText(error instanceof Error ? (error.stack ?? error.message) : String(error))
    } finally {
      runningRef.current = false
      setRunning(false)
      stopElapsedTimer()
      setElapsedMs(performance.now() - t0)
    }
  }, [stopElapsedTimer])

  // 挂载即定标并监听容器尺寸；?vsrun=1 自动开跑（scripts/vs.mjs 提取 __VS_REPORT__ 与 #vs-report）
  useEffect(() => {
    applyStageScale()
    const observer = new ResizeObserver(applyStageScale)
    if (stageRef.current) {
      observer.observe(stageRef.current)
    }
    if (new URLSearchParams(location.search).has('vsrun')) {
      void run()
    }
    return () => {
      observer.disconnect()
      stopElapsedTimer()
    }
  }, [applyStageScale, run, stopElapsedTimer])

  // 报告就位后平滑滚动定位
  useEffect(() => {
    if (reportHtml) {
      reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [reportHtml])

  const progressLabel = progress
    ? [
        progress.scale >= 10_000 ? `${progress.scale / 10_000} 万行` : `${progress.scale} 行`,
        progress.library,
        progress.scenario,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">
            性能对比：infinitable vs @visactor/vtable
          </h2>
          <Badge variant="secondary">同数据同口径</Badge>
          <Badge variant="secondary">10 万 / 100 万行 × 20 列</Badge>
          <Badge variant="secondary">对称跑序取均值</Badge>
          <Badge variant="secondary">页内真实渲染</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          同一份 10 万 / 100 万行 × 20 列数据、同视口 1280×720，在两库各跑一遍：TTFF / 构造 /
          稳态滚动 FPS 与 JS 耗时 / 大幅跳转 / 逐格写吞吐 / 批量写 / 整表重建。每规模按
          [infinitable, VTable, VTable, infinitable] 对称跑序取均值，抗 JIT 与顺序偏差。全程约 2~4
          分钟，期间下方视口可实时看到两库交替渲染与滚动。
        </p>
      </div>

      {/* 运行控制 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-5 py-4 shadow-sm">
        <Button size="lg" disabled={running} onClick={() => void run()}>
          {running ? (
            <LoaderCircle className="animate-spin" />
          ) : reportHtml ? (
            <RotateCw />
          ) : (
            <Play />
          )}
          {running ? '对比运行中…' : reportHtml ? '再次运行' : '运行对比'}
        </Button>
        {!running && !reportHtml && !errorText && (
          <span className="text-[13px] text-muted-foreground">
            点击按钮开始，两库将交替在下方视口内渲染百万行数据
          </span>
        )}
        {!running && reportHtml && (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
            <CircleCheck className="size-4" />
            对比完成（耗时 {(elapsedMs / 1000).toFixed(0)}s），可再次运行复测
          </span>
        )}
      </div>

      {/* 进度卡：当前「规模 × 库 × 场景」+ 百分比 + 累计耗时 */}
      {(running || progress) && (
        <div className="rounded-xl border bg-card px-5 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            {running ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
            ) : (
              <CircleCheck className="size-4 shrink-0 text-emerald-600" />
            )}
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium tabular-nums">
              {progressLabel || '准备数据'}
            </span>
            <Badge variant="secondary" className="tabular-nums">
              {progress?.percent ?? 0}%
            </Badge>
            <span className="w-14 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
              {(elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
          <Progress value={progress?.percent ?? 0} className="mt-3" />
          <p className="mt-2.5 text-xs text-muted-foreground">
            2 个数据规模 × 4 轮对称跑序（infinitable → VTable → VTable → infinitable）× 6 组场景
          </p>
        </div>
      )}

      {/* 对比视口：报告就位后让位（host 常驻 DOM，复跑无需重挂） */}
      <div className={cn('rounded-xl border bg-card p-3 shadow-sm', reportHtml && 'hidden')}>
        <div
          ref={stageRef}
          className="relative h-[405px] overflow-hidden rounded-lg"
          style={{
            backgroundImage: 'repeating-conic-gradient(#f2f3f8 0% 25%, #ffffff 0% 50%)',
            backgroundSize: '20px 20px',
          }}
        >
          <div ref={hostRef} className="absolute top-0 left-0 h-[720px] w-[1280px]" />
          {!running && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px] text-muted-foreground">
              <MonitorPlay className="size-8 opacity-40" />
              <p>对比运行时，两库的表格将在此视口内交替渲染</p>
              <p className="text-xs text-muted-foreground/70">
                视口 1280×720 · 按容器宽等比缩放展示，测量口径不变
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 错误面板：完整 stack */}
      {errorText && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <TriangleAlert className="size-4" />
            对比运行失败
          </div>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-white/70 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {errorText}
          </pre>
        </div>
      )}

      {/* 对比报告（scripts/vs.mjs 读取 #vs-report innerHTML 落静态档案） */}
      {reportHtml && (
        <div id="vs-report" ref={reportRef} dangerouslySetInnerHTML={{ __html: reportHtml }} />
      )}
    </div>
  )
}
