// 图片与浮动对象：L2 Media 分层、位图 LRU 缓存、无闪回滚、浮动对象帧级跟随。
// 演示控件（浮动对象开关、图片加载/浮动变换状态行）为 shadcn 组件，经 MediaDemo 句柄驱动引擎。

import { Image as ImageIcon, ImageMinus, ImagePlus, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { mountMedia, type MediaDemo } from '../../sections/media'
import { SectionPage } from '../SectionPage'

/** 演示控制面板：浮动对象移除/重建开关 + 图片加载与浮动变换状态行（订阅引擎事件实时刷新） */
function MediaControls({ demo }: { demo: MediaDemo }) {
  const [floatPresent, setFloatPresent] = useState(true)
  const [loadedCount, setLoadedCount] = useState(0)
  const [loadErrorUrl, setLoadErrorUrl] = useState<string | null>(null)
  const [transform, setTransform] = useState(() => demo.getTransform())

  useEffect(() => {
    const { imageService, floatObjects } = demo.mount.table
    const unsubLoad = imageService.onImageLoad(() => setLoadedCount((count) => count + 1))
    const unsubError = imageService.onImageError((event) => setLoadErrorUrl(event.url))
    const unsubTransform = floatObjects.onTransformEnd((event) => {
      setTransform({
        width: event.size.width,
        height: event.size.height,
        rotation: Math.round(event.rotation),
      })
    })
    return () => {
      unsubLoad()
      unsubError()
      unsubTransform()
    }
  }, [demo])

  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="outline" size="sm" onClick={() => setFloatPresent(demo.toggleFloat())}>
          {floatPresent ? <ImageMinus /> : <ImagePlus />}
          {floatPresent ? '移除浮动对象' : '重建浮动对象'}
        </Button>
        <Separator orientation="vertical" className="h-5" />
        {loadErrorUrl ? (
          <Badge variant="destructive">图片加载失败：{loadErrorUrl}</Badge>
        ) : (
          <Badge variant="secondary">
            <ImageIcon />
            图片已加载 {loadedCount} 张
          </Badge>
        )}
        <Badge variant="outline">
          <RotateCw />
          变换对象 {transform.width}×{transform.height} · {transform.rotation}°
        </Badge>
      </div>
    </div>
  )
}

export function MediaPage() {
  const [demo, setDemo] = useState<MediaDemo | null>(null)
  // 包装为引用稳定回调：SectionPage 的挂载 effect 依赖 mount 引用，只跑一次
  const mount = useCallback((root: HTMLElement): MediaDemo => {
    const mounted = mountMedia(root)
    setDemo(mounted)
    return mounted
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <SectionPage
        title="图片与浮动对象"
        tags={[
          'L2 Media 分层',
          '位图 LRU 缓存',
          '无闪回退',
          '视口窗口化加载',
          'FloatObjectLayer 浮层跟随',
        ]}
        desc="第 1 列偶数行为格内图片，经 L2 Media 独立画布层调度：视口内动态加载、位图 LRU 池化缓存、快速滚动位图无闪回滚；浮动对象层（FloatObjectLayer）锚定在格 (2,1)~(4,3)，滚动时帧级无抖动跟随。"
        mount={mount}
      />
      {demo ? <MediaControls demo={demo} /> : null}
    </div>
  )
}
