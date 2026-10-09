// 查找替换逻辑（查找面板 UI 由 React 层承担）：扫描/定位收敛到 @infinitable/sheet 的
// findAll / findNextFrom / findPrevFrom（行主序、到边界循环），替换写值经 sheet.setCells
// 落撤销栈（值命令口径）。每次打开状态全新。

import type { ListTable } from '@infinitable/core'

import { findAll, type FindMatch, type FindOptions, type Sheet } from '@infinitable/sheet'

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

/** 忽略大小写替换：按降序定位避免偏移漂移 */
function applyReplace(
  raw: string,
  keyword: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  if (!keyword) {
    return raw
  }
  if (caseSensitive) {
    return raw.split(keyword).join(replacement)
  }
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

export function createFindReplace(ctx: {
  table: () => ListTable
  sheet: () => Sheet
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
    hits: [] as FindMatch[],
    index: -1,
  }

  const options = (): FindOptions => ({
    caseSensitive: state.caseSensitive,
    wholeCell: state.wholeCell,
    searchIn: state.mode,
  })

  const rescan = (): void => {
    state.hits = state.keyword ? findAll(ctx.sheet(), state.keyword, options()) : []
    // index 保持不动（-1 表示尚未定位；超出新命中数时收回末位）
    if (state.index >= state.hits.length) {
      state.index = state.hits.length - 1
    }
    ctx.onUpdate?.()
  }

  const gotoHit = (hit: FindMatch): void => {
    // 模型选区驱动（grid 选区控制器推画布 + 不可见滚动）
    ctx.sheet().selectCell(hit.addr)
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

  const replaceOne = (): void => {
    if (state.index < 0 || !state.hits[state.index]) {
      step(1)
      return
    }
    const hit = state.hits[state.index]!
    const sheet = ctx.sheet()
    const raw = sheet.getCellData(hit.addr)?.v
    if (typeof raw !== 'string' || raw === '') {
      ctx.notify('该格非文本值，跳过替换', 'warn')
      step(1)
      return
    }
    sheet.setCells([
      {
        addr: hit.addr,
        data: { v: applyReplace(raw, state.keyword, state.replacement, state.caseSensitive) },
      },
    ])
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
    return { col: hit.addr.col, row: hit.addr.row }
  }

  const replaceAll = (keyword?: string, replacement?: string): number => {
    const kw = keyword ?? state.keyword
    if (!kw) {
      return 0
    }
    const sheet = ctx.sheet()
    // 替换口径与旧实现一致：按原始字符串值整格包含匹配（非显示值/公式面）
    const lower = state.caseSensitive ? null : kw.toLowerCase()
    const matches = (text: string): boolean => {
      const hay = lower ? text.toLowerCase() : text
      return state.wholeCell ? hay === (lower ?? kw) : hay.includes(lower ?? kw)
    }
    const items: Array<{ addr: { row: number; col: number }; data: { v: string } }> = []
    for (const [addr, data] of sheet.store.entries()) {
      if (typeof data.v !== 'string' || data.v === '') {
        continue
      }
      if (matches(data.v)) {
        items.push({
          addr,
          data: {
            v: applyReplace(data.v, kw, replacement ?? state.replacement, state.caseSensitive),
          },
        })
      }
    }
    if (items.length > 0) {
      sheet.setCells(items)
    }
    rescan()
    return items.length
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
