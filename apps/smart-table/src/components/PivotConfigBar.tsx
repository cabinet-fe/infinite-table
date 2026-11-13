// 透视表配置栏：管理行维度、列维度、指标与聚合方式（求和/计数/均值/最大/最小），以及展开/收起/折叠开关

import { useState } from 'react'
import { columnsToPivotFields } from '../canvas/smart-pivot'
import type {
  SmartColumn,
  SmartPivotAgg,
  SmartPivotConfig,
  SmartPivotMeasureConfig,
} from '../shared/schema'

export interface PivotConfigBarProps {
  columns: readonly SmartColumn[]
  config: SmartPivotConfig
  onChangeConfig: (next: SmartPivotConfig) => void
  onExpandAll: () => void
  onCollapseAll: () => void
}

const AGG_LABELS: Record<SmartPivotAgg, string> = {
  sum: '求和',
  count: '计数',
  avg: '均值',
  min: '最小',
  max: '最大',
}

export function PivotConfigBar({
  columns,
  config,
  onChangeConfig,
  onExpandAll,
  onCollapseAll,
}: PivotConfigBarProps) {
  const [addingTarget, setAddingTarget] = useState<'row' | 'col' | 'measure' | null>(null)
  const { dimensions, measures } = columnsToPivotFields(columns)

  const usedDims = new Set([...config.rowDimensions, ...config.columnDimensions])
  const availableDims = dimensions.filter((d) => !usedDims.has(d.key))

  function addDimension(target: 'row' | 'col', key: string) {
    if (!key) return
    if (target === 'row') {
      onChangeConfig({ ...config, rowDimensions: [...config.rowDimensions, key] })
    } else {
      onChangeConfig({ ...config, columnDimensions: [...config.columnDimensions, key] })
    }
    setAddingTarget(null)
  }

  function removeDimension(target: 'row' | 'col', key: string) {
    if (target === 'row') {
      onChangeConfig({
        ...config,
        rowDimensions: config.rowDimensions.filter((k) => k !== key),
      })
    } else {
      onChangeConfig({
        ...config,
        columnDimensions: config.columnDimensions.filter((k) => k !== key),
      })
    }
  }

  function addMeasure(fieldKey: string) {
    const candidate = measures.find((m) => m.key === fieldKey)
    if (!candidate) return
    const nextMeasure: SmartPivotMeasureConfig = {
      key: `${candidate.field}_${Date.now().toString(36).slice(-4)}`,
      title: candidate.title,
      field: candidate.field,
      agg: candidate.agg,
      width: candidate.width,
    }
    onChangeConfig({
      ...config,
      measures: [...config.measures, nextMeasure],
    })
    setAddingTarget(null)
  }

  function updateMeasureAgg(measureKey: string, agg: SmartPivotAgg) {
    onChangeConfig({
      ...config,
      measures: config.measures.map((m) =>
        m.key === measureKey
          ? {
              ...m,
              agg,
              title: `${colTitleOf(columns, m.field)}(${AGG_LABELS[agg]})`,
            }
          : m,
      ),
    })
  }

  function removeMeasure(measureKey: string) {
    if (config.measures.length <= 1) {
      return
    }
    onChangeConfig({
      ...config,
      measures: config.measures.filter((m) => m.key !== measureKey),
    })
  }

  return (
    <section className="st-pivot-config" aria-label="透视表维度与指标配置">
      <div className="st-pivot-row">
        <div className="st-pivot-slot">
          <span className="st-slot-label">行维度</span>
          <div className="st-pill-list">
            {config.rowDimensions.map((key) => (
              <span key={key} className="st-pill st-pill-dim">
                <span>{colTitleOf(columns, key)}</span>
                <button
                  type="button"
                  className="st-pill-x"
                  onClick={() => removeDimension('row', key)}
                  aria-label={`移除行维度 ${colTitleOf(columns, key)}`}
                >
                  ×
                </button>
              </span>
            ))}
            {availableDims.length > 0 && (
              <button
                type="button"
                className="st-btn st-btn-xs"
                onClick={() => setAddingTarget(addingTarget === 'row' ? null : 'row')}
              >
                + 添加
              </button>
            )}
            {addingTarget === 'row' && (
              <select
                className="st-select st-select-xs"
                defaultValue=""
                onChange={(e) => addDimension('row', e.target.value)}
                autoFocus
              >
                <option value="" disabled>
                  选择行维度...
                </option>
                {availableDims.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="st-pivot-slot">
          <span className="st-slot-label">列维度</span>
          <div className="st-pill-list">
            {config.columnDimensions.map((key) => (
              <span key={key} className="st-pill st-pill-dim">
                <span>{colTitleOf(columns, key)}</span>
                <button
                  type="button"
                  className="st-pill-x"
                  onClick={() => removeDimension('col', key)}
                  aria-label={`移除列维度 ${colTitleOf(columns, key)}`}
                >
                  ×
                </button>
              </span>
            ))}
            {availableDims.length > 0 && (
              <button
                type="button"
                className="st-btn st-btn-xs"
                onClick={() => setAddingTarget(addingTarget === 'col' ? null : 'col')}
              >
                + 添加
              </button>
            )}
            {addingTarget === 'col' && (
              <select
                className="st-select st-select-xs"
                defaultValue=""
                onChange={(e) => addDimension('col', e.target.value)}
                autoFocus
              >
                <option value="" disabled>
                  选择列维度...
                </option>
                {availableDims.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="st-pivot-row">
        <div className="st-pivot-slot st-pivot-slot-grow">
          <span className="st-slot-label">指标</span>
          <div className="st-pill-list">
            {config.measures.map((m) => (
              <span key={m.key} className="st-pill st-pill-measure">
                <span>{colTitleOf(columns, m.field)}</span>
                <select
                  className="st-pill-agg-select"
                  value={m.agg}
                  aria-label={`${m.title} 聚合方式`}
                  onChange={(e) => updateMeasureAgg(m.key, e.target.value as SmartPivotAgg)}
                >
                  {(Object.keys(AGG_LABELS) as SmartPivotAgg[]).map((agg) => (
                    <option key={agg} value={agg}>
                      {AGG_LABELS[agg]}
                    </option>
                  ))}
                </select>
                {config.measures.length > 1 && (
                  <button
                    type="button"
                    className="st-pill-x"
                    onClick={() => removeMeasure(m.key)}
                    aria-label={`移除指标 ${m.title}`}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            <button
              type="button"
              className="st-btn st-btn-xs"
              onClick={() => setAddingTarget(addingTarget === 'measure' ? null : 'measure')}
            >
              + 添加指标
            </button>
            {addingTarget === 'measure' && (
              <select
                className="st-select st-select-xs"
                defaultValue=""
                onChange={(e) => addMeasure(e.target.value)}
                autoFocus
              >
                <option value="" disabled>
                  选择汇总列...
                </option>
                {measures.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="st-pivot-actions">
          <label className="st-checkbox-label">
            <input
              type="checkbox"
              checked={config.collapsible ?? true}
              onChange={(e) => onChangeConfig({ ...config, collapsible: e.target.checked })}
            />
            <span>树形折叠</span>
          </label>
          <button type="button" className="st-btn st-btn-xs" onClick={onExpandAll}>
            全部展开
          </button>
          <button type="button" className="st-btn st-btn-xs" onClick={onCollapseAll}>
            全部收起
          </button>
          <span className="st-hint-text">💡 双击数据格可查看明细或继续下钻</span>
        </div>
      </div>
    </section>
  )
}

function colTitleOf(columns: readonly SmartColumn[], fieldKey: string): string {
  if (fieldKey === '__count__') {
    return '记录数'
  }
  return columns.find((c) => c.key === fieldKey)?.title ?? fieldKey
}
