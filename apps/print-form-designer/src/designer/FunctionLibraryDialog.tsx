// 函数库弹框：浏览 @infinitable/formulas 的 49 个内置函数（分类 / 搜索 / 详情 / 插入）。
// 分类与签名全部来自 listFormulaFunctions 元数据，不在此维护第二份清单。
import { useEffect, useMemo, useState } from 'react'

import {
  FORMULA_FUNCTION_CATEGORIES,
  listFormulaFunctions,
  type FormulaFunctionInfo,
} from '@infinitable/formulas'

import { IconClose, IconFunction } from '../ui/icons'

interface Props {
  onClose: () => void
  /** 插入函数调用模板到公式栏光标处（文本形如 'SUM()'） */
  onInsert: (text: string) => void
}

const ALL = '全部'

export function FunctionLibraryDialog({ onClose, onInsert }: Props) {
  const functions = useMemo(() => listFormulaFunctions(), [])
  const [category, setCategory] = useState<string>(ALL)
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState<string>(functions[0]?.name ?? '')

  // 分类清单：固定分类顺序 + 只保留有函数的分类（含计数）
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const fn of functions) {
      const key = fn.category ?? ALL
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const ordered = FORMULA_FUNCTION_CATEGORIES.filter((name) => counts.has(name)).map((name) => ({
      name,
      count: counts.get(name)!,
    }))
    return [{ name: ALL, count: functions.length }, ...ordered]
  }, [functions])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return functions.filter((fn) => {
      if (category !== ALL && fn.category !== category) return false
      if (q === '') return true
      return fn.name.toLowerCase().includes(q) || fn.description.toLowerCase().includes(q)
    })
  }, [functions, category, query])

  // 过滤后选中项可能不在列表里：回落到首项（详情区始终有内容）
  const selected: FormulaFunctionInfo | undefined =
    visible.find((fn) => fn.name === selectedName) ?? visible[0]

  // ESC 关闭
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const insert = (fn: FormulaFunctionInfo): void => {
    // 有必填参数才带括号；无参函数（TODAY/NOW/RAND）直接给完整调用形态
    onInsert(`${fn.name}()`)
    onClose()
  }

  return (
    <div className="fn-overlay" onClick={onClose}>
      <div
        className="fn-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="函数库"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="fn-bar">
          <h2>
            <IconFunction />
            函数库
          </h2>
          <span className="meta">{functions.length} 个函数</span>
          <input
            className="fn-search"
            value={query}
            placeholder="搜索函数名或说明，如 大写 / 求和 / VLOOKUP"
            aria-label="搜索函数"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="fn-close" onClick={onClose} title="关闭函数库（Esc）">
            <IconClose />
            关闭
          </button>
        </div>

        <div className="fn-body">
          <nav className="fn-categories" aria-label="函数分类">
            {categories.map((item) => (
              <button
                key={item.name}
                type="button"
                className={item.name === category ? 'fn-category active' : 'fn-category'}
                aria-pressed={item.name === category}
                onClick={() => setCategory(item.name)}
              >
                <span>{item.name}</span>
                <span className="fn-count">{item.count}</span>
              </button>
            ))}
          </nav>

          <ul className="fn-list" aria-label="函数列表">
            {visible.length === 0 ? (
              <li className="fn-empty">没有匹配的函数，换个关键词试试</li>
            ) : null}
            {visible.map((fn) => (
              <li key={fn.name}>
                <button
                  type="button"
                  className={fn.name === selected?.name ? 'fn-item active' : 'fn-item'}
                  onClick={() => setSelectedName(fn.name)}
                  onDoubleClick={() => insert(fn)}
                  title="双击插入到公式栏"
                >
                  <span className="fn-sig">{fn.signature}</span>
                  <span className="fn-desc">{fn.description}</span>
                  {fn.volatile ? (
                    <span className="fn-badge" title="易失函数：任意单元格变化都会重新计算">
                      易失
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          <aside className="fn-detail" aria-label="函数详情">
            {selected ? (
              <>
                <h3>{selected.name}</h3>
                <p className="fn-detail-sig">{selected.signature}</p>
                <p className="fn-detail-desc">{selected.description}</p>
                <div className="fn-params">
                  <span className="fn-params-label">参数</span>
                  {selected.params.length === 0 ? (
                    <span className="meta">无参数</span>
                  ) : (
                    selected.params.map((param) => (
                      <span
                        key={param.name}
                        className={param.optional ? 'fn-param optional' : 'fn-param'}
                      >
                        {param.name}
                        {param.optional ? '（可选）' : ''}
                      </span>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className="primary fn-insert"
                  onClick={() => insert(selected)}
                  title="把函数插入到公式栏的光标位置"
                >
                  插入到公式栏
                </button>
              </>
            ) : (
              <p className="hint">选择一个函数查看详情</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
