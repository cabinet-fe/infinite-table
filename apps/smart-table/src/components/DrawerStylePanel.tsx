// 视图配置抽屉 · 样式与条件格式分栏：冻结列数、行高档位、列级对齐/配色、选区背景/文字色设置与清除、条件格式规则增删改

import { useEffect, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Eraser, Minus, Plus, Trash2 } from 'lucide-react'
import type { SmartGridSelectionInfo } from '../canvas/smart-grid'
import { scalarToText } from '../domain/utils'
import { applyCellStyleToSelection } from '../domain/workspace-helpers'
import type {
  CellTextAlign,
  ColumnStyleConfig,
  ConditionalFormatRule,
  ConditionalFormatScope,
  FilterOperator,
  RowHeightPreset,
  SmartColumn,
  WorkspaceView,
} from '../shared/schema'
import { CustomSelect } from './CustomSelect'

export interface DrawerStylePanelProps {
  view: WorkspaceView
  columns: readonly SmartColumn[]
  selectionInfo: SmartGridSelectionInfo
  initialColumnKey?: string
  onUpdateView: (patch: Partial<WorkspaceView>) => void
}

const ROW_HEIGHT_OPTIONS: { value: RowHeightPreset; label: string }[] = [
  { value: 'compact', label: '紧凑 (32)' },
  { value: 'standard', label: '标准 (38)' },
  { value: 'comfortable', label: '宽松 (52)' },
]

const COLOR_PRESETS: readonly { label: string; bg: string; text: string }[] = [
  { label: '警示红', bg: '#fef2f2', text: '#991b1b' },
  { label: '达标绿', bg: '#dcfce7', text: '#166534' },
  { label: '提醒黄', bg: '#fef9c3', text: '#854d0e' },
  { label: '重点蓝', bg: '#eff6ff', text: '#1e40af' },
  { label: '高亮紫', bg: '#f3e8ff', text: '#6b21a8' },
  { label: '浅灰底', bg: '#f8fafc', text: '#334155' },
]

const CF_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'is_empty', label: '为空' },
  { value: 'is_not_empty', label: '不为空' },
]

// 「小色块 + 文案」配色 chip（选中：浅蓝底蓝描边）
function ColorChip({
  label,
  bg,
  title,
  selected,
  disabled,
  onClick,
}: {
  label: string
  bg: string
  title: string
  selected?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-selected={selected ? 'true' : undefined}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
        selected
          ? 'border-blue-300 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      } disabled:pointer-events-none disabled:opacity-40`}
    >
      <span
        className="h-3 w-3 shrink-0 rounded-full border border-slate-200"
        style={{ backgroundColor: bg }}
      />
      <span>{label}</span>
    </button>
  )
}

export function DrawerStylePanel({
  view,
  columns,
  selectionInfo,
  initialColumnKey,
  onUpdateView,
}: DrawerStylePanelProps) {
  const [targetColKey, setTargetColKey] = useState(initialColumnKey || columns[0]?.key || '')
  const [cfField, setCfField] = useState(columns[0]?.key || '')
  const [cfOperator, setCfOperator] = useState<FilterOperator>('eq')
  const [cfValue, setCfValue] = useState('')
  const [cfScope, setCfScope] = useState<ConditionalFormatScope>('row')
  const [cfPresetIdx, setCfPresetIdx] = useState(0)
  const [cfName, setCfName] = useState('')

  useEffect(() => {
    if (initialColumnKey && columns.some((c) => c.key === initialColumnKey)) {
      setTargetColKey(initialColumnKey)
    } else if (!columns.some((c) => c.key === targetColKey)) {
      setTargetColKey(columns[0]?.key ?? '')
    }
  }, [initialColumnKey, columns, targetColKey])

  useEffect(() => {
    if (!columns.some((c) => c.key === cfField)) {
      setCfField(columns[0]?.key ?? '')
    }
  }, [columns, cfField])

  const frozenCount = view.frozenColCount ?? 0
  const maxFrozen = Math.min(6, columns.length)
  const rowHeight = view.rowHeight ?? 'standard'
  const activeColStyle: ColumnStyleConfig = view.columnStyles?.[targetColKey] ?? {}

  function patchColumnStyle(patch: Partial<ColumnStyleConfig> | null) {
    if (!targetColKey) return
    const nextMap = { ...view.columnStyles }
    if (patch === null) {
      delete nextMap[targetColKey]
    } else {
      const merged: ColumnStyleConfig = { ...nextMap[targetColKey], ...patch }
      if (merged.align === undefined) delete merged.align
      if (merged.headerBgColor === undefined) delete merged.headerBgColor
      if (merged.headerTextColor === undefined) delete merged.headerTextColor
      if (merged.bgColor === undefined) delete merged.bgColor
      if (merged.textColor === undefined) delete merged.textColor
      if (Object.keys(merged).length === 0) delete nextMap[targetColKey]
      else nextMap[targetColKey] = merged
    }
    onUpdateView({
      columnStyles: Object.keys(nextMap).length > 0 ? nextMap : undefined,
    })
  }

  function handleSelectionStyle(bgColor?: string, textColor?: string, clear = false) {
    if (selectionInfo.ranges.length === 0) return
    const nextCellStyles = applyCellStyleToSelection(
      view.cellStyles,
      selectionInfo,
      clear ? null : { bgColor, textColor },
    )
    onUpdateView({ cellStyles: nextCellStyles })
  }

  function handleAddConditionalRule(e: React.FormEvent) {
    e.preventDefault()
    if (!cfField) return
    const preset = COLOR_PRESETS[cfPresetIdx] ?? COLOR_PRESETS[0]!
    const colTitle = columns.find((c) => c.key === cfField)?.title ?? cfField
    const needsVal = cfOperator !== 'is_empty' && cfOperator !== 'is_not_empty'
    const parsedVal =
      needsVal && cfValue.trim() !== '' && !Number.isNaN(Number(cfValue.trim()))
        ? Number(cfValue.trim())
        : cfValue.trim()

    const nextRule: ConditionalFormatRule = {
      id: `cf_${Date.now().toString(36)}`,
      name: cfName.trim() || `${colTitle}条件格式`,
      enabled: true,
      field: cfField,
      operator: cfOperator,
      value: needsVal ? parsedVal : '',
      scope: cfScope,
      bgColor: preset.bg,
      textColor: preset.text,
    }
    onUpdateView({
      conditionalFormats: [...(view.conditionalFormats ?? []), nextRule],
    })
    setCfName('')
    setCfValue('')
  }

  const selectionCount = selectionInfo.recordIds.length * selectionInfo.columnKeys.length

  return (
    <div className="space-y-5">
      {/* 布局与密度 */}
      <section className="space-y-2.5">
        <h3 className="st-section-label">布局与密度</h3>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-700">左侧冻结列数</span>
          <div className="inline-flex items-center rounded-lg border border-slate-200">
            <button
              type="button"
              disabled={frozenCount <= 0}
              onClick={() => onUpdateView({ frozenColCount: Math.max(0, frozenCount - 1) })}
              className="st-icon-btn"
              aria-label="减少冻结列"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-8 text-center text-sm text-slate-800 tabular-nums">
              {frozenCount}
            </span>
            <button
              type="button"
              disabled={frozenCount >= maxFrozen}
              onClick={() => onUpdateView({ frozenColCount: Math.min(maxFrozen, frozenCount + 1) })}
              className="st-icon-btn"
              aria-label="增加冻结列"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-700">行高档位</span>
          <div className="flex items-center gap-1.5">
            {ROW_HEIGHT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onUpdateView({ rowHeight: opt.value })}
                className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  rowHeight === opt.value
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 列级样式与对齐 */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="st-section-label">列级样式与配色</h3>
          {Object.keys(activeColStyle).length > 0 && (
            <button
              type="button"
              onClick={() => patchColumnStyle(null)}
              className="st-btn st-btn-xs st-btn-ghost"
            >
              重置此列
            </button>
          )}
        </div>

        <CustomSelect
          size="sm"
          className="w-full"
          value={targetColKey}
          ariaLabel="选择设置样式的列"
          options={columns.map((c) => ({ value: c.key, label: c.title }))}
          onChange={setTargetColKey}
        />

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-700">水平对齐</span>
          <div className="st-segment w-32">
            {(
              [
                { val: 'left', icon: AlignLeft, title: '左对齐' },
                { val: 'center', icon: AlignCenter, title: '居中对齐' },
                { val: 'right', icon: AlignRight, title: '右对齐' },
              ] as const
            ).map(({ val, icon: Icon, title }) => {
              const active = activeColStyle.align === val
              return (
                <button
                  key={val}
                  type="button"
                  title={title}
                  aria-label={title}
                  onClick={() =>
                    patchColumnStyle({ align: active ? undefined : (val as CellTextAlign) })
                  }
                  className={`st-segment-item ${active ? 'st-segment-item-active' : ''}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-700">列头配色</span>
            {activeColStyle.headerBgColor && (
              <button
                type="button"
                onClick={() =>
                  patchColumnStyle({ headerBgColor: undefined, headerTextColor: undefined })
                }
                className="st-btn st-btn-xs st-btn-ghost"
              >
                清除
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.map((p) => (
              <ColorChip
                key={`hdr-${p.bg}`}
                label={p.label}
                bg={p.bg}
                title={`列头 · ${p.label}`}
                selected={activeColStyle.headerBgColor === p.bg}
                onClick={() => patchColumnStyle({ headerBgColor: p.bg, headerTextColor: p.text })}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-700">整列底色与文字色</span>
            {activeColStyle.bgColor && (
              <button
                type="button"
                onClick={() => patchColumnStyle({ bgColor: undefined, textColor: undefined })}
                className="st-btn st-btn-xs st-btn-ghost"
              >
                清除
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.map((p) => (
              <ColorChip
                key={`col-${p.bg}`}
                label={p.label}
                bg={p.bg}
                title={`整列 · ${p.label}`}
                selected={activeColStyle.bgColor === p.bg}
                onClick={() => patchColumnStyle({ bgColor: p.bg, textColor: p.text })}
              />
            ))}
          </div>
        </div>
      </section>

      {/* 当前选区自定义配色 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="st-section-label">当前选区配色</h3>
          <span className="text-xs text-slate-500">
            {selectionCount > 0 ? `已选中 ${selectionCount} 格` : '请在画布框选单元格'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {COLOR_PRESETS.map((p) => (
            <ColorChip
              key={`sel-${p.bg}`}
              label={p.label}
              bg={p.bg}
              title={`应用到选区：${p.label}`}
              disabled={selectionCount === 0}
              onClick={() => handleSelectionStyle(p.bg, p.text)}
            />
          ))}
          <button
            type="button"
            disabled={selectionCount === 0}
            onClick={() => handleSelectionStyle(undefined, undefined, true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
          >
            <Eraser className="h-3.5 w-3.5 shrink-0" />
            <span>清除选区</span>
          </button>
        </div>
      </section>

      {/* 条件格式规则 */}
      <section className="space-y-2.5">
        <h3 className="st-section-label">条件格式规则 ({view.conditionalFormats?.length ?? 0})</h3>

        <div className="space-y-1.5">
          {(view.conditionalFormats ?? []).map((rule) => {
            const fieldTitle = columns.find((c) => c.key === rule.field)?.title ?? rule.field
            const enabled = rule.enabled !== false
            return (
              <div
                key={rule.id}
                className="st-card group flex items-center justify-between gap-2 p-3"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) =>
                      onUpdateView({
                        conditionalFormats: (view.conditionalFormats ?? []).map((r) =>
                          r.id === rule.id ? { ...r, enabled: e.target.checked } : r,
                        ),
                      })
                    }
                    className="st-checkbox"
                  />
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded border border-slate-200"
                    style={{ backgroundColor: rule.bgColor ?? '#fef2f2' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-800">{rule.name || fieldTitle}</div>
                    <div className="truncate text-xs text-slate-600">
                      {fieldTitle} {rule.operator} {scalarToText(rule.value)} ·{' '}
                      {rule.scope === 'row' ? '整行' : '单元格'}
                    </div>
                  </div>
                </label>
                <button
                  type="button"
                  aria-label="删除条件格式"
                  onClick={() =>
                    onUpdateView({
                      conditionalFormats: (view.conditionalFormats ?? []).filter(
                        (r) => r.id !== rule.id,
                      ),
                    })
                  }
                  className="st-icon-btn st-icon-btn-xs st-icon-btn-danger opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>

        <form
          onSubmit={(e) => handleAddConditionalRule(e)}
          className="space-y-2 rounded-xl border border-dashed border-slate-200 p-3"
        >
          <input
            type="text"
            className="st-input st-input-sm"
            placeholder="规则名称（可选）"
            value={cfName}
            onChange={(e) => setCfName(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <CustomSelect
              size="xs"
              value={cfField}
              ariaLabel="条件格式字段"
              options={columns.map((c) => ({ value: c.key, label: c.title }))}
              onChange={setCfField}
            />
            <CustomSelect
              size="xs"
              value={cfOperator}
              ariaLabel="条件格式操作符"
              options={CF_OPERATORS}
              onChange={setCfOperator}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {cfOperator !== 'is_empty' && cfOperator !== 'is_not_empty' ? (
              <input
                type="text"
                className="st-input st-input-sm"
                placeholder="比较值"
                value={cfValue}
                onChange={(e) => setCfValue(e.target.value)}
              />
            ) : (
              <div />
            )}
            <CustomSelect
              size="xs"
              value={cfScope}
              ariaLabel="作用范围"
              options={[
                { value: 'row', label: '整行高亮' },
                { value: 'cell', label: '仅单元格' },
              ]}
              onChange={setCfScope}
            />
          </div>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-1">
              {COLOR_PRESETS.slice(0, 5).map((p, idx) => (
                <button
                  key={`cf-swatch-${p.bg}`}
                  type="button"
                  title={p.label}
                  aria-label={p.label}
                  onClick={() => setCfPresetIdx(idx)}
                  className={`h-5 w-5 rounded-full border transition-transform ${
                    cfPresetIdx === idx
                      ? 'scale-110 border-blue-500 ring-2 ring-blue-500/30'
                      : 'border-slate-200'
                  }`}
                  style={{ backgroundColor: p.bg }}
                />
              ))}
            </div>
            <button type="submit" className="st-btn st-btn-sm st-btn-secondary">
              <Plus className="h-3.5 w-3.5" />
              <span>添加规则</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
