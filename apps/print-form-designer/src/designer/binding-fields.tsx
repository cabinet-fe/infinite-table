// 单元格面板的表现层零件：目标格条 / 字段 chip / 路径树。
// 从 BindingEditor 拆出——容器只管状态与写入，这里只管渲染，单文件行数可控。
import { useEffect, useState } from 'react'

import { formatAddress, type CellAddress } from '@infinitable/sheet'

import { api, datasetFieldLabel, type DatasetField } from '../data/api'
import type { BindingTreeNode } from './binding'

/**
 * 数据集字段命名并集（chip 显示别名用）。容器不传数据集元信息，这里自取清单合并——
 * 字段 key 即 SQL 原始列名，跨数据集同列名先到先得；绑定/存储不受影响，仅展示。
 * 取失败按原名展示，不打断绑定流程。
 */
function useDatasetFieldNaming(): DatasetField[] {
  const [fields, setFields] = useState<DatasetField[]>([])
  useEffect(() => {
    let cancelled = false
    api
      .listDatasets()
      .then((datasets) => {
        if (!cancelled) setFields(datasets.flatMap((row) => row.fields))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return fields
}

/** 字段类型提示：按样例值粗判，帮用户判断该不该求和 */
function fieldKindOf(value: unknown): { text: string; title: string } {
  if (value === null || value === undefined || value === '') {
    return { text: '空', title: '首条该字段为空，取不到样例值' }
  }
  if (typeof value === 'number') return { text: '123', title: '数字，适合求和 / 平均' }
  return { text: 'Abc', title: '文本，通常直接取值' }
}

/** 目标格条：无选区给指引，有选区给「地址 · 数据块」+ 当前绑定/函数 + 解除按钮 */
export function BindingTargetBar({
  addr,
  regionLabel,
  inRegion,
  currentLabel,
  onClear,
  clearLabel,
}: {
  addr: CellAddress | undefined
  regionLabel: string | undefined
  inRegion: boolean
  /** 当前绑定/函数的占位符展示（undefined = 未设置） */
  currentLabel: string | undefined
  onClear: () => void
  clearLabel: string
}) {
  if (!addr) {
    return (
      <p className="binding-target empty">在画布上点选一个单元格，即可为它绑定字段或设置函数。</p>
    )
  }
  return (
    <div className="binding-target">
      <span className="addr-badge">{formatAddress(addr)}</span>
      {regionLabel ? (
        <span className="region-tag">{regionLabel}</span>
      ) : (
        <span className="meta">数据块外（可引用非数组聚合 / 用函数）</span>
      )}
      {inRegion ? (
        <span
          className="binding-scope"
          title="字段绑定在数据块内：列表区每行按条目取值；非列表的数据块取第 1 条数据（适合单据头字段）"
        >
          数据块内
        </span>
      ) : null}
      {currentLabel ? (
        <>
          <span className="binding-target-value" title="当前绑定">
            {currentLabel}
          </span>
          <button type="button" className="binding-unbind" onClick={onClear}>
            {clearLabel}
          </button>
        </>
      ) : (
        <span className="meta">未设置</span>
      )}
    </div>
  )
}

/** 字段 chip 区：点一下即绑定；已绑字段显示选中态；chip 内带极小类型提示。
 *  显示名走数据集字段命名（别名优先，无别名用原名），title 带出原始字段名。 */
export function BindingFieldChips({
  fields,
  boundKey,
  disabled,
  onPick,
}: {
  /** 条目采样出的字段（key + 样例值） */
  fields: { key: string; sample: unknown }[]
  boundKey: string | undefined
  disabled: boolean
  onPick: (key: string) => void
}) {
  const naming = useDatasetFieldNaming()
  if (fields.length === 0) return <p className="hint">循环条目里没有可绑定的字段。</p>
  return (
    <div className="binding-fields">
      <span className="field-label">点一个字段即绑定</span>
      <div className="field-chips">
        {fields.map(({ key, sample }) => {
          const kind = fieldKindOf(sample)
          const label = datasetFieldLabel(naming, key)
          return (
            <button
              key={key}
              type="button"
              className={key === boundKey ? 'field-chip active' : 'field-chip'}
              disabled={disabled}
              title={`${label === key ? key : `${label}（原名 ${key}）`} · ${kind.title}${disabled ? '（先在画布上选一个格）' : ''}`}
              onClick={() => onPick(key)}
            >
              <span className="field-chip-name">{label}</span>
              <span className={kind.text === '空' ? 'field-chip-kind empty' : 'field-chip-kind'}>
                {kind.text}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 树形路径选择器：<details> 逐层下钻，点选任意节点（含数组 `[]` / `[0]` 分支）即得路径 */
export function BindingPathTree({
  nodes,
  depth,
  onPick,
}: {
  nodes: BindingTreeNode[]
  depth: number
  onPick: (path: string) => void
}) {
  return (
    <ul className="binding-tree">
      {nodes.map((node) => (
        <li key={node.path}>
          <details open={depth < 2}>
            <summary>
              <button type="button" className="tree-pick" onClick={() => onPick(node.path)}>
                {node.label}
                {node.kind === 'array' ? '（数组）' : node.kind === 'object' ? '（对象）' : ''}
              </button>
            </summary>
            {node.children?.length ? (
              <BindingPathTree nodes={node.children} depth={depth + 1} onPick={onPick} />
            ) : null}
          </details>
        </li>
      ))}
    </ul>
  )
}
