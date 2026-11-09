// 模板绑定清单（模板级区块）：扫描快照 meta 里的绑定与函数 sidecar，列出整个模板的全部已设置格。
// 点一条即选区跳到该格（选区变化会让绑定面板与画布高亮自动跟随），相当于一张「绑定总账」。
// 挂在配置面板的「绑定」tab——绑定相对模板而言，不属于某个单元格的配置。
import { useMemo } from 'react'

import { formatAddress, type CellAddress } from '@infinitable/sheet'

import type { FormDoc } from './form-doc'
import {
  FORM_BINDING_META_NAMESPACE,
  FORM_FUNCTION_META_NAMESPACE,
  formatBindingPlaceholder,
  formatFunctionPlaceholder,
  type FormCellBinding,
  type FormCellFunction,
} from './template'

interface Props {
  doc: FormDoc
  /** 绑定写改后触发重算（撤销链与绑定命令都会换快照） */
  revision: number
}

/** 超过这个条数就限高滚动，避免把侧栏撑长 */
const MAX_VISIBLE = 6

export function BoundList({ doc, revision }: Props) {
  const items = useMemo(() => {
    const meta = doc.sheet.snapshot().meta ?? []
    return meta
      .flatMap((item): { addr: CellAddress; label: string }[] => {
        const addr = { row: item.row, col: item.col } as CellAddress
        if (item.namespace === FORM_BINDING_META_NAMESPACE) {
          const binding = item.payload as FormCellBinding
          return typeof binding?.path === 'string'
            ? [{ addr, label: formatBindingPlaceholder(binding) }]
            : []
        }
        if (item.namespace === FORM_FUNCTION_META_NAMESPACE) {
          const fn = item.payload as FormCellFunction
          // 文档内载荷已规范化（加载/写入都过 normalizeCellFunction），这里只挡意外脏数据
          return fn !== null && typeof fn === 'object' && typeof fn.kind === 'string'
            ? [{ addr, label: formatFunctionPlaceholder(fn) }]
            : []
        }
        return []
      })
      .sort((a, b) => a.addr.row - b.addr.row || a.addr.col - b.addr.col)
    // revision 变化即重算：快照读取不做增量缓存
  }, [doc, revision])

  return (
    <div className="bound-list">
      <div className="bound-list-head">
        <span className="field-label">模板绑定</span>
        <span className="meta">{items.length} 处 · 全模板</span>
      </div>
      {items.length === 0 ? (
        <p className="bound-empty">整个模板暂无绑定：选中单元格后绑定字段或配置函数。</p>
      ) : (
        <ul className={items.length > MAX_VISIBLE ? 'bound-items scroll' : 'bound-items'}>
          {items.map(({ addr, label }) => (
            <li key={`${addr.row}:${addr.col}`}>
              <button
                type="button"
                className="bound-item"
                title="点击定位到该单元格"
                onClick={() => doc.sheet.selectCell(addr)}
              >
                <span className="addr-badge">{formatAddress(addr)}</span>
                <span className="bound-path mono">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
