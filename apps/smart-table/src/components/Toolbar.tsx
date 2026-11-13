// 主工具栏：快捷筛选胶囊、条件筛选器、多列排序、重名冲突提醒、增删行列（含公式列）、VLOOKUP 向导与水印/打印

import { useMemo, useState } from 'react'
import { validateFormulaExpr } from '../domain/formula-column'
import { scalarToText } from '../domain/utils'
import type {
  FilterCondition,
  FilterOperator,
  SmartColumn,
  SmartColumnType,
  SmartRecord,
  SmartView,
  SortRule,
} from '../shared/schema'

export interface ToolbarProps {
  tableKind: 'normal' | 'advanced'
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
  onOpenLookupWizard: () => void
  onJumpToFirstConflict: () => void
  onToggleWatermark: () => void
  onOpenPrintPreview: () => void
}

const OPERATOR_LABELS: { value: FilterOperator; label: string }[] = [
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

const COLUMN_TYPE_LABELS: { value: Exclude<SmartColumnType, 'lookup'>; label: string }[] = [
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

export function Toolbar({
  tableKind,
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
  onOpenLookupWizard,
  onJumpToFirstConflict,
  onToggleWatermark,
  onOpenPrintPreview,
}: ToolbarProps) {
  const [openQuickField, setOpenQuickField] = useState<string | null>(null)
  const [openPanel, setOpenPanel] = useState<'filter' | 'sort' | 'addCol' | null>(null)

  // 新增列弹窗状态
  const [colTitle, setColTitle] = useState('')
  const [colType, setColType] = useState<Exclude<SmartColumnType, 'lookup'>>('text')
  const [colFormat, setColFormat] = useState<'integer' | 'decimal' | 'currency' | 'percent'>(
    'decimal',
  )
  const [formulaExpr, setFormulaExpr] = useState('')

  const quickFieldOptions = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const field of activeView.quickFilterFields) {
      const seen = new Set<string>()
      for (const rec of allComputedRecords) {
        const text = scalarToText(rec[field]).trim()
        if (text !== '') {
          seen.add(text)
        }
      }
      map.set(field, Array.from(seen))
    }
    return map
  }, [activeView.quickFilterFields, allComputedRecords])

  const formulaValidation = useMemo(() => {
    if (colType !== 'formula') return { valid: true }
    if (!formulaExpr.trim())
      return { valid: false, error: '请输入公式，例如：[累计回款] / [合同金额]' }
    return validateFormulaExpr(formulaExpr, columns)
  }, [colType, formulaExpr, columns])

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

  function removeFilterCondition(id: string) {
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
    void onUpdateView({
      ...activeView,
      sortRules: activeView.sortRules.filter((_, i) => i !== index),
    })
  }

  async function handleSubmitAddColumn(event: React.FormEvent) {
    event.preventDefault()
    const title = colTitle.trim()
    if (!title) return
    if (colType === 'formula' && !formulaValidation.valid) return

    const key = `col_${Date.now().toString(36).slice(-5)}`
    const nextCol: SmartColumn = {
      key,
      title,
      type: colType,
      width: colType === 'formula' || colType === 'number' ? 140 : 130,
      ...(colType === 'number' || colType === 'formula' ? { numberFormat: colFormat } : {}),
      ...(colType === 'formula' ? { formulaExpr: formulaExpr.trim() } : {}),
      ...(colType === 'select'
        ? {
            options: [
              { label: '待处理', color: '#e5e6eb', textColor: '#4e5969' },
              { label: '进行中', color: '#e8f3ff', textColor: '#165dff' },
              { label: '已完成', color: '#e8ffea', textColor: '#00b42a' },
            ],
          }
        : {}),
    }

    await onAddColumn(nextCol)
    setColTitle('')
    setFormulaExpr('')
    setColType('text')
    setOpenPanel(null)
  }

  const filterCount = activeView.filterGroup.conditions.length
  const sortCount = activeView.sortRules.length

  return (
    <div className="st-toolbar">
      <div className="st-toolbar-left">
        {/* 快捷筛选胶囊 */}
        {activeView.quickFilterFields.map((fieldKey) => {
          const col = columns.find((c) => c.key === fieldKey)
          if (!col) return null
          const options = quickFieldOptions.get(fieldKey) ?? []
          const selected = activeView.quickFilterValues?.[fieldKey] ?? []
          const isOpen = openQuickField === fieldKey

          return (
            <div key={fieldKey} className="st-popover-anchor">
              <button
                type="button"
                className={`st-chip ${selected.length > 0 ? 'is-active' : ''}`}
                onClick={() => setOpenQuickField(isOpen ? null : fieldKey)}
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
                            checked={selected.includes(opt)}
                            onChange={() => toggleQuickValue(fieldKey, opt)}
                          />
                          <span>{opt}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* 条件筛选器 */}
        <div className="st-popover-anchor">
          <button
            type="button"
            className={`st-btn st-btn-sm ${filterCount > 0 ? 'st-btn-accent' : ''}`}
            onClick={() => setOpenPanel(openPanel === 'filter' ? null : 'filter')}
          >
            筛选{filterCount > 0 ? ` (${filterCount})` : ''}
          </button>

          {openPanel === 'filter' && (
            <div className="st-dropdown-panel st-panel-wide">
              <div className="st-dropdown-head">
                <span>条件筛选</span>
                <select
                  className="st-select st-select-xs"
                  value={activeView.filterGroup.conjunction}
                  onChange={(e) =>
                    void onUpdateView({
                      ...activeView,
                      filterGroup: {
                        ...activeView.filterGroup,
                        conjunction: e.target.value as 'and' | 'or',
                      },
                    })
                  }
                >
                  <option value="and">满足所有条件 (AND)</option>
                  <option value="or">满足任一条件 (OR)</option>
                </select>
              </div>
              <div className="st-panel-rows">
                {activeView.filterGroup.conditions.length === 0 ? (
                  <div className="st-empty-mini">暂无筛选条件</div>
                ) : (
                  activeView.filterGroup.conditions.map((cond) => (
                    <div key={cond.id} className="st-cond-row">
                      <select
                        className="st-select st-select-xs"
                        value={cond.field}
                        onChange={(e) => updateFilterCondition(cond.id, { field: e.target.value })}
                      >
                        {columns.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                      <select
                        className="st-select st-select-xs"
                        value={cond.operator}
                        onChange={(e) =>
                          updateFilterCondition(cond.id, {
                            operator: e.target.value as FilterOperator,
                          })
                        }
                      >
                        {OPERATOR_LABELS.map((op) => (
                          <option key={op.value} value={op.value}>
                            {op.label}
                          </option>
                        ))}
                      </select>
                      {cond.operator !== 'is_empty' && cond.operator !== 'is_not_empty' && (
                        <input
                          type="text"
                          className="st-input st-input-xs"
                          value={scalarToText(cond.value)}
                          placeholder="输入值"
                          onChange={(e) =>
                            updateFilterCondition(cond.id, { value: e.target.value })
                          }
                        />
                      )}
                      <button
                        type="button"
                        className="st-icon-btn"
                        onClick={() => removeFilterCondition(cond.id)}
                        aria-label="移除条件"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="st-dropdown-foot">
                <button type="button" className="st-btn st-btn-xs" onClick={addFilterCondition}>
                  + 添加条件
                </button>
                <button
                  type="button"
                  className="st-btn st-btn-xs"
                  onClick={() => setOpenPanel(null)}
                >
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
            onClick={() => setOpenPanel(openPanel === 'sort' ? null : 'sort')}
          >
            排序{sortCount > 0 ? ` (${sortCount})` : ''}
          </button>

          {openPanel === 'sort' && (
            <div className="st-dropdown-panel st-panel-wide">
              <div className="st-dropdown-head">
                <span>多字段排序</span>
              </div>
              <div className="st-panel-rows">
                {activeView.sortRules.length === 0 ? (
                  <div className="st-empty-mini">默认插入顺序</div>
                ) : (
                  activeView.sortRules.map((rule, idx) => (
                    <div key={idx} className="st-cond-row">
                      <select
                        className="st-select st-select-xs"
                        value={rule.field}
                        onChange={(e) => updateSortRule(idx, { field: e.target.value })}
                      >
                        {columns.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                      <select
                        className="st-select st-select-xs"
                        value={rule.direction}
                        onChange={(e) =>
                          updateSortRule(idx, { direction: e.target.value as 'asc' | 'desc' })
                        }
                      >
                        <option value="asc">升序 (A→Z / 小→大)</option>
                        <option value="desc">降序 (Z→A / 大→小)</option>
                      </select>
                      <button
                        type="button"
                        className="st-icon-btn"
                        onClick={() => removeSortRule(idx)}
                        aria-label="移除排序"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="st-dropdown-foot">
                <button type="button" className="st-btn st-btn-xs" onClick={addSortRule}>
                  + 添加排序规则
                </button>
                <button
                  type="button"
                  className="st-btn st-btn-xs"
                  onClick={() => setOpenPanel(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 重名冲突角标提醒 */}
        {unresolvedConflictCount > 0 && (
          <button
            type="button"
            className="st-conflict-pill"
            onClick={onJumpToFirstConflict}
            title="点击立即定位到存在重名冲突的单元格进行消歧"
          >
            ⚠️ {unresolvedConflictCount} 处重名待消歧
          </button>
        )}
      </div>

      <div className="st-toolbar-right">
        <button
          type="button"
          className="st-btn st-btn-sm"
          disabled={busy}
          onClick={() => void onAddRow()}
        >
          + 新增行
        </button>

        {selectedRecordIds.length > 0 && (
          <button
            type="button"
            className="st-btn st-btn-sm st-btn-danger"
            disabled={busy}
            onClick={() => void onDeleteSelectedRows()}
          >
            删除选中 ({selectedRecordIds.length})
          </button>
        )}

        {tableKind === 'normal' && (
          <button
            type="button"
            className="st-btn st-btn-sm"
            disabled={busy}
            onClick={() => setOpenPanel('addCol')}
          >
            + 新增列
          </button>
        )}

        <button
          type="button"
          className="st-btn st-btn-sm st-btn-primary"
          disabled={busy}
          onClick={onOpenLookupWizard}
        >
          ✨ 关联查找 (VLOOKUP)
        </button>

        <button
          type="button"
          className={`st-btn st-btn-sm ${watermarkEnabled ? 'st-btn-accent' : ''}`}
          onClick={onToggleWatermark}
        >
          {watermarkEnabled ? '水印: 开' : '水印'}
        </button>

        <button type="button" className="st-btn st-btn-sm" onClick={onOpenPrintPreview}>
          🖨️ 打印预览
        </button>
      </div>

      {/* 新增列（含公式列）弹窗 */}
      {openPanel === 'addCol' && (
        <div className="st-modal-backdrop" onClick={() => setOpenPanel(null)}>
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
                onClick={() => setOpenPanel(null)}
                aria-label="关闭"
              >
                ×
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
                  <select
                    className="st-select"
                    value={colType}
                    onChange={(e) =>
                      setColType(e.target.value as Exclude<SmartColumnType, 'lookup'>)
                    }
                  >
                    {COLUMN_TYPE_LABELS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                {(colType === 'number' || colType === 'formula') && (
                  <div className="st-field">
                    <label className="st-label">数值显示格式</label>
                    <select
                      className="st-select"
                      value={colFormat}
                      onChange={(e) =>
                        setColFormat(
                          e.target.value as 'integer' | 'decimal' | 'currency' | 'percent',
                        )
                      }
                    >
                      <option value="decimal">两位小数 (1,234.56)</option>
                      <option value="integer">整数 (1,235)</option>
                      <option value="currency">人民币货币 (¥1,234.56)</option>
                      <option value="percent">百分比 (85.0%)</option>
                    </select>
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
                      {formulaValidation.valid ? '✓ 公式语法校验通过' : formulaValidation.error}
                    </div>
                  </div>
                )}
              </div>

              <div className="st-modal-footer">
                <button type="button" className="st-btn" onClick={() => setOpenPanel(null)}>
                  取消
                </button>
                <button
                  type="submit"
                  className="st-btn st-btn-primary"
                  disabled={!colTitle.trim() || (colType === 'formula' && !formulaValidation.valid)}
                >
                  添加列
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
