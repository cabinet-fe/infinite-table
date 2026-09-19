// 数据结构观察区（对标 ultra-ui 演示页 inspector）：手动刷新快照（非实时订阅），
// 懒渲染 JSON 区块（展开才挂载 DOM）、key 级语法高亮、复制反馈、放大对话框（可拖拽/最大化）。
// 数据源全部来自 SheetStore / ListTable 公开 API（稀疏全表扫描仅在点击刷新时执行一次）。

import type { ListTable } from '@infinite-table/core'

import type { SheetStore, UndoStack } from '@infinite-table/plugins'

import { formatCellAddress, colLetters } from './formula-bar'
import type { SheetBookBundle } from './book'

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
  /** 标题竖条配色（token 名） */
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

export interface InspectorHandle {
  destroy(): void
}

export function mountInspector(
  root: HTMLElement,
  ctx: {
    bundle: SheetBookBundle
    table: () => ListTable
    store: () => SheetStore
    stack: UndoStack
    /** id → 展示名 */
    labelOf: (id: string) => string
  },
): InspectorHandle {
  const panel = document.createElement('div')
  panel.className = 'sheet-inspector'

  const snapshot = { data: null as InspectorSnapshot | null }
  const expanded = new Map<string, boolean>([['meta', true]])
  let copiedKey = ''
  let copyTimer = 0

  // ---- 头部 ----
  const head = document.createElement('div')
  head.className = 'sheet-inspector__head'
  const title = document.createElement('strong')
  title.className = 'sheet-inspector__title'
  const caret = document.createElement('span')
  caret.className = 'sheet-inspector__caret'
  const dot = document.createElement('span')
  dot.className = 'sheet-inspector__dot'
  const titleText = document.createElement('span')
  titleText.textContent = '数据结构观察（手动刷新）'
  title.append(caret, dot, titleText)
  const headRight = document.createElement('div')
  headRight.className = 'sheet-inspector__head-right'
  const meta = document.createElement('span')
  meta.className = 'sheet-inspector__meta'
  const refreshButton = document.createElement('button')
  refreshButton.type = 'button'
  refreshButton.className = 'sheet-inspector__refresh'
  refreshButton.title = '获取当前活动表数据（非实时，点击才刷新）'
  refreshButton.textContent = '刷新数据'
  headRight.append(meta, refreshButton)
  head.append(title, headRight)

  const body = document.createElement('div')
  body.className = 'sheet-inspector__grid'
  const empty = document.createElement('div')
  empty.className = 'sheet-inspector__empty'
  empty.textContent =
    '尚未获取数据——点击头部「刷新数据」按钮获取当前活动表快照（非实时，不影响表格操作性能）'
  body.appendChild(empty)
  panel.append(head, body)
  root.appendChild(panel)

  const collapsed = { value: true }
  const renderCollapse = (): void => {
    caret.textContent = collapsed.value ? '▸' : '▾'
    body.style.display = collapsed.value ? 'none' : ''
  }
  head.addEventListener('click', (event) => {
    if (event.target === refreshButton || refreshButton.contains(event.target as Node)) {
      return
    }
    collapsed.value = !collapsed.value
    renderCollapse()
  })
  renderCollapse()

  // ---- 快照收集 ----
  const collectCells = (store: SheetStore): Record<string, unknown> => {
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

  const collectStyles = (store: SheetStore): Record<string, unknown> => {
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

  const formatRange = (range: {
    startCol: number
    startRow: number
    endCol: number
    endRow: number
  }): string =>
    `${formatCellAddress(range.startCol, range.startRow)}:${formatCellAddress(range.endCol, range.endRow)}`

  const buildSheetPayload = (id: string, store: SheetStore): Record<string, unknown> => ({
    name: ctx.labelOf(id),
    cells: collectCells(store),
    styles: collectStyles(store),
    merges: store.getMerges().map(formatRange),
    frozen: store.getFrozen(),
    colWidths: Object.fromEntries(
      [...store.getColWidthOverrides()].map(([col, width]) => [colLetters(col), width]),
    ),
    rowHeights: Object.fromEntries(store.getRowHeightOverrides()),
  })

  const refresh = (): void => {
    const store = ctx.store()
    const table = ctx.table()
    const cells = collectCells(store)
    const styles = collectStyles(store)
    const activeId = ctx.bundle.book.activeId
    const payload = {
      sheets: ctx.bundle.ids().map((id) => buildSheetPayload(id, ctx.bundle.stores.get(id)!)),
      activeIndex: Math.max(
        0,
        ctx.bundle.ids().findIndex((id) => id === activeId),
      ),
    }
    snapshot.data = {
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
        history: { canUndo: ctx.stack.canUndo, canRedo: ctx.stack.canRedo },
      },
      payload,
      storeCount: Object.keys(cells).length,
      styleCount: Object.keys(styles).length,
      rowCount: store.getRowCount(),
      colCount: store.getColCount(),
    }
    meta.textContent =
      `活动表：${ctx.labelOf(activeId ?? '')} · 存储 ${snapshot.data.storeCount} 格 ` +
      `/ 高水位 ${snapshot.data.rowCount}×${snapshot.data.colCount} · 样式 ${snapshot.data.styleCount} 条`
    empty.remove()
    renderBlocks()
  }
  refreshButton.addEventListener('click', (event) => {
    event.stopPropagation()
    refresh()
  })

  // ---- 区块渲染（懒挂载） ----
  const renderBlocks = (): void => {
    body.textContent = ''
    for (const block of BLOCKS) {
      const section = document.createElement('section')
      section.className = `sheet-inspector__block${block.wide ? ' is-wide' : ''}`
      const head4 = document.createElement('h4')
      head4.className = `sheet-inspector__block-title is-${block.tone}`
      head4.title = '点击展开 / 折叠（懒渲染：大数据 JSON 仅在展开时挂载 DOM）'
      const blockCaret = document.createElement('span')
      blockCaret.className = 'sheet-inspector__block-caret'
      blockCaret.textContent = expanded.get(block.key) ? '▾' : '▸'
      const label = document.createElement('span')
      label.className = 'sheet-inspector__block-label'
      label.textContent = block.title
      head4.append(blockCaret, label)
      section.appendChild(head4)
      head4.addEventListener('click', () => {
        expanded.set(block.key, !expanded.get(block.key))
        renderBlocks()
      })
      if (expanded.get(block.key)) {
        if (block.key === 'payload') {
          renderPayloadSection(section)
        } else {
          renderCodeBlock(section, block, snapshot.data?.[block.key])
        }
      }
      body.appendChild(section)
    }
  }

  const renderCodeBlock = (section: HTMLElement, block: BlockDef, value: unknown): void => {
    const code = document.createElement('div')
    code.className = 'sheet-inspector__code'
    const barEl = document.createElement('div')
    barEl.className = 'sheet-inspector__code-bar'
    barEl.append(
      codeChip('json', 'sheet-inspector__code-lang'),
      codeChip(block.source, 'sheet-inspector__code-source'),
    )
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'sheet-inspector__code-copy'
    copy.textContent = '复制'
    copy.addEventListener('click', () => copyJSON(block.key, value, copy))
    const zoom = document.createElement('button')
    zoom.type = 'button'
    zoom.className = 'sheet-inspector__code-copy'
    zoom.title = '放大展示'
    zoom.textContent = '放大'
    zoom.addEventListener('click', () => openZoom(block.key, block.title, value))
    barEl.append(copy, zoom)
    const pre = document.createElement('pre')
    pre.className = 'sheet-inspector__pre'
    pre.innerHTML = highlight(value)
    code.append(barEl, pre)
    section.appendChild(code)
  }

  const renderPayloadSection = (section: HTMLElement): void => {
    const columns = document.createElement('div')
    columns.className = 'sheet-inspector__api'
    const data = snapshot.data
    const parts: Array<[string, string, unknown]> = [
      ['请求体（提交）', 'is-req', data?.payload],
      [
        '响应体（返回，与请求同构）',
        'is-res',
        data ? { code: 0, message: 'ok', data: data.payload } : null,
      ],
    ]
    for (const [label, tone, value] of parts) {
      const column = document.createElement('div')
      column.className = 'sheet-inspector__api-col'
      const tag = document.createElement('span')
      tag.className = `sheet-inspector__api-tag ${tone}`
      tag.textContent = label
      column.appendChild(tag)
      const code = document.createElement('div')
      code.className = 'sheet-inspector__code'
      const barEl = document.createElement('div')
      barEl.className = 'sheet-inspector__code-bar'
      barEl.append(
        codeChip('json', 'sheet-inspector__code-lang'),
        codeChip('sheets[].snapshot()', 'sheet-inspector__code-source'),
      )
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'sheet-inspector__code-copy'
      copy.textContent = '复制'
      const key = tone === 'is-req' ? 'payload' : 'response'
      copy.addEventListener('click', () =>
        copyJSON(
          key,
          key === 'payload'
            ? data?.payload
            : data
              ? { code: 0, message: 'ok', data: data.payload }
              : null,
          copy,
        ),
      )
      const zoom = document.createElement('button')
      zoom.type = 'button'
      zoom.className = 'sheet-inspector__code-copy'
      zoom.title = '放大展示'
      zoom.textContent = '放大'
      zoom.addEventListener('click', () => openZoom(key, label, value))
      barEl.append(copy, zoom)
      const pre = document.createElement('pre')
      pre.className = 'sheet-inspector__pre'
      pre.innerHTML = highlight(value)
      code.append(barEl, pre)
      column.appendChild(code)
      columns.appendChild(column)
    }
    section.appendChild(columns)
  }

  const codeChip = (text: string, className: string): HTMLElement => {
    const chip = document.createElement('span')
    chip.className = className
    chip.textContent = text
    return chip
  }

  const copyJSON = (key: string, value: unknown, button: HTMLElement): void => {
    void navigator.clipboard.writeText(JSON.stringify(value, null, 2)).then(() => {
      copiedKey = key
      button.textContent = '已复制'
      button.classList.add('is-copied')
      window.clearTimeout(copyTimer)
      copyTimer = window.setTimeout(() => {
        if (copiedKey === key) {
          button.textContent = '复制'
          button.classList.remove('is-copied')
        }
      }, 1500)
    })
  }

  /** JSON 语法高亮（仅 key 包 span；值保持纯文本，转义防注入） */
  const highlight = (value: unknown): string => {
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
        colon ? `<span class="j-key">${str}</span>${colon}` : match,
    )
    if (truncated) {
      html +=
        `\n<span class="sheet-inspector__truncated">… 已截断（共 ${lines.length.toLocaleString()} 行），` +
        '完整数据请「复制」或「放大」</span>'
    }
    return html
  }

  // ---- 放大对话框（可拖拽 / 最大化 / Esc 关闭） ----
  const openZoom = (key: string, titleTextValue: string, value: unknown): void => {
    const overlay = document.createElement('div')
    overlay.className = 'sheet-zoom-overlay'
    const dialog = document.createElement('div')
    dialog.className = 'sheet-zoom-dialog'
    const dialogHead = document.createElement('div')
    dialogHead.className = 'sheet-zoom-dialog__head'
    const dialogTitle = document.createElement('span')
    dialogTitle.textContent = titleTextValue
    const maximize = document.createElement('button')
    maximize.type = 'button'
    maximize.className = 'sheet-zoom-dialog__maximize'
    maximize.title = '最大化 / 还原'
    maximize.textContent = '⛶'
    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'sheet-zoom-dialog__close'
    closeButton.title = '关闭'
    closeButton.textContent = '✕'
    dialogHead.append(dialogTitle, maximize, closeButton)
    const toolbarEl = document.createElement('div')
    toolbarEl.className = 'sheet-zoom-dialog__toolbar'
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'sheet-inspector__code-copy'
    copy.textContent = '复制'
    copy.addEventListener('click', () => copyJSON(`zoom-${key}`, value, copy))
    toolbarEl.appendChild(copy)
    const pre = document.createElement('pre')
    pre.className = 'sheet-inspector__pre sheet-zoom-dialog__pre'
    pre.innerHTML = highlight(value)
    dialog.append(dialogHead, toolbarEl, pre)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    const close = (): void => {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
    }
    closeButton.addEventListener('click', close)
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) {
        close()
      }
    })
    const onKey = (event: Event): void => {
      if ((event as KeyboardEvent).key === 'Escape') {
        close()
      }
    }
    document.addEventListener('keydown', onKey, true)
    maximize.addEventListener('click', () => dialog.classList.toggle('is-maximized'))

    // 头部拖拽（仅未最大化时）
    dialogHead.addEventListener('pointerdown', (event) => {
      if (dialog.classList.contains('is-maximized') || event.button !== 0) {
        return
      }
      const startX = event.clientX - dialog.offsetLeft
      const startY = event.clientY - dialog.offsetTop
      const onMove = (move: PointerEvent): void => {
        dialog.style.left = `${Math.max(0, move.clientX - startX)}px`
        dialog.style.top = `${Math.max(0, move.clientY - startY)}px`
      }
      const onUp = (): void => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    })
  }

  return {
    destroy() {
      window.clearTimeout(copyTimer)
      panel.remove()
    },
  }
}
