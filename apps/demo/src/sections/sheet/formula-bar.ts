// 公式栏（对标 ultra-ui formula-bar）：名称框（A1/B3:D5，可输入跳转）+ fx 标识（函数面板）
// + 输入区（多行自适应增高、Enter 提交 / Esc 取消）+ 编辑态 ✓/✗ + 函数建议列表。
// 引擎编辑会话镜像：编辑器元素 input 事件逐字镜像（demo 级实现）。

import { normalizeRange, type ListTable } from '@infinite-table/core'

import type { SheetStore } from '@infinite-table/plugins'

import { FUNCTION_CATEGORIES, SHEET_FUNCTIONS } from './functions'
import { closeActivePopup, isPopupAnchoredTo, openAnchoredPopup } from './popup'
import type { SheetBookBundle } from './book'

export interface FormulaBarHandle {
  /** 选区/值变化后刷新显示 */
  refresh(): void
  /** 函数面板/建议确认的插入落点：以 `=NAME(` 形态替换尾部函数名 token */
  insertSnippet(snippet: string): void
  destroy(): void
}

/** 0 基列号 → 字母（A=0 … Z=25, AA=26 …） */
export function colLetters(col: number): string {
  let text = ''
  let value = col
  while (value >= 0) {
    text = String.fromCharCode(65 + (value % 26)) + text
    value = Math.floor(value / 26) - 1
  }
  return text
}

/** 0 基坐标 → A1 形态地址 */
export function formatCellAddress(col: number, row: number): string {
  return `${colLetters(col)}${row + 1}`
}

/** 解析 A1 / B3:D5；非法返回 null */
export function parseCellAddress(text: string): { col: number; row: number } | null {
  const single = /^([A-Za-z]+)([0-9]+)$/.exec(text.trim())
  if (!single) {
    return null
  }
  const col = single[1]!.toUpperCase()
  let colIndex = 0
  for (const char of col) {
    colIndex = colIndex * 26 + (char.charCodeAt(0) - 64)
  }
  return { col: colIndex - 1, row: Number(single[2]!) - 1 }
}

export function mountFormulaBar(
  area: HTMLElement,
  ctx: {
    table: () => ListTable
    store: () => SheetStore
    notify: (text: string, kind?: 'info' | 'warn') => void
    bundle: SheetBookBundle
  },
): FormulaBarHandle {
  const bar = document.createElement('div')
  bar.className = 'sheet-app__formula-bar'

  const nameBox = document.createElement('input')
  nameBox.type = 'text'
  nameBox.className = 'sheet-name-box'
  nameBox.title = '单元格地址或区域（如 B3 或 B3:D5），回车跳转'
  nameBox.setAttribute('aria-label', '单元格地址')

  const fxButton = document.createElement('button')
  fxButton.type = 'button'
  fxButton.className = 'sheet-fx-label'
  fxButton.textContent = 'fx'
  fxButton.title = '插入函数'

  const editor = document.createElement('div')
  editor.className = 'sheet-fx-editor'
  const input = document.createElement('textarea')
  input.className = 'sheet-fx-input'
  input.rows = 1
  input.title = "活动单元格内容（'=' 开头为公式）；Enter 提交，Esc 取消"
  input.setAttribute('aria-label', '公式输入')
  editor.appendChild(input)

  const confirmButton = document.createElement('button')
  confirmButton.type = 'button'
  confirmButton.className = 'sheet-fx-btn'
  confirmButton.title = '提交（Enter）'
  confirmButton.textContent = '✓'
  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.className = 'sheet-fx-btn'
  cancelButton.title = '取消（Esc）'
  cancelButton.textContent = '✗'
  bar.append(nameBox, fxButton, editor, confirmButton, cancelButton)
  area.appendChild(bar)

  let mirroredEditor: HTMLTextAreaElement | HTMLInputElement | null = null
  let suspended = false
  let suggestIndex = -1
  let suggestItems: string[] = []
  const suggestions = document.createElement('div')
  suggestions.className = 'sheet-fx-suggest'

  /** 当前焦点格（选区首段锚点；无选区 null） */
  const focusCell = (): { col: number; row: number } | null => {
    const range = ctx.table().getSelectedCellRanges()[0]
    if (!range) {
      return null
    }
    const bounds = normalizeRange(range)
    return { col: bounds.minCol, row: bounds.minRow }
  }

  const refreshEditorChrome = (): void => {
    // 编辑态（引擎会话或输入区聚焦）显示 ✓/✗；输入区按内容自适应增高（上限 8 行）
    const editing = suspended || document.activeElement === input
    confirmButton.classList.toggle('is-visible', editing)
    cancelButton.classList.toggle('is-visible', editing)
    input.style.height = ''
    if (input.value.includes('\n') || editing) {
      input.style.height = `${Math.min(input.scrollHeight, 24 * 8)}px`
    }
  }

  const hideSuggestions = (): void => {
    suggestions.textContent = ''
    suggestions.remove()
    suggestItems = []
    suggestIndex = -1
  }

  const applySuggestion = (name: string): void => {
    input.value = input.value.replace(/[A-Za-z]*$/, `${name}(`)
    hideSuggestions()
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
    refreshEditorChrome()
  }

  const renderSuggestions = (): void => {
    hideSuggestions()
    const match = /=\s*([A-Za-z]*)$/.exec(input.value)
    if (!match) {
      return
    }
    const prefix = match[1]!.toUpperCase()
    suggestItems = SHEET_FUNCTIONS.filter((fn) => fn.name.startsWith(prefix))
      .slice(0, 10)
      .map((fn) => fn.name)
    if (suggestItems.length === 0) {
      return
    }
    suggestIndex = 0
    for (const name of suggestItems) {
      const fn = SHEET_FUNCTIONS.find((item) => item.name === name)!
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'sheet-fx-suggest__item'
      const signature = document.createElement('div')
      signature.className = 'sheet-fx-suggest__signature'
      signature.textContent = fn.signature
      const description = document.createElement('div')
      description.className = 'sheet-fx-suggest__description'
      description.textContent = fn.description
      item.append(signature, description)
      item.addEventListener('mousedown', (event) => {
        event.preventDefault()
        applySuggestion(name)
      })
      suggestions.appendChild(item)
    }
    suggestions.children[suggestIndex]?.classList.add('is-active')
    editor.appendChild(suggestions)
  }

  const refreshSuggestActive = (): void => {
    for (let index = 0; index < suggestions.children.length; index++) {
      suggestions.children[index]?.classList.toggle('is-active', index === suggestIndex)
    }
    ;(suggestions.children[suggestIndex] as HTMLElement | undefined)?.scrollIntoView({
      block: 'nearest',
    })
  }

  const refresh = (): void => {
    if (suspended) {
      return
    }
    const cell = focusCell()
    if (!cell) {
      nameBox.value = ''
      if (document.activeElement !== input) {
        input.value = ''
      }
      hideSuggestions()
      refreshEditorChrome()
      return
    }
    const range = ctx.table().getSelectedCellRanges()[0]!
    nameBox.value =
      range.start.col === range.end.col && range.start.row === range.end.row
        ? formatCellAddress(cell.col, cell.row)
        : `${formatCellAddress(range.start.col, range.start.row)}:${formatCellAddress(range.end.col, range.end.row)}`
    // 输入区聚焦（公式编辑 / 引用拾取）时不覆盖内容，与 ultra-ui「编辑中不覆盖」一致
    if (document.activeElement === input) {
      return
    }
    const raw = ctx.store().getValue(cell.col, cell.row)
    input.value = raw == null ? '' : String(raw)
    hideSuggestions()
    refreshEditorChrome()
  }

  // ---- 引用拾取：输入区聚焦且公式态时，画布点选/拖选把地址插入光标处（不提交） ----
  let refPickStart = -1

  const insertRefAtCursor = (): void => {
    const range = ctx.table().getSelectedCellRanges()[0]
    if (!range) {
      return
    }
    const text =
      range.start.col === range.end.col && range.start.row === range.end.row
        ? formatCellAddress(range.start.col, range.start.row)
        : `${formatCellAddress(range.start.col, range.start.row)}:${formatCellAddress(range.end.col, range.end.row)}`
    const at = refPickStart >= 0 ? refPickStart : (input.selectionStart ?? input.value.length)
    // 吃掉插入点前紧邻的旧引用 token（连续拖选时原位替换）
    const before = input.value.slice(0, at).replace(/[A-Za-z0-9:]+$/, '')
    refPickStart = before.length
    input.value = before + text + input.value.slice(at)
    input.setSelectionRange(refPickStart + text.length, refPickStart + text.length)
    refreshEditorChrome()
  }

  /** 提交：写回 Store + 局部刷新 */
  const commit = (): void => {
    const cell = focusCell()
    if (!cell) {
      return
    }
    suspended = true
    ctx.store().setValue(cell.col, cell.row, input.value === '' ? null : input.value)
    ctx.table().refreshCell(cell.col, cell.row)
    suspended = false
    ctx.notify(`${nameBox.value} 已更新`)
    hideSuggestions()
    input.blur()
    refresh()
  }

  const cancel = (): void => {
    refresh()
    input.blur()
  }

  // 名称框跳转
  nameBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const rangeMatch = /^([A-Za-z]+[0-9]+):([A-Za-z]+[0-9]+)$/.exec(nameBox.value.trim())
      if (rangeMatch) {
        const start = parseCellAddress(rangeMatch[1]!)
        const end = parseCellAddress(rangeMatch[2]!)
        if (start && end) {
          ctx
            .table()
            .selectCells([
              { start: { col: start.col, row: start.row }, end: { col: end.col, row: end.row } },
            ])
          ctx.table().scrollToCell({ col: start.col, row: start.row })
          refresh()
          nameBox.blur()
          return
        }
      }
      const single = parseCellAddress(nameBox.value)
      if (!single || single.col < 0 || single.row < 0) {
        ctx.notify('无效的单元格地址', 'warn')
        return
      }
      ctx.table().selectCell(single.col, single.row)
      ctx.table().scrollToCell(single)
      refresh()
      nameBox.blur()
    } else if (event.key === 'Escape') {
      refresh()
      nameBox.blur()
    }
  })

  // 输入区：Enter 提交（建议打开时确认建议）/ Esc 取消 / 建议导航
  input.addEventListener('keydown', (event) => {
    if (suggestItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        suggestIndex = (suggestIndex + 1) % suggestItems.length
        refreshSuggestActive()
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        suggestIndex = (suggestIndex - 1 + suggestItems.length) % suggestItems.length
        refreshSuggestActive()
        return
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault()
        applySuggestion(suggestItems[suggestIndex]!)
        return
      }
      if (event.key === 'Escape') {
        event.stopPropagation()
        hideSuggestions()
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      cancel()
    }
  })
  input.addEventListener('input', () => {
    refPickStart = -1
    renderSuggestions()
    refreshEditorChrome()
  })
  input.addEventListener('focus', refreshEditorChrome)
  input.addEventListener('blur', () => {
    refPickStart = -1
    window.setTimeout(refreshEditorChrome, 120)
  })
  confirmButton.addEventListener('click', commit)
  cancelButton.addEventListener('click', cancel)

  // fx 按钮：下方弹函数面板（精简版：分类 + 列表；插入落点为本输入区）
  fxButton.addEventListener('click', () => {
    if (isPopupAnchoredTo(fxButton)) {
      closeActivePopup()
      return
    }
    openAnchoredPopup(fxButton, {
      build(el, close) {
        el.classList.add('sheet-popup', 'sheet-popup--functions')
        const nav = document.createElement('div')
        nav.className = 'sheet-functions__nav'
        const list = document.createElement('div')
        list.className = 'sheet-functions__list'
        let category: string = FUNCTION_CATEGORIES[0]
        const render = (): void => {
          list.textContent = ''
          for (const fn of SHEET_FUNCTIONS.filter((item) => category !== '常用' || item.common)) {
            const item = document.createElement('button')
            item.type = 'button'
            item.className = 'sheet-functions__item'
            const signature = document.createElement('div')
            signature.className = 'sheet-functions__signature'
            signature.textContent = fn.signature
            const description = document.createElement('div')
            description.className = 'sheet-functions__description'
            description.textContent = fn.description
            item.append(signature, description)
            item.addEventListener('click', () => {
              insertSnippet(`=${fn.name}(`)
              close()
            })
            list.appendChild(item)
          }
        }
        for (const name of FUNCTION_CATEGORIES) {
          const item = document.createElement('button')
          item.type = 'button'
          item.className = 'sheet-functions__nav-item'
          item.textContent = name
          if (name === category) {
            item.classList.add('is-active')
          }
          item.addEventListener('click', () => {
            category = name
            for (const child of nav.children) {
              child.classList.toggle('is-active', child === item)
            }
            render()
          })
          nav.appendChild(item)
        }
        el.append(nav, list)
        render()
      },
    })
  })

  const insertSnippet = (snippet: string): void => {
    input.value = snippet
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
    renderSuggestions()
    refreshEditorChrome()
  }

  // 引擎编辑会话镜像：开始时锁定显示、编辑器逐字镜像；结束后解锁刷新
  const onEditorInput = (): void => {
    if (mirroredEditor) {
      input.value = mirroredEditor.value
      renderSuggestions()
      refreshEditorChrome()
    }
  }

  /** 监听随活跃实例切换重挂（切 tab 后其余 sheet 的选区/编辑会话同样生效） */
  let boundTable: ListTable | null = null
  let bindings: Array<() => void> = []
  const bindTo = (table: ListTable): void => {
    if (table === boundTable) {
      return
    }
    for (const off of bindings) {
      off()
    }
    mirroredEditor?.removeEventListener('input', onEditorInput)
    mirroredEditor = null
    bindings = [
      table.onSelectionChange(() => {
        // 引用拾取：输入区聚焦且公式态时，画布选区 → 光标处插入地址（不提交）
        if (
          !suspended &&
          document.activeElement === input &&
          input.value.trimStart().startsWith('=')
        ) {
          insertRefAtCursor()
          return
        }
        refresh()
      }),
      table.onEditStart((edit) => {
        suspended = true
        nameBox.value = formatCellAddress(edit.col, edit.row)
        input.value = edit.initialValue == null ? '' : String(edit.initialValue)
        // 编辑器元素在表格容器内（demo 级镜像：监听其 input 事件）
        const editorEl = table.options.hostOptions?.container?.querySelector('textarea, input')
        if (editorEl instanceof HTMLTextAreaElement || editorEl instanceof HTMLInputElement) {
          mirroredEditor = editorEl
          editorEl.addEventListener('input', onEditorInput)
        }
        refreshEditorChrome()
      }),
      table.onEditEnd(() => {
        mirroredEditor?.removeEventListener('input', onEditorInput)
        mirroredEditor = null
        suspended = false
        refresh()
      }),
    ]
    boundTable = table
  }
  bindTo(ctx.table())
  const offBookChange = ctx.bundle.book.onChange((event) => {
    if (!event.table) {
      return
    }
    suspended = false
    bindTo(event.table)
    refresh()
  })

  refresh()

  return {
    refresh,
    insertSnippet,
    destroy() {
      offBookChange()
      for (const off of bindings) {
        off()
      }
      bindings = []
      mirroredEditor?.removeEventListener('input', onEditorInput)
      hideSuggestions()
      bar.remove()
    },
  }
}
