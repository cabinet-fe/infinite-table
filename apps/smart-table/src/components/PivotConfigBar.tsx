// 透视表配置栏：管理行/列维度（互斥防重复+保留至少1个行维度）、指标与聚合方式（锁定记录数）及总计/折叠开关

import { columnsToPivotFields } from '../canvas/smart-pivot'
import type {
  SmartColumn,
  SmartPivotAgg,
  SmartPivotConfig,
  SmartPivotMeasureConfig,
} from '../shared/schema'
import { CustomSelect, type CustomSelectOption } from './CustomSelect'
import { LightbulbIcon, LockIcon, XIcon } from './Icons'

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

const AGG_OPTIONS: CustomSelectOption<SmartPivotAgg>[] = (
  Object.keys(AGG_LABELS) as SmartPivotAgg[]
).map((agg) => ({
  value: agg,
  label: AGG_LABELS[agg],
}))

function isCountRecordMeasure(fieldKey: string): boolean {
  return fieldKey === '' || fieldKey === '__count__'
}

function colTitleOf(columns: readonly SmartColumn[], fieldKey: string): string {
  if (isCountRecordMeasure(fieldKey)) {
    return '记录数'
  }
  return columns.find((c) => c.key === fieldKey)?.title ?? fieldKey
}

export function PivotConfigBar({
  columns,
  config,
  onChangeConfig,
  onExpandAll,
  onCollapseAll,
}: PivotConfigBarProps) {
  const { dimensions, measures } = columnsToPivotFields(columns)

  const usedDims = new Set([...config.rowDimensions, ...config.columnDimensions])
  const availableDimOptions: CustomSelectOption<string>[] = dimensions
    .filter((d) => !usedDims.has(d.key))
    .map((d) => ({ value: d.key, label: d.title }))

  const measureOptions: CustomSelectOption<string>[] = measures.map((m) => ({
    value: m.key,
    label: m.title,
  }))

  function addDimension(target: 'row' | 'col', key: string) {
    if (!key || usedDims.has(key)) return
    if (target === 'row') {
      onChangeConfig({ ...config, rowDimensions: [...config.rowDimensions, key] })
    } else {
      onChangeConfig({ ...config, columnDimensions: [...config.columnDimensions, key] })
    }
  }

  function removeDimension(target: 'row' | 'col', key: string) {
    if (target === 'row') {
      if (config.rowDimensions.length <= 1) return
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
      agg: isCountRecordMeasure(candidate.field) ? 'count' : candidate.agg,
      width: candidate.width,
    }
    onChangeConfig({
      ...config,
      measures: [...config.measures, nextMeasure],
    })
  }

  function updateMeasureAgg(measureKey: string, agg: SmartPivotAgg) {
    onChangeConfig({
      ...config,
      measures: config.measures.map((m) => {
        if (m.key !== measureKey || isCountRecordMeasure(m.field)) {
          return m
        }
        return {
          ...m,
          agg,
          title: `${colTitleOf(columns, m.field)}(${AGG_LABELS[agg]})`,
        }
      }),
    })
  }

  function removeMeasure(measureKey: string) {
    if (config.measures.length <= 1) return
    onChangeConfig({
      ...config,
      measures: config.measures.filter((m) => m.key !== measureKey),
    })
  }

  const rowDimLocked = config.rowDimensions.length <= 1

  return (
    <section className="st-pivot-config" aria-label="透视表维度与指标配置">
      <div className="st-pivot-row">
        <div className="st-pivot-slot">
          <span className="st-slot-label">行维度</span>
          <div className="st-pill-list">
            {config.rowDimensions.map((key) => {
              const label = colTitleOf(columns, key)
              return (
                <span key={key} className="st-pill st-pill-dim">
                  <span>{label}</span>
                  <button
                    type="button"
                    className="st-pill-x"
                    disabled={rowDimLocked}
                    title={rowDimLocked ? '至少保留 1 个行维度' : `移除行维度 ${label}`}
                    aria-label={`移除行维度 ${label}`}
                    onClick={() => removeDimension('row', key)}
                  >
                    <XIcon size={11} />
                  </button>
                </span>
              )
            })}
            {availableDimOptions.length > 0 && (
              <CustomSelect
                size="xs"
                value=""
                triggerLabel="+ 添加"
                ariaLabel="添加行维度"
                options={availableDimOptions}
                onChange={(key) => addDimension('row', key)}
              />
            )}
          </div>
        </div>

        <div className="st-pivot-slot">
          <span className="st-slot-label">列维度</span>
          <div className="st-pill-list">
            {config.columnDimensions.map((key) => {
              const label = colTitleOf(columns, key)
              return (
                <span key={key} className="st-pill st-pill-dim">
                  <span>{label}</span>
                  <button
                    type="button"
                    className="st-pill-x"
                    aria-label={`移除列维度 ${label}`}
                    onClick={() => removeDimension('col', key)}
                  >
                    <XIcon size={11} />
                  </button>
                </span>
              )
            })}
            {availableDimOptions.length > 0 && (
              <CustomSelect
                size="xs"
                value=""
                triggerLabel="+ 添加"
                ariaLabel="添加列维度"
                options={availableDimOptions}
                onChange={(key) => addDimension('col', key)}
              />
            )}
          </div>
        </div>
      </div>

      <div className="st-pivot-row">
        <div className="st-pivot-slot st-pivot-slot-grow">
          <span className="st-slot-label">指标</span>
          <div className="st-pill-list">
            {config.measures.map((m) => {
              const isCount = isCountRecordMeasure(m.field)
              const displayName = colTitleOf(columns, m.field)
              return (
                <span key={m.key} className="st-pill st-pill-measure">
                  <span>{displayName}</span>
                  {isCount ? (
                    <span className="st-pill-agg-locked" title="记录数仅支持计数">
                      <LockIcon size={10} />
                      <span>计数</span>
                    </span>
                  ) : (
                    <CustomSelect
                      size="xs"
                      variant="pill"
                      value={m.agg}
                      options={AGG_OPTIONS}
                      ariaLabel={`${displayName} 聚合方式`}
                      onChange={(agg) => updateMeasureAgg(m.key, agg)}
                    />
                  )}
                  {config.measures.length > 1 && (
                    <button
                      type="button"
                      className="st-pill-x"
                      onClick={() => removeMeasure(m.key)}
                      aria-label={`移除指标 ${displayName}`}
                    >
                      <XIcon size={11} />
                    </button>
                  )}
                </span>
              )
            })}
            <CustomSelect
              size="xs"
              value=""
              triggerLabel="+ 添加指标"
              ariaLabel="添加汇总指标"
              options={measureOptions}
              onChange={addMeasure}
            />
          </div>
        </div>

        <div className="st-pivot-actions">
          <label className="st-checkbox-label">
            <input
              type="checkbox"
              className="st-checkbox"
              checked={config.showGrandTotal ?? true}
              onChange={(e) => onChangeConfig({ ...config, showGrandTotal: e.target.checked })}
            />
            <span>显示总计</span>
          </label>
          <label className="st-checkbox-label">
            <input
              type="checkbox"
              className="st-checkbox"
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
          <span className="st-hint-text">
            <LightbulbIcon size={13} />
            <span>双击数据格下钻明细</span>
          </span>
        </div>
      </div>
    </section>
  )
}
