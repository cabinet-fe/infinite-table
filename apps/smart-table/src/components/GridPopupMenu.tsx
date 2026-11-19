// 表格画布浮出菜单：统一承接列头菜单按钮气泡（⋯）与 body/col-header/row-header 三区域右键菜单，
// 并按真实资源能力（canEditRecords / canConfigure）严格裁剪写操作与配置类菜单项。

import { useEffect, useRef } from 'react'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Columns3,
  Copy,
  Edit3,
  Eraser,
  EyeOff,
  Filter,
  Lock,
  Paintbrush,
  Pin,
  PinOff,
  Plus,
  Settings,
  Trash2,
  XCircle,
} from 'lucide-react'
import type { SmartGridSelectionInfo } from '../canvas/smart-grid'
import type { CellStyleConfig, SmartColumn, SmartRecord, SortRule } from '../shared/schema'

export type GridMenuRegion = 'body' | 'col-header' | 'row-header'

export interface GridMenuContext {
  canEditRecords: boolean
  canConfigure: boolean
  region: GridMenuRegion
  x: number
  y: number
  colIndex: number | null
  column: SmartColumn | null
  record: SmartRecord | null
  selection: SmartGridSelectionInfo
  sortRules: readonly SortRule[]
  frozenColCount: number
  visibleColumnCount: number
  canRenameColumn: boolean
  canDeleteColumn: boolean
  hasSelectionCellStyles: boolean
  isDatasourceMode: boolean
}

export type GridMenuActionId =
  | 'sort_asc'
  | 'sort_desc'
  | 'sort_clear'
  | 'freeze_to_col'
  | 'unfreeze_all'
  | 'hide_col'
  | 'open_col_style'
  | 'edit_lookup_col'
  | 'rename_col'
  | 'delete_col'
  | 'copy_cell'
  | 'copy_row'
  | 'filter_by_cell'
  | 'clear_filters'
  | 'edit_cell'
  | 'apply_selection_style'
  | 'clear_selection_style'
  | 'open_selection_style'
  | 'add_row'
  | 'duplicate_row'
  | 'delete_row'

export interface GridMenuItem {
  id: GridMenuActionId
  label: string
  danger?: boolean
  disabled?: boolean
  stylePatch?: CellStyleConfig
  dividerBefore?: boolean
}

export const QUICK_CELL_COLOR_SWATCHES: readonly {
  label: string
  bgColor: string
  textColor: string
}[] = [
  { label: '浅蓝高亮', bgColor: '#eff6ff', textColor: '#1e40af' },
  { label: '浅绿达标', bgColor: '#dcfce7', textColor: '#166534' },
  { label: '浅黄关注', bgColor: '#fef9c3', textColor: '#854d0e' },
  { label: '浅红预警', bgColor: '#fee2e2', textColor: '#991b1b' },
]

/** 根据区域与真实操作权限生成菜单项（纯函数，便于单测验证权限隔离） */
export function buildGridMenuItems(ctx: GridMenuContext): GridMenuItem[] {
  const { canEditRecords, canConfigure } = ctx
  const items: GridMenuItem[] = []

  if (ctx.region === 'col-header' && ctx.column) {
    const activeSort = ctx.sortRules.find((r) => r.field === ctx.column!.key)
    items.push(
      { id: 'sort_asc', label: '升序排列 (A → Z)' },
      { id: 'sort_desc', label: '降序排列 (Z → A)' },
    )
    if (activeSort) {
      items.push({ id: 'sort_clear', label: '清除此列排序' })
    }

    if (canConfigure) {
      if (!ctx.isDatasourceMode && ctx.colIndex !== null) {
        const isFrozenTarget = ctx.frozenColCount === ctx.colIndex + 1
        items.push({
          id: isFrozenTarget ? 'unfreeze_all' : 'freeze_to_col',
          label: isFrozenTarget ? '取消列冻结' : `左冻结至「${ctx.column.title}」`,
          dividerBefore: true,
        })
        items.push({
          id: 'hide_col',
          label: '隐藏此列',
          disabled: ctx.visibleColumnCount <= 1,
        })
        items.push({
          id: 'open_col_style',
          label: '列样式与对齐配置',
        })
      }
      if (ctx.column.type === 'lookup') {
        items.push({
          id: 'edit_lookup_col',
          label: '关联字段设置',
          dividerBefore: ctx.isDatasourceMode,
        })
      }
      if (ctx.canRenameColumn || ctx.canDeleteColumn) {
        if (ctx.canRenameColumn) {
          items.push({
            id: 'rename_col',
            label: '重命名列',
            dividerBefore: ctx.isDatasourceMode && ctx.column.type !== 'lookup',
          })
        }
        if (ctx.canDeleteColumn) {
          items.push({
            id: 'delete_col',
            label: '删除此列',
            danger: true,
          })
        }
      }
    }
    return items
  }

  if (ctx.region === 'row-header') {
    items.push({
      id: 'copy_row',
      label: '复制整行数据',
      disabled: !ctx.record,
    })
    if (canEditRecords) {
      items.push({ id: 'add_row', label: '新增一行', dividerBefore: true })
      if (ctx.record) {
        items.push({ id: 'duplicate_row', label: '复制本行并新建' })
        items.push({ id: 'delete_row', label: '删除此行', danger: true, dividerBefore: true })
      }
    }
    return items
  }

  // body 单元格区域
  if (ctx.column && ctx.record) {
    items.push({ id: 'copy_cell', label: '复制单元格内容' })
    items.push({ id: 'filter_by_cell', label: '按此值筛选' })
  } else {
    items.push({ id: 'clear_filters', label: '清空全部筛选' })
  }

  if (ctx.column && ctx.record) {
    const isLookupOne = ctx.column.type === 'lookup' && ctx.column.lookupConfig?.mode === 'one'
    const canEditCell =
      canEditRecords &&
      ctx.column.type !== 'formula' &&
      ctx.column.type !== 'image' &&
      ctx.column.type !== 'lookup'
    const canDisambiguateLookup = canConfigure && isLookupOne

    if (canEditCell || canDisambiguateLookup) {
      items.push({
        id: 'edit_cell',
        label: isLookupOne ? '查看/消歧关联' : '编辑单元格',
        dividerBefore: true,
      })
    }

    if (canConfigure && !ctx.isDatasourceMode) {
      items.push({
        id: 'open_selection_style',
        label: '设置选区样式与配色',
        dividerBefore: !(canEditCell || canDisambiguateLookup),
      })
      if (ctx.hasSelectionCellStyles) {
        items.push({
          id: 'clear_selection_style',
          label: '清除选区自定义配色',
        })
      }
    }
  }

  if (canEditRecords) {
    items.push({ id: 'add_row', label: '新增一行', dividerBefore: true })
    if (ctx.record) {
      items.push({ id: 'delete_row', label: '删除当前行', danger: true })
    }
  }

  return items
}

function renderItemIcon(id: GridMenuActionId) {
  switch (id) {
    case 'sort_asc':
      return <ArrowUpAZ className="h-3.5 w-3.5" />
    case 'sort_desc':
      return <ArrowDownAZ className="h-3.5 w-3.5" />
    case 'sort_clear':
    case 'clear_filters':
      return <XCircle className="h-3.5 w-3.5" />
    case 'freeze_to_col':
      return <Pin className="h-3.5 w-3.5" />
    case 'unfreeze_all':
      return <PinOff className="h-3.5 w-3.5" />
    case 'hide_col':
      return <EyeOff className="h-3.5 w-3.5" />
    case 'open_col_style':
    case 'open_selection_style':
      return <Paintbrush className="h-3.5 w-3.5" />
    case 'edit_lookup_col':
      return <Settings className="h-3.5 w-3.5" />
    case 'rename_col':
    case 'edit_cell':
      return <Edit3 className="h-3.5 w-3.5" />
    case 'delete_col':
    case 'delete_row':
      return <Trash2 className="h-3.5 w-3.5" />
    case 'copy_cell':
    case 'copy_row':
    case 'duplicate_row':
      return <Copy className="h-3.5 w-3.5" />
    case 'filter_by_cell':
      return <Filter className="h-3.5 w-3.5" />
    case 'clear_selection_style':
      return <Eraser className="h-3.5 w-3.5" />
    case 'add_row':
      return <Plus className="h-3.5 w-3.5" />
    default:
      return <Columns3 className="h-3.5 w-3.5" />
  }
}

export interface GridPopupMenuProps {
  context: GridMenuContext
  onAction: (action: GridMenuActionId, stylePatch?: CellStyleConfig) => void
  onClose: () => void
}

export function GridPopupMenu({ context, onAction, onClose }: GridPopupMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const items = buildGridMenuItems(context)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node | null)) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const menuW = 216
  const estH = items.length * 30 + 64
  const left = Math.min(Math.max(8, context.x), Math.max(8, vw - menuW - 8))
  const top = Math.min(Math.max(8, context.y), Math.max(8, vh - estH - 8))

  const showQuickSwatches =
    context.canConfigure &&
    context.region === 'body' &&
    !context.isDatasourceMode &&
    context.record !== null &&
    context.column !== null

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="表格快捷操作菜单"
      className="fixed z-[1150] w-[216px] rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
      style={{ left, top }}
    >
      {context.column && (
        <div className="mb-1 flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1 text-[11px] text-slate-500">
          <span className="truncate font-medium text-slate-700">{context.column.title}</span>
          {!context.canEditRecords && (
            <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
              <Lock className="h-2.5 w-2.5" />
              只读
            </span>
          )}
        </div>
      )}

      {showQuickSwatches && (
        <div className="mb-1 flex items-center justify-between border-b border-slate-100 px-2 py-1.5">
          <span className="text-[11px] text-slate-500">快速标色</span>
          <div className="flex items-center gap-1.5">
            {QUICK_CELL_COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch.bgColor}
                type="button"
                title={swatch.label}
                aria-label={swatch.label}
                className="h-4 w-4 rounded-full border border-black/15 transition-transform hover:scale-110"
                style={{ backgroundColor: swatch.bgColor }}
                onClick={() => {
                  onAction('apply_selection_style', {
                    bgColor: swatch.bgColor,
                    textColor: swatch.textColor,
                  })
                  onClose()
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col">
        {items.map((item) => (
          <div key={item.id}>
            {item.dividerBefore && <div className="my-1 border-t border-slate-100" />}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100'
              }`}
              onClick={() => {
                if (item.disabled) return
                onAction(item.id, item.stylePatch)
                onClose()
              }}
            >
              <span className={item.danger ? 'text-red-500' : 'text-slate-400'}>
                {renderItemIcon(item.id)}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
