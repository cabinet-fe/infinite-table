// 主工具栏：快捷筛选胶囊（含配置与空值）、防抖条件筛选、多级排序、字段管理、新增列（含单选选项配置）与透视模式适配

import { useEffect, useMemo, useRef, useState } from 'react'
import { validateFormulaExpr } from '../domain/formula-column'
import { isEmptyCellValue, scalarToText } from '../domain/utils'
import type {
  FilterCondition,
  FilterOperator,
  SelectOption,
  SmartColumn,
  SmartColumnType,
  SmartRecord,
  SmartView,
  SortRule,
} from '../shared/schema'
import { SELECT_COLOR_PRESETS } from './CellEditorPopover'
import { ConfirmModal } from './ConfirmModal'
import { CustomSelect } from './CustomSelect'
import {
  AlertTriangleIcon,
  ColumnsIcon,
  FilterIcon,
  Link2Icon,
  LockIcon,
  PlusIcon,
  SlidersIcon,
  SortIcon,
  SparklesIcon,
  StampIcon,
  TrashIcon,
  XIcon,
} from './Icons'

export interface ToolbarProps {
  tableId: string
  tableKind: 'normal' | 'advanced'
  primaryKeyField?: string
  columns: readonly SmartColumn[]
  allComputedRecords: readonly SmartRecord[]
  activeView: SmartView
  unresolvedConflictCount: number
  selectedRecordIds: readonly string[]
  watermarkEnabled: boolean
  busy?: boolean
  onUpdateView: (nextView: SmartView) => Promise<void>
  onAddRow: () => Promise<void>
  onDeleteSelectedRows: () => Promise<void>
  onAddColumn: (column: SmartColumn) => Promise<void>
  onRenameColumn: (columnKey: string, nextTitle: string) => Promise<void>
  onDeleteColumn: (columnKey: string) => Promise<void>
  onOpenLookupWizard: () => void
  /** 当前表既有关联组数量（管理按钮展示与禁用依据） */
  lookupGroupCount: number
  onOpenLookupManage: () => void
  onJumpToFirstConflict: () => void
  onToggleWatermark: () => void
}

type ToolbarPopover =
  | { kind: 'quick'; field: string }
  | { kind: 'quickConfig' }
  | { kind: 'filter' }
  | { kind: 'sort' }
  | { kind: 'addCol' }
  | { kind: 'colManager' }
  | null

const OPERATOR_OPTIONS: { value: FilterOperator; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'is_empty', label: '为空' },
  { value: 'is_not_empty', label: '不为空' },
]

const COLUMN_TYPE_OPTIONS: { value: Exclude<SmartColumnType, 'lookup'>; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数值 / 金额' },
  { value: 'select', label: '单选标签' },
  { value: 'date', label: '日期' },
  { value: 'checkbox', label: '勾选框' },
  { value: 'person', label: '人员' },
  { value: 'progress', label: '进度条 (0-100)' },
  { value: 'image', label: '图片' },
  { value: 'link', label: '超链接' },
  { value: 'formula', label: '计算公式列' },
]

const NUMBER_FORMAT_OPTIONS: {
  value: 'integer' | 'decimal' | 'currency' | 'percent'
  label: string
}[] = [
  { value: 'decimal', label: '两位小数 (1,234.56)' },
  { value: 'integer', label: '整数 (1,235)' },
  { value: 'currency', label: '人民币货币 (¥1,234.56)' },
  { value: 'percent', label: '百分比 (85.0%)' },
]

const DEFAULT_SELECT_OPTIONS: SelectOption[] = [
  { label: '待处理', color: '#f2f3f5', textColor: '#4e5969' },
  { label: '进行中', color: '#ebf1ff', textColor: '#1d4ed8' },
  { label: '已完成', color: '#e8ffea', textColor: '#047857' },
]

export function Toolbar({
  tableId,
  tableKind,
  primaryKeyField,
  columns,
  allComputedRecords,
  activeView,
  unresolvedConflictCount,
  selectedRecordIds,
  watermarkEnabled,
  busy = false,
  onUpdateView,
  onAddRow,
  onDeleteSelectedRows,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onOpenLookupWizard,
  lookupGroupCount,
  onOpenLookupManage,
  onJumpToFirstConflict,
  onToggleWatermark,
}: ToolbarProps) {
  const [popover, setPopover] = useState<ToolbarPopover>(null)
  const [confirmDeleteRows, setConfirmDeleteRows] = useState(false)
  const [confirmDeleteCol, setConfirmDeleteCol] = useState<SmartColumn | null>(null)

  // 新增列弹窗状态
  const [colTitle, setColTitle] = useState('')
  const [colType, setColType] = useState<Exclude<SmartColumnType, 'lookup'>>('text')
  const [colFormat, setColFormat] = useState<'integer' | 'decimal' | 'currency' | 'percent'>(
    'decimal',
  )
  const [formulaExpr, setFormulaExpr] = useState('')
  const [selectOptionsDraft, setSelectOptionsDraft] =
    useState<SelectOption[]>(DEFAULT_SELECT_OPTIONS)
  const [newOptionInput, setNewOptionInput] = useState('')
  const [submittingCol, setSubmittingCol] = useState(false)

  // 列重命名草稿（字段管理弹窗内）
  const [colTitleDrafts, setColTitleDrafts] = useState<Record<string, string>>({})

  // 高级筛选文本防抖本地草稿
  const [filterDrafts, setFilterDrafts] = useState<Record<string, string>>({})
  const filterTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const activeViewRef = useRef(activeView)
  activeViewRef.current = activeView

  // 排序规则稳定 Key 管理
  const sortSeqRef = useRef(1)
  const [sortKeys, setSortKeys] = useState<string[]>([])

  const toolbarLeftRef = useRef<HTMLDivElement | null>(null)

  // 切换数据表或视图时关闭所有浮层、清理防抖定时器
  useEffect(() => {
    setPopover(null)
    for (const timer of filterTimersRef.current.values()) {
      clearTimeout(timer)
    }
    filterTimersRef.current.clear()
  }, [tableId, activeView.id])

  // 同步筛选草稿（不覆盖正在防抖输入中的条件）
  useEffect(() => {
    setFilterDrafts((prev) => {
      const next: Record<string, string> = {}
      for (const cond of activeView.filterGroup.conditions) {
        next[cond.id] = filterTimersRef.current.has(cond.id)
          ? (prev[cond.id] ?? scalarToText(cond.value))
          : scalarToText(cond.value)
      }
      return next
    })
  }, [activeView.filterGroup.conditions])

  // 同步排序规则稳定 key 长度
  useEffect(() => {
    setSortKeys((prev) => {
      if (prev.length === activeView.sortRules.length) return prev
      const next = prev.slice(0, activeView.sortRules.length)
      while (next.length < activeView.sortRules.length) {
        next.push(`srt_${sortSeqRef.current++}`)
      }
      return next
    })
  }, [activeView.sortRules.length])

  // 点击外部或按 Escape 关闭下拉浮层
  useEffect(() => {
    if (!popover) return
    const isDropdown =
      popover.kind === 'quick' ||
      popover.kind === 'quickConfig' ||
      popover.kind === 'filter' ||
      popover.kind === 'sort'

    const onPointerDown = (e: PointerEvent) => {
      if (!isDropdown) return
      const target = e.target as HTMLElement | null
      if (!target) return
      if (toolbarLeftRef.current?.contains(target)) return
      if (target.closest('[data-st-portal-menu="true"]')) return
      setPopover(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submittingCol) {
        setPopover(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [popover, submittingCol])

  useEffect(() => {
    return () => {
      for (const timer of filterTimersRef.current.values()) {
        clearTimeout(timer)
      }
      filterTimersRef.current.clear()
    }
  }, [])

  // 快捷筛选可选值（支持 .trim() 对齐与 '(空)' 选项）
  const quickFieldOptions = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const field of activeView.quickFilterFields) {
      const seen = new Set<string>()
      let hasEmpty = false
      for (const rec of allComputedRecords) {
        const raw = rec[field]
        if (isEmptyCellValue(raw)) {
          hasEmpty = true
        } else {
          const text = scalarToText(raw).trim()
          if (text !== '') {
            seen.add(text)
          } else {
            hasEmpty = true
          }
        }
      }
      const list = Array.from(seen)
      if (hasEmpty) {
        list.push('(空)')
      }
      map.set(field, list)
    }
    return map
  }, [activeView.quickFilterFields, allComputedRecords])

  const formulaValidation = useMemo(() => {
    if (colType !== 'formula') return { valid: true }
    if (!formulaExpr.trim())
      return { valid: false, error: '请输入公式，例如：[累计回款] / [合同金额]' }
    return validateFormulaExpr(formulaExpr, columns)
  }, [colType, formulaExpr, columns])

  const columnSelectOptions = useMemo(
    () => columns.map((c) => ({ value: c.key, label: c.title })),
    [columns],
  )

  function toggleQuickFilterField(fieldKey: string) {
    const exists = activeView.quickFilterFields.includes(fieldKey)
    const nextFields = exists
      ? activeView.quickFilterFields.filter((f) => f !== fieldKey)
      : [...activeView.quickFilterFields, fieldKey]
    const nextValues = { ...activeView.quickFilterValues }
    if (exists) {
      delete nextValues[fieldKey]
    }
    void onUpdateView({
      ...activeView,
      quickFilterFields: nextFields,
      quickFilterValues: nextValues,
    })
  }

  function toggleQuickValue(field: string, value: string) {
    const prevMap = activeView.quickFilterValues ?? {}
    const current = prevMap[field] ?? []
    const exists = current.includes(value)
    const nextList = exists ? current.filter((v) => v !== value) : [...current, value]
    const nextMap = { ...prevMap }
    if (nextList.length === 0) {
      delete nextMap[field]
    } else {
      nextMap[field] = nextList
    }
    void onUpdateView({ ...activeView, quickFilterValues: nextMap })
  }

  function clearQuickField(field: string) {
    const nextMap = { ...activeView.quickFilterValues }
    delete nextMap[field]
    void onUpdateView({ ...activeView, quickFilterValues: nextMap })
  }

  function addFilterCondition() {
    const firstField = columns[0]?.key ?? ''
    if (!firstField) return
    const nextCondition: FilterCondition = {
      id: `flt_${Date.now().toString(36)}`,
      field: firstField,
      operator: 'contains',
      value: '',
    }
    void onUpdateView({
      ...activeView,
      filterGroup: {
        ...activeView.filterGroup,
        conditions: [...activeView.filterGroup.conditions, nextCondition],
      },
    })
  }

  function updateFilterCondition(id: string, patch: Partial<FilterCondition>) {
    const timer = filterTimersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      filterTimersRef.current.delete(id)
    }
    void onUpdateView({
      ...activeView,
      filterGroup: {
        ...activeView.filterGroup,
        conditions: activeView.filterGroup.conditions.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      },
    })
  }

  function handleFilterTextChange(id: string, text: string) {
    setFilterDrafts((prev) => ({ ...prev, [id]: text }))
    const prevTimer = filterTimersRef.current.get(id)
    if (prevTimer) {
      clearTimeout(prevTimer)
    }
    const timer = setTimeout(() => {
      filterTimersRef.current.delete(id)
      const latest = activeViewRef.current
      void onUpdateView({
        ...latest,
        filterGroup: {
          ...latest.filterGroup,
          conditions: latest.filterGroup.conditions.map((c) =>
            c.id === id ? { ...c, value: text } : c,
          ),
        },
      })
    }, 300)
    filterTimersRef.current.set(id, timer)
  }

  function removeFilterCondition(id: string) {
    const timer = filterTimersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      filterTimersRef.current.delete(id)
    }
    void onUpdateView({
      ...activeView,
      filterGroup: {
        ...activeView.filterGroup,
        conditions: activeView.filterGroup.conditions.filter((c) => c.id !== id),
      },
    })
  }

  function addSortRule() {
    const firstField = columns[0]?.key ?? ''
    if (!firstField) return
    const nextRule: SortRule = { field: firstField, direction: 'desc' }
    setSortKeys((prev) => [...prev, `srt_${sortSeqRef.current++}`])
    void onUpdateView({
      ...activeView,
      sortRules: [...activeView.sortRules, nextRule],
    })
  }

  function updateSortRule(index: number, patch: Partial<SortRule>) {
    void onUpdateView({
      ...activeView,
      sortRules: activeView.sortRules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    })
  }

  function removeSortRule(index: number) {
    setSortKeys((prev) => prev.filter((_, i) => i !== index))
    void onUpdateView({
      ...activeView,
      sortRules: activeView.sortRules.filter((_, i) => i !== index),
    })
  }

  function handleAddSelectOptionDraft() {
    const label = newOptionInput.trim()
    if (!label) return
    if (selectOptionsDraft.some((o) => o.label === label)) {
      setNewOptionInput('')
      return
    }
    const preset = SELECT_COLOR_PRESETS[selectOptionsDraft.length % SELECT_COLOR_PRESETS.length]!
    setSelectOptionsDraft((prev) => [...prev, { label, ...preset }])
    setNewOptionInput('')
  }

  async function handleSubmitAddColumn(event: React.FormEvent) {
    event.preventDefault()
    const title = colTitle.trim()
    if (!title) return
    if (colType === 'formula' && !formulaValidation.valid) return
    if (colType === 'select' && selectOptionsDraft.length === 0) return

    const key = `col_${Date.now().toString(36).slice(-5)}`
    const nextCol: SmartColumn = {
      key,
      title,
      type: colType,
      width: colType === 'formula' || colType === 'number' ? 140 : 130,
      ...(colType === 'number' || colType === 'formula' ? { numberFormat: colFormat } : {}),
      ...(colType === 'formula' ? { formulaExpr: formulaExpr.trim() } : {}),
      ...(colType === 'select' ? { options: selectOptionsDraft } : {}),
    }

    setSubmittingCol(true)
    try {
      await onAddColumn(nextCol)
      setColTitle('')
      setFormulaExpr('')
      setColType('text')
      setSelectOptionsDraft(DEFAULT_SELECT_OPTIONS)
      setNewOptionInput('')
      setPopover(null)
    } catch {
      // 保留弹窗与草稿不丢失，错误由 Toast 提示
    } finally {
      setSubmittingCol(false)
    }
  }

  function openColumnManager() {
    const drafts: Record<string, string> = {}
    for (const c of columns) {
      drafts[c.key] = c.title
    }
    setColTitleDrafts(drafts)
    setPopover(popover?.kind === 'colManager' ? null : { kind: 'colManager' })
  }

  function canRenameColumn(col: SmartColumn): boolean {
    if (tableKind === 'normal') return true
    return col.type === 'lookup' || col.type === 'formula'
  }

  function canDeleteColumn(col: SmartColumn): boolean {
    if (columns.length <= 1) return false
    if (col.isUniqueKey || (primaryKeyField && col.key === primaryKeyField)) return false
    if (tableKind === 'normal') return true
    return col.type === 'lookup' || col.type === 'formula'
  }

  const filterCount = activeView.filterGroup.conditions.length
  const sortCount = activeView.sortRules.length
  const isPivotView = activeView.type === 'pivot'

  return (
    <div className="st-toolbar">
      <div ref={toolbarLeftRef} className="st-toolbar-left">
        {/* 快捷筛选胶囊 */}
        {activeView.quickFilterFields.map((fieldKey) => {
          const col = columns.find((c) => c.key === fieldKey)
          if (!col) return null
          const options = quickFieldOptions.get(fieldKey) ?? []
          const selected = activeView.quickFilterValues?.[fieldKey] ?? []
          const isOpen = popover?.kind === 'quick' && popover.field === fieldKey

          return (
            <div key={fieldKey} className="st-popover-anchor">
              <button
                type="button"
                className={`st-chip ${selected.length > 0 ? 'is-active' : ''}`}
                onClick={() => setPopover(isOpen ? null : { kind: 'quick', field: fieldKey })}
              >
                <span>{col.title}</span>
                {selected.length > 0 && (
                  <span className="st-chip-val">: {selected.join(', ')}</span>
                )}
              </button>

              {isOpen && (
                <div className="st-dropdown-panel">
                  <div className="st-dropdown-head">
                    <span>筛选：{col.title}</span>
                    {selected.length > 0 && (
                      <button
                        type="button"
                        className="st-btn-link"
                        onClick={() => clearQuickField(fieldKey)}
                      >
                        清空
                      </button>
                    )}
                  </div>
                  <div className="st-dropdown-list">
                    {options.length === 0 ? (
                      <div className="st-empty-mini">暂无可选值</div>
                    ) : (
                      options.map((opt) => (
                        <label key={opt} className="st-checkbox-label st-dropdown-opt">
                          <input
                            type="checkbox"
                            className="st-checkbox"
                            checked={selected.includes(opt)}
                            onChange={() => toggleQuickValue(fieldKey, opt)}
                          />
                          <span className={opt === '(空)' ? 'st-muted-italic' : ''}>{opt}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* 快捷筛选列配置 */}
        <div className="st-popover-anchor">
          <button
            type="button"
            className={`st-btn st-btn-sm st-btn-icon-label ${popover?.kind === 'quickConfig' ? 'st-btn-accent' : ''}`}
            onClick={() =>
              setPopover(popover?.kind === 'quickConfig' ? null : { kind: 'quickConfig' })
            }
            title="配置快捷筛选胶囊字段"
            aria-label="配置快捷筛选字段"
          >
            <SlidersIcon size={13} />
            <span>快捷字段</span>
          </button>

          {popover?.kind === 'quickConfig' && (
            <div className="st-dropdown-panel">
              <div className="st-dropdown-head">
                <span>固定为快捷筛选胶囊</span>
              </div>
              <div className="st-dropdown-list">
                {columns.map((col) => {
                  const checked = activeView.quickFilterFields.includes(col.key)
                  return (
                    <label key={col.key} className="st-checkbox-label st-dropdown-opt">
                      <input
                        type="checkbox"
                        className="st-checkbox"
                        checked={checked}
                        onChange={() => toggleQuickFilterField(col.key)}
                      />
                      <span>{col.title}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 条件筛选器 */}
        <div className="st-popover-anchor">
          <button
            type="button"
            className={`st-btn st-btn-sm ${filterCount > 0 ? 'st-btn-accent' : ''}`}
            onClick={() => setPopover(popover?.kind === 'filter' ? null : { kind: 'filter' })}
          >
            <FilterIcon size={13} />
            <span>筛选{filterCount > 0 ? ` (${filterCount})` : ''}</span>
          </button>

          {popover?.kind === 'filter' && (
            <div className="st-dropdown-panel st-panel-wide">
              <div className="st-dropdown-head">
                <span>条件筛选</span>
                <CustomSelect
                  size="xs"
                  value={activeView.filterGroup.conjunction}
                  ariaLabel="多条件逻辑关系"
                  options={[
                    { value: 'and', label: '满足所有条件 (AND)' },
                    { value: 'or', label: '满足任一条件 (OR)' },
                  ]}
                  onChange={(val) =>
                    void onUpdateView({
                      ...activeView,
                      filterGroup: {
                        ...activeView.filterGroup,
                        conjunction: val,
                      },
                    })
                  }
                />
              </div>
              <div className="st-panel-rows">
                {activeView.filterGroup.conditions.length === 0 ? (
                  <div className="st-empty-mini">暂无筛选条件</div>
                ) : (
                  activeView.filterGroup.conditions.map((cond) => (
                    <div key={cond.id} className="st-cond-row">
                      <CustomSelect
                        size="xs"
                        value={cond.field}
                        ariaLabel="筛选字段"
                        options={columnSelectOptions}
                        onChange={(val) => updateFilterCondition(cond.id, { field: val })}
                      />
                      <CustomSelect
                        size="xs"
                        value={cond.operator}
                        ariaLabel="筛选操作符"
                        options={OPERATOR_OPTIONS}
                        onChange={(val) => updateFilterCondition(cond.id, { operator: val })}
                      />
                      {cond.operator !== 'is_empty' && cond.operator !== 'is_not_empty' && (
                        <input
                          type="text"
                          className="st-input st-input-xs st-cond-input"
                          value={filterDrafts[cond.id] ?? scalarToText(cond.value)}
                          placeholder="输入值"
                          onChange={(e) => handleFilterTextChange(cond.id, e.target.value)}
                        />
                      )}
                      <button
                        type="button"
                        className="st-icon-btn st-icon-danger"
                        onClick={() => removeFilterCondition(cond.id)}
                        aria-label="移除条件"
                      >
                        <XIcon size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="st-dropdown-foot">
                <button type="button" className="st-btn st-btn-xs" onClick={addFilterCondition}>
                  <PlusIcon size={12} />
                  <span>添加条件</span>
                </button>
                <button type="button" className="st-btn st-btn-xs" onClick={() => setPopover(null)}>
                  关闭
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 排序配置 */}
        <div className="st-popover-anchor">
          <button
            type="button"
            className={`st-btn st-btn-sm ${sortCount > 0 ? 'st-btn-accent' : ''}`}
            onClick={() => setPopover(popover?.kind === 'sort' ? null : { kind: 'sort' })}
          >
            <SortIcon size={13} />
            <span>排序{sortCount > 0 ? ` (${sortCount})` : ''}</span>
          </button>

          {popover?.kind === 'sort' && (
            <div className="st-dropdown-panel st-panel-wide">
              <div className="st-dropdown-head">
                <span>多字段排序</span>
              </div>
              <div className="st-panel-rows">
                {activeView.sortRules.length === 0 ? (
                  <div className="st-empty-mini">默认插入顺序</div>
                ) : (
                  activeView.sortRules.map((rule, idx) => (
                    <div key={sortKeys[idx] ?? `srt_fallback_${idx}`} className="st-cond-row">
                      <CustomSelect
                        size="xs"
                        className="st-flex-1"
                        value={rule.field}
                        ariaLabel="排序字段"
                        options={columnSelectOptions}
                        onChange={(val) => updateSortRule(idx, { field: val })}
                      />
                      <CustomSelect
                        size="xs"
                        value={rule.direction}
                        ariaLabel="排序方向"
                        options={[
                          { value: 'asc', label: '升序 (A→Z / 小→大)' },
                          { value: 'desc', label: '降序 (Z→A / 大→小)' },
                        ]}
                        onChange={(val) => updateSortRule(idx, { direction: val })}
                      />
                      <button
                        type="button"
                        className="st-icon-btn st-icon-danger"
                        onClick={() => removeSortRule(idx)}
                        aria-label="移除排序"
                      >
                        <XIcon size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="st-dropdown-foot">
                <button type="button" className="st-btn st-btn-xs" onClick={addSortRule}>
                  <PlusIcon size={12} />
                  <span>添加排序规则</span>
                </button>
                <button type="button" className="st-btn st-btn-xs" onClick={() => setPopover(null)}>
                  关闭
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 重名冲突角标提醒（仅表格视图展示） */}
        {!isPivotView && unresolvedConflictCount > 0 && (
          <button
            type="button"
            className="st-conflict-pill"
            onClick={onJumpToFirstConflict}
            title="点击立即定位到存在重名冲突的单元格进行消歧"
          >
            <AlertTriangleIcon size={13} />
            <span>{unresolvedConflictCount} 处重名待消歧</span>
          </button>
        )}
      </div>

      <div className="st-toolbar-right">
        {!isPivotView && (
          <>
            <button
              type="button"
              className="st-btn st-btn-sm"
              disabled={busy}
              onClick={() => void onAddRow()}
            >
              <PlusIcon size={13} />
              <span>新增行</span>
            </button>

            {selectedRecordIds.length > 0 && (
              <button
                type="button"
                className="st-btn st-btn-sm st-btn-danger"
                disabled={busy}
                onClick={() => setConfirmDeleteRows(true)}
              >
                <TrashIcon size={13} />
                <span>删除选中 ({selectedRecordIds.length})</span>
              </button>
            )}

            {tableKind === 'normal' && (
              <button
                type="button"
                className="st-btn st-btn-sm"
                disabled={busy}
                onClick={() => setPopover({ kind: 'addCol' })}
              >
                <PlusIcon size={13} />
                <span>新增列</span>
              </button>
            )}

            <button
              type="button"
              className="st-btn st-btn-sm"
              disabled={busy}
              onClick={openColumnManager}
            >
              <ColumnsIcon size={13} />
              <span>字段管理</span>
            </button>
          </>
        )}

        <button
          type="button"
          className="st-btn st-btn-sm st-btn-primary"
          disabled={busy}
          onClick={onOpenLookupWizard}
        >
          <SparklesIcon size={13} />
          <span>关联查找 (VLOOKUP)</span>
        </button>

        <button
          type="button"
          className={`st-btn st-btn-sm ${lookupGroupCount > 0 ? 'st-btn-accent' : ''}`}
          disabled={busy || lookupGroupCount === 0}
          onClick={onOpenLookupManage}
          title={
            lookupGroupCount === 0
              ? '当前表暂无关联查找列'
              : '管理既有关联：匹配条件 / 带出列 / 删除'
          }
        >
          <Link2Icon size={13} />
          <span>管理关联{lookupGroupCount > 0 ? ` (${lookupGroupCount})` : ''}</span>
        </button>

        <button
          type="button"
          className={`st-btn st-btn-sm ${watermarkEnabled ? 'st-btn-accent' : ''}`}
          onClick={onToggleWatermark}
        >
          <StampIcon size={13} />
          <span>{watermarkEnabled ? '水印: 开' : '水印'}</span>
        </button>
      </div>

      {/* 新增列（含单选选项配置与公式列）弹窗 */}
      {popover?.kind === 'addCol' && (
        <div className="st-modal-backdrop" onClick={() => !submittingCol && setPopover(null)}>
          <div
            className="st-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="新增字段列"
          >
            <div className="st-modal-header">
              <h2 className="st-modal-title">新增列（普通列 / 公式列）</h2>
              <button
                type="button"
                className="st-icon-btn"
                disabled={submittingCol}
                onClick={() => setPopover(null)}
                aria-label="关闭"
              >
                <XIcon size={14} />
              </button>
            </div>
            <form onSubmit={(e) => void handleSubmitAddColumn(e)}>
              <div className="st-modal-body st-form-stack">
                <div className="st-field">
                  <label className="st-label">列标题</label>
                  <input
                    type="text"
                    className="st-input"
                    value={colTitle}
                    onChange={(e) => setColTitle(e.target.value)}
                    placeholder="例如：毛利金额 / 回款进度"
                    autoFocus
                  />
                </div>
                <div className="st-field">
                  <label className="st-label">字段类型</label>
                  <CustomSelect
                    value={colType}
                    ariaLabel="字段类型"
                    options={COLUMN_TYPE_OPTIONS}
                    onChange={(val) => setColType(val)}
                  />
                </div>

                {(colType === 'number' || colType === 'formula') && (
                  <div className="st-field">
                    <label className="st-label">数值显示格式</label>
                    <CustomSelect
                      value={colFormat}
                      ariaLabel="数值显示格式"
                      options={NUMBER_FORMAT_OPTIONS}
                      onChange={(val) => setColFormat(val)}
                    />
                  </div>
                )}

                {colType === 'select' && (
                  <div className="st-field">
                    <label className="st-label">单选标签选项</label>
                    <div className="st-option-draft-list">
                      {selectOptionsDraft.map((opt, idx) => (
                        <div key={`${opt.label}-${idx}`} className="st-option-draft-row">
                          <span
                            className="st-color-pill"
                            style={{ backgroundColor: opt.color, color: opt.textColor }}
                          >
                            {opt.label}
                          </span>
                          <div className="st-color-dots">
                            {SELECT_COLOR_PRESETS.map((preset) => (
                              <button
                                key={preset.color}
                                type="button"
                                className={`st-color-dot ${opt.color === preset.color ? 'is-active' : ''}`}
                                style={{
                                  backgroundColor: preset.color,
                                  borderColor: preset.textColor,
                                }}
                                aria-label="切换标签颜色"
                                onClick={() =>
                                  setSelectOptionsDraft((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, ...preset } : item,
                                    ),
                                  )
                                }
                              />
                            ))}
                          </div>
                          {selectOptionsDraft.length > 1 && (
                            <button
                              type="button"
                              className="st-icon-btn st-icon-danger"
                              aria-label={`移除选项 ${opt.label}`}
                              onClick={() =>
                                setSelectOptionsDraft((prev) => prev.filter((_, i) => i !== idx))
                              }
                            >
                              <XIcon size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="st-option-add-row">
                      <input
                        type="text"
                        className="st-input st-input-sm"
                        placeholder="输入新选项名称后按添加..."
                        value={newOptionInput}
                        onChange={(e) => setNewOptionInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddSelectOptionDraft()
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="st-btn st-btn-sm"
                        disabled={!newOptionInput.trim()}
                        onClick={handleAddSelectOptionDraft}
                      >
                        添加选项
                      </button>
                    </div>
                  </div>
                )}

                {colType === 'formula' && (
                  <div className="st-field">
                    <label className="st-label">公式表达式（支持 [列名] 引用同表字段）</label>
                    <input
                      type="text"
                      className="st-input"
                      value={formulaExpr}
                      onChange={(e) => setFormulaExpr(e.target.value)}
                      placeholder='例如：=[累计回款] / [合同金额] 或 IF([进度]>=100, "已达标", "进行中")'
                    />
                    <div className="st-token-bar">
                      {columns.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          className="st-token-chip"
                          onClick={() => setFormulaExpr((prev) => `${prev}[${c.title}]`)}
                        >
                          [{c.title}]
                        </button>
                      ))}
                    </div>
                    <div className={`st-fixed-msg ${formulaValidation.valid ? 'is-ok' : 'is-err'}`}>
                      {formulaValidation.valid ? '公式语法校验通过' : formulaValidation.error}
                    </div>
                  </div>
                )}
              </div>

              <div className="st-modal-footer">
                <button
                  type="button"
                  className="st-btn"
                  disabled={submittingCol}
                  onClick={() => setPopover(null)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="st-btn st-btn-primary"
                  disabled={
                    submittingCol ||
                    !colTitle.trim() ||
                    (colType === 'formula' && !formulaValidation.valid) ||
                    (colType === 'select' && selectOptionsDraft.length === 0)
                  }
                >
                  {submittingCol ? '保存中...' : '添加列'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 字段管理弹窗（重命名 / 删除非主键自定义列） */}
      {popover?.kind === 'colManager' && (
        <div className="st-modal-backdrop" onClick={() => setPopover(null)}>
          <div
            className="st-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="字段管理"
          >
            <div className="st-modal-header">
              <div>
                <h2 className="st-modal-title">字段管理</h2>
                <p className="st-modal-sub">
                  {tableKind === 'advanced'
                    ? 'SQL 主数据物理列受架构锁定，可管理自定义关联列与公式列'
                    : '可重命名列标题或删除非主键自定义列'}
                </p>
              </div>
              <button
                type="button"
                className="st-icon-btn"
                onClick={() => setPopover(null)}
                aria-label="关闭"
              >
                <XIcon size={14} />
              </button>
            </div>
            <div className="st-modal-body">
              <div className="st-col-manager-list">
                {columns.map((col) => {
                  const renameable = canRenameColumn(col)
                  const deletable = canDeleteColumn(col)
                  const draftTitle = colTitleDrafts[col.key] ?? col.title
                  const dirty = draftTitle.trim() !== '' && draftTitle.trim() !== col.title

                  return (
                    <div key={col.key} className="st-col-manager-row">
                      <div className="st-col-manager-meta">
                        {renameable ? (
                          <input
                            type="text"
                            className="st-input st-input-sm"
                            value={draftTitle}
                            aria-label={`列 ${col.title} 名称`}
                            onChange={(e) =>
                              setColTitleDrafts((prev) => ({
                                ...prev,
                                [col.key]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && dirty) {
                                e.preventDefault()
                                void onRenameColumn(col.key, draftTitle.trim())
                              }
                            }}
                          />
                        ) : (
                          <span className="st-col-locked-name">
                            <LockIcon size={12} />
                            <span>{col.title}</span>
                          </span>
                        )}
                        <span className="st-key-hint">
                          {col.key} · {col.type}
                        </span>
                      </div>

                      <div className="st-row-actions">
                        {renameable && dirty && (
                          <button
                            type="button"
                            className="st-btn st-btn-xs st-btn-primary"
                            disabled={busy}
                            onClick={() => void onRenameColumn(col.key, draftTitle.trim())}
                          >
                            保存名称
                          </button>
                        )}
                        {deletable && (
                          <button
                            type="button"
                            className="st-icon-btn st-icon-danger"
                            disabled={busy}
                            title={`删除列 ${col.title}`}
                            aria-label={`删除列 ${col.title}`}
                            onClick={() => setConfirmDeleteCol(col)}
                          >
                            <TrashIcon size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="st-modal-footer st-confirm-footer">
              <button type="button" className="st-btn" onClick={() => setPopover(null)}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDeleteRows}
        title="确认删除选中记录"
        description={`确定要删除已选中的 ${selectedRecordIds.length} 条记录吗？此操作不可撤销。`}
        confirmText={`删除 ${selectedRecordIds.length} 条记录`}
        busy={busy}
        onCancel={() => setConfirmDeleteRows(false)}
        onConfirm={async () => {
          await onDeleteSelectedRows()
          setConfirmDeleteRows(false)
        }}
      />

      <ConfirmModal
        open={confirmDeleteCol !== null}
        title="确认删除字段列"
        description={`确定要删除字段「${confirmDeleteCol?.title ?? ''}」吗？相关筛选、排序与汇总配置将同步移除。`}
        confirmText="删除字段"
        busy={busy}
        onCancel={() => setConfirmDeleteCol(null)}
        onConfirm={async () => {
          if (!confirmDeleteCol) return
          await onDeleteColumn(confirmDeleteCol.key)
          setConfirmDeleteCol(null)
        }}
      />
    </div>
  )
}
