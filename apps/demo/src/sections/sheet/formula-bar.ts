// 公式栏（对标 ultra-ui formula-bar）：名称框（A1/B3:D5，可输入跳转）+ fx 标识（函数面板）
// + 输入区（多行自适应增高、Enter 提交 / Esc 取消）+ 编辑态 ✓/✗ + 函数建议列表 + 参数提示 calltip。
// 补全/提示数据单一来源：@infinite-table/formulas 注册表元数据。
// 引擎编辑会话镜像：编辑器元素 input 事件逐字镜像（demo 级实现）。

import { normalizeRange, type HighlightRange, type ListTable } from '@infinite-table/core'

import {
  FORMULA_FUNCTION_CATEGORIES,
  colLetters,
  getFormulaFunctionInfo,
  listFormulaFunctions,
  scanFormulaReferences,
  type FormulaFunctionInfo,
} from '@infinite-table/formulas'
import type { SheetStore } from '@infinite-table/plugins'

import { closeActivePopup, isPopupAnchoredTo, openAnchoredPopup } from './popup'
import type { SheetBookBundle } from './book'

export interface FormulaBarHandle {
  /** 选区/值变化后刷新显示 */
  refresh(): void
  /** 函数面板/建议确认的插入落点：以 `=NAME()` 形态写入，光标落括号内 */
  insertSnippet(name: string): void
  destroy(): void
}

export { colLetters }

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

// ---- 补全与参数提示的纯逻辑（对齐 ultra-ui use-formula-suggest 规则） ----

/** 补全候选上限 */
const SUGGEST_LIMIT = 10

/** 函数名 token 前合法的「触发」字符（= / 运算符 / ( / ,） */
const SUGGEST_TRIGGER_CHARS = new Set(['=', '(', ',', '+', '-', '*', '/', '^', '&', '<', '>'])

/** 空前缀时「常用」分类的固定展示顺序（纯字典序会把 SUM 挤出前 10） */
const COMMON_ORDER = ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN', 'IF', 'ROUND', 'ABS', 'AND', 'OR']

interface SuggestContext {
  /** 当前前缀（可能为空：紧跟触发字符后） */
  prefix: string
  /** 前缀在文本中的起始下标（含） */
  start: number
  /** 光标位置（= 前缀结束下标） */
  end: number
}

/**
 * 判定补全上下文：光标前向匹配函数名 token（或紧跟 `=` 的空前缀），
 * 且 token 前一个非空字符 ∈ 触发字符集（`=` / 运算符 / `(` / `,`）。
 */
function getSuggestContext(text: string, cursor: number): SuggestContext | null {
  if (cursor < 0 || cursor > text.length) {
    return null
  }
  const before = text.slice(0, cursor)
  const tokenMatch = /[A-Za-z][A-Za-z0-9_.]*$/.exec(before)
  const prefix = tokenMatch?.[0] ?? ''
  const start = tokenMatch ? cursor - prefix.length : cursor

  // 空前缀仅在紧跟 `=` 后弹出；`<=` / `>=` 的尾随 `=` 是比较运算符一部分，不是函数名起点
  if (!tokenMatch) {
    const trimmed = before.replace(/\s+$/, '')
    if (!trimmed.endsWith('=') || trimmed.endsWith('<=') || trimmed.endsWith('>=')) {
      return null
    }
    return { prefix: '', start, end: cursor }
  }

  const beforeToken = before.slice(0, start).replace(/\s+$/, '')
  if (beforeToken.length === 0) {
    return null
  }
  const last = beforeToken[beforeToken.length - 1]!
  if (!SUGGEST_TRIGGER_CHARS.has(last)) {
    return null
  }
  return { prefix, start, end: cursor }
}

/** 前缀过滤（大小写不敏感，上限 SUGGEST_LIMIT）：空前缀常用优先，其余按注册表名称升序 */
function filterSuggestions(prefix: string): FormulaFunctionInfo[] {
  const upper = prefix.toUpperCase()
  const all = listFormulaFunctions()
  if (!upper) {
    const byName = new Map(all.map((info) => [info.name, info]))
    const items: FormulaFunctionInfo[] = []
    const used = new Set<string>()
    for (const name of COMMON_ORDER) {
      const info = byName.get(name)
      if (!info) {
        continue
      }
      items.push(info)
      used.add(name)
      if (items.length >= SUGGEST_LIMIT) {
        return items
      }
    }
    for (const info of all) {
      if (used.has(info.name)) {
        continue
      }
      items.push(info)
      if (items.length >= SUGGEST_LIMIT) {
        break
      }
    }
    return items
  }
  return all.filter((info) => info.name.startsWith(upper)).slice(0, SUGGEST_LIMIT)
}

/** 将 [start, end) 的 token 替换为 `NAME()`，返回新文本与光标位置（落在括号内） */
function applySuggestText(
  text: string,
  context: SuggestContext,
  name: string,
): { text: string; cursor: number } {
  const next = text.slice(0, context.start) + `${name}()` + text.slice(context.end)
  return { text: next, cursor: context.start + name.length + 1 }
}

/**
 * 光标所处函数调用：向回扫描括号深度，取未闭合 `(` 前的函数名与同深度逗号数（当前参数下标）。
 * 字符串字面量整体跳过（回退到前一个双引号；`""` 转义的极端形态不细分，demo 级简化）。
 */
function getCallContext(text: string, cursor: number): { name: string; paramIndex: number } | null {
  let depth = 0
  let paramIndex = 0
  let index = cursor - 1
  while (index >= 0) {
    const char = text[index]!
    if (char === '"') {
      index--
      while (index >= 0 && text[index] !== '"') {
        index--
      }
    } else if (char === ')') {
      depth++
    } else if (char === '(') {
      if (depth === 0) {
        const match = /([A-Za-z][A-Za-z0-9_.]*)\s*$/.exec(text.slice(0, index))
        if (!match) {
          return null
        }
        return { name: match[1]!.toUpperCase(), paramIndex }
      }
      depth--
    } else if (char === ',' && depth === 0) {
      paramIndex++
    }
    index--
  }
  return null
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
  // ---- 公式组合会话（显式状态，替代「输入区持有 DOM 焦点」的脆弱探测）----
  // 'bar'：公式栏输入区编辑；'engine'：引擎格内编辑会话（编辑器镜像 mirroredEditor）。
  // 会话中画布点选/拖选把引用插入编辑目标光标处（不提交），键入经容器 keydown 路由回目标；
  // 只有显式提交/取消结束会话（画布点击/失焦都是拾取路径，不打断）。非公式纯文本编辑不进会话。
  let composing: 'bar' | 'engine' | null = null
  let boundContainer: HTMLElement | null = null
  let suggestIndex = -1
  let suggestItems: FormulaFunctionInfo[] = []
  let suggestContext: SuggestContext | null = null
  const suggestions = document.createElement('div')
  suggestions.className = 'sheet-fx-suggest'
  const calltip = document.createElement('div')
  calltip.className = 'sheet-fx-calltip'

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
    // 编辑态（引擎会话/组合会话/输入区聚焦）显示 ✓/✗；输入区按内容自适应增高（上限 8 行）
    const editing = suspended || composing !== null || document.activeElement === input
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
    suggestContext = null
  }

  const hideCalltip = (): void => {
    calltip.textContent = ''
    calltip.remove()
  }

  /** 参数提示：光标处于函数调用括号内时，输入区下方浮条显示签名并高亮当前参数 */
  const renderCalltip = (): void => {
    hideCalltip()
    if (document.activeElement !== input) {
      return
    }
    const cursor = input.selectionStart ?? input.value.length
    if (cursor !== input.selectionEnd) {
      return // 有选区不提示
    }
    const call = getCallContext(input.value, cursor)
    if (!call) {
      return
    }
    const info = getFormulaFunctionInfo(call.name)
    if (!info) {
      return
    }
    calltip.append(`${info.name}(`)
    // 可变参数尾巴（'...'）：光标越过后续参数恒落在尾巴上
    const active = Math.min(call.paramIndex, info.params.length - 1)
    info.params.forEach((param, index) => {
      if (index > 0) {
        calltip.append(', ')
      }
      const span = document.createElement('span')
      span.className = 'sheet-fx-calltip__param'
      span.textContent =
        param.name === '...' ? '...' : param.optional ? `[${param.name}]` : param.name
      if (index === active) {
        span.classList.add('is-active')
      }
      calltip.append(span)
    })
    calltip.append(')')
    editor.appendChild(calltip)
  }

  /** 确认建议：替换尾部函数名 token 为 `NAME()`，光标落括号内 */
  const applySuggestion = (name: string): void => {
    const context = suggestContext
    if (!context) {
      return
    }
    const next = applySuggestText(input.value, context, name)
    input.value = next.text
    hideSuggestions()
    input.focus()
    input.setSelectionRange(next.cursor, next.cursor)
    renderCalltip()
    refreshEditorChrome()
    syncRefHighlights()
  }

  const renderSuggestions = (): void => {
    hideSuggestions()
    suggestContext = getSuggestContext(input.value, input.selectionStart ?? input.value.length)
    if (!suggestContext) {
      return
    }
    suggestItems = filterSuggestions(suggestContext.prefix)
    if (suggestItems.length === 0) {
      suggestContext = null
      return
    }
    suggestIndex = 0
    for (const info of suggestItems) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'sheet-fx-suggest__item'
      const signature = document.createElement('div')
      signature.className = 'sheet-fx-suggest__signature'
      signature.textContent = info.signature
      const description = document.createElement('div')
      description.className = 'sheet-fx-suggest__description'
      description.textContent = info.description
      item.append(signature, description)
      item.addEventListener('mousedown', (event) => {
        event.preventDefault()
        applySuggestion(info.name)
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

  // ---- 引用拾取：组合会话中画布点选/拖选把地址插入编辑目标光标处（不提交） ----
  let refPickStart = -1

  /** 组合会话的编辑目标（引擎格内编辑器镜像或公式栏输入区）；无会话/镜像缺失为 null */
  const composeTarget = (): {
    el: HTMLTextAreaElement | HTMLInputElement
    engine: boolean
  } | null => {
    if (composing === 'engine') {
      return mirroredEditor ? { el: mirroredEditor, engine: true } : null
    }
    if (composing === 'bar') {
      return { el: input, engine: false }
    }
    return null
  }

  /** 编辑目标变更后的统一后续：引擎目标先镜像回输入区（建议/提示/染色框以输入区为 UI 锚） */
  const afterComposeInput = (target: {
    el: HTMLTextAreaElement | HTMLInputElement
    engine: boolean
  }): void => {
    if (target.engine) {
      input.value = target.el.value
      input.setSelectionRange(
        target.el.selectionStart ?? input.value.length,
        target.el.selectionEnd ?? input.value.length,
      )
    }
    renderSuggestions()
    renderCalltip()
    refreshEditorChrome()
    syncRefHighlights()
  }

  const insertRefAtCursor = (): void => {
    const target = composeTarget()
    if (!target) {
      return
    }
    const range = ctx.table().getSelectedCellRanges()[0]
    if (!range) {
      return
    }
    const single = range.start.col === range.end.col && range.start.row === range.end.row
    // 编辑中的格自身不拾取（点编辑格 = 无操作，防自引用）
    const editing = target.engine ? ctx.table().editManager.editingCell() : null
    if (editing && single && range.start.col === editing.col && range.start.row === editing.row) {
      return
    }
    const text = single
      ? formatCellAddress(range.start.col, range.start.row)
      : `${formatCellAddress(range.start.col, range.start.row)}:${formatCellAddress(range.end.col, range.end.row)}`
    const at =
      refPickStart >= 0 ? refPickStart : (target.el.selectionStart ?? target.el.value.length)
    // 吃掉插入点前紧邻的旧引用 token（连续拖选时原位替换；新参数由键入 , 另起新 token）
    const before = target.el.value.slice(0, at).replace(/[A-Za-z0-9:]+$/, '')
    refPickStart = before.length
    target.el.value = before + text + target.el.value.slice(at)
    target.el.setSelectionRange(refPickStart + text.length, refPickStart + text.length)
    afterComposeInput(target)
  }

  /** 组合会话锚定格（会话开始时的焦点格）：拾取会移动选区，提交仍写回锚定格 */
  let composeCell: { col: number; row: number } | null = null

  /**
   * 组合会话中被编辑格的选区锚点（core setSelectionAnchor）：拾取全程以选区样式持续绘制，
   * 选区随拾取流动到被拾取段也不丢选中态；会话结束即清，恢复常规选区行为。
   */
  const syncSelectionAnchor = (cell: { col: number; row: number } | null): void => {
    boundTable?.setSelectionAnchor(cell)
  }

  /** 提交：写回 Store + 局部刷新（写回组合会话锚定格，非当前选区） */
  const commit = (): void => {
    const cell = composeCell ?? focusCell()
    if (!cell) {
      return
    }
    composing = null
    composeCell = null
    syncSelectionAnchor(null)
    suspended = true
    ctx.store().setValue(cell.col, cell.row, input.value === '' ? null : input.value)
    ctx.table().refreshCell(cell.col, cell.row)
    suspended = false
    ctx.notify(`${nameBox.value} 已更新`)
    hideSuggestions()
    hideCalltip()
    input.blur()
    syncRefHighlights()
    refresh()
  }

  const cancel = (): void => {
    composing = null
    composeCell = null
    syncSelectionAnchor(null)
    refresh()
    input.blur()
    syncRefHighlights()
  }

  // ---- 容器键入路由：组合会话中 DOM 焦点在表格容器（画布点选拾取后），
  // 键入仍要进公式——可打印字符/退格写入编辑目标光标处，Enter 提交、Esc 取消、
  // 左右移光标；其余按键（含修饰键组合）放行给全局快捷键 ----
  const applyEdited = (
    target: { el: HTMLTextAreaElement | HTMLInputElement; engine: boolean },
    edit: (value: string, start: number, end: number) => { text: string; caret: number } | null,
  ): void => {
    const el = target.el
    const value = el.value
    const start = el.selectionStart ?? value.length
    const end = Math.max(start, el.selectionEnd ?? start)
    const next = edit(value, start, end)
    if (!next) {
      return
    }
    refPickStart = -1
    el.value = next.text
    el.setSelectionRange(next.caret, next.caret)
    afterComposeInput(target)
  }

  const onContainerKeyDown = (event: KeyboardEvent): void => {
    const target = composeTarget()
    if (!target) {
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (target.engine) {
        hideSuggestions()
        ctx.table().commitEdit()
        return
      }
      if (suggestItems.length > 0 && suggestIndex >= 0) {
        applySuggestion(suggestItems[suggestIndex]!.name)
        return
      }
      commit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (target.engine) {
        ctx.table().cancelEdit()
      } else {
        cancel()
      }
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return
    }
    if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      suggestItems.length > 0 &&
      !target.engine
    ) {
      event.preventDefault()
      suggestIndex =
        (suggestIndex + (event.key === 'ArrowDown' ? 1 : suggestItems.length - 1)) %
        suggestItems.length
      refreshSuggestActive()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const el = target.el
      const start = el.selectionStart ?? el.value.length
      const end = Math.max(start, el.selectionEnd ?? start)
      const caret =
        event.key === 'ArrowLeft'
          ? Math.max(0, start === end ? start - 1 : start)
          : Math.min(el.value.length, end + 1)
      el.setSelectionRange(caret, caret)
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Tab') {
      event.preventDefault()
      return
    }
    if (event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
      applyEdited(target, (value, start, end) =>
        end > start
          ? { text: value.slice(0, start) + value.slice(end), caret: start }
          : start > 0
            ? { text: value.slice(0, start - 1) + value.slice(start), caret: start - 1 }
            : null,
      )
      return
    }
    if (event.key.length === 1) {
      event.preventDefault()
      event.stopPropagation()
      applyEdited(target, (value, start, end) => ({
        text: value.slice(0, start) + event.key + value.slice(end),
        caret: start + 1,
      }))
    }
  }

  // 名称框聚焦即结束组合会话（跳转语义与公式编辑互斥；引擎会话进行中则不抢，编辑继续）
  nameBox.addEventListener('focus', () => {
    if (!suspended) {
      composing = null
      composeCell = null
      syncSelectionAnchor(null)
    }
  })

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
        applySuggestion(suggestItems[suggestIndex]!.name)
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
    // 输入出公式即进入组合会话（显式会话替代焦点探测）；公式文本被清空/改写为非公式即止
    const formula = input.value.trimStart().startsWith('=')
    if (composing === null && formula) {
      composing = 'bar'
      composeCell = focusCell()
      syncSelectionAnchor(composeCell)
    } else if (composing === 'bar' && !formula) {
      composing = null
      composeCell = null
      syncSelectionAnchor(null)
    }
    renderSuggestions()
    renderCalltip()
    refreshEditorChrome()
    syncRefHighlights()
  })
  // 光标移动（方向键/点击）不重算建议，但参数提示跟随逗号深度
  input.addEventListener('keyup', renderCalltip)
  input.addEventListener('click', renderCalltip)
  input.addEventListener('focus', () => {
    // 带公式文本聚焦进入组合会话（纯文本编辑不进会话：画布点选即改选，保持既有行为）；
    // 已在会话中则不重锚（拾取后回点输入区，锚定格仍是会话开始时的被编辑格）
    if (!suspended && composing === null && input.value.trimStart().startsWith('=')) {
      composing = 'bar'
      composeCell = focusCell()
      syncSelectionAnchor(composeCell)
    }
    refreshEditorChrome()
    renderCalltip()
    // 带着已有公式文本聚焦进入编辑态：补画染色框
    syncRefHighlights()
  })
  input.addEventListener('blur', () => {
    // 组合会话中失焦是「移焦画布拾取」的正常路径：不清会话不清拾取锚点；
    // 非会话失焦维持旧行为（拾取锚点复位）
    if (composing === null) {
      refPickStart = -1
    }
    // 失焦即退出公式栏编辑态：染色框立即清（不等下方 chrome 延时）
    syncRefHighlights()
    window.setTimeout(() => {
      refreshEditorChrome()
      hideCalltip()
    }, 120)
  })
  confirmButton.addEventListener('click', commit)
  cancelButton.addEventListener('click', cancel)

  // fx 按钮：下方弹函数面板（精简版：分类 + 列表；插入落点为本输入区）
  // 分类与数据来自 formulas 注册表：常用/全部 + 注册表分类
  const PANEL_CATEGORIES = ['常用', '全部', ...FORMULA_FUNCTION_CATEGORIES.slice(1)]
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
        let category: string = PANEL_CATEGORIES[0]!
        const render = (): void => {
          list.textContent = ''
          const items = listFormulaFunctions().filter(
            (info) => category === '全部' || info.category === category,
          )
          for (const info of items) {
            const item = document.createElement('button')
            item.type = 'button'
            item.className = 'sheet-functions__item'
            const signature = document.createElement('div')
            signature.className = 'sheet-functions__signature'
            signature.textContent = info.signature
            const description = document.createElement('div')
            description.className = 'sheet-functions__description'
            description.textContent = info.description
            item.append(signature, description)
            item.addEventListener('click', () => {
              insertSnippet(info.name)
              close()
            })
            list.appendChild(item)
          }
        }
        for (const name of PANEL_CATEGORIES) {
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

  const insertSnippet = (name: string): void => {
    input.value = `=${name}()`
    // 函数插入即进入组合会话（锚定当前焦点格）
    composing = 'bar'
    composeCell = focusCell()
    syncSelectionAnchor(composeCell)
    input.focus()
    // 光标落括号内（免手动补右括号，与建议确认一致）
    input.setSelectionRange(input.value.length - 1, input.value.length - 1)
    hideSuggestions()
    renderCalltip()
    refreshEditorChrome()
    syncRefHighlights()
  }

  // 引擎编辑会话镜像：开始时锁定显示、编辑器逐字镜像；结束后解锁刷新
  const onEditorInput = (): void => {
    if (mirroredEditor) {
      input.value = mirroredEditor.value
      renderSuggestions()
      renderCalltip()
      refreshEditorChrome()
      syncRefHighlights()
    }
  }

  // ---- 引用染色框：编辑公式时把引用单元格/区域在表格上画同色框（Excel 风格循环色板） ----
  // 绘制通道用 core 的 setHighlightRanges（sky 浮层，随滚动帧同内容源重绘）；
  // 引用提取用 formulas 的容错扫描器 scanFormulaReferences（半截公式不抛错）。
  const REF_HIGHLIGHT_COLORS = ['#2e75b6', '#c00000', '#548235', '#7030a0', '#bf8f00', '#0e9aa7']
  /** 引擎组合会话中被编辑格自身的持续高亮色（Excel 绿，区别于引用循环色板） */
  const EDITING_CELL_COLOR = '#107c41'

  /** 编辑中的文本：组合会话取编辑目标（引擎取镜像，公式栏取输入区），非会话公式栏聚焦取输入区；否则 null */
  const editingText = (): string | null => {
    if (composing === 'engine') {
      return mirroredEditor?.value ?? null
    }
    if (composing === 'bar') {
      return input.value
    }
    return document.activeElement === input ? input.value : null
  }

  /** 引用扫描结果同步为表格染色框；非公式态/非编辑态清空。同一引用去重，按出现序循环取色 */
  const syncRefHighlights = (): void => {
    const table = boundTable
    if (!table) {
      return
    }
    const text = editingText()?.trimStart()
    if (!text?.startsWith('=')) {
      table.setHighlightRanges([])
      return
    }
    const activeId = ctx.bundle.book.activeId
    const highlights: HighlightRange[] = []
    const seen = new Set<string>()
    for (const { ref } of scanFormulaReferences(text.slice(1))) {
      // 跨表引用只画活跃表的（其余表无对应画布；表名按 id/展示名大小写不敏感匹配）
      if (ref.sheet !== undefined) {
        const lower = ref.sheet.toLowerCase()
        const onActive =
          activeId !== null &&
          (activeId.toLowerCase() === lower || ctx.bundle.nameOf(activeId).toLowerCase() === lower)
        if (!onActive) {
          continue
        }
      }
      const bounds =
        'startCol' in ref
          ? { minCol: ref.startCol, minRow: ref.startRow, maxCol: ref.endCol, maxRow: ref.endRow }
          : { minCol: ref.col, minRow: ref.row, maxCol: ref.col, maxRow: ref.row }
      const key = `${bounds.minCol},${bounds.minRow}:${bounds.maxCol},${bounds.maxRow}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      highlights.push({
        bounds,
        color: REF_HIGHLIGHT_COLORS[highlights.length % REF_HIGHLIGHT_COLORS.length]!,
      })
    }
    // 引擎组合会话中被编辑格自身持续高亮（选区已随拾取流动到被拾取段，Excel 语义）
    if (composing === 'engine' && boundTable) {
      const editing = boundTable.editManager.editingCell()
      if (editing) {
        highlights.unshift({
          bounds: {
            minCol: editing.col,
            minRow: editing.row,
            maxCol: editing.col,
            maxRow: editing.row,
          },
          color: EDITING_CELL_COLOR,
        })
      }
    }
    table.setHighlightRanges(highlights)
  }

  /** 监听随活跃实例切换重挂（切 tab 后其余 sheet 的选区/编辑会话同样生效） */
  let boundTable: ListTable | null = null
  let bindings: Array<() => void> = []
  const bindTo = (table: ListTable): void => {
    if (table === boundTable) {
      return
    }
    // 切走前清掉旧表的引用染色框与选区锚点（池化实例复显时不能残留）；组合会话随切表结束
    boundTable?.setHighlightRanges([])
    boundTable?.setSelectionAnchor(null)
    if (composing !== null) {
      composing = null
      composeCell = null
      if (boundTable) {
        boundTable.editPickMode = false
      }
    }
    for (const off of bindings) {
      off()
    }
    boundContainer?.removeEventListener('keydown', onContainerKeyDown, true)
    boundContainer = null
    mirroredEditor?.removeEventListener('input', onEditorInput)
    mirroredEditor = null
    // 容器键入路由挂活跃实例容器（捕获阶段先于场景事件，组合会话中接管键入）
    const container = table.options.hostOptions?.container
    if (container) {
      container.addEventListener('keydown', onContainerKeyDown, true)
      boundContainer = container
    }
    bindings = [
      table.onSelectionChange(() => {
        const target = composeTarget()
        if (target && target.el.value.trimStart().startsWith('=')) {
          // 组合会话（公式态）：画布选区 → 编辑目标光标处插入引用（不提交）
          insertRefAtCursor()
          return
        }
        // 非公式态（含会话残留但文本已清空）：回落普通显示刷新
        refresh()
      }),
      table.onEditStart((edit) => {
        suspended = true
        const initial = edit.initialValue == null ? '' : String(edit.initialValue)
        // 公式格编辑进入引擎组合会话：开启引擎拾取（画布点选/拖选不提交，选区段即引用）；
        // 被编辑格设为选区锚点（拾取全程保持选区态，绿框与选区态并存）；非公式编辑清除残留锚点
        composing = initial.trimStart().startsWith('=') ? 'engine' : null
        table.editPickMode = composing === 'engine'
        table.setSelectionAnchor(composing === 'engine' ? { col: edit.col, row: edit.row } : null)
        nameBox.value = formatCellAddress(edit.col, edit.row)
        input.value = initial
        // 编辑器元素在表格容器内（demo 级镜像：监听其 input 事件）
        const editorEl = table.options.hostOptions?.container?.querySelector('textarea, input')
        if (editorEl instanceof HTMLTextAreaElement || editorEl instanceof HTMLInputElement) {
          mirroredEditor = editorEl
          editorEl.addEventListener('input', onEditorInput)
        }
        refreshEditorChrome()
        // 编辑已有公式格：开场即画出既有引用的染色框
        syncRefHighlights()
      }),
      table.onEditEnd(() => {
        mirroredEditor?.removeEventListener('input', onEditorInput)
        mirroredEditor = null
        suspended = false
        composing = null
        composeCell = null
        table.editPickMode = false
        table.setSelectionAnchor(null)
        refresh()
        // 引擎会话结束（提交/取消/滚出视口）：清染色框
        syncRefHighlights()
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
      boundContainer?.removeEventListener('keydown', onContainerKeyDown, true)
      boundContainer = null
      boundTable?.setHighlightRanges([])
      boundTable?.setSelectionAnchor(null)
      boundTable = null
      mirroredEditor?.removeEventListener('input', onEditorInput)
      hideSuggestions()
      hideCalltip()
      bar.remove()
    },
  }
}
