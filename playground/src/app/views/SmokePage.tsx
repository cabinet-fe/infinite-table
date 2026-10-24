// 冒烟自检页：按钮触发全量冒烟（与 ?smoke=1 共用 demo-suite 单一事实源，全量演示区
// 挂离屏暂存区——canvas 照常绘制供像素断言），结果徽标 + 失败清单；结果取 window.__SMOKE__。
// 历史子集挂载（只挂五区）在 runSmoke 检查面扩张后漏区崩溃，已收敛为全量装配。

import { LoaderCircle, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { setSmokeDprLocked } from '../../mount'
import { installErrorSink, resetCollectedErrors, runSmoke, type SmokeResult } from '../../smoke'
import { mountDemoSuite } from '../demo-suite'

export function SmokePage() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SmokeResult | null>(null)
  const stagingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 已有结果（如自动化冒烟先行落窗）则直接呈现
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

    // 冒烟确定性对齐 ?smoke=1（均在挂载/断言前生效）：错误采集（收尾「无控制台错误」
    // 断言，重复运行先清册）+ dpr 锁 1（像素断言坐标 1:1，引擎构造期读取）+
    // 经典滚动条宽度（gutter 断言；global.css 的 .smoke-classic-scrollbars）
    installErrorSink()
    resetCollectedErrors()
    setSmokeDprLocked(true)
    document.documentElement.classList.add('smoke-classic-scrollbars')

    try {
      await runSmoke(mountDemoSuite(staging))
      setResult(window.__SMOKE__ ?? null)
    } catch (err) {
      setResult({
        done: true,
        pass: false,
        total: 0,
        failures: [err instanceof Error ? err.message : String(err)],
      })
    } finally {
      setSmokeDprLocked(false)
      document.documentElement.classList.remove('smoke-classic-scrollbars')
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
          LRU 与无闪回滚、编辑状态机及滚出提交、原生滚动条档与透视表引擎等 60+ 项高要求断言。
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

      {/* 冒烟执行时的测试挂载区（离屏暂存，canvas 仍正常绘制供像素断言） */}
      <div
        ref={stagingRef}
        className="pointer-events-none absolute -top-[9999px] -left-[9999px] opacity-0"
      />
    </div>
  )
}
