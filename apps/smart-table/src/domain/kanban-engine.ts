// 看板泳道分组计算引擎：按指定单选/文本字段将记录分组为有序泳道与卡片摘要

import type { KanbanConfig, SelectOption, SmartColumn, SmartRecord } from '../shared/schema'
import { formatSummaryValue } from './query-engine'
import { extractLinkText, isEmptyCellValue, scalarToText, toFiniteNumber } from './utils'

/** 看板卡片展示字段 */
export interface KanbanCardField {
  key: string
  title: string
  type: SmartColumn['type']
  value: unknown
  displayText: string
  option?: SelectOption
}

/** 看板单张卡片 */
export interface KanbanCard {
  record: SmartRecord
  recordId: string
  title: string
  laneKey: string
  fields: KanbanCardField[]
}

/** 看板单个泳道 */
export interface KanbanLane {
  /** 分组字段原始值（未分组为空串 ''） */
  key: string
  /** 泳道展示标题（空串显示为 '未分组'） */
  title: string
  /** 对应 select 选项的背景色与文字色 */
  color?: string
  textColor?: string
  cards: KanbanCard[]
  count: number
}

/** 看板分组输出结果 */
export interface KanbanBoardResult {
  groupByField: string
  titleField: string
  lanes: KanbanLane[]
  totalCards: number
}

function normalizeLaneKey(raw: unknown): string {
  if (isEmptyCellValue(raw)) return ''
  const text = scalarToText(raw).trim()
  return text === '' ? '' : text
}

function resolveTitleField(columns: readonly SmartColumn[], config: KanbanConfig): string {
  if (config.titleField && columns.some((c) => c.key === config.titleField)) {
    return config.titleField
  }
  const preferredText = columns.find((c) => c.key !== config.groupByField && c.type === 'text')
  if (preferredText) return preferredText.key
  const fallback = columns.find((c) => c.key !== config.groupByField) ?? columns[0]
  return fallback?.key ?? '_id'
}

function formatCardFieldText(value: unknown, col: SmartColumn | undefined): string {
  if (isEmptyCellValue(value)) return '-'
  if (col?.type === 'checkbox') {
    const text = scalarToText(value).trim().toLowerCase()
    return value === true || value === 1 || text === 'true' ? '是' : '否'
  }
  if (col?.type === 'progress') {
    const num = toFiniteNumber(value)
    return num !== null ? `${Math.round(num)}%` : scalarToText(value)
  }
  if (col?.type === 'number' || col?.numberFormat !== undefined) {
    const num = toFiniteNumber(value)
    if (num !== null) {
      return formatSummaryValue(num, 'sum', col?.numberFormat)
    }
  }
  const linkText = extractLinkText(value)
  if (linkText !== null) return linkText || '-'
  return scalarToText(value)
}

/**
 * 按 KanbanConfig 将记录集合分组为稳定有序的泳道与卡片列表。
 */
export function buildKanbanBoard(
  records: readonly SmartRecord[],
  columns: readonly SmartColumn[],
  config: KanbanConfig,
): KanbanBoardResult {
  const colMap = new Map<string, SmartColumn>()
  for (const col of columns) {
    colMap.set(col.key, col)
  }

  const groupCol = colMap.get(config.groupByField)
  const titleField = resolveTitleField(columns, config)

  const optionByLabel = new Map<string, SelectOption>()
  if (groupCol?.options) {
    for (const opt of groupCol.options) {
      optionByLabel.set(opt.label, opt)
    }
  }

  // 按顺序收集泳道键：自定义 laneOrder → 列 options → 数据内出现的新值（未分组 '' 放最后）
  const orderedKeys: string[] = []
  const seenKeys = new Set<string>()
  const pushKey = (key: string): void => {
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      orderedKeys.push(key)
    }
  }

  if (config.laneOrder) {
    for (const key of config.laneOrder) {
      pushKey(key)
    }
  }
  if (groupCol?.options) {
    for (const opt of groupCol.options) {
      pushKey(opt.label)
    }
  }

  const buckets = new Map<string, KanbanCard[]>()
  let hasUngrouped = false

  for (const record of records) {
    const laneKey = normalizeLaneKey(record[config.groupByField])
    if (laneKey === '') {
      hasUngrouped = true
    } else {
      pushKey(laneKey)
    }

    const rawTitle = record[titleField]
    const cardTitle = isEmptyCellValue(rawTitle) ? record._id : scalarToText(rawTitle)

    const fields: KanbanCardField[] = []
    for (const fieldKey of config.displayFields) {
      const col = colMap.get(fieldKey)
      if (!col) continue
      const val = record[fieldKey]
      const text = formatCardFieldText(val, col)
      const option =
        col.type === 'select' && col.options
          ? col.options.find((opt) => opt.label === scalarToText(val).trim())
          : undefined
      fields.push({
        key: col.key,
        title: col.title,
        type: col.type,
        value: val,
        displayText: text,
        ...(option ? { option } : {}),
      })
    }

    const card: KanbanCard = {
      record,
      recordId: record._id,
      title: cardTitle,
      laneKey,
      fields,
    }
    const list = buckets.get(laneKey)
    if (list) {
      list.push(card)
    } else {
      buckets.set(laneKey, [card])
    }
  }

  if (hasUngrouped) {
    pushKey('')
  }

  const lanes: KanbanLane[] = []
  for (const key of orderedKeys) {
    const cards = buckets.get(key) ?? []
    if (config.hideEmptyLanes && cards.length === 0) continue
    const opt = optionByLabel.get(key)
    lanes.push({
      key,
      title: key === '' ? '未分组' : key,
      ...(opt ? { color: opt.color, textColor: opt.textColor } : {}),
      cards,
      count: cards.length,
    })
  }

  return {
    groupByField: config.groupByField,
    titleField,
    lanes,
    totalCards: records.length,
  }
}
