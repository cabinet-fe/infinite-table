// 看板视图组件：按配置的分组字段分泳道展示卡片，运维态支持拖拽卡片跨泳道改状态并实时写回数据源，
// 点击卡片打开详情抽屉查看/编辑全字段；用户查看态严格禁用拖拽改状态与编辑写回。
// 新建卡片与看板配置入口在顶部工具栏（新增行 / 视图配置），视图内不再重复提供。

import { useMemo, useRef, useState } from 'react'
import { Eye, GripVertical, Kanban, Lock } from 'lucide-react'
import { buildKanbanBoard, type KanbanCardField } from '../domain/kanban-engine'
import { toFiniteNumber } from '../domain/utils'
import { buildDefaultKanbanConfig } from '../domain/workspace-helpers'
import type { KanbanConfig, SmartColumn, SmartRecord, WorkspaceView } from '../shared/schema'
import { KanbanCardDetailDrawer } from './KanbanCardDetailDrawer'

export interface KanbanViewProps {
  view: WorkspaceView
  columns: readonly SmartColumn[]
  records: readonly SmartRecord[]
  readonly: boolean
  primaryKeyField?: string
  onMoveCard: (recordId: string, targetLaneKey: string) => Promise<void>
  onUpdateRecord: (recordId: string, patch: Record<string, unknown>) => Promise<void>
}

const AVATAR_PALETTE = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
]

function getAvatarTone(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!
}

export function KanbanView({
  view,
  columns,
  records,
  readonly,
  primaryKeyField,
  onMoveCard,
  onUpdateRecord,
}: KanbanViewProps) {
  const config: KanbanConfig = useMemo(
    () => view.kanbanConfig ?? buildDefaultKanbanConfig(columns),
    [view.kanbanConfig, columns],
  )

  const board = useMemo(
    () => buildKanbanBoard(records, columns, config),
    [records, columns, config],
  )

  const groupCol = useMemo(
    () => columns.find((c) => c.key === config.groupByField),
    [columns, config.groupByField],
  )

  const canDragMove =
    !readonly && Boolean(groupCol) && groupCol?.type !== 'lookup' && groupCol?.type !== 'formula'

  const [draggingCard, setDraggingCard] = useState<{
    recordId: string
    fromLaneKey: string
  } | null>(null)
  const draggingCardRef = useRef<{ recordId: string; fromLaneKey: string } | null>(null)
  const [dragOverLaneKey, setDragOverLaneKey] = useState<string | null>(null)
  const [detailRecordId, setDetailRecordId] = useState<string | null>(null)

  const detailRecord = useMemo(
    () => (detailRecordId ? (records.find((r) => r._id === detailRecordId) ?? null) : null),
    [detailRecordId, records],
  )

  return (
    <div className="flex h-full w-full flex-col bg-st-bg" data-testid="kanban-view">
      {/* 信息行：分组字段与规模。「新建卡片 / 看板配置」与顶部工具栏重复，统一走工具栏 */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-4 text-xs text-slate-500">
        <Kanban className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="truncate">
          按{' '}
          <span className="font-medium text-slate-700">
            {groupCol?.title ?? config.groupByField}
          </span>{' '}
          分组 · {board.lanes.length} 个泳道 · {board.totalCards} 张卡片
        </span>
        {readonly ? (
          <span className="st-badge st-badge-gray shrink-0">
            <Eye className="h-3 w-3" />
            <span>只读浏览</span>
          </span>
        ) : !canDragMove ? (
          <span className="st-badge st-badge-amber shrink-0">
            <Lock className="h-3 w-3" />
            <span>计算字段分组不支持拖拽写回</span>
          </span>
        ) : (
          <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
            拖拽卡片跨泳道即可写回
          </span>
        )}
      </div>

      {/* 泳道横向滚动区 */}
      <div className="st-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 pb-4">
        {board.lanes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="st-empty max-w-sm py-5">
              <Kanban className="mx-auto mb-2 h-6 w-6 text-slate-400" />
              <div className="text-sm font-medium text-slate-900">暂无可展示的看板泳道</div>
              <p className="mt-1 text-xs text-slate-500">
                当前筛选条件下无匹配记录，或开启了「隐藏空泳道」。
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-start gap-3">
            {board.lanes.map((lane) => {
              const isDropTarget =
                canDragMove &&
                dragOverLaneKey === lane.key &&
                draggingCard !== null &&
                draggingCard.fromLaneKey !== lane.key

              return (
                <section
                  key={lane.key || '__ungrouped__'}
                  data-kanban-lane-key={lane.key}
                  aria-label={`泳道 ${lane.title}`}
                  onDragEnter={(e) => {
                    if (!canDragMove) return
                    e.preventDefault()
                  }}
                  onDragOver={(e) => {
                    if (!canDragMove) return
                    e.preventDefault()
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                    if (draggingCardRef.current && dragOverLaneKey !== lane.key) {
                      setDragOverLaneKey(lane.key)
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setDragOverLaneKey((cur) => (cur === lane.key ? null : cur))
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const activeDrag = draggingCardRef.current ?? draggingCard
                    const droppedId =
                      activeDrag?.recordId || e.dataTransfer?.getData('text/plain') || ''
                    const fromKey = activeDrag?.fromLaneKey
                    draggingCardRef.current = null
                    setDraggingCard(null)
                    setDragOverLaneKey(null)
                    if (!canDragMove || !droppedId || fromKey === lane.key) return
                    void onMoveCard(droppedId, lane.key)
                  }}
                  className={`flex max-h-full w-64 shrink-0 flex-col rounded-xl border transition-colors duration-150 ${
                    isDropTarget
                      ? 'border-blue-300 bg-blue-50/80 ring-2 ring-blue-200'
                      : 'border-transparent bg-slate-200/60'
                  }`}
                >
                  {/* 泳道头 */}
                  <header className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {lane.color && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: lane.color }}
                        />
                      )}
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {lane.title}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400 tabular-nums">
                      {lane.count}
                    </span>
                  </header>

                  {/* 卡片列表 */}
                  <div className="st-scroll min-h-[88px] flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                    {lane.cards.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
                        {canDragMove ? '拖拽卡片到此处' : '暂无记录'}
                      </div>
                    ) : (
                      lane.cards.map((card) => {
                        const isDragging = draggingCard?.recordId === card.recordId
                        return (
                          <article
                            key={card.recordId}
                            data-kanban-card-id={card.recordId}
                            data-lane-key={lane.key}
                            draggable={canDragMove}
                            onDragStart={(e) => {
                              if (!canDragMove) {
                                e.preventDefault()
                                return
                              }
                              const dragPayload = {
                                recordId: card.recordId,
                                fromLaneKey: lane.key,
                              }
                              draggingCardRef.current = dragPayload
                              setDraggingCard(dragPayload)
                              if (e.dataTransfer) {
                                e.dataTransfer.setData('text/plain', card.recordId)
                                e.dataTransfer.effectAllowed = 'move'
                              }
                            }}
                            onDragEnd={() => {
                              draggingCardRef.current = null
                              setDraggingCard(null)
                              setDragOverLaneKey(null)
                            }}
                            onClick={() => setDetailRecordId(card.recordId)}
                            className={`group rounded-lg border border-slate-200 bg-white p-3 shadow-xs transition-shadow duration-150 hover:shadow-panel ${
                              canDragMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                            } ${isDragging ? 'opacity-50 ring-2 ring-blue-300' : ''}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h3
                                className="line-clamp-2 text-sm font-medium leading-snug text-slate-900"
                                title={card.title}
                              >
                                {card.title}
                              </h3>
                              {canDragMove && (
                                <GripVertical
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100"
                                  aria-hidden="true"
                                />
                              )}
                            </div>

                            {card.fields.length > 0 && (
                              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                                {card.fields.map((field) => (
                                  <KanbanCardFieldRow key={field.key} field={field} />
                                ))}
                              </div>
                            )}
                          </article>
                        )
                      })
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>

      <KanbanCardDetailDrawer
        record={detailRecord}
        columns={columns}
        readonly={readonly}
        primaryKeyField={primaryKeyField}
        onClose={() => setDetailRecordId(null)}
        onSaveRecord={onUpdateRecord}
      />
    </div>
  )
}

function KanbanCardFieldRow({ field }: { field: KanbanCardField }) {
  // 标签在上、值在下，全部字段两列并排压低卡片高度；值截断时靠 title 悬停看全文
  if (field.type === 'select' && field.option) {
    return (
      <div className="min-w-0">
        <div className="truncate text-xs text-slate-400">{field.title}</div>
        <div className="mt-0.5 flex min-w-0">
          <span
            className="st-pill h-5 max-w-full px-2"
            style={{ backgroundColor: field.option.color, color: field.option.textColor }}
            title={field.option.label}
          >
            <span className="min-w-0 truncate">{field.option.label}</span>
          </span>
        </div>
      </div>
    )
  }

  if (field.type === 'person' && field.displayText && field.displayText !== '-') {
    const initial = field.displayText.slice(0, 1)
    return (
      <div className="min-w-0">
        <div className="truncate text-xs text-slate-400">{field.title}</div>
        <div className="mt-0.5 flex min-w-0">
          <span
            className="st-pill st-pill-gray h-5 max-w-full gap-1 px-1.5 text-slate-700"
            title={field.displayText}
          >
            <span
              className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${getAvatarTone(field.displayText)}`}
            >
              {initial}
            </span>
            <span className="min-w-0 truncate">{field.displayText}</span>
          </span>
        </div>
      </div>
    )
  }

  if (field.type === 'progress') {
    const pct = Math.max(0, Math.min(100, toFiniteNumber(field.value) ?? 0))
    return (
      <div className="min-w-0">
        <div className="truncate text-xs text-slate-400">{field.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-xs font-medium text-slate-800 tabular-nums">
            {field.displayText}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-slate-400">{field.title}</div>
      <div
        className="mt-0.5 truncate text-xs font-medium text-slate-800 tabular-nums"
        title={field.displayText}
      >
        {field.displayText}
      </div>
    </div>
  )
}
