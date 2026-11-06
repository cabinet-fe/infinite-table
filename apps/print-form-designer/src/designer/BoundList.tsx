// 已绑定字段清单：扫描快照 meta 里本应用的绑定 sidecar，列出全部已绑定格。
// 点一条即选区跳到该格（选区变化会让绑定面板与画布高亮自动跟随），相当于一张「绑定总账」。
import { useMemo } from 'react'

import { formatAddress, type CellAddress } from '@infinitable/sheet'

import type { FormDoc } from './form-doc'
import {
  FORM_BINDING_META_NAMESPACE,
  formatBindingPlaceholder,
  type FormCellBinding,
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
      .filter((item) => item.namespace === FORM_BINDING_META_NAMESPACE)
      .map((item) => ({
        addr: { row: item.row, col: item.col } as CellAddress,
        binding: item.payload as FormCellBinding,
      }))
      .filter((item) => typeof item.binding?.path === 'string')
      .sort((a, b) => a.addr.row - b.addr.row || a.addr.col - b.addr.col)
    // revision 变化即重算：快照读取不做增量缓存
  }, [doc, revision])

  if (items.length === 0) return null

  return (
    <div className="bound-list">
      <div className="bound-list-head">
        <span className="field-label">已绑定字段</span>
        <span className="meta">{items.length} 处</span>
      </div>
      <ul className={items.length > MAX_VISIBLE ? 'bound-items scroll' : 'bound-items'}>
        {items.map(({ addr, binding }) => (
          <li key={`${addr.row}:${addr.col}`}>
            <button
              type="button"
              className="bound-item"
              title="点击定位到该单元格"
              onClick={() => doc.sheet.selectCell(addr)}
            >
              <span className="bound-addr">{formatAddress(addr)}</span>
              <span className="bound-path">{formatBindingPlaceholder(binding)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
