// 查找替换逻辑（查找面板 UI 由 React 层承担）：
// 查找内容 + 计数 + 上/下一个；替换为 + 替换/全部替换；
// 区分大小写 / 整格匹配 / 按显示值或公式查找。每次打开状态全新。
// 查找/扫描/替换写值（经 sheet.writeValues 落撤销栈）的口径不变，供面板与冒烟 API 共用。

import type { ListTable } from '@infinitable/core'

import type { SheetPluginHandle } from '@infinitable/plugins'

import type { SheetStore } from './book'

interface Hit {
  col: number
  row: number
  /** 命中格的原始值（替换用；显示值命中但非字符串原始值时为 null） */
  raw: unknown
}

/** 面板查询条件（React 面板控件变更时经 setQuery 同步进逻辑态） */
export interface FindQuery {
  keyword: string
  replacement: string
  caseSensitive: boolean
  wholeCell: boolean
  mode: 'value' | 'formula'
}

export interface FindReplaceController {
  /** 查找下一个（冒烟 API：默认按显示值、忽略大小写、非整格） */
  findNext(keyword?: string): { col: number; row: number } | null
  /** 全表替换（冒烟 API：字符串原值替换，返回次数） */
  replaceAll(keyword?: string, replacement?: string): number
  /** 面板控件 → 逻辑态（每次变更重扫，定位复位） */
  setQuery(query: FindQuery): void
  /** 仅更新替换词（不影响命中定位，避免输入替换词时丢失当前命中） */
  setReplacement(replacement: string): void
  /** 上一个 / 下一个（面板按钮与回车驱动） */
  stepBy(delta: 1 | -1): void
  /** 替换当前命中格（非文本值跳过并前进） */
  replaceOne(): void
  /** 计数标签：`当前位置/命中总数` */
  countLabel(): string
  /** 每次打开状态全新（ultra-ui 语义） */
  reset(): void
}

export function createFindReplace(ctx: {
  table: () => ListTable
  store: () => SheetStore
  /** sheet 插件 handle：替换写值经 writeValues 落撤销栈（值命令口径） */
  sheet: SheetPluginHandle
  notify: (text: string, kind?: 'info' | 'warn') => void
  /** 计数/定位变化回调（面板重渲染用） */
  onUpdate?: () => void
}): FindReplaceController {
  const state = {
    keyword: '',
    replacement: '',
    caseSensitive: false,
    wholeCell: false,
    mode: 'value' as 'value' | 'formula',
    hits: [] as Hit[],
    index: -1,
  }

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

  const rescan = (): void => {
    state.hits = state.keyword ? scanAll(state.keyword) : []
    // index 保持不动（-1 表示尚未定位；超出新命中数时收回末位）
    if (state.index >= state.hits.length) {
      state.index = state.hits.length - 1
    }
    ctx.onUpdate?.()
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
    ctx.onUpdate?.()
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

  const replaceOne = (): void => {
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
    ctx.sheet.writeValues(ctx.store(), [
      {
        col: hit.col,
        row: hit.row,
        value: applyReplace(hit.raw, state.keyword, state.replacement),
      },
    ])
    ctx.table().refreshCell(hit.col, hit.row)
    rescan()
    step(1)
  }

  // ---- 编程式 API（冒烟驱动 / 面板共用） ----

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
      ctx.sheet.writeValues(
        store,
        targets.map((hit) => ({
          col: hit.col,
          row: hit.row,
          value: applyReplace(hit.raw as string, kw, replacement ?? state.replacement),
        })),
      )
      for (const hit of targets) {
        ctx.table().refreshCell(hit.col, hit.row)
      }
    })
    rescan()
    return targets.length
  }

  return {
    findNext,
    replaceAll,
    setQuery(query) {
      state.keyword = query.keyword
      state.replacement = query.replacement
      state.caseSensitive = query.caseSensitive
      state.wholeCell = query.wholeCell
      state.mode = query.mode
      state.index = -1
      rescan()
    },
    setReplacement(replacement) {
      state.replacement = replacement
    },
    stepBy: step,
    replaceOne,
    countLabel() {
      if (!state.keyword) {
        return '0/0'
      }
      const position = state.hits.length === 0 ? 0 : state.index + 1
      return `${position}/${state.hits.length}`
    },
    reset() {
      Object.assign(state, {
        keyword: '',
        replacement: '',
        caseSensitive: false,
        wholeCell: false,
        mode: 'value',
        hits: [],
        index: -1,
      })
      ctx.onUpdate?.()
    },
  }
}
