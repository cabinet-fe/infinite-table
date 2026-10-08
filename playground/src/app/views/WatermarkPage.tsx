// 文字水印：plugins 挂载，平铺文字绘制在 sky 层 overlay 预留位，锚定视口。
// 控制面板（开关/文本/五滑杆）为 shadcn 控件，改动经 handle.updateConfig 一帧内重绘即时生效。

import { useEffect, useRef, useState } from 'react'

import type { WatermarkTextConfig } from '@infinitable/plugins'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { mountWatermark, type WatermarkDemo } from '../../sections/watermark'

/** 单个滑杆的标称与值域（min/max/step 与引擎缺省值对齐） */
const SLIDER_SPECS = [
  { key: 'fontSize', label: '字号', min: 8, max: 32, step: 1, unit: 'px' },
  { key: 'rotate', label: '旋转角', min: -90, max: 90, step: 5, unit: '°' },
  { key: 'opacity', label: '透明度', min: 0.02, max: 1, step: 0.02, unit: '' },
  { key: 'gapX', label: '横向间距', min: 40, max: 400, step: 10, unit: 'px' },
  { key: 'gapY', label: '纵向间距', min: 30, max: 300, step: 10, unit: 'px' },
] as const

export function WatermarkPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [demo, setDemo] = useState<WatermarkDemo | null>(null)
  const [config, setConfig] = useState<WatermarkTextConfig | null>(null)

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    const mounted = mountWatermark(el)
    setDemo(mounted)
    setConfig(mounted.handle.getConfig())
  }, [])

  /** 参数改动即时生效：updateConfig 浅合并 + 一帧内重绘，随后回读完整配置刷面板 */
  const update = (patch: Partial<WatermarkTextConfig>): void => {
    if (!demo) return
    demo.handle.updateConfig(patch)
    setConfig(demo.handle.getConfig())
  }

  /** 滑杆取值吸附到步进（消除 0.02 步进的浮点尾差，如 0.14000000000000001） */
  const updateSlider = (spec: (typeof SLIDER_SPECS)[number], raw: number): void => {
    const stepped = Number((Math.round(raw / spec.step) * spec.step).toFixed(2))
    const patch: Partial<WatermarkTextConfig> = {}
    patch[spec.key] = stepped
    update(patch)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">文字水印</h2>
          <Badge variant="secondary">sky 层 overlay 预留位</Badge>
          <Badge variant="secondary">锚定视口</Badge>
          <Badge variant="secondary">参数即时生效</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          水印插件经构造 plugins 挂载：平铺文字绘制在四层 canvas 最上层的 overlay 预留位，
          覆盖在表格内容之上。滚动左侧表格观察水印锚定视口不随内容移动；右侧开关与滑杆改动经
          updateConfig 一帧内重绘即时生效。
        </p>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div ref={mountRef} className="demo-mount-area" />

        <div className="w-full rounded-xl border bg-card px-5 py-4 shadow-sm xl:w-[340px] xl:shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">水印参数</h3>
            <div className="flex items-center gap-2">
              <Switch
                id="watermark-enabled"
                checked={config?.enabled ?? true}
                onCheckedChange={(enabled) => update({ enabled })}
              />
              <Label htmlFor="watermark-enabled" className="text-xs text-muted-foreground">
                {config?.enabled ? '已启用' : '已关闭'}
              </Label>
            </div>
          </div>

          <div className="mt-4 grid gap-1.5">
            <Label htmlFor="watermark-text" className="text-xs text-muted-foreground">
              水印文本
            </Label>
            <Input
              id="watermark-text"
              value={config?.text ?? ''}
              onChange={(event) => update({ text: event.target.value })}
              placeholder="输入水印文本"
              className="h-8 text-[13px]"
            />
          </div>

          <Separator className="my-4" />

          <div className="grid gap-4">
            {SLIDER_SPECS.map((spec) => {
              const value = config?.[spec.key] ?? 0
              return (
                <div key={spec.key} className="grid gap-2">
                  <div className="flex items-baseline justify-between">
                    <Label className="text-xs text-muted-foreground">{spec.label}</Label>
                    <span className="font-mono text-xs text-foreground tabular-nums">
                      {value}
                      {spec.unit}
                    </span>
                  </div>
                  <Slider
                    value={[value]}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    onValueChange={(values) => updateSlider(spec, values[0] ?? spec.min)}
                    aria-label={spec.label}
                  />
                </div>
              )
            })}
          </div>

          {config && (
            <p className="mt-4 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-primary">
              水印{config.enabled ? '开' : '关'}：text「{config.text}」 fontSize {config.fontSize}
              &nbsp;rotate {config.rotate}° opacity {config.opacity} gap {config.gapX}×{config.gapY}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
