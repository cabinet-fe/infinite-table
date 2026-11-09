// 画布右键菜单（自研，Excel 风格）：fixed 定位、越界翻转、ESC/外点关闭、禁用项带原因提示。
// 菜单内容（items）由调用方（DesignerPage）按落点上下文计算，本组件只管呈现与关闭。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  key: string
  label: string
  /** 禁用原因（同时作为 title；禁用项仍占位，保持菜单结构稳定） */
  disabledReason?: string
  /** 当前命中态（前缀打勾，如行角色的当前角色） */
  checked?: boolean
  danger?: boolean
  /** 在该项前画分隔线 */
  separatorBefore?: boolean
  onSelect?: () => void
}

interface Props {
  /** 客户端坐标（SheetGridContextMenuInfo 的 x/y） */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // 首帧测量后按视口翻转/收缩，避免贴右下边缘时溢出屏幕
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { innerWidth, innerHeight } = window
    const { offsetWidth: width, offsetHeight: height } = el
    setPosition({
      left: Math.min(x, innerWidth - width - 8),
      top: Math.min(y, innerHeight - height - 8),
    })
  }, [x, y])

  // ESC 关闭 + 点击/滚动画布外关闭（菜单内点击走 item onSelect → onClose，不算外点）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onWindowBlur = (): void => onClose()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="context-menu"
      style={position}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.key} className="context-menu-slot">
          {item.separatorBefore ? <div className="context-menu-sep" aria-hidden="true" /> : null}
          <button
            type="button"
            role="menuitem"
            className={`context-menu-item${item.danger ? ' danger' : ''}`}
            disabled={Boolean(item.disabledReason)}
            title={item.disabledReason ?? undefined}
            onClick={() => {
              if (item.disabledReason) return
              item.onSelect?.()
              onClose()
            }}
          >
            <span className="context-menu-check" aria-hidden="true">
              {item.checked ? '✓' : ''}
            </span>
            <span className="context-menu-label">{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
