// 底部汇总栏：展示记录总数与逐列可切换的聚合统计（求和/均值/最值/已填数/填充率）

import type { SummaryCellResult } from '../domain/query-engine'
import type { SmartColumn, SummaryType } from '../shared/schema'

export interface SummaryFooterProps {
  columns: readonly SmartColumn[]
  rowCount: number
  totalCount: number
  summaries: Record<string, SummaryType>
  computedSummaries: Record<string, SummaryCellResult>
  onChangeColumnSummary: (columnKey: string, summaryType: SummaryType) => void
}

const SUMMARY_LABELS: Record<SummaryType, string> = {
  none: '无汇总',
  sum: '求和',
  avg: '平均值',
  max: '最大值',
  min: '最小值',
  count: '已填数',
  filled_rate: '填充率',
}

function getAvailableSummaryTypes(col: SmartColumn): SummaryType[] {
  const isNumeric =
    col.type === 'number' ||
    col.type === 'progress' ||
    col.type === 'formula' ||
    (col.type === 'lookup' &&
      (col.lookupConfig?.mode === 'rollup' || col.numberFormat !== undefined))

  if (isNumeric) {
    return ['none', 'sum', 'avg', 'max', 'min', 'count', 'filled_rate']
  }
  return ['none', 'count', 'filled_rate']
}

export function SummaryFooter({
  columns,
  rowCount,
  totalCount,
  summaries,
  computedSummaries,
  onChangeColumnSummary,
}: SummaryFooterProps) {
  return (
    <footer className="st-summary-footer" aria-label="底部汇总栏">
      <div className="st-summary-count">
        {rowCount === totalCount ? `共 ${rowCount} 条` : `筛选后 ${rowCount} / ${totalCount} 条`}
      </div>
      <div className="st-summary-cells">
        {columns.map((col) => {
          const currentType = summaries[col.key] ?? 'none'
          const cell = computedSummaries[col.key]
          const options = getAvailableSummaryTypes(col)

          return (
            <div key={col.key} className="st-summary-cell" style={{ minWidth: col.width || 120 }}>
              <span className="st-summary-col-title" title={col.title}>
                {col.title}
              </span>
              <select
                className="st-summary-select"
                value={currentType}
                aria-label={`${col.title} 汇总方式`}
                onChange={(e) => onChangeColumnSummary(col.key, e.target.value as SummaryType)}
              >
                {options.map((opt) => (
                  <option key={opt} value={opt}>
                    {SUMMARY_LABELS[opt]}
                  </option>
                ))}
              </select>
              {currentType !== 'none' && (
                <span className="st-summary-val">{cell?.text || '—'}</span>
              )}
            </div>
          )
        })}
      </div>
    </footer>
  )
}
