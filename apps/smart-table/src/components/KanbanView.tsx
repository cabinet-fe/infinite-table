// 看板视图组件：按配置的分组字段分泳道展示卡片，运维态支持拖拽卡片跨泳道改状态并实时写回数据源，
// 点击卡片打开详情抽屉查看/编辑全字段；用户查看态严格禁用拖拽改状态与编辑写回。

import { useMemo, useRef, useState } from 'react'
import { Eye, GripVertical, Kanban, Lock, Plus, SlidersHorizontal } from 'lucide-react'
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
  onAddCard?: () => Promise<void>
  onOpenConfig?: () => void
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
  onAddCard,
  onOpenConfig,
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
    <div className="flex h-full w-full flex-col bg-slate-50/80" data-testid="kanban-view">
      {/* 看板状态条 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-4 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2 text-slate-600">
          <Kanban className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            按{' '}
            <strong className="font-semibold text-slate-800">
              {groupCol?.title ?? config.groupByField}
            </strong>{' '}
            分组 · {board.lanes.length} 个泳道 · {board.totalCards} 张卡片
          </span>
          {readonly ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              <Eye className="h-3 w-3" />
              <span>只读浏览（拖拽与编辑已禁用）</span>
            </span>
          ) : !canDragMove ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              <Lock className="h-3 w-3" />
              <span>当前分组列为计算字段，不支持拖拽写回</span>
            </span>
          ) : (
            <span className="hidden text-[11px] text-slate-400 sm:inline">
              拖拽卡片跨泳道即可实时写回数据源
            </span>
          )}
        </div>

        {!readonly && (
          <div className="flex shrink-0 items-center gap-1.5">
            {onAddCard && (
              <button
                type="button"
                onClick={() => void onAddCard()}
                className="inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-3 w-3" />
                <span>新建卡片</span>
              </button>
            )}
            {onOpenConfig && (
              <button
                type="button"
                onClick={onOpenConfig}
                className="inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>看板配置</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 泳道横向滚动区 */}
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4">
        {board.lanes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xs">
              <Kanban className="mx-auto mb-2.5 h-7 w-7 text-slate-400" />
              <div className="text-sm font-semibold text-slate-900">暂无可展示的看板泳道</div>
              <p className="mt-1 text-xs text-slate-500">
                当前筛选条件下无匹配记录，或开启了「隐藏空泳道」。
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-start gap-3.5">
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
                  className={`flex max-h-full w-76 shrink-0 flex-col rounded-xl border transition-colors ${
                    isDropTarget
                      ? 'border-blue-400 bg-blue-50/70 ring-2 ring-blue-200'
                      : 'border-slate-200/90 bg-slate-100/80'
                  }`}
                >
                  {/* 泳道头 */}
                  <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      {lane.color ? (
                        <span
                          className="inline-flex truncate rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          style={{
                            backgroundColor: lane.color,
                            color: lane.textColor ?? '#1e293b',
                          }}
                        >
                          {lane.title}
                        </span>
                      ) : (
                        <span className="truncate text-xs font-semibold text-slate-800">
                          {lane.title}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 shadow-2xs">
                      {lane.count}
                    </span>
                  </header>

                  {/* 卡片列表 */}
                  <div className="min-h-[88px] flex-1 space-y-2 overflow-y-auto px-2.5 pb-2.5">
                    {lane.cards.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300/80 bg-white/50 px-3 py-6 text-center text-[11px] text-slate-400">
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
                            className={`group rounded-lg border border-slate-200/90 bg-white p-3 shadow-2xs transition-all hover:border-blue-300 hover:shadow-sm ${
                              canDragMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                            } ${isDragging ? 'opacity-50 ring-2 ring-blue-300' : ''}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">
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
                              <div className="mt-2.5 space-y-1.5">
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
  if (field.type === 'select' && field.option) {
    return (
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="shrink-0 text-slate-400">{field.title}</span>
        <span
          className="inline-flex max-w-[160px] truncate rounded-full px-2 py-0.5 font-medium"
          style={{ backgroundColor: field.option.color, color: field.option.textColor }}
        >
          {field.option.label}
        </span>
      </div>
    )
  }

  if (field.type === 'person' && field.displayText && field.displayText !== '-') {
    const initial = field.displayText.slice(0, 1)
    return (
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="shrink-0 text-slate-400">{field.title}</span>
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
          <span
            className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold ${getAvatarTone(field.displayText)}`}
          >
            {initial}
          </span>
          <span className="truncate">{field.displayText}</span>
        </span>
      </div>
    )
  }

  if (field.type === 'progress') {
    const pct = Math.max(0, Math.min(100, Math.round(toFiniteNumber(field.value) ?? 0)))
    return (
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="shrink-0 text-slate-400">{field.title}</span>
        <div className="flex w-28 items-center gap-1.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-7 text-right font-medium text-slate-600">{pct}%</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="shrink-0 text-slate-400">{field.title}</span>
      <span className="truncate font-medium text-slate-700">{field.displayText}</span>
    </div>
  )
}
