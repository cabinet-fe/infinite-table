// 公式栏：地址框（A1）+ fx 函数库入口 + 内容编辑框。
// 同步守卫：只在「活动格变了」或「该格内容变了」时覆盖输入框，用户正在输入时不被外部刷新打断。
// 提交口径：Enter 才写模型（空串 = 清格），失焦不提交、只把草稿还原成当前格内容，避免误写。
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { formatAddress, type CellAddress } from '@infinitable/sheet'

import type { FormDoc } from '../domain/form-doc'
import { IconFunction } from '../ui/icons'

export interface FormulaBarHandle {
  /** 在当前光标位置插入文本（函数库「插入」用），并把光标放到括号内 */
  insertAtCursor: (text: string) => void
  focus: () => void
}

interface Props {
  doc: FormDoc
  /** 当前活动格（无选区为 null） */
  activeCell: CellAddress | null
  /** 活动格已写绑定（打印时会被绑定值替换；不禁止编辑，只给提示） */
  bound: boolean
  onOpenFunctionLibrary: () => void
  /** 内容写入后通知外层刷新（撤销态/选区样式等） */
  onChanged: () => void
}

/** 公式错误值形如 '#VALUE!' / '#NAME?' / '#CYCLE!'（以 # 开头、以 ! 结尾） */
function isErrorText(text: string): boolean {
  return /^#[A-Za-z0-9_/?]+!$/.test(text)
}

/** 活动格 → 公式栏显示文本（公式显示 '=' + 原文，否则显示存储值） */
function cellText(doc: FormDoc, addr: CellAddress): string {
  const data = doc.sheet.getCellData(addr)
  if (!data) return ''
  if (data.f) return `=${data.f}`
  if (data.v === undefined || data.v === null) return ''
  return String(data.v)
}

export const FormulaBar = forwardRef<FormulaBarHandle, Props>(function FormulaBar(
  { doc, activeCell, bound, onOpenFunctionLibrary, onChanged },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  // 活动格求值结果是否错误值（取自模型缓存值，不是草稿文本）
  const [cellError, setCellError] = useState(false)
  // 同步守卫：记录草稿对应的「格 + 该格内容」，两者都没变时不覆盖用户输入
  const syncedRef = useRef<{ addr: string; value: string } | null>(null)

  const addrKey = activeCell ? formatAddress(activeCell) : ''

  // 外部内容变化（切换格、撤销/重做、画布键入）时同步草稿；正在输入的格内容未变则不动
  useEffect(() => {
    if (!activeCell) {
      setDraft('')
      setCellError(false)
      syncedRef.current = null
      return
    }
    const value = cellText(doc, activeCell)
    const cached = doc.sheet.getCellData(activeCell)?.v
    setCellError(typeof cached === 'string' && isErrorText(cached))
    const synced = syncedRef.current
    if (synced && synced.addr === addrKey && synced.value === value) return
    syncedRef.current = { addr: addrKey, value }
    setDraft(value)
  }, [doc, activeCell, addrKey])

  // 选区变化/内容变化（键入、撤销）后也要重新同步——用 sheet 事件而非轮询
  useEffect(() => {
    const off = doc.sheet.on('cell-change', () => {
      const addr = doc.sheet.getSelection().activeCell
      if (!addr) return
      const value = cellText(doc, addr)
      const cached = doc.sheet.getCellData(addr)?.v
      setCellError(typeof cached === 'string' && isErrorText(cached))
      const synced = syncedRef.current
      if (synced && synced.addr === formatAddress(addr) && synced.value === value) return
      syncedRef.current = { addr: formatAddress(addr), value }
      setDraft(value)
    })
    return off
  }, [doc])

  useImperativeHandle(ref, () => ({
    insertAtCursor(text) {
      const input = inputRef.current
      if (!input) {
        setDraft((prev) => prev + text)
        return
      }
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? start
      // 函数插入后光标落在括号内（文本末尾是 ')' 时前移一位）
      const next = input.value.slice(0, start) + text + input.value.slice(end)
      const caret = start + (text.endsWith('()') ? text.length - 1 : text.length)
      setDraft(next)
      // 等 React 提交 value 后再设光标
      requestAnimationFrame(() => {
        input.focus()
        input.setSelectionRange(caret, caret)
      })
    },
    focus() {
      inputRef.current?.focus()
    },
  }))

  const restore = (): void => {
    setDraft(activeCell ? cellText(doc, activeCell) : '')
  }

  const commit = (): void => {
    if (!activeCell) return
    const value = draft.trim() === '' ? '' : draft
    doc.sheet.setCellValue(activeCell, value)
    // 写入后模型可能规范化输入（数字文本 → number、'=...' → 公式）
    const next = cellText(doc, activeCell)
    const cached = doc.sheet.getCellData(activeCell)?.v
    setCellError(typeof cached === 'string' && isErrorText(cached))
    syncedRef.current = { addr: addrKey, value: next }
    setDraft(next)
    onChanged()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      restore()
      inputRef.current?.blur()
    }
  }

  return (
    <div className="formula-bar">
      <span className="formula-addr" title="当前单元格地址">
        {activeCell ? formatAddress(activeCell) : '—'}
      </span>
      {bound ? (
        <span
          className="formula-bound"
          title="这一格已绑定数据字段：打印时会用绑定值替换，画布上看到的是占位符"
        >
          已绑定
        </span>
      ) : null}
      <button
        type="button"
        className="formula-fx"
        title="打开函数库（浏览全部函数并插入）"
        onClick={onOpenFunctionLibrary}
      >
        <IconFunction />
      </button>
      <input
        ref={inputRef}
        className={cellError ? 'formula-input error' : 'formula-input'}
        value={draft}
        disabled={!activeCell}
        placeholder={
          activeCell
            ? '输入内容或公式，如 =SUM(B2:B5)、=ROUND(A1,2)，回车应用'
            : '先在画布上选择一个单元格'
        }
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={restore}
        aria-label="单元格内容"
      />
    </div>
  )
})
