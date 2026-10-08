// 冒烟自检页：按钮触发子集冒烟（挂 dataForms/display/interaction/media/editing 五区到暂存区），
// 结果徽标 + 失败清单；行为对齐旧 SmokeView（结果取 window.__SMOKE__）。

import { LoaderCircle, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { mountDataForms } from '../../sections/data-forms'
import { mountDisplay } from '../../sections/display'
import { mountEditing } from '../../sections/editing'
import { mountInteraction } from '../../sections/interaction'
import { mountMedia } from '../../sections/media'
import { runSmoke, type SmokeResult } from '../../smoke'
import type { DemoHandles } from '../types'

export function SmokePage() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SmokeResult | null>(null)
  const stagingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 已跑过一次（如 ?smoke=1 落到本页前的全局模式）则直接呈现既有结果
    if (window.__SMOKE__) {
      setResult(window.__SMOKE__)
    }
  }, [])

  async function startSmoke(): Promise<void> {
    const staging = stagingRef.current
    if (running || !staging) return
    setRunning(true)
    setResult(null)
    staging.innerHTML = ''

    try {
      // 子集冒烟：只挂五区（对齐旧 SmokeView），未挂载区（chart/watermark/print/sheet/report）
      // 的检查项在 runSmoke 内逐项捕获记失败——既有行为，结果徽标会如实呈现
      const demos = {
        dataForms: mountDataForms(staging),
        display: mountDisplay(staging),
        interaction: mountInteraction(staging),
        media: mountMedia(staging),
        editing: mountEditing(staging),
      } as DemoHandles
      await runSmoke(demos)
      setResult(window.__SMOKE__ ?? null)
    } catch (err) {
      setResult({
        done: true,
        pass: false,
        total: 0,
        failures: [err instanceof Error ? err.message : String(err)],
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">自动化冒烟巡检 (Smoke Test)</h2>
          <Badge variant="secondary">端到端断言</Badge>
          <Badge variant="secondary">像素级校验</Badge>
          <Badge variant="secondary">事件仿真</Badge>
          <Badge variant="secondary">滚动/编辑闭环</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          内置冒烟自检套件：覆盖分层画布像素采样（冻结/合并/逐边边框/自定义渲染）、合成事件调度（拖选/Resize/键盘/触控）、图片
          LRU 与无闪回滚、编辑状态机及滚出提交等 20+ 项高要求断言。
        </p>
      </div>

      <div className="rounded-xl border bg-card px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={() => void startSmoke()} disabled={running}>
            {running ? <LoaderCircle className="animate-spin" /> : <Play />}
            {running ? '冒烟测试运行中…' : '立即执行冒烟自检'}
          </Button>
          {result && (
            <Badge
              variant="outline"
              className={
                result.pass
                  ? 'gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'gap-1.5 border-red-200 bg-red-50 text-red-700'
              }
            >
              <span
                className={`size-1.5 rounded-full bg-current ${result.pass ? '' : 'animate-pulse'}`}
              />
              {result.pass
                ? `全部通过 (${result.total}/${result.total})`
                : `发现异常 (${result.failures.length}/${result.total})`}
            </Badge>
          )}
        </div>

        {result && result.failures.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            <div className="mb-1.5 font-semibold">失败项清单：</div>
            <ul className="list-disc space-y-1 pl-5">
              {result.failures.map((failure, index) => (
                <li key={index}>{failure}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 冒烟执行时的测试挂载区（离屏暂存） */}
      <div ref={stagingRef} className="smoke-staging" />
    </div>
  )
}
