// 底部汇总栏：几何镜像主画布列布局（getFooterLayout 快照），
// 左侧计数标签精确占行表头宽带，汇总格按画布内容坐标随横向滚动逐像素对齐

import { useMemo } from 'react'
import type { FooterLayout } from '../canvas/smart-grid'
import type { SummaryCellResult } from '../domain/query-engine'
import type { SmartColumn, SummaryType } from '../shared/schema'
import { CustomSelect, type CustomSelectOption } from './CustomSelect'

export interface SummaryFooterProps {
  columns: readonly SmartColumn[]
  layout: FooterLayout
  rowCount: number
  totalCount: number
  summaries: Record<string, SummaryType>
  computedSummaries: Record<string, SummaryCellResult>
  gridScrollLeft: number
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

function getAvailableSummaryOptions(col: SmartColumn): CustomSelectOption<SummaryType>[] {
  const isNumeric =
    col.type === 'number' ||
    col.type === 'progress' ||
    col.type === 'formula' ||
    (col.type === 'lookup' &&
      (col.lookupConfig?.mode === 'rollup' || col.numberFormat !== undefined))

  const types: SummaryType[] = isNumeric
    ? ['none', 'sum', 'avg', 'max', 'min', 'count', 'filled_rate']
    : ['none', 'count', 'filled_rate']

  return types.map((t) => ({ value: t, label: SUMMARY_LABELS[t] }))
}

export function SummaryFooter({
  columns,
  layout,
  rowCount,
  totalCount,
  summaries,
  computedSummaries,
  gridScrollLeft,
  onChangeColumnSummary,
}: SummaryFooterProps) {
  const columnsByKey = useMemo(() => new Map(columns.map((col) => [col.key, col])), [columns])

  const countText = rowCount === totalCount ? `共 ${rowCount} 条` : `${rowCount}/${totalCount} 条`
  const countTitle =
    rowCount === totalCount ? `共 ${rowCount} 条` : `筛选后 ${rowCount} / 共 ${totalCount} 条`

  return (
    <footer className="st-summary-footer" aria-label="底部汇总栏">
      <div className="st-summary-count" style={{ width: layout.rowHeaderWidth }} title={countTitle}>
        {countText}
      </div>
      {/* 右侧留出画布竖向滚动条厚度的 gutter，汇总格层与画布列网格一一对齐 */}
      <div className="st-summary-cells" style={{ marginRight: layout.scrollbarSize }}>
        {layout.columns.map((cellLayout) => {
          const col = columnsByKey.get(cellLayout.field)
          if (!col) return null
          const currentType = summaries[col.key] ?? 'none'
          const cell = computedSummaries[col.key]

          return (
            <div
              key={col.key}
              className={`st-summary-cell ${currentType !== 'none' ? 'has-value' : ''}`}
              style={{
                left: cellLayout.left - gridScrollLeft,
                width: cellLayout.width,
              }}
            >
              <CustomSelect
                size="xs"
                variant="ghost"
                placement="top-start"
                value={currentType}
                options={getAvailableSummaryOptions(col)}
                ariaLabel={`${col.title} 汇总方式`}
                onChange={(val) => onChangeColumnSummary(col.key, val)}
              />
              {currentType !== 'none' && (
                <span className="st-summary-val" title={cell?.text || '—'}>
                  {cell?.text || '—'}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </footer>
  )
}
