// 字段管理弹窗：数据源中心模式管理原始字段结构/必填/对齐/格式/单选配色；
// SmartApp 模式展示源表原始列（只读 + 跳转数据源中心）并增删改当前应用的 lookup/formula 派生列。

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Database,
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
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isAppMode ? '智能表格派生列管理' : '数据源字段管理'}
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {isAppMode ? '智能表格派生列管理' : '数据源字段管理'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isAppMode
                ? '增删改当前智能表格共享的 VLOOKUP 关联列与公式列，源表原始列在此只读展示'
                : tableKind === 'advanced'
                  ? 'SQL 主数据物理列名称与删列受锁定，可配置必填、对齐、数值格式与单选配色'
                  : '管理原始字段名称、删列及必填、对齐、数值格式与单选标签配色'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[65vh] space-y-5 overflow-y-auto px-5 py-4">
          {isAppMode ? (
            <>
              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-800">
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
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
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
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>新增 VLOOKUP</span>
                      </button>
                    )}
                  </div>
                </div>

                {effectiveDerivedColumns.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-xs text-slate-500">
                    暂无派生列，可通过上方按钮新增计算公式列或 VLOOKUP 关联列。
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
                          className="space-y-2.5 rounded-lg border border-slate-200/90 bg-slate-50/50 px-3 py-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1 space-y-1">
                              <input
                                type="text"
                                className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
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
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                    col.type === 'lookup'
                                      ? 'bg-blue-50 text-blue-700'
                                      : 'bg-purple-50 text-purple-700'
                                  }`}
                                >
                                  {col.type === 'lookup' ? 'VLOOKUP 关联' : '公式计算'}
                                </span>
                                <span>{col.key}</span>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                              {titleDirty && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void commitRename(col, draftTitle)}
                                  className="h-6 rounded bg-blue-600 px-2 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
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
                                  className="rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-blue-600"
                                >
                                  <Settings className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                title={`删除派生列 ${col.title}`}
                                aria-label={`删除派生列 ${col.title}`}
                                onClick={() => setConfirmDeleteCol(col)}
                                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {col.type === 'formula' && (
                            <div className="space-y-1.5 border-t border-slate-200/70 pt-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
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
                                    className="h-7 shrink-0 rounded-md bg-blue-600 px-2.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                                  >
                                    保存公式
                                  </button>
                                )}
                              </div>
                              {!formulaValidation.valid && (
                                <div className="text-[11px] text-red-600">
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

              <section className="space-y-2 border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5 text-slate-400" />
                    <h3 className="text-xs font-semibold text-slate-700">
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
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Database className="h-3.5 w-3.5 text-slate-500" />
                      <span>前往数据源中心管理</span>
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {rawColumns.map((col) => (
                    <div
                      key={col.key}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Lock className="h-3 w-3 shrink-0 text-slate-400" />
                        <span className="truncate font-medium text-slate-700">{col.title}</span>
                        {col.required && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                            必填
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-400">
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
                    className="space-y-2 rounded-lg border border-slate-200/80 bg-slate-50/50 px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        {renameable ? (
                          <input
                            type="text"
                            className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
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
                          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                            <Lock className="h-3 w-3 text-slate-400" />
                            <span className="truncate">{col.title}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          <span>
                            {col.key} · {col.type}
                          </span>
                          {(col.isUniqueKey ||
                            (primaryKeyField && col.key === primaryKeyField)) && (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                              唯一键
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {renameable && dirty && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void commitRename(col, draftTitle)}
                            className="h-6 rounded bg-blue-600 px-2 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
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
                            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 原始列基础配置栏：必填、对齐、数值格式、单选配色 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            disabled={busy}
                            aria-label={`${col.title} 必填`}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
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

                      <div className="flex items-center gap-2">
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
                            className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Palette className="h-3 w-3 text-slate-500" />
                            <span>选项配色 ({col.options?.length ?? 0})</span>
                            {selectExpanded ? (
                              <ChevronDown className="h-3 w-3 text-slate-400" />
                            ) : (
                              <ChevronRight className="h-3 w-3 text-slate-400" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {col.type === 'select' && selectExpanded && (
                      <div className="pt-1">
                        <SelectOptionsEditor
                          options={col.options ?? []}
                          disabled={busy}
                          onChange={(nextOptions: SelectOption[]) =>
                            void patchDatasourceColumn(col.key, { options: nextOptions })
                          }
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <button
            type="button"
            className="h-8 rounded-md border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            完成
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmDeleteCol !== null}
        title={isAppMode ? '确认删除派生列' : '确认删除字段列'}
        description={
          isAppMode
            ? `确定要删除当前智能表格的派生列「${confirmDeleteCol?.title ?? ''}」吗？不会影响底层数据源表。`
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
