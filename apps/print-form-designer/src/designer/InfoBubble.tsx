// ⓘ 气泡提示：面板里教学式长说明的统一容器——控件旁只留一个小圆钮（ⓘ），
// 点击弹出说明气泡（fixed 定位、按按钮矩形钳在视口内），Esc / 点外关闭。
// 交互与 cell-function-editor 的 fn-help-popover 同族，定位计算共用下方
// popoverStyleFor；区别是 fn-help 是「函数目录卡片」（滚动列表），InfoBubble
// 是一段说明文字（children 允许富文本 / <code>）。
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** 气泡宽度（约 280px：侧栏宽度的安全上限，长文自动换行） */
const BUBBLE_WIDTH = 280

/** 视口钳制的浮层定位（fn-help 与 InfoBubble 共用同一份实现）：
 *  锚点下方 6px 处放置，下方放不下就向上翻（也不许顶出视口），左右不出界。
 *  width / maxHeight 由调用方给定，返回值直接作为内联 style（含 max-height）。 */
export function popoverStyleFor(rect: DOMRect, width: number, maxHeight: number): CSSProperties {
  const top =
    rect.bottom + 6 + maxHeight > window.innerHeight
      ? Math.max(8, rect.top - 6 - maxHeight)
      : rect.bottom + 6
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - 8 - width))
  return { top, left, width, maxHeight }
}

interface InfoBubbleProps {
  /** 气泡内容：说明文字，允许富文本 / <code>（与 text 二选一） */
  children?: ReactNode
  /** 纯文本便捷写法（与 children 二选一；同给时以 children 为准） */
  text?: ReactNode
  /** 小圆钮的悬浮提示（title）与气泡的可读名，默认「说明」 */
  label?: string
}

export function InfoBubble({ children, text, label = '说明' }: InfoBubbleProps) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties | undefined>()
  /** 小圆钮与气泡的公共容器：点它不算「点外」，避免开了立刻被关掉 */
  const rootRef = useRef<HTMLSpanElement>(null)

  // 气泡开着时：Esc 关气泡（捕获阶段拦截——祖先弹框如 RegionDialog 也监听 Esc
  // 关自己，这里先吃掉事件，一次 Esc 只关最上层的气泡）；点外关闭。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <span className="info-bubble" ref={rootRef}>
      <button
        type="button"
        className="info-bubble-toggle"
        aria-expanded={open}
        title={label}
        aria-label={label}
        onClick={() => {
          const rect = rootRef.current?.getBoundingClientRect()
          if (rect) {
            // 高度上限也钳进视口：极矮窗口里气泡自身可滚动，不溢出屏幕
            setStyle(popoverStyleFor(rect, BUBBLE_WIDTH, Math.min(360, window.innerHeight - 16)))
          }
          setOpen((prev) => !prev)
        }}
      >
        i
      </button>
      {open ? (
        <div className="info-bubble-popover" style={style} role="dialog" aria-label={label}>
          {children ?? text}
        </div>
      ) : null}
    </span>
  )
}
