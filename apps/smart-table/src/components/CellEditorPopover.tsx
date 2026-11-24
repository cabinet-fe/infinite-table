// 画布内富单元格编辑浮层：响应 select（彩色胶囊列表+搜索+快速新建）与 date（日历+直填）双击编辑

import { useEffect, useMemo, useState } from 'react'
import { Calendar, Check, ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react'
import { scalarToText } from '../domain/utils'
import type { SelectOption, SmartColumn, SmartRecord } from '../shared/schema'

export interface RichCellEditInfo {
  record: SmartRecord
  column: SmartColumn
  rect: { x: number; y: number; width: number; height: number }
  value: unknown
}

export const SELECT_COLOR_PRESETS: readonly { color: string; textColor: string }[] = [
  { color: '#ebf1ff', textColor: '#1d4ed8' },
  { color: '#e8ffea', textColor: '#047857' },
  { color: '#fff7e8', textColor: '#b45309' },
  { color: '#f3e8ff', textColor: '#6d28d9' },
  { color: '#ffe4e6', textColor: '#be123c' },
  { color: '#e0f2fe', textColor: '#0369a1' },
  { color: '#f2f3f5', textColor: '#4e5969' },
]

export interface CellEditorPopoverProps {
  editInfo: RichCellEditInfo
  allowCreateSelectOption?: boolean
  onClose: () => void
  onCommit: (recordId: string, fieldKey: string, value: unknown) => Promise<void>
  onCreateSelectOption?: (columnKey: string, option: SelectOption) => Promise<void>
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function formatYmd(year: number, monthIndex: number, day: number): string {
  const m = String(monthIndex + 1).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${year}-${m}-${d}`
}

function parseYmd(raw: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  const dt = new Date(year, month, day)
  if (dt.getFullYear() !== year || dt.getMonth() !== month || dt.getDate() !== day) {
    return null
  }
  return { year, month, day }
}

export function CellEditorPopover({
  editInfo,
  allowCreateSelectOption = true,
  onClose,
  onCommit,
  onCreateSelectOption,
}: CellEditorPopoverProps) {
  const { record, column, rect, value } = editInfo
  const currentText = scalarToText(value).trim()
  const [submitting, setSubmitting] = useState(false)

  const [query, setQuery] = useState('')
  const today = useMemo(() => new Date(), [])
  const initialDate = parseYmd(currentText)
  const [viewYear, setViewYear] = useState(initialDate?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(initialDate?.month ?? today.getMonth())
  const [dateInput, setDateInput] = useState(currentText)

  useEffect(() => {
    const nextText = scalarToText(editInfo.value).trim()
    setQuery('')
    setDateInput(nextText)
    const parsed = parseYmd(nextText)
    setViewYear(parsed?.year ?? today.getFullYear())
    setViewMonth(parsed?.month ?? today.getMonth())
  }, [editInfo, today])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [submitting, onClose])

  const popoverW = column.type === 'date' ? 276 : 256
  const popoverH = column.type === 'date' ? 336 : 310
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.min(Math.max(12, rect.x), Math.max(12, vw - popoverW - 12))
  const top =
    rect.y + rect.height + 6 + popoverH <= vh - 12
      ? rect.y + rect.height + 6
      : Math.max(12, rect.y - popoverH - 6)

  async function commitValue(nextVal: unknown) {
    setSubmitting(true)
    try {
      await onCommit(record._id, column.key, nextVal)
      onClose()
    } catch {
      // 错误由上层 Toast 负责
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreateOption(rawLabel: string) {
    const label = rawLabel.trim()
    if (!label) return
    const existingOpts = column.options ?? []
    const preset = SELECT_COLOR_PRESETS[existingOpts.length % SELECT_COLOR_PRESETS.length]!
    setSubmitting(true)
    try {
      if (onCreateSelectOption) {
        await onCreateSelectOption(column.key, {
          label,
          color: preset.color,
          textColor: preset.textColor,
        })
      }
      await onCommit(record._id, column.key, label)
      onClose()
    } catch {
      // 错误由上层 Toast 负责
    } finally {
      setSubmitting(false)
    }
  }

  const options = column.options ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = normalizedQuery
    ? options.filter((o) => o.label.toLowerCase().includes(normalizedQuery))
    : options
  const exactMatch = options.some((o) => o.label.toLowerCase() === normalizedQuery)
  const canQuickCreate =
    allowCreateSelectOption &&
    Boolean(onCreateSelectOption) &&
    query.trim().length > 0 &&
    !exactMatch

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1)
    const offset = (firstDay.getDay() + 6) % 7
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const cells: Array<{ day: number | null; ymd?: string }> = []
    for (let i = 0; i < offset; i++) cells.push({ day: null })
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, ymd: formatYmd(viewYear, viewMonth, d) })
    }
    return cells
  }, [viewYear, viewMonth])

  function shiftMonth(delta: number) {
    const dt = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(dt.getFullYear())
    setViewMonth(dt.getMonth())
  }

  const todayYmd = formatYmd(today.getFullYear(), today.getMonth(), today.getDate())

  return (
    <div className="fixed inset-0 z-[1050]" onClick={() => !submitting && onClose()}>
      <div
        className="st-popover p-2 fixed"
        style={{ left, top, width: popoverW }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`编辑 ${column.title}`}
      >
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <span className="st-section-label truncate">{column.title}</span>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭编辑器"
            className="st-icon-btn st-icon-btn-xs"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {column.type === 'select' ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                className="st-input st-input-sm pl-7"
                placeholder="搜索或输入新选项..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canQuickCreate && !submitting) {
                    e.preventDefault()
                    void handleCreateOption(query)
                  }
                }}
              />
            </div>

            <div className="st-scroll max-h-52 space-y-0.5 overflow-y-auto">
              {filteredOptions.map((opt) => {
                const isSelected = opt.label === currentText
                return (
                  <button
                    key={opt.label}
                    type="button"
                    disabled={submitting}
                    onClick={() => void commitValue(opt.label)}
                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <span
                      className="st-pill"
                      style={{ backgroundColor: opt.color, color: opt.textColor }}
                    >
                      {opt.label}
                    </span>
                    {isSelected && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-blue-600" />}
                  </button>
                )
              })}

              {filteredOptions.length === 0 && !canQuickCreate && (
                <div className="py-3 text-center text-xs text-slate-400">无匹配选项</div>
              )}

              {canQuickCreate && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleCreateOption(query)}
                  className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-blue-200 bg-blue-50/50 px-2 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="truncate">创建并选择「{query.trim()}」</span>
                </button>
              )}
            </div>

            {currentText !== '' && (
              <div className="pt-1.5">
                <div className="st-divider" />
                <div className="mt-1.5 flex justify-end">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void commitValue('')}
                    className="st-btn st-btn-xs st-btn-ghost"
                  >
                    清空当前值
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                const parsed = parseYmd(dateInput)
                if (parsed) {
                  void commitValue(formatYmd(parsed.year, parsed.month, parsed.day))
                } else if (dateInput.trim() === '') {
                  void commitValue('')
                }
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Calendar className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  className="st-input st-input-sm pl-7"
                  placeholder="YYYY-MM-DD"
                  value={dateInput}
                  onChange={(e) => {
                    const val = e.target.value
                    setDateInput(val)
                    const parsed = parseYmd(val)
                    if (parsed) {
                      setViewYear(parsed.year)
                      setViewMonth(parsed.month)
                    }
                  }}
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={submitting || (dateInput.trim() !== '' && !parseYmd(dateInput))}
                className="st-btn st-btn-xs st-btn-primary"
              >
                确定
              </button>
            </form>

            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="上一月"
                className="st-icon-btn"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">
                {viewYear} 年 {viewMonth + 1} 月
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="下一月"
                className="st-icon-btn"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center">
              {WEEKDAYS.map((wd) => (
                <div key={wd} className="py-1 text-xs font-medium text-slate-400">
                  {wd}
                </div>
              ))}
              {calendarDays.map((cell, idx) =>
                cell.day === null ? (
                  <div key={`empty-${idx}`} />
                ) : (
                  <button
                    key={cell.ymd}
                    type="button"
                    disabled={submitting}
                    onClick={() => void commitValue(cell.ymd)}
                    className={`h-7 rounded-md text-xs transition-colors ${
                      cell.ymd === currentText
                        ? 'bg-blue-600 font-medium text-white'
                        : cell.ymd === todayYmd
                          ? 'bg-blue-50 font-medium text-blue-700 hover:bg-blue-100'
                          : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {cell.day}
                  </button>
                ),
              )}
            </div>

            <div className="pt-1.5">
              <div className="st-divider" />
              <div className="mt-1.5 flex items-center justify-between">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void commitValue(todayYmd)}
                  className="st-btn st-btn-xs st-btn-ghost"
                >
                  选择今天
                </button>
                {currentText !== '' && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void commitValue('')}
                    className="st-btn st-btn-xs st-btn-ghost"
                  >
                    清空日期
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
