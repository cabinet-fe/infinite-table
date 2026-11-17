// 画布内富单元格编辑浮层：响应 select（彩色胶囊列表+搜索+快速新建）与 date（日历+直填）双击编辑

import { useEffect, useMemo, useState } from 'react'
import { scalarToText } from '../domain/utils'
import type { SelectOption, SmartColumn, SmartRecord } from '../shared/schema'
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from './Icons'

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

  // select 状态
  const [query, setQuery] = useState('')

  // date 状态
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
      // 错误提示由上层 Toast 负责，保持浮层打开便于重试
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSelectOption(label: string) {
    await commitValue(label)
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
      // 错误提示由上层 Toast 负责
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

  // 日历网格数据（周一为首日）
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1)
    const offset = (firstDay.getDay() + 6) % 7
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const cells: Array<{ day: number | null; ymd?: string }> = []
    for (let i = 0; i < offset; i++) {
      cells.push({ day: null })
    }
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
    <div className="st-cell-popover-backdrop" onClick={() => !submitting && onClose()}>
      <div
        className="st-cell-editor-popover"
        style={{ left, top, width: popoverW }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`编辑 ${column.title}`}
      >
        <div className="st-cell-editor-head">
          <span className="st-cell-editor-title">{column.title}</span>
          <button
            type="button"
            className="st-icon-btn"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭编辑器"
          >
            <XIcon size={13} />
          </button>
        </div>

        {column.type === 'select' ? (
          <div className="st-select-editor">
            <div className="st-search-box">
              <SearchIcon size={13} className="st-search-icon" />
              <input
                type="text"
                className="st-search-input"
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

            <div className="st-select-pill-list">
              {filteredOptions.map((opt) => {
                const isSelected = opt.label === currentText
                return (
                  <button
                    key={opt.label}
                    type="button"
                    disabled={submitting}
                    className={`st-select-opt-row ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => void handleSelectOption(opt.label)}
                  >
                    <span
                      className="st-color-pill"
                      style={{ backgroundColor: opt.color, color: opt.textColor }}
                    >
                      {opt.label}
                    </span>
                    {isSelected && <CheckIcon size={14} className="st-cselect-check" />}
                  </button>
                )
              })}

              {filteredOptions.length === 0 && !canQuickCreate && (
                <div className="st-empty-mini">无匹配选项</div>
              )}

              {canQuickCreate && (
                <button
                  type="button"
                  disabled={submitting}
                  className="st-select-create-btn"
                  onClick={() => void handleCreateOption(query)}
                >
                  <PlusIcon size={13} />
                  <span>创建并选择「{query.trim()}」</span>
                </button>
              )}
            </div>

            {currentText !== '' && (
              <div className="st-cell-editor-foot">
                <button
                  type="button"
                  className="st-btn-link"
                  disabled={submitting}
                  onClick={() => void commitValue('')}
                >
                  清空当前值
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="st-date-editor">
            <form
              className="st-date-input-row"
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
              <CalendarIcon size={13} className="st-search-icon" />
              <input
                type="text"
                className="st-search-input"
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
              <button
                type="submit"
                className="st-btn st-btn-xs st-btn-primary"
                disabled={submitting || (dateInput.trim() !== '' && !parseYmd(dateInput))}
              >
                确定
              </button>
            </form>

            <div className="st-calendar-nav">
              <button
                type="button"
                className="st-icon-btn"
                onClick={() => shiftMonth(-1)}
                aria-label="上一月"
              >
                <ChevronLeftIcon size={14} />
              </button>
              <span className="st-calendar-month-label">
                {viewYear} 年 {viewMonth + 1} 月
              </span>
              <button
                type="button"
                className="st-icon-btn"
                onClick={() => shiftMonth(1)}
                aria-label="下一月"
              >
                <ChevronRightIcon size={14} />
              </button>
            </div>

            <div className="st-calendar-grid">
              {WEEKDAYS.map((wd) => (
                <div key={wd} className="st-calendar-weekday">
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
                    className={`st-calendar-day ${cell.ymd === currentText ? 'is-selected' : ''} ${cell.ymd === todayYmd ? 'is-today' : ''}`}
                    onClick={() => void commitValue(cell.ymd)}
                  >
                    {cell.day}
                  </button>
                ),
              )}
            </div>

            <div className="st-cell-editor-foot">
              <button
                type="button"
                className="st-btn-link"
                disabled={submitting}
                onClick={() => void commitValue(todayYmd)}
              >
                选择今天
              </button>
              {currentText !== '' && (
                <button
                  type="button"
                  className="st-btn-link"
                  disabled={submitting}
                  onClick={() => void commitValue('')}
                >
                  清空日期
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
