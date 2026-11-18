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

  return (
    <div className="space-y-5">
      {/* 泳道分组字段 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800">泳道分组字段（单选/状态）</h3>
          {selectCols.length > 0 && (
            <span className="text-[10px] text-slate-400">推荐单选列支持拖拽改状态</span>
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
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-semibold text-slate-800">卡片主标题字段</h3>
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
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800">
            卡片展示字段（已选 {validDisplayFields.length}）
          </h3>
          {validDisplayFields.length > 0 && (
            <button
              type="button"
              onClick={() => onChangeConfig({ ...config, displayFields: [] })}
              className="text-[11px] text-slate-500 hover:text-slate-800"
            >
              清空
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          {validDisplayFields.map((key, idx) => {
            const col = columns.find((c) => c.key === key)
            if (!col) return null
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-2 rounded-lg border border-blue-200/80 bg-blue-50/40 px-2.5 py-1.5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-xs font-medium text-slate-800">{col.title}</span>
                  <span className="shrink-0 rounded bg-white px-1 py-0.2 text-[10px] text-slate-400">
                    {TYPE_LABELS[col.type] ?? col.type}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    aria-label={`上移卡片字段 ${col.title}`}
                    onClick={() => handleMoveDisplayField(idx, idx - 1)}
                    className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === validDisplayFields.length - 1}
                    aria-label={`下移卡片字段 ${col.title}`}
                    onClick={() => handleMoveDisplayField(idx, idx + 1)}
                    className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`取消展示 ${col.title}`}
                    onClick={() => handleToggleDisplayField(key)}
                    className="rounded p-1 text-blue-600 hover:bg-white"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}

          {unselectedColumns.map((col) => (
            <div
              key={col.key}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-slate-50/60 px-2.5 py-1.5 text-slate-500"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-xs">{col.title}</span>
                <span className="shrink-0 rounded bg-slate-100 px-1 py-0.2 text-[10px] text-slate-400">
                  {TYPE_LABELS[col.type] ?? col.type}
                </span>
              </div>
              <button
                type="button"
                aria-label={`展示卡片字段 ${col.title}`}
                onClick={() => handleToggleDisplayField(col.key)}
                className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
              >
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 泳道显示选项 */}
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-semibold text-slate-800">泳道展示选项</h3>
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
          <span>隐藏空泳道（无记录时不显示）</span>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
            checked={Boolean(config.hideEmptyLanes)}
            onChange={(e) => onChangeConfig({ ...config, hideEmptyLanes: e.target.checked })}
          />
        </label>
      </section>
    </div>
  )
}
