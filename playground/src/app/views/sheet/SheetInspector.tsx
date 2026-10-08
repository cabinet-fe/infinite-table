// 数据结构观察区（对标 ultra-ui 演示页 inspector，React + shadcn 承载）：手动刷新快照
// （非实时订阅）、懒渲染 JSON 区块（展开才挂载 DOM）、key 级语法高亮、复制反馈、
// 放大 Dialog（可最大化）。数据源全部来自 SheetStore / ListTable 公开 API
// （稀疏全表扫描仅在点击刷新时执行一次）；撤销/重做回写后经 ui.refreshInspector() 追加刷新。

import { Check, ChevronDown, ChevronRight, Copy, Maximize2, RefreshCw, ZoomIn } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import type { SheetDemo } from '../../../sections/sheet'
import type { SheetStore } from '../../../sections/sheet/book'
import { colLetters, formatCellAddress } from './formula-session'
import type { SheetUiBridge } from './ui-bridge'

/** 大 JSON 高亮渲染行数阈值（超过截断展示，完整数据走复制/放大） */
const HIGHLIGHT_MAX_LINES = 10_000

interface InspectorSnapshot {
  cells: Record<string, unknown>
  styles: Record<string, unknown>
  meta: unknown
  selection: unknown
  payload: unknown
  storeCount: number
  styleCount: number
  rowCount: number
  colCount: number
}

interface BlockDef {
  key: keyof Pick<InspectorSnapshot, 'selection' | 'cells' | 'styles' | 'meta' | 'payload'>
  title: string
  source: string
  /** 标题竖条配色 */
  tone: 'primary' | 'success' | 'warning' | 'info'
  wide?: boolean
}

const BLOCKS: readonly BlockDef[] = [
  {
    key: 'selection',
    title: '选区 selection · activeCell 恒为锚点',
    source: 'table.getSelection()',
    tone: 'primary',
  },
  {
    key: 'cells',
    title: '单元格存储 cell-store · 稀疏键值，空格不占位',
    source: 'store.getValue(col,row) 全表扫描',
    tone: 'success',
  },
  {
    key: 'styles',
    title: '样式 style · 单元格格级样式（无共享样式池，演示面直存）',
    source: 'store.getStyle(col,row)',
    tone: 'warning',
  },
  {
    key: 'meta',
    title: '合并 / 冻结 / 行高 / 图片 / 历史',
    source: 'merges / frozen / rowHeights / colWidths / images / history',
    tone: 'info',
  },
  {
    key: 'payload',
    title: '提交给后端 / 后端返回 · workbook 级 JSON（各 sheet 快照拼装）',
    source: 'bundle.stores → cells/styles/merges/frozen',
    tone: 'info',
    wide: true,
  },
]

const TONE_CLASSES: Record<BlockDef['tone'], string> = {
  primary: 'text-primary',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-sky-600 dark:text-sky-400',
}

export function SheetInspector({ demo, ui }: { demo: SheetDemo; ui: SheetUiBridge }) {
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ meta: true })
  const [copiedKey, setCopiedKey] = useState('')
  const [zoom, setZoom] = useState<{ key: string; title: string; value: unknown } | null>(null)
  const [maximized, setMaximized] = useState(false)
  const copyTimer = useRef(0)

  const labelOf = ui.labelOf

  const refresh = (): void => {
    const store = demo.getStore()
    const table = demo.table
    const bundle = demo.getBundle()
    const cells = collectCells(store)
    const styles = collectStyles(store)
    const activeId = bundle.sheet.activeId
    const payload = {
      sheets: bundle.ids().map((id) => buildSheetPayload(id, bundle.stores.get(id)!, labelOf)),
      activeIndex: Math.max(
        0,
        bundle.ids().findIndex((id) => id === activeId),
      ),
    }
    setSnapshot({
      cells,
      styles,
      selection: table.getSelection(),
      meta: {
        merges: store.getMerges().map(formatRange),
        frozen: store.getFrozen(),
        rowHeights: Object.fromEntries(store.getRowHeightOverrides()),
        colWidths: Object.fromEntries(
          [...store.getColWidthOverrides()].map(([col, width]) => [colLetters(col), width]),
        ),
        images: {
          floatObjects: table.floatObjects.size,
          cellImage: 'demo://sheet/cell-img（resolveCellImage 命中格）',
        },
        history: { canUndo: demo.getSheet().canUndo, canRedo: demo.getSheet().canRedo },
      },
      payload,
      storeCount: Object.keys(cells).length,
      styleCount: Object.keys(styles).length,
      rowCount: store.getRowCount(),
      colCount: store.getColCount(),
    })
  }

  useEffect(() => {
    ui.refreshInspector = refresh
    return () => {
      ui.refreshInspector = () => {}
      window.clearTimeout(copyTimer.current)
    }
  }, [demo, ui, labelOf])

  const copyJSON = (key: string, value: unknown): void => {
    void navigator.clipboard.writeText(JSON.stringify(value, null, 2)).then(() => {
      setCopiedKey(key)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? '' : current))
      }, 1500)
    })
  }

  const meta = snapshot
    ? `活动表：${labelOf ? labelOf(demo.getSheet().activeId ?? '') : ''} · 存储 ${snapshot.storeCount} 格 ` +
      `/ 高水位 ${snapshot.rowCount}×${snapshot.colCount} · 样式 ${snapshot.styleCount} 条`
    : ''

  return (
    <section className="sheet-inspector mt-4">
      <div
        className="flex cursor-pointer select-none items-center gap-2 py-1"
        onClick={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('button')) {
            return
          }
          setCollapsed((value) => !value)
        }}
      >
        <span className="text-muted-foreground">
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </span>
        <span className="size-1.5 rounded-full bg-primary" />
        <strong className="text-xs font-semibold">数据结构观察（手动刷新）</strong>
        <span className="ml-auto flex items-center gap-2">
          {snapshot && <span className="font-mono text-[11px] text-muted-foreground">{meta}</span>}
          <Button
            className="h-6 text-xs"
            onClick={(event) => {
              event.stopPropagation()
              refresh()
            }}
            size="xs"
            title="获取当前活动表数据（非实时，点击才刷新）"
            variant="outline"
          >
            <RefreshCw />
            刷新数据
          </Button>
        </span>
      </div>
      {!collapsed && (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {!snapshot && (
            <div className="col-span-full rounded-md border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
              尚未获取数据——点击头部「刷新数据」按钮获取当前活动表快照（非实时，不影响表格操作性能）
            </div>
          )}
          {snapshot &&
            BLOCKS.map((block) => (
              <section
                className={cn('rounded-md border', block.wide && 'col-span-full')}
                key={block.key}
              >
                <button
                  className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left text-xs"
                  onClick={() =>
                    setExpanded((current) => ({ ...current, [block.key]: !current[block.key] }))
                  }
                  title="点击展开 / 折叠（懒渲染：大数据 JSON 仅在展开时挂载 DOM）"
                  type="button"
                >
                  <span className="text-muted-foreground">
                    {expanded[block.key] ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                  </span>
                  <span className={cn('font-medium', TONE_CLASSES[block.tone])}>{block.title}</span>
                </button>
                {expanded[block.key] && (
                  <div className="px-2 pb-2">
                    {block.key === 'payload' ? (
                      <PayloadColumns
                        copiedKey={copiedKey}
                        copyJSON={copyJSON}
                        data={snapshot}
                        onZoom={setZoom}
                      />
                    ) : (
                      <CodeBlock
                        copiedKey={copiedKey}
                        copyJSON={copyJSON}
                        onZoom={setZoom}
                        source={block.source}
                        value={snapshot[block.key]}
                        zoomKey={String(block.key)}
                      />
                    )}
                  </div>
                )}
              </section>
            ))}
        </div>
      )}

      {/* 放大对话框（可最大化） */}
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setZoom(null)
            setMaximized(false)
          }
        }}
        open={zoom !== null}
      >
        <DialogContent
          className={cn(
            'flex max-h-[85vh] flex-col gap-2 overflow-hidden sm:max-w-3xl',
            maximized && 'h-screen w-screen max-w-none sm:max-w-none',
          )}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{zoom?.title}</DialogTitle>
            <DialogDescription>JSON 快照放大展示</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2 pl-1">
            <span className="truncate text-xs font-medium text-muted-foreground">
              {zoom?.title}
            </span>
            <div className="flex items-center gap-1">
              <Button
                className="size-6 text-xs"
                onClick={() => setMaximized((value) => !value)}
                size="icon-xs"
                title="最大化 / 还原"
                variant="ghost"
              >
                <Maximize2 />
              </Button>
              <Button
                className="h-6 text-xs"
                onClick={() => zoom && copyJSON(`zoom-${zoom.key}`, zoom.value)}
                size="xs"
                variant="outline"
              >
                {copiedKey === `zoom-${zoom?.key}` ? <Check /> : <Copy />}
                {copiedKey === `zoom-${zoom?.key}` ? '已复制' : '复制'}
              </Button>
            </div>
          </div>
          <pre
            className={cn(
              'sheet-inspector__pre min-h-0 flex-1 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed',
            )}
            dangerouslySetInnerHTML={{ __html: zoom ? highlight(zoom.value) : '' }}
          />
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ---- 代码块 ----

function CodeBlock({
  value,
  source,
  zoomKey,
  copiedKey,
  copyJSON,
  onZoom,
}: {
  value: unknown
  source: string
  zoomKey: string
  copiedKey: string
  copyJSON: (key: string, value: unknown) => void
  onZoom: (zoom: { key: string; title: string; value: unknown }) => void
}): ReactNode {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex items-center gap-1.5 border-b bg-muted/40 px-2 py-1">
        <span className="rounded bg-background px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
          json
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">{source}</span>
        <span className="ml-auto flex items-center gap-1">
          <Button
            className="h-5 px-1.5 text-[11px]"
            onClick={() => copyJSON(zoomKey, value)}
            size="xs"
            variant="ghost"
          >
            {copiedKey === zoomKey ? <Check /> : null}
            {copiedKey === zoomKey ? '已复制' : '复制'}
          </Button>
          <Button
            className="h-5 px-1.5 text-[11px]"
            onClick={() => onZoom({ key: zoomKey, title: source, value })}
            size="xs"
            title="放大展示"
            variant="ghost"
          >
            <ZoomIn />
            放大
          </Button>
        </span>
      </div>
      <pre
        className="max-h-48 overflow-auto bg-muted/20 p-2.5 font-mono text-xs leading-relaxed"
        dangerouslySetInnerHTML={{ __html: highlight(value) }}
      />
    </div>
  )
}

/** 请求体 / 响应体双栏（workbook 级 JSON；响应与请求同构） */
function PayloadColumns({
  data,
  copiedKey,
  copyJSON,
  onZoom,
}: {
  data: InspectorSnapshot
  copiedKey: string
  copyJSON: (key: string, value: unknown) => void
  onZoom: (zoom: { key: string; title: string; value: unknown }) => void
}): ReactNode {
  const response = data ? { code: 0, message: 'ok', data: data.payload } : null
  const parts: Array<[string, string, unknown]> = [
    ['payload', '请求体（提交）', data?.payload],
    ['response', '响应体（返回，与请求同构）', response],
  ]
  return (
    <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
      {parts.map(([key, label, value]) => (
        <div className="flex flex-col" key={key}>
          <span className="mb-1 w-fit rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {label}
          </span>
          <CodeBlock
            copiedKey={copiedKey}
            copyJSON={copyJSON}
            onZoom={onZoom}
            source="sheets[].snapshot()"
            value={value}
            zoomKey={key}
          />
        </div>
      ))}
    </div>
  )
}

// ---- 快照收集 ----

function collectCells(store: SheetStore): Record<string, unknown> {
  const cells: Record<string, unknown> = {}
  for (let row = 0; row < store.getRowCount(); row++) {
    for (let col = 0; col < store.getColCount(); col++) {
      const value = store.getValue(col, row)
      if (value != null) {
        cells[formatCellAddress(col, row)] = value
      }
    }
  }
  return cells
}

function collectStyles(store: SheetStore): Record<string, unknown> {
  const styles: Record<string, unknown> = {}
  for (let row = 0; row < store.getRowCount(); row++) {
    for (let col = 0; col < store.getColCount(); col++) {
      const style = store.getStyle(col, row)
      if (style) {
        styles[formatCellAddress(col, row)] = style
      }
    }
  }
  return styles
}

function formatRange(range: {
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}): string {
  return `${formatCellAddress(range.startCol, range.startRow)}:${formatCellAddress(range.endCol, range.endRow)}`
}

function buildSheetPayload(
  id: string,
  store: SheetStore,
  labelOf: ((id: string) => string) | undefined,
): Record<string, unknown> {
  return {
    name: labelOf ? labelOf(id) : id,
    cells: collectCells(store),
    styles: collectStyles(store),
    merges: store.getMerges().map(formatRange),
    frozen: store.getFrozen(),
    colWidths: Object.fromEntries(
      [...store.getColWidthOverrides()].map(([col, width]) => [colLetters(col), width]),
    ),
    rowHeights: Object.fromEntries(store.getRowHeightOverrides()),
  }
}

/** JSON 语法高亮（仅 key 包 span；值保持纯文本，转义防注入） */
function highlight(value: unknown): string {
  const raw = JSON.stringify(value, null, 2) ?? String(value)
  const lines = raw.split('\n')
  const truncated = lines.length > HIGHLIGHT_MAX_LINES
  const shown = truncated ? lines.slice(0, HIGHLIGHT_MAX_LINES) : lines
  const escaped = shown
    .join('\n')
    .replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!)
  let html = escaped.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?/g,
    (match, str: string, colon: string) =>
      colon ? `<span class="text-sky-700 dark:text-sky-300">${str}</span>${colon}` : match,
  )
  if (truncated) {
    html +=
      `\n<span class="text-muted-foreground">… 已截断（共 ${lines.length.toLocaleString()} 行），` +
      '完整数据请「复制」或「放大」</span>'
  }
  return html
}
