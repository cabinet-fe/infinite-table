// 轻量通用 CustomSelect：Portal 固定定位防裁剪，支持键盘导航、Escape 与外部点击关闭；
// 选项较多（> SEARCH_THRESHOLD）时自动开启菜单内搜索过滤，避免长列表找不着字段。

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, ChevronDownIcon, SearchIcon } from './Icons'

/** 超过该选项数自动启用菜单内搜索 */
const SEARCH_THRESHOLD = 12

function filterOptions<T extends string>(
  options: readonly CustomSelectOption<T>[],
  query: string,
): CustomSelectOption<T>[] {
  if (query.trim() === '') return [...options]
  const needle = query.trim().toLowerCase()
  return options.filter(
    (opt) =>
      opt.label.toLowerCase().includes(needle) || (opt.hint ?? '').toLowerCase().includes(needle),
  )
}

export interface CustomSelectOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
  hint?: string
}

export interface CustomSelectProps<T extends string = string> {
  value: T
  options: readonly CustomSelectOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  ariaLabel?: string
  size?: 'xs' | 'sm' | 'md'
  variant?: 'default' | 'pill' | 'ghost'
  disabled?: boolean
  className?: string
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
  triggerLabel?: string
}

interface MenuCoords {
  left: number
  top: number
  minWidth: number
  openAbove: boolean
}

export function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  placeholder = '请选择...',
  ariaLabel,
  size = 'md',
  variant = 'default',
  disabled = false,
  className = '',
  placement = 'bottom-start',
  triggerLabel,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<MenuCoords | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const listboxId = useId()

  const enableSearch = options.length > SEARCH_THRESHOLD
  const filteredOptions = useMemo(
    () => (enableSearch ? filterOptions(options, query) : [...options]),
    [options, enableSearch, query],
  )

  const selectedOpt = options.find((opt) => opt.value === value)
  const displayLabel = triggerLabel ?? selectedOpt?.label ?? placeholder

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const estHeight = Math.min(260, options.length * 32 + 12)
    const preferTop = placement.startsWith('top')
    const spaceBelow = vh - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const openAbove = preferTop
      ? spaceAbove >= 100 || spaceAbove > spaceBelow
      : spaceBelow < estHeight && spaceAbove > spaceBelow

    const minWidth = Math.max(rect.width, 132)
    const alignEnd = placement.endsWith('end')
    const rawLeft = alignEnd ? rect.right - minWidth : rect.left
    const left = Math.max(8, Math.min(rawLeft, vw - minWidth - 8))
    const top = openAbove ? Math.max(8, rect.top - 4) : Math.min(vh - 16, rect.bottom + 4)

    setCoords({ left, top, minWidth, openAbove })
  }, [options.length, placement])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    // 仅在打开瞬间执行：重置搜索词、定位当前项并聚焦搜索框（不能依赖 filteredOptions，
    // 否则每次键入都会重跑本 effect 把 query 清空）
    const currentIdx = options.findIndex((o) => o.value === value && !o.disabled)
    setActiveIndex(currentIdx >= 0 ? currentIdx : options.findIndex((o) => !o.disabled))
    if (enableSearch) {
      setQuery('')
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const onScrollOrResize = (e: Event) => {
      if (e.type === 'scroll' && menuRef.current?.contains(e.target as Node | null)) {
        return
      }
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
      document.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 高亮项滚动进可视区（搜索/键盘导航后保持可见）
  useEffect(() => {
    if (!open || activeIndex < 0) return
    menuRef.current
      ?.querySelector(`[data-opt-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, query])

  function moveActive(step: 1 | -1) {
    if (filteredOptions.length === 0) return
    let idx = activeIndex
    for (let i = 0; i < filteredOptions.length; i++) {
      idx = (idx + step + filteredOptions.length) % filteredOptions.length
      if (!filteredOptions[idx]?.disabled) {
        setActiveIndex(idx)
        return
      }
    }
  }

  function selectActive() {
    const opt = filteredOptions[activeIndex]
    if (opt && !opt.disabled) {
      onChange(opt.value)
      setOpen(false)
      triggerRef.current?.focus()
      return true
    }
    return false
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (disabled) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
      } else {
        moveActive(e.key === 'ArrowDown' ? 1 : -1)
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (open && activeIndex >= 0) {
        e.preventDefault()
        selectActive()
      }
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      moveActive(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (selectActive()) {
        triggerRef.current?.focus()
      }
    }
  }

  /** 应用搜索词并同步把高亮重置到新结果的首个可用项（filteredOptions 此刻还是旧值，需现算） */
  function applySearch(next: string) {
    setQuery(next)
    const nextFiltered = enableSearch ? filterOptions(options, next) : options
    setActiveIndex(nextFiltered.findIndex((o) => !o.disabled))
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className={`st-cselect st-cselect-${size} st-cselect-${variant} ${open ? 'is-open' : ''} ${!selectedOpt && !triggerLabel ? 'is-placeholder' : ''} ${className}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="st-cselect-label">{displayLabel}</span>
        <ChevronDownIcon size={size === 'xs' ? 12 : 14} className="st-cselect-arrow" />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            data-st-portal-menu="true"
            className={`st-cselect-menu ${coords.openAbove ? 'is-above' : ''}`}
            style={{
              left: coords.left,
              top: coords.top,
              minWidth: coords.minWidth,
            }}
          >
            {enableSearch && (
              <div className="st-cselect-search-wrap">
                <SearchIcon size={12} className="st-cselect-search-icon" />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="st-cselect-search"
                  value={query}
                  placeholder="搜索选项..."
                  aria-label="搜索选项"
                  onChange={(e) => applySearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                {query !== '' && (
                  <button
                    type="button"
                    className="st-cselect-search-clear"
                    aria-label="清空搜索"
                    onClick={() => applySearch('')}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
            {filteredOptions.length === 0 ? (
              <div className="st-cselect-empty">无匹配项</div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = !triggerLabel && opt.value === value
                const isHighlighted = idx === activeIndex
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    data-opt-index={idx}
                    aria-selected={isSelected}
                    disabled={opt.disabled}
                    className={`st-cselect-option ${isSelected ? 'is-selected' : ''} ${isHighlighted ? 'is-highlighted' : ''}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      if (opt.disabled) return
                      onChange(opt.value)
                      setOpen(false)
                      triggerRef.current?.focus()
                    }}
                  >
                    <span className="st-cselect-opt-main">
                      <span>{opt.label}</span>
                      {opt.hint && <span className="st-cselect-opt-hint">{opt.hint}</span>}
                    </span>
                    {isSelected && <CheckIcon size={13} className="st-cselect-check" />}
                  </button>
                )
              })
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
