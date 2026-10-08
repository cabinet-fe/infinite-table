// 公式栏（对标 ultra-ui formula-bar）：名称框（A1/B3:D5，可输入跳转）+ fx（函数面板 Popover）
// + 输入区（Enter 提交 / Esc 取消）+ 编辑态 ✓/✗ + 函数建议列表 + 参数提示 calltip。
// 会话接线（选区同步/引用拾取/染色框）见 formula-session.ts；此处只承担 React 渲染与视图回调。

import { Check, X } from 'lucide-react'
import { flushSync } from 'react-dom'
import { useEffect, useRef, useState } from 'react'

import { listFormulaFunctions, type FormulaFunctionInfo } from '@infinitable/formulas'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { SheetDemo } from '../../../sections/sheet'
import {
  FORMULA_PANEL_CATEGORIES,
  attachFormulaSession,
  type CalltipModel,
  type FormulaSessionHandle,
} from './formula-session'
import type { SheetUiBridge } from './ui-bridge'

interface FormulaBarProps {
  demo: SheetDemo
  ui: SheetUiBridge
}

export function FormulaBar({ demo, ui }: FormulaBarProps) {
  const nameBoxRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestListRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<FormulaSessionHandle | null>(null)
  const [editing, setEditing] = useState(false)
  const [suggest, setSuggest] = useState<{ items: FormulaFunctionInfo[]; index: number } | null>(
    null,
  )
  const [calltip, setCalltip] = useState<CalltipModel | null>(null)
  const [fxOpen, setFxOpen] = useState(false)

  useEffect(() => {
    const nameBox = nameBoxRef.current
    const input = inputRef.current
    if (!nameBox || !input) {
      return
    }
    let editingValue = false
    let suggestShown = false
    let calltipShown = false
    const session = attachFormulaSession(
      { nameBox, input },
      {
        table: () => demo.table,
        store: () => demo.getStore(),
        notify: demo.notify,
        bundle: demo.getBundle(),
      },
      {
        setEditing(value) {
          if (editingValue !== value) {
            editingValue = value
            setEditing(value)
          }
        },
        showSuggest(items) {
          suggestShown = true
          // flushSync：原生 input 事件的监听里同步上屏（自动化在派发事件后立即断言 DOM）
          flushSync(() => setSuggest({ items, index: 0 }))
        },
        moveSuggest(index) {
          flushSync(() => setSuggest((current) => (current ? { ...current, index } : current)))
        },
        hideSuggest() {
          if (suggestShown) {
            suggestShown = false
            flushSync(() => setSuggest(null))
          }
        },
        showCalltip(model) {
          calltipShown = true
          flushSync(() => setCalltip(model))
        },
        hideCalltip() {
          if (calltipShown) {
            calltipShown = false
            flushSync(() => setCalltip(null))
          }
        },
      },
    )
    sessionRef.current = session
    ui.refreshFormula = () => session.refresh()
    ui.insertFormulaSnippet = (name) => session.insertSnippet(name)
    return () => {
      session.destroy()
      sessionRef.current = null
      ui.refreshFormula = () => {}
      ui.insertFormulaSnippet = () => {}
    }
  }, [demo, ui])

  // 建议列表激活项滚入视野（键盘导航跟随）
  useEffect(() => {
    suggestListRef.current?.children[suggest?.index ?? -1]?.scrollIntoView({ block: 'nearest' })
  }, [suggest?.index])

  const insertAndClose = (name: string): void => {
    setFxOpen(false)
    sessionRef.current?.insertSnippet(name)
  }

  return (
    <div className="relative z-30 border-b border-border/70 px-1.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          ref={nameBoxRef}
          aria-label="单元格地址"
          className="sheet-name-box h-6 w-[110px] shrink-0 rounded-md px-1.5 text-center text-xs font-medium"
          title="单元格地址或区域（如 B3 或 B3:D5），回车跳转"
          type="text"
        />
        <Popover onOpenChange={setFxOpen} open={fxOpen}>
          <PopoverTrigger asChild>
            <Button
              aria-label="插入函数"
              className="h-6 shrink-0 px-1.5 font-serif text-xs italic"
              title="插入函数"
              variant="ghost"
            >
              fx
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <FunctionPanel onInsert={insertAndClose} />
          </PopoverContent>
        </Popover>
        <div className="relative min-w-0 flex-1">
          <Input
            ref={inputRef}
            aria-label="公式输入"
            className="sheet-fx-input h-6 rounded-md px-1.5 font-mono text-xs"
            title="活动单元格内容（'=' 开头为公式）；Enter 提交，Esc 取消"
            type="text"
          />
          {calltip && (
            <div className="sheet-fx-calltip absolute top-full left-0 z-20 mt-0.5 rounded-md border bg-popover px-2 py-1 font-mono text-xs whitespace-nowrap text-muted-foreground shadow-sm">
              {calltip.name}(
              {calltip.params.map((param, index) => (
                <span key={`${param.text}-${index}`}>
                  {index > 0 && ', '}
                  <span
                    className={cn(
                      'sheet-fx-calltip__param',
                      param.active && 'is-active font-bold text-primary',
                    )}
                  >
                    {param.text}
                  </span>
                </span>
              ))}
              )
            </div>
          )}
          {suggest && (
            <div className="sheet-fx-suggest absolute top-full left-0 z-20 mt-0.5 max-h-60 w-[300px] overflow-auto rounded-md border bg-popover py-1 shadow-md">
              <div ref={suggestListRef}>
                {suggest.items.map((info, index) => (
                  <button
                    key={info.name}
                    className={cn(
                      'sheet-fx-suggest__item block w-full cursor-pointer px-2.5 py-1.5 text-left',
                      index === suggest.index && 'bg-accent',
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      sessionRef.current?.applySuggestion(info.name)
                    }}
                    type="button"
                  >
                    <div className="sheet-fx-suggest__signature font-mono text-xs text-foreground">
                      {info.signature}
                    </div>
                    <div className="sheet-fx-suggest__description text-xs text-muted-foreground">
                      {info.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <Button
          aria-label="提交（Enter）"
          className={cn('size-5.5 shrink-0', !editing && 'pointer-events-none opacity-0')}
          onClick={() => sessionRef.current?.commit()}
          size="icon-xs"
          title="提交（Enter）"
          variant="outline"
        >
          <Check className="size-3" />
        </Button>
        <Button
          aria-label="取消（Esc）"
          className={cn('size-5.5 shrink-0', !editing && 'pointer-events-none opacity-0')}
          onClick={() => sessionRef.current?.cancel()}
          size="icon-xs"
          title="取消（Esc）"
          variant="outline"
        >
          <X className="size-3" />
        </Button>
      </div>
    </div>
  )
}

/** fx 函数面板：分类 + 列表（签名为注册表元数据单一来源），插入落点为公式栏输入区 */
function FunctionPanel({ onInsert }: { onInsert: (name: string) => void }) {
  const [category, setCategory] = useState(FORMULA_PANEL_CATEGORIES[0]!)
  const items = listByCategory(category)
  return (
    <div className="flex">
      <nav className="w-20 shrink-0 border-r p-1">
        {FORMULA_PANEL_CATEGORIES.map((name) => (
          <button
            className={cn(
              'block w-full cursor-pointer rounded-sm px-2 py-1 text-left text-xs',
              name === category ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
            )}
            key={name}
            onClick={() => setCategory(name)}
            type="button"
          >
            {name}
          </button>
        ))}
      </nav>
      <div className="max-h-64 min-w-0 flex-1 overflow-auto p-1">
        {items.map((info) => (
          <button
            className="block w-full cursor-pointer rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
            key={info.name}
            onClick={() => onInsert(info.name)}
            type="button"
          >
            <div className="font-mono text-xs text-foreground">{info.signature}</div>
            <div className="text-xs text-muted-foreground">{info.description}</div>
          </button>
        ))}
        {items.length === 0 && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">该分类暂无函数</div>
        )}
      </div>
    </div>
  )
}

function listByCategory(category: string): FormulaFunctionInfo[] {
  return listFormulaFunctions().filter((info) => category === '全部' || info.category === category)
}
