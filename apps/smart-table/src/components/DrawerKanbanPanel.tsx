// 视图配置抽屉 · 看板配置分栏：管理泳道分组单选字段、卡片标题字段、卡片展示字段勾选与调序、空泳道显隐。

import { ArrowDown, ArrowUp, Eye, EyeOff } from 'lucide-react'
import { reorderStringList } from '../domain/workspace-helpers'
import type { KanbanConfig, SmartColumn } from '../shared/schema'
import { CustomSelect, type CustomSelectOption } from './CustomSelect'

export interface DrawerKanbanPanelProps {
  columns: readonly SmartColumn[]
  config: KanbanConfig
  onChangeConfig: (next: KanbanConfig) => void
}

const TYPE_LABELS: Record<string, string> = {
  select: '单选',
  text: '文本',
  person: '人员',
  date: '日期',
  number: '数值',
  progress: '进度',
  checkbox: '勾选',
  lookup: '关联',
  formula: '公式',
}

export function DrawerKanbanPanel({ columns, config, onChangeConfig }: DrawerKanbanPanelProps) {
  const selectCols = columns.filter((c) => c.type === 'select')
  const writableOtherCols = columns.filter(
    (c) => c.type !== 'select' && c.type !== 'lookup' && c.type !== 'formula',
  )
  const groupCandidates = [...selectCols, ...writableOtherCols]
  const groupOptions: CustomSelectOption<string>[] = (
    groupCandidates.some((c) => c.key === config.groupByField) ? groupCandidates : columns
  ).map((c) => ({
    value: c.key,
    label: c.title,
    hint: TYPE_LABELS[c.type] ?? c.type,
  }))

  const titleOptions: CustomSelectOption<string>[] = columns.map((c) => ({
    value: c.key,
    label: c.title,
    hint: TYPE_LABELS[c.type] ?? c.type,
  }))

  const validDisplayFields = config.displayFields.filter((key) =>
    columns.some((c) => c.key === key),
  )
  const displaySet = new Set(validDisplayFields)
  const unselectedColumns = columns.filter((c) => !displaySet.has(c.key))

  function handleChangeGroupField(nextGroupField: string) {
    const col = columns.find((c) => c.key === nextGroupField)
    const nextDisplay = config.displayFields.filter((k) => k !== nextGroupField)
    onChangeConfig({
      ...config,
      groupByField: nextGroupField,
      displayFields: nextDisplay,
      laneOrder: col?.options?.map((o) => o.label),
    })
  }

  function handleToggleDisplayField(key: string) {
    if (displaySet.has(key)) {
      onChangeConfig({
        ...config,
        displayFields: validDisplayFields.filter((k) => k !== key),
      })
    } else {
      onChangeConfig({
        ...config,
        displayFields: [...validDisplayFields, key],
      })
    }
  }

  function handleMoveDisplayField(fromIdx: number, toIdx: number) {
    onChangeConfig({
      ...config,
      displayFields: reorderStringList(validDisplayFields, fromIdx, toIdx),
    })
  }

  // 展示字段行（已展示：Eye；未展示：EyeOff 琥珀色 + 置灰文案）
  function renderDisplayRow(col: SmartColumn, displayed: boolean, idx: number) {
    return (
      <>
        <span className="st-badge st-badge-gray">{TYPE_LABELS[col.type] ?? col.type}</span>
        <span className={`truncate text-sm ${displayed ? 'text-slate-800' : 'text-slate-400'}`}>
          {col.title}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {displayed && (
            <>
              <button
                type="button"
                disabled={idx === 0}
                aria-label={`上移卡片字段 ${col.title}`}
                onClick={() => handleMoveDisplayField(idx, idx - 1)}
                className="st-icon-btn st-icon-btn-xs"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={idx === validDisplayFields.length - 1}
                aria-label={`下移卡片字段 ${col.title}`}
                onClick={() => handleMoveDisplayField(idx, idx + 1)}
                className="st-icon-btn st-icon-btn-xs"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            aria-label={displayed ? `取消展示 ${col.title}` : `展示卡片字段 ${col.title}`}
            onClick={() => handleToggleDisplayField(col.key)}
            className={`st-icon-btn st-icon-btn-xs ${displayed ? '' : 'text-amber-500'}`}
          >
            {displayed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="space-y-5">
      {/* 泳道分组字段 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="st-section-label">泳道分组字段</h3>
          {selectCols.length > 0 && (
            <span className="text-xs text-slate-500">推荐单选列，支持拖拽改状态</span>
          )}
        </div>
        <CustomSelect
          size="sm"
          className="w-full"
          value={config.groupByField}
          ariaLabel="泳道分组字段"
          options={groupOptions}
          onChange={handleChangeGroupField}
        />
      </section>

      {/* 卡片标题字段 */}
      <section className="space-y-2">
        <h3 className="st-section-label">卡片主标题字段</h3>
        <CustomSelect
          size="sm"
          className="w-full"
          value={config.titleField ?? columns[0]?.key ?? ''}
          ariaLabel="卡片标题字段"
          options={titleOptions}
          onChange={(val) => onChangeConfig({ ...config, titleField: val })}
        />
      </section>

      {/* 卡片展示字段 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="st-section-label">卡片展示字段（已选 {validDisplayFields.length}）</h3>
          {validDisplayFields.length > 0 && (
            <button
              type="button"
              onClick={() => onChangeConfig({ ...config, displayFields: [] })}
              className="st-btn st-btn-xs st-btn-ghost"
            >
              清空
            </button>
          )}
        </div>

        <div className="space-y-0.5">
          {validDisplayFields.map((key, idx) => {
            const col = columns.find((c) => c.key === key)
            if (!col) return null
            return (
              <div
                key={key}
                className="group flex h-9 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-slate-50"
              >
                {renderDisplayRow(col, true, idx)}
              </div>
            )
          })}

          {unselectedColumns.map((col) => (
            <div
              key={col.key}
              className="group flex h-9 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-slate-50"
            >
              {renderDisplayRow(col, false, -1)}
            </div>
          ))}
        </div>
      </section>

      {/* 泳道显示选项 */}
      <section className="space-y-2">
        <h3 className="st-section-label">泳道展示选项</h3>
        <label className="flex cursor-pointer items-center justify-between gap-3 px-2 py-1">
          <span className="text-sm text-slate-700">隐藏空泳道（无记录时不显示）</span>
          <input
            type="checkbox"
            className="st-checkbox"
            checked={Boolean(config.hideEmptyLanes)}
            onChange={(e) => onChangeConfig({ ...config, hideEmptyLanes: e.target.checked })}
          />
        </label>
      </section>
    </div>
  )
}
