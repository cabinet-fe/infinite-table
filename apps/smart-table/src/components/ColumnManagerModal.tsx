// 字段管理弹窗：数据源中心模式管理原始字段结构/必填/对齐/格式/单选配色；
// SmartApp 模式展示源表原始列（只读 + 跳转数据源中心）并增删改当前应用的 lookup/formula 派生列。

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Database,
  Layers,
  Lock,
  Palette,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { validateFormulaExpr } from '../domain/formula-column'
import {
  DECIMAL_PLACES_OPTIONS,
  fromDecimalPlacesChoice,
  toDecimalPlacesChoice,
} from '../shared/number-format'
import {
  filterRawColumns,
  isDerivedColumn,
  type CellTextAlign,
  type SelectOption,
  type SmartColumn,
  type TableKind,
} from '../shared/schema'
import { COLUMN_ALIGN_OPTIONS, NUMBER_FORMAT_OPTIONS, SelectOptionsEditor } from './AddColumnModal'
import { ConfirmModal } from './ConfirmModal'
import { CustomSelect } from './CustomSelect'

export interface ColumnManagerModalProps {
  mode?: 'datasource' | 'app'
  tableKind: TableKind
  primaryKeyField?: string
  columns: readonly SmartColumn[]
  derivedColumns?: readonly SmartColumn[]
  busy?: boolean
  onClose: () => void
  onRenameColumn: (columnKey: string, nextTitle: string) => Promise<void>
  onUpdateColumn?: (columnKey: string, patch: Partial<SmartColumn>) => Promise<void>
  onDeleteColumn: (columnKey: string) => Promise<void>
  onEditLookupColumn?: (columnKey: string, anchor: HTMLElement) => void
  onUpdateDerivedColumn?: (columnKey: string, patch: Partial<SmartColumn>) => Promise<void>
  onOpenAddFormula?: () => void
  onOpenLookupWizard?: () => void
  onJumpToDatasource?: () => void
}

export function ColumnManagerModal({
  mode = 'datasource',
  tableKind,
  primaryKeyField,
  columns,
  derivedColumns,
  busy = false,
  onClose,
  onRenameColumn,
  onUpdateColumn,
  onDeleteColumn,
  onEditLookupColumn,
  onUpdateDerivedColumn,
  onOpenAddFormula,
  onOpenLookupWizard,
  onJumpToDatasource,
}: ColumnManagerModalProps) {
  const isAppMode = mode === 'app'
  const rawColumns = useMemo(() => filterRawColumns(columns), [columns])
  const effectiveDerivedColumns = useMemo(
    () => (derivedColumns !== undefined ? [...derivedColumns] : columns.filter(isDerivedColumn)),
    [columns, derivedColumns],
  )
  const managedColumns = isAppMode ? effectiveDerivedColumns : rawColumns

  const [colTitleDrafts, setColTitleDrafts] = useState<Record<string, string>>({})
  const [formulaExprDrafts, setFormulaExprDrafts] = useState<Record<string, string>>({})
  const [expandedSelectKey, setExpandedSelectKey] = useState<string | null>(null)
  const [confirmDeleteCol, setConfirmDeleteCol] = useState<SmartColumn | null>(null)

  useEffect(() => {
    const titleMap: Record<string, string> = {}
    const exprMap: Record<string, string> = {}
    for (const c of managedColumns) {
      titleMap[c.key] = c.title
      if (c.type === 'formula') {
        exprMap[c.key] = c.formulaExpr ?? ''
      }
    }
    setColTitleDrafts(titleMap)
    setFormulaExprDrafts(exprMap)
  }, [managedColumns])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmDeleteCol) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDeleteCol, onClose])

  function canRenameDatasourceColumn(): boolean {
    return tableKind === 'normal'
  }

  function canDeleteDatasourceColumn(col: SmartColumn): boolean {
    if (rawColumns.length <= 1) return false
    if (col.isUniqueKey || (primaryKeyField && col.key === primaryKeyField)) return false
    return tableKind === 'normal'
  }

  async function commitRename(col: SmartColumn, nextTitle: string) {
    const trimmed = nextTitle.trim()
    if (!trimmed || trimmed === col.title) return
    if (isAppMode && onUpdateDerivedColumn) {
      await onUpdateDerivedColumn(col.key, { title: trimmed })
      return
    }
    await onRenameColumn(col.key, trimmed)
  }

  async function patchDatasourceColumn(colKey: string, patch: Partial<SmartColumn>) {
    if (onUpdateColumn) {
      await onUpdateColumn(colKey, patch)
    }
  }

  async function patchDerivedColumn(colKey: string, patch: Partial<SmartColumn>) {
    if (onUpdateDerivedColumn) {
      await onUpdateDerivedColumn(colKey, patch)
    } else if (onUpdateColumn) {
      await onUpdateColumn(colKey, patch)
    }
  }

  return (
    <div className="st-overlay" onClick={onClose}>
      <div
        className="st-modal max-w-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isAppMode ? '多维数据台派生列管理' : '数据源字段管理'}
      >
        <div className="st-modal-header">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              {isAppMode ? <Layers className="h-5 w-5" /> : <Database className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="st-modal-title">
                {isAppMode ? '多维数据台派生列管理' : '数据源字段管理'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {isAppMode
                  ? '管理本多维数据台共享的 VLOOKUP 关联列与公式列，源表原始列只读展示'
                  : tableKind === 'advanced'
                    ? '主数据列名与删列受锁定，可配置必填、对齐、数值格式与单选配色'
                    : '管理字段名称、必填、对齐、数值格式与单选配色'}
              </p>
            </div>
          </div>
          <button type="button" className="st-icon-btn" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="st-modal-body st-scroll max-h-[70vh] space-y-5">
          {isAppMode ? (
            <>
              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="st-section-label">
                    当前应用派生列（{effectiveDerivedColumns.length}）
                  </h3>
                  <div className="flex items-center gap-1.5">
                    {onOpenAddFormula && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          onClose()
                          onOpenAddFormula()
                        }}
                        className="st-btn st-btn-xs st-btn-secondary"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>新增公式列</span>
                      </button>
                    )}
                    {onOpenLookupWizard && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          onClose()
                          onOpenLookupWizard()
                        }}
                        className="st-btn st-btn-xs st-btn-secondary"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>新增 VLOOKUP</span>
                      </button>
                    )}
                  </div>
                </div>

                {effectiveDerivedColumns.length === 0 ? (
                  <div className="st-empty py-3">
                    暂无派生列，可通过上方按钮新增公式列或 VLOOKUP 关联列。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {effectiveDerivedColumns.map((col) => {
                      const draftTitle = colTitleDrafts[col.key] ?? col.title
                      const titleDirty = draftTitle.trim() !== '' && draftTitle.trim() !== col.title
                      const exprDraft = formulaExprDrafts[col.key] ?? col.formulaExpr ?? ''
                      const exprDirty =
                        col.type === 'formula' &&
                        exprDraft.trim() !== (col.formulaExpr ?? '').trim()
                      const formulaValidation =
                        col.type === 'formula'
                          ? exprDraft.trim()
                            ? validateFormulaExpr(
                                exprDraft,
                                rawColumns,
                                col.key,
                                effectiveDerivedColumns,
                              )
                            : { valid: false, error: '公式不能为空' }
                          : { valid: true }

                      return (
                        <div
                          key={col.key}
                          className="st-card group space-y-2.5 p-4 transition-colors hover:border-slate-300"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1 space-y-1">
                              <input
                                type="text"
                                className="st-input st-input-sm border-transparent bg-transparent px-1.5 text-sm font-medium text-slate-900 hover:border-slate-200"
                                value={draftTitle}
                                aria-label={`派生列 ${col.title} 名称`}
                                onChange={(e) =>
                                  setColTitleDrafts((prev) => ({
                                    ...prev,
                                    [col.key]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && titleDirty) {
                                    e.preventDefault()
                                    void commitRename(col, draftTitle)
                                  }
                                }}
                              />
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`st-badge ${
                                    col.type === 'lookup' ? 'st-badge-blue' : 'st-badge-violet'
                                  }`}
                                >
                                  {col.type === 'lookup' ? 'VLOOKUP 关联' : '公式计算'}
                                </span>
                                <span className="truncate font-mono text-xs text-slate-400">
                                  {col.key}
                                </span>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                              {titleDirty && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void commitRename(col, draftTitle)}
                                  className="st-btn st-btn-xs st-btn-primary"
                                >
                                  保存名称
                                </button>
                              )}
                              {col.type === 'lookup' && onEditLookupColumn && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  title={`设置关联列 ${col.title}`}
                                  aria-label={`设置关联列 ${col.title}`}
                                  onClick={(e) => {
                                    onClose()
                                    onEditLookupColumn(col.key, e.currentTarget)
                                  }}
                                  className="st-icon-btn"
                                >
                                  <Settings className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                title={`删除派生列 ${col.title}`}
                                aria-label={`删除派生列 ${col.title}`}
                                onClick={() => setConfirmDeleteCol(col)}
                                className="st-icon-btn st-icon-btn-danger"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          {col.type === 'lookup' && col.lookupConfig && (
                            <div className="border-t border-slate-100 pt-2.5">
                              <div className="rounded-md bg-slate-50 px-2 py-1 font-mono text-xs break-all text-slate-600">
                                {col.lookupConfig.matchRules
                                  .map((r) => `${r.sourceField} = ${r.targetField}`)
                                  .join(' 且 ')}
                              </div>
                            </div>
                          )}

                          {col.type === 'formula' && (
                            <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  className="st-input st-input-sm min-w-0 flex-1 bg-slate-50 font-mono focus:bg-white"
                                  value={exprDraft}
                                  aria-label={`公式列 ${col.title} 表达式`}
                                  onChange={(e) =>
                                    setFormulaExprDrafts((prev) => ({
                                      ...prev,
                                      [col.key]: e.target.value,
                                    }))
                                  }
                                />
                                <CustomSelect
                                  size="xs"
                                  className="w-36"
                                  value={col.numberFormat ?? 'decimal'}
                                  ariaLabel={`公式列 ${col.title} 数值格式`}
                                  options={NUMBER_FORMAT_OPTIONS}
                                  disabled={busy}
                                  onChange={(val) =>
                                    void patchDerivedColumn(col.key, { numberFormat: val })
                                  }
                                />
                                <CustomSelect
                                  size="xs"
                                  className="w-28"
                                  value={toDecimalPlacesChoice(col.decimalPlaces)}
                                  ariaLabel={`公式列 ${col.title} 小数位数`}
                                  options={DECIMAL_PLACES_OPTIONS}
                                  disabled={busy}
                                  onChange={(val) =>
                                    void patchDerivedColumn(col.key, {
                                      decimalPlaces: fromDecimalPlacesChoice(val),
                                    })
                                  }
                                />
                                {exprDirty && (
                                  <button
                                    type="button"
                                    disabled={busy || !formulaValidation.valid}
                                    onClick={() =>
                                      void patchDerivedColumn(col.key, {
                                        formulaExpr: exprDraft.trim(),
                                      })
                                    }
                                    className="st-btn st-btn-xs st-btn-primary"
                                  >
                                    保存公式
                                  </button>
                                )}
                              </div>
                              {!formulaValidation.valid && (
                                <div className="st-alert st-alert-red">
                                  {formulaValidation.error}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-2 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5 text-slate-400" />
                    <h3 className="st-section-label">
                      底层数据源原始列（只读，{rawColumns.length}）
                    </h3>
                  </div>
                  {onJumpToDatasource && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        onJumpToDatasource()
                      }}
                      className="st-btn st-btn-xs st-btn-secondary"
                    >
                      <Database className="h-3.5 w-3.5" />
                      <span>前往数据源中心管理</span>
                    </button>
                  )}
                </div>
                <div className="divide-y divide-slate-100">
                  {rawColumns.map((col) => (
                    <div
                      key={col.key}
                      className="flex items-center justify-between gap-3 py-1.5 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Lock className="h-3 w-3 shrink-0 text-slate-400" />
                        <span className="truncate font-medium text-slate-600">{col.title}</span>
                        {col.required && <span className="st-badge st-badge-red">必填</span>}
                      </div>
                      <span className="shrink-0 font-mono text-slate-400">
                        {col.key} · {col.type} · 只读
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="space-y-2.5">
              {rawColumns.map((col) => {
                const renameable = canRenameDatasourceColumn()
                const deletable = canDeleteDatasourceColumn(col)
                const draftTitle = colTitleDrafts[col.key] ?? col.title
                const dirty = draftTitle.trim() !== '' && draftTitle.trim() !== col.title
                const selectExpanded = expandedSelectKey === col.key

                return (
                  <div
                    key={col.key}
                    className="st-card group space-y-2.5 p-4 transition-colors hover:border-slate-300"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        {renameable ? (
                          <input
                            type="text"
                            className="st-input st-input-sm border-transparent bg-transparent px-1.5 text-sm font-medium text-slate-900 hover:border-slate-200"
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
                                void commitRename(col, draftTitle)
                              }
                            }}
                          />
                        ) : (
                          <div className="flex items-center gap-1.5 px-1.5 text-sm font-medium text-slate-900">
                            <Lock className="h-3.5 w-3.5 text-slate-400" />
                            <span className="truncate">{col.title}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-xs text-slate-400">
                            {col.key} · {col.type}
                          </span>
                          {(col.isUniqueKey ||
                            (primaryKeyField && col.key === primaryKeyField)) && (
                            <span className="st-badge st-badge-violet">唯一键</span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {renameable && dirty && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void commitRename(col, draftTitle)}
                            className="st-btn st-btn-xs st-btn-primary"
                          >
                            保存名称
                          </button>
                        )}
                        {deletable && (
                          <button
                            type="button"
                            disabled={busy}
                            title={`删除列 ${col.title}`}
                            aria-label={`删除列 ${col.title}`}
                            onClick={() => setConfirmDeleteCol(col)}
                            className="st-icon-btn st-icon-btn-danger"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 原始列基础配置栏：必填、对齐、数值格式、单选配色 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            disabled={busy}
                            aria-label={`${col.title} 必填`}
                            className="st-checkbox"
                            checked={Boolean(col.required)}
                            onChange={(e) =>
                              void patchDatasourceColumn(col.key, { required: e.target.checked })
                            }
                          />
                          <span>必填</span>
                        </label>

                        <div
                          className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5"
                          role="group"
                          aria-label={`${col.title} 对齐`}
                        >
                          {COLUMN_ALIGN_OPTIONS.map(({ value, label, icon: Icon }) => {
                            const active = col.align === value
                            return (
                              <button
                                key={value}
                                type="button"
                                disabled={busy}
                                title={`${col.title} ${label}`}
                                aria-label={`${col.title} ${label}`}
                                aria-pressed={active}
                                onClick={() =>
                                  void patchDatasourceColumn(col.key, {
                                    align: active ? undefined : (value as CellTextAlign),
                                  })
                                }
                                className={`rounded p-1 transition-colors ${
                                  active
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                }`}
                              >
                                <Icon className="h-3 w-3" />
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {col.type === 'number' && (
                          <CustomSelect
                            size="xs"
                            className="w-36"
                            value={col.numberFormat ?? 'decimal'}
                            ariaLabel={`${col.title} 数值格式`}
                            options={NUMBER_FORMAT_OPTIONS}
                            disabled={busy}
                            onChange={(val) =>
                              void patchDatasourceColumn(col.key, { numberFormat: val })
                            }
                          />
                        )}
                        {(col.type === 'number' || col.type === 'progress') && (
                          <CustomSelect
                            size="xs"
                            className="w-28"
                            value={toDecimalPlacesChoice(col.decimalPlaces)}
                            ariaLabel={`${col.title} 小数位数`}
                            options={DECIMAL_PLACES_OPTIONS}
                            disabled={busy}
                            onChange={(val) =>
                              void patchDatasourceColumn(col.key, {
                                decimalPlaces: fromDecimalPlacesChoice(val),
                              })
                            }
                          />
                        )}

                        {col.type === 'select' && (
                          <button
                            type="button"
                            aria-expanded={selectExpanded}
                            onClick={() =>
                              setExpandedSelectKey((prev) => (prev === col.key ? null : col.key))
                            }
                            className="st-btn st-btn-xs st-btn-secondary"
                          >
                            <Palette className="h-3 w-3" />
                            <span>选项配色 ({col.options?.length ?? 0})</span>
                            {selectExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {col.type === 'select' && selectExpanded && (
                      <SelectOptionsEditor
                        options={col.options ?? []}
                        disabled={busy}
                        onChange={(nextOptions: SelectOption[]) =>
                          void patchDatasourceColumn(col.key, { options: nextOptions })
                        }
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="st-modal-footer">
          <button type="button" className="st-btn st-btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmDeleteCol !== null}
        title={isAppMode ? '确认删除派生列' : '确认删除字段列'}
        description={
          isAppMode
            ? `确定要删除当前多维数据台的派生列「${confirmDeleteCol?.title ?? ''}」吗？不会影响底层数据源表。`
            : `确定要删除字段「${confirmDeleteCol?.title ?? ''}」吗？相关筛选、排序与汇总配置将同步移除。`
        }
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
