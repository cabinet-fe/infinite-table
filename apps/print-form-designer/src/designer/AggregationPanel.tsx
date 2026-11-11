// 聚合面板（「聚合」tab）：模板级 JS 加工管线——把数据集原始行加工成方便取的结构，
// 挂到 agg.{变量名}。编辑器最前是**类型**二选一（数组型 = 产出一列数据可绑成数据块
// 逐条展开；非数组型 = 产出一个值或对象，任意单元格直接引用），选完即时提交并触发
// 空数据试跑校验（反馈就地一行）。面向实施的核心交互是**试运行**：立即对真实数据集
// 求值，结果以可下钻的 JSON 树展示，每个节点点一下即复制 `agg.name['路径']` 引用，
// 粘到单元格函数里就能用——「取数路径」不再靠手拼。
//
// 模型写入全部即时落 doc（可撤销）：改类型/参数/表达式经 setAggregations（提交强校验：
// 空数据试跑抛错或返回形态与声明类型不一致即拒绝），改名经 renameAggregation
// （联动改写数据块数据源与函数引用）。
import { useEffect, useMemo, useState } from 'react'

import { api, type DatasetRow } from '../data/api'
import { fetchDatasetRowsBulk } from '../data/dataset-service'
import { InfoBubble } from './InfoBubble'
import { probeAggregationType, runAggregations } from '../domain/aggregation'
import type { FormDoc } from '../domain/form-doc'
import { AGGREGATION_TYPE_OPTIONS } from './labels'
import {
  aggregationTypeLabel,
  aggregationVarNameError,
  type AggregationType,
  type FormAggregation,
} from '../shared/template-schema'
import { compileFunctionBody } from '../transform/expr'
import { IconPlus, IconTrash } from '../ui/icons'
import { describeError, runGuarded } from '../errors'

interface Props {
  doc: FormDoc
}

/** 引用路径拼接：`agg.name` + `['键']` / `[0]` */
function refOf(root: string, segments: (string | number)[]): string {
  return segments.reduce<string>(
    (acc, seg) => acc + (typeof seg === 'number' ? `[${seg}]` : `['${seg}']`),
    root,
  )
}

/** 值预览（原始值截断；容器显示长度提示） */
function previewOf(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `Array(${value.length})`
  if (typeof value === 'object') return `{${Object.keys(value).length} 键}`
  if (typeof value === 'string') {
    return value.length > 48 ? `${value.slice(0, 48)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return typeof value
}

/** 试运行结果树：任意节点点击复制引用（含容器节点——先取结构再下钻是常见写法） */
function AggResultTree({
  rootRef,
  value,
  segments,
  onCopy,
}: {
  rootRef: string
  value: unknown
  segments: (string | number)[]
  onCopy: (ref: string) => void
}) {
  const ref = refOf(rootRef, segments)
  const isContainer = value !== null && typeof value === 'object'
  const entries: [string | number, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [index, item])
    : isContainer
      ? Object.entries(value as Record<string, unknown>)
      : []
  return (
    <div className="agg-node">
      <button
        type="button"
        className="agg-node-ref mono"
        title={`点击复制引用 ${ref}`}
        onClick={() => onCopy(ref)}
      >
        {ref}
      </button>
      <span className="agg-node-value">{previewOf(value)}</span>
      {entries.length > 0 ? (
        <details open={segments.length === 0} className="agg-node-children">
          <summary>{entries.length} 项</summary>
          {entries.slice(0, 50).map(([key, child]) => (
            <AggResultTree
              key={String(key)}
              rootRef={rootRef}
              value={child}
              segments={[...segments, key]}
              onCopy={onCopy}
            />
          ))}
          {entries.length > 50 ? <span className="meta">… 共 {entries.length} 项</span> : null}
        </details>
      ) : null}
    </div>
  )
}

export function AggregationPanel({ doc }: Props) {
  const [error, setError] = useState('')
  const [datasets, setDatasets] = useState<DatasetRow[] | null>(null)
  /** 当前编辑的聚合名（跟随列表选择；新建后自动选中） */
  const [selectedName, setSelectedName] = useState<string | undefined>(doc.aggregations[0]?.name)
  /** 函数体草稿（失焦/⌘Enter 提交；换选中项时重置） */
  const [expressionDraft, setExpressionDraft] = useState(doc.aggregations[0]?.expression ?? '')
  /** 试运行结果与错误 */
  const [runResult, setRunResult] = useState<Record<string, unknown> | null>(null)
  const [runError, setRunError] = useState('')
  const [copiedRef, setCopiedRef] = useState('')

  const selected = doc.aggregations.find((agg) => agg.name === selectedName) ?? doc.aggregations[0]

  useEffect(() => {
    api
      .listDatasets()
      .then((rows) => setDatasets(rows))
      .catch((cause: unknown) => setError(describeError(cause)))
  }, [])

  // 选中项变化时把函数体草稿拉回模型值、清掉旧试运行结果
  useEffect(() => {
    setExpressionDraft(selected?.expression ?? '')
    setRunResult(null)
    setRunError('')
  }, [selected?.name])

  const guard = (action: () => void): void => runGuarded(setError, action)

  /** 全量替换聚合序列（增删改/排序的统一落点） */
  const commit = (next: FormAggregation[], keepSelected?: string): void => {
    guard(() => {
      doc.setAggregations(next)
      if (keepSelected) setSelectedName(keepSelected)
    })
  }

  /** 新建聚合：合法默认值（变量名唯一、默认数组型、函数体为极简 return——选中后即改） */
  const createAggregation = (): void => {
    let index = doc.aggregations.length + 1
    while (doc.aggregations.some((agg) => agg.name === `agg${index}`)) index++
    const name = `agg${index}`
    const firstDataset = datasets?.[0]?.id
    commit(
      [
        ...doc.aggregations,
        {
          name,
          type: 'array',
          params: firstDataset ? [{ datasetId: firstDataset, varName: 'rows' }] : [],
          expression: firstDataset ? 'return rows' : 'return []',
        },
      ],
      name,
    )
  }

  /** 切换聚合类型：即时提交（setAggregations 强校验空数据试跑，不匹配即拒绝并报错） */
  const setType = (type: AggregationType): void => {
    if (!selected || selected.type === type) return
    commit(doc.aggregations.map((agg) => (agg.name === selected.name ? { ...agg, type } : agg)))
  }

  /** 试运行：取全部聚合入参的数据集（每次点击全量重取）→ 全量求值（保证链式 agg 依赖正确） */
  const runTest = (): void => {
    const ids = [...new Set(doc.aggregations.flatMap((agg) => agg.params.map((p) => p.datasetId)))]
    fetchDatasetRowsBulk(ids)
      .then((rowsByDataset) => {
        try {
          setRunResult(runAggregations(doc.aggregations, rowsByDataset))
          setRunError('')
        } catch (cause) {
          setRunResult(null)
          setRunError(describeError(cause))
        }
      })
      .catch((cause: unknown) => {
        setRunResult(null)
        setRunError(describeError(cause))
      })
  }

  const copyRef = (ref: string): void => {
    navigator.clipboard
      ?.writeText(ref)
      .then(() => setCopiedRef(ref))
      .catch(() => setCopiedRef(''))
  }

  /** 提交函数体草稿（先做编译期语法检查；缺 return 由 normalize 校验兜底） */
  const commitExpression = (): void => {
    if (!selected) return
    const next = expressionDraft.trim()
    if (next === selected.expression) return
    try {
      compileFunctionBody([...selected.params.map((param) => param.varName), 'agg'], next)
    } catch (cause) {
      setError(describeError(cause))
      return
    }
    commit(
      doc.aggregations.map((agg) =>
        agg.name === selected.name ? { ...agg, expression: next } : agg,
      ),
    )
    setError('')
  }

  const selectedResult = runResult && selected ? runResult[selected.name] : undefined
  /** 空数据试跑反馈（对草稿实时校验：通过 / 形态不一致 / 抛错三类文案，随草稿即刷） */
  const probeFeedback = useMemo(() => {
    if (!selected) return null
    const probe = probeAggregationType(selected.params, expressionDraft)
    if (!probe.ok) return { ok: false, text: `空数据试跑失败：${probe.error}` }
    if (probe.returns !== selected.type) {
      return {
        ok: false,
        text: `声明为${aggregationTypeLabel(selected.type)}，但空数据试跑返回了${
          probe.returns === 'array' ? '数组' : '非数组'
        }`,
      }
    }
    return { ok: true, text: `✓ 空数据试跑通过，返回${probe.returns === 'array' ? '数组' : '值'}` }
  }, [selected, expressionDraft])
  // 入参变量名实时反馈：与提交校验（normalizeAggregations）共用 shared 的同一条口径
  const varNameError = useMemo(
    () => (selected ? (aggregationVarNameError(selected.params) ?? '') : ''),
    [selected],
  )

  return (
    <div className="card-block">
      <p className="hint">
        把数据集加工成方便取的结构，挂到 <code>agg.变量名</code> 下。
        <InfoBubble label="聚合是什么">
          聚合是模板级的 JS 加工：把一个或多个数据集整成方便取的结构，挂到
          <code>agg.变量名</code> 下。数组型的返回列表可作数据块数据源逐条打印；非数组型
          返回一个值或对象，可被单元格直接引用。按声明序求值，后面的聚合能用
          <code>agg</code> 访问前面的结果（空数据下取前序结果请写防御式，如
          <code>(agg.台账 ?? {})['x'] ?? 0</code>）。
        </InfoBubble>
      </p>

      <ul className="agg-list">
        {doc.aggregations.map((agg, index) => (
          <li
            key={agg.name}
            className={agg.name === selected?.name ? 'agg-row active' : 'agg-row'}
            onClick={() => setSelectedName(agg.name)}
          >
            <span className="agg-row-main">
              <span className="agg-title mono">agg.{agg.name}</span>
              <span className="region-range meta">
                {aggregationTypeLabel(agg.type)} ·{' '}
                {agg.params.length ? agg.params.map((p) => p.varName).join(', ') : '无入参'}
              </span>
            </span>
            <span className="region-actions" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="icon-button"
                title="上移（先声明的聚合先求值，可被后面的引用）"
                disabled={index === 0}
                onClick={() => {
                  const next = [...doc.aggregations]
                  const [item] = next.splice(index, 1)
                  next.splice(index - 1, 0, item!)
                  commit(next)
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button"
                title="下移"
                disabled={index === doc.aggregations.length - 1}
                onClick={() => {
                  const next = [...doc.aggregations]
                  const [item] = next.splice(index, 1)
                  next.splice(index + 1, 0, item!)
                  commit(next)
                }}
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-button"
                title="删除该聚合（被数据块数据源引用时会拒绝）"
                onClick={() => commit(doc.aggregations.filter((item) => item !== agg))}
              >
                <IconTrash />
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="region-add">
        <button type="button" className="accent-outline" onClick={createAggregation}>
          <IconPlus />
          新建聚合
        </button>
      </div>

      {selected ? (
        <div className="agg-editor">
          <div className="field-col">
            <span className="field-label">
              类型
              <InfoBubble label="聚合类型">
                数组型返回一列数据，可绑成数据块数据源逐条打印；非数组型返回一个值或
                对象，可被任意单元格直接引用。切换类型会立即用空数据试跑校验函数体
                的返回形态是否与声明一致。
              </InfoBubble>
            </span>
            <div className="mode-buttons" role="group" aria-label="聚合类型">
              {AGGREGATION_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="mode-button"
                  aria-pressed={selected.type === option.value}
                  title={option.hint}
                  onClick={() => setType(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="hint">
              {AGGREGATION_TYPE_OPTIONS.find((option) => option.value === selected.type)?.hint}
            </p>
            {probeFeedback ? (
              <p className={probeFeedback.ok ? 'status' : 'status error'}>{probeFeedback.text}</p>
            ) : null}
          </div>

          <label className="field-col">
            <span className="field-label">
              变量名
              <InfoBubble label="变量名">重命名会联动改写引用它的数据块数据源与函数。</InfoBubble>
            </span>
            <input
              className="mono"
              defaultValue={selected.name}
              key={selected.name}
              onBlur={(event) => {
                const next = event.target.value.trim()
                if (next === selected.name || !next) return
                guard(() => doc.renameAggregation(selected.name, next))
                setSelectedName(next)
              }}
            />
          </label>

          <div className="field-col">
            <span className="field-label">
              入参数据集
              <InfoBubble label="入参数据集">
                每个数据集配一个 JS 形参名，函数体里收到它的原始行数组。
              </InfoBubble>
            </span>
            {selected.params.map((param, paramIndex) => (
              <div key={paramIndex} className="agg-param-row">
                <select
                  value={param.datasetId}
                  onChange={(event) =>
                    commit(
                      doc.aggregations.map((agg) =>
                        agg.name === selected.name
                          ? {
                              ...agg,
                              params: agg.params.map((p, i) =>
                                i === paramIndex ? { ...p, datasetId: event.target.value } : p,
                              ),
                            }
                          : agg,
                      ),
                    )
                  }
                >
                  {datasets?.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
                <input
                  className="mono agg-param-var"
                  defaultValue={param.varName}
                  key={`${selected.name}:${paramIndex}:${param.datasetId}`}
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next === param.varName) return
                    commit(
                      doc.aggregations.map((agg) =>
                        agg.name === selected.name
                          ? {
                              ...agg,
                              params: agg.params.map((p, i) =>
                                i === paramIndex ? { ...p, varName: next } : p,
                              ),
                            }
                          : agg,
                      ),
                    )
                  }}
                />
                <button
                  type="button"
                  className="icon-button"
                  title="移除该入参"
                  onClick={() =>
                    commit(
                      doc.aggregations.map((agg) =>
                        agg.name === selected.name
                          ? {
                              ...agg,
                              params: agg.params.filter((_, i) => i !== paramIndex),
                            }
                          : agg,
                      ),
                    )
                  }
                >
                  <IconTrash />
                </button>
              </div>
            ))}
            {datasets && datasets.length > selected.params.length ? (
              <button
                type="button"
                className="icon-button agg-param-add"
                title="加入一个数据集入参"
                onClick={() => {
                  const used = new Set(selected.params.map((p) => p.datasetId))
                  const dataset = datasets.find((row) => !used.has(row.id)) ?? datasets[0]
                  if (!dataset) return
                  let index = selected.params.length + 1
                  const names = new Set(selected.params.map((p) => p.varName))
                  while (names.has(`rows${index}`)) index++
                  commit(
                    doc.aggregations.map((agg) =>
                      agg.name === selected.name
                        ? {
                            ...agg,
                            params: [
                              ...agg.params,
                              { datasetId: dataset.id, varName: `rows${index}` },
                            ],
                          }
                        : agg,
                    ),
                  )
                }}
              >
                <IconPlus />
                加数据集
              </button>
            ) : null}
            {varNameError ? <p className="status error">{varNameError}</p> : null}
          </div>

          <div className="field-col">
            <span className="field-label">
              函数体
              <InfoBubble label="函数体">
                JS；形参 = 各入参变量 + <code>agg</code>（前面的聚合结果），必须
                <code>return</code> 返回结果。
              </InfoBubble>
            </span>
            {/* 外壳签名固定展示（形参随入参实时派生），textarea 只放函数体 */}
            <div className="mono meta">
              function ({[...selected.params.map((p) => p.varName), 'agg'].join(', ')}) {'{'}
            </div>
            <textarea
              className="mono"
              rows={5}
              spellCheck={false}
              value={expressionDraft}
              placeholder={
                selected.params.length
                  ? `return ${selected.params[0]!.varName}.slice(0, 1)`
                  : 'return {}'
              }
              title={`多行分组示例（形参名以实际入参为准）：\nconst groups = {}\nfor (const r of orders) (groups[r.order_no] ??= []).push(r)\nreturn groups`}
              onChange={(event) => setExpressionDraft(event.target.value)}
              onBlur={commitExpression}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  commitExpression()
                }
              }}
            />
            <div className="mono meta">{'}'}</div>
          </div>

          <div className="binding-actions">
            <button type="button" className="primary" onClick={runTest}>
              试运行（真实取数）
            </button>
            {runResult ? (
              <span className="meta">agg 共 {Object.keys(runResult).length} 个变量</span>
            ) : null}
          </div>

          {runError ? <p className="status error">{runError}</p> : null}
          {runResult && selected ? (
            <div className="agg-run-result">
              <span className="field-label">结果（点任意节点复制引用，粘贴到单元格函数里用）</span>
              <AggResultTree
                rootRef={`agg.${selected.name}`}
                value={selectedResult}
                segments={[]}
                onCopy={copyRef}
              />
              {copiedRef ? <p className="status">已复制引用 {copiedRef}</p> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="hint">
          还没有聚合。点「新建聚合」：选类型（默认数组型）、选数据集、写一段 JS、试运行、复制引用。
        </p>
      )}

      {error ? <p className="status error">{error}</p> : null}
    </div>
  )
}
