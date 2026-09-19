// 查找替换（工具栏弹层面板，对标 ultra-ui find-popup）：
// 查找内容 + 计数 + 上/下一个 + 关闭；替换为 + 替换/全部替换；
// 区分大小写 / 整格匹配 / 按显示值或公式查找。每次打开状态全新。

import type { ListTable } from '@infinite-table/core'

import type { SheetStore } from '@infinite-table/plugins'

import { icon } from './icons'
import { openAnchoredPopup, type PopupHandle } from './popup'

interface Hit {
  col: number
  row: number
  /** 命中格的原始值（替换用；显示值命中但非字符串原始值时为 null） */
  raw: unknown
}

export interface FindReplaceHandle {
  /** 查找下一个（冒烟 API：默认按显示值、忽略大小写、非整格） */
  findNext(keyword?: string): { col: number; row: number } | null
  /** 全表替换（冒烟 API：字符串原值替换，返回次数） */
  replaceAll(keyword?: string, replacement?: string): number
  /** 工具栏按钮 / Ctrl+F 切换面板 */
  toggleAt(anchor: HTMLElement): void
  close(): void
  destroy(): void
}

export function createFindReplace(ctx: {
  table: () => ListTable
  store: () => SheetStore
  notify: (text: string, kind?: 'info' | 'warn') => void
}): FindReplaceHandle {
  const state = {
    keyword: '',
    replacement: '',
    caseSensitive: false,
    wholeCell: false,
    mode: 'value' as 'value' | 'formula',
    hits: [] as Hit[],
    index: -1,
  }
  let keywordInput: HTMLInputElement | null = null
  let countLabel: HTMLElement | null = null

  /** 单格匹配文本：按显示值（getCellText 走求值管线）或按公式（原始串） */
  const cellText = (col: number, row: number): string => {
    const raw = ctx.store().getValue(col, row)
    if (state.mode === 'formula') {
      return typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
    }
    if (typeof raw === 'string' && raw.startsWith('=')) {
      // 显示值命中：替换语义保留原值标记（公式格替换写回字面文本）
      return ctx.table().getCellText(col, row)
    }
    return raw == null ? '' : String(raw)
  }

  const matches = (text: string, keyword: string): boolean => {
    if (!keyword) {
      return false
    }
    const hay = state.caseSensitive ? text : text.toLowerCase()
    const needle = state.caseSensitive ? keyword : keyword.toLowerCase()
    return state.wholeCell ? hay === needle : hay.includes(needle)
  }

  const scanAll = (keyword: string): Hit[] => {
    const store = ctx.store()
    const hits: Hit[] = []
    for (let row = 0; row < store.getRowCount(); row++) {
      for (let col = 0; col < store.getColCount(); col++) {
        if (matches(cellText(col, row), keyword)) {
          hits.push({ col, row, raw: store.getValue(col, row) })
        }
      }
    }
    return hits
  }

  const renderCount = (): void => {
    if (!countLabel) {
      return
    }
    if (!state.keyword) {
      countLabel.textContent = '0/0'
      return
    }
    const position = state.hits.length === 0 ? 0 : state.index + 1
    countLabel.textContent = `${position}/${state.hits.length}`
  }

  const rescan = (): void => {
    state.hits = state.keyword ? scanAll(state.keyword) : []
    // index 保持不动（-1 表示尚未定位；超出新命中数时收回末位）
    if (state.index >= state.hits.length) {
      state.index = state.hits.length - 1
    }
    renderCount()
  }

  const gotoHit = (hit: Hit): void => {
    ctx.table().selectCell(hit.col, hit.row)
    ctx.table().scrollToCell(hit)
  }

  const step = (delta: 1 | -1): void => {
    if (!state.keyword || state.hits.length === 0) {
      if (state.keyword) {
        ctx.notify(`未找到「${state.keyword}」`, 'warn')
      }
      return
    }
    state.index = (state.index + delta + state.hits.length) % state.hits.length
    gotoHit(state.hits[state.index]!)
    renderCount()
  }

  /** 面板 DOM 构建（每次打开重建，状态全新） */
  const buildPanel = (el: HTMLElement, close: () => void): void => {
    el.className = 'sheet-popup-layer sheet-find'
    const row1 = document.createElement('div')
    row1.className = 'sheet-find__row'
    keywordInput = document.createElement('input')
    keywordInput.type = 'text'
    keywordInput.className = 'sheet-find__input'
    keywordInput.placeholder = '查找内容'
    countLabel = document.createElement('span')
    countLabel.className = 'sheet-find__count'
    countLabel.textContent = '0/0'
    const prev = document.createElement('button')
    prev.type = 'button'
    prev.className = 'sheet-find__nav'
    prev.title = '上一个（Shift+Enter）'
    prev.innerHTML = icon('arrowLeft')
    const next = document.createElement('button')
    next.type = 'button'
    next.className = 'sheet-find__nav'
    next.title = '下一个（Enter）'
    next.innerHTML = icon('arrowRight')
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'sheet-find__close'
    closeBtn.title = '关闭'
    closeBtn.innerHTML = icon('close')
    row1.append(keywordInput, countLabel, prev, next, closeBtn)

    const row2 = document.createElement('div')
    row2.className = 'sheet-find__row'
    const replaceInput = document.createElement('input')
    replaceInput.type = 'text'
    replaceInput.className = 'sheet-find__input'
    replaceInput.placeholder = '替换为'
    const replaceOne = document.createElement('button')
    replaceOne.type = 'button'
    replaceOne.className = 'sheet-find__action'
    replaceOne.textContent = '替换'
    const replaceAllBtn = document.createElement('button')
    replaceAllBtn.type = 'button'
    replaceAllBtn.className = 'sheet-find__action'
    replaceAllBtn.textContent = '全部替换'
    row2.append(replaceInput, replaceOne, replaceAllBtn)

    const row3 = document.createElement('div')
    row3.className = 'sheet-find__row'
    const caseBox = document.createElement('label')
    caseBox.className = 'sheet-find__check'
    const caseInput = document.createElement('input')
    caseInput.type = 'checkbox'
    caseBox.append(caseInput, document.createTextNode('区分大小写'))
    const wholeBox = document.createElement('label')
    wholeBox.className = 'sheet-find__check'
    const wholeInput = document.createElement('input')
    wholeInput.type = 'checkbox'
    wholeBox.append(wholeInput, document.createTextNode('整格匹配'))
    const modeSelect = document.createElement('select')
    modeSelect.className = 'sheet-find__select'
    for (const [value, label] of [
      ['value', '按显示值'],
      ['formula', '按公式'],
    ] as const) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      modeSelect.appendChild(option)
    }
    row3.append(caseBox, wholeBox, modeSelect)
    el.append(row1, row2, row3)

    const syncState = (): void => {
      state.keyword = keywordInput?.value ?? ''
      state.replacement = replaceInput.value
      state.caseSensitive = caseInput.checked
      state.wholeCell = wholeInput.checked
      state.mode = modeSelect.value === 'formula' ? 'formula' : 'value'
      state.index = -1
      rescan()
    }
    keywordInput.addEventListener('input', syncState)
    replaceInput.addEventListener('input', () => {
      state.replacement = replaceInput.value
    })
    caseInput.addEventListener('change', syncState)
    wholeInput.addEventListener('change', syncState)
    modeSelect.addEventListener('change', syncState)
    keywordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        step(event.shiftKey ? -1 : 1)
      }
    })
    prev.addEventListener('click', () => step(-1))
    next.addEventListener('click', () => step(1))
    closeBtn.addEventListener('click', close)

    replaceOne.addEventListener('click', () => {
      if (state.index < 0 || !state.hits[state.index]) {
        step(1)
        return
      }
      const hit = state.hits[state.index]!
      if (typeof hit.raw !== 'string' || hit.raw === '') {
        ctx.notify('该格非文本值，跳过替换', 'warn')
        step(1)
        return
      }
      ctx
        .store()
        .setValue(hit.col, hit.row, applyReplace(hit.raw, state.keyword, state.replacement))
      ctx.table().refreshCell(hit.col, hit.row)
      rescan()
      step(1)
    })
    replaceAllBtn.addEventListener('click', () => {
      const count = replaceAll(state.keyword, state.replacement)
      ctx.notify(count > 0 ? `已替换 ${count} 处` : '无匹配内容', count > 0 ? 'info' : 'warn')
      rescan()
    })
  }

  function applyReplace(raw: string, keyword: string, replacement: string): string {
    if (!keyword) {
      return raw
    }
    if (state.caseSensitive) {
      return raw.split(keyword).join(replacement)
    }
    // 忽略大小写替换：按降序定位避免偏移漂移
    const lower = raw.toLowerCase()
    const needle = keyword.toLowerCase()
    let result = ''
    let index = 0
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, index)) {
      result += raw.slice(index, at) + replacement
      index = at + needle.length
    }
    return result + raw.slice(index)
  }

  // ---- 编程式 API（冒烟驱动） ----

  const findNext = (keyword?: string): { col: number; row: number } | null => {
    if (keyword != null && keyword !== state.keyword) {
      state.keyword = keyword
      state.index = -1
      rescan()
    }
    if (!state.keyword || state.hits.length === 0) {
      return null
    }
    step(1)
    const hit = state.hits[state.index]!
    return { col: hit.col, row: hit.row }
  }

  const replaceAll = (keyword?: string, replacement?: string): number => {
    const kw = keyword ?? state.keyword
    if (!kw) {
      return 0
    }
    const store = ctx.store()
    const targets: Hit[] = []
    for (let row = 0; row < store.getRowCount(); row++) {
      for (let col = 0; col < store.getColCount(); col++) {
        const raw = store.getValue(col, row)
        if (typeof raw === 'string' && matches(raw, kw)) {
          targets.push({ col, row, raw })
        }
      }
    }
    ctx.table().batchUpdate(() => {
      for (const hit of targets) {
        store.setValue(
          hit.col,
          hit.row,
          applyReplace(hit.raw as string, kw, replacement ?? state.replacement),
        )
        ctx.table().refreshCell(hit.col, hit.row)
      }
    })
    if (popupHandle != null) {
      rescan()
    }
    return targets.length
  }

  let popupHandle: PopupHandle | null = null
  const toggleAt = (anchor: HTMLElement): void => {
    if (popupHandle != null) {
      popupHandle.close()
      return
    }
    // 每次打开状态全新（ultra-ui 语义）
    Object.assign(state, {
      keyword: '',
      replacement: '',
      caseSensitive: false,
      wholeCell: false,
      mode: 'value',
      hits: [],
      index: -1,
    })
    popupHandle = openAnchoredPopup(anchor, {
      build: buildPanel,
      onOpened: () => keywordInput?.focus(),
      onClosed: () => {
        popupHandle = null
        keywordInput = null
        countLabel = null
      },
    })
  }

  return {
    findNext,
    replaceAll,
    toggleAt,
    close: () => popupHandle?.close(),
    destroy: () => popupHandle?.close(),
  }
}
