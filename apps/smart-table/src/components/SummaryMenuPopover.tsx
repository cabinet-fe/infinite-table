// 底部汇总格轻量统计菜单：点击原生 Canvas 汇总行单元格浮出，选择 none/sum/avg/max/min/count/filled_rate 并持久化

import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import type { SmartGridSummaryClickInfo } from '../canvas/smart-grid'
import { getAvailableSummaryTypes, SUMMARY_LABELS } from '../domain/workspace-helpers'
import type { SummaryType } from '../shared/schema'

export interface SummaryMenuPopoverProps {
  info: SmartGridSummaryClickInfo
  onSelect: (columnKey: string, summaryType: SummaryType) => void
  onClose: () => void
}

export function SummaryMenuPopover({ info, onSelect, onClose }: SummaryMenuPopoverProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const options = getAvailableSummaryTypes(info.column)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node | null)) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const menuW = 168
  const estH = options.length * 30 + 36
  const left = Math.min(Math.max(8, info.rect.x), Math.max(8, vw - menuW - 8))
  const top =
    info.rect.y - estH - 6 >= 8
      ? info.rect.y - 6
      : Math.min(vh - 8, info.rect.y + info.rect.height + 6)
  const openAbove = info.rect.y - estH - 6 >= 8

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${info.column.title} 汇总统计选项`}
      className={`fixed z-[1150] w-[168px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg ${
        openAbove ? '-translate-y-full' : ''
      }`}
      style={{ left, top }}
    >
      <div className="truncate border-b border-slate-100 px-2.5 py-1.5 text-[11px] font-medium text-slate-500">
        {info.column.title} · 汇总方式
      </div>
      <div className="mt-0.5 flex flex-col">
        {options.map((type) => {
          const active = info.summaryType === type
          return (
            <button
              key={type}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                active ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700 hover:bg-slate-50'
              }`}
              onClick={() => {
                onSelect(info.columnKey, type)
                onClose()
              }}
            >
              <span>{SUMMARY_LABELS[type]}</span>
              {active && <Check className="h-3.5 w-3.5 text-blue-600" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
