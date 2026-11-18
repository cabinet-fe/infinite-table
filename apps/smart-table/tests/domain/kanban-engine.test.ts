import { describe, expect, it } from 'vitest'
import { buildKanbanBoard } from '../../src/domain/kanban-engine'
import type { KanbanConfig, SmartColumn, SmartRecord } from '../../src/shared/schema'

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '编号', type: 'text', width: 100 },
  { key: 'title', title: '项目名', type: 'text', width: 200 },
  {
    key: 'status',
    title: '状态',
    type: 'select',
    width: 110,
    options: [
      { label: '待启动', color: '#f1f5f9', textColor: '#475569' },
      { label: '进行中', color: '#dbeafe', textColor: '#1d4ed8' },
      { label: '已交付', color: '#dcfce7', textColor: '#15803d' },
    ],
  },
  { key: 'amount', title: '金额', type: 'number', width: 120, numberFormat: 'currency' },
  { key: 'progress', title: '进度', type: 'progress', width: 100 },
  { key: 'verified', title: '核验', type: 'checkbox', width: 80 },
]

const RECORDS: SmartRecord[] = [
  {
    _id: 'r1',
    code: 'P-1',
    title: 'MES 平台',
    status: '进行中',
    amount: 120000,
    progress: 65,
    verified: true,
  },
  {
    _id: 'r2',
    code: 'P-2',
    title: '数据湖',
    status: '',
    amount: 80000,
    progress: 10,
    verified: false,
  },
  {
    _id: 'r3',
    code: 'P-3',
    title: '风控中台',
    status: '未知状态',
    amount: 50000,
    progress: 100,
    verified: true,
  },
]

describe('kanban-engine', () => {
  it('按 select 选项与 laneOrder 排序分泳道，保留空泳道并把空值归入未分组', () => {
    const config: KanbanConfig = {
      groupByField: 'status',
      titleField: 'title',
      displayFields: ['code', 'amount', 'progress', 'verified'],
      laneOrder: ['进行中', '待启动'],
    }
    const board = buildKanbanBoard(RECORDS, COLUMNS, config)

    expect(board.titleField).toBe('title')
    expect(board.totalCards).toBe(3)
    expect(board.lanes.map((l) => l.key)).toEqual(['进行中', '待启动', '已交付', '未知状态', ''])
    expect(board.lanes.map((l) => l.title)).toEqual([
      '进行中',
      '待启动',
      '已交付',
      '未知状态',
      '未分组',
    ])
    expect(board.lanes[0]!.color).toBe('#dbeafe')
    expect(board.lanes[0]!.count).toBe(1)
    expect(board.lanes[0]!.cards[0]!.title).toBe('MES 平台')
    expect(board.lanes[0]!.cards[0]!.fields.map((f) => [f.key, f.displayText])).toEqual([
      ['code', 'P-1'],
      ['amount', '¥120,000'],
      ['progress', '65%'],
      ['verified', '是'],
    ])
    expect(board.lanes[1]!.count).toBe(0)
  })

  it('hideEmptyLanes 为 true 时过滤空泳道', () => {
    const board = buildKanbanBoard(RECORDS, COLUMNS, {
      groupByField: 'status',
      displayFields: ['code'],
      hideEmptyLanes: true,
    })
    expect(board.lanes.map((l) => l.key)).toEqual(['进行中', '未知状态', ''])
  })
})
