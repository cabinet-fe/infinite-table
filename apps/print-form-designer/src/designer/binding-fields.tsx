// 绑定面板的表现层零件：目标格条 / 字段 chip / 作用方式切换 / 路径树 / 静态格高级层。
// 从 BindingEditor 拆出——容器只管状态与写入，这里只管渲染，单文件行数可控。
import { formatAddress, type CellAddress } from '@infinitable/sheet'

import type { SourceRow } from '../transform/reshape'
import type { BindingTreeNode } from './binding'
import { AGGREGATE_MODES, type BindingAggregateMode } from './binding-presets'
import { formatBindingPlaceholder, type FormCellBinding } from './template'

/** 字段类型提示：按首行取值粗判，帮用户判断该不该求和 */
function fieldKindOf(value: unknown): { text: string; title: string } {
  if (value === null || value === undefined || value === '') {
    return { text: '空', title: '首行该字段为空，取不到样例值' }
  }
  if (typeof value === 'number') return { text: '123', title: '数字，适合求和 / 平均' }
  return { text: 'Abc', title: '文本，通常直接取值' }
}

/** 目标格条：无选区给指引，有选区给「地址 · 区域 · 明细」+ 当前绑定 + 解除按钮 */
export function BindingTargetBar({
  addr,
  regionLabel,
  inExpandRegion,
  current,
  onClear,
}: {
  addr: CellAddress | undefined
  regionLabel: string | undefined
  inExpandRegion: boolean
  current: FormCellBinding | undefined
  onClear: () => void
}) {
  if (!addr) {
    return <p className="binding-target empty">在画布上点选一个单元格，即可为它绑定数据字段。</p>
  }
  return (
    <div className="binding-target">
      <span className="addr">{formatAddress(addr)}</span>
      {regionLabel ? (
        <span className="region-tag">{regionLabel}</span>
      ) : (
        <span className="meta">静态内容</span>
      )}
      {inExpandRegion ? (
        <span className="binding-scope" title="这块按明细逐份复制：绑定只取当前那份的同名字段">
          明细
        </span>
      ) : null}
      {current ? (
        <>
          <span className="binding-target-value" title="当前绑定">
            {formatBindingPlaceholder(current)}
          </span>
          <button type="button" className="binding-unbind" onClick={onClear}>
            解除绑定
          </button>
        </>
      ) : (
        <span className="meta">{inExpandRegion ? '未绑定（按明细份取值）' : '未绑定'}</span>
      )}
    </div>
  )
}

/** 字段 chip 区：点一下即绑定；已绑字段显示选中态；chip 内带极小类型提示 */
export function BindingFieldChips({
  columns,
  sampleRow,
  boundColumn,
  disabled,
  onPick,
}: {
  columns: string[]
  sampleRow: SourceRow | undefined
  boundColumn: string | undefined
  disabled: boolean
  onPick: (column: string) => void
}) {
  if (columns.length === 0) return <p className="hint">这个数据集没有返回任何列。</p>
  return (
    <div className="binding-fields">
      <span className="field-label">点一个字段即完成绑定</span>
      <div className="field-chips">
        {columns.map((column) => {
          const kind = fieldKindOf(sampleRow?.[column])
          return (
            <button
              key={column}
              type="button"
              className={column === boundColumn ? 'field-chip active' : 'field-chip'}
              disabled={disabled}
              title={`${column} · ${kind.title}${disabled ? '（先在画布上选一个格）' : ''}`}
              onClick={() => onPick(column)}
            >
              <span className="field-chip-name">{column}</span>
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

/** 作用方式切换：一排小按钮（只对非展开区显示） */
export function BindingModeRow({
  value,
  disabled,
  onChange,
}: {
  value: BindingAggregateMode
  disabled: boolean
  onChange: (next: BindingAggregateMode) => void
}) {
  return (
    <div className="binding-modes">
      <span className="field-label">作用方式</span>
      <div className="mode-buttons">
        {AGGREGATE_MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            className="mode-button"
            aria-pressed={item.value === value}
            disabled={disabled}
            title={item.hint}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 树形路径选择器：<details> 逐层下钻，点选任意节点（含数组 `[]` / `[0]` 分支）即得路径 */
function BindingPathTree({
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

/** 静态格高级层：重塑表达式 + 路径树 + 手写路径 + 聚合 */
export function BindingAdvancedFields({
  expression,
  onExpressionChange,
  reshapeError,
  tree,
  sourceRows,
  onPickPath,
  path,
  onPathChange,
  pathError,
  aggregate,
  onAggregateChange,
  applyDisabled,
  onApply,
  onClear,
  clearDisabled,
}: {
  expression: string
  onExpressionChange: (next: string) => void
  reshapeError: string
  tree: BindingTreeNode[]
  sourceRows: SourceRow[] | undefined
  onPickPath: (next: string) => void
  path: string
  onPathChange: (next: string) => void
  pathError: string
  aggregate: FormCellBinding['aggregate']
  onAggregateChange: (next: FormCellBinding['aggregate']) => void
  applyDisabled: boolean
  onApply: () => void
  onClear: () => void
  clearDisabled: boolean
}) {
  return (
    <>
      <p className="hint">
        只有当数据集是嵌套结构（例如一个订单带多条明细）时才需要这里：写一段把数据整形成嵌套形态的表达式，
        再从路径树里点具体字段。普通「一列一个字段」的数据集用上面的字段按钮就够了。
      </p>

      <label className="field-col">
        <span className="field-label">重塑表达式（JS，入参 rows）</span>
        <textarea
          rows={3}
          value={expression}
          onChange={(event) => onExpressionChange(event.target.value)}
          placeholder={'如 rows.reduce(...)；留空 = 原始行数组直接作形态'}
        />
      </label>
      {reshapeError ? <p className="status error">{reshapeError}</p> : null}

      <div className="binding-tree-wrap">
        {tree.length > 0 ? (
          <BindingPathTree nodes={tree} depth={0} onPick={onPickPath} />
        ) : (
          <p className="hint">{sourceRows ? '重塑结果暂无可选路径' : '选择数据集后生成路径树'}</p>
        )}
      </div>

      <div className="binding-split">
        <label className="field-col">
          <span className="field-label">路径</span>
          <input
            value={path}
            onChange={(event) => onPathChange(event.target.value)}
            placeholder="如 items[].price"
          />
        </label>
        <label className="field-col">
          <span className="field-label">聚合</span>
          <select
            value={aggregate ?? ''}
            onChange={(event) =>
              onAggregateChange((event.target.value || undefined) as FormCellBinding['aggregate'])
            }
            title="静态格常用求和/平均等"
          >
            <option value="">直取</option>
            {AGGREGATE_MODES.filter((item) => item.value !== 'first').map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {pathError ? <p className="status error">{pathError}</p> : null}

      <div className="binding-actions">
        <button type="button" className="primary" onClick={onApply} disabled={applyDisabled}>
          应用绑定
        </button>
        <button type="button" onClick={onClear} disabled={clearDisabled}>
          清除绑定
        </button>
      </div>
    </>
  )
}
